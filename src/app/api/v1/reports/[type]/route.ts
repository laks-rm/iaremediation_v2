import { NextRequest, NextResponse } from "next/server";

import { AuthError, requireRole } from "../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../lib/db/prisma";
import { writeAuditLog } from "../../../../../lib/audit-log/writeAuditLog";
import type { ReportFormat, ReportParams, ReportType } from "../../../../../lib/reports/templates";

const VALID_TYPES = new Set<ReportType>([
  "portfolio-status",
  "entity-regulatory",
  "audit-followup",
  "overdue-plans",
  "closure-report",
  "owner-workload",
]);

const VALID_FORMATS = new Set<ReportFormat>(["xlsx", "pdf"]);

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PDF_CONTENT_TYPE = "application/pdf";

const REPORT_NAMES: Record<ReportType, string> = {
  "portfolio-status": "Portfolio Status Summary",
  "entity-regulatory": "Entity Regulatory Report",
  "audit-followup": "Audit Follow-up Report",
  "overdue-plans": "Overdue Action Plans",
  "closure-report": "Closure Report",
  "owner-workload": "Owner Workload Report",
};

function computePeriodLabel(from: Date, to: Date): string {
  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en", opts).format(d);

  const sameYear = from.getUTCFullYear() === to.getUTCFullYear();
  const sameMonth = sameYear && from.getUTCMonth() === to.getUTCMonth();

  if (sameMonth) {
    return fmt(from, { month: "short", year: "numeric" });
  }
  if (sameYear) {
    return `${fmt(from, { month: "short" })} – ${fmt(to, { month: "short", year: "numeric" })}`;
  }
  return `${fmt(from, { month: "short", year: "numeric" })} – ${fmt(to, { month: "short", year: "numeric" })}`;
}

function isoToDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function buildFilename(type: ReportType, params: ReportParams): string {
  const from = params.from.toISOString().slice(0, 10);
  const to = params.to.toISOString().slice(0, 10);
  const ext = params.format;

  switch (type) {
    case "portfolio-status":
      return `Portfolio_Status_Summary_${to}.${ext}`;
    case "entity-regulatory":
      return `${params.entity ?? "Entity"}_Regulatory_Report_${from}_${to}.${ext}`;
    case "audit-followup":
      return `Audit_Followup_${from}_${to}.${ext}`;
    case "overdue-plans":
      return `Overdue_Action_Plans_${to}.${ext}`;
    case "closure-report":
      return `Closure_Report_${from}_${to}.${ext}`;
    case "owner-workload":
      return `Owner_Workload_${to}.${ext}`;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> },
) {
  try {
    const currentUser = await requireRole(["AuditTeam", "Viewer", "Auditee"]);

    const { type: rawType } = await params;
    const searchParams = request.nextUrl.searchParams;

    if (!VALID_TYPES.has(rawType as ReportType)) {
      return NextResponse.json({ error: "Invalid report type" }, { status: 400 });
    }

    const reportType = rawType as ReportType;
    const format = searchParams.get("format");

    if (!format || !VALID_FORMATS.has(format as ReportFormat)) {
      return NextResponse.json({ error: "Invalid or missing format. Use 'xlsx' or 'pdf'" }, { status: 400 });
    }

    const fromDate = isoToDate(searchParams.get("from"));
    const toDate = isoToDate(searchParams.get("to"));

    if (!fromDate || !toDate) {
      return NextResponse.json({ error: "Missing or invalid 'from'/'to' date parameters" }, { status: 400 });
    }

    if (fromDate > toDate) {
      return NextResponse.json({ error: "'from' must be before 'to'" }, { status: 400 });
    }

    // End of day for 'to'
    const toEod = new Date(toDate);
    toEod.setUTCHours(23, 59, 59, 999);

    const reportParams: ReportParams = {
      from: fromDate,
      to: toEod,
      format: format as ReportFormat,
      entity: searchParams.get("entity") ?? undefined,
      audit: searchParams.get("audit") ?? undefined,
      department: searchParams.get("department") ?? undefined,
      userId: currentUser.id,
      userName: currentUser.name,
      userRole: currentUser.role,
    };

    // Validate required params per report type
    if (reportType === "entity-regulatory" && !reportParams.entity) {
      return NextResponse.json({ error: "entity parameter is required for this report" }, { status: 400 });
    }
    if (reportType === "audit-followup" && !reportParams.audit) {
      return NextResponse.json({ error: "audit parameter is required for this report" }, { status: 400 });
    }

    let buffer: Buffer;

    if (format === "xlsx") {
      switch (reportType) {
        case "portfolio-status": {
          const { generatePortfolioStatusXlsx } = await import("../../../../../lib/reports/generators/portfolio-status");
          buffer = await generatePortfolioStatusXlsx(reportParams);
          break;
        }
        case "entity-regulatory": {
          const { generateEntityRegulatoryXlsx } = await import("../../../../../lib/reports/generators/entity-regulatory");
          buffer = await generateEntityRegulatoryXlsx(reportParams);
          break;
        }
        case "audit-followup": {
          const { generateAuditFollowupXlsx } = await import("../../../../../lib/reports/generators/audit-followup");
          buffer = await generateAuditFollowupXlsx(reportParams);
          break;
        }
        case "overdue-plans": {
          const { generateOverduePlansXlsx } = await import("../../../../../lib/reports/generators/overdue-plans");
          buffer = await generateOverduePlansXlsx(reportParams);
          break;
        }
        case "closure-report": {
          const { generateClosureReportXlsx } = await import("../../../../../lib/reports/generators/closure-report");
          buffer = await generateClosureReportXlsx(reportParams);
          break;
        }
        case "owner-workload": {
          const { generateOwnerWorkloadXlsx } = await import("../../../../../lib/reports/generators/owner-workload");
          buffer = await generateOwnerWorkloadXlsx(reportParams);
          break;
        }
      }
    } else {
      switch (reportType) {
        case "portfolio-status": {
          const { generatePortfolioStatusPdf } = await import("../../../../../lib/reports/generators/portfolio-status");
          buffer = await generatePortfolioStatusPdf(reportParams);
          break;
        }
        case "entity-regulatory": {
          const { generateEntityRegulatoryPdf } = await import("../../../../../lib/reports/generators/entity-regulatory");
          buffer = await generateEntityRegulatoryPdf(reportParams);
          break;
        }
        case "audit-followup": {
          const { generateAuditFollowupPdf } = await import("../../../../../lib/reports/generators/audit-followup");
          buffer = await generateAuditFollowupPdf(reportParams);
          break;
        }
        case "overdue-plans": {
          const { generateOverduePlansPdf } = await import("../../../../../lib/reports/generators/overdue-plans");
          buffer = await generateOverduePlansPdf(reportParams);
          break;
        }
        case "closure-report": {
          const { generateClosureReportPdf } = await import("../../../../../lib/reports/generators/closure-report");
          buffer = await generateClosureReportPdf(reportParams);
          break;
        }
        case "owner-workload": {
          const { generateOwnerWorkloadPdf } = await import("../../../../../lib/reports/generators/owner-workload");
          buffer = await generateOwnerWorkloadPdf(reportParams);
          break;
        }
      }
    }

    const contentType = format === "xlsx" ? XLSX_CONTENT_TYPE : PDF_CONTENT_TYPE;
    const filename = buildFilename(reportType, reportParams);

    // Fire-and-forget: write audit log after report is ready, without delaying the response
    void (async () => {
      try {
        const parameters: Record<string, string> = {
          from: fromDate!.toISOString().slice(0, 10),
          to: toDate!.toISOString().slice(0, 10),
        };
        if (reportParams.entity) parameters.entity = reportParams.entity;
        if (reportParams.department) parameters.department = reportParams.department;
        if (reportParams.audit) {
          parameters.audit_id = reportParams.audit;
          const auditRow = await prisma.audits.findUnique({
            where: { id: reportParams.audit },
            select: { name: true },
          });
          if (auditRow?.name) parameters.audit_name = auditRow.name;
        }

        await writeAuditLog({
          userId: currentUser.id,
          action: "Create",
          entityType: "Report",
          entityId: null,
          beforeJson: null,
          afterJson: {
            report_type: reportType,
            report_name: REPORT_NAMES[reportType],
            format: format as ReportFormat,
            period_label: computePeriodLabel(fromDate!, toDate!),
            parameters,
            filename,
          },
          ipAddress:
            request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
            request.headers.get("x-real-ip") ??
            null,
          userAgent: request.headers.get("user-agent") ?? null,
        });
      } catch (logErr) {
        console.error("[Reports] Audit log write failed:", logErr);
      }
    })();

    return new NextResponse(new Uint8Array(buffer!), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": buffer!.byteLength.toString(),
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[Reports API] Error generating report:", error);
    return NextResponse.json({ error: "Report generation failed" }, { status: 500 });
  }
}
