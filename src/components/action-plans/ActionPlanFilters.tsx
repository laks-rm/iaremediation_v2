"use client";

import { useMemo, useRef, useState } from "react";

import { AUDIT_TYPE_LABELS, STATUS_LABELS } from "../../lib/constants";
import {
  type ActionPlanFilterChip,
  type ActionPlanFilterFieldId,
  type ActionPlanStatusValue,
  type AuditTypeValue,
  type CreatedViaValue,
  type PriorityValue,
  isValidDateRangeOrder,
} from "../../lib/action-plan-filters";
import ColumnFilterPopover from "../dashboard/ColumnFilterPopover";

const STATUS_ORDER: ActionPlanStatusValue[] = [
  "NotStarted",
  "InProgress",
  "PendingValidation",
  "RiskAccepted",
  "Dropped",
  "Closed",
];

const PRIORITY_ORDER: PriorityValue[] = ["High", "Moderate", "Low"];

const AUDIT_TYPE_ORDER: AuditTypeValue[] = [
  "Operations",
  "RegulatoryOperations",
  "IT",
  "RegulatoryIT",
  "External",
];

const CREATED_VIA_ORDER: CreatedViaValue[] = ["Manual", "AIIngestion", "Migration", "Standalone"];

const CREATED_VIA_LABELS: Record<CreatedViaValue, string> = {
  Manual: "Manual",
  AIIngestion: "AI Ingest",
  Migration: "Historical import",
  Standalone: "Wizard",
};

const FIELD_LABEL: Record<ActionPlanFilterFieldId, string> = {
  status: "Status",
  priority: "Priority",
  created_via: "Created via",
  owner_id: "Owner",
  follow_up_auditor_id: "Follow-up Auditor",
  line_manager_id: "Line Manager",
  audit_id: "Audit",
  audit_type: "Audit Type",
  entity: "Entity",
  department: "Department",
  created_at: "Created date",
  original_target_date: "Original target date",
  current_target_date: "Current target date",
  closed_at: "Closure date",
};

const FIELD_GROUPS: { label: string; fields: ActionPlanFilterFieldId[] }[] = [
  { label: "Status & Priority", fields: ["status", "priority"] },
  { label: "People", fields: ["owner_id", "follow_up_auditor_id", "line_manager_id"] },
  { label: "Audit", fields: ["audit_id", "audit_type", "entity"] },
  {
    label: "Dates",
    fields: ["created_at", "original_target_date", "current_target_date", "closed_at"],
  },
  { label: "Other", fields: ["created_via", "department"] },
];

export type ActionPlanFiltersOptionMaps = {
  audits: { id: string; name: string }[];
  users: { id: string; name: string; email?: string | null }[];
  entityOptions: { code: string; label: string }[];
  departmentOptions: string[];
};

type ActionPlanFiltersProps = {
  chips: ActionPlanFilterChip[];
  onChange: (chips: ActionPlanFilterChip[]) => void;
  options: ActionPlanFiltersOptionMaps;
};

function chipValueText(
  chip: ActionPlanFilterChip,
  userById: Map<string, { id: string; name: string; email?: string | null }>,
  auditById: Map<string, string>,
): string {
  switch (chip.field) {
    case "status":
      return STATUS_LABELS[chip.value];
    case "priority":
      return chip.value;
    case "created_via":
      return CREATED_VIA_LABELS[chip.value];
    case "owner_id":
    case "follow_up_auditor_id":
    case "line_manager_id":
      return userById.get(chip.value)?.name ?? chip.value;
    case "audit_id":
      return auditById.get(chip.value) ?? chip.value;
    case "audit_type":
      return AUDIT_TYPE_LABELS[chip.value];
    case "entity":
      return chip.values.join(", ");
    case "department":
      return chip.value;
    case "created_at":
    case "original_target_date":
    case "current_target_date":
    case "closed_at": {
      const from = chip.from ?? "";
      const to = chip.to ?? "";
      if (from && to) {
        return `${from} to ${to}`;
      }

      if (from) {
        return `from ${from}`;
      }

      return to ? `until ${to}` : "";
    }
    default:
      return "";
  }
}

