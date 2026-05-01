"use client";

import { getSession } from "next-auth/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import AppLayout from "../../../components/AppLayout";
import ConfirmDialog from "../../../components/ConfirmDialog";
import EmptyState from "../../../components/EmptyState";
import ActionPlanSummary from "../../../components/action-plans/ActionPlanSummary";
import { useToast } from "../../../components/Toast";
import { formatAuditLogEntry } from "../../../lib/audit-log/formatAuditLogEntry";
import { AUDIT_TYPE_LABELS, STATUS_LABELS } from "../../../lib/constants";

type Role = "AuditTeam" | "Viewer" | "Auditee" | "Pending";
type Status =
  | "NotStarted"
  | "InProgress"
  | "PendingValidation"
  | "Closed"
  | "RiskAccepted"
  | "Dropped";
type Priority = "High" | "Moderate" | "Low";

type DetailUser = {
  id: string;
  name: string;
  email: string;
  job_title: string | null;
  department: string | null;
  team_l1: string | null;
  manager_name: string | null;
  company: string | null;
};

type SessionUser = {
  id: string;
  name?: string | null;
  role: Role;
};

type UserOption = {
  id: string;
  name: string;
  email?: string | null;
  department: string | null;
  job_title?: string | null;
  is_internal_auditor: boolean;
};

type ActionPlanDetail = {
  id: string;
  display_id: string;
  description: string;
  priority: Priority | null;
  status: Status;
  original_target_date: string | null;
  current_target_date: string | null;
  required_evidence: string | null;
  department: string | null;
  closure_remarks: string | null;
  closed_at: string | null;
  reschedule_count: number;
  evidence_count?: number;
  is_overdue: boolean;
  days_overdue: number;
  finding: {
    id: string;
    title: string;
    description: string | null;
    root_cause: string | null;
    potential_impact: string | null;
    recommendation: string | null;
    priority: Priority | null;
    audit: {
      id: string;
      name: string;
      audit_type: keyof typeof AUDIT_TYPE_LABELS;
      report_issue_date: string | null;
      audit_entities: {
        entity: {
          id: string;
          code: string;
          full_name: string;
          country: string | null;
          group_category: string | null;
        };
      }[];
    } | null;
  };
  action_plan_owners: {
    id: string;
    is_primary: boolean;
    user: DetailUser;
  }[];
  action_plan_follow_up_auditors: {
    id: string;
    user: DetailUser;
  }[];
  action_plan_line_managers: {
    id: string;
    user: DetailUser;
  }[];
  action_plan_entities: {
    entity: {
      id: string;
      code: string;
      full_name: string;
    };
  }[];
  evidence: {
    id: string;
    filename: string;
    original_name: string;
    file_size: number;
    mime_type: string;
    description: string | null;
    created_at: string;
    uploaded_by: DetailUser;
  }[];
  comments: {
    id: string;
    comment: string;
    created_at: string;
    user: DetailUser;
  }[];
  status_history: {
    id: string;
    from_status: Status | null;
    to_status: Status;
    remarks: string | null;
    changed_at: string;
    changed_by: DetailUser;
  }[];
  target_date_revisions: {
    id: string;
    old_date: string | null;
    new_date: string | null;
    justification: string;
    revised_at: string;
    revised_by: DetailUser;
  }[];
};

type AuditLogEntry = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_json: unknown;
  after_json: unknown;
  ip_address: string | null;
  created_at: string;
  user: DetailUser | null;
};

const STATUS_ORDER: Status[] = [
  "PendingValidation",
  "InProgress",
  "NotStarted",
  "RiskAccepted",
  "Dropped",
  "Closed",
];

const STATUS_ACCENTS: Record<Status, string> = {
  NotStarted: "#64748b",
  InProgress: "#2563eb",
  PendingValidation: "#d97706",
  Closed: "#16a34a",
  RiskAccepted: "#7c3aed",
  Dropped: "#71717a",
};

