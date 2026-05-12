import type { DashboardActionPlan } from "../components/action-plans/ActionPlanTable";

export type ActionPlanFilterFieldId =
  | "status"
  | "priority"
  | "created_via"
  | "owner_id"
  | "follow_up_auditor_id"
  | "line_manager_id"
  | "audit_id"
  | "audit_type"
  | "entity"
  | "department"
  | "created_at"
  | "original_target_date"
  | "current_target_date"
  | "closed_at";

export type ActionPlanStatusValue =
  | "NotStarted"
  | "InProgress"
  | "PendingValidation"
  | "Closed"
  | "RiskAccepted"
  | "Dropped";

export type PriorityValue = "High" | "Moderate" | "Low";

export type AuditTypeValue = "IT" | "RegulatoryIT" | "Operations" | "RegulatoryOperations" | "External";

export type CreatedViaValue = "Manual" | "AIIngestion" | "Migration" | "Standalone";

export type ActionPlanFilterChip =
  | { id: string; field: "status"; value: ActionPlanStatusValue }
  | { id: string; field: "priority"; value: PriorityValue }
  | { id: string; field: "created_via"; value: CreatedViaValue }
  | { id: string; field: "owner_id"; value: string }
  | { id: string; field: "follow_up_auditor_id"; value: string }
  | { id: string; field: "line_manager_id"; value: string }
  | { id: string; field: "audit_id"; value: string }
  | { id: string; field: "audit_type"; value: AuditTypeValue }
  | { id: string; field: "entity"; values: string[] }
  | { id: string; field: "department"; value: string }
  | { id: string; field: "created_at"; from: string | null; to: string | null }
  | { id: string; field: "original_target_date"; from: string | null; to: string | null }
  | { id: string; field: "current_target_date"; from: string | null; to: string | null }
  | { id: string; field: "closed_at"; from: string | null; to: string | null };

const STATUS_VALUES: ActionPlanStatusValue[] = [
  "NotStarted",
  "InProgress",
  "PendingValidation",
  "Closed",
  "RiskAccepted",
  "Dropped",
];

const PRIORITY_VALUES: PriorityValue[] = ["High", "Moderate", "Low"];

const AUDIT_TYPE_VALUES: AuditTypeValue[] = [
  "IT",
  "RegulatoryIT",
  "Operations",
  "RegulatoryOperations",
  "External",
];

const CREATED_VIA_VALUES: CreatedViaValue[] = ["Manual", "AIIngestion", "Migration", "Standalone"];

const DATE_FIELDS = new Set<ActionPlanFilterFieldId>([
  "created_at",
  "original_target_date",
  "current_target_date",
  "closed_at",
]);

const ENTITY_CODE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ACTION_PLAN_FILTER_FIELD_IDS: ActionPlanFilterFieldId[] = [
  "status",
  "priority",
  "created_via",
  "owner_id",
  "follow_up_auditor_id",
  "line_manager_id",
  "audit_id",
  "audit_type",
  "entity",
  "department",
  "created_at",
  "original_target_date",
  "current_target_date",
  "closed_at",
];

export function isValidDateRangeOrder(from: string | null, to: string | null): boolean {
  if (!from || !to) {
    return true;
  }

  const fromTime = new Date(`${from}T00:00:00.000Z`).getTime();
  const toTime = new Date(`${to}T00:00:00.000Z`).getTime();

  if (Number.isNaN(fromTime) || Number.isNaN(toTime)) {
    return false;
  }

  return fromTime <= toTime;
}

function parseIsoDay(value: string): number {
  return new Date(`${value}T00:00:00.000Z`).getTime();
}

function planDateField(
  plan: DashboardActionPlan,
  field: "created_at" | "original_target_date" | "current_target_date" | "closed_at",
): string | null {
  if (field === "created_at") {
    return plan.created_at?.slice(0, 10) ?? null;
  }

  const raw =
    field === "original_target_date"
      ? plan.original_target_date
      : field === "current_target_date"
        ? plan.current_target_date
        : plan.closed_at;

  if (!raw) {
    return null;
  }

  return raw.slice(0, 10);
}

function matchesDateRange(
  plan: DashboardActionPlan,
  field: "created_at" | "original_target_date" | "current_target_date" | "closed_at",
  from: string | null,
  to: string | null,
): boolean {
  const day = planDateField(plan, field);
  if (!day) {
    return false;
  }

  const t = parseIsoDay(day);
  if (Number.isNaN(t)) {
    return false;
  }

  if (from) {
    const fromT = parseIsoDay(from);
    if (Number.isNaN(fromT) || t < fromT) {
      return false;
    }
  }

  if (to) {
    const toT = parseIsoDay(to);
    if (Number.isNaN(toT) || t > toT) {
      return false;
    }
  }

  return true;
}

