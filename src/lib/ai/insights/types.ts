import type { ActionPlanStatus, Priority } from "@prisma/client";

export type InsightType =
  | "risk_concentration"
  | "bottleneck"
  | "quality_gap"
  | "forward_look"
  | "anomaly"
  | "risk_mitigated";

export const INSIGHT_CATEGORY_ORDER: InsightType[] = [
  "risk_concentration",
  "bottleneck",
  "quality_gap",
  "forward_look",
  "anomaly",
  "risk_mitigated",
];

export type InsightSeverity = "High" | "Moderate" | "Low";
export type InsightConfidence = "High" | "Medium" | "Low";

export type AiInsightRelatedItems = {
  actionPlanIds: string[];
  findingIds: string[];
};

export type AiInsightDrillThroughFilter = {
  ids?: string[];
  status?: ActionPlanStatus;
  priority?: Priority;
  audit_id?: string;
  owner_id?: string;
  department?: string;
  created_via?: string;
  due_bucket?: string;
  search?: string;
};

export type AiInsightSupportingNumber = {
  label: string;
  value: string | number;
};

export type AiInsightCard = {
  id: string;
  cardVersion: string;
  insightType: InsightType;
  severity: InsightSeverity;
  confidence: InsightConfidence;
  headline: string;
  narrative: string;
  findings: Record<string, unknown>;
  relatedItems: AiInsightRelatedItems;
  drillThroughFilter: AiInsightDrillThroughFilter;
  supportingNumbers: AiInsightSupportingNumber[];
};

export type AiInsightsCategoryCounts = Record<InsightType | "all", number>;

export type AiInsightsSnapshotPayload = {
  version: "ai-insights-v1";
  promptVersion: string;
  generatedAt: string;
  executiveBrief: string;
  cards: AiInsightCard[];
  categoryCounts: AiInsightsCategoryCounts;
};

export type ThemeClusterInput = {
  actionPlanId: string;
  findingId: string;
  title: string;
  description: string | null;
};

export type ThemeCluster = {
  theme: string;
  terms: string[];
  items: ThemeClusterInput[];
};

export type ClusterByThemeOptions = {
  minItems?: number;
  minSharedTerms?: number;
};
