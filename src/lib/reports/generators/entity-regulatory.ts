import ExcelJS from "exceljs";
import type { Content } from "pdfmake/interfaces";

import { prisma } from "../../db/prisma";
import { buildPdfBuffer, makePdfFooter, makeHeaderRow, PDF_STYLES, PDF_TABLE_LAYOUT } from "../pdf";
import {
  CLOSED_STATUSES_SET,
  HEADER_ARGB,
  WHITE_ARGB,
  STATUS_LABELS,
  formatDate,
  getOwnerDept,
  getOwnershipFilter,
  getPrimaryOwner,
  type ReportParams,
} from "../templates";

async function fetchData(params: ReportParams) {
  const { from, to, entity, userId, userRole } = params;
  const ownership = getOwnershipFilter(userId, userRole);

  const entityRecord = await prisma.entities.findFirst({
    where: { code: entity },
    select: { id: true, code: true, full_name: true },
  });

  if (!entityRecord) return { plans: [], entityName: entity ?? "Unknown" };

  const plans = await prisma.action_plans.findMany({
    where: {
      is_deleted: false,
      created_at: { lte: to },
      OR: [
        { status: { in: ["NotStarted", "InProgress", "PendingValidation"] } },
        { closed_at: { gte: from } },
      ],
      action_plan_entities: { some: { entity_id: entityRecord.id } },
      ...ownership,
    },
    include: {
      finding: {
        select: {
          title: true,
          audit: { select: { id: true, name: true, audit_type: true } },
        },
      },
      action_plan_owners: {
        select: {
          is_primary: true,
          user: { select: { name: true, department: true, team_l2: true } },
        },
      },
      action_plan_entities: {
        select: { entity: { select: { code: true } } },
        orderBy: { entity: { code: "asc" as const } },
      },
      _count: { select: { evidence: { where: { is_deleted: false } } } },
    },
    orderBy: [{ finding: { audit: { name: "asc" as const } } }, { created_at: "asc" as const }],
  });

  return { plans, entityName: entityRecord.full_name, entityCode: entityRecord.code };
}

type PlanRow = Awaited<ReturnType<typeof fetchData>>["plans"][number];

function isOpen(plan: PlanRow) {
  return !CLOSED_STATUSES_SET.has(plan.status);
}

