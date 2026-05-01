"use client";

import { getSession } from "next-auth/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import AppLayout from "../../components/AppLayout";
import type { Filters } from "../../components/action-plans/ActionPlanTable";
import DashboardCharts, { type DashboardChartsData } from "../../components/dashboard/DashboardCharts";
import { useToast } from "../../components/Toast";
import { CLOSURE_RATE_THRESHOLDS } from "../../lib/kpi/closure";

type DashboardData = DashboardChartsData;
type DashboardTab = "overview" | "closure";
type ClosureDimension = "audit_type" | "audit_name" | "follow_up_auditor" | "department";
type QuickPick = "week" | "month" | "quarter" | "year" | "today";

type DashboardUser = {
  id: string;
  name?: string | null;
  role?: "AuditTeam" | "Viewer" | "Auditee" | "Pending";
  is_admin?: boolean;
};

type ClosurePeriodState =
  | { type: "as_on"; date: string }
  | { type: "range"; from: string; to: string };

type ClosureKpiResult = {
  due: number;
  closed: number;
  rate: number | null;
};

type ClosureKpiRow = {
  dimension: string;
  due: number;
  closed: number;
  rate: number | null;
  actionPlanIds: string[];
  closedIds: string[];
};

type ClosureKpiResponse = {
  period: unknown;
  overall: ClosureKpiResult;
  byAuditType: ClosureKpiRow[];
  byAuditName: ClosureKpiRow[];
  byFollowUpAuditor: ClosureKpiRow[];
  byDepartment: ClosureKpiRow[];
};

const EMPTY_DRILLDOWN_ID = "00000000-0000-0000-0000-000000000000";

const QUICK_PICKS: { id: QuickPick; label: string }[] = [
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "quarter", label: "This quarter" },
  { id: "year", label: "This year" },
  { id: "today", label: "As on today" },
];

const emptyData: DashboardData = {
  kpis: {
    total_open: 0,
    overdue: 0,
    closed_this_quarter: 0,
    pending_validation: 0,
  },
  statusCounts: {
    NotStarted: 0,
    InProgress: 0,
    PendingValidation: 0,
    Closed: 0,
    RiskAccepted: 0,
    Dropped: 0,
  },
  openByPriority: [],
  openByEntity: [],
  openByAuditType: [],
  openByDepartment: [],
};

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

function setClosurePeriodParams(params: URLSearchParams, period: ClosurePeriodState | null) {
  params.delete("kpi_period_type");
  params.delete("kpi_date");
  params.delete("kpi_from");
  params.delete("kpi_to");

  if (!period) {
    return;
  }

  params.set("kpi_period_type", period.type);
  if (period.type === "as_on") {
    params.set("kpi_date", period.date);
  } else {
    params.set("kpi_from", period.from);
    params.set("kpi_to", period.to);
  }
}

function getTodayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function parseDateInput(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function startOfWeek(date: Date) {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = copy.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setUTCDate(copy.getUTCDate() + diff);
  return copy;
}

function getQuickPickPeriod(quickPick: QuickPick): ClosurePeriodState {
  const today = parseDateInput(getTodayInputValue()) ?? new Date();
  const todayValue = formatDateInput(today);

  if (quickPick === "today") {
    return { type: "as_on", date: todayValue };
  }

  if (quickPick === "week") {
    return { type: "range", from: formatDateInput(startOfWeek(today)), to: todayValue };
  }

  if (quickPick === "month") {
    return {
      type: "range",
      from: formatDateInput(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))),
      to: todayValue,
    };
  }

  if (quickPick === "quarter") {
    const quarterStartMonth = Math.floor(today.getUTCMonth() / 3) * 3;
    return {
      type: "range",
      from: formatDateInput(new Date(Date.UTC(today.getUTCFullYear(), quarterStartMonth, 1))),
      to: todayValue,
    };
  }

  return {
    type: "range",
    from: formatDateInput(new Date(Date.UTC(today.getUTCFullYear(), 0, 1))),
    to: todayValue,
  };
}

function getClosurePeriodFromParams(searchParams: URLSearchParams): ClosurePeriodState {
  const periodType = searchParams.get("kpi_period_type");

  if (periodType === "range") {
    const from = parseDateInput(searchParams.get("kpi_from"));
    const to = parseDateInput(searchParams.get("kpi_to"));
    if (from && to) {
      return { type: "range", from: formatDateInput(from), to: formatDateInput(to) };
    }
  }

  if (periodType === "as_on") {
    const date = parseDateInput(searchParams.get("kpi_date"));
    if (date) {
      return { type: "as_on", date: formatDateInput(date) };
    }
  }

  return getQuickPickPeriod("today");
}

