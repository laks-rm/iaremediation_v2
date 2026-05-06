import { NextRequest, NextResponse } from "next/server";

import { AuthError, requireRole } from "../../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../../lib/db/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireRole(["AuditTeam", "Viewer", "Auditee"]);
    const { id } = await params;

    const extraction = await prisma.ai_extractions.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        rejection_reason: true,
      },
    });

    if (!extraction) {
      return NextResponse.json({ error: "Extraction not found" }, { status: 404 });
    }

    return NextResponse.json(extraction);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
