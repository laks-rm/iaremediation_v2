"use client";

import {
  AUDIT_TYPE_COLORS,
  AUDIT_TYPE_LABELS,
  PRIORITY_COLORS,
  STATUS_COLORS,
  STATUS_LABELS,
} from "../../lib/constants";

type Status = keyof typeof STATUS_LABELS;
type Priority = keyof typeof PRIORITY_COLORS;
type AuditType = keyof typeof AUDIT_TYPE_LABELS;

type SummaryUser = {
  name?: string | null;
  department?: string | null;
  team_l2?: string | null;
  dept_l2?: string | null;
};

export type ActionPlanSummaryData = {
  display_id: string;
  priority: Priority | null;
  status: Status;
  current_target_date: string | null;
  is_overdue?: boolean;
  days_overdue?: number;
  evidence_count?: number;
  evidence?: unknown[];
  department?: string | null;
  finding?: {
    title?: string | null;
    audit?: {
      name?: string | null;
      audit_type?: AuditType | null;
    } | null;
  } | null;
  action_plan_owners?: {
    user: SummaryUser;
  }[];
};

type SummaryVariant = "table-row" | "header-card";

const CLOSED_STATUSES: Status[] = ["Closed", "Dropped", "RiskAccepted"];
const URGENCY_COLORS = {
  overdue: "#E24B4A",
  dueSoon: "#EF9F27",
  future: "#D3D1C7",
  closed: "#97C459",
};

