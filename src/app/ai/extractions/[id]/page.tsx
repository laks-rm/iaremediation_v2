"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import AppLayout from "../../../../components/AppLayout";

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
  is_internal_auditor: boolean;
};

type ExtractedActionPlan = {
  reference?: string | null;
  finding_reference?: string | null;
  description?: string | null;
  priority?: Priority | null;
  target_date?: string | null;
  entity_ids?: string[];
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
  const [expandedFindings, setExpandedFindings] = useState<Set<number>>(new Set([0]));
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState("");
  const [approveProgress, setApproveProgress] = useState<string[]>([]);
  const [createdAuditId, setCreatedAuditId] = useState("");

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
    setExtraction(nextExtraction);
    setHumanEdits(mergeData(nextExtraction.extracted_json, nextExtraction.human_edits_json));

    if (optionsResponse.ok) {
      const options = optionsBody as {
        entities: EntityOption[];
        users: UserOption[];
        follow_up_auditors: UserOption[];
      };
      setEntities(options.entities);
      setUsers(options.users);
      setFollowUpAuditors(options.follow_up_auditors);
    }

    setIsLoading(false);
  }, [extractionId]);

  useEffect(() => {
    loadExtraction().catch((caughtError: Error) => {
      setError(caughtError.message);
      setIsLoading(false);
    });
  }, [loadExtraction]);

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
          {extraction.status === "Pending" ? (
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
        </header>

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
                  <EntityCheckboxes
                    entities={entities}
                    selectedIds={humanEdits.entity_ids ?? []}
                    onChange={(entity_ids) => patchData({ entity_ids })}
                  />
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
                            {(finding.action_plans ?? []).map((actionPlan, actionPlanIndex) => (
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
                                    <EntityCheckboxes
                                      entities={entities}
                                      selectedIds={actionPlan.entity_ids ?? []}
                                      onChange={(entity_ids) => updateActionPlan(findingIndex, actionPlanIndex, { entity_ids })}
                                    />
                                  </div>
                                  <ReviewField label="Owner">
                                    <select value={actionPlan.owner_user_id ?? ""} onChange={(event) => updateActionPlan(findingIndex, actionPlanIndex, { owner_user_id: event.target.value || null })}>
                                      <option value="">Unassigned</option>
                                      {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                                    </select>
                                  </ReviewField>
                                  <ReviewField label="Follow-up auditor">
                                    <select value={actionPlan.follow_up_auditor_user_id ?? ""} onChange={(event) => updateActionPlan(findingIndex, actionPlanIndex, { follow_up_auditor_user_id: event.target.value || null })}>
                                      <option value="">Optional</option>
                                      {followUpAuditors.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                                    </select>
                                  </ReviewField>
                                  <ReviewField label="Required evidence">
                                    <input value={actionPlan.required_evidence ?? ""} onChange={(event) => updateActionPlan(findingIndex, actionPlanIndex, { required_evidence: event.target.value })} />
                                  </ReviewField>
                                </div>
                              </article>
                            ))}
                            <button
                              className="button"
                              onClick={() =>
                                updateFinding(findingIndex, {
                                  action_plans: [...(finding.action_plans ?? []), emptyActionPlan(finding.external_ref)],
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
  onChange,
}: {
  options: T[];
  value: T;
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
          {option}
        </button>
      ))}
    </div>
  );
}

function EntityCheckboxes({
  entities,
  selectedIds,
  onChange,
}: {
  entities: EntityOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div className="record-checkbox-grid">
      {entities.map((entity) => (
        <label className="record-checkbox" key={entity.id}>
          <input
            checked={selectedIds.includes(entity.id)}
            onChange={(event) => {
              if (event.target.checked) {
                onChange([...selectedIds, entity.id]);
              } else {
                onChange(selectedIds.filter((id) => id !== entity.id));
              }
            }}
            type="checkbox"
          />
          <span>
            <strong>{entity.code}</strong>
            <em>{entity.full_name}</em>
          </span>
        </label>
      ))}
    </div>
  );
}
