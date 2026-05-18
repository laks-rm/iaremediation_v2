"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import AppLayout from "../../components/AppLayout";
import { useToast } from "../../components/Toast";

// ── Types ─────────────────────────────────────────────────────────────

type ReportType =
  | "portfolio-status"
  | "entity-regulatory"
  | "audit-followup"
  | "overdue-plans"
  | "closure-report"
  | "owner-workload";

type ReportFormat = "xlsx" | "pdf";
type LoadingKey = `${ReportType}-${ReportFormat}`;

type EntityOption = { id: string; code: string; full_name: string };
type AuditOption = {
  id: string;
  name: string;
  audit_type: string;
  reference_number?: string | null;
  action_plan_count?: number;
};

type ComboboxOption = {
  id: string;
  label: string;
  sublabel?: string;
  badge?: number;
};

type Preset = "this-month" | "last-month" | "this-quarter" | "last-quarter" | "ytd" | "custom";

type PreviewStats = {
  portfolio: { open: number; overdue: number; closed: number };
  overdue: { over90: number; over30: number; under30: number };
  closure: { onTime: number; late: number; total: number };
} | null;

type RecentDownload = {
  id: string;
  title: string;
  format: ReportFormat;
  filename: string;
  downloadedAt: number; // epoch ms
};

const RECENT_DOWNLOADS_KEY = "ia-recent-reports";
const MAX_RECENT = 5;

// ── Date helpers ──────────────────────────────────────────────────────

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getPresetRange(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const today = toIsoDate(now);

  switch (preset) {
    case "this-month":
      return { from: `${y}-${String(m + 1).padStart(2, "0")}-01`, to: today };
    case "last-month": {
      const lm = m === 0 ? 11 : m - 1;
      const ly = m === 0 ? y - 1 : y;
      const lastDay = new Date(Date.UTC(ly, lm + 1, 0));
      return { from: `${ly}-${String(lm + 1).padStart(2, "0")}-01`, to: toIsoDate(lastDay) };
    }
    case "this-quarter": {
      const qs = Math.floor(m / 3) * 3;
      return { from: `${y}-${String(qs + 1).padStart(2, "0")}-01`, to: today };
    }
    case "last-quarter": {
      const qs = Math.floor(m / 3) * 3;
      const lqs = qs === 0 ? 9 : qs - 3;
      const lqy = qs === 0 ? y - 1 : y;
      const lqEnd = new Date(Date.UTC(lqy, lqs + 3, 0));
      return { from: `${lqy}-${String(lqs + 1).padStart(2, "0")}-01`, to: toIsoDate(lqEnd) };
    }
    case "ytd":
      return { from: `${y}-01-01`, to: today };
    case "custom":
      return { from: toIsoDate(new Date(Date.UTC(y, m, 1))), to: today };
  }
}

