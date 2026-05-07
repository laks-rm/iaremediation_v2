import { ControlRating, CreatedVia, Prisma, Priority } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "../../../../lib/audit-log/writeAuditLog";
import { AuthError, requireRole } from "../../../../lib/auth/requireRole";
import { prisma } from "../../../../lib/db/prisma";

const createFindingSchema = z.object({
  audit_id: z.string().uuid().nullable().optional(),
  is_standalone: z.boolean(),
  external_ref: z.string().trim().max(100).nullable().optional(),
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().nullable().optional(),
  root_cause: z.string().trim().nullable().optional(),
  recommendation: z.string().trim().nullable().optional(),
  priority: z.enum(["High", "Moderate", "Low"]).nullable().optional(),
  control_rating: z.enum(["Effective", "PartiallyEffective", "NotEffective"]).nullable().optional(),
  finding_type: z.enum(["Finding", "OpportunityForImprovement"]).optional(),
  created_via: z.enum(["Manual", "Standalone"]),
});

function getClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip");
}

function nullableString(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function toAuditJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function GET(request: NextRequest) {
  try {
    await requireRole(["AuditTeam", "Viewer"]);
    const auditId = request.nextUrl.searchParams.get("audit_id");

    if (!auditId) {
      return NextResponse.json({ findings: [] });
    }

    const findings = await prisma.findings.findMany({
      where: {
        audit_id: auditId,
        is_deleted: false,
      },
      select: {
        id: true,
        audit_id: true,
        is_standalone: true,
        external_ref: true,
        title: true,
        description: true,
        root_cause: true,
        recommendation: true,
        priority: true,
        control_rating: true,
        finding_type: true,
      },
      orderBy: [
        {
          display_order: "asc",
        },
        {
          created_at: "asc",
        },
      ],
    });

    return NextResponse.json({ findings });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const currentUser = await requireRole(["AuditTeam"]);
    const parsed = createFindingSchema.safeParse(await request.json().catch(() => null));

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    if (!parsed.data.is_standalone && !parsed.data.audit_id) {
      return NextResponse.json({ error: "audit_id is required for audit findings" }, { status: 400 });
    }

    if (parsed.data.audit_id) {
      const audit = await prisma.audits.findFirst({
        where: {
          id: parsed.data.audit_id,
          is_deleted: false,
        },
        select: {
          id: true,
        },
      });

      if (!audit) {
        return NextResponse.json({ error: "Audit not found" }, { status: 404 });
      }
    }

    const displayOrder =
      parsed.data.audit_id === null || parsed.data.audit_id === undefined
        ? 1
        : (await prisma.findings.count({
            where: {
              audit_id: parsed.data.audit_id,
              is_deleted: false,
            },
          })) + 1;

    const finding = await prisma.findings.create({
      data: {
        audit_id: parsed.data.is_standalone ? null : parsed.data.audit_id,
        is_standalone: parsed.data.is_standalone,
        external_ref: nullableString(parsed.data.external_ref),
        title: parsed.data.title,
        description: nullableString(parsed.data.description),
        root_cause: nullableString(parsed.data.root_cause),
        recommendation: nullableString(parsed.data.recommendation),
        priority: parsed.data.priority as Priority | null | undefined,
        control_rating: parsed.data.control_rating as ControlRating | null | undefined,
        finding_type: parsed.data.finding_type ?? "Finding",
        display_order: displayOrder,
        created_by_id: currentUser.id,
        created_via: parsed.data.created_via as CreatedVia,
      },
    });

    await writeAuditLog({
      userId: currentUser.id,
      action: "Create",
      entityType: "findings",
      entityId: finding.id,
      afterJson: toAuditJson(finding),
      ipAddress: getClientIp(request),
    });

    return NextResponse.json({ finding }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
