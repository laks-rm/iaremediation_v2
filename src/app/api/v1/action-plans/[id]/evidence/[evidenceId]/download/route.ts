import { NextRequest, NextResponse } from "next/server";

import {
  canMutateOwnedActionPlan,
  getActionPlanForAccess,
} from "../../../../../../../../lib/action-plans/access";
import { AuthError, requireRole } from "../../../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../../../lib/db/prisma";
import { getFileStream } from "../../../../../../../../lib/storage";

type RouteContext = {
  params: Promise<{
    id: string;
    evidenceId: string;
  }>;
};

function contentDisposition(filename: string) {
  const safeFallback = filename.replaceAll(/[^\w .-]/g, "_");
  return `attachment; filename="${safeFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const currentUser = await requireRole(["AuditTeam", "Auditee"]);
    const { id, evidenceId } = await context.params;
    const accessRecord = await getActionPlanForAccess(id);

    if (!accessRecord) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!canMutateOwnedActionPlan(currentUser, accessRecord)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const evidence = await prisma.evidence.findFirst({
      where: {
        id: evidenceId,
        action_plan_id: id,
        is_deleted: false,
      },
    });

    if (!evidence) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const buffer = await getFileStream(evidence.file_path);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": evidence.mime_type,
        "Content-Disposition": contentDisposition(evidence.original_name),
        "Content-Length": String(buffer.byteLength),
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
