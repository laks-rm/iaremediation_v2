"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import AppLayout from "../../../../components/AppLayout";
import EntityMultiSelect from "../../../../components/EntityMultiSelect";
import { CONTROL_RATING_LABELS } from "../../../../lib/constants";

type Status = "Pending" | "Approved" | "Rejected";
type AuditType = "IT" | "RegulatoryIT" | "Operations" | "RegulatoryOperations" | "External";
type OpinionRating = "Satisfactory" | "NeedsImprovement" | "Unsatisfactory";
type Priority = "High" | "Moderate" | "Low";
type ControlRating = "Effective" | "PartiallyEffective" | "NotEffective";

type EntityOption = {
  id: string;
  code: string;
  full_name: string;
};

type UserOption = {
  id: string;
  name: string;
  email: string;
  department: string | null;
  job_title: string | null;
  team_l2: string | null;
  is_internal_auditor: boolean;
};

type OwnerHintUser = {
  id: string;
  name: string;
};

type OwnerSuggestionState = {
  ownerAiSuggested: boolean;
  ownerHintUser: OwnerHintUser | null;
};

type ExtractedActionPlan = {
  reference?: string | null;
  finding_reference?: string | null;
  description?: string | null;
  priority?: Priority | null;
  target_date?: string | null;
  entity_ids?: string[];
  entities?: string[];
  entity_refs?: string[];
  entity_codes?: string[];
  owner_names?: string[];
  owner_user_id?: string | null;
  follow_up_auditor_user_id?: string | null;
  required_evidence?: string | null;
};

type ExtractedFinding = {
  external_ref?: string | null;
  title?: string | null;
  description?: string | null;
  root_cause?: string | null;
  potential_impact?: string | null;
  recommendation?: string | null;
  priority?: Priority | null;
  control_rating?: ControlRating | null;
  action_plans?: ExtractedActionPlan[];
};

type ExtractedControlArea = {
  title?: string | null;
  rating?: ControlRating | null;
  control_rating?: ControlRating | null;
  finding_reference?: string | null;
};

type ExtractedAuditData = {
  audit_name?: string | null;
  name?: string | null;
  reference_number?: string | null;
  audit_type?: AuditType | null;
  opinion_rating?: OpinionRating | null;
  report_issue_date?: string | null;
  entity_ids?: string[];
  entities?: string[];
  entity_refs?: string[];
  entity_codes?: string[];
  entities_mentioned?: string[];
  executive_summary?: string | null;
  control_areas?: ExtractedControlArea[];
  findings?: ExtractedFinding[];
};

type ExtractionDetail = {
  id: string;
  filename: string;
  status: Status;
  model_used: string;
  prompt_version: string;
  extracted_json: ExtractedAuditData;
  human_edits_json: ExtractedAuditData | null;
  rejection_reason: string | null;
  created_audit_id: string | null;
  created_at: string;
  created_by: {
    name: string;
    email: string;
  };
  counts: {
    control_area_count: number;
    finding_count: number;
    action_plan_count: number;
  };
};

const AUDIT_TYPES: AuditType[] = ["IT", "RegulatoryIT", "Operations", "RegulatoryOperations", "External"];
const OPINION_RATINGS: OpinionRating[] = ["Satisfactory", "NeedsImprovement", "Unsatisfactory"];
const PRIORITIES: Priority[] = ["High", "Moderate", "Low"];
const CONTROL_RATINGS: ControlRating[] = ["Effective", "PartiallyEffective", "NotEffective"];

