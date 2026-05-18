import ExcelJS from "exceljs";
import type { Content } from "pdfmake/interfaces";

import { prisma } from "../../db/prisma";
import { buildPdfBuffer, makePdfFooter, makeHeaderRow, PDF_STYLES, PDF_TABLE_LAYOUT } from "../pdf";
import {
  HEADER_ARGB,
  WHITE_ARGB,
  GREEN_ARGB,
  AMBER_ARGB,
  RED_ARGB,
  daysDiff,
  formatDate,
  getOwnerDept,
  getOwnershipFilter,
  getPrimaryOwner,
  type ReportParams,
} from "../templates";

const ON_TIME_BUFFER_DAYS = 3;

function closureCategory(daysLate: number): "onTime" | "late" | "early" {
  if (daysLate <= ON_TIME_BUFFER_DAYS && daysLate >= -ON_TIME_BUFFER_DAYS) return "onTime";
  if (daysLate > ON_TIME_BUFFER_DAYS) return "late";
  return "early";
}

async function fetchData(params: ReportParams) {
  const { from, to, userId, userRole } = params;
  const ownership = getOwnershipFilter(userId, userRole);

  const plans = await prisma.action_plans.findMany({
    where: {
      is_deleted: false,
      closed_at: { gte: from, lte: to },
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
      action_plan_entities: {
        select: { entity: { select: { code: true } } },
        orderBy: { entity: { code: "asc" as const } },
      },
    },
    orderBy: { closed_at: "desc" },
  });

  return plans;
}

type PlanRow = Awaited<ReturnType<typeof fetchData>>[number];

function getDaysLate(plan: PlanRow): number {
  if (!plan.closed_at || !plan.original_target_date) return 0;
  return daysDiff(plan.original_target_date, plan.closed_at);
}

function getDaysToClose(plan: PlanRow): number {
  if (!plan.closed_at) return 0;
  return daysDiff(plan.created_at, plan.closed_at);
}

type CategoryStats = { closed: number; onTime: number; late: number; avgDaysLate: number };

function computeStats(planList: PlanRow[]): CategoryStats {
  const late = planList.filter((p) => closureCategory(getDaysLate(p)) === "late");
  const avgDaysLate = late.length > 0
    ? Math.round(late.reduce((sum, p) => sum + getDaysLate(p), 0) / late.length)
    : 0;
  return {
    closed: planList.length,
    onTime: planList.filter((p) => closureCategory(getDaysLate(p)) === "onTime").length,
    late: late.length,
    avgDaysLate,
  };
}

