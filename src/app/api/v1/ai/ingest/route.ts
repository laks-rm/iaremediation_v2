import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { AuthError, requireRole } from "../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../lib/db/prisma";
import { uploadFile } from "../../../../../lib/storage";
import { processExtraction } from "../../../../../lib/ai/processExtraction";

export const maxDuration = 60;
export const runtime = "nodejs";

const MAX_PDF_BYTES = 50 * 1024 * 1024;

function isPdf(buffer: Buffer, file: File) {
  return buffer.subarray(0, 5).toString("ascii") === "%PDF-" && file.type === "application/pdf";
}

export async function POST(request: NextRequest) {
  try {
    const currentUser = await requireRole(["AuditTeam"]);

    if (!process.env.LITELLM_API_KEY) {
      return NextResponse.json(
        { error: "AI ingestion is unavailable because LITELLM_API_KEY is not configured." },
        { status: 503 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A PDF file field is required" }, { status: 400 });
    }

    if (file.size <= 0 || file.size > MAX_PDF_BYTES) {
      return NextResponse.json({ error: "PDF must be under 50MB" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!isPdf(buffer, file)) {
      return NextResponse.json({ error: "Only PDF files are accepted" }, { status: 400 });
    }

    const filePath = await uploadFile(
      buffer,
      `ai-ingestions/${currentUser.id}/${randomUUID()}.pdf`,
      "application/pdf",
    );

    const extraction = await prisma.ai_extractions.create({
      data: {
        filename: file.name,
        file_path: filePath,
        status: "Pending",
        model_used: "",
        prompt_version: "",
        extracted_json: {},
        created_by_id: currentUser.id,
      },
      select: {
        id: true,
      },
    });

    processExtraction(extraction.id).catch((error) => {
      console.error(`[ingest route] Background extraction failed for ${extraction.id}:`, error);
    });

    return NextResponse.json({ extractionId: extraction.id, status: "Pending" }, { status: 202 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
