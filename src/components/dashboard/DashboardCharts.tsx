"use client";

import type { ActionPlanStatus, AuditType, Priority } from "@prisma/client";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import type { Filters } from "../action-plans/ActionPlanTable";
import {
  AUDIT_TYPE_COLORS,
  AUDIT_TYPE_LABELS,
  PRIORITY_COLORS,
  STATUS_COLORS,
  STATUS_LABELS,
} from "../../lib/constants";

type DashboardKpis = {
  total_open: number;
  overdue: number;
  closed_this_quarter: number;
  pending_validation: number;
};

type OpenByPriority = {
  priority: Priority;
  openCount: number;
  overdueCount: number;
};

type OpenByEntity = {
  code: string;
  full_name: string;
  openCount: number;
  overdueCount: number;
};

type OpenByAuditType = {
  auditType: AuditType;
  openCount: number;
};

type OpenByDepartment = {
  department: string;
  openCount: number;
  overdueCount: number;
};

export type DashboardChartsData = {
  kpis: DashboardKpis;
  statusCounts: Record<ActionPlanStatus, number>;
  openByPriority: OpenByPriority[];
  openByEntity: OpenByEntity[];
  openByAuditType: OpenByAuditType[];
  openByDepartment: OpenByDepartment[];
};

type Tone = "default" | "blue" | "red" | "green" | "amber";

const STATUS_STACK_ORDER: ActionPlanStatus[] = [
  "Closed",
  "NotStarted",
  "InProgress",
  "PendingValidation",
  "RiskAccepted",
  "Dropped",
];

const PRIORITY_ORDER: Priority[] = ["High", "Moderate", "Low"];
const AUDIT_TYPE_ORDER: AuditType[] = [
  "IT",
  "RegulatoryIT",
  "Operations",
  "RegulatoryOperations",
  "External",
];

const TONE_COLORS: Record<Tone, string> = {
  default: "var(--text)",
  blue: "var(--insight-forward-text)",
  red: "var(--red)",
  green: "var(--insight-mitigated-text)",
  amber: "var(--insight-quality-text)",
};

function percent(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return 0;
  }

  return Math.round((numerator / denominator) * 100);
}

function scaledWidth(count: number, maxCount: number) {
  if (maxCount <= 0 || count <= 0) {
    return 0;
  }

  return (count / maxCount) * 100;
}

function splitFilterValues(value: string | null) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isActiveValue(activeValues: string[], value: string) {
  return activeValues.length === 0 || activeValues.includes(value);
}

function getChartItemClass(activeValues: string[], value: string) {
  return isActiveValue(activeValues, value) ? "dashboard-chart-clickable" : "dashboard-chart-clickable dashboard-chart-clickable--dimmed";
}

function getToggledFilterValue(activeValues: string[], value: string) {
  return activeValues.length === 1 && activeValues[0] === value ? "" : value;
}

function getPriorityLabel(priority: Priority) {
  return priority === "High" ? "High-priority" : `${priority}-priority`;
}

function KpiCard({
  label,
  value,
  subtitle,
  accent,
  valueTone = "default",
  subtitleTone = "default",
}: {
  label: string;
  value: number;
  subtitle: string;
  accent: Tone;
  valueTone?: Tone;
  subtitleTone?: Tone;
}) {
  const accentColor = TONE_COLORS[accent];

  return (
    <article
      className="dashboard-kpi"
      style={{
        borderBottomLeftRadius: 0,
        borderLeft: `3px solid ${accentColor}`,
        borderTopLeftRadius: 0,
      }}
    >
      <strong style={{ color: TONE_COLORS[valueTone] }}>{value}</strong>
      <span>{label}</span>
      <small style={{ color: TONE_COLORS[subtitleTone] }}>{subtitle}</small>
    </article>
  );
}

