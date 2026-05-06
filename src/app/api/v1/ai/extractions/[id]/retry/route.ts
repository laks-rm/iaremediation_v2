import { NextRequest, NextResponse } from "next/server";

import { AuthError, requireRole } from "../../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../../lib/db/prisma";
import { processExtraction } from "../../../../../../../lib/ai/processExtraction";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireRole(["AuditTeam"]);

    const extraction = await prisma.ai_extractions.findUnique({
      where: { id: params.id },
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
      where: { id: params.id },
      data: {
        status: "Pending",
        rejection_reason: null,
        extracted_json: {},
      },
    });

    processExtraction(params.id).catch((error) => {
      console.error(`[retry route] Background extraction retry failed for ${params.id}:`, error);
    });

    return NextResponse.json({ extractionId: params.id, status: "Pending" }, { status: 202 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
