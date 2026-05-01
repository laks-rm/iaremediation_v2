import type { ActionPlanStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { actionPlanInclude } from "../../../../../lib/action-plans/access";
import { getLiteLlmChatCompletionsUrl, getLiteLlmModel } from "../../../../../lib/ai/litellm";
import { AuthError, requireRole } from "../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../lib/db/prisma";

const assistantSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  context: z
    .object({
      page: z.string().trim().max(200).optional(),
      action_plan_id: z.string().uuid().optional(),
    })
    .optional(),
});

const CLOSED_STATUSES: ActionPlanStatus[] = ["Closed", "Dropped", "RiskAccepted"];
const STATUSES: ActionPlanStatus[] = [
  "NotStarted",
  "InProgress",
  "PendingValidation",
  "Closed",
  "RiskAccepted",
  "Dropped",
];
const STATUS_LABELS: Record<ActionPlanStatus, string> = {
  NotStarted: "Not Started",
  InProgress: "In Progress",
  PendingValidation: "Pending Validation",
  Closed: "Closed",
  RiskAccepted: "Risk Accepted",
  Dropped: "Dropped",
};
const STATIC_SYSTEM_PROMPT =
  "You are an internal audit assistant for Deriv's IA Remediation Tracker. You have expertise in internal audit, regulatory compliance (AML/CFT, DORA, PCI-DSS), and action plan management. Answer questions about audit findings, action plan status, remediation progress, and audit best practices. Be concise and professional.";

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

function getStartOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

async function getLiveDataSnapshot() {
  try {
    const today = getStartOfToday();
    const [openCount, overdueCount, pendingCount, recentStatusHistory, statusGroups] =
      await Promise.all([
        prisma.action_plans.count({
          where: {
            is_deleted: false,
            status: {
              notIn: CLOSED_STATUSES,
            },
          },
        }),
        prisma.action_plans.count({
          where: {
            is_deleted: false,
            current_target_date: {
              lt: today,
            },
            status: {
              notIn: CLOSED_STATUSES,
            },
          },
        }),
        prisma.action_plans.count({
          where: {
            is_deleted: false,
            status: "PendingValidation",
          },
        }),
        prisma.status_history.findMany({
          orderBy: {
            changed_at: "desc",
          },
          take: 5,
          include: {
            action_plan: {
              select: {
                display_id: true,
                description: true,
                finding: {
                  select: {
                    audit: {
                      select: {
                        name: true,
                      },
                    },
                  },
                },
              },
            },
          },
        }),
        prisma.action_plans.groupBy({
          by: ["status"],
          where: {
            is_deleted: false,
          },
          _count: {
            status: true,
          },
        }),
      ]);

    const statusCounts = STATUSES.reduce(
      (counts, status) => ({
        ...counts,
        [status]: 0,
      }),
      {} as Record<ActionPlanStatus, number>,
    );
    for (const group of statusGroups) {
      statusCounts[group.status] = group._count.status;
    }

    const statusBreakdown = STATUSES.map(
      (status) => `${STATUS_LABELS[status]}: ${statusCounts[status]}`,
    ).join(", ");
    const recentActivity = recentStatusHistory.length
      ? recentStatusHistory
          .map(
            (history) =>
              `- ${history.action_plan.display_id}: status changed to ${STATUS_LABELS[history.to_status]} (${history.action_plan.finding.audit?.name ?? "No audit linked"})`,
          )
          .join("\n")
      : "- No recent status changes";

    return [
      `LIVE DATA SNAPSHOT (${new Date().toLocaleString("en-GB")}):`,
      `- Open action plans: ${openCount}`,
      `- Overdue: ${overdueCount}`,
      `- Pending validation: ${pendingCount}`,
      `- Status breakdown: ${statusBreakdown}`,
      "",
      "RECENT ACTIVITY:",
      recentActivity,
    ].join("\n");
  } catch (error) {
    console.error("Unable to fetch AI assistant live data snapshot", error);
    return "";
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireRole(["AuditTeam", "Viewer", "Auditee"]);

    if (!process.env.LITELLM_API_KEY) {
      return NextResponse.json(
        { error: "AI assistant is unavailable because LITELLM_API_KEY is not configured." },
        { status: 503 },
      );
    }

    const parsed = assistantSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const actionPlan = parsed.data.context?.action_plan_id
      ? await prisma.action_plans.findFirst({
          where: {
            id: parsed.data.context.action_plan_id,
            is_deleted: false,
          },
          include: actionPlanInclude,
        })
      : null;
    const liveDataSnapshot = await getLiveDataSnapshot();

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
              content: [
                STATIC_SYSTEM_PROMPT,
                liveDataSnapshot,
                parsed.data.context?.page ? `Current page: ${parsed.data.context.page}` : "",
                actionPlan
                  ? `Current action plan context: ${JSON.stringify({
                      display_id: actionPlan.display_id,
                      description: actionPlan.description,
                      priority: actionPlan.priority,
                      status: actionPlan.status,
                      current_target_date: actionPlan.current_target_date,
                      required_evidence: actionPlan.required_evidence,
                      closure_remarks: actionPlan.closure_remarks,
                      finding: {
                        title: actionPlan.finding.title,
                        description: actionPlan.finding.description,
                        recommendation: actionPlan.finding.recommendation,
                        audit_name: actionPlan.finding.audit?.name,
                      },
                      owners: actionPlan.action_plan_owners.map((owner) => owner.user.name),
                      evidence: actionPlan.evidence.map((item) => item.original_name),
                    })}`
                  : "",
              ]
                .filter(Boolean)
                .join("\n\n"),
            },
            {
              role: "user",
              content: parsed.data.message,
            },
          ],
          temperature: 0.2,
        }),
      },
    );
    const body = await readResponseBody(response);

    if (!response.ok) {
      return NextResponse.json({ error: "Unable to get AI assistant response." }, { status: 502 });
    }

    const reply = getChoiceContent(body);
    if (!reply) {
      return NextResponse.json({ error: "AI response did not include a reply." }, { status: 502 });
    }

    return NextResponse.json({ reply });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