function KpiStrip({ kpis }: { kpis: DashboardKpis }) {
  const overdueRate = percent(kpis.overdue, kpis.total_open);
  const closureRate = percent(kpis.closed_this_quarter, kpis.closed_this_quarter + kpis.total_open);
  const pendingSubtitle =
    kpis.pending_validation === 0
      ? "nothing awaiting review"
      : `${kpis.pending_validation} awaiting review`;

  return (
    <section className="dashboard-kpis">
      <KpiCard
        accent="blue"
        label="Total Open"
        subtitle="across all entities"
        value={kpis.total_open}
      />
      <KpiCard
        accent="red"
        label="Overdue"
        subtitle={`${overdueRate}% of open items`}
        subtitleTone="red"
        value={kpis.overdue}
        valueTone="red"
      />
      <KpiCard
        accent="green"
        label="Closed This Quarter"
        subtitle={`${closureRate}% closure rate`}
        subtitleTone="green"
        value={kpis.closed_this_quarter}
        valueTone="green"
      />
      <KpiCard
        accent="amber"
        label="Pending Validation"
        subtitle={pendingSubtitle}
        subtitleTone={kpis.pending_validation === 0 ? "default" : "amber"}
        value={kpis.pending_validation}
      />
    </section>
  );
}

function HorizontalBarRow({
  label,
  labelTitle,
  count,
  maxCount,
  colorClass,
  textColorClass,
  rightContent,
  monospaceLabel = false,
  onClick,
  activeValues = [],
  value,
}: {
  label: string;
  labelTitle?: string;
  count: number;
  maxCount: number;
  colorClass: string;
  textColorClass?: string;
  rightContent?: ReactNode;
  monospaceLabel?: boolean;
  onClick?: () => void;
  activeValues?: string[];
  value?: string;
}) {
  const width = scaledWidth(count, maxCount);
  const labelClassName = monospaceLabel ? "dashboard-chart-row__label dashboard-chart-row__label--mono" : "dashboard-chart-row__label";
  const rowClassName = onClick && value ? getChartItemClass(activeValues, value) : "";

  return (
    <div className="dashboard-chart-row">
      {onClick && value ? (
        <button
          className={`dashboard-chart-row__drilldown ${rowClassName}`}
          onClick={onClick}
          title={labelTitle}
          type="button"
        >
          <span className={labelClassName}>{label}</span>
          <span className="dashboard-chart-row__track" aria-hidden="true">
            {width > 0 ? (
              <span
                className={`dashboard-chart-row__bar ${colorClass}`}
                style={{ width: `${width}%` }}
              />
            ) : null}
          </span>
        </button>
      ) : (
        <>
          <span className={labelClassName} title={labelTitle}>
            {label}
          </span>
          <span className="dashboard-chart-row__track" aria-hidden="true">
            {width > 0 ? (
              <span
                className={`dashboard-chart-row__bar ${colorClass}`}
                style={{ width: `${width}%` }}
              />
            ) : null}
          </span>
        </>
      )}
      <strong className={textColorClass}>{count}</strong>
      {rightContent ? <em>{rightContent}</em> : null}
    </div>
  );
}

function StatusStackedBar({
  kpis,
  statusCounts,
  activeValues,
  onFilter,
}: {
  kpis: DashboardKpis;
  statusCounts: Record<ActionPlanStatus, number>;
  activeValues: string[];
  onFilter: (params: Partial<Filters>) => void;
}) {
  const total = STATUS_STACK_ORDER.reduce((sum, status) => sum + (statusCounts[status] ?? 0), 0);
  const overdueRate = percent(kpis.overdue, kpis.total_open);

  return (
    <article className="dashboard-panel dashboard-chart-card dashboard-chart-card--wide">
      <h2>Status Distribution</h2>
      <div className="dashboard-status-stack" aria-label="Status distribution">
        {STATUS_STACK_ORDER.map((status) => {
          const count = statusCounts[status] ?? 0;
          const width = scaledWidth(count, total);

          if (count <= 0) {
            return null;
          }

          return (
            <button
              aria-label={`${STATUS_LABELS[status]}: ${count}`}
              className={`dashboard-status-stack__segment ${getChartItemClass(activeValues, status)}`}
              key={status}
              onClick={() => onFilter({ status: getToggledFilterValue(activeValues, status) })}
              style={{ width: `${width}%` }}
              title={`${STATUS_LABELS[status]}: ${count}`}
              type="button"
            >
              <span className={STATUS_COLORS[status].bg} />
            </button>
          );
        })}
      </div>
      <div className="dashboard-status-legend">
        {STATUS_STACK_ORDER.map((status) => (
          <button
            className={`dashboard-status-legend__item ${getChartItemClass(activeValues, status)}`}
            key={status}
            onClick={() => onFilter({ status: getToggledFilterValue(activeValues, status) })}
            type="button"
          >
            <i
              aria-hidden="true"
              className={`${STATUS_COLORS[status].bg} ${STATUS_COLORS[status].text}`}
            />
            <strong>{STATUS_LABELS[status]}</strong>
            <em>{statusCounts[status] ?? 0}</em>
          </button>
        ))}
      </div>
      <p className="dashboard-chart-note">
        {kpis.overdue} of {kpis.total_open} open items are overdue — {overdueRate}% overdue rate.
      </p>
    </article>
  );
}

