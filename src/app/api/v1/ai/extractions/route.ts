import { NextResponse } from "next/server";

import { getExtractionCounts } from "../../../../../lib/ai/extraction";
import { AuthError, requireRole } from "../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../lib/db/prisma";

export async function GET() {
  try {
    await requireRole(["AuditTeam"]);
    const extractions = await prisma.ai_extractions.findMany({
      include: {
        created_by: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    return NextResponse.json({
      extractions: extractions.map((extraction) => ({
        id: extraction.id,
        filename: extraction.filename,
        status: extraction.status,
        created_at: extraction.created_at,
        created_by: extraction.created_by,
        created_audit_id: extraction.created_audit_id,
        ...getExtractionCounts(extraction.human_edits_json ?? extraction.extracted_json),
      })),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
