import type { Prisma } from "@prisma/client";

export type ExtractedActionPlan = {
  reference?: string | null;
  finding_reference?: string | null;
  description?: string | null;
  priority?: "High" | "Moderate" | "Low" | null;
  target_date?: string | null;
  entity_ids?: string[];
  entities?: string[];
  owner_names?: string[];
  owner_user_id?: string | null;
  follow_up_auditor_user_id?: string | null;
  required_evidence?: string | null;
};

export type ExtractedFinding = {
  finding_type?: "Finding" | "OpportunityForImprovement" | null;
  external_ref?: string | null;
  title?: string | null;
  description?: string | null;
  root_cause?: string | null;
  potential_impact?: string | null;
  recommendation?: string | null;
  priority?: "High" | "Moderate" | "Low" | null;
  control_rating?: "Effective" | "PartiallyEffective" | "NotEffective" | null;
  action_plans?: ExtractedActionPlan[];
};

export type ExtractedControlArea = {
  title?: string | null;
  rating?: "Effective" | "PartiallyEffective" | "NotEffective" | null;
  control_rating?: "Effective" | "PartiallyEffective" | "NotEffective" | null;
  finding_reference?: string | null;
};

export type ExtractedAuditData = {
  audit_name?: string | null;
  name?: string | null;
  reference_number?: string | null;
  audit_type?: "IT" | "RegulatoryIT" | "Operations" | "RegulatoryOperations" | "External" | null;
  opinion_rating?: "Satisfactory" | "NeedsImprovement" | "Unsatisfactory" | null;
  report_issue_date?: string | null;
  entity_ids?: string[];
  entities_mentioned?: string[];
  executive_summary?: string | null;
  control_areas?: ExtractedControlArea[];
  findings?: ExtractedFinding[];
  action_plans?: ExtractedActionPlan[];
};

export function toPrismaJson(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export function asExtractionData(value: unknown): ExtractedAuditData {
  if (!value || typeof value !== "object") {
    return {};
  }

  return value as ExtractedAuditData;
}

export function mergeExtractionData(
  extractedJson: unknown,
  humanEditsJson: unknown,
): ExtractedAuditData {
  return deepMerge(asExtractionData(extractedJson), asExtractionData(humanEditsJson));
}

export function getExtractionCounts(value: unknown) {
  const data = asExtractionData(value);
  const findingCount = data.findings?.length ?? 0;
  const nestedActionPlanCount =
    data.findings?.reduce((count, finding) => count + (finding.action_plans?.length ?? 0), 0) ?? 0;

  return {
    control_area_count: data.control_areas?.length ?? 0,
    finding_count: findingCount,
    action_plan_count: nestedActionPlanCount + (data.action_plans?.length ?? 0),
  };
}

export function nullableString(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function parseNullableDate(value: string | null | undefined) {
  const trimmed = nullableString(value);
  if (!trimmed) {
    return null;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function deepMerge<T>(base: T, override: unknown): T {
  if (Array.isArray(base) || Array.isArray(override)) {
    return (override ?? base) as T;
  }

  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override === undefined ? base : override) as T;
  }

  const output: Record<string, unknown> = { ...base };
  Object.entries(override).forEach(([key, value]) => {
    output[key] = key in output ? deepMerge(output[key], value) : value;
  });

  return output as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