function getActiveQuickPick(period: ClosurePeriodState, customDate: string) {
  if (customDate) {
    return null;
  }

  return QUICK_PICKS.find((item) => {
    const quickPeriod = getQuickPickPeriod(item.id);
    return JSON.stringify(quickPeriod) === JSON.stringify(period);
  })?.id ?? null;
}

function buildClosureApiQuery(period: ClosurePeriodState) {
  const params = new URLSearchParams();
  params.set("period_type", period.type);
  if (period.type === "as_on") {
    params.set("date", period.date);
  } else {
    params.set("from", period.from);
    params.set("to", period.to);
  }

  return params.toString();
}

function getRateColour(rate: number | null) {
  if (rate === null) return "var(--text3)";
  if (rate >= CLOSURE_RATE_THRESHOLDS.good) return "var(--insight-mitigated-text)";
  if (rate >= CLOSURE_RATE_THRESHOLDS.warning) return "var(--insight-quality-text)";
  return "var(--red)";
}

function formatRate(rate: number | null) {
  return rate === null ? "—" : `${rate.toFixed(1)}%`;
}

function ClosureKpiCard({
  accent,
  label,
  value,
  trend,
  isLoading,
}: {
  accent: string;
  label: string;
  value: string | number;
  trend: string;
  isLoading: boolean;
}) {
  return (
    <article className="dashboard-kpi" style={{ borderLeftColor: accent }}>
      {isLoading ? <span className="closure-kpi-skeleton-number" /> : <strong style={{ color: accent }}>{value}</strong>}
      <span>{label}</span>
      <small>{trend}</small>
    </article>
  );
}

function ClosureTableSkeleton() {
  return (
    <div className="closure-table__body">
      {Array.from({ length: 3 }, (_item, index) => (
        <div className="closure-table__row closure-table__row--skeleton" key={index}>
          {Array.from({ length: 6 }, (_cell, cellIndex) => (
            <span key={cellIndex} />
          ))}
        </div>
      ))}
    </div>
  );
}

function ClosureBreakdownTable({
  title,
  description,
  rows,
  dimension,
  loading,
  activeDrillDown,
  onDrillDown,
}: {
  title: string;
  description: string;
  rows: ClosureKpiRow[];
  dimension: ClosureDimension;
  loading: boolean;
  activeDrillDown: string | null;
  onDrillDown: (dimension: ClosureDimension, dimensionValue: string) => Promise<void>;
}) {
  return (
    <section className="closure-table-card">
      <header>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </header>
      {rows.length === 0 && !loading ? (
        <p className="closure-empty">No items due in this period.</p>
      ) : (
        <div className="closure-table">
          <div className="closure-table__head">
            <span>Name</span>
            <span>Due</span>
            <span>Closed</span>
            <span>Rate</span>
            <span>Bar</span>
            <span aria-label="Drill-down" />
          </div>
          <div className="closure-table__body">
            {rows.map((row) => {
              const drillKey = `${dimension}:${row.dimension}`;
              const isDrilling = activeDrillDown === drillKey;
              const rateColour = getRateColour(row.rate);

              return (
                <button
                  className="closure-table__row"
                  disabled={isDrilling}
                  key={drillKey}
                  onClick={() => onDrillDown(dimension, row.dimension)}
                  style={{ opacity: isDrilling ? 0.6 : 1 }}
                  type="button"
                >
                  <span>{row.dimension}</span>
                  <span>{row.due}</span>
                  <span>{row.closed}</span>
                  <span style={{ color: rateColour }}>{formatRate(row.rate)}</span>
                  <span className="closure-rate-bar" aria-hidden="true">
                    <i style={{ background: rateColour, width: `${row.rate ?? 0}%` }} />
                  </span>
                  <span className="closure-drill">{isDrilling ? <i className="closure-spinner" /> : "→"}</span>
                </button>
              );
            })}
          </div>
          {loading ? <ClosureTableSkeleton /> : null}
        </div>
      )}
      {rows.length === 0 && loading ? <ClosureTableSkeleton /> : null}
    </section>
  );
}

