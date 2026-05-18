import ExcelJS from "exceljs";
import type { Content } from "pdfmake/interfaces";

import { prisma } from "../../db/prisma";
import { buildPdfBuffer, makePdfFooter, makeHeaderRow, PDF_STYLES, PDF_TABLE_LAYOUT } from "../pdf";
import {
  ALL_PRIORITIES,
  CLOSED_STATUSES_SET,
  HEADER_ARGB,
  WHITE_ARGB,
  GREEN_ARGB,
  AMBER_ARGB,
  RED_ARGB,
  STATUS_LABELS,
  daysDiff,
  formatDate,
  getOwnerDept,
  getOwnershipFilter,
  getPrimaryOwner,
  type ReportParams,
} from "../templates";

const AP_INCLUDE = {
  finding: {
    select: {
      title: true,
      audit: {
        select: {
          name: true,
          audit_type: true,
          report_issue_date: true,
        },
      },
    },
  },
  action_plan_owners: {
    select: {
      is_primary: true,
      user: { select: { name: true, department: true, team_l2: true } },
    },
  },
  action_plan_entities: {
    select: { entity: { select: { code: true, full_name: true } } },
    orderBy: { entity: { code: "asc" as const } },
  },
  _count: {
    select: { evidence: { where: { is_deleted: false } } },
  },
} as const;

async function fetchData(params: ReportParams) {
  const ownership = getOwnershipFilter(params.userId, params.userRole);
  const plans = await prisma.action_plans.findMany({
    where: { is_deleted: false, ...ownership },
    include: AP_INCLUDE,
    orderBy: { created_at: "asc" },
  });
  return plans;
}

type PlanRow = Awaited<ReturnType<typeof fetchData>>[number];

function isOpen(plan: PlanRow) {
  return !CLOSED_STATUSES_SET.has(plan.status);
}

function isOverdue(plan: PlanRow, asOf: Date) {
  return isOpen(plan) && plan.current_target_date != null && plan.current_target_date < asOf;
}

