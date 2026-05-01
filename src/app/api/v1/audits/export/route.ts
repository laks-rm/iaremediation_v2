import { AuditOpinionRating, AuditType, Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../lib/auth/getCurrentUser";
import { AUDIT_TYPE_LABELS } from "../../../../../lib/constants";
import { prisma } from "../../../../../lib/db/prisma";
import {
  buildXlsxResponse,
  createExportWorksheet,
  formatExportDate,
  getUtcDateString,
} from "../../../../../lib/export/xlsx";

const EXPORT_ROW_CAP = 10_000;
const EXPORT_WARNING = "Export capped at 10,000 rows. Apply filters to narrow the result.";
const AUDIT_TYPES: AuditType[] = [
  "IT",
  "RegulatoryIT",
  "Operations",
  "RegulatoryOperations",
  "External",
];
const OPINION_RATINGS: AuditOpinionRating[] = [
  "Satisfactory",
  "NeedsImprovement",
  "Unsatisfactory",
];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AuditExportFilter = {
  search: string;
  auditType: AuditType | null;
  entityId: string | null;
  opinionRating: AuditOpinionRating | null;
  year: number | null;
};

const columns = [
  "Reference Number",
  "Audit Name",
  "Audit Type",
  "Opinion Rating",
  "Report Issue Date",
  "Entities",
  "Finding Count",
  "Action Plan Count",
];

function parseFilters(searchParams: URLSearchParams): AuditExportFilter {
  const auditType = searchParams.get("audit_type")?.trim() ?? "";
  const entityId = searchParams.get("entity_id")?.trim() ?? "";
  const opinionRating = searchParams.get("opinion_rating")?.trim() ?? "";
  const year = searchParams.get("year")?.trim() ?? "";

  return {
    search: (searchParams.get("search")?.trim() ?? "").slice(0, 200),
    auditType: AUDIT_TYPES.includes(auditType as AuditType) ? (auditType as AuditType) : null,
    entityId: UUID_PATTERN.test(entityId) ? entityId : null,
    opinionRating: OPINION_RATINGS.includes(opinionRating as AuditOpinionRating)
      ? (opinionRating as AuditOpinionRating)
      : null,
    year: /^\d{4}$/.test(year) ? Number(year) : null,
  };
}

function buildWhere(filters: AuditExportFilter): Prisma.auditsWhereInput {
  const conditions: Prisma.auditsWhereInput[] = [{ is_deleted: false }];

  if (filters.search) {
    conditions.push({
      OR: [
        {
          name: {
            contains: filters.search,
            mode: "insensitive",
          },
        },
        {
          reference_number: {
            contains: filters.search,
            mode: "insensitive",
          },
        },
      ],
    });
  }

  if (filters.auditType) {
    conditions.push({ audit_type: filters.auditType });
  }

  if (filters.entityId) {
    conditions.push({
      audit_entities: {
        some: {
          entity_id: filters.entityId,
        },
      },
    });
  }

  if (filters.opinionRating) {
    conditions.push({ opinion_rating: filters.opinionRating });
  }

  if (filters.year) {
    conditions.push({
      report_issue_date: {
        gte: new Date(Date.UTC(filters.year, 0, 1)),
        lt: new Date(Date.UTC(filters.year + 1, 0, 1)),
      },
    });
  }

  return { AND: conditions };
}

function formatOpinionRating(value: AuditOpinionRating | null) {
  if (!value) {
    return "";
  }

  return value.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export async function GET(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const filters = parseFilters(request.nextUrl.searchParams);
    const where = buildWhere(filters);
    const audits = await prisma.audits.findMany({
      where,
      select: {
        id: true,
        reference_number: true,
        name: true,
        audit_type: true,
        opinion_rating: true,
        report_issue_date: true,
        audit_entities: {
          select: {
            entity: {
              select: {
                code: true,
              },
            },
          },
          orderBy: {
            entity: {
              code: "asc",
            },
          },
        },
        findings: {
          where: {
            is_deleted: false,
          },
          select: {
            id: true,
            action_plans: {
              where: {
                is_deleted: false,
              },
              select: {
                id: true,
              },
            },
          },
        },
      },
      orderBy: {
        created_at: "desc",
      },
      take: EXPORT_ROW_CAP + 1,
    });
    const isCapped = audits.length > EXPORT_ROW_CAP;
    const exportRows = audits.slice(0, EXPORT_ROW_CAP);
    const { workbook, worksheet } = createExportWorksheet({
      columns,
      name: "Audits",
      warning: isCapped ? EXPORT_WARNING : undefined,
    });

    exportRows.forEach((audit) => {
      worksheet.addRow([
        audit.reference_number ?? "",
        audit.name,
        AUDIT_TYPE_LABELS[audit.audit_type],
        formatOpinionRating(audit.opinion_rating),
        formatExportDate(audit.report_issue_date),
        audit.audit_entities.map(({ entity }) => entity.code).join(", "),
        audit.findings.length,
        audit.findings.reduce((count, finding) => count + finding.action_plans.length, 0),
      ]);
    });

    return await buildXlsxResponse(workbook, `audits-${getUtcDateString()}.xlsx`);
  } catch {
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