function planMatchesChip(plan: DashboardActionPlan, chip: ActionPlanFilterChip): boolean {
  switch (chip.field) {
    case "status":
      return plan.status === chip.value;
    case "priority":
      return (plan.priority ?? "") === chip.value;
    case "created_via":
      return plan.created_via === chip.value;
    case "owner_id":
      return plan.action_plan_owners.some((row) => row.user.id === chip.value);
    case "follow_up_auditor_id":
      return plan.action_plan_follow_up_auditors.some((row) => row.user.id === chip.value);
    case "line_manager_id":
      return plan.action_plan_line_managers.some((row) => row.user.id === chip.value);
    case "audit_id": {
      const auditId = plan.finding?.audit?.id;
      return auditId === chip.value;
    }
    case "audit_type": {
      const auditType = plan.finding?.audit?.audit_type;
      return auditType === chip.value;
    }
    case "entity": {
      const codes = new Set(plan.action_plan_entities.map((row) => row.entity.code));
      return chip.values.some((code) => codes.has(code));
    }
    case "department": {
      const dep = (plan.department ?? "").trim().toLowerCase();
      return dep === chip.value.trim().toLowerCase();
    }
    case "created_at":
    case "original_target_date":
    case "current_target_date":
    case "closed_at":
      return matchesDateRange(plan, chip.field, chip.from, chip.to);
  }
}

export function applyFilters(
  plans: DashboardActionPlan[],
  chips: ActionPlanFilterChip[],
): DashboardActionPlan[] {
  if (chips.length === 0) {
    return plans;
  }

  const byField = new Map<ActionPlanFilterFieldId, ActionPlanFilterChip[]>();
  for (const chip of chips) {
    const list = byField.get(chip.field) ?? [];
    list.push(chip);
    byField.set(chip.field, list);
  }

  return plans.filter((plan) => {
    for (const [, group] of byField) {
      const any = group.some((chip) => planMatchesChip(plan, chip));
      if (!any) {
        return false;
      }
    }

    return true;
  });
}

function serializeChipValue(chip: ActionPlanFilterChip): string {
  if (chip.field === "entity") {
    return chip.values.join("|");
  }

  if (
    chip.field === "created_at" ||
    chip.field === "original_target_date" ||
    chip.field === "current_target_date" ||
    chip.field === "closed_at"
  ) {
    return `${chip.from ?? ""}..${chip.to ?? ""}`;
  }

  return chip.value;
}

export function serializeFilters(chips: ActionPlanFilterChip[]): string {
  return chips
    .map((chip) => `${chip.field}:${encodeURIComponent(serializeChipValue(chip))}`)
    .join(",");
}

function parseDateRangeSegment(raw: string): { from: string | null; to: string | null } | null {
  const decoded = decodeURIComponent(raw);
  const parts = decoded.split("..");

  if (parts.length > 2) {
    return null;
  }

  const from = parts[0]?.trim() ? parts[0].trim() : null;
  const to = parts[1]?.trim() ? parts[1].trim() : null;

  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return null;
  }

  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return null;
  }

  if (from && to && !isValidDateRangeOrder(from, to)) {
    return null;
  }

  return { from, to };
}

function chipFromFieldValue(
  field: ActionPlanFilterFieldId,
  rawValue: string,
  idSuffix: string,
): ActionPlanFilterChip | null {
  const value = decodeURIComponent(rawValue);

  if (DATE_FIELDS.has(field)) {
    const range = parseDateRangeSegment(rawValue);
    if (!range || (!range.from && !range.to)) {
      return null;
    }

    const id = `${field}-${idSuffix}`;

    if (field === "created_at") {
      return { id, field: "created_at", ...range };
    }

    if (field === "original_target_date") {
      return { id, field: "original_target_date", ...range };
    }

    if (field === "current_target_date") {
      return { id, field: "current_target_date", ...range };
    }

    return { id, field: "closed_at", ...range };
  }

  if (field === "entity") {
    const codes = value
      .split("|")
      .map((code) => code.trim())
      .filter((code) => ENTITY_CODE_PATTERN.test(code));

    if (codes.length === 0) {
      return null;
    }

    return { id: `entity-${idSuffix}`, field: "entity", values: codes };
  }

  if (field === "status" && STATUS_VALUES.includes(value as ActionPlanStatusValue)) {
    return { id: `status-${idSuffix}`, field: "status", value: value as ActionPlanStatusValue };
  }

  if (field === "priority" && PRIORITY_VALUES.includes(value as PriorityValue)) {
    return { id: `priority-${idSuffix}`, field: "priority", value: value as PriorityValue };
  }

  if (field === "created_via" && CREATED_VIA_VALUES.includes(value as CreatedViaValue)) {
    return { id: `created_via-${idSuffix}`, field: "created_via", value: value as CreatedViaValue };
  }

  if (field === "audit_type" && AUDIT_TYPE_VALUES.includes(value as AuditTypeValue)) {
    return { id: `audit_type-${idSuffix}`, field: "audit_type", value: value as AuditTypeValue };
  }

  if (
    (field === "owner_id" ||
      field === "follow_up_auditor_id" ||
      field === "line_manager_id" ||
      field === "audit_id") &&
    UUID_PATTERN.test(value)
  ) {
    return { id: `${field}-${idSuffix}`, field, value };
  }

  if (field === "department" && value.trim()) {
    return { id: `department-${idSuffix}`, field: "department", value: value.trim() };
  }

  return null;
}