export async function generatePortfolioStatusXlsx(params: ReportParams): Promise<Buffer> {
  const plans = await fetchData(params);
  const { to, from } = params;

  const wb = new ExcelJS.Workbook();
  wb.creator = "IA Tracker";
  wb.created = new Date();

  // ── Sheet 1: Summary ────────────────────────────────────────────────
  const ws1 = wb.addWorksheet("Summary");

  function styleHeaderRow(row: ExcelJS.Row) {
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_ARGB } };
      cell.font = { bold: true, color: { argb: WHITE_ARGB } };
      cell.alignment = { vertical: "middle" };
    });
    row.height = 18;
  }

  ws1.getCell("A1").value = "Portfolio Status Summary";
  ws1.getCell("A1").font = { bold: true, size: 14 };
  ws1.getCell("A2").value = `As of ${formatDate(to)}`;
  ws1.getCell("A2").font = { color: { argb: "FF64748B" } };

  // Status breakdown
  ws1.getCell("A4").value = "Status Breakdown";
  ws1.getCell("A4").font = { bold: true };
  const statusHeaders = ws1.getRow(5);
  statusHeaders.values = ["", "Status", "Count", "% of Total"];
  styleHeaderRow(statusHeaders);

  const statusCounts: Record<string, number> = {};
  for (const p of plans) statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1;
  const total = plans.length;
  let row = 6;
  for (const [status, label] of Object.entries(STATUS_LABELS)) {
    const count = statusCounts[status] ?? 0;
    const pct = total > 0 ? ((count / total) * 100).toFixed(1) + "%" : "0%";
    ws1.getRow(row++).values = ["", label, count, pct];
  }
  ws1.getRow(row++).values = ["", "Total", total, "100%"];
  ws1.getRow(row - 1).font = { bold: true };
  row++;

  // Priority breakdown
  ws1.getCell(`A${row}`).value = "Priority Breakdown";
  ws1.getCell(`A${row}`).font = { bold: true };
  row++;
  const prioHeaders = ws1.getRow(row);
  prioHeaders.values = ["", "Priority", "Open", "Closed", "Total"];
  styleHeaderRow(prioHeaders);
  row++;
  for (const prio of ALL_PRIORITIES) {
    const prioPlans = plans.filter((p) => p.priority === prio);
    const openCount = prioPlans.filter(isOpen).length;
    const closedCount = prioPlans.filter((p) => !isOpen(p)).length;
    ws1.getRow(row++).values = ["", prio, openCount, closedCount, prioPlans.length];
  }
  row++;

  // Entity breakdown
  const entityMap = new Map<string, { open: number; overdue: number; closed: number; total: number }>();
  for (const p of plans) {
    const codes = p.action_plan_entities.map((e) => e.entity.code);
    const targets = codes.length > 0 ? codes : ["(No Entity)"];
    for (const code of targets) {
      if (!entityMap.has(code)) entityMap.set(code, { open: 0, overdue: 0, closed: 0, total: 0 });
      const entry = entityMap.get(code)!;
      entry.total++;
      if (isOpen(p)) {
        entry.open++;
        if (isOverdue(p, to)) entry.overdue++;
      } else {
        entry.closed++;
      }
    }
  }
  ws1.getCell(`A${row}`).value = "Entity Breakdown";
  ws1.getCell(`A${row}`).font = { bold: true };
  row++;
  const entityHeaders = ws1.getRow(row);
  entityHeaders.values = ["", "Entity", "Open", "Overdue", "Closed", "Total"];
  styleHeaderRow(entityHeaders);
  row++;
  for (const [code, counts] of [...entityMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    ws1.getRow(row++).values = ["", code, counts.open, counts.overdue, counts.closed, counts.total];
  }
  row++;

  // Period activity
  const closedInPeriod = plans.filter((p) => p.closed_at && p.closed_at >= from && p.closed_at <= to).length;
  const createdInPeriod = plans.filter((p) => p.created_at >= from && p.created_at <= to).length;
  const rescheduledInPeriod = await prisma.target_date_revisions.count({
    where: { revised_at: { gte: from, lte: to } },
  });
  const overdueAtEnd = plans.filter((p) => isOverdue(p, to)).length;

  ws1.getCell(`A${row}`).value = "Period Activity";
  ws1.getCell(`A${row}`).font = { bold: true };
  row++;
  const actHeaders = ws1.getRow(row);
  actHeaders.values = ["", "Metric", "Count"];
  styleHeaderRow(actHeaders);
  row++;
  ws1.getRow(row++).values = ["", "Closed during period", closedInPeriod];
  ws1.getRow(row++).values = ["", "New plans created during period", createdInPeriod];
  ws1.getRow(row++).values = ["", "Rescheduled during period", rescheduledInPeriod];
  ws1.getRow(row++).values = ["", "Overdue at period end", overdueAtEnd];

  ws1.columns = [{ width: 2 }, { width: 36 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];
  ws1.views = [{ state: "frozen", ySplit: 1 }];

  // ── Sheet 2: Overdue Details ─────────────────────────────────────────
  const ws2 = wb.addWorksheet("Overdue Details");
  const overduePlans = plans
    .filter((p) => isOverdue(p, to))
    .sort((a, b) => daysDiff(a.current_target_date!, to) - daysDiff(b.current_target_date!, to))
    .slice(0, 20);

  const od2Headers = ws2.getRow(1);
  od2Headers.values = ["AP Ref", "Description", "Audit", "Owner", "Priority", "Entity", "Target Date", "Days Overdue"];
  styleHeaderRow(od2Headers);

  for (const p of overduePlans) {
    const owner = getPrimaryOwner(p.action_plan_owners);
    const entities = p.action_plan_entities.map((e) => e.entity.code).join(", ");
    const daysOverdue = p.current_target_date ? daysDiff(p.current_target_date, to) : 0;
    const dataRow = ws2.addRow([
      p.display_id,
      p.description.slice(0, 100),
      p.finding.audit?.name ?? "",
      owner?.name ?? "Unassigned",
      p.priority ?? "",
      entities,
      formatDate(p.current_target_date),
      daysOverdue,
    ]);
    const daysCell = dataRow.getCell(8);
    const argb = daysOverdue > 90 ? RED_ARGB : daysOverdue >= 30 ? AMBER_ARGB : "FFFFF9C4";
    daysCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
  }

  ws2.columns = [
    { width: 12 }, { width: 40 }, { width: 30 }, { width: 22 },
    { width: 12 }, { width: 14 }, { width: 14 }, { width: 14 },
  ];

  // ── Sheet 3: All Action Plans ────────────────────────────────────────
  const ws3 = wb.addWorksheet("All Action Plans");
  const allHeaders = ws3.getRow(1);
  allHeaders.values = [
    "AP Ref", "Description", "Audit", "Finding", "Owner", "Status",
    "Priority", "Entity", "Original Target", "Current Target", "Closed At", "Reschedule Count",
  ];
  styleHeaderRow(allHeaders);

  for (const p of plans) {
    const owner = getPrimaryOwner(p.action_plan_owners);
    const entities = p.action_plan_entities.map((e) => e.entity.code).join(", ");
    const dataRow = ws3.addRow([
      p.display_id,
      p.description.slice(0, 100),
      p.finding.audit?.name ?? "",
      p.finding.title,
      owner?.name ?? "Unassigned",
      STATUS_LABELS[p.status],
      p.priority ?? "",
      entities,
      formatDate(p.original_target_date),
      formatDate(p.current_target_date),
      formatDate(p.closed_at),
      p.reschedule_count,
    ]);
    const statusCell = dataRow.getCell(6);
    const statusArgb = CLOSED_STATUSES_SET.has(p.status) ? GREEN_ARGB : isOverdue(p, to) ? RED_ARGB : "";
    if (statusArgb) {
      statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: statusArgb } };
    }
  }

  ws3.columns = [
    { width: 12 }, { width: 40 }, { width: 28 }, { width: 28 }, { width: 22 }, { width: 20 },
    { width: 12 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 },
  ];
  ws3.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function generatePortfolioStatusPdf(params: ReportParams): Promise<Buffer> {
  const plans = await fetchData(params);
  const { to, from } = params;

  const statusCounts: Record<string, number> = {};
  for (const p of plans) statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1;
  const total = plans.length;

  const priorityCounts: Record<string, { open: number; closed: number }> = {};
  for (const prio of ALL_PRIORITIES) priorityCounts[prio] = { open: 0, closed: 0 };
  for (const p of plans) {
    const prio = p.priority ?? "Low";
    if (isOpen(p)) priorityCounts[prio].open++;
    else priorityCounts[prio].closed++;
  }

  const entityMap = new Map<string, { open: number; overdue: number; closed: number; total: number }>();
  for (const p of plans) {
    const codes = p.action_plan_entities.map((e) => e.entity.code);
    const targets = codes.length > 0 ? codes : ["(No Entity)"];
    for (const code of targets) {
      if (!entityMap.has(code)) entityMap.set(code, { open: 0, overdue: 0, closed: 0, total: 0 });
      const entry = entityMap.get(code)!;
      entry.total++;
      if (isOpen(p)) {
        entry.open++;
        if (isOverdue(p, to)) entry.overdue++;
      } else {
        entry.closed++;
      }
    }
  }

  const closedInPeriod = plans.filter((p) => p.closed_at && p.closed_at >= from && p.closed_at <= to).length;
  const createdInPeriod = plans.filter((p) => p.created_at >= from && p.created_at <= to).length;
  const overdueAtEnd = plans.filter((p) => isOverdue(p, to)).length;

  const overduePlans = plans
    .filter((p) => isOverdue(p, to))
    .sort((a, b) => daysDiff(a.current_target_date!, to) - daysDiff(b.current_target_date!, to))
    .slice(0, 10);

  const content: Content[] = [
    { text: "Portfolio Status Summary", style: "reportTitle" },
    { text: `As of ${formatDate(to)}  |  Period: ${formatDate(from)} – ${formatDate(to)}`, style: "reportSubtitle" },

    { text: "Status Breakdown", style: "sectionHeader" },
    {
      table: {
        headerRows: 1,
        widths: ["*", 80, 80],
        body: [
          makeHeaderRow(["Status", "Count", "% of Total"]),
          ...Object.entries(STATUS_LABELS).map(([status, label]) => {
            const count = statusCounts[status] ?? 0;
            const pct = total > 0 ? ((count / total) * 100).toFixed(1) + "%" : "0%";
            return [label, count.toString(), pct];
          }),
          [{ text: "Total", bold: true }, { text: total.toString(), bold: true }, "100%"],
        ],
      },
      layout: PDF_TABLE_LAYOUT,
    },

    { text: "Priority Breakdown", style: "sectionHeader" },
    {
      table: {
        headerRows: 1,
        widths: ["*", 70, 70, 70],
        body: [
          makeHeaderRow(["Priority", "Open", "Closed", "Total"]),
          ...ALL_PRIORITIES.map((prio) => {
            const counts = priorityCounts[prio];
            return [prio, counts.open.toString(), counts.closed.toString(), (counts.open + counts.closed).toString()];
          }),
        ],
      },
      layout: PDF_TABLE_LAYOUT,
    },

    { text: "Entity Breakdown", style: "sectionHeader" },
    {
      table: {
        headerRows: 1,
        widths: [60, 60, 60, 60, 60],
        body: [
          makeHeaderRow(["Entity", "Open", "Overdue", "Closed", "Total"]),
          ...[...entityMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([code, c]) => [
            code, c.open.toString(), c.overdue.toString(), c.closed.toString(), c.total.toString(),
          ]),
        ],
      },
      layout: PDF_TABLE_LAYOUT,
    },

    { text: "Period Activity", style: "sectionHeader" },
    {
      table: {
        headerRows: 1,
        widths: ["*", 80],
        body: [
          makeHeaderRow(["Metric", "Count"]),
          ["Closed during period", closedInPeriod.toString()],
          ["New plans created during period", createdInPeriod.toString()],
          ["Overdue at period end", overdueAtEnd.toString()],
        ],
      },
      layout: PDF_TABLE_LAYOUT,
    },

    { text: "Top 10 Overdue Action Plans", style: "sectionHeader" },
    overduePlans.length === 0
      ? { text: "No overdue action plans.", style: "small" }
      : {
          table: {
            headerRows: 1,
            widths: [50, "*", 80, 80, 60],
            body: [
              makeHeaderRow(["AP Ref", "Description", "Owner", "Target Date", "Days Overdue"]),
              ...overduePlans.map((p) => {
                const owner = getPrimaryOwner(p.action_plan_owners);
                const daysOverdue = p.current_target_date ? daysDiff(p.current_target_date, to) : 0;
                return [
                  p.display_id,
                  p.description.slice(0, 80),
                  owner?.name ?? "Unassigned",
                  formatDate(p.current_target_date),
                  { text: daysOverdue.toString(), fillColor: daysOverdue > 90 ? "#fee2e2" : daysOverdue >= 30 ? "#fef3c7" : "#fffde7" },
                ];
              }),
            ],
          },
          layout: PDF_TABLE_LAYOUT,
        } as Content,
  ];

  return buildPdfBuffer({
    content,
    styles: PDF_STYLES,
    defaultStyle: { font: "Roboto", fontSize: 9 },
    pageMargins: [40, 40, 40, 60],
    footer: makePdfFooter(params.userName),
  });
}