export async function generateEntityRegulatoryXlsx(params: ReportParams): Promise<Buffer> {
  const { plans, entityName, entityCode } = await fetchData(params);
  const { from, to } = params;

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

  // ── Sheet 1: Summary ────────────────────────────────────────────────
  const ws1 = wb.addWorksheet("Summary");
  ws1.getCell("A1").value = `Regulatory Report — ${entityName} (${entityCode})`;
  ws1.getCell("A1").font = { bold: true, size: 14 };
  ws1.getCell("A2").value = `Period: ${formatDate(from)} to ${formatDate(to)}`;
  ws1.getCell("A2").font = { color: { argb: "FF64748B" } };

  const statusCounts: Record<string, number> = {};
  for (const p of plans) statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1;

  ws1.getCell("A4").value = "Status at Period End";
  ws1.getCell("A4").font = { bold: true };
  const statusH = ws1.getRow(5);
  statusH.values = ["", "Status", "Count"];
  styleHeaderRow(statusH);
  let row = 6;
  for (const [status, label] of Object.entries(STATUS_LABELS)) {
    ws1.getRow(row++).values = ["", label, statusCounts[status] ?? 0];
  }
  row++;

  const closedInPeriod = plans.filter((p) => p.closed_at && p.closed_at >= from && p.closed_at <= to).length;
  const stillOpen = plans.filter(isOpen).length;
  const overdueAtEnd = plans.filter(
    (p) => isOpen(p) && p.current_target_date != null && p.current_target_date < to,
  ).length;
  const createdInPeriod = plans.filter((p) => p.created_at >= from && p.created_at <= to).length;

  ws1.getCell(`A${row}`).value = "Period Activity";
  ws1.getCell(`A${row}`).font = { bold: true };
  row++;
  const actH = ws1.getRow(row);
  actH.values = ["", "Metric", "Count"];
  styleHeaderRow(actH);
  row++;
  ws1.getRow(row++).values = ["", "Closed during period", closedInPeriod];
  ws1.getRow(row++).values = ["", "Still open at period end", stillOpen];
  ws1.getRow(row++).values = ["", "Overdue at period end", overdueAtEnd];
  ws1.getRow(row++).values = ["", "New plans created", createdInPeriod];

  ws1.columns = [{ width: 2 }, { width: 36 }, { width: 14 }];

  // ── Sheet 2: Action Plans ────────────────────────────────────────────
  const ws2 = wb.addWorksheet("Action Plans");

  // Group by audit
  const auditGroups = new Map<string, { auditName: string; plans: PlanRow[] }>();
  for (const p of plans) {
    const auditId = p.finding.audit?.id ?? "standalone";
    const auditName = p.finding.audit?.name ?? "Standalone";
    if (!auditGroups.has(auditId)) auditGroups.set(auditId, { auditName, plans: [] });
    auditGroups.get(auditId)!.plans.push(p);
  }

  const cols = ["AP Ref", "Finding", "Description", "Owner", "Status", "Priority", "Target Date", "Closed At", "Closure Remarks", "Evidence Count"];
  let ws2Row = 1;

  if (plans.length === 0) {
    ws2.getCell("A1").value = "No data for the selected period.";
  } else {
    for (const [, group] of auditGroups) {
      // Audit name header
      const auditNameRow = ws2.getRow(ws2Row++);
      auditNameRow.getCell(1).value = group.auditName;
      auditNameRow.getCell(1).font = { bold: true, size: 12 };
      auditNameRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };

      const headerRow = ws2.getRow(ws2Row++);
      headerRow.values = cols;
      styleHeaderRow(headerRow);

      for (const p of group.plans) {
        const owner = getPrimaryOwner(p.action_plan_owners);
        ws2.getRow(ws2Row++).values = [
          p.display_id,
          p.finding.title,
          p.description.slice(0, 100),
          owner?.name ?? "Unassigned",
          STATUS_LABELS[p.status],
          p.priority ?? "",
          formatDate(p.current_target_date),
          formatDate(p.closed_at),
          p.closure_remarks?.slice(0, 100) ?? "",
          p._count.evidence,
        ];
      }
      ws2Row++;
    }
  }

  ws2.columns = [
    { width: 12 }, { width: 28 }, { width: 40 }, { width: 22 }, { width: 20 },
    { width: 12 }, { width: 14 }, { width: 14 }, { width: 30 }, { width: 14 },
  ];

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function generateEntityRegulatoryPdf(params: ReportParams): Promise<Buffer> {
  const { plans, entityName, entityCode } = await fetchData(params);
  const { from, to } = params;

  const auditGroups = new Map<string, { auditName: string; plans: PlanRow[] }>();
  for (const p of plans) {
    const auditId = p.finding.audit?.id ?? "standalone";
    const auditName = p.finding.audit?.name ?? "Standalone";
    if (!auditGroups.has(auditId)) auditGroups.set(auditId, { auditName, plans: [] });
    auditGroups.get(auditId)!.plans.push(p);
  }

  const statusCounts: Record<string, number> = {};
  for (const p of plans) statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1;

  const content: Content[] = [
    { text: `${entityName} — Regulatory Audit Report`, style: "reportTitle" },
    { text: `Entity: ${entityCode}  |  Period: ${formatDate(from)} – ${formatDate(to)}`, style: "reportSubtitle" },

    { text: "Status Summary", style: "sectionHeader" },
    {
      table: {
        headerRows: 1,
        widths: ["*", 80],
        body: [
          makeHeaderRow(["Status", "Count"]),
          ...Object.entries(STATUS_LABELS).map(([s, l]) => [l, (statusCounts[s] ?? 0).toString()]),
        ],
      },
      layout: PDF_TABLE_LAYOUT,
    },
  ];

  if (plans.length === 0) {
    content.push({ text: "No action plans found for the selected period.", style: "small", margin: [0, 16, 0, 0] });
  } else {
    for (const [, group] of auditGroups) {
      content.push({ text: group.auditName, style: "sectionHeader" });
      content.push({
        table: {
          headerRows: 1,
          widths: [50, 60, "*", 70, 55, 55],
          body: [
            makeHeaderRow(["AP Ref", "Finding", "Description", "Owner", "Status", "Target Date"]),
            ...group.plans.map((p) => {
              const owner = getPrimaryOwner(p.action_plan_owners);
              return [
                p.display_id,
                p.finding.title.slice(0, 40),
                p.description.slice(0, 80),
                owner?.name ?? "Unassigned",
                STATUS_LABELS[p.status],
                formatDate(p.current_target_date),
              ];
            }),
          ],
        },
        layout: PDF_TABLE_LAYOUT,
      } as Content);
    }
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
