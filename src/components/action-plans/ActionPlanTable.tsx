"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { formatAuditLogEntry } from "../../lib/audit-log/formatAuditLogEntry";
import {
  AUDIT_TYPE_COLORS,
  AUDIT_TYPE_LABELS,
  PRIORITY_COLORS,
  STATUS_COLORS,
  STATUS_LABELS,
} from "../../lib/constants";
import ColumnFilterPopover from "../dashboard/ColumnFilterPopover";
import ConfirmDialog from "../ConfirmDialog";
import EmptyState from "../EmptyState";
import { useToast } from "../Toast";
import ActionPlanSummary from "./ActionPlanSummary";

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
type FilterColumn = "created_via" | "audit" | "owner" | "status" | "priority" | "due_bucket";
type SortableColumn = FilterColumn | "evidence";
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
  filename: string;
  original_name: string;
  file_path: string;
  file_size: number;
  description: string | null;
  created_at: string;
  uploaded_by: {
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
  onFiltersChange: (filters: Filters | ((current: Filters) => Filters)) => void;
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
};

const PAGE_SIZE = 50;
const DASHBOARD_TABLE_COLUMNS = "2.1fr 1.3fr 1.4fr 1fr 0.8fr 1fr 0.6fr";
const CLOSED_STATUSES: Status[] = ["Closed", "Dropped", "RiskAccepted"];
const STATUS_ORDER: Status[] = [
  "NotStarted",
  "InProgress",
  "PendingValidation",
  "RiskAccepted",
  "Dropped",
  "Closed",
];
const PRIORITY_ORDER: Priority[] = ["High", "Moderate", "Low"];
const CREATED_VIA_ORDER: CreatedVia[] = ["Manual", "AIIngestion", "Migration", "Standalone"];
const DUE_BUCKET_OPTIONS: { key: DueBucket; label: string }[] = [
  { key: "overdue_gt14", label: "Overdue >14 days" },
  { key: "overdue_1to14", label: "Overdue 1-14 days" },
  { key: "due_today", label: "Due today" },
  { key: "due_this_week", label: "Due this week" },
  { key: "due_this_month", label: "Due this month" },
  { key: "future", label: "Future" },
  { key: "no_date", label: "No date set" },
];
const CREATED_VIA_LABELS: Record<CreatedVia, string> = {
  Manual: "Manual",
  AIIngestion: "AI Ingestion",
  Migration: "Migration",
  Standalone: "Standalone",
};
const SORT_BY_COLUMN: Record<SortableColumn, SortBy> = {
  created_via: "title",
  audit: "audit",
  owner: "owner",
  status: "status",
  priority: "priority",
  due_bucket: "due_date",
  evidence: "evidence_count",
};

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

