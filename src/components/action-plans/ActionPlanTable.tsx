"use client";

import { type MutableRefObject, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { formatAuditLogEntry } from "../../lib/audit-log/formatAuditLogEntry";
import {
  AUDIT_TYPE_COLORS,
  AUDIT_TYPE_LABELS,
} from "../../lib/constants";
import EmptyState from "../EmptyState";
import { useToast } from "../Toast";
import ActionPlanSummary from "./ActionPlanSummary";
import ActionPlanSlideOverPanel from "./ActionPlanSlideOverPanel";

type Role = "AuditTeam" | "Viewer" | "Auditee" | "Pending";
type Status =
  | "NotStarted"
  | "InProgress"
  | "PendingValidation"
  | "Closed"
  | "RiskAccepted"
  | "Dropped";
type Priority = "High" | "Moderate" | "Low";
type AuditType = keyof typeof AUDIT_TYPE_LABELS;
type CreatedVia = "Manual" | "AIIngestion" | "Migration" | "Standalone";
type DueBucket =
  | "overdue_gt14"
  | "overdue_1to14"
  | "due_today"
  | "due_this_week"
  | "due_this_month"
  | "future"
  | "no_date";
type SortableColumn = "created_via" | "audit" | "owner" | "status" | "priority" | "due_bucket" | "evidence";
export type SortBy = "title" | "audit" | "owner" | "status" | "priority" | "due_date" | "evidence_count";

export type DashboardUser = {
  id: string;
  name?: string | null;
  role: Role;
  is_admin: boolean;
};

type RelatedUser = {
  id: string;
  name: string;
  email?: string | null;
  job_title?: string | null;
  department?: string | null;
  team_l1?: string | null;
  manager_name?: string | null;
  is_internal_auditor?: boolean;
  is_active?: boolean;
};

export type DashboardComment = {
  id: string;
  comment: string;
  created_at: string;
  user: {
    id: string;
    name: string;
    email?: string | null;
  };
};

type DashboardEvidence = {
  id: string;
  evidence_type?: string;
  filename: string | null;
  original_name: string | null;
  file_path: string | null;
  file_size: number | null;
  mime_type?: string | null;
  link_url?: string | null;
  link_source_type?: string | null;
  description: string | null;
  created_at: string;
  uploaded_by: {
    id?: string;
    name: string;
  };
};

type DashboardTargetDateRevision = {
  id: string;
  old_date: string | null;
  new_date: string | null;
  justification: string;
  revised_at: string;
  revised_by: {
    id: string;
    name: string;
  };
};

export type DashboardActionPlan = {
  id: string;
  display_id: string;
  title: string | null;
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
  was_implemented_at_issuance: boolean;
  created_via: string;
  created_at: string;
  updated_at: string;
  evidence_count: number;
  is_overdue: boolean;
  days_overdue: number;
  finding: {
    id: string;
    title: string;
    description: string | null;
    external_ref: string | null;
    root_cause?: string | null;
    potential_impact?: string | null;
    recommendation: string | null;
    priority: Priority | null;
    control_rating: string | null;
    audit: {
      id: string;
      name: string;
      reference_number: string | null;
      audit_type: AuditType | null;
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
  } | null;
  action_plan_owners: {
    id: string;
    is_primary: boolean;
    user: RelatedUser;
  }[];
  action_plan_follow_up_auditors: {
    id: string;
    user: RelatedUser;
  }[];
  action_plan_line_managers: {
    id: string;
    user: RelatedUser;
  }[];
  action_plan_entities: {
    entity_id: string;
    entity: {
      id: string;
      code: string;
      full_name: string;
    };
  }[];
  comments: DashboardComment[];
  evidence: DashboardEvidence[];
  target_date_revisions: DashboardTargetDateRevision[];
};

export type DashboardFacets = {
  status: Record<Status, number>;
  priority: Record<Priority, number>;
  created_via: Record<CreatedVia, number>;
  audit: { id: string; name: string; count: number }[];
  owner: { id: string; name: string; count: number }[];
  due_bucket: Record<DueBucket, number>;
};

export type ActionPlanTableData = {
  action_plans: DashboardActionPlan[];
  total: number;
  filtered_count: number;
  total_unfiltered: number;
  facets: DashboardFacets;
};

export type Filters = {
  ids: string | null;
  q: string;
  status: string;
  priority: string;
  audit: string;
  owner: string;
  due_bucket: string;
  created_via: string;
  entity: string;
  audit_type: string;
  department: string;
  overdue: boolean;
  assigned_to_me: boolean;
  sort_by: string;
  sort_dir: string;
};

type AuditLogEntry = {
  id: string;
  action: string;
  before_json: unknown;
  after_json: unknown;
  created_at: string;
  user: {
    name: string;
  } | null;
};

export type UserOption = {
  id: string;
  name: string;
  email?: string | null;
  department: string | null;
  job_title?: string | null;
  is_internal_auditor: boolean;
  is_active: boolean;
};

export type ActionPlanTableProps = {
  actionPlans: DashboardActionPlan[];
  total: number;
  filteredCount: number;
  totalUnfiltered: number;
  facets: DashboardFacets;
  filters: Filters;
  groupByAudit: boolean;
  loading: boolean;
  user: DashboardUser | null;
  userOptions: UserOption[];
  onFilterChange: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  onGroupByAuditChange: (groupByAudit: boolean) => void;
  onSortChange: (sortBy: SortBy) => void;
  onExport: () => void;
  isExporting?: boolean;
  onRefresh: () => Promise<void>;
  onPatchActionPlan: (actionPlanId: string, patch: Partial<DashboardActionPlan>) => void;
  onAddComment: (actionPlanId: string, createdComment: DashboardComment) => void;
  onError?: (message: string) => void;
  showGroupingToggle?: boolean;
  showOverdueToggle?: boolean;
  onFilter?: (filters: Partial<Filters>) => void;
  sortBy: SortBy | null;
  sortDir: "asc" | "desc" | null;
  initialExpandedId?: string | null;
  belowSearchSlot?: ReactNode;
  serverMatchedCount?: number;
  hasStackableFilters?: boolean;
  onClearStackableFilters?: () => void;
  stackableFiltersKey?: string;
};

const PAGE_SIZE = 50;
const DASHBOARD_TABLE_COLUMNS = "2.1fr 1.3fr 1.4fr 1fr 0.8fr 1fr 0.6fr";
const CLOSED_STATUSES: Status[] = ["Closed", "Dropped", "RiskAccepted"];
const SORT_BY_COLUMN: Record<SortableColumn, SortBy> = {
  created_via: "title",
  audit: "audit",
  owner: "owner",
  status: "status",
  priority: "priority",
  due_bucket: "due_date",
  evidence: "evidence_count",
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

function formatRevisionDate(value: string | null) {
  return value ? formatDate(value) : "—";
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function AuditTypeBadge({ auditType }: { auditType?: AuditType | null }) {
  if (!auditType) {
    return null;
  }

  const colors = AUDIT_TYPE_COLORS[auditType];

  return (
    <span
      className={`${colors.bg} ${colors.text}`}
      style={{
        borderRadius: 3,
        display: "inline-flex",
        fontSize: 10,
        fontWeight: 600,
        lineHeight: 1.4,
        padding: "1px 6px",
        width: "fit-content",
      }}
    >
      {AUDIT_TYPE_LABELS[auditType]}
    </span>
  );
}

function getAuditLogColor(action: string) {
  if (action === "StatusChange") return "#2D5BE3";
  if (action === "Update") return "#B45309";
  if (action === "EvidenceUpload") return "#1A7A1A";
  if (action === "Create") return "#333";
  return "#999";
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

function getResponseError(body: unknown, fallback: string) {
  return typeof body === "object" && body && "error" in body ? String(body.error) : fallback;
}

function canEditActionPlan(user: DashboardUser | null, actionPlan: DashboardActionPlan) {
  if (!user || user.role === "Viewer") {
    return false;
  }

  if (user.role === "AuditTeam") {
    return true;
  }

  return actionPlan.action_plan_owners.some((owner) => owner.user.id === user.id);
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
        <p style={{ color: "var(--text3)" }}>Not recorded</p>
      )}
    </div>
  );
}

export default function ActionPlanTable({
  actionPlans,
  total,
  filteredCount,
  totalUnfiltered,
  facets,
  filters,
  groupByAudit,
  loading,
  user,
  userOptions,
  onFilterChange,
  onGroupByAuditChange,
  onSortChange,
  onExport,
  isExporting = false,
  onRefresh,
  onPatchActionPlan,
  onAddComment,
  onError,
  showGroupingToggle = true,
  showOverdueToggle = true,
  sortBy,
  sortDir,
  initialExpandedId,
  belowSearchSlot = null,
  serverMatchedCount = 0,
  hasStackableFilters = false,
  onClearStackableFilters,
  stackableFiltersKey = "",
}: ActionPlanTableProps) {
  const toast = useToast();
  const refreshTimerRef = useRef<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    return initialExpandedId ?? null;
  });
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [auditLogOpenIds, setAuditLogOpenIds] = useState<Set<string>>(new Set());
  const [auditLogs, setAuditLogs] = useState<Record<string, AuditLogEntry[]>>({});
  const [revisionHistoryOpen, setRevisionHistoryOpen] = useState<Record<string, boolean>>({});
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);

  function scheduleRefresh() {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = window.setTimeout(
      onRefresh, 
      5000
    );
  }

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setVisibleLimit(PAGE_SIZE);
  }, [filters.q, filters.overdue, filters.assigned_to_me, stackableFiltersKey]);

  // Scroll selected row into view when it changes
  useEffect(() => {
    if (selectedId) {
      const element = rowRefs.current.get(selectedId);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [selectedId]);

  useEffect(() => {
    if (selectedId && !actionPlans.some((ap) => ap.id === selectedId)) {
      setSelectedId(null);
    }
  }, [actionPlans, selectedId]);

  const visibleActionPlans = useMemo(() => {
    const selected = selectedId ? actionPlans.find((ap) => ap.id === selectedId) : null;
    const paged = actionPlans.slice(0, visibleLimit);
    const merged = new Map<string, DashboardActionPlan>();
    [...paged, ...(selected ? [selected] : [])].forEach((actionPlan) => merged.set(actionPlan.id, actionPlan));
    return [...merged.values()];
  }, [actionPlans, selectedId, visibleLimit]);

  const groupedActionPlans = useMemo(() => {
    const groups = new Map<string, DashboardActionPlan[]>();
    visibleActionPlans.forEach((actionPlan) => {
      const auditName = actionPlan.finding?.audit?.name ?? "Standalone action plans";
      const group = groups.get(auditName) ?? [];
      group.push(actionPlan);
      groups.set(auditName, group);
    });
    return [...groups.entries()];
  }, [visibleActionPlans]);

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    onFilterChange(key, value);
  }

  function patchActionPlanLocal(actionPlanId: string, patch: Partial<DashboardActionPlan>) {
    onPatchActionPlan(actionPlanId, patch);
    scheduleRefresh();
  }

  function addCommentLocal(actionPlanId: string, createdComment: DashboardComment) {
    onAddComment(actionPlanId, createdComment);
    scheduleRefresh();
  }

  async function mutateActionPlan(
    actionPlan: DashboardActionPlan,
    path: string,
    payload: Record<string, unknown>,
    localPatch: Partial<DashboardActionPlan>,
  ) {
    const isStatusChange = path.endsWith("/status");
    const isTargetRevision = path.endsWith("/revise-target");
    const response = await fetch(path, {
      method: isStatusChange || isTargetRevision ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isStatusChange ? { new_status: payload.status } : payload),
    });
    const body = await readResponseBody(response);

    if (!response.ok) {
      onError?.(
        typeof body === "object" && body && "error" in body
          ? String(body.error)
          : "Unable to save change.",
      );
      return;
    }

    if (isStatusChange) {
      toast.success("Status changed successfully.");
    }
    if (isTargetRevision) {
      toast.success("Target date revised.");
    }
    patchActionPlanLocal(actionPlan.id, localPatch);
    
    // Reload audit log if it's currently open for this action plan
    if (auditLogOpenIds.has(actionPlan.id)) {
      await forceReloadAuditLog(actionPlan);
    }
  }

  async function loadAuditLog(actionPlan: DashboardActionPlan) {
    setAuditLogOpenIds((current) => new Set(current).add(actionPlan.id));

    if (auditLogs[actionPlan.id]) {
      return;
    }

    const response = await fetch(`/api/v1/action-plans/${actionPlan.id}/audit-log`);
    const body = await readResponseBody(response);

    if (!response.ok) {
      setAuditLogs((current) => ({
        ...current,
        [actionPlan.id]: [],
      }));
      return;
    }

    const records =
      body && typeof body === "object" && "audit_log" in body && Array.isArray(body.audit_log)
        ? (body.audit_log as AuditLogEntry[])
        : [];

    setAuditLogs((current) => ({ ...current, [actionPlan.id]: records }));
  }

  async function forceReloadAuditLog(
    actionPlan: DashboardActionPlan
  ) {
    setAuditLogs((current) => {
      const updated = { ...current };
      delete updated[actionPlan.id];
      return updated;
    });
    await loadAuditLog(actionPlan);
  }

  return (
    <>
      <section className="dashboard-filterbar">
        <input
          aria-label="Search action plans"
          placeholder="Search action plans, findings, owners, audits..."
          style={{ flex: "1 1 180px", minWidth: "160px" }}
          value={filters.q}
          onChange={(event) => setFilter("q", event.target.value)}
        />
        {showOverdueToggle ? (
          <label>
            <input
              checked={filters.overdue}
              onChange={(event) => setFilter("overdue", event.target.checked)}
              type="checkbox"
            />
            Overdue only
          </label>
        ) : null}
        <label>
          <input
            checked={filters.assigned_to_me}
            onChange={(event) => setFilter("assigned_to_me", event.target.checked)}
            type="checkbox"
          />
          Assigned to me
        </label>
        {showGroupingToggle ? (
          <label>
            <input
              checked={groupByAudit}
              onChange={(event) => onGroupByAuditChange(event.target.checked)}
              type="checkbox"
            />
            Group by audit
          </label>
        ) : null}
        <button className="button" disabled={isExporting} onClick={onExport} type="button">
          Export
        </button>
      </section>

      {belowSearchSlot}

      {!loading && (hasStackableFilters || filters.q.trim() || filters.overdue || filters.assigned_to_me) ? (
        <p className="dashboard-active-filters" style={{ marginTop: 6, marginBottom: 0 }}>
          <strong>{filteredCount}</strong>
          <span> of {serverMatchedCount || actionPlans.length} action plans in this view</span>
          {totalUnfiltered !== (serverMatchedCount || actionPlans.length) ? (
            <span style={{ color: "var(--text3)" }}> ({totalUnfiltered} total in portfolio)</span>
          ) : null}
        </p>
      ) : null}

      <section className="dashboard-table-card">
        {loading ? (
          <div className="dashboard-table">
            {Array.from({ length: 5 }, (_, index) => (
              <div
                className="dashboard-row dashboard-row--skeleton"
                key={index}
                style={{ gridTemplateColumns: DASHBOARD_TABLE_COLUMNS }}
              >
                {Array.from({ length: 7 }, (_item, cellIndex) => <span key={cellIndex} />)}
              </div>
            ))}
          </div>
        ) : null}
        {!loading && visibleActionPlans.length === 0 ? (
          hasStackableFilters && serverMatchedCount > 0 ? (
            <EmptyState
              actionLabel="Clear filters"
              onAction={() => onClearStackableFilters?.()}
              subtitle="Adjust or clear stackable filters to see more action plans."
              title="No action plans match your filters"
            />
          ) : (
            <EmptyState
              subtitle="Try clearing filters or creating a new audit report."
              title="No action plans match the current filters"
            />
          )
        ) : null}

        {!loading && groupByAudit ? (
          <div className="audit-groups">
            {groupedActionPlans.map(([auditName, plans]) => (
              <AuditGroup
                actionPlans={plans}
                auditName={auditName}
                selectedId={selectedId}
                key={auditName}
                setSelectedId={setSelectedId}
                cycleSort={onSortChange}
                sortBy={sortBy}
                sortDir={sortDir}
                rowRefs={rowRefs}
              />
            ))}
          </div>
        ) : null}

        {!loading && !groupByAudit ? (
          <ActionPlanRows
            actionPlans={visibleActionPlans}
            cycleSort={onSortChange}
            rowRefs={rowRefs}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            sortBy={sortBy}
            sortDir={sortDir}
          />
        ) : null}
      </section>

      {total > visibleLimit ? (
        <div className="dashboard-load-more">
          <button
            className="button button--primary"
            onClick={() => setVisibleLimit((current) => current + PAGE_SIZE)}
            type="button"
          >
            Load 50 more
          </button>
        </div>
      ) : null}

      {selectedId && actionPlans.find((ap) => ap.id === selectedId) ? (
        <ActionPlanSlideOverPanel
          actionPlan={actionPlans.find((ap) => ap.id === selectedId)!}
          user={user}
          userOptions={userOptions}
          auditLogOpen={auditLogOpenIds.has(selectedId)}
          auditLogs={auditLogs[selectedId] ?? []}
          onClose={() => setSelectedId(null)}
          patchActionPlanLocal={patchActionPlanLocal}
          addCommentLocal={addCommentLocal}
          loadAuditLog={loadAuditLog}
          forceReloadAuditLog={forceReloadAuditLog}
          refreshActionPlans={onRefresh}
        />
      ) : null}
    </>
  );
}

