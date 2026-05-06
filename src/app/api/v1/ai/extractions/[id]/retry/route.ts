import { NextRequest, NextResponse } from "next/server";

import { AuthError, requireRole } from "../../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../../lib/db/prisma";
import { processExtraction } from "../../../../../../../lib/ai/processExtraction";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireRole(["AuditTeam"]);
    const { id } = await params;

    const extraction = await prisma.ai_extractions.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
      },
    });

    if (!extraction) {
      return NextResponse.json({ error: "Extraction not found" }, { status: 404 });
    }

    if (extraction.status !== "Rejected") {
      return NextResponse.json(
        { error: "Only rejected extractions can be retried" },
        { status: 400 },
      );
    }

    await prisma.ai_extractions.update({
      where: { id },
      data: {
        status: "Pending",
        rejection_reason: null,
        extracted_json: {},
      },
    });

    processExtraction(id).catch((error) => {
      console.error(`[retry route] Background extraction retry failed for ${id}:`, error);
    });

    return NextResponse.json({ extractionId: id, status: "Pending" }, { status: 202 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
