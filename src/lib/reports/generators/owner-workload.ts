import ExcelJS from "exceljs";
import type { Content } from "pdfmake/interfaces";

import { prisma } from "../../db/prisma";
import { buildPdfBuffer, makePdfFooter, makeHeaderRow, PDF_STYLES, PDF_TABLE_LAYOUT } from "../pdf";
import {
  CLOSED_STATUSES_SET,
  HEADER_ARGB,
  WHITE_ARGB,
  STATUS_LABELS,
  daysDiff,
  formatDate,
  getOwnerDept,
  getOwnershipFilter,
  type ReportParams,
} from "../templates";

const THIRTY_DAYS_MS = 30 * 86_400_000;

async function fetchData(params: ReportParams) {
  const { to, department, userId, userRole } = params;
  const ownership = getOwnershipFilter(userId, userRole);

  // Fetch all open action plans
  const openPlans = await prisma.action_plans.findMany({
    where: {
      is_deleted: false,
      status: { in: ["NotStarted", "InProgress", "PendingValidation"] },
      ...(department ? { department } : {}),
      ...ownership,
    },
    include: {
      finding: { select: { title: true, audit: { select: { name: true } } } },
      action_plan_owners: {
        include: { user: { select: { id: true, name: true, department: true, team_l2: true } } },
      },
      action_plan_entities: {
        select: { entity: { select: { code: true } } },
      },
      _count: { select: { evidence: { where: { is_deleted: false } } } },
    },
    orderBy: { current_target_date: "asc" },
  });

  // Fetch closed plans within the date range to compute closure rate
  const closedPlans = await prisma.action_plans.findMany({
    where: {
      is_deleted: false,
      status: { in: ["Closed", "RiskAccepted", "Dropped"] },
      closed_at: { lte: to },
      ...(department ? { department } : {}),
      ...ownership,
    },
    include: {
      action_plan_owners: {
        include: { user: { select: { id: true, name: true } } },
      },
    },
  });

  return { openPlans, closedPlans };
}

type OpenPlan = Awaited<ReturnType<typeof fetchData>>["openPlans"][number];