function AuditGroup({
  auditName,
  actionPlans,
  ...tableProps
}: {
  auditName: string;
  actionPlans: DashboardActionPlan[];
} & Omit<Parameters<typeof ActionPlanRows>[0], "actionPlans">) {
  const closed = actionPlans.filter((actionPlan) => CLOSED_STATUSES.includes(actionPlan.status)).length;
  const percent = actionPlans.length ? Math.round((closed / actionPlans.length) * 100) : 0;

  return (
    <section className="audit-group">
      <header>
        <div>
          <h2>{auditName}</h2>
          <span>
            {closed} of {actionPlans.length} closed
          </span>
        </div>
        <div className="audit-group__progress">
          <strong style={{ width: `${percent}%` }} />
        </div>
        <em>{percent}% complete</em>
      </header>
      <ActionPlanRows actionPlans={actionPlans} {...tableProps} />
    </section>
  );
}

function ActionPlanRows({
  actionPlans,
  selectedId,
  setSelectedId,
  cycleSort,
  sortBy,
  sortDir,
  rowRefs,
}: {
  actionPlans: DashboardActionPlan[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  cycleSort: (sortBy: SortBy) => void;
  sortBy: SortBy | null;
  sortDir: "asc" | "desc" | null;
  rowRefs: MutableRefObject<Map<string, HTMLElement>>;
}) {
  const filterLabels: Record<SortableColumn, string> = {
    created_via: "Action Plan",
    audit: "Audit",
    owner: "Owner",
    status: "Status",
    priority: "Priority",
    due_bucket: "Due",
    evidence: "Evidence",
  };

  function renderHeaderButton(column: SortableColumn) {
    const columnSortBy = SORT_BY_COLUMN[column];
    const isSorted = sortBy === columnSortBy;
    const chevron = isSorted ? (sortDir === "asc" ? "↑" : "↓") : "↓";
    const className = ["dashboard-column-filter", isSorted ? "dashboard-column-filter--sorted" : ""]
      .filter(Boolean)
      .join(" ");
    const tooltipText =
      column === "evidence" ? "Number of evidence files uploaded for this action plan" : undefined;

    return (
      <span className={className}>
        <button
          className="dashboard-column-filter__label"
          onClick={() => cycleSort(columnSortBy)}
          title={tooltipText}
          type="button"
          style={{ alignItems: "center", display: "flex", justifyContent: "space-between", width: "100%" }}
        >
          <span>{filterLabels[column]}</span>
          <em
            aria-hidden="true"
            className={
              isSorted ? "dashboard-column-filter__icon dashboard-column-filter__icon--sorted" : "dashboard-column-filter__icon"
            }
          >
            {chevron}
          </em>
        </button>
      </span>
    );
  }

  return (
    <div className="dashboard-table">
      <div className="dashboard-table__head" style={{ gridTemplateColumns: DASHBOARD_TABLE_COLUMNS }}>
        {renderHeaderButton("created_via")}
        {renderHeaderButton("audit")}
        {renderHeaderButton("owner")}
        {renderHeaderButton("status")}
        {renderHeaderButton("priority")}
        {renderHeaderButton("due_bucket")}
        {renderHeaderButton("evidence")}
      </div>
      {actionPlans.map((actionPlan) => {
        const isSelected = selectedId === actionPlan.id;
        return (
          <button
            className={`dashboard-row${isSelected ? " dashboard-row--selected" : ""}`}
            key={actionPlan.id}
            onClick={() => setSelectedId(actionPlan.id)}
            ref={(element) => {
              if (element) {
                rowRefs.current.set(actionPlan.id, element);
              } else {
                rowRefs.current.delete(actionPlan.id);
              }
            }}
            type="button"
            style={{
              gridTemplateColumns: DASHBOARD_TABLE_COLUMNS,
              cursor: "pointer",
            }}
          >
            <ActionPlanSummary actionPlan={actionPlan} />
          </button>
        );
      })}
    </div>
  );
}

