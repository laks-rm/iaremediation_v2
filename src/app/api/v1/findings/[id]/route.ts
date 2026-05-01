import { ControlRating, Prisma, Priority } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "../../../../../lib/audit-log/writeAuditLog";
import { AuthError, requireRole } from "../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../lib/db/prisma";

const updateFindingSchema = z.object({
  external_ref: z.string().trim().max(100).nullable().optional(),
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().nullable().optional(),
  root_cause: z.string().trim().nullable().optional(),
  recommendation: z.string().trim().nullable().optional(),
  priority: z.enum(["High", "Moderate", "Low"]).nullable().optional(),
  control_rating: z.enum(["Effective", "PartiallyEffective", "NotEffective"]).nullable().optional(),
});

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

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

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const currentUser = await requireRole(["AuditTeam"]);
    const { id } = await context.params;
    const parsed = updateFindingSchema.safeParse(await request.json().catch(() => null));

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const existing = await prisma.findings.findFirst({
      where: {
        id,
        is_deleted: false,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const data: Prisma.findingsUpdateInput = {};
    if (parsed.data.external_ref !== undefined) data.external_ref = nullableString(parsed.data.external_ref);
    if (parsed.data.title !== undefined) data.title = parsed.data.title;
    if (parsed.data.description !== undefined) data.description = nullableString(parsed.data.description);
    if (parsed.data.root_cause !== undefined) data.root_cause = nullableString(parsed.data.root_cause);
    if (parsed.data.recommendation !== undefined) data.recommendation = nullableString(parsed.data.recommendation);
    if (parsed.data.priority !== undefined) data.priority = parsed.data.priority as Priority | null;
    if (parsed.data.control_rating !== undefined) {
      data.control_rating = parsed.data.control_rating as ControlRating | null;
    }

    const finding = await prisma.findings.update({
      where: {
        id,
      },
      data,
    });

    await writeAuditLog({
      userId: currentUser.id,
      action: "Update",
      entityType: "findings",
      entityId: id,
      beforeJson: toAuditJson(existing),
      afterJson: toAuditJson(finding),
      ipAddress: getClientIp(request),
    });

    return NextResponse.json({ finding });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const currentUser = await requireRole(["AuditTeam"]);
    const { id } = await context.params;
    const existing = await prisma.findings.findFirst({
      where: {
        id,
        is_deleted: false,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const finding = await prisma.findings.update({
      where: {
        id,
      },
      data: {
        is_deleted: true,
      },
    });

    await writeAuditLog({
      userId: currentUser.id,
      action: "Delete",
      entityType: "findings",
      entityId: id,
      beforeJson: toAuditJson(existing),
      afterJson: toAuditJson(finding),
      ipAddress: getClientIp(request),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
