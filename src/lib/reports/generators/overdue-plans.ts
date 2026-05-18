import ExcelJS from "exceljs";
import type { Content } from "pdfmake/interfaces";

import { prisma } from "../../db/prisma";
import { buildPdfBuffer, makePdfFooter, makeHeaderRow, PDF_STYLES, PDF_TABLE_LAYOUT } from "../pdf";
import {
  HEADER_ARGB,
  WHITE_ARGB,
  daysDiff,
  formatDate,
  getOwnerDept,
  getOwnershipFilter,
  getPrimaryOwner,
  type ReportParams,
} from "../templates";

async function fetchData(params: ReportParams) {
  const { to, entity, department, userId, userRole } = params;
  const ownership = getOwnershipFilter(userId, userRole);

  // Resolve entity id if provided
  let entityId: string | undefined;
  if (entity) {
    const entityRecord = await prisma.entities.findFirst({
      where: { code: entity },
      select: { id: true },
    });
    entityId = entityRecord?.id;
  }

  const plans = await prisma.action_plans.findMany({
    where: {
      is_deleted: false,
      status: { in: ["NotStarted", "InProgress", "PendingValidation"] },
      current_target_date: { lt: to },
      ...(entityId ? { action_plan_entities: { some: { entity_id: entityId } } } : {}),
      ...(department ? { department } : {}),
      ...ownership,
    },
    include: {
      finding: {
        select: {
          title: true,
          audit: { select: { name: true } },
        },
      },
      action_plan_owners: {
        select: {
          is_primary: true,
          user: { select: { name: true, department: true, team_l2: true } },
        },
      },
      action_plan_follow_up_auditors: {
        select: { user: { select: { name: true } } },
        take: 1,
      },
      action_plan_entities: {
        select: { entity: { select: { code: true } } },
        orderBy: { entity: { code: "asc" as const } },
      },
      _count: { select: { evidence: { where: { is_deleted: false } }, target_date_revisions: true } },
    },
    orderBy: { current_target_date: "asc" },
  });

  // Sort by days overdue descending
  return plans.sort(
    (a, b) => daysDiff(a.current_target_date!, to) - daysDiff(b.current_target_date!, to),
  );
}

export async function generateOverduePlansXlsx(params: ReportParams): Promise<Buffer> {
  const plans = await fetchData(params);
  const { to, entity, department } = params;

  const wb = new ExcelJS.Workbook();
  wb.creator = "IA Tracker";
  wb.created = new Date();
  const ws = wb.addWorksheet("Overdue Action Plans");

  function styleHeaderRow(row: ExcelJS.Row) {
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_ARGB } };
      cell.font = { bold: true, color: { argb: WHITE_ARGB } };
      cell.alignment = { vertical: "middle" };
    });
    row.height = 18;
  }

  ws.getCell("A1").value = `Overdue Action Plans — As of ${formatDate(to)}`;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A2").value = `Entity: ${entity ?? "All"}  |  Department: ${department ?? "All"}`;
  ws.getCell("A2").font = { color: { argb: "FF64748B" } };

  // Summary stats
  const totalOverdue = plans.length;
  const highOverdue = plans.filter((p) => p.priority === "High").length;
  const avgDays =
    totalOverdue > 0
      ? Math.round(plans.reduce((sum, p) => sum + daysDiff(p.current_target_date!, to), 0) / totalOverdue)
      : 0;

  ws.getCell("A3").value = `Total overdue: ${totalOverdue} action plans  |  High priority overdue: ${highOverdue}  |  Average days overdue: ${avgDays}`;
  ws.getCell("A3").font = { bold: true, color: { argb: "FFDC2626" } };

  const headerRow = ws.getRow(5);
  headerRow.values = [
    "AP Ref", "Description", "Audit", "Finding", "Owner", "Owner Department",
    "Priority", "Entity", "Original Target", "Current Target",
    "Days Overdue", "Reschedule Count", "Evidence Count", "Follow-up Auditor",
  ];
  styleHeaderRow(headerRow);

  for (const p of plans) {
    const owner = getPrimaryOwner(p.action_plan_owners);
    const entities = p.action_plan_entities.map((e) => e.entity.code).join(", ");
    const followUp = p.action_plan_follow_up_auditors[0]?.user.name ?? "";
    const daysOverdue = daysDiff(p.current_target_date!, to);
    const dataRow = ws.addRow([
      p.display_id,
      p.description.slice(0, 100),
      p.finding.audit?.name ?? "",
      p.finding.title,
      owner?.name ?? "Unassigned",
      getOwnerDept(owner),
      p.priority ?? "",
      entities,
      formatDate(p.original_target_date),
      formatDate(p.current_target_date),
      daysOverdue,
      p._count.target_date_revisions,
      p._count.evidence,
      followUp,
    ]);

    const daysCell = dataRow.getCell(11);
    const argb = daysOverdue > 90 ? "FFFEE2E2" : daysOverdue >= 30 ? "FFFEF3C7" : "FFFFF9C4";
    daysCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
  }

  ws.columns = [
    { width: 12 }, { width: 40 }, { width: 28 }, { width: 28 }, { width: 22 }, { width: 20 },
    { width: 12 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 22 },
  ];
  ws.views = [{ state: "frozen", ySplit: 5 }];

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function generateOverduePlansPdf(params: ReportParams): Promise<Buffer> {
  const plans = await fetchData(params);
  const { to, entity, department } = params;

  const totalOverdue = plans.length;
  const highOverdue = plans.filter((p) => p.priority === "High").length;
  const avgDays =
    totalOverdue > 0
      ? Math.round(plans.reduce((sum, p) => sum + daysDiff(p.current_target_date!, to), 0) / totalOverdue)
      : 0;

  const content: Content[] = [
    { text: "Overdue Action Plans", style: "reportTitle" },
    { text: `As of ${formatDate(to)}  |  Entity: ${entity ?? "All"}  |  Department: ${department ?? "All"}`, style: "reportSubtitle" },

    { text: "Summary", style: "sectionHeader" },
    {
      table: {
        headerRows: 1,
        widths: ["*", 80],
        body: [
          makeHeaderRow(["Metric", "Value"]),
          ["Total overdue action plans", totalOverdue.toString()],
          ["High priority overdue", highOverdue.toString()],
          ["Average days overdue", avgDays.toString()],
        ],
      },
      layout: PDF_TABLE_LAYOUT,
    },

    { text: "Overdue Action Plans", style: "sectionHeader" },
  ];

  if (plans.length === 0) {
    content.push({ text: "No overdue action plans found.", style: "small" });
  } else {
    content.push({
      table: {
        headerRows: 1,
        widths: [45, "*", 70, 45, 55, 60],
        body: [
          makeHeaderRow(["AP Ref", "Description", "Owner", "Priority", "Target Date", "Days Overdue"]),
          ...plans.slice(0, 50).map((p) => {
            const owner = getPrimaryOwner(p.action_plan_owners);
            const daysOverdue = daysDiff(p.current_target_date!, to);
            return [
              p.display_id,
              p.description.slice(0, 80),
              owner?.name ?? "Unassigned",
              p.priority ?? "",
              formatDate(p.current_target_date),
              {
                text: daysOverdue.toString(),
                fillColor: daysOverdue > 90 ? "#fee2e2" : daysOverdue >= 30 ? "#fef3c7" : "#fffde7",
              },
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
