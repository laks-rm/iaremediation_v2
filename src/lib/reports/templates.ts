import type { ActionPlanStatus, Priority } from "@prisma/client";

export type ReportType =
  | "portfolio-status"
  | "entity-regulatory"
  | "audit-followup"
  | "overdue-plans"
  | "closure-report"
  | "owner-workload";

export type ReportFormat = "xlsx" | "pdf";

export type ReportParams = {
  from: Date;
  to: Date;
  format: ReportFormat;
  entity?: string;     // entity code (for entity-regulatory and optional filter)
  audit?: string;      // audit UUID (for audit-followup)
  department?: string; // department name (optional filter)
  userId: string;
  userName: string;
  userRole: string;
};

export type ReportConfig = {
  title: string;
  description: string;
  icon: string;
  requiresEntity?: boolean;
  requiresAudit?: boolean;
  hasEntityFilter?: boolean;
  hasDepartmentFilter?: boolean;
};

export const REPORT_CONFIGS: Record<ReportType, ReportConfig> = {
  "portfolio-status": {
    title: "Portfolio Status Summary",
    description: "Overall portfolio health: open, closed, overdue by priority and entity.",
    icon: "📊",
  },
  "entity-regulatory": {
    title: "Entity Regulatory Report",
    description: "Entity-specific report for regulatory submissions.",
    icon: "🏢",
    requiresEntity: true,
    hasEntityFilter: true,
  },
  "audit-followup": {
    title: "Audit Follow-up Report",
    description: "Progress and status for a specific audit.",
    icon: "📋",
    requiresAudit: true,
  },
  "overdue-plans": {
    title: "Overdue Action Plans",
    description: "All open plans past their target date.",
    icon: "⚠️",
    hasEntityFilter: true,
    hasDepartmentFilter: true,
  },
  "closure-report": {
    title: "Closure Report",
    description: "Action plans closed within the period with timing analysis.",
    icon: "✅",
  },
  "owner-workload": {
    title: "Owner Workload Report",
    description: "Open items, overdue, and upcoming due dates per owner.",
    icon: "👤",
    hasDepartmentFilter: true,
  },
};

export const OPEN_STATUSES: ActionPlanStatus[] = ["NotStarted", "InProgress", "PendingValidation"];
export const CLOSED_STATUSES_SET = new Set<ActionPlanStatus>(["Closed", "RiskAccepted", "Dropped"]);

export const STATUS_LABELS: Record<ActionPlanStatus, string> = {
  NotStarted: "Not Started",
  InProgress: "In Progress",
  PendingValidation: "Pending Validation",
  Closed: "Closed",
  RiskAccepted: "Risk Accepted",
  Dropped: "Dropped",
};

export const ALL_PRIORITIES: Priority[] = ["High", "Moderate", "Low"];

export const HEADER_ARGB = "FF1E293B"; // dark slate
export const WHITE_ARGB = "FFFFFFFF";
export const GREEN_ARGB = "FFD1FAE5";
export const AMBER_ARGB = "FFFEF3C7";
export const RED_ARGB = "FFFEE2E2";
export const BLUE_ARGB = "FFDBEAFE";

export function formatDate(date: Date | null | undefined): string {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function formatDateShort(date: Date | null | undefined): string {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

export function daysDiff(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

export function getOwnershipFilter(userId: string, userRole: string) {
  if (userRole === "Auditee" || userRole === "Viewer") {
    return { action_plan_owners: { some: { user_id: userId } } };
  }
  return {};
}

export function getPrimaryOwner(owners: { is_primary: boolean; user: { name: string; department: string | null; team_l2: string | null } }[]) {
  const primary = owners.find((o) => o.is_primary) ?? owners[0];
  return primary?.user ?? null;
}

export function getOwnerDept(owner: { department: string | null; team_l2: string | null } | null): string {
  return owner?.team_l2?.trim() || owner?.department?.trim() || "";
}