export async function generateClosureReportXlsx(params: ReportParams): Promise<Buffer> {
  const plans = await fetchData(params);
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
  ws1.getCell("A1").value = `Closure Report — ${formatDate(from)} to ${formatDate(to)}`;
  ws1.getCell("A1").font = { bold: true, size: 14 };

  const overall = computeStats(plans);
  const avgDaysToClose =
    plans.length > 0
      ? Math.round(plans.reduce((sum, p) => sum + getDaysToClose(p), 0) / plans.length)
      : 0;

  const metricH = ws1.getRow(3);
  metricH.values = ["", "Metric", "Value"];
  styleHeaderRow(metricH);

  let row = 4;
  const totalStr = (n: number, d: number) =>
    d > 0 ? `${n} (${Math.round((n / d) * 100)}%)` : `${n}`;

  ws1.getRow(row++).values = ["", "Total closed in period", overall.closed];
  ws1.getRow(row++).values = ["", "Closed on time (±3 days of target)", totalStr(overall.onTime, overall.closed)];
  ws1.getRow(row++).values = ["", "Closed late", totalStr(overall.late, overall.closed)];
  ws1.getRow(row++).values = [
    "",
    "Closed early",
    totalStr(plans.filter((p) => closureCategory(getDaysLate(p)) === "early").length, overall.closed),
  ];
  ws1.getRow(row++).values = ["", "Average days to close (from creation)", avgDaysToClose];
  ws1.getRow(row++).values = ["", "Average days late (late closures only)", overall.avgDaysLate];
  row++;

  // By entity
  const entityStats = new Map<string, PlanRow[]>();
  for (const p of plans) {
    const codes = p.action_plan_entities.map((e) => e.entity.code);
    const targets = codes.length > 0 ? codes : ["(No Entity)"];
    for (const code of targets) {
      if (!entityStats.has(code)) entityStats.set(code, []);
      entityStats.get(code)!.push(p);
    }
  }
  ws1.getCell(`A${row}`).value = "By Entity";
  ws1.getCell(`A${row}`).font = { bold: true };
  row++;
  const entityH = ws1.getRow(row);
  entityH.values = ["", "Entity", "Closed", "On Time", "Late", "Avg Days Late"];
  styleHeaderRow(entityH);
  row++;
  for (const [code, list] of [...entityStats.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const s = computeStats(list);
    ws1.getRow(row++).values = ["", code, s.closed, s.onTime, s.late, s.avgDaysLate];
  }
  row++;

  // By priority
  ws1.getCell(`A${row}`).value = "By Priority";
  ws1.getCell(`A${row}`).font = { bold: true };
  row++;
  const prioH = ws1.getRow(row);
  prioH.values = ["", "Priority", "Closed", "On Time", "Late", "Avg Days Late"];
  styleHeaderRow(prioH);
  row++;
  for (const prio of ["High", "Moderate", "Low"]) {
    const s = computeStats(plans.filter((p) => p.priority === prio));
    ws1.getRow(row++).values = ["", prio, s.closed, s.onTime, s.late, s.avgDaysLate];
  }
  row++;

  // By department
  const deptStats = new Map<string, PlanRow[]>();
  for (const p of plans) {
    const owner = getPrimaryOwner(p.action_plan_owners);
    const dept = getOwnerDept(owner) || "(No Department)";
    if (!deptStats.has(dept)) deptStats.set(dept, []);
    deptStats.get(dept)!.push(p);
  }
  ws1.getCell(`A${row}`).value = "By Department";
  ws1.getCell(`A${row}`).font = { bold: true };
  row++;
  const deptH = ws1.getRow(row);
  deptH.values = ["", "Department", "Closed", "On Time", "Late", "Avg Days Late"];
  styleHeaderRow(deptH);
  row++;
  for (const [dept, list] of [...deptStats.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const s = computeStats(list);
    ws1.getRow(row++).values = ["", dept, s.closed, s.onTime, s.late, s.avgDaysLate];
  }

  ws1.columns = [{ width: 2 }, { width: 38 }, { width: 18 }, { width: 14 }, { width: 14 }, { width: 16 }];

  // ── Sheet 2: Closed Action Plans ─────────────────────────────────────
  const ws2 = wb.addWorksheet("Closed Action Plans");
  const headerRow = ws2.getRow(1);
  headerRow.values = [
    "AP Ref", "Description", "Audit", "Owner", "Priority", "Entity",
    "Original Target", "Closed At", "Days to Close", "Days Late/Early", "Closure Remarks",
  ];
  styleHeaderRow(headerRow);

  for (const p of plans) {
    const owner = getPrimaryOwner(p.action_plan_owners);
    const entities = p.action_plan_entities.map((e) => e.entity.code).join(", ");
    const daysLate = getDaysLate(p);
    const cat = closureCategory(daysLate);
    const dataRow = ws2.addRow([
      p.display_id,
      p.description.slice(0, 100),
      p.finding.audit?.name ?? "",
      owner?.name ?? "Unassigned",
      p.priority ?? "",
      entities,
      formatDate(p.original_target_date),
      formatDate(p.closed_at),
      getDaysToClose(p),
      daysLate,
      p.closure_remarks?.slice(0, 100) ?? "",
    ]);
    const lateCell = dataRow.getCell(10);
    const argb = cat === "onTime" ? GREEN_ARGB : cat === "late" ? AMBER_ARGB : "FFDBEAFE";
    lateCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
  }

  ws2.columns = [
    { width: 12 }, { width: 40 }, { width: 28 }, { width: 22 }, { width: 12 }, { width: 14 },
    { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 30 },
  ];
  ws2.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function generateClosureReportPdf(params: ReportParams): Promise<Buffer> {
  const plans = await fetchData(params);
  const { from, to } = params;

  const overall = computeStats(plans);
  const avgDaysToClose =
    plans.length > 0
      ? Math.round(plans.reduce((sum, p) => sum + getDaysToClose(p), 0) / plans.length)
      : 0;

  const earlyCount = plans.filter((p) => closureCategory(getDaysLate(p)) === "early").length;
  const totalStr = (n: number, d: number) =>
    d > 0 ? `${n} (${Math.round((n / d) * 100)}%)` : `${n}`;

  // By entity
  const entityStats = new Map<string, PlanRow[]>();
  for (const p of plans) {
    const codes = p.action_plan_entities.map((e) => e.entity.code);
    const targets = codes.length > 0 ? codes : ["(No Entity)"];
    for (const code of targets) {
      if (!entityStats.has(code)) entityStats.set(code, []);
      entityStats.get(code)!.push(p);
    }
  }

  const content: Content[] = [
    { text: "Closure Report", style: "reportTitle" },
    { text: `Period: ${formatDate(from)} – ${formatDate(to)}`, style: "reportSubtitle" },

    { text: "Summary", style: "sectionHeader" },
    {
      table: {
        headerRows: 1,
        widths: ["*", 100],
        body: [
          makeHeaderRow(["Metric", "Value"]),
          ["Total closed in period", overall.closed.toString()],
          ["Closed on time (±3 days)", totalStr(overall.onTime, overall.closed)],
          ["Closed late", totalStr(overall.late, overall.closed)],
          ["Closed early", totalStr(earlyCount, overall.closed)],
          ["Avg days to close (from creation)", avgDaysToClose.toString()],
          ["Avg days late (late closures only)", overall.avgDaysLate.toString()],
        ],
      },
      layout: PDF_TABLE_LAYOUT,
    },

    { text: "By Entity", style: "sectionHeader" },
    {
      table: {
        headerRows: 1,
        widths: ["*", 60, 60, 60, 80],
        body: [
          makeHeaderRow(["Entity", "Closed", "On Time", "Late", "Avg Days Late"]),
          ...[...entityStats.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([code, list]) => {
              const s = computeStats(list);
              return [code, s.closed.toString(), s.onTime.toString(), s.late.toString(), s.avgDaysLate.toString()];
            }),
        ],
      },
      layout: PDF_TABLE_LAYOUT,
    },

    { text: "Closed Action Plans", style: "sectionHeader" },
  ];

  if (plans.length === 0) {
    content.push({ text: "No action plans closed in the selected period.", style: "small" });
  } else {
    content.push({
      table: {
        headerRows: 1,
        widths: [45, "*", 70, 45, 55, 55],
        body: [
          makeHeaderRow(["AP Ref", "Description", "Owner", "Priority", "Target Date", "Closed At"]),
          ...plans.slice(0, 50).map((p) => {
            const owner = getPrimaryOwner(p.action_plan_owners);
            return [
              p.display_id,
              p.description.slice(0, 80),
              owner?.name ?? "Unassigned",
              p.priority ?? "",
              formatDate(p.original_target_date),
              formatDate(p.closed_at),
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
