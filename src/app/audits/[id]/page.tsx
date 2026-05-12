"use client";

import { getSession } from "next-auth/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AppLayout from "../../../components/AppLayout";
import ConfirmDialog from "../../../components/ConfirmDialog";
import EmptyState from "../../../components/EmptyState";
import { useToast } from "../../../components/Toast";
import { AUDIT_TYPE_LABELS, CONTROL_RATING_LABELS, STATUS_LABELS } from "../../../lib/constants";

type Role = "AuditTeam" | "Viewer" | "Auditee" | "Pending";
type AuditType = keyof typeof AUDIT_TYPE_LABELS;
type OpinionRating = "Satisfactory" | "NeedsImprovement" | "Unsatisfactory";
type Priority = "High" | "Moderate" | "Low";
type ControlRating = "Effective" | "PartiallyEffective" | "NotEffective";
type Status =
  | "NotStarted"
  | "InProgress"
  | "PendingValidation"
  | "Closed"
  | "RiskAccepted"
  | "Dropped";

type AuditDetail = {
  id: string;
  name: string;
  reference_number: string | null;
  audit_type: AuditType;
  opinion_rating: OpinionRating | null;
  report_issue_date: string | null;
  executive_summary: string | null;
  report_pdf_filename: string | null;
  report_file_missing?: boolean;
  created_at: string;
  created_by: {
    id: string;
    name: string;
    email: string;
  };
  audit_entities: {
    entity: {
      id: string;
      code: string;
      full_name: string;
    };
  }[];
  control_areas: {
    id: string;
    title: string;
    control_rating: ControlRating | null;
    finding_ref: string | null;
  }[];
  findings: FindingDetail[];
};

type FindingDetail = {
  id: string;
  external_ref: string | null;
  title: string;
  description: string | null;
  root_cause: string | null;
  recommendation: string | null;
  priority: Priority | null;
  control_rating: ControlRating | null;
  action_plan_count: number;
  action_plans: {
    id: string;
    display_id: string;
    description: string;
    status: Status;
    current_target_date: string | null;
    action_plan_owners: {
      user: {
        id: string;
        name: string;
        email: string;
        department: string | null;
      };
    }[];
  }[];
};

type EditableAuditField = "name" | "reference_number" | "opinion_rating" | "executive_summary" | "audit_type";

const CLOSED_STATUSES: Status[] = ["Closed", "Dropped", "RiskAccepted"];
const CONTROL_RATINGS: ControlRating[] = [
  "Effective",
  "PartiallyEffective",
  "NotEffective",
];
const PRIORITIES: Priority[] = ["High", "Moderate", "Low"];
const AUDIT_TYPES: AuditType[] = ["IT", "RegulatoryIT", "Operations", "RegulatoryOperations", "External"];

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

