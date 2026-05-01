import { NextRequest, NextResponse } from "next/server";

import { getLiteLlmChatCompletionsUrl, getLiteLlmModel } from "../../../../../../lib/ai/litellm";
import { AuthError, requireRole } from "../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../lib/db/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
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

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    await requireRole(["AuditTeam"]);

    if (!process.env.LITELLM_API_KEY) {
      return NextResponse.json(
        { error: "Closure remark generation is unavailable because LITELLM_API_KEY is not configured." },
        { status: 503 },
      );
    }

    const { id } = await context.params;
    const actionPlan = await prisma.action_plans.findFirst({
      where: {
        id,
        is_deleted: false,
      },
      include: {
        finding: {
          include: {
            audit: true,
          },
        },
        evidence: {
          where: {
            is_deleted: false,
          },
          orderBy: {
            created_at: "desc",
          },
        },
      },
    });

    if (!actionPlan) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
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
                "Draft concise internal audit closure remarks. Use only the provided action plan, finding context, and evidence list. Return only the closure remarks text.",
            },
            {
              role: "user",
              content: [
                `Audit: ${actionPlan.finding.audit?.name ?? "No audit linked"}`,
                `Finding: ${actionPlan.finding.title}`,
                `Finding description: ${actionPlan.finding.description ?? "Not provided"}`,
                `Recommendation: ${actionPlan.finding.recommendation ?? "Not provided"}`,
                `Action plan: ${actionPlan.description}`,
                `Required evidence: ${actionPlan.required_evidence ?? "Not provided"}`,
                `Evidence files: ${
                  actionPlan.evidence
                    .map((evidence) => `${evidence.original_name}${evidence.description ? ` - ${evidence.description}` : ""}`)
                    .join("; ") || "No evidence uploaded"
                }`,
              ].join("\n"),
            },
          ],
          temperature: 0.2,
        }),
      },
    );
    const body = await readResponseBody(response);

    if (!response.ok) {
      return NextResponse.json({ error: "Unable to generate closure remarks." }, { status: 502 });
    }

    const closureRemarks = getChoiceContent(body);
    if (!closureRemarks) {
      return NextResponse.json({ error: "AI response did not include closure remarks." }, { status: 502 });
    }

    return NextResponse.json({ closure_remarks: closureRemarks });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