export default function ActionPlanFilters({ chips, onChange, options }: ActionPlanFiltersProps) {
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [selectedField, setSelectedField] = useState<ActionPlanFilterFieldId | "">("");
  const [enumValue, setEnumValue] = useState("");
  const [userId, setUserId] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [auditId, setAuditId] = useState("");
  const [auditQuery, setAuditQuery] = useState("");
  const [entityDraft, setEntityDraft] = useState<string[]>([]);
  const [entityQuery, setEntityQuery] = useState("");
  const [departmentChoice, setDepartmentChoice] = useState("");
  const [departmentQuery, setDepartmentQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [applyError, setApplyError] = useState<string | null>(null);

  const userById = useMemo(() => new Map(options.users.map((u) => [u.id, u])), [options.users]);
  const auditById = useMemo(() => new Map(options.audits.map((a) => [a.id, a.name])), [options.audits]);

  const sortedAudits = useMemo(
    () => [...options.audits].sort((a, b) => a.name.localeCompare(b.name)),
    [options.audits],
  );

  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    if (!q) {
      return options.users;
    }

    return options.users.filter((u) => {
      const name = (u.name ?? "").toLowerCase();
      const email = (u.email ?? "").toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [options.users, userQuery]);

  const filteredAudits = useMemo(() => {
    const q = auditQuery.trim().toLowerCase();
    if (!q) {
      return sortedAudits;
    }

    return sortedAudits.filter((a) => a.name.toLowerCase().includes(q));
  }, [sortedAudits, auditQuery]);

  const filteredEntities = useMemo(() => {
    const q = entityQuery.trim().toLowerCase();
    if (!q) {
      return options.entityOptions;
    }

    return options.entityOptions.filter(
      (row) => row.code.toLowerCase().includes(q) || row.label.toLowerCase().includes(q),
    );
  }, [options.entityOptions, entityQuery]);

  const filteredDepartments = useMemo(() => {
    const q = departmentQuery.trim().toLowerCase();
    if (!q) {
      return options.departmentOptions;
    }

    return options.departmentOptions.filter((d) => d.toLowerCase().includes(q));
  }, [options.departmentOptions, departmentQuery]);

  function resetDraft() {
    setSelectedField("");
    setEnumValue("");
    setUserId("");
    setUserQuery("");
    setAuditId("");
    setAuditQuery("");
    setEntityDraft([]);
    setEntityQuery("");
    setDepartmentChoice("");
    setDepartmentQuery("");
    setDateFrom("");
    setDateTo("");
    setApplyError(null);
  }

  function handleOpenPopover() {
    resetDraft();
    setPopoverOpen(true);
  }

  function handleApply() {
    setApplyError(null);

    if (!selectedField) {
      setApplyError("Choose a field to filter by.");
      return;
    }

    const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `chip-${Date.now()}`;

    if (
      selectedField === "created_at" ||
      selectedField === "original_target_date" ||
      selectedField === "current_target_date" ||
      selectedField === "closed_at"
    ) {
      const from = dateFrom.trim() || null;
      const to = dateTo.trim() || null;

      if (!from && !to) {
        setApplyError("Enter at least one date (from or to).");
        return;
      }

      if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
        setApplyError("From date is invalid.");
        return;
      }

      if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        setApplyError("To date is invalid.");
        return;
      }

      if (!isValidDateRangeOrder(from, to)) {
        setApplyError("From date must be on or before to date.");
        return;
      }

      const chip: ActionPlanFilterChip = {
        id,
        field: selectedField,
        from,
        to,
      };
      onChange([...chips, chip]);
      setPopoverOpen(false);
      resetDraft();
      return;
    }

    if (selectedField === "entity") {
      if (entityDraft.length === 0) {
        setApplyError("Select at least one entity.");
        return;
      }

      onChange([...chips, { id, field: "entity", values: [...entityDraft].sort() }]);
      setPopoverOpen(false);
      resetDraft();
      return;
    }

    if (selectedField === "department") {
      const dep = departmentChoice.trim();
      if (!dep) {
        setApplyError("Select or enter a department.");
        return;
      }

      onChange([...chips, { id, field: "department", value: dep.slice(0, 120) }]);
      setPopoverOpen(false);
      resetDraft();
      return;
    }

    if (selectedField === "owner_id" || selectedField === "follow_up_auditor_id" || selectedField === "line_manager_id") {
      if (!userId) {
        setApplyError("Select a user.");
        return;
      }

      onChange([...chips, { id, field: selectedField, value: userId }]);
      setPopoverOpen(false);
      resetDraft();
      return;
    }

    if (selectedField === "audit_id") {
      if (!auditId) {
        setApplyError("Select an audit.");
        return;
      }

      onChange([...chips, { id, field: "audit_id", value: auditId }]);
      setPopoverOpen(false);
      resetDraft();
      return;
    }

    if (!enumValue) {
      setApplyError("Select a value.");
      return;
    }

    if (selectedField === "status") {
      onChange([...chips, { id, field: "status", value: enumValue as ActionPlanStatusValue }]);
    } else if (selectedField === "priority") {
      onChange([...chips, { id, field: "priority", value: enumValue as PriorityValue }]);
    } else if (selectedField === "created_via") {
      onChange([...chips, { id, field: "created_via", value: enumValue as CreatedViaValue }]);
    } else if (selectedField === "audit_type") {
      onChange([...chips, { id, field: "audit_type", value: enumValue as AuditTypeValue }]);
    }

    setPopoverOpen(false);
    resetDraft();
  }

  function removeChip(id: string) {
    onChange(chips.filter((c) => c.id !== id));
  }

  function clearAll() {
    onChange([]);
  }

  function toggleEntityCode(code: string) {
    setEntityDraft((current) =>
      current.includes(code) ? current.filter((c) => c !== code) : [...current, code],
    );
  }

  return (
    <div className="action-plan-filters" style={{ marginTop: 10, marginBottom: 8 }}>
      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button
          className="button"
          onClick={handleOpenPopover}
          ref={addButtonRef}
          type="button"
        >
          + Add filter ▾
        </button>

        {chips.length > 0 ? (
          <button className="dashboard-filter-clear" onClick={clearAll} type="button">
            Clear all filters
          </button>
        ) : null}
      </div>

      {chips.length > 0 ? (
        <div
          className="dashboard-active-filters__chips"
          style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}
        >
          {chips.map((chip) => {
            const valueText = chipValueText(chip, userById, auditById);
            return (
              <button
                aria-label={`Remove filter ${FIELD_LABEL[chip.field]}: ${valueText}`}
                className="dashboard-filter-chip"
                key={chip.id}
                onClick={() => removeChip(chip.id)}
                type="button"
              >
                <strong>{FIELD_LABEL[chip.field]}:</strong> {valueText}
                <em aria-hidden="true">×</em>
              </button>
            );
          })}
        </div>
      ) : null}

      <ColumnFilterPopover
        anchorRef={addButtonRef}
        isOpen={popoverOpen}
        onClose={() => {
          setPopoverOpen(false);
          resetDraft();
        }}
      >
        <div className="column-filter-popover__body" style={{ minWidth: 280 }}>
          <label className="column-filter-option" style={{ display: "block", marginBottom: 8 }}>
            <span style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Filter by…</span>
            <select
              onChange={(event) => {
                const value = event.target.value as ActionPlanFilterFieldId | "";
                setSelectedField(value);
                setEnumValue("");
                setUserId("");
                setAuditId("");
                setEntityDraft([]);
                setDepartmentChoice("");
                setDateFrom("");
                setDateTo("");
                setApplyError(null);
              }}
              value={selectedField}
            >
              <option value="">Choose field…</option>
              {FIELD_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.fields.map((field) => (
                    <option key={field} value={field}>
                      {FIELD_LABEL[field]}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          {selectedField === "status" ? (
            <select onChange={(event) => setEnumValue(event.target.value)} value={enumValue}>
              <option value="">Choose status…</option>
              {STATUS_ORDER.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          ) : null}

          {selectedField === "priority" ? (
            <select onChange={(event) => setEnumValue(event.target.value)} value={enumValue}>
              <option value="">Choose priority…</option>
              {PRIORITY_ORDER.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          ) : null}

          {selectedField === "created_via" ? (
            <select onChange={(event) => setEnumValue(event.target.value)} value={enumValue}>
              <option value="">Choose source…</option>
              {CREATED_VIA_ORDER.map((cv) => (
                <option key={cv} value={cv}>
                  {CREATED_VIA_LABELS[cv]}
                </option>
              ))}
            </select>
          ) : null}

          {selectedField === "audit_type" ? (
            <select onChange={(event) => setEnumValue(event.target.value)} value={enumValue}>
              <option value="">Choose audit type…</option>
              {AUDIT_TYPE_ORDER.map((at) => (
                <option key={at} value={at}>
                  {AUDIT_TYPE_LABELS[at]}
                </option>
              ))}
            </select>
          ) : null}

          {selectedField === "owner_id" ||
          selectedField === "follow_up_auditor_id" ||
          selectedField === "line_manager_id" ? (
            <div>
              <input
                aria-label="Search users"
                className="column-filter-search"
                onChange={(event) => setUserQuery(event.target.value)}
                placeholder="Search by name or email…"
                type="search"
                value={userQuery}
              />
              <div style={{ maxHeight: 200, overflow: "auto" }}>
                {filteredUsers.slice(0, 80).map((u) => (
                  <label className="column-filter-option" key={u.id}>
                    <input
                      checked={userId === u.id}
                      name="filter-user"
                      onChange={() => setUserId(u.id)}
                      type="radio"
                    />
                    <span>{u.name}</span>
                    {u.email ? <em style={{ fontSize: 11 }}> {u.email}</em> : null}
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {selectedField === "audit_id" ? (
            <div>
              <input
                aria-label="Search audits"
                className="column-filter-search"
                onChange={(event) => setAuditQuery(event.target.value)}
                placeholder="Search audits…"
                type="search"
                value={auditQuery}
              />
              <div style={{ maxHeight: 200, overflow: "auto" }}>
                {filteredAudits.map((a) => (
                  <label className="column-filter-option" key={a.id}>
                    <input
                      checked={auditId === a.id}
                      name="filter-audit"
                      onChange={() => setAuditId(a.id)}
                      type="radio"
                    />
                    <span>{a.name}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {selectedField === "entity" ? (
            <div>
              <input
                aria-label="Search entities"
                className="column-filter-search"
                onChange={(event) => setEntityQuery(event.target.value)}
                placeholder="Search entity codes…"
                type="search"
                value={entityQuery}
              />
              <div style={{ maxHeight: 200, overflow: "auto" }}>
                {filteredEntities.map((row) => (
                  <label className="column-filter-option" key={row.code}>
                    <input
                      checked={entityDraft.includes(row.code)}
                      onChange={() => toggleEntityCode(row.code)}
                      type="checkbox"
                    />
                    <span>
                      {row.code}
                      {row.label !== row.code ? ` — ${row.label}` : ""}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {selectedField === "department" ? (
            <div>
              <input
                aria-label="Search departments"
                className="column-filter-search"
                onChange={(event) => setDepartmentQuery(event.target.value)}
                placeholder="Search departments…"
                type="search"
                value={departmentQuery}
              />
              <div style={{ maxHeight: 200, overflow: "auto" }}>
                {filteredDepartments.map((d) => (
                  <label className="column-filter-option" key={d}>
                    <input
                      checked={departmentChoice === d}
                      name="filter-department"
                      onChange={() => setDepartmentChoice(d)}
                      type="radio"
                    />
                    <span>{d}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {selectedField === "created_at" ||
          selectedField === "original_target_date" ||
          selectedField === "current_target_date" ||
          selectedField === "closed_at" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label>
                <span style={{ display: "block", fontSize: 12 }}>From</span>
                <input onChange={(event) => setDateFrom(event.target.value)} type="date" value={dateFrom} />
              </label>
              <label>
                <span style={{ display: "block", fontSize: 12 }}>To</span>
                <input onChange={(event) => setDateTo(event.target.value)} type="date" value={dateTo} />
              </label>
            </div>
          ) : null}

          {applyError ? (
            <p role="alert" style={{ color: "var(--danger, #b91c1c)", fontSize: 13, marginTop: 8 }}>
              {applyError}
            </p>
          ) : null}
        </div>
        <div className="column-filter-popover__footer">
          <button
            className="column-filter-clear"
            onClick={() => {
              setPopoverOpen(false);
              resetDraft();
            }}
            type="button"
          >
            Cancel
          </button>
          <button className="button button--primary" onClick={handleApply} type="button">
            Apply
          </button>
        </div>
      </ColumnFilterPopover>
    </div>
  );
}