function formatRelativeTime(epochMs: number): string {
  const diff = Date.now() - epochMs;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(epochMs).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

// ── Inline SVG icons ──────────────────────────────────────────────────

function IconChartBar({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="12" width="4" height="9" />
      <rect x="10" y="7" width="4" height="14" />
      <rect x="17" y="3" width="4" height="18" />
    </svg>
  );
}

function IconAlertTriangle({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function IconBuilding({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
    </svg>
  );
}

function IconClipboardCheck({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function IconCircleCheck({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function IconUsers({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
    </svg>
  );
}

function IconFileSpreadsheet({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14,2 14,8 20,8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
      <line x1="10" y1="9" x2="10" y2="9" />
    </svg>
  );
}

function IconFileText({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14,2 14,8 20,8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10,9 9,9 8,9" />
    </svg>
  );
}

function IconInfoCircle({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="8" />
      <line x1="12" y1="12" x2="12" y2="16" />
    </svg>
  );
}

function IconDownload({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="7,10 12,15 17,10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function IconSearch({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

// ── Report definitions ────────────────────────────────────────────────

type ReportDef = {
  type: ReportType;
  title: string;
  description: string;
  helpText: string;
  iconBg: string;
  iconColor: string;
  Icon: React.ComponentType<{ size?: number }>;
  requiresEntity?: boolean;
  requiresAudit?: boolean;
  hasEntityFilter?: boolean;
  hasDepartmentFilter?: boolean;
  hasPreview?: boolean;
};

const REPORTS: ReportDef[] = [
  {
    type: "portfolio-status",
    title: "Portfolio Status Summary",
    description: "Overall portfolio health — open, closed, and overdue action plans by priority and entity.",
    helpText: "Three sheets: summary with status/priority/entity breakdowns and period activity, top 20 overdue details, and a complete list of all action plans. Ideal for monthly audit committee meetings.",
    iconBg: "#EDE9FE",
    iconColor: "#7C3AED",
    Icon: IconChartBar,
    hasPreview: true,
  },
  {
    type: "overdue-plans",
    title: "Overdue Action Plans",
    description: "All open plans past their target date, sorted by days overdue. For management escalation.",
    helpText: "Every overdue action plan with owner, department, audit name, original/current target dates, reschedule count, and days overdue. Colour-coded by severity (>90d red, 30-90d amber, <30d yellow). For management escalation discussions.",
    iconBg: "#FEF3C7",
    iconColor: "#D97706",
    Icon: IconAlertTriangle,
    hasEntityFilter: true,
    hasDepartmentFilter: true,
    hasPreview: true,
  },
  {
    type: "entity-regulatory",
    title: "Entity Regulatory Report",
    description: "Entity-specific report for regulatory submissions. Shows all action plans grouped by audit.",
    helpText: "All action plans scoped to the selected entity, grouped by audit. Status summary, period activity, finding details, owner, target dates, closure remarks, and evidence count. For MFSA, BVI FSC, and other regulator submissions.",
    iconBg: "#CCFBF1",
    iconColor: "#0D9488",
    Icon: IconBuilding,
    requiresEntity: true,
    hasEntityFilter: true,
  },
  {
    type: "audit-followup",
    title: "Audit Follow-up Report",
    description: "Progress and status for a specific audit. Action plans grouped by finding.",
    helpText: "Audit metadata, closure progress (X of Y closed), and all action plans grouped by finding. Shows status, owner, priority, target dates, reschedule count, evidence count, and closure remarks. For periodic follow-up meetings with action owners.",
    iconBg: "#DBEAFE",
    iconColor: "#2563EB",
    Icon: IconClipboardCheck,
    requiresAudit: true,
  },
  {
    type: "closure-report",
    title: "Closure Report",
    description: "Action plans closed within the period with on-time/late analysis. For quarterly performance reviews.",
    helpText: "Summary of closures (on-time vs late using 3-day buffer), broken down by entity, priority, and department. Full list of closed plans with time-to-close, days late/early, and closure remarks. For quarterly performance reviews.",
    iconBg: "#DCFCE7",
    iconColor: "#16A34A",
    Icon: IconCircleCheck,
    hasPreview: true,
  },
  {
    type: "owner-workload",
    title: "Owner Workload Report",
    description: "Open items, overdue, and upcoming due dates per owner. For resource planning.",
    helpText: "Each owner with total open plans, overdue count, high-priority items, due in next 30 days, and closure rate. Sorted by overdue count (most overloaded first). Detail sheet lists every open plan per owner. For resource planning and workload balancing.",
    iconBg: "#FFE4E6",
    iconColor: "#E45E3A",
    Icon: IconUsers,
    hasDepartmentFilter: true,
  },
];

// ── Sub-components ────────────────────────────────────────────────────

function DateRangeBar({
  from,
  to,
  preset,
  onFromChange,
  onToChange,
  onPresetChange,
}: {
  from: string;
  to: string;
  preset: Preset;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  onPresetChange: (p: Preset) => void;
}) {
  const presets: { key: Preset; label: string }[] = [
    { key: "this-month", label: "This month" },
    { key: "last-month", label: "Last month" },
    { key: "this-quarter", label: "This quarter" },
    { key: "last-quarter", label: "Last quarter" },
    { key: "ytd", label: "YTD" },
    { key: "custom", label: "Custom" },
  ];

  return (
    <div className="rp-date-bar">
      <div className="rp-date-bar__top">
        <div className="rp-date-bar__inputs">
          <label className="rp-date-bar__label">
            <span className="rp-date-bar__label-text">From</span>
            <input
              className="rp-date-bar__input"
              type="date"
              value={from}
              onChange={(e) => {
                onFromChange(e.target.value);
                onPresetChange("custom");
              }}
            />
          </label>
          <span className="rp-date-bar__sep" aria-hidden="true">→</span>
          <label className="rp-date-bar__label">
            <span className="rp-date-bar__label-text">To</span>
            <input
              className="rp-date-bar__input"
              type="date"
              value={to}
              onChange={(e) => {
                onToChange(e.target.value);
                onPresetChange("custom");
              }}
            />
          </label>
        </div>
        <div className="rp-date-bar__presets" role="group" aria-label="Date presets">
          {presets.map((p) => (
            <button
              aria-pressed={preset === p.key}
              className={`rp-preset-btn${preset === p.key ? " rp-preset-btn--active" : ""}`}
              key={p.key}
              onClick={() => {
                onPresetChange(p.key);
                if (p.key !== "custom") {
                  const range = getPresetRange(p.key);
                  onFromChange(range.from);
                  onToChange(range.to);
                }
              }}
              type="button"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <p className="rp-date-bar__hint">
        <IconInfoCircle size={11} />
        Date range applies to all reports below
      </p>
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  required,
  searchable,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  required?: boolean;
  searchable?: boolean;
}) {
  const [query, setQuery] = useState("");
  const filtered = searchable && query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <div className="rp-select">
      <label className="rp-select__label">
        {label}
        {required && <span className="rp-select__required"> *</span>}
      </label>
      {searchable ? (
        <div className="rp-select__searchable">
          <input
            className="rp-select__search"
            placeholder={`Search…`}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="rp-select__control"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            size={Math.min(filtered.length + 1, 5)}
          >
            {!required && <option value="">— select —</option>}
            {filtered.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      ) : (
        <select
          className="rp-select__control"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">— all —</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}

// ── ComboboxField — styled searchable dropdown ────────────────────────

function ComboboxField({
  label,
  value,
  onChange,
  options,
  placeholder = "Search…",
  required,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [inputText, setInputText] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep displayed text in sync with the selected option label
  useEffect(() => {
    if (!open) {
      const sel = options.find((o) => o.id === value);
      setInputText(sel?.label ?? "");
    }
  }, [value, options, open]);

  const filtered = inputText.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(inputText.trim().toLowerCase()))
    : options;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        const sel = options.find((o) => o.id === value);
        setInputText(sel?.label ?? "");
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open, options, value]);

  function handleFocus() {
    setOpen(true);
    // Select-all so the user can immediately type a new query
    inputRef.current?.select();
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInputText(e.target.value);
    setOpen(true);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      const sel = options.find((o) => o.id === value);
      setInputText(sel?.label ?? "");
      inputRef.current?.blur();
    }
  }

  function handleSelect(opt: ComboboxOption) {
    onChange(opt.id);
    setInputText(opt.label);
    setOpen(false);
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange("");
    setInputText("");
    setOpen(false);
    inputRef.current?.focus();
  }

  return (
    <div className="rp-combo" ref={containerRef}>
      <span className="rp-select__label">
        {label}
        {required && <span className="rp-select__required"> *</span>}
      </span>
      <div className={`rp-combo__control${open ? " rp-combo__control--open" : ""}`}>
        <span className="rp-combo__search-icon" aria-hidden="true">
          <IconSearch size={13} />
        </span>
        <input
          ref={inputRef}
          aria-label={label}
          aria-expanded={open}
          autoComplete="off"
          className="rp-combo__input"
          placeholder={placeholder}
          role="combobox"
          spellCheck={false}
          type="text"
          value={inputText}
          onChange={handleChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
        />
        {value && (
          <button
            aria-label="Clear selection"
            className="rp-combo__clear"
            tabIndex={-1}
            type="button"
            onClick={handleClear}
          >
            ×
          </button>
        )}
      </div>

      {open && (
        // onMouseDown preventDefault keeps the input focused when clicking list items
        <div
          className="rp-combo__dropdown"
          role="listbox"
          onMouseDown={(e) => e.preventDefault()}
        >
          {filtered.length === 0 ? (
            <div className="rp-combo__empty">No matches found</div>
          ) : (
            filtered.map((opt) => (
              <button
                aria-selected={opt.id === value}
                className={`rp-combo__option${opt.id === value ? " rp-combo__option--selected" : ""}`}
                key={opt.id}
                role="option"
                type="button"
                onClick={() => handleSelect(opt)}
              >
                <span className="rp-combo__option-body">
                  <span className="rp-combo__option-label">{opt.label}</span>
                  {opt.sublabel && (
                    <span className="rp-combo__option-sub">{opt.sublabel}</span>
                  )}
                </span>
                {opt.badge !== undefined && (
                  <span className="rp-combo__option-badge">{opt.badge}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function DownloadButton({
  format,
  loading,
  disabled,
  onClick,
}: {
  format: ReportFormat;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const isXlsx = format === "xlsx";
  return (
    <button
      aria-label={`Download ${isXlsx ? "Excel spreadsheet" : "PDF document"}`}
      className={`rp-dl-btn rp-dl-btn--${format}${disabled ? " rp-dl-btn--disabled" : ""}`}
      disabled={disabled || loading}
      onClick={onClick}
      type="button"
    >
      {loading
        ? <span className="rp-dl-btn__spinner" aria-hidden="true" />
        : isXlsx ? <IconFileSpreadsheet /> : <IconFileText />}
      {isXlsx ? "XLSX" : "PDF"}
    </button>
  );
}

type StatPillProps = { value: number | undefined; label: string; tone?: "red" | "amber" | "green" | "muted" };

function StatPill({ value, label, tone = "muted" }: StatPillProps) {
  return (
    <div className={`rp-stat rp-stat--${tone}`}>
      <span className="rp-stat__num">{value ?? "—"}</span>
      <span className="rp-stat__lbl">{label}</span>
    </div>
  );
}

// ── ReportRow ─────────────────────────────────────────────────────────

function ReportRow({
  report,
  from,
  to,
  entityOptions,
  auditOptions,
  deptOptions,
  previewStats,
  loadingKeys,
  onDownload,
}: {
  report: ReportDef;
  from: string;
  to: string;
  entityOptions: ComboboxOption[];
  auditOptions: ComboboxOption[];
  deptOptions: { value: string; label: string }[];
  previewStats: PreviewStats;
  loadingKeys: Partial<Record<LoadingKey, boolean>>;
  onDownload: (type: ReportType, fmt: ReportFormat, extra?: Record<string, string>) => void;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [entityVal, setEntityVal] = useState("");
  const [auditVal, setAuditVal] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [deptFilter, setDeptFilter] = useState("");

  const isLoading = (fmt: ReportFormat) => loadingKeys[`${report.type}-${fmt}`] === true;

  const canDownload = () => {
    if (report.requiresEntity && !entityVal) return false;
    if (report.requiresAudit && !auditVal) return false;
    return true;
  };

  const extraParams = (): Record<string, string> => {
    const p: Record<string, string> = {};
    if (entityVal) p.entity = entityVal;
    if (auditVal) p.audit = auditVal;
    if (entityFilter) p.entity = entityFilter;
    if (deptFilter) p.department = deptFilter;
    return p;
  };

  const { Icon, iconBg, iconColor } = report;

  // Preview stats for applicable reports
  let previewContent: React.ReactNode = null;
  if (report.hasPreview && previewStats) {
    if (report.type === "portfolio-status") {
      previewContent = (
        <div className="rp-preview">
          <StatPill value={previewStats.portfolio.open} label="Open" tone="muted" />
          <StatPill value={previewStats.portfolio.overdue} label="Overdue" tone="red" />
          <StatPill value={previewStats.portfolio.closed} label="Closed" tone="green" />
        </div>
      );
    } else if (report.type === "overdue-plans") {
      previewContent = (
        <div className="rp-preview">
          <StatPill value={previewStats.overdue.over90} label=">90d" tone="red" />
          <StatPill value={previewStats.overdue.over30} label="30–90d" tone="amber" />
          <StatPill value={previewStats.overdue.under30} label="<30d" tone="muted" />
        </div>
      );
    } else if (report.type === "closure-report") {
      previewContent = (
        <div className="rp-preview">
          <StatPill value={previewStats.closure.onTime} label="On time" tone="green" />
          <StatPill value={previewStats.closure.late} label="Late" tone="amber" />
          <StatPill value={previewStats.closure.total} label="Total" tone="muted" />
        </div>
      );
    }
  }

  return (
    <div className="rp-row">
      <div className="rp-row__layout">
        {/* Icon square */}
        <div className="rp-row__icon" style={{ background: iconBg, color: iconColor }}>
          <Icon size={18} />
        </div>

        {/* Body */}
        <div className="rp-row__body">
          <h3 className="rp-row__title">{report.title}</h3>
          <p className="rp-row__desc">{report.description}</p>

          {/* Help toggle */}
          <button
            aria-expanded={helpOpen}
            className="rp-help-toggle"
            onClick={() => setHelpOpen((o) => !o)}
            type="button"
          >
            <span className={`rp-help-toggle__chevron${helpOpen ? " rp-help-toggle__chevron--open" : ""}`}>▶</span>
            What&#8217;s in this report?
          </button>

          {helpOpen && (
            <div className="rp-help-panel">
              {report.helpText}
            </div>
          )}

          {/* Parameters */}
          <div className="rp-row__params">
            {report.requiresEntity && (
              <ComboboxField
                label="Entity"
                value={entityVal}
                onChange={setEntityVal}
                options={entityOptions}
                placeholder="Search entities…"
                required
              />
            )}
            {report.requiresAudit && (
              <ComboboxField
                label="Audit"
                value={auditVal}
                onChange={setAuditVal}
                options={auditOptions}
                placeholder="Search audits…"
                required
              />
            )}
            {report.hasEntityFilter && !report.requiresEntity && (
              <SelectField
                label="Entity (optional)"
                value={entityFilter}
                onChange={setEntityFilter}
                options={entityOptions.map((o) => ({ value: o.id, label: o.label }))}
              />
            )}
            {report.hasDepartmentFilter && (
              <SelectField
                label="Department (optional)"
                value={deptFilter}
                onChange={setDeptFilter}
                options={deptOptions}
              />
            )}
          </div>

          {(report.requiresEntity && !entityVal) && (
            <p className="rp-row__hint">⚑ Select an entity to enable download</p>
          )}
          {(report.requiresAudit && !auditVal) && (
            <p className="rp-row__hint">⚑ Select an audit to enable download</p>
          )}
        </div>

        {/* Preview stats */}
        {previewContent}

        {/* Action buttons */}
        <div className="rp-row__actions">
          <DownloadButton
            format="xlsx"
            loading={isLoading("xlsx")}
            disabled={!canDownload()}
            onClick={() => onDownload(report.type, "xlsx", extraParams())}
          />
          <DownloadButton
            format="pdf"
            loading={isLoading("pdf")}
            disabled={!canDownload()}
            onClick={() => onDownload(report.type, "pdf", extraParams())}
          />
        </div>
      </div>
    </div>
  );
}

// ── Recent downloads ──────────────────────────────────────────────────

function RecentDownloads({ items }: { items: RecentDownload[] }) {
  if (items.length === 0) return null;

  return (
    <div className="rp-recent">
      <h2 className="rp-recent__title">
        <IconDownload size={13} />
        Recent downloads
      </h2>
      <ul className="rp-recent__list">
        {items.map((item) => (
          <li className="rp-recent__item" key={item.id}>
            <span className={`rp-recent__badge rp-recent__badge--${item.format}`}>
              {item.format.toUpperCase()}
            </span>
            <span className="rp-recent__name">{item.title}</span>
            <span className="rp-recent__file">{item.filename}</span>
            <span className="rp-recent__time">{formatRelativeTime(item.downloadedAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────

export default function ReportsPage() {
  const toast = useToast();

  const initialRange = getPresetRange("this-month");
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [preset, setPreset] = useState<Preset>("this-month");

  const [entities, setEntities] = useState<EntityOption[]>([]);
  const [audits, setAudits] = useState<AuditOption[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);

  const [previewStats, setPreviewStats] = useState<PreviewStats>(null);
  const [loadingKeys, setLoadingKeys] = useState<Partial<Record<LoadingKey, boolean>>>({});
  const [recentDownloads, setRecentDownloads] = useState<RecentDownload[]>([]);

  const statsAbortRef = useRef<AbortController | null>(null);

  // Load dropdown data on mount
  useEffect(() => {
    async function loadMeta() {
      try {
        const [entRes, audRes, metaRes] = await Promise.all([
          fetch("/api/v1/entities"),
          fetch("/api/v1/audits"),
          fetch("/api/v1/reports/meta"),
        ]);
        if (entRes.ok) {
          const body = (await entRes.json()) as { entities: EntityOption[] };
          setEntities(body.entities);
        }
        if (audRes.ok) {
          const body = (await audRes.json()) as { audits: AuditOption[] };
          setAudits(body.audits);
        }
        if (metaRes.ok) {
          const body = (await metaRes.json()) as { departments: string[] };
          setDepartments(body.departments);
        }
      } catch {
        // non-critical
      }
    }
    loadMeta();

    // Load recent downloads from localStorage
    try {
      const raw = window.localStorage.getItem(RECENT_DOWNLOADS_KEY);
      if (raw) setRecentDownloads(JSON.parse(raw) as RecentDownload[]);
    } catch {
      // ignore
    }
  }, []);

  // Live preview stats — debounced on date change
  useEffect(() => {
    if (statsAbortRef.current) {
      statsAbortRef.current.abort();
    }
    const ctrl = new AbortController();
    statsAbortRef.current = ctrl;

    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ from, to });
        const res = await fetch(`/api/v1/reports/preview-stats?${params.toString()}`, {
          signal: ctrl.signal,
        });
        if (res.ok) {
          const body = (await res.json()) as PreviewStats;
          setPreviewStats(body);
        }
      } catch {
        // ignore (including abort)
      }
    }, 350);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [from, to]);

  const addRecentDownload = useCallback((type: ReportType, format: ReportFormat, filename: string) => {
    const reportDef = REPORTS.find((r) => r.type === type);
    if (!reportDef) return;

    const newItem: RecentDownload = {
      id: `${type}-${format}-${Date.now()}`,
      title: reportDef.title,
      format,
      filename,
      downloadedAt: Date.now(),
    };

    setRecentDownloads((prev) => {
      const updated = [newItem, ...prev].slice(0, MAX_RECENT);
      try {
        window.localStorage.setItem(RECENT_DOWNLOADS_KEY, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  }, []);

  const download = useCallback(
    async (type: ReportType, format: ReportFormat, extraParams: Record<string, string> = {}) => {
      const key: LoadingKey = `${type}-${format}`;
      setLoadingKeys((prev) => ({ ...prev, [key]: true }));

      try {
        const params = new URLSearchParams({ from, to, format, ...extraParams });
        const res = await fetch(`/api/v1/reports/${type}?${params.toString()}`);

        if (!res.ok) {
          const text = await res.text();
          let msg = "Report generation failed";
          try {
            const json = JSON.parse(text) as { error?: string };
            if (json.error) msg = json.error;
          } catch {
            // ignore
          }
          toast.error(msg);
          return;
        }

        const blob = await res.blob();
        const contentDisposition = res.headers.get("Content-Disposition") ?? "";
        const filenameMatch = contentDisposition.match(/filename="([^"]+)"/);
        const filename = filenameMatch?.[1] ?? `report.${format}`;

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        addRecentDownload(type, format, filename);
      } catch {
        toast.error("Download failed. Please try again.");
      } finally {
        setLoadingKeys((prev) => ({ ...prev, [key]: false }));
      }
    },
    [from, to, toast, addRecentDownload],
  );

  const entityOptions: ComboboxOption[] = entities.map((e) => ({
    id: e.code,
    label: `${e.code} — ${e.full_name}`,
  }));
  const auditOptions: ComboboxOption[] = audits.map((a) => ({
    id: a.id,
    label: a.name,
    sublabel: a.reference_number ?? undefined,
    badge: a.action_plan_count,
  }));
  const deptOptions = departments.map((d) => ({ value: d, label: d }));

  return (
    <AppLayout>
      <div className="reports-page">
        <div className="rp-header">
          <h1 className="rp-header__title">Reports</h1>
          <p className="rp-header__sub">Generate and download audit reports.</p>
        </div>

        <DateRangeBar
          from={from}
          to={to}
          preset={preset}
          onFromChange={setFrom}
          onToChange={setTo}
          onPresetChange={setPreset}
        />

        {/* Report list */}
        <div className="rp-list">
          {REPORTS.map((report, idx) => (
            <ReportRow
              auditOptions={auditOptions}
              deptOptions={deptOptions}
              entityOptions={entityOptions}
              from={from}
              key={report.type}
              loadingKeys={loadingKeys}
              onDownload={download}
              previewStats={previewStats}
              report={report}
              to={to}
            />
          ))}
        </div>

        <RecentDownloads items={recentDownloads} />
      </div>
    </AppLayout>
  );
}
