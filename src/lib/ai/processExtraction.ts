import { prisma } from "../db/prisma";
import { toPrismaJson } from "./extraction";
import { getLiteLlmChatCompletionsUrl, getLiteLlmModel } from "./litellm";
import { getFileStream } from "../storage";

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

/**
 * Process an AI extraction in the background.
 * Fetches the PDF, calls LiteLLM, and updates the extraction record.
 * On success: populates extracted_json and keeps status as Pending (awaiting human review)
 * On failure: sets status to Rejected with rejection_reason
 */
export async function processExtraction(extractionId: string): Promise<void> {
  try {
    const extraction = await prisma.ai_extractions.findUnique({
      where: { id: extractionId },
      select: {
        id: true,
        filename: true,
        file_path: true,
      },
    });

    if (!extraction) {
      console.error(`[processExtraction] Extraction not found: ${extractionId}`);
      return;
    }

    if (!process.env.LITELLM_API_KEY) {
      throw new Error("LITELLM_API_KEY is not configured");
    }

    const pdfBuffer = await getFileStream(extraction.file_path);

    const model = getLiteLlmModel("ingestion");
    const response = await fetch(getLiteLlmChatCompletionsUrl(), {
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
            content: "You are an internal audit report extraction engine. You return valid JSON only.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: buildExtractionPrompt() },
              {
                type: "file",
                file: {
                  filename: extraction.filename,
                  file_data: `data:application/pdf;base64,${pdfBuffer.toString("base64")}`,
                },
              },
            ],
          },
        ],
        temperature: 0,
      }),
    });

    const body = await readResponseBody(response);

    if (!response.ok) {
      throw new Error(`LiteLLM API returned ${response.status}: ${JSON.stringify(body)}`);
    }

    const content = getChoiceContent(body);
    if (!content) {
      throw new Error("AI response did not include extracted JSON.");
    }

    let extractedJson: unknown;
    try {
      extractedJson = parseJsonOnly(content);
    } catch (parseError) {
      throw new Error(`AI response was not valid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
    }

    await prisma.ai_extractions.update({
      where: { id: extractionId },
      data: {
        extracted_json: toPrismaJson(extractedJson),
        model_used: model,
        prompt_version: PROMPT_VERSION,
      },
    });

    console.log(`[processExtraction] Successfully processed extraction: ${extractionId}`);
  } catch (error) {
    console.error(`[processExtraction] Failed to process extraction ${extractionId}:`, error);

    await prisma.ai_extractions
      .update({
        where: { id: extractionId },
        data: {
          status: "Rejected",
          rejection_reason: error instanceof Error ? error.message : "Unknown error during extraction",
        },
      })
      .catch((updateError) => {
        console.error(`[processExtraction] Failed to update extraction status to Rejected:`, updateError);
      });
  }
}
