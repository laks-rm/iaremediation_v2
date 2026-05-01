import type { AiInsightCard, AiInsightSupportingNumber, InsightSeverity, InsightType } from "./types";

export const PROMPT_VERSION = "insights-v1.0";
export const INSIGHT_NARRATOR_TEMPERATURE = 0.2; // Intended LiteLLM temperature for per-card narration.
export const EXECUTIVE_BRIEF_TEMPERATURE = 0.3; // Intended LiteLLM temperature for executive synthesis.

export type NarratorInputCard = Omit<AiInsightCard, "narrative">;

export type ExecutiveBriefCardSummary = {
  insightType: InsightType;
  severity: InsightSeverity;
  headline: string;
  supportingNumbers: AiInsightSupportingNumber[];
};

export function buildInsightNarratorPrompt(card: NarratorInputCard) {
  return `You are writing one grounded narrative for an internal audit remediation insight card.

Task:
Write a concise narrative that explains what was found, why it matters in an audit context, and what the implication is for the team.

Grounding rules:
- Use only the numbers, item references, categories, labels, and claims present in the input JSON.
- Do not invent figures, percentages, item IDs, names, dates, causes, risk themes, or recommendations.
- Do not infer facts that are not directly supported by the input JSON.
- If the input data is insufficient to write a meaningful narrative, return the headline text as the narrative verbatim.
- If findings.closedLast30Days is 0 and insightType is "forward_look", lead with the absence of recent closures as the primary concern. Do not describe it as a routine or mild capacity shortfall.

Style rules:
- Two to three sentences maximum.
- No markdown.
- No bullet points.
- No preamble.
- Plain executive audit language.

Output format:
Respond with valid JSON only. Do not include markdown fences or any explanation outside the JSON object.
The JSON object must have exactly this shape:
{ "narrative": "..." }

Input JSON:
${JSON.stringify(card, null, 2)}`;
}

export function buildExecutiveBriefPrompt(cardSummaries: ExecutiveBriefCardSummary[]) {
  return `You are writing an executive brief for a Chief Audit Executive based on grounded internal audit remediation insight summaries.

Task:
Produce a single paragraph of four to six sentences. Identify the two or three most critical themes across the full card set, name the severity concentration if one exists, and close with the most time-sensitive forward-looking signal.

Grounding rules:
- Use only the insightType, severity, headline, and supportingNumbers values present in the input JSON.
- Do not invent figures, percentages, item IDs, names, dates, causes, risk themes, or recommendations.
- Do not infer facts that are not directly supported by the input JSON.
- If the input data is insufficient to write a meaningful brief, return a brief that says only that the available insights are insufficient for a reliable executive synthesis.

Style rules:
- Single paragraph only.
- Four to six sentences.
- No markdown.
- No bullet points.
- No headers.
- Plain prose suitable for a Chief Audit Executive.

Output format:
Respond with valid JSON only. Do not include markdown fences or any explanation outside the JSON object.
The JSON object must have exactly this shape:
{ "executiveBrief": "..." }

Input JSON:
${JSON.stringify(cardSummaries, null, 2)}`;
}
