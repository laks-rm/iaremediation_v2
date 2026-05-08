import { prisma } from "../db/prisma";
import { toPrismaJson } from "./extraction";
import { getLiteLlmChatCompletionsUrl, getLiteLlmModel } from "./litellm";
import { getFileStream } from "../storage";

const PROMPT_VERSION = "extract-v1.4";

function parseJsonOnly(content: string) {
  const cleaned = content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  // First attempt: direct parse
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    // Second attempt: find the outermost JSON object
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as unknown;
      } catch {
        // fall through to throw original error
      }
    }
    // Re-throw with the original content for debugging
    throw new Error(`JSON parse failed. Content starts with: ${cleaned.substring(0, 100)}`);
  }
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
          finding_type: "Finding|OpportunityForImprovement",
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
              title: "string|null",
              description: "string",
              priority: "High|Moderate|Low|null",
              status: "NotStarted|InProgress|PendingValidation|Closed|RiskAccepted|Dropped|null",
              target_date: "YYYY-MM-DD|null",
              owner_names: ["string"],
            },
          ],
        },
      ],
      action_plans: [
        {
          finding_reference: "string matching a finding external_ref",
          title: "string|null",
          description: "string",
          priority: "High|Moderate|Low|null",
          status: "NotStarted|InProgress|PendingValidation|Closed|RiskAccepted|Dropped|null",
          target_date: "YYYY-MM-DD|null",
          owner_names: ["string"],
        },
      ],
    }),
    "If a value is not present, use null or an empty array. Normalize enum values exactly to the allowed values.",
    "finding_type: Set to 'OpportunityForImprovement' if the finding is labelled as an observation, OFI, opportunity for improvement, or advisory note rather than a formal finding requiring mandatory remediation. Otherwise set to 'Finding'.",
    "status: Infer the action plan status from the PDF content. If the description or context indicates the action plan is completed, closed, implemented, or done, set to 'Closed'. If it mentions in progress, ongoing, or being worked on, set to 'InProgress'. If it mentions risk accepted, management accepts the risk, or risk tolerance, set to 'RiskAccepted'. If it mentions dropped, cancelled, or no longer applicable, set to 'Dropped'. If it mentions pending validation, awaiting verification, or ready for review, set to 'PendingValidation'. Otherwise default to 'NotStarted'.",
    "title: For each action plan, generate a concise title (max 10 words) summarizing the action plan if one can be clearly identified from the PDF. Otherwise leave null. The title should capture the essence of the remediation action.",
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
        stream: true,
	max_tokens: 16000,
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

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LiteLLM API returned ${response.status}: ${errorText}`);
    }

    if (!response.body) {
      throw new Error("LiteLLM API returned no response body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines only
      const lines = buffer.split("\n");
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{
              delta?: { content?: string };
              finish_reason?: string;
            }>;
          };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) fullContent += delta;
        } catch {
          // skip malformed SSE chunks
        }
      }
    }

    // Process any remaining buffer content
    if (buffer.trim().startsWith("data: ")) {
      const data = buffer.trim().slice(6);
      if (data !== "[DONE]") {
        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{
              delta?: { content?: string };
            }>;
          };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) fullContent += delta;
        } catch {
          // skip
        }
      }
    }

    const content = fullContent.trim();
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