function splitFilterValues(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinFilterValues(values: string[]) {
  return [...new Set(values)].join(",");
}

function toggleDraftValue(values: string[], value: string, checked: boolean) {
  if (checked) {
    return values.includes(value) ? values : [...values, value];
  }

  return values.filter((item) => item !== value);
}

function formatSelectedValues(values: string[], lookup: Map<string, string>, fallback?: (value: string) => string) {
  return values.map((value) => lookup.get(value) ?? fallback?.(value) ?? value).join(", ");
}

function getAvatarInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function getAvatarTone(name: string) {
  const tones = ["blue", "amber", "green", "purple", "slate"];
  const total = [...name].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return tones[total % tones.length];
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
  onFiltersChange,
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
}: ActionPlanTableProps) {
  const toast = useToast();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [auditLogOpenIds, setAuditLogOpenIds] = useState<Set<string>>(new Set());
  const [auditLogs, setAuditLogs] = useState<Record<string, AuditLogEntry[]>>({});
  const [revisionHistoryOpen, setRevisionHistoryOpen] = useState<Record<string, boolean>>({});
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);

  useEffect(() => {
    setVisibleLimit(PAGE_SIZE);
  }, [filters]);

  const visibleActionPlans = useMemo(() => {
    const expanded = actionPlans.filter((actionPlan) => expandedIds.has(actionPlan.id));
    const paged = actionPlans.slice(0, visibleLimit);
    const merged = new Map<string, DashboardActionPlan>();
    [...paged, ...expanded].forEach((actionPlan) => merged.set(actionPlan.id, actionPlan));
    return [...merged.values()];
  }, [actionPlans, expandedIds, visibleLimit]);

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

  const auditLookup = useMemo(
    () => new Map(facets.audit.map((audit) => [audit.id, audit.name])),
    [facets.audit],
  );
  const ownerLookup = useMemo(
    () => new Map(facets.owner.map((owner) => [owner.id, owner.name])),
    [facets.owner],
  );

  const activeFilterChips = [
    {
      key: "created_via" as const,
      label: "Action Plan",
      value: formatSelectedValues(splitFilterValues(filters.created_via), new Map(), (value) =>
        value in CREATED_VIA_LABELS ? CREATED_VIA_LABELS[value as CreatedVia] : value,
      ),
    },
    {
      key: "audit" as const,
      label: "Audit",
      value: formatSelectedValues(splitFilterValues(filters.audit), auditLookup),
    },
    {
      key: "owner" as const,
      label: "Owner",
      value: formatSelectedValues(splitFilterValues(filters.owner), ownerLookup),
    },
    {
      key: "status" as const,
      label: "Status",
      value: formatSelectedValues(splitFilterValues(filters.status), new Map(), (value) =>
        value in STATUS_LABELS ? STATUS_LABELS[value as Status] : value,
      ),
    },
    {
      key: "priority" as const,
      label: "Priority",
      value: formatSelectedValues(splitFilterValues(filters.priority), new Map()),
    },
    {
      key: "due_bucket" as const,
      label: "Due",
      value: formatSelectedValues(
        splitFilterValues(filters.due_bucket),
        new Map(DUE_BUCKET_OPTIONS.map((bucket) => [bucket.key, bucket.label])),
      ),
    },
    {
      key: "entity" as const,
      label: "Entity",
      value: filters.entity,
    },
    {
      key: "audit_type" as const,
      label: "Audit type",
      value: formatSelectedValues(splitFilterValues(filters.audit_type), new Map(), (value) =>
        value in AUDIT_TYPE_LABELS ? AUDIT_TYPE_LABELS[value as AuditType] : value,
      ),
    },
    {
      key: "department" as const,
      label: "Department",
      value: filters.department,
    },
  ].filter((chip) => chip.value);

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    onFilterChange(key, value);
  }

  function clearFilter(key: keyof Filters) {
    setFilter(key, "" as Filters[typeof key]);
  }

  function clearAllColumnFilters() {
    onFiltersChange((current) => ({
      ...current,
      status: "",
      priority: "",
      audit: "",
      owner: "",
      due_bucket: "",
      created_via: "",
      entity: "",
      audit_type: "",
      department: "",
    }));
  }

  function expandAll() {
    setExpandedIds(new Set(visibleActionPlans.map((actionPlan) => actionPlan.id)));
  }

  function collapseAll() {
    setExpandedIds(new Set());
  }

  function patchActionPlanLocal(actionPlanId: string, patch: Partial<DashboardActionPlan>) {
    onPatchActionPlan(actionPlanId, patch);
    window.setTimeout(onRefresh, 5000);
  }

  function addCommentLocal(actionPlanId: string, createdComment: DashboardComment) {
    onAddComment(actionPlanId, createdComment);
    window.setTimeout(onRefresh, 5000);
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
        <button className="button" onClick={expandAll} type="button">
          Expand all
        </button>
        <button className="button" onClick={collapseAll} type="button">
          Collapse all
        </button>
        <button className="button" disabled={isExporting} onClick={onExport} type="button">
          Export
        </button>
      </section>

      {activeFilterChips.length > 0 ? (
        <section className="dashboard-active-filters">
          <div className="dashboard-active-filters__chips">
            <span>Filters:</span>
            {activeFilterChips.map((chip) => (
              <button
                aria-label={`${chip.label}: ${chip.value}`}
                className="dashboard-filter-chip"
                key={chip.key}
                onClick={() => clearFilter(chip.key)}
                type="button"
              >
                <strong>{chip.label}:</strong> {chip.value}
                <em aria-hidden="true">×</em>
              </button>
            ))}
            <button className="dashboard-filter-clear" onClick={clearAllColumnFilters} type="button">
              Clear all
            </button>
          </div>
          <p>
            <strong>{filteredCount}</strong>
            <span> of {totalUnfiltered} action plans</span>
          </p>
        </section>
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
          <EmptyState
            subtitle="Try clearing filters or creating a new audit report."
            title="No action plans match the current filters"
          />
        ) : null}

        {!loading && groupByAudit ? (
          <div className="audit-groups">
            {groupedActionPlans.map(([auditName, plans]) => (
              <AuditGroup
                actionPlans={plans}
                auditName={auditName}
                auditLogs={auditLogs}
                auditLogOpenIds={auditLogOpenIds}
                expandedIds={expandedIds}
                key={auditName}
                loadAuditLog={loadAuditLog}
                mutateActionPlan={mutateActionPlan}
                patchActionPlanLocal={patchActionPlanLocal}
                refreshActionPlans={onRefresh}
                revisionHistoryOpen={revisionHistoryOpen}
                setRevisionHistoryOpen={setRevisionHistoryOpen}
                setExpandedIds={setExpandedIds}
                user={user}
                userOptions={userOptions}
                addCommentLocal={addCommentLocal}
                filters={filters}
                facets={facets}
                setFilter={setFilter}
                cycleSort={onSortChange}
                sortBy={sortBy}
                sortDir={sortDir}
              />
            ))}
          </div>
        ) : null}

        {!loading && !groupByAudit ? (
          <ActionPlanRows
            actionPlans={visibleActionPlans}
            auditLogs={auditLogs}
            auditLogOpenIds={auditLogOpenIds}
            expandedIds={expandedIds}
            loadAuditLog={loadAuditLog}
            mutateActionPlan={mutateActionPlan}
            patchActionPlanLocal={patchActionPlanLocal}
            refreshActionPlans={onRefresh}
            revisionHistoryOpen={revisionHistoryOpen}
            setRevisionHistoryOpen={setRevisionHistoryOpen}
            setExpandedIds={setExpandedIds}
            user={user}
            userOptions={userOptions}
            addCommentLocal={addCommentLocal}
            filters={filters}
            facets={facets}
            setFilter={setFilter}
            cycleSort={onSortChange}
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
  expandedIds,
  setExpandedIds,
  user,
  mutateActionPlan,
  patchActionPlanLocal,
  refreshActionPlans,
  loadAuditLog,
  auditLogOpenIds,
  auditLogs,
  revisionHistoryOpen,
  setRevisionHistoryOpen,
  userOptions,
  addCommentLocal,
  filters,
  facets,
  setFilter,
  cycleSort,
  sortBy,
  sortDir,
}: {
  actionPlans: DashboardActionPlan[];
  expandedIds: Set<string>;
  setExpandedIds: (ids: Set<string>) => void;
  user: DashboardUser | null;
  mutateActionPlan: (
    actionPlan: DashboardActionPlan,
    path: string,
    payload: Record<string, unknown>,
    localPatch: Partial<DashboardActionPlan>,
  ) => Promise<void>;
  patchActionPlanLocal: (actionPlanId: string, patch: Partial<DashboardActionPlan>) => void;
  refreshActionPlans: () => Promise<void>;
  loadAuditLog: (actionPlan: DashboardActionPlan) => Promise<void>;
  auditLogOpenIds: Set<string>;
  auditLogs: Record<string, AuditLogEntry[]>;
  revisionHistoryOpen: Record<string, boolean>;
  setRevisionHistoryOpen: (
    value: Record<string, boolean> | ((current: Record<string, boolean>) => Record<string, boolean>),
  ) => void;
  userOptions: UserOption[];
  addCommentLocal: (actionPlanId: string, createdComment: DashboardComment) => void;
  filters: Filters;
  facets: DashboardFacets;
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  cycleSort: (sortBy: SortBy) => void;
  sortBy: SortBy | null;
  sortDir: "asc" | "desc" | null;
}) {
  const toast = useToast();
  const [openFilter, setOpenFilter] = useState<FilterColumn | null>(null);
  const [draftValues, setDraftValues] = useState<string[]>([]);
  const [auditSearch, setAuditSearch] = useState("");
  const [ownerSearch, setOwnerSearch] = useState("");
  const createdViaHeaderRef = useRef<HTMLButtonElement | null>(null);
  const auditHeaderRef = useRef<HTMLButtonElement | null>(null);
  const ownerHeaderRef = useRef<HTMLButtonElement | null>(null);
  const statusHeaderRef = useRef<HTMLButtonElement | null>(null);
  const priorityHeaderRef = useRef<HTMLButtonElement | null>(null);
  const dueHeaderRef = useRef<HTMLButtonElement | null>(null);
  const headerRefs: Record<FilterColumn, typeof createdViaHeaderRef> = {
    created_via: createdViaHeaderRef,
    audit: auditHeaderRef,
    owner: ownerHeaderRef,
    status: statusHeaderRef,
    priority: priorityHeaderRef,
    due_bucket: dueHeaderRef,
  };
  const filterLabels: Record<SortableColumn, string> = {
    created_via: "Action Plan",
    audit: "Audit",
    owner: "Owner",
    status: "Status",
    priority: "Priority",
    due_bucket: "Due",
    evidence: "Evidence",
  };
  const selectedCounts: Record<FilterColumn, number> = {
    created_via: splitFilterValues(filters.created_via).length,
    audit: splitFilterValues(filters.audit).length,
    owner: splitFilterValues(filters.owner).length,
    status: splitFilterValues(filters.status).length,
    priority: splitFilterValues(filters.priority).length,
    due_bucket: splitFilterValues(filters.due_bucket).length,
  };
  const filteredAudits = facets.audit.filter((audit) =>
    audit.name.toLowerCase().includes(auditSearch.trim().toLowerCase()),
  );
  const filteredOwners = facets.owner.filter((owner) =>
    owner.name.toLowerCase().includes(ownerSearch.trim().toLowerCase()),
  );

  function openColumnFilter(column: FilterColumn) {
    setDraftValues(splitFilterValues(filters[column]));
    setOpenFilter(column);
    if (column === "audit") {
      setAuditSearch("");
    }
    if (column === "owner") {
      setOwnerSearch("");
    }
  }

  function applyOpenFilter() {
    if (!openFilter) {
      return;
    }

    setFilter(openFilter, joinFilterValues(draftValues));
    setOpenFilter(null);
  }

  function clearOpenFilter() {
    if (!openFilter) {
      return;
    }

    setFilter(openFilter, "");
    setOpenFilter(null);
  }

  function renderHeaderButton(column: SortableColumn) {
    const columnSortBy = SORT_BY_COLUMN[column];
    const isSorted = sortBy === columnSortBy;
    const isFilterable = column !== "evidence";
    const filterCount = isFilterable ? selectedCounts[column] : 0;
    const hasActiveFilter = filterCount > 0;
    const chevron = isSorted ? (sortDir === "asc" ? "↑" : "↓") : "↓";
    const className = [
      "dashboard-column-filter",
      hasActiveFilter ? "dashboard-column-filter--active" : "",
      isSorted ? "dashboard-column-filter--sorted" : "",
    ].filter(Boolean).join(" ");
    const tooltipText = column === "evidence" ? "Number of evidence files uploaded for this action plan" : undefined;

    return (
      <span className={className}>
        <button
          className="dashboard-column-filter__label"
          onClick={() => cycleSort(columnSortBy)}
          title={tooltipText}
          type="button"
        >
          <span>{filterLabels[column]}</span>
          {!isFilterable ? (
            <em
              aria-hidden="true"
              className={isSorted ? "dashboard-column-filter__icon dashboard-column-filter__icon--sorted" : "dashboard-column-filter__icon"}
            >
              {chevron}
            </em>
          ) : null}
        </button>
        {isFilterable ? (
          <button
            aria-label={`Filter ${filterLabels[column]}`}
            className="dashboard-column-filter__trigger"
            onClick={() => openColumnFilter(column)}
            ref={headerRefs[column]}
            type="button"
          >
            <em
              aria-hidden="true"
              className={isSorted ? "dashboard-column-filter__icon dashboard-column-filter__icon--sorted" : "dashboard-column-filter__icon"}
            >
              {chevron}
            </em>
          </button>
        ) : null}
        {hasActiveFilter ? <strong>{filterCount}</strong> : null}
      </span>
    );
  }

  function renderOption({
    value,
    label,
    count,
    badgeClassName,
    avatar,
  }: {
    value: string;
    label: string;
    count: number;
    badgeClassName?: string;
    avatar?: string;
  }) {
    const checked = draftValues.includes(value);

    return (
      <label className="column-filter-option" key={value}>
        <input
          checked={checked}
          onChange={(event) =>
            setDraftValues((current) => toggleDraftValue(current, value, event.target.checked))
          }
          type="checkbox"
        />
        {avatar ? (
          <span className={`column-filter-avatar column-filter-avatar--${getAvatarTone(label)}`}>
            {avatar}
          </span>
        ) : null}
        <span className={badgeClassName ?? "column-filter-option__label"}>{label}</span>
        <em>{count}</em>
      </label>
    );
  }

  function renderPopoverContents() {
    if (!openFilter) {
      return null;
    }

    return (
      <>
        <div className="column-filter-popover__body">
          {openFilter === "status"
            ? STATUS_ORDER.map((status) =>
                renderOption({
                  value: status,
                  label: STATUS_LABELS[status],
                  count: facets.status[status] ?? 0,
                  badgeClassName: `column-filter-chip ${STATUS_COLORS[status].bg} ${STATUS_COLORS[status].text}`,
                }),
              )
            : null}
          {openFilter === "priority"
            ? PRIORITY_ORDER.map((priority) =>
                renderOption({
                  value: priority,
                  label: priority,
                  count: facets.priority[priority] ?? 0,
                  badgeClassName: `column-filter-chip ${PRIORITY_COLORS[priority].bg} ${PRIORITY_COLORS[priority].text}`,
                }),
              )
            : null}
          {openFilter === "audit" ? (
            <>
              <input
                aria-label="Search audits"
                className="column-filter-search"
                onChange={(event) => setAuditSearch(event.target.value)}
                placeholder="Search audits..."
                value={auditSearch}
              />
              {filteredAudits.map((audit) =>
                renderOption({
                  value: audit.id,
                  label: audit.name,
                  count: audit.count,
                }),
              )}
            </>
          ) : null}
          {openFilter === "owner" ? (
            <>
              <input
                aria-label="Search owners"
                className="column-filter-search"
                onChange={(event) => setOwnerSearch(event.target.value)}
                placeholder="Search owners..."
                value={ownerSearch}
              />
              {filteredOwners.map((owner) =>
                renderOption({
                  value: owner.id,
                  label: owner.name,
                  count: owner.count,
                  avatar: getAvatarInitials(owner.name),
                }),
              )}
            </>
          ) : null}
          {openFilter === "due_bucket"
            ? DUE_BUCKET_OPTIONS.map((bucket) =>
                renderOption({
                  value: bucket.key,
                  label: bucket.label,
                  count: facets.due_bucket[bucket.key] ?? 0,
                }),
              )
            : null}
          {openFilter === "created_via"
            ? CREATED_VIA_ORDER.map((createdVia) =>
                renderOption({
                  value: createdVia,
                  label: CREATED_VIA_LABELS[createdVia],
                  count: facets.created_via[createdVia] ?? 0,
                }),
              )
            : null}
        </div>
        <div className="column-filter-popover__footer">
          <button className="column-filter-clear" onClick={clearOpenFilter} type="button">
            Clear
          </button>
          <button className="button button--primary" onClick={applyOpenFilter} type="button">
            Apply
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="dashboard-table">
      <div
        className="dashboard-table__head"
        style={{ gridTemplateColumns: DASHBOARD_TABLE_COLUMNS }}
      >
        {renderHeaderButton("created_via")}
        {renderHeaderButton("audit")}
        {renderHeaderButton("owner")}
        {renderHeaderButton("status")}
        {renderHeaderButton("priority")}
        {renderHeaderButton("due_bucket")}
        {renderHeaderButton("evidence")}
      </div>
      <ColumnFilterPopover
        anchorRef={openFilter ? headerRefs[openFilter] : createdViaHeaderRef}
        isOpen={openFilter !== null}
        onClose={() => setOpenFilter(null)}
      >
        {renderPopoverContents()}
      </ColumnFilterPopover>
      {actionPlans.map((actionPlan) => {
        const isExpanded = expandedIds.has(actionPlan.id);
        return (
          <article className={`dashboard-row-wrap ${isExpanded ? 'dashboard-row-wrap--expanded' : ''}`} key={actionPlan.id}>
            {!isExpanded ? (
              <>
                <button
                  className="dashboard-row"
                  onClick={() => {
                    const next = new Set(expandedIds);
                    next.add(actionPlan.id);
                    setExpandedIds(next);
                  }}
                  type="button"
                  style={{
                    gridTemplateColumns: DASHBOARD_TABLE_COLUMNS,
                    cursor: "pointer",
                  }}
                >
                  <ActionPlanSummary actionPlan={actionPlan} />
                </button>
                <button
                  className="dashboard-row-copy-link"
                  onClick={async (event) => {
                    event.stopPropagation();
                    const url = `${window.location.origin}/action-plans/${actionPlan.id}`;
                    await navigator.clipboard.writeText(url);
                    toast.success("Link copied!");
                  }}
                  title="Copy link to this action plan"
                  type="button"
                >
                  🔗
                </button>
              </>
            ) : null}

            {isExpanded ? (
              <ExpandedActionPlan
                actionPlan={actionPlan}
                auditLogOpen={auditLogOpenIds.has(actionPlan.id)}
                auditLogs={auditLogs[actionPlan.id] ?? []}
                canEdit={canEditActionPlan(user, actionPlan)}
                canEditFinding={user?.role === "AuditTeam"}
                canManageAssignments={user?.role === "AuditTeam"}
                addCommentLocal={addCommentLocal}
                loadAuditLog={loadAuditLog}
                mutateActionPlan={mutateActionPlan}
                patchActionPlanLocal={patchActionPlanLocal}
                refreshActionPlans={refreshActionPlans}
                revisionHistoryOpen={Boolean(revisionHistoryOpen[actionPlan.id])}
                toggleRevisionHistory={() =>
                  setRevisionHistoryOpen((current) => ({
                    ...current,
                    [actionPlan.id]: !current[actionPlan.id],
                  }))
                }
                userOptions={userOptions}
                user={user}
                onRequestClose={() => {
                  const next = new Set(expandedIds);
                  next.delete(actionPlan.id);
                  setExpandedIds(next);
                }}
              />
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function ExpandedActionPlan({
  actionPlan,
  canEdit,
  canEditFinding,
  canManageAssignments,
  addCommentLocal,
  mutateActionPlan,
  patchActionPlanLocal,
  refreshActionPlans,
  loadAuditLog,
  auditLogOpen,
  auditLogs,
  revisionHistoryOpen,
  toggleRevisionHistory,
  userOptions,
  onRequestClose,
  user,
}: {
  actionPlan: DashboardActionPlan;
  canEdit: boolean;
  canEditFinding: boolean;
  canManageAssignments: boolean;
  addCommentLocal: (actionPlanId: string, createdComment: DashboardComment) => void;
  mutateActionPlan: (
    actionPlan: DashboardActionPlan,
    path: string,
    payload: Record<string, unknown>,
    localPatch: Partial<DashboardActionPlan>,
  ) => Promise<void>;
  patchActionPlanLocal: (actionPlanId: string, patch: Partial<DashboardActionPlan>) => void;
  refreshActionPlans: () => Promise<void>;
  loadAuditLog: (actionPlan: DashboardActionPlan) => Promise<void>;
  auditLogOpen: boolean;
  auditLogs: AuditLogEntry[];
  revisionHistoryOpen: boolean;
  toggleRevisionHistory: () => void;
  userOptions: UserOption[];
  onRequestClose: () => void;
  user: DashboardUser | null;
}) {
  const [comment, setComment] = useState("");
  const [commentError, setCommentError] = useState("");
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionDate, setRevisionDate] = useState("");
  const [revisionJustification, setRevisionJustification] = useState("");
  const [revisionErrors, setRevisionErrors] = useState<Record<string, string>>({});
  const [evidenceError, setEvidenceError] = useState("");
  const [analyzingEvidenceId, setAnalyzingEvidenceId] = useState<string | null>(null);
  const [analysisDrafts, setAnalysisDrafts] = useState<Record<string, string>>({});
  const [analysisErrors, setAnalysisErrors] = useState<Record<string, string>>({});
  const [analysisSavedIds, setAnalysisSavedIds] = useState<Set<string>>(new Set());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const evidenceInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const audit = actionPlan.finding?.audit ?? null;
  const isAdmin = user?.is_admin === true;

  // Buffered changes state
  const [draftDescription, setDraftDescription] = useState(actionPlan.description);
  const [draftRequiredEvidence, setDraftRequiredEvidence] = useState(actionPlan.required_evidence ?? "");
  const [draftStatus, setDraftStatus] = useState(actionPlan.status);
  const [draftClosedAt, setDraftClosedAt] = useState<string | null>(actionPlan.closed_at);
  const [draftPriority, setDraftPriority] = useState(actionPlan.priority);
  const [draftTitle, setDraftTitle] = useState(actionPlan.title ?? "");
  const [draftClosureRemarks, setDraftClosureRemarks] = useState(actionPlan.closure_remarks ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);

  // Track which fields have changed
  const changedFields = useMemo(() => {
    const fields: string[] = [];
    if (draftDescription !== actionPlan.description) fields.push("Action Plan");
    if (draftRequiredEvidence !== (actionPlan.required_evidence ?? "")) fields.push("Required Evidence");
    if (draftStatus !== actionPlan.status) fields.push("Status");
    if (draftClosedAt !== actionPlan.closed_at) fields.push("Closure Date");
    if (draftPriority !== actionPlan.priority) fields.push("Priority");
    if (draftTitle !== (actionPlan.title ?? "")) fields.push("Title");
    if (draftClosureRemarks !== (actionPlan.closure_remarks ?? "")) fields.push("Closure Remarks");
    return fields;
  }, [
    draftDescription,
    draftRequiredEvidence,
    draftStatus,
    draftClosedAt,
    draftPriority,
    draftTitle,
    draftClosureRemarks,
    actionPlan,
  ]);

  const hasUnsavedChanges = changedFields.length > 0;

  // Reset drafts when actionPlan changes (e.g., after refresh)
  useEffect(() => {
    setDraftDescription(actionPlan.description);
    setDraftRequiredEvidence(actionPlan.required_evidence ?? "");
    setDraftStatus(actionPlan.status);
    setDraftClosedAt(actionPlan.closed_at);
    setDraftPriority(actionPlan.priority);
    setDraftTitle(actionPlan.title ?? "");
    setDraftClosureRemarks(actionPlan.closure_remarks ?? "");
  }, [actionPlan]);

  function discardChanges() {
    setDraftDescription(actionPlan.description);
    setDraftRequiredEvidence(actionPlan.required_evidence ?? "");
    setDraftStatus(actionPlan.status);
    setDraftClosedAt(actionPlan.closed_at);
    setDraftPriority(actionPlan.priority);
    setDraftTitle(actionPlan.title ?? "");
    setDraftClosureRemarks(actionPlan.closure_remarks ?? "");
  }

  async function saveChanges() {
    setIsSaving(true);
    try {
      // Build the patch payload for the main action plan fields
      const patch: Record<string, unknown> = {};
      if (draftDescription !== actionPlan.description) patch.description = draftDescription;
      if (draftRequiredEvidence !== (actionPlan.required_evidence ?? ""))
        patch.required_evidence = draftRequiredEvidence || null;
      if (draftPriority !== actionPlan.priority) patch.priority = draftPriority;
      if (draftTitle !== (actionPlan.title ?? "")) patch.title = draftTitle || null;
      if (draftClosureRemarks !== (actionPlan.closure_remarks ?? ""))
        patch.closure_remarks = draftClosureRemarks || null;
      if (draftClosedAt !== actionPlan.closed_at) patch.closed_at = draftClosedAt;

      // Save main fields via PATCH if any changed
      if (Object.keys(patch).length > 0) {
        const response = await fetch(`/api/v1/action-plans/${actionPlan.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const body = await readResponseBody(response);

        if (!response.ok) {
          throw new Error(getResponseError(body, "Unable to save changes."));
        }
      }

      // Save status change separately if changed
      if (draftStatus !== actionPlan.status) {
        const response = await fetch(`/api/v1/action-plans/${actionPlan.id}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ new_status: draftStatus }),
        });
        const body = await readResponseBody(response);

        if (!response.ok) {
          throw new Error(getResponseError(body, "Unable to save status change."));
        }
      }

      // Update local state with all changes
      patchActionPlanLocal(actionPlan.id, {
        description: draftDescription,
        required_evidence: draftRequiredEvidence || null,
        status: draftStatus,
        closed_at: draftClosedAt,
        priority: draftPriority,
        title: draftTitle || null,
        closure_remarks: draftClosureRemarks || null,
      });

      toast.success("Changes saved successfully");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save changes.");
    } finally {
      setIsSaving(false);
    }
  }

  function handleCloseRequest() {
    if (hasUnsavedChanges) {
      setShowUnsavedDialog(true);
    } else {
      onRequestClose();
    }
  }

  async function saveAndClose() {
    await saveChanges();
    setShowUnsavedDialog(false);
    onRequestClose();
  }

  function discardAndClose() {
    discardChanges();
    setShowUnsavedDialog(false);
    onRequestClose();
  }

  async function handleDelete() {
    setShowDeleteDialog(false);
    try {
      const response = await fetch(`/api/v1/action-plans/${actionPlan.id}`, {
        method: "DELETE",
      });
      const body = await readResponseBody(response);

      if (!response.ok) {
        throw new Error(getResponseError(body, "Unable to delete action plan."));
      }

      toast.success("Action plan deleted successfully");
      onRequestClose();
      await refreshActionPlans();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete action plan.");
    }
  }

  async function reviseTargetDate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!revisionDate) nextErrors.date = "New target date is required.";
    if (!revisionJustification.trim()) nextErrors.justification = "Justification is required.";
    setRevisionErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    await mutateActionPlan(
      actionPlan,
      `/api/v1/action-plans/${actionPlan.id}/revise-target`,
      { new_target_date: revisionDate, justification: revisionJustification },
      { current_target_date: revisionDate },
    );
    setRevisionOpen(false);
    setRevisionDate("");
    setRevisionJustification("");
  }

  async function uploadEvidence(file: File | undefined) {
    if (!file) return;
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
    await refreshActionPlans();
  }

  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!comment.trim()) {
      setCommentError("Comment is required.");
      return;
    }

    const createdComment = await postCommentText(comment);
    if (createdComment) {
      addCommentLocal(actionPlan.id, createdComment);
      setComment("");
    }
  }

  async function postCommentText(commentText: string) {
    const response = await fetch(`/api/v1/action-plans/${actionPlan.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment: commentText }),
    });
    const body = await readResponseBody(response);

    if (!response.ok) {
      setCommentError(
        typeof body === "object" && body && "error" in body ? String(body.error) : "Unable to add comment.",
      );
      return null;
    }

    if (body && typeof body === "object" && "comment" in body) {
      return (body as { comment: DashboardComment }).comment;
    }

    return null;
  }

  async function analyzeEvidence(evidence: DashboardEvidence) {
    setAnalyzingEvidenceId(evidence.id);
    setAnalysisErrors((current) => ({ ...current, [evidence.id]: "" }));
    setAnalysisDrafts((current) => {
      const next = { ...current };
      delete next[evidence.id];
      return next;
    });
    setAnalysisSavedIds((current) => {
      const next = new Set(current);
      next.delete(evidence.id);
      return next;
    });

    try {
      const response = await fetch(
        `/api/v1/action-plans/${actionPlan.id}/evidence/${evidence.id}/analyze`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ evidence_id: evidence.id }),
        },
      );
      const body = await readResponseBody(response);

      if (!response.ok) {
        setAnalysisErrors((current) => ({
          ...current,
          [evidence.id]:
            typeof body === "object" && body && "error" in body ? String(body.error) : "Unable to analyse evidence.",
        }));
        return;
      }

      const analysis =
        body && typeof body === "object" && "analysis" in body ? String(body.analysis ?? "") : "";
      setAnalysisDrafts((current) => ({ ...current, [evidence.id]: analysis }));
    } finally {
      setAnalyzingEvidenceId(null);
    }
  }

  async function saveAnalysisAsComment(evidence: DashboardEvidence) {
    const analysis = analysisDrafts[evidence.id]?.trim();
    if (!analysis) {
      return;
    }

    const createdComment = await postCommentText(
      `AI Evidence Analysis — ${evidence.original_name}:\n\n${analysis}`,
    );
    if (!createdComment) {
      return;
    }

    addCommentLocal(actionPlan.id, createdComment);
    setAnalysisDrafts((current) => {
      const next = { ...current };
      delete next[evidence.id];
      return next;
    });
    setAnalysisSavedIds((current) => new Set(current).add(evidence.id));
    window.setTimeout(() => {
      setAnalysisSavedIds((current) => {
        const next = new Set(current);
        next.delete(evidence.id);
        return next;
      });
    }, 2500);
  }

  async function assignOwner(userId: string) {
    const selectedUser = userOptions.find((option) => option.id === userId);
    if (!selectedUser) {
      return;
    }

    const response = await fetch(`/api/v1/action-plans/${actionPlan.id}/owners`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, is_primary: actionPlan.action_plan_owners.length === 0 }),
    });
    const body = await readResponseBody(response);

    if (!response.ok) {
      setErrorFromBody(body, "Unable to assign owner.");
      return;
    }

    const ownerId =
      body && typeof body === "object" && "owner" in body
        ? String((body as { owner?: { id?: unknown } }).owner?.id ?? userId)
        : userId;
    patchActionPlanLocal(actionPlan.id, {
      action_plan_owners: [
        ...actionPlan.action_plan_owners,
        {
          id: ownerId,
          is_primary: actionPlan.action_plan_owners.length === 0,
          user: selectedUser,
        },
      ],
    });
  }

  async function removeOwner(userId: string) {
    const response = await fetch(
      `/api/v1/action-plans/${actionPlan.id}/owners?user_id=${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
    const body = await readResponseBody(response);

    if (!response.ok) {
      setErrorFromBody(body, "Unable to remove owner.");
      return;
    }

    patchActionPlanLocal(actionPlan.id, {
      action_plan_owners: actionPlan.action_plan_owners.filter((owner) => owner.user.id !== userId),
    });
  }

  async function assignFollowUpAuditor(userId: string) {
    const selectedUser = userOptions.find((option) => option.id === userId);
    if (!selectedUser) {
      return;
    }

    const response = await fetch(`/api/v1/action-plans/${actionPlan.id}/follow-up-auditors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
    });
    const body = await readResponseBody(response);

    if (!response.ok) {
      setErrorFromBody(body, "Unable to assign follow-up auditor.");
      return;
    }

    const auditorId =
      body && typeof body === "object" && "auditor" in body
        ? String((body as { auditor?: { id?: unknown } }).auditor?.id ?? userId)
        : userId;
    patchActionPlanLocal(actionPlan.id, {
      action_plan_follow_up_auditors: [
        ...actionPlan.action_plan_follow_up_auditors,
        {
          id: auditorId,
          user: selectedUser,
        },
      ],
    });
  }

  async function removeFollowUpAuditor(userId: string) {
    const response = await fetch(
      `/api/v1/action-plans/${actionPlan.id}/follow-up-auditors?user_id=${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
    const body = await readResponseBody(response);

    if (!response.ok) {
      setErrorFromBody(body, "Unable to remove follow-up auditor.");
      return;
    }

    patchActionPlanLocal(actionPlan.id, {
      action_plan_follow_up_auditors: actionPlan.action_plan_follow_up_auditors.filter(
        (auditor) => auditor.user.id !== userId,
      ),
    });
  }

  function setErrorFromBody(body: unknown, fallback: string) {
    setEvidenceError(getResponseError(body, fallback));
  }

  async function saveClosureDate(value: string) {
    const response = await fetch(`/api/v1/action-plans/${actionPlan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ closed_at: value }),
    });
    const body = await readResponseBody(response);

    if (!response.ok) {
      toast.error(getResponseError(body, "Unable to update closure date."));
      return false;
    }

    const updated = body as { action_plan: DashboardActionPlan };
    patchActionPlanLocal(actionPlan.id, { closed_at: updated.action_plan.closed_at });
    if (auditLogOpen) {
      await loadAuditLog(actionPlan);
    }
    toast.success("Closure date updated");
    return true;
  }

  return (
    <>
      <ConfirmDialog
        cancelLabel="Discard changes"
        confirmLabel="Save changes"
        isOpen={showUnsavedDialog}
        message={`You have unsaved changes to: ${changedFields.join(", ")}. Would you like to save before closing?`}
        title="Unsaved changes"
        onCancel={discardAndClose}
        onConfirm={saveAndClose}
      />
      <ConfirmDialog
        cancelLabel="Cancel"
        confirmLabel="Delete"
        isOpen={showDeleteDialog}
        isDangerous
        message="This action plan will be permanently deleted. This cannot be undone."
        title="Delete action plan?"
        onCancel={() => setShowDeleteDialog(false)}
        onConfirm={handleDelete}
      />
      <div className="expanded-panel">
        <div className="expanded-panel__header">
          <ActionPlanSummary actionPlan={actionPlan} variant="header-card" />
          <div style={{ display: "flex", gap: "0.5rem", marginLeft: "auto" }}>
            <button
              className="button"
              onClick={async () => {
                const url = `${window.location.origin}/action-plans/${actionPlan.id}`;
                await navigator.clipboard.writeText(url);
                toast.success("Link copied!");
              }}
              title="Copy link to this action plan"
              type="button"
            >
              🔗 Copy Link
            </button>
            {isAdmin ? (
              <button
                className="button button--danger"
                onClick={() => setShowDeleteDialog(true)}
                type="button"
              >
                Delete
              </button>
            ) : null}
            <button
              className="button"
              onClick={handleCloseRequest}
              type="button"
            >
              Close
            </button>
          </div>
        </div>

        {hasUnsavedChanges ? (
          <div className="expanded-panel-save-bar">
            <span>You have unsaved changes</span>
            <div>
              <button className="button" disabled={isSaving} onClick={discardChanges} type="button">
                Discard
              </button>
              <button className="button button--primary" disabled={isSaving} onClick={saveChanges} type="button">
                {isSaving ? "Saving..." : "Save changes"}
              </button>
            </div>
          </div>
        ) : null}

        <div className="expanded-panel__left">
          <div className="detail-field">
            <div className="detail-field__label">
              <span>Action plan</span>
            </div>
            <textarea
              disabled={!canEdit}
              value={draftDescription}
              onChange={(event) => setDraftDescription(event.target.value)}
              rows={8}
            />
          </div>

          <div className="detail-field">
            <div className="detail-field__label">
              <span>Required evidence</span>
            </div>
            <textarea
              disabled={!canEdit}
              value={draftRequiredEvidence}
              onChange={(event) => setDraftRequiredEvidence(event.target.value)}
              rows={6}
            />
          </div>

          <div className="revision-strip">
            <strong>Target date</strong>
            <span>
              Original: {formatDate(actionPlan.original_target_date)} | Current:{" "}
              {formatDate(actionPlan.current_target_date)}
            </span>
            <div className="button-with-tooltip">
              <button
                className="button"
                disabled={!canEdit}
                onClick={() => setRevisionOpen((current) => !current)}
                type="button"
              >
                Request new target date
              </button>
              {!canEdit ? null : (
                <span className="button-tooltip">
                  Request a new target date for this action plan. The change will be logged and tracked.
                </span>
              )}
            </div>
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
              {revisionErrors.justification ? (
                <span className="field-error">{revisionErrors.justification}</span>
              ) : null}
              <button className="button button--primary" type="submit">
                Submit revision
              </button>
            </form>
          ) : null}
          {actionPlan.reschedule_count > 0 ? (
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              <button
                onClick={toggleRevisionHistory}
                style={{
                  alignItems: "center",
                  background: "transparent",
                  border: 0,
                  color: "var(--text3)",
                  cursor: "pointer",
                  display: "inline-flex",
                  fontSize: 12,
                  gap: 4,
                  padding: 0,
                  width: "fit-content",
                }}
                type="button"
              >
                <span
                  aria-hidden="true"
                  style={{
                    display: "inline-block",
                    transform: revisionHistoryOpen ? "rotate(90deg)" : "rotate(0deg)",
                    transition: "transform 120ms ease",
                  }}
                >
                  ▸
                </span>
                Revision history ({actionPlan.reschedule_count})
              </button>
              {revisionHistoryOpen ? (
                <div>
                  {actionPlan.target_date_revisions.map((revision) => (
                    <div
                      key={revision.id}
                      style={{
                        background: "#FAFAFA",
                        border: "1px solid #F0F0F0",
                        borderRadius: 4,
                        marginBottom: 4,
                        padding: "6px 10px",
                      }}
                    >
                      <strong style={{ color: "var(--text)", display: "block", fontSize: 12 }}>
                        {formatRevisionDate(revision.old_date)} → {formatRevisionDate(revision.new_date)}
                      </strong>
                      <span style={{ color: "var(--text2)", display: "block", fontSize: 12 }}>
                        {revision.justification}
                      </span>
                      <span style={{ color: "var(--text3)", display: "block", fontSize: 10 }}>
                        Revised by {revision.revised_by.name} on {formatDateTime(revision.revised_at)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="status-change-pills">
            {STATUS_ORDER.map((status) => (
              <button
                disabled={!canEdit || draftStatus === status}
                key={status}
                onClick={() => setDraftStatus(status)}
                style={{ borderColor: STATUS_ACCENTS[status] }}
                type="button"
              >
                {STATUS_LABELS[status]}
              </button>
            ))}
          </div>
          {draftStatus === "Closed" ? (
            <div className="detail-field">
              <div className="detail-field__label">
                <span>Closure date</span>
              </div>
              <input
                disabled={!canEdit}
                max={getTodayInputValue()}
                type="date"
                value={formatDateInputValue(draftClosedAt)}
                onChange={(event) => setDraftClosedAt(event.target.value || null)}
              />
            </div>
          ) : null}

        <section className="expanded-section">
          <h3>Evidence</h3>
          {actionPlan.evidence.length > 0 ? (
            <div style={{ display: "grid", gap: 8 }}>
              {actionPlan.evidence.map((evidence) => (
                <div key={evidence.id}>
                  <div
                    style={{
                      alignItems: "center",
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                      fontSize: 12,
                    }}
                  >
                    <span aria-hidden="true">📎</span>
                    <a
                      href={`/api/v1/action-plans/${actionPlan.id}/evidence/${evidence.id}/download`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {evidence.original_name}
                    </a>
                    <span style={{ color: "var(--text3)" }}>{formatFileSize(evidence.file_size)}</span>
                    <span style={{ color: "var(--text3)" }}>{formatDate(evidence.created_at)}</span>
                    <button
                      disabled={analyzingEvidenceId === evidence.id}
                      onClick={() => analyzeEvidence(evidence)}
                      style={{
                        background: "#fff",
                        border: "1px solid #dc2626",
                        borderRadius: 999,
                        color: "#dc2626",
                        cursor: analyzingEvidenceId === evidence.id ? "wait" : "pointer",
                        fontSize: 11,
                        padding: "3px 8px",
                      }}
                      type="button"
                    >
                      {analyzingEvidenceId === evidence.id ? "◌ Analysing…" : "✦ AI Analysis"}
                    </button>
                    {analysisSavedIds.has(evidence.id) ? (
                      <span style={{ color: "#1A7A1A", fontSize: 11 }}>✓ Saved to comments</span>
                    ) : null}
                  </div>
                  {analysisErrors[evidence.id] ? (
                    <div style={{ color: "#dc2626", fontSize: 11, marginTop: 4 }}>
                      {analysisErrors[evidence.id]}
                    </div>
                  ) : null}
                  {analysisDrafts[evidence.id] !== undefined ? (
                    <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                      <textarea
                        style={{ minHeight: 120 }}
                        value={analysisDrafts[evidence.id]}
                        onChange={(event) =>
                          setAnalysisDrafts((current) => ({
                            ...current,
                            [evidence.id]: event.target.value,
                          }))
                        }
                      />
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          className="button button--primary"
                          onClick={() => saveAnalysisAsComment(evidence)}
                          type="button"
                        >
                          Save as Comment
                        </button>
                        <button
                          className="button"
                          onClick={() =>
                            setAnalysisDrafts((current) => {
                              const next = { ...current };
                              delete next[evidence.id];
                              return next;
                            })
                          }
                          type="button"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
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
          {actionPlan.comments.map((item) => (
            <p key={item.id}>
              <strong>{item.user.name}</strong>{" "}
              <span style={{ color: "var(--text3)", fontSize: 11 }}>
                {formatDateTime(item.created_at)}
              </span>
              : {item.comment}
            </p>
          ))}
          {actionPlan.comments.length === 0 ? (
            <EmptyState title="No comments yet" subtitle="Comments and discussion notes will appear here." />
          ) : null}
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
          <button className="audit-log-toggle" onClick={() => loadAuditLog(actionPlan)} type="button">
            {auditLogOpen ? "Audit log" : "Show audit log"}
          </button>
          {auditLogOpen ? (
            auditLogs.length > 0 ? (
              <AuditLogTimeline entries={auditLogs} />
            ) : (
              <EmptyState title="No audit log yet" subtitle="Changes to this action plan will appear here." />
            )
          ) : null}
        </section>
      </div>

      <div className="expanded-panel__right">
        <section className="expanded-section">
          <h3>Finding Context</h3>
          <EditableField
            disabled={!canEditFinding}
            label="Finding title"
            value={actionPlan.finding?.title ?? "No finding linked"}
            onSave={async (value) => {
              if (!actionPlan.finding?.id) return;
              const response = await fetch(`/api/v1/findings/${actionPlan.finding.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: value }),
              });
              const body = await readResponseBody(response);
              if (!response.ok) {
                throw new Error(getResponseError(body, "Unable to update finding title."));
              }
              patchActionPlanLocal(actionPlan.id, {
                finding: { ...actionPlan.finding, title: value },
              });
            }}
          />
          <EditableField
            disabled={!canEditFinding}
            label="Finding description"
            multiline
            value={actionPlan.finding?.description ?? null}
            onSave={async (value) => {
              if (!actionPlan.finding?.id) return;
              const response = await fetch(`/api/v1/findings/${actionPlan.finding.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ description: value }),
              });
              const body = await readResponseBody(response);
              if (!response.ok) {
                throw new Error(getResponseError(body, "Unable to update finding description."));
              }
              patchActionPlanLocal(actionPlan.id, {
                finding: { ...actionPlan.finding, description: value },
              });
            }}
          />
        </section>

        <section className="expanded-section">
          <h3>Audit Info</h3>
          <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8 }}>
            <p style={{ margin: 0 }}>{audit?.name ?? "No audit linked"}</p>
            <AuditTypeBadge auditType={audit?.audit_type} />
            {audit ? (
              <a href={`/audits/${audit.id}`} style={{ color: "#dc2626", fontSize: 12 }}>
                View Audit →
              </a>
            ) : null}
          </div>
          <p>
            Entities:{" "}
            {audit?.audit_entities
              .map(({ entity }) => entity.code)
              .join(", ") || "None"}
          </p>
        </section>

        <section className="expanded-section">
          <h3>Owners</h3>
          <CompactAssignmentSection
            assignedUsers={actionPlan.action_plan_owners}
            buttonLabel="+ Assign Owner"
            canManage={canManageAssignments}
            emptyText="No owner assigned"
            userOptions={userOptions}
            onAssign={assignOwner}
            onRemove={removeOwner}
          />
        </section>

        <section className="expanded-section">
          <h3>Follow-up Auditors</h3>
          <CompactAssignmentSection
            assignedUsers={actionPlan.action_plan_follow_up_auditors}
            buttonLabel="+ Assign Follow-up Auditor"
            canManage={canManageAssignments}
            emptyText="No follow-up auditor assigned"
            userOptions={userOptions.filter((option) => option.is_internal_auditor)}
            onAssign={assignFollowUpAuditor}
            onRemove={removeFollowUpAuditor}
          />
        </section>

      </div>
    </div>
    </>
  );
}

function CompactAssignmentSection({
  assignedUsers,
  buttonLabel,
  canManage,
  emptyText,
  userOptions,
  onAssign,
  onRemove,
}: {
  assignedUsers: { id: string; is_primary?: boolean; user: RelatedUser }[];
  buttonLabel: string;
  canManage: boolean;
  emptyText: string;
  userOptions: UserOption[];
  onAssign: (userId: string) => Promise<void>;
  onRemove: (userId: string) => Promise<void>;
}) {
  const [isAssigning, setIsAssigning] = useState(false);
  const assignedIds = new Set(assignedUsers.map((assignment) => assignment.user.id));
  const availableUsers = userOptions.filter((option) => !assignedIds.has(option.id));

  async function assign(userId: string) {
    if (!userId) {
      return;
    }

    await onAssign(userId);
    setIsAssigning(false);
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      {assignedUsers.length > 0 ? (
        assignedUsers.map((assignment) => (
          <div
            key={assignment.id}
            style={{ alignItems: "center", display: "flex", gap: 6, minHeight: 24 }}
          >
            <span
              style={{
                alignItems: "center",
                background: "var(--surface2)",
                borderRadius: "50%",
                color: "var(--text)",
                display: "inline-flex",
                fontSize: 10,
                height: 24,
                justifyContent: "center",
                width: 24,
              }}
            >
              {getInitials(assignment.user.name)}
            </span>
            <span style={{ color: "var(--text)", fontSize: 12, fontWeight: 500 }}>
              {assignment.user.name}
            </span>
            {assignment.is_primary ? (
              <span
                style={{
                  background: "#fef2f2",
                  borderRadius: 999,
                  color: "#dc2626",
                  fontSize: 10,
                  padding: "1px 6px",
                }}
              >
                primary
              </span>
            ) : null}
            {canManage ? (
              <button
                onClick={() => onRemove(assignment.user.id)}
                style={{
                  background: "transparent",
                  border: 0,
                  color: "var(--text3)",
                  cursor: "pointer",
                  fontSize: 11,
                  padding: 2,
                }}
                type="button"
              >
                ×
              </button>
            ) : null}
          </div>
        ))
      ) : (
        <span style={{ color: "var(--text3)", fontSize: 12 }}>{emptyText}</span>
      )}

      {canManage ? (
        isAssigning ? (
          <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
            <select
              defaultValue=""
              onChange={(event) => assign(event.target.value)}
              style={{ fontSize: 12, minHeight: 28 }}
            >
              <option disabled value="">
                Select a user…
              </option>
              {availableUsers.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                  {option.department ? ` - ${option.department}` : ""}
                </option>
              ))}
            </select>
            <button
              onClick={() => setIsAssigning(false)}
              style={{
                background: "transparent",
                border: 0,
                color: "var(--text3)",
                cursor: "pointer",
                fontSize: 12,
                padding: 0,
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsAssigning(true)}
            style={{
              background: "transparent",
              border: 0,
              color: "#dc2626",
              cursor: "pointer",
              fontSize: 12,
              padding: 0,
              textAlign: "left",
            }}
            type="button"
          >
            {buttonLabel}
          </button>
        )
      ) : null}
    </div>
  );
}

function AuditLogTimeline({ entries }: { entries: AuditLogEntry[] }) {
  return (
    <ol className="audit-log-timeline" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {entries.map((entry, index) => {
        const color = getAuditLogColor(entry.action);
        return (
          <li
            key={entry.id}
            style={{ display: "grid", gridTemplateColumns: "14px 1fr", gap: 8, minHeight: 38 }}
          >
            <span style={{ alignItems: "center", display: "flex", flexDirection: "column" }}>
              <span
                style={{
                  background: color,
                  borderRadius: "50%",
                  display: "block",
                  height: 8,
                  marginTop: 4,
                  width: 8,
                }}
              />
              {index < entries.length - 1 ? (
                <span
                  style={{
                    borderLeft: "1px solid #E6E6E6",
                    flex: 1,
                    marginLeft: 3,
                    marginTop: 3,
                  }}
                />
              ) : null}
            </span>
            <span style={{ display: "grid", gap: 2, paddingBottom: 10 }}>
              <span style={{ color: "var(--text)", fontSize: 12, whiteSpace: "pre-line" }}>
                {formatAuditLogEntry(entry)}
              </span>
              <span style={{ color: "var(--text3)", fontSize: 11 }}>
                {entry.user?.name ?? "System"} · {formatDate(entry.created_at)}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