function formatDate(value: string | null) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatClosureDate(value: string | null) {
  if (!value) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateInputValue(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function getTodayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Not set";
  }

  const date = new Date(value);
  return `${date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}, ${date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function getInitials(name?: string | null) {
  return (name ?? "User")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

async function readResponseBody(response: Response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function canEditActionPlan(user: SessionUser | null, actionPlan: ActionPlanDetail) {
  if (!user || user.role === "Viewer") {
    return false;
  }

  if (user.role === "AuditTeam") {
    return true;
  }

  return (
    actionPlan.action_plan_owners.some((owner) => owner.user.id === user.id) ||
    actionPlan.action_plan_line_managers.some(
      (lineManager) => lineManager.user.id === user.id,
    )
  );
}

function EditableField({
  label,
  value,
  multiline = false,
  disabled,
  onSave,
}: {
  label: string;
  value: string | null;
  multiline?: boolean;
  disabled: boolean;
  onSave: (value: string) => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  async function save() {
    setIsSaving(true);
    try {
      await onSave(draft);
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="detail-field">
      <div className="detail-field__label">
        <span>{label}</span>
        {!disabled ? (
          <button type="button" onClick={() => setIsEditing((current) => !current)}>
            Edit
          </button>
        ) : null}
      </div>
      {isEditing ? (
        <div className="detail-field__editor">
          {multiline ? (
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} />
          ) : (
            <input value={draft} onChange={(event) => setDraft(event.target.value)} />
          )}
          <button className="button button--primary" disabled={isSaving} onClick={save} type="button">
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      ) : (
        <p>{value || "Not set"}</p>
      )}
    </div>
  );
}

function ClosureDateField({
  value,
  disabled,
  onSave,
}: {
  value: string | null;
  disabled: boolean;
  onSave: (value: string) => Promise<boolean>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(formatDateInputValue(value));
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDraft(formatDateInputValue(value));
  }, [value]);

  async function save() {
    setIsSaving(true);
    try {
      const saved = await onSave(draft);
      if (saved) {
        setIsEditing(false);
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="detail-field">
      <div className="detail-field__label">
        <span>Closure date</span>
        {!disabled && !isEditing ? (
          <button type="button" onClick={() => setIsEditing(true)}>
            Edit
          </button>
        ) : null}
      </div>
      {isEditing ? (
        <div className="detail-field__editor">
          <input
            max={getTodayInputValue()}
            type="date"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button className="button button--primary" disabled={isSaving} onClick={save} type="button">
            {isSaving ? "Saving..." : "Save"}
          </button>
          <button className="button" disabled={isSaving} onClick={() => setIsEditing(false)} type="button">
            Cancel
          </button>
        </div>
      ) : value ? (
        <p>{formatClosureDate(value)}</p>
      ) : (
        <p style={{ color: "#6B6860" }}>Not recorded</p>
      )}
    </div>
  );
}

export default function ActionPlanDetailPage() {
  const toast = useToast();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [actionPlan, setActionPlan] = useState<ActionPlanDetail | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [isAssigningOwner, setIsAssigningOwner] = useState(false);
  const [isAssigningAuditor, setIsAssigningAuditor] = useState(false);
  const [auditLogOpen, setAuditLogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState("");
  const [comment, setComment] = useState("");
  const [commentError, setCommentError] = useState("");
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionDate, setRevisionDate] = useState("");
  const [revisionJustification, setRevisionJustification] = useState("");
  const [revisionErrors, setRevisionErrors] = useState<Record<string, string>>({});
  const [evidenceError, setEvidenceError] = useState("");
  const evidenceInputRef = useRef<HTMLInputElement>(null);

  const fetchActionPlan = useCallback(async () => {
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/v1/action-plans/${params.id}`);
      const body = await readResponseBody(response);

      if (!response.ok) {
        setError(
          typeof body === "object" && body && "error" in body
            ? String(body.error)
            : "Unable to load action plan.",
        );
        return;
      }

      const payload = body as {
        action_plan: ActionPlanDetail;
        audit_logs: AuditLogEntry[];
      };
      setActionPlan(payload.action_plan);
      setAuditLogs(payload.audit_logs);
    } catch {
      setError("Unable to load action plan.");
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    getSession().then((session) => {
      if (!session?.user) {
        return;
      }

      setUser({
        id: session.user.id,
        name: session.user.name,
        role: session.user.role,
      });
    });
  }, []);

  useEffect(() => {
    fetchActionPlan();
  }, [fetchActionPlan]);

  useEffect(() => {
    if (user?.role !== "AuditTeam") {
      setUserOptions([]);
      return;
    }

    let ignore = false;

    fetch("/api/v1/records/new/options")
      .then(async (response) => {
        const body = await readResponseBody(response);
        if (!response.ok) {
          return [];
        }

        return body && typeof body === "object" && "users" in body && Array.isArray(body.users)
          ? (body.users as UserOption[])
          : [];
      })
      .then((options) => {
        if (!ignore) {
          setUserOptions(options);
        }
      })
      .catch(() => {
        if (!ignore) {
          setUserOptions([]);
        }
      });

    return () => {
      ignore = true;
    };
  }, [user?.role]);

  const canEdit = useMemo(
    () => (actionPlan ? canEditActionPlan(user, actionPlan) : false),
    [actionPlan, user],
  );
  const canEditFinding = user?.role === "AuditTeam";
  const canDelete = user?.role === "AuditTeam";
  const canManageAssignments = user?.role === "AuditTeam";
  const ownerOptions = useMemo(() => {
    if (!actionPlan) {
      return [];
    }

    const assignedIds = new Set(actionPlan.action_plan_owners.map((owner) => owner.user.id));
    return userOptions.filter((option) => !assignedIds.has(option.id));
  }, [actionPlan, userOptions]);
  const followUpAuditorOptions = useMemo(() => {
    if (!actionPlan) {
      return [];
    }

    const assignedIds = new Set(
      actionPlan.action_plan_follow_up_auditors.map((auditor) => auditor.user.id),
    );
    return userOptions.filter(
      (option) => option.is_internal_auditor && !assignedIds.has(option.id),
    );
  }, [actionPlan, userOptions]);

  async function patchActionPlan(payload: Record<string, unknown>) {
    if (!actionPlan) {
      return;
    }

    const isStatusChange = "status" in payload;
    const response = await fetch(
      isStatusChange
        ? `/api/v1/action-plans/${actionPlan.id}/status`
        : `/api/v1/action-plans/${actionPlan.id}`,
      {
      method: isStatusChange ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isStatusChange ? { new_status: payload.status } : payload),
    });
    const body = await readResponseBody(response);

    if (!response.ok) {
      setError(
        typeof body === "object" && body && "error" in body
          ? String(body.error)
          : "Unable to save change.",
      );
      return;
    }

    if (isStatusChange) {
      toast.success("Status changed successfully.");
      await fetchActionPlan();
      return;
    }

    const updated = body as {
      action_plan: ActionPlanDetail;
      audit_logs: AuditLogEntry[];
    };
    setActionPlan(updated.action_plan);
    setAuditLogs(updated.audit_logs);
  }

  async function saveClosureDate(value: string) {
    if (!actionPlan) {
      return false;
    }

    const response = await fetch(`/api/v1/action-plans/${actionPlan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ closed_at: value }),
    });
    const body = await readResponseBody(response);

    if (!response.ok) {
      toast.error(getErrorMessage(body, "Unable to update closure date."));
      return false;
    }

    const updated = body as {
      action_plan: ActionPlanDetail;
      audit_logs: AuditLogEntry[];
    };
    setActionPlan(updated.action_plan);
    setAuditLogs(updated.audit_logs);
    toast.success("Closure date updated");
    return true;
  }

  async function reviseTargetDate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!actionPlan) return;
    const nextErrors: Record<string, string> = {};
    if (!revisionDate) nextErrors.date = "New target date is required.";
    if (!revisionJustification.trim()) nextErrors.justification = "Justification is required.";
    setRevisionErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const response = await fetch(`/api/v1/action-plans/${actionPlan.id}/revise-target`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_target_date: revisionDate, justification: revisionJustification }),
    });
    const body = await readResponseBody(response);
    if (!response.ok) {
      setError(
        typeof body === "object" && body && "error" in body ? String(body.error) : "Unable to revise target date.",
      );
      return;
    }

    toast.success("Target date revised.");
    setRevisionOpen(false);
    setRevisionDate("");
    setRevisionJustification("");
    await fetchActionPlan();
  }

  function getErrorMessage(body: unknown, fallback: string) {
    return typeof body === "object" && body && "error" in body ? String(body.error) : fallback;
  }

  async function assignOwner(userId: string) {
    if (!actionPlan || !userId) {
      return;
    }

    setError("");
    const response = await fetch(`/api/v1/action-plans/${actionPlan.id}/owners`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        is_primary: actionPlan.action_plan_owners.length === 0,
      }),
    });
    const body = await readResponseBody(response);

    if (!response.ok) {
      setError(getErrorMessage(body, "Unable to assign owner."));
      return;
    }

    toast.success("Owner assigned.");
    setIsAssigningOwner(false);
    await fetchActionPlan();
  }

  async function removeOwner(userId: string) {
    if (!actionPlan) {
      return;
    }

    setError("");
    const response = await fetch(
      `/api/v1/action-plans/${actionPlan.id}/owners?user_id=${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
    const body = await readResponseBody(response);

    if (!response.ok) {
      setError(getErrorMessage(body, "Unable to remove owner."));
      return;
    }

    toast.success("Owner removed.");
    await fetchActionPlan();
  }

  async function assignFollowUpAuditor(userId: string) {
    if (!actionPlan || !userId) {
      return;
    }

    setError("");
    const response = await fetch(`/api/v1/action-plans/${actionPlan.id}/follow-up-auditors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
    });
    const body = await readResponseBody(response);

    if (!response.ok) {
      setError(getErrorMessage(body, "Unable to assign follow-up auditor."));
      return;
    }

    toast.success("Follow-up auditor assigned.");
    setIsAssigningAuditor(false);
    await fetchActionPlan();
  }

  async function removeFollowUpAuditor(userId: string) {
    if (!actionPlan) {
      return;
    }

    setError("");
    const response = await fetch(
      `/api/v1/action-plans/${actionPlan.id}/follow-up-auditors?user_id=${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
    const body = await readResponseBody(response);

    if (!response.ok) {
      setError(getErrorMessage(body, "Unable to remove follow-up auditor."));
      return;
    }

    toast.success("Follow-up auditor removed.");
    await fetchActionPlan();
  }

  async function uploadEvidence(file: File | undefined) {
    if (!actionPlan || !file) return;
    setEvidenceError("");
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`/api/v1/action-plans/${actionPlan.id}/evidence`, {
      method: "POST",
      body: formData,
    });
    const body = await readResponseBody(response);
    if (!response.ok) {
      setEvidenceError(
        typeof body === "object" && body && "error" in body ? String(body.error) : "Unable to upload evidence.",
      );
      return;
    }

    toast.success("Evidence uploaded.");
    if (evidenceInputRef.current) evidenceInputRef.current.value = "";
    await fetchActionPlan();
  }

  async function loadAuditLog() {
    if (!actionPlan) return;
    if (auditLogOpen) {
      setAuditLogOpen(false);
      return;
    }

    const response = await fetch(`/api/v1/action-plans/${actionPlan.id}/audit-log`);
    const body = await readResponseBody(response);
    if (!response.ok) {
      setError(
        typeof body === "object" && body && "error" in body ? String(body.error) : "Unable to load audit log.",
      );
      return;
    }

    setAuditLogs((body as { audit_log?: AuditLogEntry[] }).audit_log ?? []);
    setAuditLogOpen(true);
  }

  async function deleteActionPlan() {
    if (!actionPlan) {
      return;
    }

    setIsDeleting(true);
    setError("");

    try {
      const response = await fetch(`/api/v1/action-plans/${actionPlan.id}`, {
        method: "DELETE",
      });
      const body = await readResponseBody(response);

      if (!response.ok) {
        setError(
          typeof body === "object" && body && "error" in body
            ? String(body.error)
            : "Unable to delete action plan.",
        );
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } finally {
      setIsDeleting(false);
      setDeleteOpen(false);
    }
  }

  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!comment.trim()) {
      setCommentError("Comment is required.");
      return;
    }
    if (!actionPlan) return;

    const response = await fetch(`/api/v1/action-plans/${actionPlan.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment }),
    });
    await readResponseBody(response);
    if (response.ok) {
      setComment("");
      toast.success("Comment posted.");
      window.setTimeout(fetchActionPlan, 5000);
    }
  }

  if (isLoading) {
    return (
      <AppLayout>
        <div className="dashboard-page">
          <div className="action-plan-detail-skeleton" />
        </div>
      </AppLayout>
    );
  }

  if (!actionPlan) {
    return (
      <AppLayout>
        <div className="dashboard-page">
          {error ? (
            <div className="auth-error inline-error-banner">
              <span>{error}</span>
              <button className="button" onClick={fetchActionPlan} type="button">Retry</button>
            </div>
          ) : null}
          <Link className="button" href="/dashboard">
            Back to Dashboard
          </Link>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="dashboard-page action-plan-detail-page">
        <header className="action-plan-detail-header">
          <div>
            <Link href="/dashboard">← Dashboard</Link>
            <ActionPlanSummary actionPlan={actionPlan} variant="header-card" />
          </div>
          {canDelete ? (
            <button
              className="button button--danger"
              onClick={() => setDeleteOpen(true)}
              type="button"
            >
              Delete
            </button>
          ) : null}
        </header>

        {error ? (
          <div className="auth-error inline-error-banner">
            <span>{error}</span>
            <button className="button" onClick={fetchActionPlan} type="button">Retry</button>
          </div>
        ) : null}

        <div className="expanded-panel action-plan-detail-panel">
          <div className="expanded-panel__left">
            <EditableField
              disabled={!canEdit}
              label="Action plan"
              multiline
              value={actionPlan.description}
              onSave={(value) => patchActionPlan({ description: value })}
            />
            <EditableField
              disabled={!canEdit}
              label="Required evidence"
              multiline
              value={actionPlan.required_evidence}
              onSave={(value) => patchActionPlan({ required_evidence: value })}
            />
            <EditableField
              disabled={!canEdit}
              label="Closure remarks"
              multiline
              value={actionPlan.closure_remarks}
              onSave={(value) => patchActionPlan({ closure_remarks: value })}
            />

            <div className="revision-strip">
              <strong>Target date</strong>
              <span>
                Original: {formatDate(actionPlan.original_target_date)} | Current:{" "}
                {formatDate(actionPlan.current_target_date)}
                {actionPlan.reschedule_count > 0 ? (
                  <em className="reschedule-count">
                    Rescheduled {actionPlan.reschedule_count}{" "}
                    {actionPlan.reschedule_count === 1 ? "time" : "times"}
                  </em>
                ) : null}
              </span>
              <button className="button" disabled={!canEdit} onClick={() => setRevisionOpen((current) => !current)} type="button">
                Request revision
              </button>
            </div>
            {revisionOpen ? (
              <form className="comment-form revision-form" onSubmit={reviseTargetDate}>
                <input
                  className={revisionErrors.date ? "input-error" : undefined}
                  type="date"
                  value={revisionDate}
                  onChange={(event) => {
                    setRevisionDate(event.target.value);
                    setRevisionErrors((current) => ({ ...current, date: "" }));
                  }}
                />
                {revisionErrors.date ? <span className="field-error">{revisionErrors.date}</span> : null}
                <input
                  className={revisionErrors.justification ? "input-error" : undefined}
                  placeholder="Justification"
                  value={revisionJustification}
                  onChange={(event) => {
                    setRevisionJustification(event.target.value);
                    setRevisionErrors((current) => ({ ...current, justification: "" }));
                  }}
                />
                {revisionErrors.justification ? <span className="field-error">{revisionErrors.justification}</span> : null}
                <button className="button button--primary" type="submit">Submit revision</button>
              </form>
            ) : null}

            <div className="status-change-pills">
              {STATUS_ORDER.map((status) => (
                <button
                  disabled={!canEdit || actionPlan.status === status}
                  key={status}
                  onClick={() => patchActionPlan({ status })}
                  style={{ borderColor: STATUS_ACCENTS[status] }}
                  type="button"
                >
                  {STATUS_LABELS[status]}
                </button>
              ))}
            </div>
            {actionPlan.status === "Closed" ? (
              <ClosureDateField disabled={!canEdit} value={actionPlan.closed_at} onSave={saveClosureDate} />
            ) : null}

            <section className="expanded-section">
              <h3>Evidence</h3>
              {actionPlan.evidence.length > 0 ? (
                actionPlan.evidence.map((file) => (
                  <p key={file.id}>
                    <strong>{file.original_name}</strong> | {file.mime_type} |{" "}
                    {Math.round(file.file_size / 1024)} KB
                  </p>
                ))
              ) : (
                <EmptyState title="No evidence yet" subtitle="Evidence files uploaded for this action plan will appear here." />
              )}
              <input
                hidden
                ref={evidenceInputRef}
                type="file"
                onChange={(event) => uploadEvidence(event.target.files?.[0])}
              />
              <button className="button" disabled={!canEdit} onClick={() => evidenceInputRef.current?.click()} type="button">
                Upload evidence
              </button>
              {evidenceError ? <span className="field-error">{evidenceError}</span> : null}
            </section>

            <section className="expanded-section">
              <h3>Comments</h3>
              {actionPlan.comments.length > 0 ? (
                actionPlan.comments.map((item) => (
                  <p key={item.id}>
                    <strong>{item.user.name}</strong>{" "}
                    <span style={{ color: "#999", fontSize: 11 }}>
                      {formatDateTime(item.created_at)}
                    </span>
                    : {item.comment}
                  </p>
                ))
              ) : (
                <EmptyState title="No comments yet" subtitle="Comments and discussion notes will appear here." />
              )}
              <form className="comment-form" onSubmit={addComment}>
                <input
                  className={commentError ? "input-error" : undefined}
                  disabled={!canEdit}
                  placeholder="Add a comment..."
                  value={comment}
                  onChange={(event) => {
                    setComment(event.target.value);
                    setCommentError("");
                  }}
                />
                <button className="button" disabled={!canEdit} type="submit">
                  Add
                </button>
                {commentError ? <span className="field-error">{commentError}</span> : null}
              </form>
            </section>

            <section className="expanded-section">
              <button
                className="audit-log-toggle"
                onClick={loadAuditLog}
                type="button"
              >
                {auditLogOpen ? "Hide audit log" : "Show audit log"}
              </button>
              {auditLogOpen ? (
                <ol className="audit-log-timeline">
                  {auditLogs.length > 0 ? (
                    auditLogs.map((entry) => (
                      <li className={`audit-log-timeline__item audit-log-timeline__item--${entry.action.toLowerCase()}`} key={entry.id}>
                        <strong>{entry.action}</strong>
                        <span>{entry.user?.name ?? "System"} · {formatDate(entry.created_at)}</span>
                        <em>{formatAuditLogEntry(entry)}</em>
                      </li>
                    ))
                  ) : (
                    <li>
                      <EmptyState title="No audit log yet" subtitle="Changes to this action plan will appear here." />
                    </li>
                  )}
                </ol>
              ) : null}
            </section>
          </div>

          <div className="expanded-panel__right">
            <section className="expanded-section">
              <h3>Finding Context</h3>
              <EditableField
                disabled={!canEditFinding}
                label="Finding title"
                value={actionPlan.finding.title}
                onSave={(value) => patchActionPlan({ finding: { title: value } })}
              />
              <EditableField
                disabled={!canEditFinding}
                label="Finding description"
                multiline
                value={actionPlan.finding.description}
                onSave={(value) =>
                  patchActionPlan({ finding: { description: value } })
                }
              />
              <EditableField
                disabled={!canEditFinding}
                label="Recommendation"
                multiline
                value={actionPlan.finding.recommendation}
                onSave={(value) =>
                  patchActionPlan({ finding: { recommendation: value } })
                }
              />
            </section>

            <section className="expanded-section">
              <h3>Audit Info</h3>
              <p>{actionPlan.finding.audit?.name ?? "No audit linked"}</p>
              <p>
                {actionPlan.finding.audit
                  ? AUDIT_TYPE_LABELS[actionPlan.finding.audit.audit_type]
                  : "No audit type"}
              </p>
              <p>
                Report issued:{" "}
                {formatDate(actionPlan.finding.audit?.report_issue_date ?? null)}
              </p>
              <p>
                Entities:{" "}
                {actionPlan.finding.audit?.audit_entities
                  .map(({ entity }) => `${entity.code} (${entity.full_name})`)
                  .join(", ") || "None"}
              </p>
            </section>

            <section className="expanded-section">
              <h3>Owners</h3>
              {canManageAssignments ? (
                <div className="assignment-actions">
                  {isAssigningOwner ? (
                    <>
                      <select
                        defaultValue=""
                        onChange={(event) => assignOwner(event.target.value)}
                      >
                        <option disabled value="">
                          Select an owner...
                        </option>
                        {ownerOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                            {option.department ? ` - ${option.department}` : ""}
                          </option>
                        ))}
                      </select>
                      <button onClick={() => setIsAssigningOwner(false)} type="button">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setIsAssigningOwner(true)} type="button">
                      + Assign owner
                    </button>
                  )}
                </div>
              ) : null}
              {actionPlan.action_plan_owners.map(({ user: owner }) => (
                <div className="owner-detail" key={owner.id}>
                  <i>{getInitials(owner.name)}</i>
                  <span>
                    <strong>{owner.name}</strong>
                    <em>{owner.job_title ?? "No title"}</em>
                    <small>
                      {owner.department ?? "No department"} | {owner.company ?? "No company"}
                      <br />
                      Manager: {owner.manager_name ?? "Not set"}
                    </small>
                  </span>
                  {canManageAssignments ? (
                    <button
                      className="assignment-remove"
                      onClick={() => removeOwner(owner.id)}
                      type="button"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              ))}
              {actionPlan.action_plan_owners.length === 0 ? (
                <EmptyState title="No owner assigned" subtitle="Assign an owner to make accountability clear." />
              ) : null}
            </section>

            <section className="expanded-section">
              <h3>Follow-Up Auditors</h3>
              {canManageAssignments ? (
                <div className="assignment-actions">
                  {isAssigningAuditor ? (
                    <>
                      <select
                        defaultValue=""
                        onChange={(event) => assignFollowUpAuditor(event.target.value)}
                      >
                        <option disabled value="">
                          Select a follow-up auditor...
                        </option>
                        {followUpAuditorOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                            {option.department ? ` - ${option.department}` : ""}
                          </option>
                        ))}
                      </select>
                      <button onClick={() => setIsAssigningAuditor(false)} type="button">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setIsAssigningAuditor(true)} type="button">
                      + Assign follow-up auditor
                    </button>
                  )}
                </div>
              ) : null}
              {actionPlan.action_plan_follow_up_auditors.length > 0 ? (
                actionPlan.action_plan_follow_up_auditors.map(({ user: auditor }) => (
                  <p className="assignment-row" key={auditor.id}>
                    <span>{auditor.name}</span>
                    {canManageAssignments ? (
                      <button
                        className="assignment-remove"
                        onClick={() => removeFollowUpAuditor(auditor.id)}
                        type="button"
                      >
                        Remove
                      </button>
                    ) : null}
                  </p>
                ))
              ) : (
                <EmptyState title="No follow-up auditor" subtitle="Follow-up auditor assignments will appear here." />
              )}
            </section>
          </div>
        </div>
      </div>

      <ConfirmDialog
        cancelLabel="Cancel"
        confirmLabel={isDeleting ? "Deleting..." : "Delete action plan"}
        isDangerous
        isOpen={deleteOpen}
        message={`This will soft-delete ${actionPlan.display_id}, its dashboard visibility, owner assignments, evidence links, comments, status history, target date revision history, and audit-log context from normal views. This cannot be undone from this page.`}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={deleteActionPlan}
        title="Delete action plan?"
      />
    </AppLayout>
  );
}
