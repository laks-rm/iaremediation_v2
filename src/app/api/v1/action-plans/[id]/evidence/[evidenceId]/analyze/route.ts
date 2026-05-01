import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  canMutateOwnedActionPlan,
  getActionPlanForAccess,
} from "../../../../../../../../lib/action-plans/access";
import { getLiteLlmChatCompletionsUrl, getLiteLlmModel } from "../../../../../../../../lib/ai/litellm";
import { AuthError, requireRole } from "../../../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../../../lib/db/prisma";
import { getFileStream } from "../../../../../../../../lib/storage";

const analyzeSchema = z.object({
  evidence_id: z.string().uuid(),
});

const VERDICTS = ["Adequate", "Partially Adequate", "Inadequate"] as const;
type Verdict = (typeof VERDICTS)[number];

type RouteContext = {
  params: Promise<{
    id: string;
    evidenceId: string;
  }>;
};

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
  const choices = body && typeof body === "object" && "choices" in body ? (body as { choices?: unknown }).choices : null;
  if (!Array.isArray(choices)) {
    return null;
  }

  const message = (choices[0] as { message?: { content?: unknown } } | undefined)?.message;
  return typeof message?.content === "string" ? message.content.trim() : null;
}

function parseJsonOnly(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse(fenced?.[1] ?? content) as unknown;
}

function getVerdict(value: unknown): Verdict {
  if (typeof value === "string" && VERDICTS.includes(value as Verdict)) {
    return value as Verdict;
  }

  return "Partially Adequate";
}

function getTextField(value: unknown, key: string) {
  if (!value || typeof value !== "object" || !(key in value)) {
    return null;
  }

  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field.trim() : null;
}

function isAnalyzableBinary(mimeType: string) {
  return mimeType === "application/pdf" || mimeType.startsWith("image/");
}

function buildPrompt(actionPlan: NonNullable<Awaited<ReturnType<typeof getActionPlan>>>, evidenceContext: string) {
  return [
    "Analyse whether this evidence adequately demonstrates completion of the action plan.",
    "Note gaps or concerns and give a clear verdict: Adequate, Partially Adequate, or Inadequate.",
    "Return JSON only in this shape: {\"analysis\":\"...\",\"verdict\":\"Adequate|Partially Adequate|Inadequate\"}.",
    "",
    `Audit: ${actionPlan.finding.audit?.name ?? "No audit linked"}`,
    `Finding title: ${actionPlan.finding.title}`,
    `Finding description: ${actionPlan.finding.description ?? "Not provided"}`,
    `Finding recommendation: ${actionPlan.finding.recommendation ?? "Not provided"}`,
    `Finding priority: ${actionPlan.finding.priority ?? "Not set"}`,
    `Action plan description: ${actionPlan.description}`,
    `Required evidence: ${actionPlan.required_evidence ?? "Not specified"}`,
    evidenceContext,
  ].join("\n");
}

async function getActionPlan(id: string) {
  return prisma.action_plans.findFirst({
    where: {
      id,
      is_deleted: false,
    },
    select: {
      id: true,
      description: true,
      required_evidence: true,
      finding: {
        select: {
          title: true,
          description: true,
          recommendation: true,
          priority: true,
          audit: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const currentUser = await requireRole(["AuditTeam", "Auditee"]);

    if (!process.env.LITELLM_API_KEY) {
      return NextResponse.json({ error: "AI features not available" }, { status: 503 });
    }

    const { id, evidenceId } = await context.params;
    const parsed = analyzeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || parsed.data.evidence_id !== evidenceId) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const accessRecord = await getActionPlanForAccess(id);
    if (!accessRecord) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!canMutateOwnedActionPlan(currentUser, accessRecord)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [actionPlan, evidence] = await Promise.all([
      getActionPlan(id),
      prisma.evidence.findFirst({
        where: {
          id: evidenceId,
          action_plan_id: id,
          is_deleted: false,
        },
        select: {
          id: true,
          original_name: true,
          filename: true,
          file_path: true,
          file_size: true,
          mime_type: true,
          description: true,
        },
      }),
    ]);

    if (!actionPlan || !evidence) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const content: unknown[] = [
      {
        type: "text",
        text: buildPrompt(
          actionPlan,
          [
            `Evidence filename: ${evidence.original_name}`,
            `Evidence description: ${evidence.description ?? "Not provided"}`,
            `Evidence MIME type: ${evidence.mime_type}`,
          ].join("\n"),
        ),
      },
    ];

    if (isAnalyzableBinary(evidence.mime_type)) {
      const buffer = await getFileStream(evidence.file_path);
      const dataUrl = `data:${evidence.mime_type};base64,${buffer.toString("base64")}`;

      if (evidence.mime_type === "application/pdf") {
        content.push({
          type: "file",
          file: {
            filename: evidence.original_name,
            file_data: dataUrl,
          },
        });
      } else {
        content.push({
          type: "image_url",
          image_url: {
            url: dataUrl,
          },
        });
      }
    }

    const response = await fetch(
      getLiteLlmChatCompletionsUrl(),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.LITELLM_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: getLiteLlmModel("analysis"),
          messages: [
            {
              role: "system",
              content:
                "You are an internal audit evidence reviewer. Use only the supplied action plan, finding, and evidence file context.",
            },
            {
              role: "user",
              content,
            },
          ],
          temperature: 0.1,
        }),
      },
    );
    const body = await readResponseBody(response);

    if (!response.ok) {
      return NextResponse.json({ error: "Unable to analyse evidence." }, { status: 502 });
    }

    const contentText = getChoiceContent(body);
    if (!contentText) {
      return NextResponse.json({ error: "AI response did not include an analysis." }, { status: 502 });
    }

    try {
      const parsedContent = parseJsonOnly(contentText);
      const analysis = getTextField(parsedContent, "analysis");
      if (!analysis) {
        throw new Error("Missing analysis");
      }

      return NextResponse.json({
        analysis,
        verdict: getVerdict(getTextField(parsedContent, "verdict")),
      });
    } catch {
      return NextResponse.json({
        analysis: contentText,
        verdict: getVerdict(contentText.match(/Adequate|Partially Adequate|Inadequate/)?.[0]),
      });
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
