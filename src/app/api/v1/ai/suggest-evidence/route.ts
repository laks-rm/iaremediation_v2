import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getLiteLlmChatCompletionsUrl, getLiteLlmModel } from "../../../../../lib/ai/litellm";
import { AuthError, requireRole } from "../../../../../lib/auth/requireRole";

const suggestEvidenceSchema = z.object({
  finding_title: z.string().trim().min(1),
  finding_description: z.string().trim().nullable().optional(),
  finding_recommendation: z.string().trim().nullable().optional(),
  finding_priority: z.enum(["High", "Moderate", "Low"]).nullable().optional(),
  action_plan_description: z.string().trim().min(1),
  audit_name: z.string().trim().nullable().optional(),
});

async function readResponseBody(response: Response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

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

  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object" || !("message" in firstChoice)) {
    return null;
  }

  const message = (firstChoice as { message?: unknown }).message;
  if (!message || typeof message !== "object" || !("content" in message)) {
    return null;
  }

  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content.trim() : null;
}

function responseError(body: unknown) {
  if (typeof body === "object" && body && "error" in body) {
    return String(body.error);
  }

  return typeof body === "string" ? body : "";
}

function getAiErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (
    normalized.includes("502") ||
    normalized.includes("bad gateway") ||
    normalized.includes("econnrefused") ||
    normalized.includes("fetch failed")
  ) {
    return NextResponse.json(
      {
        error:
          "AI service is temporarily unreachable. The LiteLLM endpoint cannot be reached from this machine. This is a network/firewall issue, not a bug.",
      },
      { status: 503 },
    );
  }

  if (normalized.includes("401") || normalized.includes("unauthorized")) {
    return NextResponse.json(
      { error: "AI service authentication failed. Check LITELLM_API_KEY in your environment." },
      { status: 503 },
    );
  }

  if (normalized.includes("timeout") || normalized.includes("etimedout")) {
    return NextResponse.json(
      { error: "AI request timed out. The model took too long to respond." },
      { status: 503 },
    );
  }

  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(request: NextRequest) {
  try {
    await requireRole(["AuditTeam"]);

    if (!process.env.LITELLM_API_KEY) {
      return NextResponse.json(
        { error: "AI evidence suggestions are unavailable because LITELLM_API_KEY is not configured." },
        { status: 503 },
      );
    }

    const parsed = suggestEvidenceSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(new Error("timeout")), 30_000);

    try {
      const response = await fetch(
        getLiteLlmChatCompletionsUrl(),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.LITELLM_API_KEY}`,
            "Content-Type": "application/json",
          },
          signal: abortController.signal,
          body: JSON.stringify({
            model: getLiteLlmModel("analysis"),
            messages: [
              {
                role: "system",
                content:
                  "Suggest concise, specific, verifiable evidence for an internal audit remediation action plan. Return only the evidence text, with no markdown heading.",
              },
              {
                role: "user",
                content: [
                  `Audit: ${parsed.data.audit_name || "Standalone finding"}`,
                  `Finding title: ${parsed.data.finding_title}`,
                  `Finding priority: ${parsed.data.finding_priority || "Not set"}`,
                  `Finding description: ${parsed.data.finding_description || "Not provided"}`,
                  `Recommendation: ${parsed.data.finding_recommendation || "Not provided"}`,
                  `Action plan: ${parsed.data.action_plan_description}`,
                  "Suggest evidence that proves implementation and operating effectiveness where possible.",
                ].join("\n"),
              },
            ],
            temperature: 0.2,
          }),
        },
      );
      const body = await readResponseBody(response);

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText} ${responseError(body)}`);
      }

      const requiredEvidence = getChoiceContent(body);
      if (!requiredEvidence) {
        return NextResponse.json({ error: "AI response did not include a suggestion." }, { status: 502 });
      }

      return NextResponse.json({ required_evidence: requiredEvidence });
    } catch (error) {
      return getAiErrorResponse(error);
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