async function readResponseBody(response: Response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function responseError(body: unknown, fallback: string) {
  return typeof body === "object" && body && "error" in body ? String(body.error) : fallback;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusClass(status: string) {
  return `ai-status ai-status--${status.toLowerCase()}`;
}

function auditBadgeClass(kind: "priority" | "control", value: string | null | undefined) {
  return `audit-badge audit-badge--${kind}-${(value ?? "none").toLowerCase()}`;
}

function countActionPlans(data: ExtractedAuditData) {
  return (data.findings ?? []).reduce((count, finding) => count + (finding.action_plans?.length ?? 0), 0);
}

function mergeData(base: ExtractedAuditData, edits: ExtractedAuditData | null) {
  return {
    ...base,
    ...(edits ?? {}),
    control_areas: edits?.control_areas ?? base.control_areas ?? [],
    findings: edits?.findings ?? base.findings ?? [],
    entity_ids: edits?.entity_ids ?? base.entity_ids ?? [],
  };
}

function normalizeEntityReference(value: string) {
  return value.trim().toLowerCase();
}

function cleanEntityReferences(values: string[] | undefined) {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function firstEntityReferences(...candidates: Array<string[] | undefined>) {
  return candidates.map(cleanEntityReferences).find((references) => references.length > 0) ?? [];
}

function referencesAreEntityIds(references: string[] | undefined, entities: EntityOption[]) {
  const cleaned = cleanEntityReferences(references);
  if (cleaned.length === 0) return false;

  const entityIds = new Set(entities.map((entity) => entity.id));
  return cleaned.every((reference) => entityIds.has(reference));
}

function matchEntityReferences(references: string[], entities: EntityOption[]) {
  const selectedIds: string[] = [];
  const unmatched: string[] = [];

  for (const reference of cleanEntityReferences(references)) {
    const normalizedReference = normalizeEntityReference(reference);
    const matchedEntity =
      entities.find((entity) => normalizeEntityReference(entity.code) === normalizedReference) ??
      entities.find((entity) => normalizeEntityReference(entity.full_name) === normalizedReference);

    if (matchedEntity) {
      if (!selectedIds.includes(matchedEntity.id)) {
        selectedIds.push(matchedEntity.id);
      }
    } else {
      unmatched.push(reference);
    }
  }

  return { selectedIds, unmatched };
}

function auditLevelEntityReferences(data: ExtractedAuditData) {
  return firstEntityReferences(data.entity_ids, data.entities, data.entity_refs, data.entity_codes, data.entities_mentioned);
}

function actionPlanEntityReferences(actionPlan: ExtractedActionPlan) {
  return firstEntityReferences(actionPlan.entity_ids, actionPlan.entities, actionPlan.entity_refs, actionPlan.entity_codes);
}

function hydrateEntitySelections(data: ExtractedAuditData, entities: EntityOption[]) {
  const auditReferences = auditLevelEntityReferences(data);
  const auditMatch = referencesAreEntityIds(data.entity_ids, entities)
    ? { selectedIds: cleanEntityReferences(data.entity_ids), unmatched: [] }
    : matchEntityReferences(auditReferences, entities);
  const actionPlanUnmatchedEntities: Record<string, string[]> = {};

  return {
    data: {
      ...data,
      entity_ids: auditMatch.selectedIds,
      findings: (data.findings ?? []).map((finding, findingIndex) => ({
        ...finding,
        action_plans: (finding.action_plans ?? []).map((actionPlan, actionPlanIndex) => {
          const planReferences = actionPlanEntityReferences(actionPlan);
          const planMatch = referencesAreEntityIds(actionPlan.entity_ids, entities)
            ? { selectedIds: cleanEntityReferences(actionPlan.entity_ids), unmatched: [] }
            : matchEntityReferences(planReferences.length > 0 ? planReferences : auditReferences, entities);
          const unmatchedKey = `${findingIndex}:${actionPlanIndex}`;

          if (planMatch.unmatched.length > 0) {
            actionPlanUnmatchedEntities[unmatchedKey] = planMatch.unmatched;
          }

          return {
            ...actionPlan,
            entity_ids: planMatch.selectedIds,
          };
        }),
      })),
    },
    auditUnmatchedEntities: auditMatch.unmatched,
    actionPlanUnmatchedEntities,
  };
}

function normalizeOwnerName(value: string) {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

function tokenOverlapScore(extractedName: string, candidate: string) {
  const extractedTokens = normalizeOwnerName(extractedName).split(" ").filter(Boolean);
  const candidateTokens = normalizeOwnerName(candidate).split(" ").filter(Boolean);
  const largerTokenCount = Math.max(extractedTokens.length, candidateTokens.length);

  if (largerTokenCount === 0) return 0;

  const candidateTokenSet = new Set(candidateTokens);
  const matchingTokens = extractedTokens.filter((token) => candidateTokenSet.has(token)).length;
  return matchingTokens / largerTokenCount;
}

function scoreOwnerCandidate(extractedName: string, candidate: string) {
  const normalizedExtracted = normalizeOwnerName(extractedName);
  const normalizedCandidate = normalizeOwnerName(candidate);

  if (!normalizedExtracted || !normalizedCandidate) return 0;
  if (normalizedExtracted === normalizedCandidate) return 1;
  if (normalizedCandidate.includes(normalizedExtracted) || normalizedExtracted.includes(normalizedCandidate)) return 0.9;

  return tokenOverlapScore(normalizedExtracted, normalizedCandidate);
}

function fuzzyMatchUser(
  extractedName: string,
  users: { id: string; name: string; email: string }[],
): { user: { id: string; name: string; email: string }; score: number } | null {
  let bestMatch: { user: { id: string; name: string; email: string }; score: number } | null = null;

  for (const user of users) {
    const emailLocalPart = user.email.split("@")[0] ?? "";
    const score = Math.max(
      scoreOwnerCandidate(extractedName, user.name),
      scoreOwnerCandidate(extractedName, emailLocalPart),
    );

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { user, score };
    }
  }

  return bestMatch && bestMatch.score >= 0.5 ? bestMatch : null;
}

function hydrateOwnerSuggestions(data: ExtractedAuditData, users: UserOption[]) {
  const ownerSuggestions: Record<string, OwnerSuggestionState> = {};

  return {
    data: {
      ...data,
      findings: (data.findings ?? []).map((finding, findingIndex) => ({
        ...finding,
        action_plans: (finding.action_plans ?? []).map((actionPlan, actionPlanIndex) => {
          const ownerName = actionPlan.owner_names?.[0]?.trim();
          const ownerKey = `${findingIndex}:${actionPlanIndex}`;

          if (!ownerName || actionPlan.owner_user_id) {
            return actionPlan;
          }

          const match = fuzzyMatchUser(ownerName, users);
          if (!match) {
            return actionPlan;
          }

          if (match.score >= 0.85) {
            ownerSuggestions[ownerKey] = {
              ownerAiSuggested: true,
              ownerHintUser: null,
            };
            return {
              ...actionPlan,
              owner_user_id: match.user.id,
            };
          }

          ownerSuggestions[ownerKey] = {
            ownerAiSuggested: false,
            ownerHintUser: {
              id: match.user.id,
              name: match.user.name,
            },
          };
          return actionPlan;
        }),
      })),
    },
    ownerSuggestions,
  };
}

function userInfoText(user: UserOption | undefined) {
  const parts = [user?.job_title, user?.department, user?.team_l2].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "No department info available";
}

function emptyActionPlan(findingReference?: string | null): ExtractedActionPlan {
  return {
    finding_reference: findingReference ?? null,
    description: "",
    priority: "Moderate",
    target_date: "",
    entity_ids: [],
    owner_names: [],
    owner_user_id: null,
    follow_up_auditor_user_id: null,
    required_evidence: "",
  };
}

export default function ExtractionReviewPage() {
  const params = useParams<{ id: string }>();
  const extractionId = params.id;
  const [extraction, setExtraction] = useState<ExtractionDetail | null>(null);
  const [humanEdits, setHumanEdits] = useState<ExtractedAuditData>({});
  const [entities, setEntities] = useState<EntityOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [followUpAuditors, setFollowUpAuditors] = useState<UserOption[]>([]);
  const [auditUnmatchedEntities, setAuditUnmatchedEntities] = useState<string[]>([]);
  const [actionPlanUnmatchedEntities, setActionPlanUnmatchedEntities] = useState<Record<string, string[]>>({});
  const [ownerSuggestions, setOwnerSuggestions] = useState<Record<string, OwnerSuggestionState>>({});
  const [bulkFollowUpAuditorId, setBulkFollowUpAuditorId] = useState<string | null>(null);
  const [followUpAuditorOverrides, setFollowUpAuditorOverrides] = useState<Record<string, boolean>>({});
  const [expandedFindings, setExpandedFindings] = useState<Set<number>>(new Set([0]));
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState("");
  const [approveProgress, setApproveProgress] = useState<string[]>([]);
  const [createdAuditId, setCreatedAuditId] = useState("");
  const [isRetrying, setIsRetrying] = useState(false);

  const isProcessing =
    extraction?.status === "Pending" &&
    extraction.extracted_json &&
    typeof extraction.extracted_json === "object" &&
    Object.keys(extraction.extracted_json).length === 0;

  const loadExtraction = useCallback(async () => {
    setIsLoading(true);
    const [extractionResponse, optionsResponse] = await Promise.all([
      fetch(`/api/v1/ai/extractions/${extractionId}`),
      fetch("/api/v1/records/new/options"),
    ]);
    const [extractionBody, optionsBody] = await Promise.all([
      readResponseBody(extractionResponse),
      readResponseBody(optionsResponse),
    ]);

    if (!extractionResponse.ok) {
      throw new Error(responseError(extractionBody, "Unable to load extraction."));
    }

    const nextExtraction = (extractionBody as { extraction: ExtractionDetail }).extraction;
    const nextHumanEdits = mergeData(nextExtraction.extracted_json, nextExtraction.human_edits_json);
    setExtraction(nextExtraction);

    if (optionsResponse.ok) {
      const options = optionsBody as {
        entities: EntityOption[];
        users: UserOption[];
        follow_up_auditors: UserOption[];
      };
      const entityHydrated = hydrateEntitySelections(nextHumanEdits, options.entities);
      const ownerHydrated = hydrateOwnerSuggestions(entityHydrated.data, options.users);
      setEntities(options.entities);
      setUsers(options.users);
      setFollowUpAuditors(options.follow_up_auditors);
      setHumanEdits(ownerHydrated.data);
      setAuditUnmatchedEntities(entityHydrated.auditUnmatchedEntities);
      setActionPlanUnmatchedEntities(entityHydrated.actionPlanUnmatchedEntities);
      setOwnerSuggestions(ownerHydrated.ownerSuggestions);
      setBulkFollowUpAuditorId(null);
      setFollowUpAuditorOverrides({});
    } else {
      setHumanEdits(nextHumanEdits);
      setAuditUnmatchedEntities([]);
      setActionPlanUnmatchedEntities({});
      setOwnerSuggestions({});
      setBulkFollowUpAuditorId(null);
      setFollowUpAuditorOverrides({});
    }

    setIsLoading(false);
  }, [extractionId]);

  useEffect(() => {
    loadExtraction().catch((caughtError: Error) => {
      setError(caughtError.message);
      setIsLoading(false);
    });
  }, [loadExtraction]);

  useEffect(() => {
    if (!extraction || !isProcessing) {
      return;
    }

    let pollCount = 0;
    const maxPolls = 36;
    const startTime = Date.now();
    let intervalId: NodeJS.Timeout;

    const poll = async () => {
      pollCount += 1;
      const elapsedMs = Date.now() - startTime;

      if (pollCount > maxPolls || elapsedMs > 180000) {
        clearInterval(intervalId);
        setError("This is taking longer than expected. Refresh the page to check progress.");
        return;
      }

      try {
        const response = await fetch(`/api/v1/ai/extractions/${extractionId}/status`);
        const body = await readResponseBody(response);

        if (!response.ok) {
          return;
        }

        const statusData = body as { id: string; status: Status; rejection_reason: string | null };

        if (statusData.status !== "Pending" || (extraction.extracted_json && Object.keys(extraction.extracted_json).length > 0)) {
          clearInterval(intervalId);
          await loadExtraction();
        }
      } catch {
        return;
      }
    };

    const getInterval = () => {
      const elapsed = Date.now() - startTime;
      return elapsed > 60000 ? 10000 : 5000;
    };

    intervalId = setInterval(poll, getInterval());

    const adjustInterval = setInterval(() => {
      clearInterval(intervalId);
      intervalId = setInterval(poll, getInterval());
    }, 1000);

    return () => {
      clearInterval(intervalId);
      clearInterval(adjustInterval);
    };
  }, [extraction, extractionId, isProcessing, loadExtraction]);

  const counts = useMemo(
    () => ({
      controlAreas: humanEdits.control_areas?.length ?? 0,
      findings: humanEdits.findings?.length ?? 0,
      actionPlans: countActionPlans(humanEdits),
    }),
    [humanEdits],
  );

  function patchData(patch: Partial<ExtractedAuditData>) {
    setHumanEdits((current) => ({ ...current, ...patch }));
  }

  function updateControlArea(index: number, patch: Partial<ExtractedControlArea>) {
    patchData({
      control_areas: (humanEdits.control_areas ?? []).map((area, itemIndex) =>
        itemIndex === index ? { ...area, ...patch } : area,
      ),
    });
  }

  function updateFinding(index: number, patch: Partial<ExtractedFinding>) {
    patchData({
      findings: (humanEdits.findings ?? []).map((finding, itemIndex) =>
        itemIndex === index ? { ...finding, ...patch } : finding,
      ),
    });
  }

  function updateActionPlan(findingIndex: number, actionPlanIndex: number, patch: Partial<ExtractedActionPlan>) {
    patchData({
      findings: (humanEdits.findings ?? []).map((finding, itemIndex) => {
        if (itemIndex !== findingIndex) return finding;
        return {
          ...finding,
          action_plans: (finding.action_plans ?? []).map((actionPlan, planIndex) =>
            planIndex === actionPlanIndex ? { ...actionPlan, ...patch } : actionPlan,
          ),
        };
      }),
    });
  }

  function updateOwner(findingIndex: number, actionPlanIndex: number, ownerUserId: string | null) {
    const ownerKey = `${findingIndex}:${actionPlanIndex}`;
    updateActionPlan(findingIndex, actionPlanIndex, { owner_user_id: ownerUserId });
    setOwnerSuggestions((current) => ({
      ...current,
      [ownerKey]: {
        ownerAiSuggested: false,
        ownerHintUser: null,
      },
    }));
  }

  function acceptOwnerHint(findingIndex: number, actionPlanIndex: number, user: OwnerHintUser) {
    const ownerKey = `${findingIndex}:${actionPlanIndex}`;
    updateActionPlan(findingIndex, actionPlanIndex, { owner_user_id: user.id });
    setOwnerSuggestions((current) => ({
      ...current,
      [ownerKey]: {
        ownerAiSuggested: true,
        ownerHintUser: null,
      },
    }));
  }

  function updateBulkFollowUpAuditor(nextAuditorId: string | null) {
    setBulkFollowUpAuditorId(nextAuditorId);
    setHumanEdits((current) => ({
      ...current,
      findings: (current.findings ?? []).map((finding, findingIndex) => ({
        ...finding,
        action_plans: (finding.action_plans ?? []).map((actionPlan, actionPlanIndex) => {
          const actionPlanKey = `${findingIndex}:${actionPlanIndex}`;
          if (followUpAuditorOverrides[actionPlanKey]) {
            return actionPlan;
          }

          return {
            ...actionPlan,
            follow_up_auditor_user_id: nextAuditorId,
          };
        }),
      })),
    }));
  }

  function updateFollowUpAuditor(findingIndex: number, actionPlanIndex: number, auditorUserId: string | null) {
    const actionPlanKey = `${findingIndex}:${actionPlanIndex}`;
    updateActionPlan(findingIndex, actionPlanIndex, { follow_up_auditor_user_id: auditorUserId });
    setFollowUpAuditorOverrides((current) => ({
      ...current,
      [actionPlanKey]: true,
    }));
  }

  function resetFollowUpAuditorToDefault(findingIndex: number, actionPlanIndex: number) {
    const actionPlanKey = `${findingIndex}:${actionPlanIndex}`;
    updateActionPlan(findingIndex, actionPlanIndex, { follow_up_auditor_user_id: bulkFollowUpAuditorId });
    setFollowUpAuditorOverrides((current) => ({
      ...current,
      [actionPlanKey]: false,
    }));
  }

  async function saveEdits() {
    setIsSaving(true);
    setError("");
    const response = await fetch(`/api/v1/ai/extractions/${extractionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ human_edits_json: humanEdits }),
    });
    const body = await readResponseBody(response);
    setIsSaving(false);

    if (!response.ok) {
      setError(responseError(body, "Unable to save edits."));
      return false;
    }

    setExtraction((body as { extraction: ExtractionDetail }).extraction);
    return true;
  }

  async function approve() {
    setIsApproving(true);
    setError("");
    setApproveProgress(["Saving reviewer edits"]);
    const saved = await saveEdits();
    if (!saved) {
      setIsApproving(false);
      return;
    }
    setApproveProgress((current) => [...current, "Creating audit, findings, action plans, and owners"]);
    const response = await fetch(`/api/v1/ai/extractions/${extractionId}/approve`, { method: "POST" });
    const body = await readResponseBody(response);
    setIsApproving(false);

    if (!response.ok) {
      setError(responseError(body, "Unable to approve extraction."));
      return;
    }

    const auditId = body && typeof body === "object" && "audit_id" in body ? String(body.audit_id) : "";
    setCreatedAuditId(auditId);
    setApproveProgress((current) => [...current, "✓ Records created"]);
    await loadExtraction();
  }

  async function reject() {
    setError("");
    const response = await fetch(`/api/v1/ai/extractions/${extractionId}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: rejectReason }),
    });
    const body = await readResponseBody(response);
    if (!response.ok) {
      setError(responseError(body, "Unable to reject extraction."));
      return;
    }
    setIsRejecting(false);
    await loadExtraction();
  }

  async function retry() {
    setIsRetrying(true);
    setError("");

    try {
      const response = await fetch(`/api/v1/ai/extractions/${extractionId}/retry`, {
        method: "POST",
      });
      const body = await readResponseBody(response);

      if (!response.ok) {
        setError(responseError(body, "Unable to retry extraction."));
        setIsRetrying(false);
        return;
      }

      await loadExtraction();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to retry extraction.");
    } finally {
      setIsRetrying(false);
    }
  }

  if (isLoading) {
    return (
      <AppLayout>
        <div className="ai-page">
          <div className="audits-empty">Loading extraction...</div>
        </div>
      </AppLayout>
    );
  }

  if (!extraction) {
    return (
      <AppLayout>
        <div className="ai-page">
          <Link className="audit-breadcrumb" href="/ai/extractions">← Back to list</Link>
          <div className="auth-error">{error || "Extraction not found."}</div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="ai-page">
        <header className="ai-header">
          <div>
            <Link className="audit-breadcrumb" href="/ai/extractions">← Back to list</Link>
            <h1>{extraction.filename}</h1>
            <span className={statusClass(extraction.status)}>{extraction.status}</span>
          </div>
          {extraction.status === "Pending" && !isProcessing ? (
            <div className="ai-header-actions">
              <button className="button" disabled={isSaving} onClick={saveEdits} type="button">
                {isSaving ? "Saving..." : "Save Edits"}
              </button>
              <button className="button button--primary" disabled={isApproving} onClick={approve} type="button">
                {isApproving ? "Approving..." : "Approve"}
              </button>
              <button className="button button--danger" onClick={() => setIsRejecting(true)} type="button">
                Reject
              </button>
            </div>
          ) : null}
          {extraction.status === "Rejected" ? (
            <div className="ai-header-actions">
              <button className="button button--primary" disabled={isRetrying} onClick={retry} type="button">
                {isRetrying ? "Retrying..." : "Retry Extraction"}
              </button>
            </div>
          ) : null}
        </header>

        {isProcessing ? (
          <section className="ai-processing-banner">
            <div className="ai-progress">
              <span />
              <strong>Processing extraction...</strong>
            </div>
            <p>Claude is reading your PDF. This usually takes 20–60 seconds.</p>
          </section>
        ) : null}

        {error ? <div className="auth-error">{error}</div> : null}
        {createdAuditId ? (
          <section className="ai-success-card">
            <strong>✓ Records created</strong>
            <Link href={`/audits/${createdAuditId}`}>Open created audit →</Link>
          </section>
        ) : null}
        {approveProgress.length > 0 ? (
          <ul className="records-submit-progress">
            {approveProgress.map((item) => <li key={item}>{item}</li>)}
          </ul>
        ) : null}

        {extraction.status === "Rejected" && extraction.rejection_reason ? (
          <section className="ai-rejection-card">
            <strong>Extraction failed</strong>
            <p>{extraction.rejection_reason}</p>
          </section>
        ) : null}

        {isProcessing ? null : (
          <>
            <section className="ai-sense-check">
              <div><strong>{counts.controlAreas}</strong><span>Control areas</span></div>
              <div><strong>{counts.findings}</strong><span>Findings</span></div>
              <div><strong>{counts.actionPlans}</strong><span>Action plans</span></div>
            </section>

            <section className="ai-review-grid">
              <main className="ai-review-main">
                <section className="ai-review-card">
                  <h2>Extracted Audit Data</h2>
              <div className="records-form-grid">
                <ReviewField label="Audit name">
                  <input
                    value={humanEdits.audit_name ?? humanEdits.name ?? ""}
                    onChange={(event) => patchData({ audit_name: event.target.value })}
                  />
                </ReviewField>
                <ReviewField label="Reference number">
                  <input
                    className="audits-mono"
                    value={humanEdits.reference_number ?? ""}
                    onChange={(event) => patchData({ reference_number: event.target.value })}
                  />
                </ReviewField>
                <ReviewField label="Report issue date">
                  <input
                    type="date"
                    value={humanEdits.report_issue_date ?? ""}
                    onChange={(event) => patchData({ report_issue_date: event.target.value })}
                  />
                </ReviewField>
                <div className="record-field record-field--wide">
                  <span>Audit type</span>
                  <Segmented options={AUDIT_TYPES} value={humanEdits.audit_type ?? "IT"} onChange={(audit_type) => patchData({ audit_type })} />
                </div>
                <div className="record-field record-field--wide">
                  <span>Opinion rating</span>
                  <Segmented
                    options={OPINION_RATINGS}
                    value={humanEdits.opinion_rating ?? "Satisfactory"}
                    onChange={(opinion_rating) => patchData({ opinion_rating })}
                  />
                </div>
                <div className="record-field record-field--wide">
                  <span>Entities</span>
                  <EntityMultiSelect
                    entities={entities}
                    selectedIds={humanEdits.entity_ids ?? []}
                    onChange={(entity_ids) => patchData({ entity_ids })}
                  />
                  <UnmatchedEntityChips values={auditUnmatchedEntities} />
                  {humanEdits.entities_mentioned?.length ? (
                    <em>Mentioned: {humanEdits.entities_mentioned.join(", ")}</em>
                  ) : null}
                </div>
                <ReviewField label="Executive summary">
                  <textarea
                    value={humanEdits.executive_summary ?? ""}
                    onChange={(event) => patchData({ executive_summary: event.target.value })}
                  />
                </ReviewField>
              </div>
            </section>

            <section className="ai-review-card">
              <header className="ai-section-header">
                <h2>Control Areas</h2>
                <button
                  className="button"
                  onClick={() =>
                    patchData({
                      control_areas: [...(humanEdits.control_areas ?? []), { title: "", rating: "PartiallyEffective" }],
                    })
                  }
                  type="button"
                >
                  Add
                </button>
              </header>
              <div className="ai-control-editor">
                {(humanEdits.control_areas ?? []).map((area, index) => (
                  <div key={index}>
                    <input value={area.title ?? ""} onChange={(event) => updateControlArea(index, { title: event.target.value })} />
                    <Segmented
                      labels={CONTROL_RATING_LABELS}
                      options={CONTROL_RATINGS}
                      value={area.control_rating ?? area.rating ?? "PartiallyEffective"}
                      onChange={(rating) => updateControlArea(index, { rating })}
                    />
                    <button
                      className="button button--danger"
                      onClick={() =>
                        patchData({
                          control_areas: (humanEdits.control_areas ?? []).filter((_area, itemIndex) => itemIndex !== index),
                        })
                      }
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="ai-review-card">
              <header className="ai-section-header">
                <h2>Findings and Action Plans</h2>
                <div>
                  <button
                    className="button"
                    onClick={() => setExpandedFindings(new Set((humanEdits.findings ?? []).map((_finding, index) => index)))}
                    type="button"
                  >
                    Expand all
                  </button>
                  <button className="button" onClick={() => setExpandedFindings(new Set())} type="button">
                    Collapse all
                  </button>
                </div>
              </header>
              <section className="ai-bulk-follow-up-card">
                <div>
                  <strong>Default follow-up auditor</strong>
                  <p>Applies to all action plans unless individually overridden</p>
                </div>
                <select
                  value={bulkFollowUpAuditorId ?? ""}
                  onChange={(event) => updateBulkFollowUpAuditor(event.target.value || null)}
                >
                  <option value="">Optional — leave unset</option>
                  {followUpAuditors.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </section>
              <div className="ai-finding-editor-stack">
                {(humanEdits.findings ?? []).map((finding, findingIndex) => {
                  const expanded = expandedFindings.has(findingIndex);
                  return (
                    <article className="ai-finding-editor" key={findingIndex}>
                      <button
                        className="ai-finding-editor__header"
                        onClick={() => {
                          const next = new Set(expandedFindings);
                          if (next.has(findingIndex)) next.delete(findingIndex);
                          else next.add(findingIndex);
                          setExpandedFindings(next);
                        }}
                        type="button"
                      >
                        <span className="audit-ref-badge">{finding.external_ref || `F${findingIndex + 1}`}</span>
                        <strong>{finding.title || "Untitled finding"}</strong>
                        <span className={auditBadgeClass("priority", finding.priority)}>{finding.priority ?? "No priority"}</span>
                        <span className={auditBadgeClass("control", finding.control_rating)}>{finding.control_rating ?? "No rating"}</span>
                        <em>{finding.action_plans?.length ?? 0} APs</em>
                        <span>{expanded ? "⌃" : "⌄"}</span>
                      </button>
                      {expanded ? (
                        <div className="ai-finding-editor__body">
                          <div className="records-form-grid">
                            <ReviewField label="External ref">
                              <input value={finding.external_ref ?? ""} onChange={(event) => updateFinding(findingIndex, { external_ref: event.target.value })} />
                            </ReviewField>
                            <ReviewField label="Title">
                              <input value={finding.title ?? ""} onChange={(event) => updateFinding(findingIndex, { title: event.target.value })} />
                            </ReviewField>
                            <div className="record-field record-field--wide">
                              <span>Priority</span>
                              <Segmented options={PRIORITIES} value={finding.priority ?? "Moderate"} onChange={(priority) => updateFinding(findingIndex, { priority })} />
                            </div>
                            <div className="record-field record-field--wide">
                              <span>Control rating</span>
                              <Segmented
                                labels={CONTROL_RATING_LABELS}
                                options={CONTROL_RATINGS}
                                value={finding.control_rating ?? "PartiallyEffective"}
                                onChange={(control_rating) => updateFinding(findingIndex, { control_rating })}
                              />
                            </div>
                            <ReviewField label="Description">
                              <textarea value={finding.description ?? ""} onChange={(event) => updateFinding(findingIndex, { description: event.target.value })} />
                            </ReviewField>
                            <ReviewField label="Root cause">
                              <textarea value={finding.root_cause ?? ""} onChange={(event) => updateFinding(findingIndex, { root_cause: event.target.value })} />
                            </ReviewField>
                            <ReviewField label="Potential impact">
                              <textarea value={finding.potential_impact ?? ""} onChange={(event) => updateFinding(findingIndex, { potential_impact: event.target.value })} />
                            </ReviewField>
                            <ReviewField label="Recommendation">
                              <textarea value={finding.recommendation ?? ""} onChange={(event) => updateFinding(findingIndex, { recommendation: event.target.value })} />
                            </ReviewField>
                          </div>
                          <div className="ai-ap-subcards">
                            {(finding.action_plans ?? []).map((actionPlan, actionPlanIndex) => {
                              const actionPlanKey = `${findingIndex}:${actionPlanIndex}`;
                              const ownerSuggestion = ownerSuggestions[actionPlanKey];
                              const selectedOwner = users.find((user) => user.id === actionPlan.owner_user_id);
                              const followUpAuditorOverridden = Boolean(followUpAuditorOverrides[actionPlanKey]);

                              return (
                                <article className="ai-ap-subcard" key={actionPlanIndex}>
                                  <div className="records-form-grid">
                                    <ReviewField label="AP reference">
                                      <input value={actionPlan.reference ?? ""} onChange={(event) => updateActionPlan(findingIndex, actionPlanIndex, { reference: event.target.value })} />
                                    </ReviewField>
                                    <ReviewField label="Target date">
                                      <input type="date" value={actionPlan.target_date ?? ""} onChange={(event) => updateActionPlan(findingIndex, actionPlanIndex, { target_date: event.target.value })} />
                                    </ReviewField>
                                    <ReviewField label="Description">
                                      <textarea value={actionPlan.description ?? ""} onChange={(event) => updateActionPlan(findingIndex, actionPlanIndex, { description: event.target.value })} />
                                    </ReviewField>
                                    <div className="record-field record-field--wide">
                                      <span>Priority</span>
                                      <Segmented options={PRIORITIES} value={actionPlan.priority ?? "Moderate"} onChange={(priority) => updateActionPlan(findingIndex, actionPlanIndex, { priority })} />
                                    </div>
                                    <div className="record-field record-field--wide">
                                      <span>Entities</span>
                                      <EntityMultiSelect
                                        entities={entities}
                                        selectedIds={actionPlan.entity_ids ?? []}
                                        onChange={(entity_ids) => updateActionPlan(findingIndex, actionPlanIndex, { entity_ids })}
                                      />
                                      <UnmatchedEntityChips values={actionPlanUnmatchedEntities[actionPlanKey] ?? []} />
                                    </div>
                                    <ReviewField label="Owner">
                                      <select value={actionPlan.owner_user_id ?? ""} onChange={(event) => updateOwner(findingIndex, actionPlanIndex, event.target.value || null)}>
                                        <option value="">Unassigned</option>
                                        {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                                      </select>
                                      {ownerSuggestion?.ownerAiSuggested && selectedOwner ? (
                                        <span className="ai-owner-suggested-tag">✦ AI suggested</span>
                                      ) : null}
                                      {selectedOwner ? (
                                        <span className="ai-owner-info-strip">{userInfoText(selectedOwner)}</span>
                                      ) : null}
                                      {ownerSuggestion?.ownerHintUser ? (
                                        <button
                                          className="ai-owner-hint-chip"
                                          onClick={() => acceptOwnerHint(findingIndex, actionPlanIndex, ownerSuggestion.ownerHintUser!)}
                                          type="button"
                                        >
                                          AI suggested: {ownerSuggestion.ownerHintUser.name}
                                        </button>
                                      ) : null}
                                    </ReviewField>
                                    <ReviewField label="Follow-up auditor">
                                      <select value={actionPlan.follow_up_auditor_user_id ?? ""} onChange={(event) => updateFollowUpAuditor(findingIndex, actionPlanIndex, event.target.value || null)}>
                                        <option value="">Optional</option>
                                        {followUpAuditors.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                                      </select>
                                      <FollowUpAuditorIndicator
                                        bulkFollowUpAuditorId={bulkFollowUpAuditorId}
                                        isOverridden={followUpAuditorOverridden}
                                        onReset={() => resetFollowUpAuditorToDefault(findingIndex, actionPlanIndex)}
                                      />
                                    </ReviewField>
                                    <ReviewField label="Required evidence">
                                      <input value={actionPlan.required_evidence ?? ""} onChange={(event) => updateActionPlan(findingIndex, actionPlanIndex, { required_evidence: event.target.value })} />
                                    </ReviewField>
                                  </div>
                                </article>
                              );
                            })}
                            <button
                              className="button"
                              onClick={() =>
                                updateFinding(findingIndex, {
                                  action_plans: [
                                    ...(finding.action_plans ?? []),
                                    {
                                      ...emptyActionPlan(finding.external_ref),
                                      follow_up_auditor_user_id: bulkFollowUpAuditorId,
                                    },
                                  ],
                                })
                              }
                              type="button"
                            >
                              Add Action Plan
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          </main>

          <aside className="ai-review-side">
            <section className="ai-review-card">
              <h2>Extraction Metadata</h2>
              <p>Model: {extraction.model_used}</p>
              <p>Prompt: {extraction.prompt_version}</p>
              <p>Created by: {extraction.created_by.name}</p>
              <p>Created at: {formatDate(extraction.created_at)}</p>
            </section>
          </aside>
        </section>
          </>
        )}

        {isRejecting ? (
          <div className="confirm-dialog__backdrop" role="dialog" aria-modal="true">
            <div className="confirm-dialog">
              <div className="confirm-dialog__body">
                <h2 className="confirm-dialog__title">Reject extraction?</h2>
                <p className="confirm-dialog__message">Add a reason so reviewers know why this extraction was rejected.</p>
                <textarea
                  className="ai-reject-textarea"
                  value={rejectReason}
                  onChange={(event) => setRejectReason(event.target.value)}
                  placeholder="Reason for rejection"
                />
              </div>
              <div className="confirm-dialog__actions">
                <button className="button" onClick={() => setIsRejecting(false)} type="button">Cancel</button>
                <button className="button button--danger" disabled={!rejectReason.trim()} onClick={reject} type="button">Reject</button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </AppLayout>
  );
}

function ReviewField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="record-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Segmented<T extends string>({
  options,
  value,
  labels,
  onChange,
}: {
  options: T[];
  value: T;
  labels?: Partial<Record<T, string>>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="record-segmented">
      {options.map((option) => (
        <button
          className={value === option ? "record-segmented__item record-segmented__item--active" : "record-segmented__item"}
          key={option}
          onClick={() => onChange(option)}
          type="button"
        >
          {labels?.[option] ?? option}
        </button>
      ))}
    </div>
  );
}

function UnmatchedEntityChips({ values }: { values: string[] }) {
  if (values.length === 0) return null;

  return (
    <div className="ai-unmatched-entities">
      {values.map((value) => (
        <span className="ai-unmatched-entity-chip" key={value}>
          Unmatched: {value}
        </span>
      ))}
    </div>
  );
}

function FollowUpAuditorIndicator({
  bulkFollowUpAuditorId,
  isOverridden,
  onReset,
}: {
  bulkFollowUpAuditorId: string | null;
  isOverridden: boolean;
  onReset: () => void;
}) {
  if (isOverridden) {
    return (
      <span className="ai-follow-up-indicator">
        <span>manual</span>
        <button onClick={onReset} type="button">
          Reset to default
        </button>
      </span>
    );
  }

  if (!bulkFollowUpAuditorId) return null;

  return (
    <span className="ai-follow-up-indicator">
      <span>default</span>
    </span>
  );
}