function formatDate(value: string | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function badgeClass(kind: "type" | "opinion" | "control" | "priority" | "status", value: string | null) {
  return `audit-badge audit-badge--${kind}-${(value ?? "none").toLowerCase()}`;
}

function getSnippet(value: string | null, expanded: boolean) {
  if (!value) return "Not provided.";
  if (expanded || value.length <= 220) return value;
  return `${value.slice(0, 220)}...`;
}

export default function AuditDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const auditId = params.id;
  const [audit, setAudit] = useState<AuditDetail | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingField, setEditingField] = useState<EditableAuditField | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [expandedFindings, setExpandedFindings] = useState<Set<string>>(new Set());
  const [editingFindingId, setEditingFindingId] = useState("");
  const [findingDraft, setFindingDraft] = useState<Partial<FindingDetail>>({});
  const [deleteAuditOpen, setDeleteAuditOpen] = useState(false);
  const [deleteFindingId, setDeleteFindingId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [isReplacingReport, setIsReplacingReport] = useState(false);
  const [removeReportOpen, setRemoveReportOpen] = useState(false);
  const [isUploadingReport, setIsUploadingReport] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [addingEntity, setAddingEntity] = useState(false);
  const [removingEntityId, setRemovingEntityId] = useState("");
  const [allEntities, setAllEntities] = useState<{ id: string; code: string; full_name: string; is_active: boolean }[]>([]);
  const [editingAuditType, setEditingAuditType] = useState(false);

  const loadAudit = useCallback(async () => {
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/v1/audits/${auditId}`);
      const body = await readResponseBody(response);
      if (!response.ok) {
        throw new Error(responseError(body, "Unable to load audit."));
      }
      setAudit((body as { audit: AuditDetail }).audit);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to load audit.");
    } finally {
      setIsLoading(false);
    }
  }, [auditId]);

  useEffect(() => {
    getSession().then((session) => {
      setRole(session?.user?.role ?? null);
      setIsAdmin(session?.user?.is_admin === true);
    });
  }, []);

  useEffect(() => {
    loadAudit();
  }, [loadAudit]);

  const canEdit = role === "AuditTeam";

  useEffect(() => {
    async function fetchEntities() {
      try {
        const response = await fetch("/api/v1/entities");
        const body = await readResponseBody(response);
        if (response.ok) {
          setAllEntities((body as { entities: typeof allEntities }).entities);
        }
      } catch {
        // Silently fail - entity editing will just not be available
      }
    }
    if (canEdit) {
      fetchEntities();
    }
  }, [canEdit]);
  const allActionPlans = useMemo(
    () => audit?.findings.flatMap((finding) => finding.action_plans) ?? [],
    [audit],
  );
  const stats = useMemo(() => {
    const open = allActionPlans.filter((plan) => !CLOSED_STATUSES.includes(plan.status)).length;
    const closed = allActionPlans.filter((plan) => CLOSED_STATUSES.includes(plan.status)).length;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const overdue = allActionPlans.filter(
      (plan) =>
        plan.current_target_date &&
        new Date(plan.current_target_date) < today &&
        !CLOSED_STATUSES.includes(plan.status),
    ).length;
    const statusCounts = allActionPlans.reduce<Record<string, number>>((counts, plan) => {
      counts[plan.status] = (counts[plan.status] ?? 0) + 1;
      return counts;
    }, {});

    return {
      totalFindings: audit?.findings.length ?? 0,
      totalActionPlans: allActionPlans.length,
      open,
      overdue,
      closed,
      statusCounts,
    };
  }, [allActionPlans, audit?.findings.length]);
  const controlCounts = useMemo(() => {
    return CONTROL_RATINGS.reduce<Record<ControlRating, number>>(
      (counts, rating) => {
        counts[rating] = audit?.control_areas.filter((area) => area.control_rating === rating).length ?? 0;
        return counts;
      },
      { Effective: 0, PartiallyEffective: 0, NotEffective: 0 },
    );
  }, [audit?.control_areas]);

  function startEdit(field: EditableAuditField, value: string | null) {
    setEditingField(field);
    setDraftValue(value ?? "");
  }

  async function saveAuditField() {
    if (!editingField) return;

    const response = await fetch(`/api/v1/audits/${auditId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [editingField]: draftValue }),
    });
    const body = await readResponseBody(response);
    if (!response.ok) {
      setError(responseError(body, "Unable to save audit."));
      return;
    }
    setAudit((body as { audit: AuditDetail }).audit);
    setEditingField(null);
  }

  async function saveAuditType(newAuditType: AuditType) {
    const response = await fetch(`/api/v1/audits/${auditId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audit_type: newAuditType }),
    });
    const body = await readResponseBody(response);
    if (!response.ok) {
      toast.error(responseError(body, "Unable to update audit type."));
      setEditingAuditType(false);
      return;
    }
    setAudit((body as { audit: AuditDetail }).audit);
    setEditingAuditType(false);
    toast.success("Audit type updated successfully");
  }

  function startFindingEdit(finding: FindingDetail) {
    setEditingFindingId(finding.id);
    setFindingDraft({
      external_ref: finding.external_ref,
      title: finding.title,
      description: finding.description,
      recommendation: finding.recommendation,
      control_rating: finding.control_rating,
    });
  }

  async function saveFinding(findingId: string) {
    const response = await fetch(`/api/v1/findings/${findingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(findingDraft),
    });
    const body = await readResponseBody(response);
    if (!response.ok) {
      setError(responseError(body, "Unable to save finding."));
      return;
    }
    setEditingFindingId("");
    await loadAudit();
  }

  async function deleteAudit() {
    const response = await fetch(`/api/v1/audits/${auditId}`, { method: "DELETE" });
    const body = await readResponseBody(response);
    if (!response.ok) {
      setError(responseError(body, "Unable to delete audit."));
      setDeleteAuditOpen(false);
      return;
    }
    router.push("/audits");
  }

  async function deleteFinding() {
    if (!deleteFindingId) return;
    const response = await fetch(`/api/v1/findings/${deleteFindingId}`, { method: "DELETE" });
    const body = await readResponseBody(response);
    if (!response.ok) {
      setError(responseError(body, "Unable to delete finding."));
      setDeleteFindingId("");
      return;
    }
    setDeleteFindingId("");
    await loadAudit();
  }

  async function handleReplaceReport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsReplacingReport(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`/api/v1/audits/${auditId}/upload-report`, {
        method: "POST",
        body: formData,
      });
      const body = await readResponseBody(response);
      if (!response.ok) {
        toast.error(responseError(body, "Unable to replace report."));
        return;
      }
      toast.success("Report replaced successfully!");
      await loadAudit();
    } catch (caughtError) {
      toast.error(caughtError instanceof Error ? caughtError.message : "Unable to replace report.");
    } finally {
      setIsReplacingReport(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function handleUploadReport(file: File) {
    setIsUploadingReport(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`/api/v1/audits/${auditId}/upload-report`, {
        method: "POST",
        body: formData,
      });
      const body = await readResponseBody(response);
      if (!response.ok) {
        toast.error(responseError(body, "Unable to upload report."));
        return;
      }
      toast.success("Report uploaded successfully!");
      await loadAudit();
    } catch (caughtError) {
      toast.error(caughtError instanceof Error ? caughtError.message : "Unable to upload report.");
    } finally {
      setIsUploadingReport(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function handleFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    
    if (audit?.report_pdf_filename) {
      handleReplaceReport(event);
    } else {
      handleUploadReport(file);
    }
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingOver(true);
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingOver(false);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingOver(false);
    
    const file = event.dataTransfer.files?.[0];
    if (file && file.type === "application/pdf") {
      handleUploadReport(file);
    } else {
      toast.error("Please upload a PDF file.");
    }
  }

  async function removeReport() {
    const response = await fetch(`/api/v1/audits/${auditId}/upload-report`, { method: "DELETE" });
    const body = await readResponseBody(response);
    if (!response.ok) {
      toast.error(responseError(body, "Unable to remove report."));
      setRemoveReportOpen(false);
      return;
    }
    toast.success("Report removed successfully!");
    setRemoveReportOpen(false);
    await loadAudit();
  }

  async function addEntity(entityId: string) {
    if (!audit) return;
    const currentEntityIds = audit.audit_entities.map((ae) => ae.entity.id);
    const newEntityIds = [...currentEntityIds, entityId];

    const response = await fetch(`/api/v1/audits/${auditId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_ids: newEntityIds }),
    });
    const body = await readResponseBody(response);
    if (!response.ok) {
      setError(responseError(body, "Unable to add entity."));
      return;
    }
    setAudit((body as { audit: AuditDetail }).audit);
    setAddingEntity(false);
    toast.success("Entity added successfully");
  }

  async function removeEntity() {
    if (!audit || !removingEntityId) return;
    const currentEntityIds = audit.audit_entities.map((ae) => ae.entity.id);
    const newEntityIds = currentEntityIds.filter((id) => id !== removingEntityId);

    const response = await fetch(`/api/v1/audits/${auditId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_ids: newEntityIds }),
    });
    const body = await readResponseBody(response);
    if (!response.ok) {
      setError(responseError(body, "Unable to remove entity."));
      setRemovingEntityId("");
      return;
    }
    setAudit((body as { audit: AuditDetail }).audit);
    setRemovingEntityId("");
    toast.success("Entity removed successfully");
  }

  if (isLoading) {
    return (
      <AppLayout>
        <div className="audit-detail-page">
          <div className="audit-detail-skeleton" />
          <div className="audit-detail-skeleton audit-detail-skeleton--grid" />
        </div>
      </AppLayout>
    );
  }

  if (!audit) {
    return (
      <AppLayout>
        <div className="audit-detail-page">
          <Link className="audit-breadcrumb" href="/audits">
            ← Audit Reports
          </Link>
          <div className="auth-error inline-error-banner">
            <span>{error || "Audit not found."}</span>
            <button className="button" onClick={loadAudit} type="button">Retry</button>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="audit-detail-page">
        <Link className="audit-breadcrumb" href="/audits">
          ← Audit Reports
        </Link>

        {error ? (
          <div className="auth-error inline-error-banner">
            <span>{error}</span>
            <button className="button" onClick={loadAudit} type="button">Retry</button>
          </div>
        ) : null}

        <header className="audit-hero">
          <div>
            <EditableText
              canEdit={canEdit}
              editing={editingField === "name"}
              isLarge
              value={audit.name}
              onCancel={() => setEditingField(null)}
              onEdit={() => startEdit("name", audit.name)}
              onSave={saveAuditField}
              onValueChange={setDraftValue}
              draftValue={draftValue}
            />
            <div className="audit-hero__meta">
              <EditableText
                canEdit={canEdit}
                editing={editingField === "reference_number"}
                isMono
                value={audit.reference_number ?? "No reference"}
                onCancel={() => setEditingField(null)}
                onEdit={() => startEdit("reference_number", audit.reference_number)}
                onSave={saveAuditField}
                onValueChange={setDraftValue}
                draftValue={draftValue}
              />
              <span className={badgeClass("type", audit.audit_type)}>
                {AUDIT_TYPE_LABELS[audit.audit_type]}
                {canEdit ? (
                  <button
                    className="audit-icon-button"
                    onClick={() => setEditingAuditType(!editingAuditType)}
                    style={{ marginLeft: "4px", cursor: "pointer" }}
                    type="button"
                  >
                    ✎
                  </button>
                ) : null}
              </span>
              {editingAuditType && canEdit ? (
                <div style={{ position: "relative", display: "inline-block" }}>
                  <div
                    style={{
                      position: "absolute",
                      top: "4px",
                      left: "0",
                      background: "var(--surface)",
                      border: "1px solid var(--border2)",
                      borderRadius: "8px",
                      padding: "8px",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                      zIndex: 1000,
                      minWidth: "200px",
                    }}
                  >
                    {AUDIT_TYPES.map((type) => (
                      <button
                        className="button"
                        key={type}
                        onClick={() => saveAuditType(type)}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          marginBottom: "4px",
                          background: type === audit.audit_type ? "var(--surface2)" : "transparent",
                        }}
                        type="button"
                      >
                        {AUDIT_TYPE_LABELS[type]}
                      </button>
                    ))}
                    <button
                      className="button"
                      onClick={() => setEditingAuditType(false)}
                      style={{ width: "100%", marginTop: "4px" }}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
              <EditableSelect
                canEdit={canEdit}
                editing={editingField === "opinion_rating"}
                value={audit.opinion_rating ?? ""}
                options={["", "Satisfactory", "NeedsImprovement", "Unsatisfactory"]}
                renderValue={
                  <span className={badgeClass("opinion", audit.opinion_rating)}>
                    {audit.opinion_rating ?? "Not set"}
                  </span>
                }
                onCancel={() => setEditingField(null)}
                onEdit={() => startEdit("opinion_rating", audit.opinion_rating)}
                onSave={saveAuditField}
                onValueChange={setDraftValue}
                draftValue={draftValue}
              />
              <span>{formatDate(audit.report_issue_date)}</span>
            </div>
            <div className="audits-entity-badges">
              {audit.audit_entities.map(({ entity }) => (
                <em key={entity.id}>{entity.code}</em>
              ))}
            </div>
          </div>
          <div className="audit-hero__actions">
            {audit.report_file_missing ? (
              <div style={{ padding: "12px", background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: "8px", marginBottom: "12px" }}>
                <strong style={{ color: "#92400e" }}>⚠ Report file is missing or unreachable.</strong>
                <p style={{ margin: "4px 0 0", fontSize: "14px", color: "#78350f" }}>
                  The file may have been moved or deleted from storage. You can replace it with a new upload{canEdit ? ", or remove the broken reference" : ""}.
                </p>
              </div>
            ) : null}
            {audit.report_pdf_filename ? (
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {audit.report_file_missing ? (
                  <span style={{ color: "#9ca3af", fontFamily: "monospace" }}>
                    📎 {audit.report_pdf_filename} (file missing)
                  </span>
                ) : (
                  <a
                    className="audit-download"
                    href={`/api/v1/audits/${audit.id}/report-download`}
                  >
                    📎 {audit.report_pdf_filename} Download →
                  </a>
                )}
                {canEdit ? (
                  <>
                    <input
                      accept="application/pdf"
                      ref={fileInputRef}
                      style={{ display: "none" }}
                      type="file"
                      onChange={handleFileInputChange}
                    />
                    <button
                      className="audit-icon-button"
                      disabled={isReplacingReport}
                      title="Replace this report"
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {isReplacingReport ? "⏳" : "🔄"}
                    </button>
                    <button
                      className="audit-icon-button"
                      style={{ color: "#dc2626" }}
                      title="Remove this report"
                      type="button"
                      onClick={() => setRemoveReportOpen(true)}
                    >
                      🗑
                    </button>
                  </>
                ) : null}
              </div>
            ) : !audit.report_file_missing ? (
              canEdit ? (
                <div
                  className="audit-upload-zone"
                  style={{
                    border: isDraggingOver ? "2px dashed #2563eb" : "2px dashed var(--border2)",
                    borderRadius: "12px",
                    padding: "24px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "8px",
                    cursor: "pointer",
                    transition: "all 120ms",
                    background: isDraggingOver ? "var(--surface2)" : "var(--surface)",
                    marginBottom: "12px",
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  onDragLeave={handleDragLeave}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                >
                  <input
                    accept="application/pdf"
                    ref={fileInputRef}
                    style={{ display: "none" }}
                    type="file"
                    onChange={handleFileInputChange}
                  />
                  {isUploadingReport ? (
                    <>
                      <span style={{ fontSize: "32px" }}>⏳</span>
                      <strong style={{ fontSize: "14px", color: "var(--text2)", fontWeight: 600 }}>
                        Uploading...
                      </strong>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: "32px" }}>📤</span>
                      <strong style={{ fontSize: "14px", color: "var(--text2)", fontWeight: 600 }}>
                        No report uploaded yet
                      </strong>
                      <span style={{ fontSize: "13px", color: "var(--text3)" }}>
                        Click or drag a PDF to upload
                      </span>
                    </>
                  )}
                </div>
              ) : (
                <p style={{ color: "var(--text3)", fontSize: "14px", marginBottom: "12px" }}>
                  No report uploaded for this audit.
                </p>
              )
            ) : null}
            <button
              className="button"
              onClick={async () => {
                const url = `${window.location.origin}/audits/${audit.id}`;
                await navigator.clipboard.writeText(url);
                toast.success("Link copied!");
              }}
              title="Copy link to this audit"
              type="button"
            >
              🔗 Copy Link
            </button>
            {canEdit ? (
              <button className="button button--danger" onClick={() => setDeleteAuditOpen(true)} type="button">
                Delete Audit
              </button>
            ) : null}
          </div>
        </header>

        <div className="audit-detail-grid">
          <main className="audit-detail-left">
            <section className="audit-detail-card">
              <header className="audit-section-header">
                <h2>Executive Summary</h2>
                <div>
                  {canEdit ? (
                    <button
                      className="audit-icon-button"
                      onClick={() => startEdit("executive_summary", audit.executive_summary)}
                      type="button"
                    >
                      ✎
                    </button>
                  ) : null}
                  <button className="button" onClick={() => setSummaryOpen((current) => !current)} type="button">
                    {summaryOpen ? "Collapse" : "Expand"}
                  </button>
                </div>
              </header>
              {summaryOpen ? (
                editingField === "executive_summary" ? (
                  <div className="audit-inline-editor">
                    <textarea value={draftValue} onChange={(event) => setDraftValue(event.target.value)} />
                    <button className="button button--primary" onClick={saveAuditField} type="button">
                      Save
                    </button>
                    <button className="button" onClick={() => setEditingField(null)} type="button">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <p>{audit.executive_summary || "No executive summary provided."}</p>
                )
              ) : null}
            </section>

            <section className="audit-detail-card">
              <header className="audit-section-header">
                <h2>Control Areas</h2>
              </header>
              <div className="audit-control-counts">
                <span>{controlCounts.Effective} {CONTROL_RATING_LABELS.Effective}</span>
                <span>{controlCounts.PartiallyEffective} {CONTROL_RATING_LABELS.PartiallyEffective}</span>
                <span>{controlCounts.NotEffective} {CONTROL_RATING_LABELS.NotEffective}</span>
              </div>
              <div className="audit-control-table">
                <div>
                  <span>Control title</span>
                  <span>Rating</span>
                  <span>Finding reference</span>
                </div>
                {audit.control_areas.map((area) => (
                  <div key={area.id}>
                    <span>{area.title}</span>
                    <span className={badgeClass("control", area.control_rating)}>
                      {area.control_rating ?? "Not set"}
                    </span>
                    <span>{area.finding_ref ?? "None"}</span>
                  </div>
                ))}
                {audit.control_areas.length === 0 ? <p>No control areas recorded.</p> : null}
              </div>
            </section>

            <section className="audit-detail-card">
              <header className="audit-section-header">
                <h2>Findings</h2>
              </header>
              <div className="audit-findings-stack">
                {audit.findings.map((finding) => {
                  const expanded = expandedFindings.has(finding.id);
                  const editing = editingFindingId === finding.id;

                  return (
                    <article className="audit-finding-card" key={finding.id}>
                      <header>
                        <div>
                          {finding.external_ref ? <span className="audit-ref-badge">{finding.external_ref}</span> : null}
                          {editing ? (
                            <input
                              value={findingDraft.title ?? ""}
                              onChange={(event) => setFindingDraft({ ...findingDraft, title: event.target.value })}
                            />
                          ) : (
                            <h3>{finding.title}</h3>
                          )}
                        </div>
                        {canEdit ? (
                          <div>
                            {editing ? (
                              <>
                                <button className="button button--primary" onClick={() => saveFinding(finding.id)} type="button">
                                  Save
                                </button>
                                <button className="button" onClick={() => setEditingFindingId("")} type="button">
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button className="audit-icon-button" onClick={() => startFindingEdit(finding)} type="button">
                                  ✎
                                </button>
                                {isAdmin ? (
                                  <button className="audit-icon-button" onClick={() => setDeleteFindingId(finding.id)} type="button">
                                    Delete
                                  </button>
                                ) : null}
                              </>
                            )}
                          </div>
                        ) : null}
                      </header>

                      <div className="audit-finding-badges">
                        <span className={badgeClass("control", finding.control_rating)}>
                          {finding.control_rating ?? "No rating"}
                        </span>
                      </div>

                      {editing ? (
                        <div className="audit-finding-edit-grid">
                          <input
                            placeholder="External reference"
                            value={findingDraft.external_ref ?? ""}
                            onChange={(event) => setFindingDraft({ ...findingDraft, external_ref: event.target.value })}
                          />
                          <select
                            value={findingDraft.control_rating ?? ""}
                            onChange={(event) => setFindingDraft({ ...findingDraft, control_rating: event.target.value as ControlRating })}
                          >
                            {CONTROL_RATINGS.map((rating) => (
                              <option key={rating} value={rating}>
                                {rating}
                              </option>
                            ))}
                          </select>
                          <select
                            value={findingDraft.control_rating ?? ""}
                            onChange={(event) =>
                              setFindingDraft({ ...findingDraft, control_rating: event.target.value as ControlRating })
                            }
                          >
                            {CONTROL_RATINGS.map((rating) => (
                              <option key={rating} value={rating}>
                                {rating}
                              </option>
                            ))}
                          </select>
                          <textarea
                            value={findingDraft.description ?? ""}
                            onChange={(event) => setFindingDraft({ ...findingDraft, description: event.target.value })}
                          />
                          <textarea
                            value={findingDraft.recommendation ?? ""}
                            onChange={(event) => setFindingDraft({ ...findingDraft, recommendation: event.target.value })}
                          />
                        </div>
                      ) : (
                        <>
                          <p>{getSnippet(finding.description, expanded)}</p>
                          {finding.description && finding.description.length > 220 ? (
                            <button
                              className="audit-text-button"
                              onClick={() => {
                                const next = new Set(expandedFindings);
                                if (next.has(finding.id)) next.delete(finding.id);
                                else next.add(finding.id);
                                setExpandedFindings(next);
                              }}
                              type="button"
                            >
                              {expanded ? "Show less" : "Show more"}
                            </button>
                          ) : null}
                          <div className="audit-recommendation">
                            <strong>Recommendation</strong>
                            <span>{finding.recommendation || "No recommendation provided."}</span>
                          </div>
                        </>
                      )}

                      <div className="audit-action-plan-list">
                        {finding.action_plans.map((plan) => (
                          <Link href={`/action-plans?expand=${plan.id}`} key={plan.id}>
                            <strong>{plan.display_id}</strong>
                            <span>{plan.description}</span>
                            <em className={badgeClass("status", plan.status)}>{STATUS_LABELS[plan.status]}</em>
                            <small>{plan.action_plan_owners[0]?.user.name ?? "Unassigned"}</small>
                            <small>{formatDate(plan.current_target_date)}</small>
                          </Link>
                        ))}
                        {finding.action_plans.length === 0 ? (
                          <EmptyState title="No linked action plans" subtitle="Action plans created for this finding will appear here." />
                        ) : null}
                      </div>
                    </article>
                  );
                })}
                {audit.findings.length === 0 ? (
                  <EmptyState title="No findings recorded" subtitle="Findings linked to this audit report will appear here." />
                ) : null}
              </div>
            </section>
          </main>

          <aside className="audit-detail-right">
            <section className="audit-detail-card">
              <h2>Audit Summary</h2>
              <div className="audit-stats-grid">
                <span><strong>{stats.totalFindings}</strong>Findings</span>
                <span><strong>{stats.totalActionPlans}</strong>Action Plans</span>
                <span><strong>{stats.open}</strong>Open</span>
                <span><strong>{stats.overdue}</strong>Overdue</span>
                <span><strong>{stats.closed}</strong>Closed</span>
              </div>
            </section>

            <section className="audit-detail-card">
              <h2>Quick Status Breakdown</h2>
              <div className="audit-mini-bars">
                {Object.entries(stats.statusCounts).map(([status, count]) => (
                  <div key={status}>
                    <span>{STATUS_LABELS[status as Status]}</span>
                    <strong style={{ width: `${stats.totalActionPlans ? (count / stats.totalActionPlans) * 100 : 0}%` }} />
                    <em>{count}</em>
                  </div>
                ))}
                {stats.totalActionPlans === 0 ? <p>No action plans yet.</p> : null}
              </div>
            </section>

            <section className="audit-detail-card">
              <h2>Entities</h2>
              {audit.audit_entities.length > 0 ? (
                <div className="audit-entity-list">
                  {audit.audit_entities.map(({ entity }) => (
                    <div key={entity.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <span>{entity.code}</span>
                        <strong>{entity.full_name}</strong>
                      </div>
                      {canEdit ? (
                        <button
                          className="audit-icon-button"
                          onClick={() => setRemovingEntityId(entity.id)}
                          style={{ color: "#dc2626", marginLeft: "8px" }}
                          title="Remove entity"
                          type="button"
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: "var(--text3)", fontSize: "14px", marginBottom: "12px" }}>
                  No entities assigned to this audit.
                </p>
              )}
              {canEdit ? (
                addingEntity ? (
                  <div style={{ marginTop: "12px" }}>
                    <select
                      defaultValue=""
                      onChange={(event) => {
                        if (event.target.value) {
                          addEntity(event.target.value);
                        }
                      }}
                      style={{ width: "100%", marginBottom: "8px" }}
                    >
                      <option disabled value="">
                        Select entity...
                      </option>
                      {allEntities
                        .filter((e) => e.is_active && !audit.audit_entities.some((ae) => ae.entity.id === e.id))
                        .map((entity) => (
                          <option key={entity.id} value={entity.id}>
                            {entity.code} ({entity.full_name})
                          </option>
                        ))}
                    </select>
                    <button
                      className="button"
                      onClick={() => setAddingEntity(false)}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className="button"
                    onClick={() => setAddingEntity(true)}
                    style={{ marginTop: "12px", width: "100%" }}
                    type="button"
                  >
                    + Add entity
                  </button>
                )
              ) : null}
            </section>

            <section className="audit-detail-card">
              <h2>Metadata</h2>
              <p>Created by {audit.created_by.name}</p>
              <p>{audit.created_by.email}</p>
              <p>Created {formatDate(audit.created_at)}</p>
            </section>
          </aside>
        </div>

        <ConfirmDialog
          cancelLabel="Cancel"
          confirmLabel="Delete Audit"
          isDangerous
          isOpen={deleteAuditOpen}
          message="This will soft-delete the audit report. Existing linked records will no longer appear under this audit."
          title="Delete audit report?"
          onCancel={() => setDeleteAuditOpen(false)}
          onConfirm={deleteAudit}
        />
        <ConfirmDialog
          cancelLabel="Cancel"
          confirmLabel="Delete Finding"
          isDangerous
          isOpen={Boolean(deleteFindingId)}
          message={
            deleteFindingId
              ? `Delete this finding and all its action plans? ${
                  audit.findings.find((f) => f.id === deleteFindingId)?.action_plan_count ?? 0
                } action plan(s) will also be deleted. This cannot be undone.`
              : ""
          }
          title="Delete finding?"
          onCancel={() => setDeleteFindingId("")}
          onConfirm={deleteFinding}
        />
        <ConfirmDialog
          cancelLabel="Cancel"
          confirmLabel="Remove report"
          isDangerous
          isOpen={removeReportOpen}
          message="The audit metadata, findings, and action plans will remain. You can upload a new report later. The previous file will be kept in storage but unreferenced."
          title="Remove this audit report?"
          onCancel={() => setRemoveReportOpen(false)}
          onConfirm={removeReport}
        />
        <ConfirmDialog
          cancelLabel="Cancel"
          confirmLabel="Remove entity"
          isDangerous
          isOpen={Boolean(removingEntityId)}
          message={
            removingEntityId && audit
              ? `Remove ${audit.audit_entities.find((ae) => ae.entity.id === removingEntityId)?.entity.code} from this audit? This does not change which entities are assigned to existing action plans, but new action plans created from findings in this audit will no longer default to this entity.`
              : ""
          }
          title="Remove entity from audit?"
          onCancel={() => setRemovingEntityId("")}
          onConfirm={removeEntity}
        />
      </div>
    </AppLayout>
  );
}

function EditableText({
  value,
  draftValue,
  canEdit,
  editing,
  isLarge = false,
  isMono = false,
  onEdit,
  onSave,
  onCancel,
  onValueChange,
}: {
  value: string;
  draftValue: string;
  canEdit: boolean;
  editing: boolean;
  isLarge?: boolean;
  isMono?: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onValueChange: (value: string) => void;
}) {
  if (editing) {
    return (
      <span className="audit-inline-editor audit-inline-editor--compact">
        <input className={isMono ? "audits-mono" : ""} value={draftValue} onChange={(event) => onValueChange(event.target.value)} />
        <button className="button button--primary" onClick={onSave} type="button">Save</button>
        <button className="button" onClick={onCancel} type="button">Cancel</button>
      </span>
    );
  }

  return (
    <span className={`audit-editable ${isLarge ? "audit-editable--large" : ""} ${isMono ? "audits-mono" : ""}`}>
      {isLarge ? <h1>{value}</h1> : <strong>{value}</strong>}
      {canEdit ? <button className="audit-icon-button" onClick={onEdit} type="button">✎</button> : null}
    </span>
  );
}

function EditableSelect({
  value,
  draftValue,
  options,
  renderValue,
  canEdit,
  editing,
  onEdit,
  onSave,
  onCancel,
  onValueChange,
}: {
  value: string;
  draftValue: string;
  options: string[];
  renderValue: React.ReactNode;
  canEdit: boolean;
  editing: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onValueChange: (value: string) => void;
}) {
  if (editing) {
    return (
      <span className="audit-inline-editor audit-inline-editor--compact">
        <select value={draftValue || value} onChange={(event) => onValueChange(event.target.value)}>
          {options.map((option) => (
            <option key={option || "none"} value={option}>
              {option || "Not set"}
            </option>
          ))}
        </select>
        <button className="button button--primary" onClick={onSave} type="button">Save</button>
        <button className="button" onClick={onCancel} type="button">Cancel</button>
      </span>
    );
  }

  return (
    <span className="audit-editable">
      {renderValue}
      {canEdit ? <button className="audit-icon-button" onClick={onEdit} type="button">✎</button> : null}
    </span>
  );
}
