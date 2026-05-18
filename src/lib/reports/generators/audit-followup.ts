import ExcelJS from "exceljs";
import type { Content } from "pdfmake/interfaces";

import { AUDIT_TYPE_LABELS } from "../../constants";
import { prisma } from "../../db/prisma";
import { buildPdfBuffer, makePdfFooter, makeHeaderRow, PDF_STYLES, PDF_TABLE_LAYOUT } from "../pdf";
import {
  CLOSED_STATUSES_SET,
  HEADER_ARGB,
  WHITE_ARGB,
  STATUS_LABELS,
  formatDate,
  getOwnershipFilter,
  getPrimaryOwner,
  type ReportParams,
} from "../templates";

async function fetchData(params: ReportParams) {
  const { audit, from, to, userId, userRole } = params;
  const ownership = getOwnershipFilter(userId, userRole);

  const auditRecord = await prisma.audits.findFirst({
    where: { id: audit, is_deleted: false },
    select: {
      id: true,
      name: true,
      audit_type: true,
      report_issue_date: true,
      audit_entities: {
        select: { entity: { select: { code: true } } },
        orderBy: { entity: { code: "asc" as const } },
      },
    },
  });

  if (!auditRecord) return { findings: [], auditRecord: null };

  const findings = await prisma.findings.findMany({
    where: { audit_id: audit, is_deleted: false },
    select: {
      id: true,
      title: true,
      action_plans: {
        where: { is_deleted: false, ...ownership },
        include: {
          action_plan_owners: {
            select: {
              is_primary: true,
              user: { select: { name: true, department: true, team_l2: true } },
            },
          },
          _count: {
            select: { evidence: { where: { is_deleted: false } }, target_date_revisions: true },
          },
        },
        orderBy: { created_at: "asc" as const },
      },
    },
    orderBy: { display_order: "asc" as const },
  });

  // Count evidence uploaded during period
  const evidenceInPeriod = await prisma.evidence.count({
    where: {
      is_deleted: false,
      created_at: { gte: from, lte: to },
      action_plan: {
        is_deleted: false,
        finding: { audit_id: audit },
      },
    },
  });

  // Count rescheduled during period
  const rescheduledInPeriod = await prisma.target_date_revisions.count({
    where: {
      revised_at: { gte: from, lte: to },
      action_plan: { is_deleted: false, finding: { audit_id: audit } },
    },
  });

  return { findings, auditRecord, evidenceInPeriod, rescheduledInPeriod };
}