function DashboardPageContent() {
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTab: DashboardTab = searchParams.get("tab") === "closure" ? "closure" : "overview";
  const [user, setUser] = useState<DashboardUser | null>(null);
  const [dashboardData, setDashboardData] = useState<DashboardData>(emptyData);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [closureData, setClosureData] = useState<ClosureKpiResponse | null>(null);
  const [closurePeriod, setClosurePeriod] = useState<ClosurePeriodState>(() =>
    getClosurePeriodFromParams(new URLSearchParams(searchParams.toString())),
  );
  const [customClosureDate, setCustomClosureDate] = useState(
    searchParams.get("kpi_period_type") === "as_on" && searchParams.get("kpi_date")
      ? searchParams.get("kpi_date") ?? ""
      : "",
  );
  const [closureOpened, setClosureOpened] = useState(activeTab === "closure");
  const [closureLoading, setClosureLoading] = useState(false);
  const [activeDrillDown, setActiveDrillDown] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/v1/dashboard/summary");
      const body = await readResponseBody(response);

      if (!response.ok) {
        setError(
          typeof body === "object" && body && "error" in body
            ? String(body.error)
            : "Unable to load dashboard data.",
        );
        return;
      }

      setDashboardData(body as DashboardData);
    } catch {
      setError("Unable to load dashboard data.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    getSession().then((session) => {
      if (!session?.user) {
        return;
      }

      setUser({
        id: session.user.id,
        name: session.user.name,
        role: session.user.role,
        is_admin: session.user.is_admin,
      });
    });
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  useEffect(() => {
    setClosurePeriod(getClosurePeriodFromParams(new URLSearchParams(searchParams.toString())));
  }, [searchParams]);

  useEffect(() => {
    if (activeTab === "closure") {
      setClosureOpened(true);
    }
  }, [activeTab]);

  const fetchClosureKpis = useCallback(async () => {
    setClosureLoading(true);

    try {
      const response = await fetch(`/api/v1/kpi/closure?${buildClosureApiQuery(closurePeriod)}`);
      const body = await readResponseBody(response);

      if (!response.ok) {
        toast.error(
          typeof body === "object" && body && "error" in body
            ? String(body.error)
            : "Unable to load closure KPIs.",
        );
        return;
      }

      setClosureData(body as ClosureKpiResponse);
    } catch {
      toast.error("Unable to load closure KPIs.");
    } finally {
      setClosureLoading(false);
    }
  }, [closurePeriod, toast]);

  useEffect(() => {
    if (!closureOpened || activeTab !== "closure") {
      return;
    }

    fetchClosureKpis();
  }, [activeTab, closureOpened, fetchClosureKpis]);

  const handleChartFilter = useCallback((params: Partial<Filters>) => {
    const chartSearchParams = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== "") {
        if (Array.isArray(value)) {
          chartSearchParams.set(key, value.join(","));
        } else {
          chartSearchParams.set(key, String(value));
        }
      }
    });

    router.push(`/action-plans?${chartSearchParams.toString()}`);
  }, [router]);

  function switchDashboardTab(nextTab: DashboardTab) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextTab === "closure") {
      params.set("tab", "closure");
      setClosurePeriodParams(params, closurePeriod);
    } else {
      params.delete("tab");
      params.delete("kpi_period_type");
      params.delete("kpi_date");
      params.delete("kpi_from");
      params.delete("kpi_to");
    }

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function updateClosurePeriod(nextPeriod: ClosurePeriodState) {
    setClosurePeriod(nextPeriod);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "closure");
    setClosurePeriodParams(params, nextPeriod);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  async function drillDownClosureKpi(dimension: ClosureDimension, dimensionValue: string) {
    const drillKey = `${dimension}:${dimensionValue}`;
    setActiveDrillDown(drillKey);

    try {
      const params = new URLSearchParams(buildClosureApiQuery(closurePeriod));
      params.set("dimension", dimension);
      params.set("dimension_value", dimensionValue);
      const response = await fetch(`/api/v1/kpi/closure/drill-down?${params.toString()}`);
      const body = await readResponseBody(response);

      if (!response.ok) {
        toast.error(
          typeof body === "object" && body && "error" in body
            ? String(body.error)
            : "Unable to open closure drill-down.",
        );
        return;
      }

      const drillDown = body as { dueIds: string[] };
      const ids = drillDown.dueIds.length > 0 ? drillDown.dueIds.join(",") : EMPTY_DRILLDOWN_ID;
      router.push(`/action-plans?ids=${encodeURIComponent(ids)}`);
    } catch {
      toast.error("Unable to open closure drill-down.");
    } finally {
      setActiveDrillDown(null);
    }
  }

  const todayLabel = new Intl.DateTimeFormat("en", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date());
  const activeQuickPick = getActiveQuickPick(closurePeriod, customClosureDate);
  const todayInputValue = getTodayInputValue();
  const closureRateColour = getRateColour(closureData?.overall.rate ?? null);

  return (
    <AppLayout>
      <div className="dashboard-page">
        <header className="dashboard-header">
          <div>
            <p>{todayLabel}</p>
            <h1>Audit Follow-Up Dashboard</h1>
            <span>
              Welcome{user?.name ? `, ${user.name}` : ""}. Track remediation progress and
              follow-up work from one view.
            </span>
          </div>
          {user?.role === "Viewer" ? <span className="dashboard-pill">View only</span> : null}
        </header>

        <nav className="admin-tabs" aria-label="Dashboard tabs">
          <button
            className={activeTab === "overview" ? "admin-tab-link admin-tab-link--active" : "admin-tab-link"}
            onClick={() => switchDashboardTab("overview")}
            type="button"
          >
            Overview
          </button>
          <button
            className={activeTab === "closure" ? "admin-tab-link admin-tab-link--active" : "admin-tab-link"}
            onClick={() => switchDashboardTab("closure")}
            type="button"
          >
            Closure KPIs
          </button>
        </nav>

        {error ? (
          <div className="auth-error inline-error-banner">
            <span>{error}</span>
            <button className="button" onClick={fetchDashboard} type="button">Retry</button>
          </div>
        ) : null}

        {activeTab === "overview" ? (
          <>
            {isLoading ? (
              <div className="dashboard-charts-redesign">
                <section className="dashboard-kpis">
                  {Array.from({ length: 4 }, (_, index) => (
                    <div className="dashboard-kpi dashboard-kpi--skeleton" key={index} />
                  ))}
                </section>
                <section className="dashboard-chart-grid dashboard-chart-grid--top">
                  <article className="dashboard-panel dashboard-panel--skeleton" />
                  <article className="dashboard-panel dashboard-panel--skeleton" />
                </section>
                <section className="dashboard-chart-grid dashboard-chart-grid--bottom">
                  <article className="dashboard-panel dashboard-panel--skeleton" />
                  <article className="dashboard-panel dashboard-panel--skeleton" />
                </section>
              </div>
            ) : (
              <DashboardCharts
                kpis={dashboardData.kpis}
                onFilter={handleChartFilter}
                statusCounts={dashboardData.statusCounts}
                openByPriority={dashboardData.openByPriority}
                openByEntity={dashboardData.openByEntity}
                openByAuditType={dashboardData.openByAuditType}
                openByDepartment={dashboardData.openByDepartment}
              />
            )}
          </>
        ) : (
          <section className="closure-kpis-tab">
            <div className="closure-period-card">
              <div className="closure-quick-picks" aria-label="Closure KPI period">
                {QUICK_PICKS.map((quickPick) => (
                  <button
                    className={activeQuickPick === quickPick.id ? "admin-filter active" : "admin-filter"}
                    key={quickPick.id}
                    onClick={() => {
                      setCustomClosureDate("");
                      updateClosurePeriod(getQuickPickPeriod(quickPick.id));
                    }}
                    type="button"
                  >
                    {quickPick.label}
                  </button>
                ))}
              </div>
              <label className="closure-date-filter">
                <span>As on date</span>
                <input
                  max={todayInputValue}
                  type="date"
                  value={customClosureDate}
                  onChange={(event) => {
                    setCustomClosureDate(event.target.value);
                    if (event.target.value) {
                      updateClosurePeriod({ type: "as_on", date: event.target.value });
                    }
                  }}
                />
              </label>
            </div>

            <section className="dashboard-kpis dashboard-kpis--three">
              <ClosureKpiCard
                accent="var(--text3)"
                isLoading={closureLoading}
                label="Due in period"
                trend="items due in period"
                value={closureData?.overall.due ?? 0}
              />
              <ClosureKpiCard
                accent={closureRateColour}
                isLoading={closureLoading}
                label="Closed in period"
                trend="items closed in period"
                value={closureData?.overall.closed ?? 0}
              />
              <ClosureKpiCard
                accent={closureRateColour}
                isLoading={closureLoading}
                label="Closure rate"
                trend="closure rate"
                value={formatRate(closureData?.overall.rate ?? null)}
              />
            </section>

            <ClosureBreakdownTable
              activeDrillDown={activeDrillDown}
              description="Closure rate by audit type"
              dimension="audit_type"
              loading={closureLoading}
              rows={closureData?.byAuditType ?? []}
              title="By Audit Type"
              onDrillDown={drillDownClosureKpi}
            />
            <ClosureBreakdownTable
              activeDrillDown={activeDrillDown}
              description="Closure rate by audit"
              dimension="audit_name"
              loading={closureLoading}
              rows={closureData?.byAuditName ?? []}
              title="By Audit"
              onDrillDown={drillDownClosureKpi}
            />
            <ClosureBreakdownTable
              activeDrillDown={activeDrillDown}
              description="Closure rate by primary follow-up auditor"
              dimension="follow_up_auditor"
              loading={closureLoading}
              rows={closureData?.byFollowUpAuditor ?? []}
              title="By Follow-up Auditor"
              onDrillDown={drillDownClosureKpi}
            />
            <ClosureBreakdownTable
              activeDrillDown={activeDrillDown}
              description="Closure rate by owner department"
              dimension="department"
              loading={closureLoading}
              rows={closureData?.byDepartment ?? []}
              title="By Department"
              onDrillDown={drillDownClosureKpi}
            />
          </section>
        )}
      </div>
    </AppLayout>
  );
}

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardPageContent />
    </Suspense>
  );
}