function PriorityBars({
  rows,
  activeValues,
  onFilter,
}: {
  rows: OpenByPriority[];
  activeValues: string[];
  onFilter: (params: Partial<Filters>) => void;
}) {
  const rowsByPriority = new Map(rows.map((row) => [row.priority, row]));
  const orderedRows = PRIORITY_ORDER.map(
    (priority) => rowsByPriority.get(priority) ?? { priority, openCount: 0, overdueCount: 0 },
  );
  const maxOpenCount = Math.max(...orderedRows.map((row) => row.openCount), 1);
  const highestOverdueRate = orderedRows.reduce((highest, row) => {
    const rowRate = percent(row.overdueCount, row.openCount);
    const highestRate = percent(highest.overdueCount, highest.openCount);

    return rowRate > highestRate ? row : highest;
  }, orderedRows[0]);
  const insightRate = percent(highestOverdueRate.overdueCount, highestOverdueRate.openCount);

  return (
    <article className="dashboard-panel dashboard-chart-card">
      <h2>Open Items by Priority</h2>
      <div className="dashboard-chart-stack">
        {orderedRows.map((row) => (
          <div className="dashboard-priority-row" key={row.priority}>
            <HorizontalBarRow
              activeValues={activeValues}
              colorClass={PRIORITY_COLORS[row.priority].bg}
              count={row.openCount}
              label={row.priority}
              maxCount={maxOpenCount}
              onClick={() => onFilter({ priority: getToggledFilterValue(activeValues, row.priority) })}
              textColorClass={PRIORITY_COLORS[row.priority].text}
              value={row.priority}
            />
            <small className={row.overdueCount > 0 ? "dashboard-chart-overdue" : undefined}>
              {row.overdueCount} overdue
            </small>
          </div>
        ))}
      </div>
      {insightRate > 0 ? (
        <p className="dashboard-chart-note">
          {getPriorityLabel(highestOverdueRate.priority)} items carry the highest overdue rate at{" "}
          {insightRate}%.
        </p>
      ) : null}
    </article>
  );
}

function EntityBars({
  rows,
  activeValues,
  onFilter,
}: {
  rows: OpenByEntity[];
  activeValues: string[];
  onFilter: (params: Partial<Filters>) => void;
}) {
  const maxOpenCount = Math.max(...rows.map((row) => row.openCount), 1);

  return (
    <article className="dashboard-panel dashboard-chart-card dashboard-chart-card--wide">
      <h2>Open Items by Entity</h2>
      <div className="dashboard-chart-stack">
        {rows.map((row) => (
          <HorizontalBarRow
            activeValues={activeValues}
            colorClass={AUDIT_TYPE_COLORS.IT.bg}
            count={row.openCount}
            key={row.code}
            label={row.code}
            labelTitle={row.full_name}
            maxCount={maxOpenCount}
            monospaceLabel
            onClick={() => onFilter({ entity: getToggledFilterValue(activeValues, row.code) })}
            rightContent={
              row.overdueCount > 0 ? (
                <span className="dashboard-chart-overdue">{row.overdueCount}od</span>
              ) : (
                "—"
              )
            }
            value={row.code}
          />
        ))}
      </div>
      <p className="dashboard-chart-note dashboard-chart-note--muted">
        Showing top 7 by open count. Hover entity code to see full name.
      </p>
    </article>
  );
}