export async function generateOwnerWorkloadXlsx(params: ReportParams): Promise<Buffer> {
  const { openPlans, closedPlans } = await fetchData(params);
  const { to, department } = params;

  const wb = new ExcelJS.Workbook();
  wb.creator = "IA Tracker";
  wb.created = new Date();

  function styleHeaderRow(row: ExcelJS.Row) {
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_ARGB } };
      cell.font = { bold: true, color: { argb: WHITE_ARGB } };
      cell.alignment = { vertical: "middle" };
    });
    row.height = 18;
  }

  // Build owner map
  const ownerMap = new Map<
    string,
    {
      name: string;
      dept: string;
      openPlans: OpenPlan[];
      closedCount: number;
    }
  >();

  for (const p of openPlans) {
    for (const ownerAssignment of p.action_plan_owners) {
      const { user } = ownerAssignment;
      if (!ownerMap.has(user.id)) {
        ownerMap.set(user.id, {
          name: user.name,
          dept: getOwnerDept(user),
          openPlans: [],
          closedCount: 0,
        });
      }
      ownerMap.get(user.id)!.openPlans.push(p);
    }
  }

  for (const p of closedPlans) {
    for (const ownerAssignment of p.action_plan_owners) {
      const { user } = ownerAssignment;
      if (ownerMap.has(user.id)) {
        ownerMap.get(user.id)!.closedCount++;
      } else {
        ownerMap.set(user.id, { name: user.name, dept: "", openPlans: [], closedCount: 1 });
      }
    }
  }

  // ── Sheet 1: Workload Summary ────────────────────────────────────────
  const ws1 = wb.addWorksheet("Workload Summary");
  ws1.getCell("A1").value = `Owner Workload Report — As of ${formatDate(to)}`;
  ws1.getCell("A1").font = { bold: true, size: 14 };
  ws1.getCell("A2").value = `Department: ${department ?? "All"}`;
  ws1.getCell("A2").font = { color: { argb: "FF64748B" } };

  const summaryH = ws1.getRow(4);
  summaryH.values = ["Owner", "Department", "Total Open", "Overdue", "Due Next 30 Days", "High Priority Open", "Evidence Uploaded", "Closure Rate"];
  styleHeaderRow(summaryH);

  const ownerRows = [...ownerMap.entries()]
    .map(([, owner]) => {
      const overdue = owner.openPlans.filter(
        (p) => p.current_target_date != null && p.current_target_date < to,
      ).length;
      const dueNext30 = owner.openPlans.filter(
        (p) =>
          p.current_target_date != null &&
          p.current_target_date >= to &&
          p.current_target_date.getTime() - to.getTime() <= THIRTY_DAYS_MS,
      ).length;
      const highOpen = owner.openPlans.filter((p) => p.priority === "High").length;
      const evidenceCount = owner.openPlans.reduce((sum, p) => sum + p._count.evidence, 0);
      const totalForRate = owner.openPlans.length + owner.closedCount;
      const closureRate = totalForRate > 0
        ? `${Math.round((owner.closedCount / totalForRate) * 100)}%`
        : "N/A";
      return { ...owner, overdue, dueNext30, highOpen, evidenceCount, closureRate };
    })
    .sort((a, b) => b.overdue - a.overdue);

  for (const owner of ownerRows) {
    const dataRow = ws1.addRow([
      owner.name,
      owner.dept,
      owner.openPlans.length,
      owner.overdue,
      owner.dueNext30,
      owner.highOpen,
      owner.evidenceCount,
      owner.closureRate,
    ]);
    const overdueCell = dataRow.getCell(4);
    const argb =
      owner.overdue > 5 ? "FFFEE2E2" : owner.overdue >= 3 ? "FFFEF3C7" : "FFD1FAE5";
    overdueCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
  }

  ws1.columns = [
    { width: 24 }, { width: 22 }, { width: 12 }, { width: 12 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 14 },
  ];
  ws1.views = [{ state: "frozen", ySplit: 4 }];

  // ── Sheet 2: Detail by Owner ─────────────────────────────────────────
  const ws2 = wb.addWorksheet("Detail by Owner");
  let ws2Row = 1;

  for (const owner of ownerRows) {
    if (owner.openPlans.length === 0) continue;

    const nameRow = ws2.getRow(ws2Row++);
    nameRow.getCell(1).value = `${owner.name} — ${owner.dept || "No Department"}`;
    nameRow.getCell(1).font = { bold: true, size: 11 };
    nameRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };

    const statsRow = ws2.getRow(ws2Row++);
    statsRow.getCell(1).value = `Open: ${owner.openPlans.length}  |  Overdue: ${owner.overdue}  |  Due next 30d: ${owner.dueNext30}`;
    statsRow.getCell(1).font = { italic: true, color: { argb: "FF64748B" } };

    const headerRow = ws2.getRow(ws2Row++);
    headerRow.values = ["AP Ref", "Audit", "Status", "Priority", "Target Date", "Days Overdue", "Evidence Count"];
    styleHeaderRow(headerRow);

    for (const p of owner.openPlans) {
      const daysOverdue =
        p.current_target_date != null && p.current_target_date < to
          ? daysDiff(p.current_target_date, to)
          : 0;
      ws2.getRow(ws2Row++).values = [
        p.display_id,
        p.finding.audit?.name ?? "",
        STATUS_LABELS[p.status],
        p.priority ?? "",
        formatDate(p.current_target_date),
        daysOverdue > 0 ? daysOverdue : "",
        p._count.evidence,
      ];
    }
    ws2Row++;
  }

  ws2.columns = [
    { width: 12 }, { width: 30 }, { width: 20 }, { width: 12 }, { width: 14 }, { width: 14 }, { width: 14 },
  ];

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function generateOwnerWorkloadPdf(params: ReportParams): Promise<Buffer> {
  const { openPlans, closedPlans } = await fetchData(params);
  const { to, department } = params;

  const ownerMap = new Map<
    string,
    { name: string; dept: string; openPlans: OpenPlan[]; closedCount: number }
  >();

  for (const p of openPlans) {
    for (const ownerAssignment of p.action_plan_owners) {
      const { user } = ownerAssignment;
      if (!ownerMap.has(user.id)) {
        ownerMap.set(user.id, { name: user.name, dept: getOwnerDept(user), openPlans: [], closedCount: 0 });
      }
      ownerMap.get(user.id)!.openPlans.push(p);
    }
  }
  for (const p of closedPlans) {
    for (const ownerAssignment of p.action_plan_owners) {
      const { user } = ownerAssignment;
      if (ownerMap.has(user.id)) {
        ownerMap.get(user.id)!.closedCount++;
      }
    }
  }

  const ownerRows = [...ownerMap.entries()]
    .map(([, owner]) => {
      const overdue = owner.openPlans.filter(
        (p) => p.current_target_date != null && p.current_target_date < to,
      ).length;
      const dueNext30 = owner.openPlans.filter(
        (p) =>
          p.current_target_date != null &&
          p.current_target_date >= to &&
          p.current_target_date.getTime() - to.getTime() <= THIRTY_DAYS_MS,
      ).length;
      const highOpen = owner.openPlans.filter((p) => p.priority === "High").length;
      return { ...owner, overdue, dueNext30, highOpen };
    })
    .sort((a, b) => b.overdue - a.overdue);

  const content: Content[] = [
    { text: "Owner Workload Report", style: "reportTitle" },
    { text: `As of ${formatDate(to)}  |  Department: ${department ?? "All"}`, style: "reportSubtitle" },

    { text: "Workload Summary", style: "sectionHeader" },
    ownerRows.length === 0
      ? { text: "No open action plans found.", style: "small" }
      : {
          table: {
            headerRows: 1,
            widths: ["*", 70, 50, 50, 70, 60],
            body: [
              makeHeaderRow(["Owner", "Department", "Total Open", "Overdue", "Due Next 30d", "High Priority"]),
              ...ownerRows.map((o) => [
                o.name,
                o.dept || "—",
                o.openPlans.length.toString(),
                {
                  text: o.overdue.toString(),
                  fillColor: o.overdue > 5 ? "#fee2e2" : o.overdue >= 3 ? "#fef3c7" : "#d1fae5",
                },
                o.dueNext30.toString(),
                o.highOpen.toString(),
              ]),
            ],
          },
          layout: PDF_TABLE_LAYOUT,
        } as Content,

    { text: "Top 5 Most Overloaded Owners", style: "sectionHeader" },
  ];

  for (const owner of ownerRows.slice(0, 5)) {
    if (owner.openPlans.length === 0) continue;
    content.push({ text: `${owner.name} (${owner.dept || "No Dept"}) — Overdue: ${owner.overdue}`, style: "groupHeader" });
    content.push({
      table: {
        headerRows: 1,
        widths: [50, "*", 55, 45, 55, 55],
        body: [
          makeHeaderRow(["AP Ref", "Audit", "Status", "Priority", "Target Date", "Days Overdue"]),
          ...owner.openPlans.slice(0, 10).map((p) => {
            const daysOverdue =
              p.current_target_date != null && p.current_target_date < to
                ? daysDiff(p.current_target_date, to)
                : 0;
            return [
              p.display_id,
              p.finding.audit?.name ?? "",
              STATUS_LABELS[p.status],
              p.priority ?? "",
              formatDate(p.current_target_date),
              daysOverdue > 0 ? daysOverdue.toString() : "—",
            ];
          }),
        ],
      },
      layout: PDF_TABLE_LAYOUT,
      margin: [0, 0, 0, 8],
    } as Content);
  }

  return buildPdfBuffer({
    content,
    styles: PDF_STYLES,
    defaultStyle: { font: "Roboto", fontSize: 9 },
    pageMargins: [40, 40, 40, 60],
    pageOrientation: "landscape",
    footer: makePdfFooter(params.userName),
  });
}