export function parseFiltersParam(param: string | null): ActionPlanFilterChip[] {
  if (!param?.trim()) {
    return [];
  }

  const chips: ActionPlanFilterChip[] = [];
  let index = 0;

  for (const segment of param.split(",")) {
    const trimmed = segment.trim();
    if (!trimmed) {
      continue;
    }

    const colon = trimmed.indexOf(":");
    if (colon <= 0) {
      continue;
    }

    const field = trimmed.slice(0, colon) as ActionPlanFilterFieldId;
    const rawValue = trimmed.slice(colon + 1);

    if (!ACTION_PLAN_FILTER_FIELD_IDS.includes(field)) {
      continue;
    }

    const chip = chipFromFieldValue(field, rawValue, String(index));
    if (chip) {
      chips.push(chip);
    }

    index += 1;
  }

  return chips;
}

export function migrateLegacySearchParams(searchParams: URLSearchParams): ActionPlanFilterChip[] {
  const chips: ActionPlanFilterChip[] = [];
  let i = 0;

  const push = (chip: ActionPlanFilterChip | null) => {
    if (chip) {
      chips.push(chip);
    }
  };

  for (const status of searchParams.get("status")?.split(",").map((s) => s.trim()).filter(Boolean) ?? []) {
    if (STATUS_VALUES.includes(status as ActionPlanStatusValue)) {
      push({ id: `m-status-${i++}`, field: "status", value: status as ActionPlanStatusValue });
    }
  }

  for (const priority of searchParams.get("priority")?.split(",").map((s) => s.trim()).filter(Boolean) ?? []) {
    if (PRIORITY_VALUES.includes(priority as PriorityValue)) {
      push({ id: `m-priority-${i++}`, field: "priority", value: priority as PriorityValue });
    }
  }

  for (const id of searchParams.get("audit")?.split(",").map((s) => s.trim()).filter(Boolean) ?? []) {
    if (UUID_PATTERN.test(id)) {
      push({ id: `m-audit-${i++}`, field: "audit_id", value: id });
    }
  }

  for (const id of searchParams.get("owner")?.split(",").map((s) => s.trim()).filter(Boolean) ?? []) {
    if (UUID_PATTERN.test(id)) {
      push({ id: `m-owner-${i++}`, field: "owner_id", value: id });
    }
  }

  for (const cv of searchParams.get("created_via")?.split(",").map((s) => s.trim()).filter(Boolean) ?? []) {
    if (CREATED_VIA_VALUES.includes(cv as CreatedViaValue)) {
      push({ id: `m-cv-${i++}`, field: "created_via", value: cv as CreatedViaValue });
    }
  }

  for (const code of searchParams.get("entity")?.split(",").map((s) => s.trim()).filter(Boolean) ?? []) {
    if (ENTITY_CODE_PATTERN.test(code)) {
      push({ id: `m-entity-${i++}`, field: "entity", values: [code] });
    }
  }

  for (const at of searchParams.get("audit_type")?.split(",").map((s) => s.trim()).filter(Boolean) ?? []) {
    if (AUDIT_TYPE_VALUES.includes(at as AuditTypeValue)) {
      push({ id: `m-at-${i++}`, field: "audit_type", value: at as AuditTypeValue });
    }
  }

  const department = searchParams.get("department")?.trim();
  if (department) {
    push({ id: `m-dep-${i++}`, field: "department", value: department.slice(0, 120) });
  }

  return chips;
}

export type LegacyFiltersShape = {
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
};

export function stackableFiltersToLegacyQuery(
  chips: ActionPlanFilterChip[],
): Pick<
  LegacyFiltersShape,
  "status" | "priority" | "audit" | "owner" | "created_via" | "entity" | "audit_type" | "department"
> {
  const status: string[] = [];
  const priority: string[] = [];
  const audit: string[] = [];
  const owner: string[] = [];
  const created_via: string[] = [];
  const entity = new Set<string>();
  const audit_type: string[] = [];
  let department = "";

  for (const chip of chips) {
    switch (chip.field) {
      case "status":
        status.push(chip.value);
        break;
      case "priority":
        priority.push(chip.value);
        break;
      case "audit_id":
        audit.push(chip.value);
        break;
      case "owner_id":
        owner.push(chip.value);
        break;
      case "created_via":
        created_via.push(chip.value);
        break;
      case "entity":
        chip.values.forEach((c) => entity.add(c));
        break;
      case "audit_type":
        audit_type.push(chip.value);
        break;
      case "department":
        department = chip.value;
        break;
      default:
        break;
    }
  }

  return {
    status: status.join(","),
    priority: priority.join(","),
    audit: audit.join(","),
    owner: owner.join(","),
    created_via: created_via.join(","),
    entity: [...entity].join(","),
    audit_type: audit_type.join(","),
    department,
  };
}