function AuditTypeBars({
  rows,
  activeValues,
  onFilter,
}: {
  rows: OpenByAuditType[];
  activeValues: string[];
  onFilter: (params: Partial<Filters>) => void;
}) {
  const rowsByAuditType = new Map(rows.map((row) => [row.auditType, row]));
  const orderedRows = AUDIT_TYPE_ORDER.map(
    (auditType) => rowsByAuditType.get(auditType) ?? { auditType, openCount: 0 },
  );
  const maxOpenCount = Math.max(...orderedRows.map((row) => row.openCount), 1);

  return (
    <article className="dashboard-panel dashboard-chart-card">
      <h2>Open Items by Audit Type</h2>
      <div className="dashboard-chart-stack">
        {orderedRows.map((row) => (
          <HorizontalBarRow
            activeValues={activeValues}
            colorClass={AUDIT_TYPE_COLORS[row.auditType].bg}
            count={row.openCount}
            key={row.auditType}
            label={AUDIT_TYPE_LABELS[row.auditType]}
            maxCount={maxOpenCount}
            onClick={() => onFilter({ audit_type: getToggledFilterValue(activeValues, row.auditType) })}
            textColorClass={AUDIT_TYPE_COLORS[row.auditType].text}
            value={row.auditType}
          />
        ))}
      </div>
    </article>
  );
}

function DepartmentList({
  rows,
  activeValues,
  onFilter,
}: {
  rows: OpenByDepartment[];
  activeValues: string[];
  onFilter: (params: Partial<Filters>) => void;
}) {
  return (
    <article className="dashboard-panel dashboard-chart-card">
      <h2>Top Departments</h2>
      <ol className="dashboard-department-list">
        {rows.map((row, index) => (
          <li className={getChartItemClass(activeValues, row.department)} key={row.department}>
            <button
              onClick={() => onFilter({ department: getToggledFilterValue(activeValues, row.department) })}
              type="button"
            >
            <span>{index + 1}</span>
            <strong title={row.department}>{row.department}</strong>
            <em>
              {row.openCount}
              {row.overdueCount > 0 ? (
                <small className="dashboard-chart-overdue"> {row.overdueCount}od</small>
              ) : null}
            </em>
            </button>
          </li>
        ))}
      </ol>
    </article>
  );
}

export default function DashboardCharts({
  kpis,
  onFilter,
  statusCounts,
  openByPriority,
  openByEntity,
  openByAuditType,
  openByDepartment,
}: DashboardChartsData & { onFilter: (params: Partial<Filters>) => void }) {
  const searchParams = useSearchParams();
  const activeStatusValues = splitFilterValues(searchParams.get("status"));
  const activePriorityValues = splitFilterValues(searchParams.get("priority"));
  const activeEntityValues = splitFilterValues(searchParams.get("entity"));
  const activeAuditTypeValues = splitFilterValues(searchParams.get("audit_type"));
  const activeDepartmentValues = splitFilterValues(searchParams.get("department"));

  return (
    <div className="dashboard-charts-redesign">
      <KpiStrip kpis={kpis} />
      <section className="dashboard-chart-grid dashboard-chart-grid--top">
        <StatusStackedBar
          activeValues={activeStatusValues}
          kpis={kpis}
          onFilter={onFilter}
          statusCounts={statusCounts}
        />
        <PriorityBars activeValues={activePriorityValues} onFilter={onFilter} rows={openByPriority} />
      </section>
      <section className="dashboard-chart-grid dashboard-chart-grid--bottom">
        <EntityBars activeValues={activeEntityValues} onFilter={onFilter} rows={openByEntity} />
        <div className="dashboard-chart-side-stack">
          <AuditTypeBars activeValues={activeAuditTypeValues} onFilter={onFilter} rows={openByAuditType} />
          <DepartmentList activeValues={activeDepartmentValues} onFilter={onFilter} rows={openByDepartment} />
        </div>
      </section>
    </div>
  );
}
