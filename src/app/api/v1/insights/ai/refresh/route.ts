import { NextResponse } from "next/server";

import { generateAiInsightsSnapshot } from "../../../../../../lib/ai/insights/snapshot";
import { AuthError, requireAdmin, requireRole } from "../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../lib/db/prisma";

const MANUAL_REFRESH_COOLDOWN_MS = 15 * 60 * 1000;

function formatRetryAfter(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

async function requireRefreshAccess() {
  try {
    return await requireRole(["AuditTeam"]);
  } catch (error) {
    if (error instanceof AuthError && error.status === 403) {
      return requireAdmin();
    }

    throw error;
  }
}

export async function POST() {
  try {
    const currentUser = await requireRefreshAccess();
    const latestManualSnapshot = await prisma.ai_insights_snapshot.findFirst({
      where: {
        trigger: "manual",
      },
      orderBy: {
        generated_at: "desc",
      },
      select: {
        generated_at: true,
      },
    });

    if (latestManualSnapshot) {
      const cooldownEndsAt = latestManualSnapshot.generated_at.getTime() + MANUAL_REFRESH_COOLDOWN_MS;
      const retryAfter = Math.ceil((cooldownEndsAt - Date.now()) / 1000);

      if (retryAfter > 0) {
        return NextResponse.json(
          {
            error: `Refresh available in ${formatRetryAfter(retryAfter)}`,
            retry_after: retryAfter,
          },
          { status: 429 },
        );
      }
    }

    const snapshot = await generateAiInsightsSnapshot({
      generatedBy: currentUser.id,
      trigger: "manual",
      prismaClient: prisma,
    });

    return NextResponse.json({ snapshot });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}