export async function generateAuditFollowupXlsx(params: ReportParams): Promise<Buffer> {
  const { findings, auditRecord, evidenceInPeriod, rescheduledInPeriod } = await fetchData(params);
  const { from, to } = params;

  if (!auditRecord) {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Error").getCell("A1").value = "Audit not found.";
    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

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

  const allPlans = findings.flatMap((f) => f.action_plans);
  const closedPlans = allPlans.filter((p) => CLOSED_STATUSES_SET.has(p.status));
  const totalPlans = allPlans.length;
  const pctClosed = totalPlans > 0 ? Math.round((closedPlans.length / totalPlans) * 100) : 0;

  // ── Sheet 1: Summary ────────────────────────────────────────────────
  const ws1 = wb.addWorksheet("Summary");
  const entityCodes = auditRecord.audit_entities.map((e) => e.entity.code).join(", ");

  ws1.getCell("A1").value = `Audit Follow-up Report — ${auditRecord.name}`;
  ws1.getCell("A1").font = { bold: true, size: 14 };
  ws1.getCell("A2").value = `Period: ${formatDate(from)} to ${formatDate(to)}`;
  ws1.getCell("A2").font = { color: { argb: "FF64748B" } };
  ws1.getCell("A3").value = `Audit Type: ${AUDIT_TYPE_LABELS[auditRecord.audit_type]}`;
  ws1.getCell("A4").value = `Report Issue Date: ${formatDate(auditRecord.report_issue_date)}`;
  ws1.getCell("A5").value = `Entities: ${entityCodes}`;
  ws1.getCell("A6").value = `Progress: ${closedPlans.length} of ${totalPlans} action plans closed (${pctClosed}%)`;
  ws1.getCell("A6").font = { bold: true };

  const metricH = ws1.getRow(8);
  metricH.values = ["", "Metric", "Count"];
  styleHeaderRow(metricH);

  const overdue = allPlans.filter(
    (p) => !CLOSED_STATUSES_SET.has(p.status) && p.current_target_date != null && p.current_target_date < to,
  ).length;

  let row = 9;
  const metrics: [string, number][] = [
    ["Total findings", findings.length],
    ["Total action plans", totalPlans],
    ["Closed", closedPlans.length],
    ["In Progress", allPlans.filter((p) => p.status === "InProgress").length],
    ["Not Started", allPlans.filter((p) => p.status === "NotStarted").length],
    ["Overdue", overdue],
    ["Rescheduled during period", rescheduledInPeriod ?? 0],
    ["Evidence uploaded during period", evidenceInPeriod ?? 0],
  ];
  for (const [metric, count] of metrics) {
    ws1.getRow(row++).values = ["", metric, count];
  }

  ws1.columns = [{ width: 2 }, { width: 36 }, { width: 14 }];

  // ── Sheet 2: Action Plans ────────────────────────────────────────────
  const ws2 = wb.addWorksheet("Action Plans");
  let ws2Row = 1;

  if (allPlans.length === 0) {
    ws2.getCell("A1").value = "No action plans for this audit.";
  } else {
    for (const finding of findings) {
      if (finding.action_plans.length === 0) continue;

      const findingRow = ws2.getRow(ws2Row++);
      findingRow.getCell(1).value = `Finding: ${finding.title}`;
      findingRow.getCell(1).font = { bold: true, size: 11 };
      findingRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };

      const headerRow = ws2.getRow(ws2Row++);
      headerRow.values = [
        "AP Ref", "Description", "Owner", "Status", "Priority",
        "Target Date", "Closed At", "Reschedule Count", "Evidence Count", "Closure Remarks",
      ];
      styleHeaderRow(headerRow);

      for (const p of finding.action_plans) {
        const owner = getPrimaryOwner(p.action_plan_owners);
        ws2.getRow(ws2Row++).values = [
          p.display_id,
          p.description.slice(0, 100),
          owner?.name ?? "Unassigned",
          STATUS_LABELS[p.status],
          p.priority ?? "",
          formatDate(p.current_target_date),
          formatDate(p.closed_at),
          p._count.target_date_revisions,
          p._count.evidence,
          p.closure_remarks?.slice(0, 100) ?? "",
        ];
      }
      ws2Row++;
    }
  }

  ws2.columns = [
    { width: 12 }, { width: 40 }, { width: 22 }, { width: 20 }, { width: 12 },
    { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 30 },
  ];

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function generateAuditFollowupPdf(params: ReportParams): Promise<Buffer> {
  const { findings, auditRecord, evidenceInPeriod, rescheduledInPeriod } = await fetchData(params);
  const { from, to } = params;

  if (!auditRecord) {
    return buildPdfBuffer({
      content: [{ text: "Audit not found.", style: "reportTitle" }],
      styles: PDF_STYLES,
      defaultStyle: { font: "Roboto", fontSize: 9 },
    });
  }

  const allPlans = findings.flatMap((f) => f.action_plans);
  const closedPlans = allPlans.filter((p) => CLOSED_STATUSES_SET.has(p.status));
  const totalPlans = allPlans.length;
  const pctClosed = totalPlans > 0 ? Math.round((closedPlans.length / totalPlans) * 100) : 0;
  const entityCodes = auditRecord.audit_entities.map((e) => e.entity.code).join(", ");

  const overdue = allPlans.filter(
    (p) => !CLOSED_STATUSES_SET.has(p.status) && p.current_target_date != null && p.current_target_date < to,
  ).length;

  const content: Content[] = [
    { text: `Audit Follow-up: ${auditRecord.name}`, style: "reportTitle" },
    {
      text: `Type: ${AUDIT_TYPE_LABELS[auditRecord.audit_type]}  |  Entities: ${entityCodes}  |  Period: ${formatDate(from)} – ${formatDate(to)}`,
      style: "reportSubtitle",
    },

    { text: "Progress Summary", style: "sectionHeader" },
    {
      table: {
        headerRows: 1,
        widths: ["*", 80],
        body: [
          makeHeaderRow(["Metric", "Count"]),
          ["Total findings", findings.length.toString()],
          ["Total action plans", totalPlans.toString()],
          [{ text: `Closed (${pctClosed}%)`, bold: true }, { text: closedPlans.length.toString(), bold: true }],
          ["In Progress", allPlans.filter((p) => p.status === "InProgress").length.toString()],
          ["Not Started", allPlans.filter((p) => p.status === "NotStarted").length.toString()],
          ["Overdue", overdue.toString()],
          ["Rescheduled during period", (rescheduledInPeriod ?? 0).toString()],
          ["Evidence uploaded during period", (evidenceInPeriod ?? 0).toString()],
        ],
      },
      layout: PDF_TABLE_LAYOUT,
    },
  ];

  for (const finding of findings) {
    if (finding.action_plans.length === 0) continue;
    content.push({ text: `Finding: ${finding.title}`, style: "sectionHeader" });
    content.push({
      table: {
        headerRows: 1,
        widths: [45, "*", 70, 55, 45, 55],
        body: [
          makeHeaderRow(["AP Ref", "Description", "Owner", "Status", "Priority", "Target Date"]),
          ...finding.action_plans.map((p) => {
            const owner = getPrimaryOwner(p.action_plan_owners);
            return [
              p.display_id,
              p.description.slice(0, 80),
              owner?.name ?? "Unassigned",
              STATUS_LABELS[p.status],
              p.priority ?? "",
              formatDate(p.current_target_date),
            ];
          }),
        ],
      },
      layout: PDF_TABLE_LAYOUT,
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
