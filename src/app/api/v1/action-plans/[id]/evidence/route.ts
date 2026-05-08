import { randomUUID } from "node:crypto";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import {
  canMutateOwnedActionPlan,
  getActionPlanForAccess,
  getClientIp,
  nullableString,
  safeUserSelect,
  toAuditJson,
} from "../../../../../../lib/action-plans/access";
import { writeAuditLog } from "../../../../../../lib/audit-log/writeAuditLog";
import { AuthError, requireRole } from "../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../lib/db/prisma";
import { uploadFile } from "../../../../../../lib/storage";

export const maxDuration = 60;
export const runtime = "nodejs";

const MAX_FILE_BYTES = 50 * 1024 * 1024;

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function getSafeExtension(filename: string) {
  const extension = path.extname(filename).toLowerCase().replace(/[^a-z0-9.]/g, "");
  return extension.slice(0, 16);
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const currentUser = await requireRole(["AuditTeam", "Auditee"]);
    const { id } = await context.params;
    const accessRecord = await getActionPlanForAccess(id);

    if (!accessRecord) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!canMutateOwnedActionPlan(currentUser, accessRecord)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const evidence = await prisma.evidence.findMany({
      where: {
        action_plan_id: id,
        is_deleted: false,
      },
      include: {
        uploaded_by: {
          select: safeUserSelect,
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    return NextResponse.json({ evidence });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const currentUser = await requireRole(["AuditTeam", "Auditee"]);
    const { id } = await context.params;
    const accessRecord = await getActionPlanForAccess(id);

    if (!accessRecord) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!canMutateOwnedActionPlan(currentUser, accessRecord)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const description = formData.get("description");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A file field is required" }, { status: 400 });
    }

    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "File must be under 50MB" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const storedFilename = `${randomUUID()}${getSafeExtension(file.name)}`;
    const filePath = await uploadFile(
      buffer,
      `action-plan-evidence/${id}/${storedFilename}`,
      file.type || "application/octet-stream",
    );
    const evidence = await prisma.evidence.create({
      data: {
        action_plan_id: id,
        filename: storedFilename,
        original_name: file.name,
        file_path: filePath,
        file_size: file.size,
        mime_type: file.type || "application/octet-stream",
        description: typeof description === "string" ? nullableString(description) : null,
        uploaded_by_id: currentUser.id,
      },
    });

    await writeAuditLog({
      userId: currentUser.id,
      action: "EvidenceUpload",
      entityType: "ActionPlan",
      entityId: id,
      afterJson: toAuditJson(evidence),
      ipAddress: getClientIp(request),
    });

    return NextResponse.json({ evidence }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
