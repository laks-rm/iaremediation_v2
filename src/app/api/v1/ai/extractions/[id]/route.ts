import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getExtractionCounts, toPrismaJson } from "../../../../../../lib/ai/extraction";
import { AuthError, requireRole } from "../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../lib/db/prisma";

const updateExtractionSchema = z.object({
  human_edits_json: z.unknown(),
});

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function serializeExtraction(extraction: Awaited<ReturnType<typeof getExtractionRecord>>) {
  if (!extraction) return null;

  return {
    ...extraction,
    counts: getExtractionCounts(extraction.human_edits_json ?? extraction.extracted_json),
  };
}

async function getExtractionRecord(id: string) {
  return prisma.ai_extractions.findUnique({
    where: {
      id,
    },
    include: {
      created_by: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      approved_by: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    await requireRole(["AuditTeam"]);
    const { id } = await context.params;
    const extraction = await getExtractionRecord(id);

    if (!extraction) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ extraction: serializeExtraction(extraction) });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    await requireRole(["AuditTeam"]);
    const { id } = await context.params;
    const parsed = updateExtractionSchema.safeParse(await request.json().catch(() => null));

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const extraction = await prisma.ai_extractions.update({
      where: {
        id,
      },
      data: {
        human_edits_json: toPrismaJson(parsed.data.human_edits_json),
      },
      include: {
        created_by: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        approved_by: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        return null;
      }
      throw error;
    });

    if (!extraction) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ extraction: serializeExtraction(extraction) });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
