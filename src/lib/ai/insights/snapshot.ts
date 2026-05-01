import type { ai_insights_snapshot, Prisma, PrismaClient } from "@prisma/client";

import { getLiteLlmChatCompletionsUrl, getLiteLlmModel } from "../litellm";
import { prisma as defaultPrisma } from "../../db/prisma";
import { AI_INSIGHT_ANALYSERS } from "./analyzers";
import {
  buildExecutiveBriefPrompt,
  buildInsightNarratorPrompt,
  EXECUTIVE_BRIEF_TEMPERATURE,
  INSIGHT_NARRATOR_TEMPERATURE,
  PROMPT_VERSION,
  type ExecutiveBriefCardSummary,
  type NarratorInputCard,
} from "./prompts";
import {
  INSIGHT_CATEGORY_ORDER,
  type AiInsightCard,
  type AiInsightsCategoryCounts,
  type AiInsightsSnapshotPayload,
  type InsightSeverity,
  type InsightType,
} from "./types";

type GenerateAiInsightsSnapshotInput = {
  generatedBy?: string | null;
  trigger: "manual";
  prismaClient?: PrismaClient;
};

type LiteLlmJsonResponse = {
  choices?: {
    message?: {
      content?: string;
    };
  }[];
};

const SEVERITY_ORDER: Record<InsightSeverity, number> = {
  High: 0,
  Moderate: 1,
  Low: 2,
};

const CATEGORY_ORDER = INSIGHT_CATEGORY_ORDER.reduce<Record<InsightType, number>>(
  (order, category, index) => {
    order[category] = index;
    return order;
  },
  {} as Record<InsightType, number>,
);

function toJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

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
  const choices = body && typeof body === "object" && "choices" in body
    ? (body as LiteLlmJsonResponse).choices
    : null;
  return Array.isArray(choices) ? choices[0]?.message?.content?.trim() ?? "" : "";
}

function parseJsonObject<T>(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced?.[1] ?? trimmed) as T;
}

function sortCards(cards: AiInsightCard[]) {
  return [...cards].sort(
    (left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
      CATEGORY_ORDER[left.insightType] - CATEGORY_ORDER[right.insightType],
  );
}

function withoutNarrative(card: AiInsightCard): NarratorInputCard {
  const { narrative: _narrative, ...cardWithoutNarrative } = card;
  return cardWithoutNarrative;
}

async function callLiteLlmJson<T>(prompt: string, temperature: number) {
  const response = await fetch(getLiteLlmChatCompletionsUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.LITELLM_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getLiteLlmModel("insights"),
      messages: [{ role: "user", content: prompt }],
      temperature,
    }),
  });
  const body = await readResponseBody(response);

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error?: unknown }).error)
        : body && typeof body === "object" && "message" in body
          ? String((body as { message?: unknown }).message)
          : "Unknown error";
    throw new Error(message);
  }

  const content = getChoiceContent(body);
  if (!content) throw new Error("LiteLLM returned an empty response.");
  return parseJsonObject<T>(content);
}

async function narrateCard(card: AiInsightCard) {
  const prompt = buildInsightNarratorPrompt(withoutNarrative(card));
  const response = await callLiteLlmJson<{ narrative?: unknown }>(
    prompt,
    INSIGHT_NARRATOR_TEMPERATURE,
  );
  return typeof response.narrative === "string" && response.narrative.trim()
    ? response.narrative.trim()
    : card.headline;
}

async function narrateExecutiveBrief(cardSummaries: ExecutiveBriefCardSummary[]) {
  const prompt = buildExecutiveBriefPrompt(cardSummaries);
  const response = await callLiteLlmJson<{ executiveBrief?: unknown }>(
    prompt,
    EXECUTIVE_BRIEF_TEMPERATURE,
  );
  return typeof response.executiveBrief === "string" ? response.executiveBrief.trim() : "";
}

function buildCardSummaries(cards: AiInsightCard[]): ExecutiveBriefCardSummary[] {
  return cards.map((card) => ({
    insightType: card.insightType,
    severity: card.severity,
    headline: card.headline,
    supportingNumbers: card.supportingNumbers,
  }));
}

function buildCategoryCounts(cards: AiInsightCard[]): AiInsightsCategoryCounts {
  const counts = INSIGHT_CATEGORY_ORDER.reduce<AiInsightsCategoryCounts>(
    (current, category) => {
      current[category] = 0;
      return current;
    },
    { all: cards.length } as AiInsightsCategoryCounts,
  );

  cards.forEach((card) => {
    counts[card.insightType] += 1;
  });

  return counts;
}

export async function generateAiInsightsSnapshot({
  generatedBy = null,
  trigger,
  prismaClient = defaultPrisma,
}: GenerateAiInsightsSnapshotInput): Promise<ai_insights_snapshot> {
  const startedAt = Date.now();
  const modelUsed = getLiteLlmModel("insights");

  const analyserResults = await Promise.all(
    AI_INSIGHT_ANALYSERS.map(async (analyser) => {
      try {
        return {
          ok: true as const,
          cards: await analyser(prismaClient),
        };
      } catch (error) {
        console.error("AI insights analyser failed", analyser.name, error);
        return {
          ok: false as const,
          cards: [] as AiInsightCard[],
        };
      }
    }),
  );

  const failedAnalyserCount = analyserResults.filter((result) => !result.ok).length;
  if (failedAnalyserCount > AI_INSIGHT_ANALYSERS.length / 2) {
    throw new Error("AI insights snapshot aborted because too many analysers failed.");
  }

  const cards = sortCards(analyserResults.flatMap((result) => result.cards));
  const narratedCards = await Promise.all(
    cards.map(async (card) => {
      try {
        return {
          ...card,
          narrative: await narrateCard(card),
        };
      } catch (error) {
        console.error("AI insights narrator failed", card.id, error);
        return {
          ...card,
          narrative: card.headline,
        };
      }
    }),
  );

  let executiveBrief = "";
  try {
    executiveBrief = await narrateExecutiveBrief(buildCardSummaries(narratedCards));
  } catch (error) {
    console.error("AI insights executive brief failed", error);
  }

  const payload: AiInsightsSnapshotPayload = {
    version: "ai-insights-v1",
    promptVersion: PROMPT_VERSION,
    generatedAt: new Date().toISOString(),
    executiveBrief,
    cards: narratedCards,
    categoryCounts: buildCategoryCounts(narratedCards),
  };

  return prismaClient.ai_insights_snapshot.create({
    data: {
      generated_by: generatedBy,
      trigger,
      payload: toJson(payload),
      model_used: modelUsed,
      prompt_version: PROMPT_VERSION,
      duration_ms: Date.now() - startedAt,
    },
  });
}
