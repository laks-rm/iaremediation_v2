import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { AuthError, requireRole } from "../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../lib/db/prisma";
import { toPrismaJson } from "../../../../../lib/ai/extraction";
import { getLiteLlmChatCompletionsUrl, getLiteLlmModel } from "../../../../../lib/ai/litellm";
import { uploadFile } from "../../../../../lib/storage";

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const PROMPT_VERSION = "extract-v1.1";

async function readResponseBody(response: Response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function getChoiceContent(body: unknown) {
  if (!body || typeof body !== "object" || !("choices" in body)) {
    return null;
  }

  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) {
    return null;
  }

  const message = (choices[0] as { message?: { content?: unknown } } | undefined)?.message;
  return typeof message?.content === "string" ? message.content.trim() : null;
}

function parseJsonOnly(content: string) {
  const cleaned = content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  return JSON.parse(cleaned) as unknown;
}

function isPdf(buffer: Buffer, file: File) {
  return buffer.subarray(0, 5).toString("ascii") === "%PDF-" && file.type === "application/pdf";
}

function buildExtractionPrompt() {
  return [
    `Prompt version: ${PROMPT_VERSION}`,
    "Extract internal audit report data from the attached PDF.",
    "Return JSON only. Do not include markdown, explanations, or code fences.",
    "Use this exact shape:",
    JSON.stringify({
      audit_name: "string",
      reference_number: "string|null",
      audit_type: "IT|RegulatoryIT|Operations|RegulatoryOperations|External",
      opinion_rating: "Satisfactory|NeedsImprovement|Unsatisfactory|null",
      report_issue_date: "YYYY-MM-DD|null",
      entities_mentioned: ["string"],
      executive_summary: "string|null",
      control_areas: [
        {
          title: "string",
          rating: "Effective|PartiallyEffective|NotEffective|null",
          finding_reference: "string|null",
        },
      ],
      findings: [
        {
          external_ref: "string|null",
          title: "string",
          description: "string|null",
          root_cause: "string|null",
          potential_impact: "string|null",
          recommendation: "string|null",
          priority: "High|Moderate|Low|null",
          control_rating: "Effective|PartiallyEffective|NotEffective|null",
          action_plans: [
            {
              finding_reference: "string matching this finding external_ref",
              description: "string",
              priority: "High|Moderate|Low|null",
              target_date: "YYYY-MM-DD|null",
              owner_names: ["string"],
            },
          ],
        },
      ],
      action_plans: [
        {
          finding_reference: "string matching a finding external_ref",
          description: "string",
          priority: "High|Moderate|Low|null",
          target_date: "YYYY-MM-DD|null",
          owner_names: ["string"],
        },
      ],
    }),
    "If a value is not present, use null or an empty array. Normalize enum values exactly to the allowed values.",
  ].join("\n");
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
    const model = getLiteLlmModel("ingestion");
    const response = await fetch(
      getLiteLlmChatCompletionsUrl(),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.LITELLM_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content:
                "You are an internal audit report extraction engine. You return valid JSON only.",
            },
            {
              role: "user",
              content: [
                { type: "text", text: buildExtractionPrompt() },
                {
                  type: "file",
                  file: {
                    filename: file.name,
                    file_data: `data:application/pdf;base64,${buffer.toString("base64")}`,
                  },
                },
              ],
            },
          ],
          temperature: 0,
        }),
      },
    );
    const body = await readResponseBody(response);

    if (!response.ok) {
      return NextResponse.json({ error: "Unable to extract data from report." }, { status: 502 });
    }

    const content = getChoiceContent(body);
    if (!content) {
      return NextResponse.json({ error: "AI response did not include extracted JSON." }, { status: 502 });
    }

    let extractedJson: unknown;
    try {
      extractedJson = parseJsonOnly(content);
    } catch {
      return NextResponse.json({ error: "AI response was not valid JSON." }, { status: 502 });
    }

    const extraction = await prisma.ai_extractions.create({
      data: {
        filename: file.name,
        file_path: filePath,
        status: "Pending",
        model_used: model,
        prompt_version: PROMPT_VERSION,
        extracted_json: toPrismaJson(extractedJson),
        created_by_id: currentUser.id,
      },
      select: {
        id: true,
      },
    });

    return NextResponse.json({ extraction_id: extraction.id }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
