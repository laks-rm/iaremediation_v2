import type { ActionPlanStatus, AuditType, Priority } from "@prisma/client";

type BadgeColors = {
  bg: string;
  text: string;
};

export const AUDIT_TYPE_LABELS = {
  IT: "IT",
  RegulatoryIT: "Regulatory IT",
  Operations: "Operations",
  RegulatoryOperations: "Regulatory Operations",
  External: "External",
} satisfies Record<AuditType, string>;

export const AUDIT_TYPE_COLORS = {
  IT: { bg: "bg-blue-100", text: "text-blue-800" },
  RegulatoryIT: { bg: "bg-amber-100", text: "text-amber-800" },
  Operations: { bg: "bg-emerald-100", text: "text-emerald-800" },
  RegulatoryOperations: { bg: "bg-teal-100", text: "text-teal-800" },
  External: { bg: "bg-purple-100", text: "text-purple-800" },
} satisfies Record<AuditType, BadgeColors>;

export const STATUS_LABELS = {
  NotStarted: "Not Started",
  InProgress: "In Progress",
  PendingValidation: "Pending Validation",
  Closed: "Closed",
  RiskAccepted: "Risk Accepted",
  Dropped: "Dropped",
} satisfies Record<ActionPlanStatus, string>;

export const STATUS_COLORS = {
  NotStarted: { bg: "bg-slate-100", text: "text-slate-800" },
  InProgress: { bg: "bg-blue-100", text: "text-blue-800" },
  PendingValidation: { bg: "bg-amber-100", text: "text-amber-800" },
  Closed: { bg: "bg-green-100", text: "text-green-800" },
  RiskAccepted: { bg: "bg-purple-100", text: "text-purple-800" },
  Dropped: { bg: "bg-zinc-100", text: "text-zinc-800" },
} satisfies Record<ActionPlanStatus, BadgeColors>;

export const PRIORITY_COLORS = {
  High: { bg: "bg-red-100", text: "text-red-800" },
  Moderate: { bg: "bg-amber-100", text: "text-amber-800" },
  Low: { bg: "bg-slate-100", text: "text-slate-800" },
} satisfies Record<Priority, BadgeColors>;

export const CONTROL_RATING_LABELS: Record<string, string> = {
  Effective: "Effective",
  PartiallyEffective: "Partially Effective",
  NotEffective: "Not Effective",
};