function getInitials(name?: string | null) {
  return (name ?? "User")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function getAvatarColor(name?: string | null) {
  const colors = ["#E0E7FF", "#DCFCE7", "#FEF3C7", "#FCE7F3", "#E0F2FE", "#F3E8FF"];
  const textColors = ["#3730A3", "#166534", "#92400E", "#9D174D", "#075985", "#6B21A8"];
  const seed = (name ?? "User").split("").reduce((total, char) => total + char.charCodeAt(0), 0);
  const index = seed % colors.length;

  return {
    background: colors[index],
    color: textColors[index],
  };
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function getDaysUntil(value: string | null) {
  if (!value) {
    return null;
  }

  const target = startOfDay(new Date(value));
  const today = startOfDay(new Date());

  return Math.ceil((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function formatShortDate(value: string | null) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function getDueMeta(actionPlan: ActionPlanSummaryData) {
  const isClosed = CLOSED_STATUSES.includes(actionPlan.status);
  const daysUntil = getDaysUntil(actionPlan.current_target_date);
  const isOverdue =
    !isClosed &&
    (actionPlan.is_overdue || (typeof daysUntil === "number" && daysUntil < 0));
  const daysOverdue = actionPlan.days_overdue ?? (typeof daysUntil === "number" ? Math.abs(daysUntil) : 0);

  if (isClosed) {
    return {
      dotColor: URGENCY_COLORS.closed,
      label: "closed",
      tone: "closed",
    } as const;
  }

  if (isOverdue) {
    return {
      dotColor: URGENCY_COLORS.overdue,
      label: `${daysOverdue}d over`,
      tone: "overdue",
    } as const;
  }

  if (daysUntil === 0) {
    return {
      dotColor: URGENCY_COLORS.dueSoon,
      label: "due today",
      tone: "soon",
    } as const;
  }

  if (typeof daysUntil === "number" && daysUntil > 0 && daysUntil <= 7) {
    return {
      dotColor: URGENCY_COLORS.dueSoon,
      label: `in ${daysUntil}d`,
      tone: "soon",
    } as const;
  }

  return {
    dotColor: URGENCY_COLORS.future,
    label: typeof daysUntil === "number" && daysUntil > 0 ? `in ${daysUntil}d` : "no date",
    tone: "future",
  } as const;
}

function Chip({
  children,
  className = "",
}: {
  children: string;
  className?: string;
}) {
  return <span className={`summary-chip ${className}`}>{children}</span>;
}

function EvidencePill({
  count,
  isClosed,
  isOverdue,
}: {
  count: number;
  isClosed: boolean;
  isOverdue: boolean;
}) {
  let tone = "neutral";

  if (isOverdue && count === 0) {
    tone = "urgent";
  } else if (isClosed && count > 0) {
    tone = "complete";
  }

  return <span className={`summary-evidence-pill summary-evidence-pill--${tone}`}>{count}</span>;
}

export default function ActionPlanSummary({
  actionPlan,
  variant = "table-row",
}: {
  actionPlan: ActionPlanSummaryData;
  variant?: SummaryVariant;
}) {
  const audit = actionPlan.finding?.audit ?? null;
  const owner = actionPlan.action_plan_owners?.[0]?.user;
  const isClosed = CLOSED_STATUSES.includes(actionPlan.status);
  const dueMeta = getDueMeta(actionPlan);
  const priorityColors = actionPlan.priority ? PRIORITY_COLORS[actionPlan.priority] : null;
  const statusColors = STATUS_COLORS[actionPlan.status];
  const auditColors = audit?.audit_type ? AUDIT_TYPE_COLORS[audit.audit_type] : null;
  const evidenceCount = actionPlan.evidence_count ?? actionPlan.evidence?.length ?? 0;
  const ownerDepartment =
    owner?.team_l2 ?? owner?.dept_l2 ?? owner?.department ?? actionPlan.department ?? "No department";

  return (
    <div className={`action-plan-summary action-plan-summary--${variant}`}>
      <div className="action-plan-summary__cell action-plan-summary__primary">
        {variant === "header-card" ? <span className="action-plan-summary__label">Action Plan</span> : null}
        <div className="action-plan-summary__meta-row">
          <span
            aria-label={dueMeta.label}
            className="action-plan-summary__urgency-dot"
            style={{ backgroundColor: dueMeta.dotColor }}
          />
          <code className="action-plan-summary__id" title={actionPlan.display_id}>
            {actionPlan.display_id}
          </code>
          {actionPlan.priority && priorityColors ? (
            <Chip className={`${priorityColors.bg} ${priorityColors.text}`}>
              {actionPlan.priority}
            </Chip>
          ) : null}
        </div>
        <strong className={isClosed ? "action-plan-summary__title action-plan-summary__title--muted" : "action-plan-summary__title"}>
          {actionPlan.finding?.title ?? "No finding linked"}
        </strong>
      </div>

      <div
        className={`action-plan-summary__cell action-plan-summary__audit ${
          auditColors ? auditColors.text : "action-plan-summary__audit--empty"
        }`}
      >
        {variant === "header-card" ? <span className="action-plan-summary__label">Audit</span> : null}
        {audit ? (
          <div className="action-plan-summary__audit-content">
            <strong title={audit.name ?? undefined}>{audit.name ?? "No audit linked"}</strong>
            <em>{audit.audit_type ? AUDIT_TYPE_LABELS[audit.audit_type] : "No audit type"}</em>
          </div>
        ) : (
          <span className="action-plan-summary__empty">—</span>
        )}
      </div>

      <div className="action-plan-summary__cell action-plan-summary__owner">
        {variant === "header-card" ? <span className="action-plan-summary__label">Owner</span> : null}
        <span className="action-plan-summary__avatar" style={getAvatarColor(owner?.name)}>
          {getInitials(owner?.name)}
        </span>
        <span className="action-plan-summary__owner-text">
          <strong>{owner?.name ?? "Unassigned"}</strong>
          <em>{ownerDepartment}</em>
        </span>
      </div>

      <div className="action-plan-summary__cell">
        {variant === "header-card" ? <span className="action-plan-summary__label">Status</span> : null}
        <Chip className={`${statusColors.bg} ${statusColors.text}`}>
          {STATUS_LABELS[actionPlan.status]}
        </Chip>
      </div>

      <div className="action-plan-summary__cell">
        {variant === "header-card" ? <span className="action-plan-summary__label">Priority</span> : null}
        {actionPlan.priority && priorityColors ? (
          <Chip className={`${priorityColors.bg} ${priorityColors.text}`}>
            {actionPlan.priority}
          </Chip>
        ) : (
          <span className="action-plan-summary__empty">Not set</span>
        )}
      </div>

      <div className="action-plan-summary__cell action-plan-summary__due">
        {variant === "header-card" ? <span className="action-plan-summary__label">Due</span> : null}
        <strong>{formatShortDate(actionPlan.current_target_date)}</strong>
        <em className={`action-plan-summary__due-line action-plan-summary__due-line--${dueMeta.tone}`}>
          {dueMeta.label}
        </em>
      </div>

      <div className="action-plan-summary__cell action-plan-summary__evidence">
        {variant === "header-card" ? <span className="action-plan-summary__label">Evid</span> : null}
        <EvidencePill
          count={evidenceCount}
          isClosed={actionPlan.status === "Closed"}
          isOverdue={dueMeta.tone === "overdue"}
        />
      </div>
    </div>
  );
}
