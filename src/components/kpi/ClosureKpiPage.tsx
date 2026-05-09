"use client";

import type { ActionPlanStatus, Priority } from "@prisma/client";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";

import { PRIORITY_COLORS, STATUS_COLORS, STATUS_LABELS } from "../../lib/constants";
import type {
  ActionPlanSummary,
  ClosureDimension,
  ClosureDrillDownResult,
  ClosureKpiResult,
  ClosureKpiRow,
} from "../../lib/kpi/closure";
import { CLOSURE_RATE_THRESHOLDS } from "../../lib/kpi/closure";
import { useToast } from "../Toast";

import ClosureKpiCharts, { type TrendBucketRow } from "./ClosureKpiCharts";

const QUICK_PICKS = [
  { id: "week" as const, label: "This week" },
  { id: "month" as const, label: "This month" },
  { id: "quarter" as const, label: "This quarter" },
  { id: "year" as const, label: "This year" },
];

function formatIsoDateUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfUtcWeek(d: Date): Date {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = copy.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setUTCDate(copy.getUTCDate() + diff);
  return copy;
}

function getQuickPickRange(pick: (typeof QUICK_PICKS)[number]["id"]): { from: string; to: string } {
  const today = new Date();
  const to = formatIsoDateUtc(today);

  if (pick === "week") {
    return { from: formatIsoDateUtc(startOfUtcWeek(today)), to };
  }

  if (pick === "month") {
    return {
      from: formatIsoDateUtc(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))),
      to,
    };
  }

  if (pick === "quarter") {
    const quarterStartMonth = Math.floor(today.getUTCMonth() / 3) * 3;
    return {
      from: formatIsoDateUtc(new Date(Date.UTC(today.getUTCFullYear(), quarterStartMonth, 1))),
      to,
    };
  }

  return {
    from: formatIsoDateUtc(new Date(Date.UTC(today.getUTCFullYear(), 0, 1))),
    to,
  };
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

function responseError(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "error" in body) {
    return String((body as { error?: unknown }).error);
  }
  return fallback;
}

type ClosureApiPayload = {
  period: { from: string; to: string };
  overall: ClosureKpiResult;
  byAuditType: ClosureKpiRow[];
  byAuditName: ClosureKpiRow[];
  byFollowUpAuditor: ClosureKpiRow[];
  byDepartment: ClosureKpiRow[];
  byTeamL1: ClosureKpiRow[];
  byEntity: ClosureKpiRow[];
  byPriority: ClosureKpiRow[];
};

type TrendApiPayload = {
  trend_from: string;
  trend_to: string;
  bucket: string;
  buckets: TrendBucketRow[];
};

type ResolvedPalette = {
  red: string;
  mitigated: string;
  quality: string;
  text3: string;
};

function readResolvedPalette(): ResolvedPalette | null {
  if (typeof document === "undefined") {
    return null;
  }
  const cs = getComputedStyle(document.documentElement);
  return {
    red: cs.getPropertyValue("--red").trim(),
    mitigated: cs.getPropertyValue("--insight-mitigated-text").trim(),
    quality: cs.getPropertyValue("--insight-quality-text").trim(),
    text3: cs.getPropertyValue("--text3").trim(),
  };
}

function getRateColour(rate: number | null, palette: ResolvedPalette | null): string {
  if (!palette) {
    return "var(--text3)";
  }
  if (rate === null) {
    return palette.text3;
  }
  if (rate >= CLOSURE_RATE_THRESHOLDS.good) {
    return palette.mitigated;
  }
  if (rate >= CLOSURE_RATE_THRESHOLDS.warning) {
    return palette.quality;
  }
  return palette.red;
}

function formatRate(rate: number | null) {
  return rate === null ? "—" : `${rate.toFixed(1)}%`;
}

function formatDisplayDateUtc(value: string | Date | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  const iso = typeof value === "string" ? value : value.toISOString();
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

function isPriority(value: string | null): value is Priority {
  return value === "High" || value === "Moderate" || value === "Low";
}

function isStatus(value: string): value is ActionPlanStatus {
  return value in STATUS_LABELS;
}

function priorityChipClass(priority: string | null): string {
  if (isPriority(priority)) {
    return `column-filter-chip ${PRIORITY_COLORS[priority].bg} ${PRIORITY_COLORS[priority].text}`;
  }
  return "column-filter-chip bg-slate-100 text-slate-800";
}

function statusChipClass(status: string): string {
  if (isStatus(status)) {
    return `column-filter-chip ${STATUS_COLORS[status].bg} ${STATUS_COLORS[status].text}`;
  }
  return "column-filter-chip bg-slate-100 text-slate-800";
}

const DIMENSION_SECTIONS: {
  dimension: ClosureDimension;
  title: string;
  description: string;
  rowsKey: keyof Pick<
    ClosureApiPayload,
    | "byAuditType"
    | "byAuditName"
    | "byFollowUpAuditor"
    | "byDepartment"
    | "byTeamL1"
    | "byEntity"
    | "byPriority"
  >;
}[] = [
  { dimension: "audit_type", title: "By audit type", description: "Closure KPIs by audit type", rowsKey: "byAuditType" },
  { dimension: "audit_name", title: "By audit name", description: "Closure KPIs by audit", rowsKey: "byAuditName" },
  {
    dimension: "follow_up_auditor",
    title: "By follow-up auditor",
    description: "Closure KPIs by primary follow-up auditor",
    rowsKey: "byFollowUpAuditor",
  },
  { dimension: "department", title: "By department", description: "Closure KPIs by owner department", rowsKey: "byDepartment" },
  { dimension: "team_l1", title: "By team (L1)", description: "Closure KPIs by owner team L1", rowsKey: "byTeamL1" },
  { dimension: "entity", title: "By entity", description: "Closure KPIs by linked entity", rowsKey: "byEntity" },
  { dimension: "priority", title: "By priority", description: "Closure KPIs by action plan priority", rowsKey: "byPriority" },
];

const BUCKET_HEADINGS: Record<keyof ClosureDrillDownResult["buckets"], string> = {
  due_in_period: "Due in period",
  overdue_brought_forward: "Overdue brought forward",
  closed: "Closed",
  overdue_at_period_end: "Overdue at period end",
};

export default function ClosureKpiPage() {
  const toast = useToast();
  const [fromInput, setFromInput] = useState(() => getQuickPickRange("month").from);
  const [toInput, setToInput] = useState(() => getQuickPickRange("month").to);
  const [closurePayload, setClosurePayload] = useState<ClosureApiPayload | null>(null);
  const [trendBuckets, setTrendBuckets] = useState<TrendBucketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [palette, setPalette] = useState<ResolvedPalette | null>(null);
  const [includeOfi, setIncludeOfi] = useState(false);

  const [drillLoadingKey, setDrillLoadingKey] = useState<string | null>(null);
  const [drillContext, setDrillContext] = useState<{
    dimension: ClosureDimension;
    value: string;
    data: ClosureDrillDownResult | null;
  } | null>(null);

  useLayoutEffect(() => {
    function sync() {
      setPalette(readResolvedPalette());
    }
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  const fetchData = useCallback(
    async (from: string, to: string) => {
      setLoading(true);
      try {
        const closureQs = new URLSearchParams({ from, to, include_ofi: includeOfi ? "true" : "false" });
        const trendQs = new URLSearchParams({ trend_from: from, trend_to: to, bucket: "month", include_ofi: includeOfi ? "true" : "false" });

        const [closureRes, trendRes] = await Promise.all([
          fetch(`/api/v1/kpi/closure?${closureQs}`),
          fetch(`/api/v1/kpi/closure/trend?${trendQs}`),
        ]);

        const closureBody = await readResponseBody(closureRes);
        const trendBody = await readResponseBody(trendRes);

        if (!closureRes.ok) {
          throw new Error(responseError(closureBody, "Unable to load closure KPIs."));
        }
        if (!trendRes.ok) {
          throw new Error(responseError(trendBody, "Unable to load closure trend."));
        }

        setClosurePayload(closureBody as ClosureApiPayload);
        setTrendBuckets((trendBody as TrendApiPayload).buckets ?? []);
        setDrillContext(null);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Unable to load closure KPIs.");
        setClosurePayload(null);
        setTrendBuckets([]);
      } finally {
        setLoading(false);
      }
    },
    [toast, includeOfi],
  );

  useEffect(() => {
    void fetchData(fromInput, toInput);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only; other updates via Apply / quick picks
  }, []);

  const activeQuickPick = useMemo(() => {
    return QUICK_PICKS.find((pick) => {
      const range = getQuickPickRange(pick.id);
      return range.from === fromInput && range.to === toInput;
    })?.id ?? null;
  }, [fromInput, toInput]);

  function applyQuickPick(pick: (typeof QUICK_PICKS)[number]["id"]) {
    const range = getQuickPickRange(pick);
    setFromInput(range.from);
    setToInput(range.to);
    void fetchData(range.from, range.to);
  }

  function applyManualRange() {
    if (!fromInput || !toInput) {
      toast.error("Enter both from and to dates.");
      return;
    }
    if (fromInput > toInput) {
      toast.error("From must be on or before to.");
      return;
    }
    void fetchData(fromInput, toInput);
  }

  async function loadDrillDown(dimension: ClosureDimension, dimensionValue: string) {
    const key = `${dimension}:${dimensionValue}`;
    setDrillLoadingKey(key);
    setDrillContext({ dimension, value: dimensionValue, data: null });
    try {
      const qs = new URLSearchParams({
        from: fromInput,
        to: toInput,
        dimension,
        dimension_value: dimensionValue,
        include_ofi: includeOfi ? "true" : "false",
      });
      const response = await fetch(`/api/v1/kpi/closure/drill-down?${qs}`);
      const body = await readResponseBody(response);
      if (!response.ok) {
        throw new Error(responseError(body, "Unable to load drill-down."));
      }
      setDrillContext({
        dimension,
        value: dimensionValue,
        data: body as ClosureDrillDownResult,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load drill-down.");
      setDrillContext(null);
    } finally {
      setDrillLoadingKey(null);
    }
  }

  const overall = closurePayload?.overall;

  const netColour =
    overall === undefined ? "var(--text3)" : overall.net_movement >= 0 ? "var(--insight-mitigated-text)" : "var(--red)";

  return (
    <div className="insights-page closure-kpi-page">
      <header className="ai-header">
        <div>
          <p>Reporting</p>
          <h1>Closure KPIs</h1>
          <span>Portfolio closure performance and drill-down by dimension.</span>
        </div>
      </header>

      <section className="closure-period-card" style={{ marginBottom: 22 }}>
        <div className="closure-quick-picks" aria-label="Closure KPI period">
          {QUICK_PICKS.map((pick) => (
            <button
              className={activeQuickPick === pick.id ? "admin-filter active" : "admin-filter"}
              key={pick.id}
              onClick={() => applyQuickPick(pick.id)}
              type="button"
            >
              {pick.label}
            </button>
          ))}
        </div>
        <div className="closure-date-filter" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
          <label>
            <span>From (UTC)</span>
            <input
              type="date"
              value={fromInput}
              onChange={(event) => setFromInput(event.target.value)}
            />
          </label>
          <label>
            <span>To (UTC)</span>
            <input
              type="date"
              value={toInput}
              onChange={(event) => setToInput(event.target.value)}
            />
          </label>
          <button className="button button--primary" onClick={applyManualRange} type="button">
            Apply
          </button>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, cursor: "pointer" }}>
          <input
            checked={includeOfi}
            type="checkbox"
            onChange={(event) => {
              setIncludeOfi(event.target.checked);
              void fetchData(fromInput, toInput);
            }}
          />
          <span style={{ fontSize: 14, color: "var(--text2)" }}>Include Opportunities for Improvement</span>
          <span
            style={{ fontSize: 13, color: "var(--text3)" }}
            title="OFIs are excluded from closure rate calculations by default as they do not require mandatory remediation"
          >
            ⓘ
          </span>
        </label>
      </section>

      <section className="dashboard-kpis" style={{ marginBottom: 22 }}>
        <article className="dashboard-kpi" style={{ borderLeftColor: "var(--text3)" }}>
          {loading ? <span className="closure-kpi-skeleton-number" /> : <strong>{(overall?.due_in_period ?? 0) + (overall?.overdue_brought_forward ?? 0)}</strong>}
          <span>Due</span>
          <small style={{ color: "var(--text3)" }}>
            {loading
              ? "…"
              : `${overall?.due_in_period ?? 0} in period · ${overall?.overdue_brought_forward ?? 0} brought forward`}
          </small>
        </article>
        <article className="dashboard-kpi" style={{ borderLeftColor: getRateColour(overall?.closure_rate ?? null, palette) }}>
          {loading ? <span className="closure-kpi-skeleton-number" /> : <strong>{overall?.closed ?? 0}</strong>}
          <span>Closed</span>
          <small style={{ color: getRateColour(overall?.closure_rate ?? null, palette) }}>
            {loading ? "…" : `closure rate: ${formatRate(overall?.closure_rate ?? null)}`}
          </small>
        </article>
        <article className="dashboard-kpi" style={{ borderLeftColor: "var(--text3)" }}>
          {loading ? <span className="closure-kpi-skeleton-number" /> : <strong>{overall?.overdue_at_period_end ?? 0}</strong>}
          <span>Overdue at period end</span>
          <small style={{ color: "var(--text3)" }}>
            {loading ? "…" : `${overall?.overdue_created_in_period ?? 0} new this period`}
          </small>
        </article>
        <article className="dashboard-kpi" style={{ borderLeftColor: netColour }}>
          {loading ? (
            <span className="closure-kpi-skeleton-number" />
          ) : (
            <strong style={{ color: netColour }}>
              {overall === undefined ? "—" : `${overall.net_movement >= 0 ? "+" : ""}${overall.net_movement}`}
            </strong>
          )}
          <span>Net movement</span>
          <small style={{ color: "var(--text3)" }}>closed minus overdue created in-period</small>
        </article>
      </section>

      <ClosureKpiCharts buckets={trendBuckets} />

      <section className="closure-kpis-tab" style={{ marginTop: 28 }}>
        {DIMENSION_SECTIONS.map((section) => {
          const rows = closurePayload?.[section.rowsKey] ?? [];
          return (
            <div key={section.dimension}>
              <section className="closure-table-card">
                <header>
                  <div>
                    <h2>{section.title}</h2>
                    <p>{section.description}</p>
                  </div>
                </header>
                {rows.length === 0 && !loading ? (
                  <p className="closure-empty">No rows for this period.</p>
                ) : (
                  <div className="closure-table closure-table--kpi">
                    <div className="closure-table__head">
                      <span>Dimension</span>
                      <span>Due in period</span>
                      <span>Overdue BF</span>
                      <span>Due total</span>
                      <span>Closed</span>
                      <span>Closure %</span>
                      <span aria-label="Drill-down" />
                    </div>
                    <div className="closure-table__body">
                      {loading && rows.length === 0 ? (
                        Array.from({ length: 3 }, (_x, index) => (
                          <div className="closure-table__row closure-table__row--skeleton" key={index}>
                            {Array.from({ length: 7 }, (_c, cellIndex) => (
                              <span key={cellIndex} />
                            ))}
                          </div>
                        ))
                      ) : (
                        rows.map((row) => {
                          const drillKey = `${section.dimension}:${row.dimension}`;
                          const isDrilling = drillLoadingKey === drillKey;
                          const rateColour = getRateColour(row.closure_rate, palette);

                          return (
                            <button
                              className="closure-table__row"
                              disabled={isDrilling}
                              key={drillKey}
                              onClick={() => loadDrillDown(section.dimension, row.dimension)}
                              style={{ opacity: isDrilling ? 0.65 : 1 }}
                              type="button"
                            >
                              <span>{row.dimension}</span>
                              <span>{row.due_in_period}</span>
                              <span>{row.overdue_brought_forward}</span>
                              <span>{row.due}</span>
                              <span>{row.closed}</span>
                              <span style={{ display: "grid", gap: 4, minWidth: 0 }}>
                                <span style={{ color: rateColour }}>{formatRate(row.closure_rate)}</span>
                                <span className="closure-rate-bar" aria-hidden="true">
                                  <i
                                    style={{
                                      width: `${Math.min(100, row.closure_rate ?? 0)}%`,
                                      background: rateColour,
                                    }}
                                  />
                                </span>
                              </span>
                              <span className="closure-drill">{isDrilling ? <i className="closure-spinner" /> : "→"}</span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </section>

              {drillContext?.dimension === section.dimension && drillContext.data ? (
                <DrillDownPanel result={drillContext.data} dimensionValue={drillContext.value} />
              ) : null}
            </div>
          );
        })}
      </section>
    </div>
  );
}

function DrillDownPanel({
  result,
  dimensionValue,
}: {
  result: ClosureDrillDownResult;
  dimensionValue: string;
}) {
  const buckets = result.buckets;

  return (
    <section className="dashboard-panel" style={{ marginTop: 16, marginBottom: 28 }}>
      <header>
        <h2>
          Drill-down: <em>{dimensionValue}</em>
        </h2>
      </header>
      {(Object.keys(BUCKET_HEADINGS) as (keyof typeof BUCKET_HEADINGS)[]).map((bucketKey) => (
        <div key={bucketKey} style={{ marginTop: 18 }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>{BUCKET_HEADINGS[bucketKey]}</h3>
          {buckets[bucketKey].length === 0 ? (
            <p className="closure-empty">No items</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
              {buckets[bucketKey].map((ap) => (
                <li key={ap.id}>
                  <DrillDownActionPlanCard ap={ap} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}

function DrillDownActionPlanCard({ ap }: { ap: ActionPlanSummary }) {
  return (
    <article
      style={{
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: 12,
        background: "var(--surface2)",
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <Link className="audits-mono" href={`/action-plans?expand=${ap.id}`}>
          {ap.display_id}
        </Link>
        <span className={priorityChipClass(ap.priority)} style={{ fontSize: 11, fontWeight: 800 }}>
          {ap.priority ?? "—"}
        </span>
        <span className={statusChipClass(ap.status)} style={{ fontSize: 11, fontWeight: 800 }}>
          {isStatus(ap.status) ? STATUS_LABELS[ap.status] : ap.status}
        </span>
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          lineHeight: 1.4,
          color: "var(--text2)",
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
        }}
      >
        {ap.description}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12, color: "var(--text3)" }}>
        <span>Target: {formatDisplayDateUtc(ap.current_target_date)}</span>
        {ap.closed_at ? <span>Closed: {formatDisplayDateUtc(ap.closed_at)}</span> : null}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {ap.entities.map((code) => (
          <span
            key={code}
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 999,
              border: "1px solid var(--border2)",
              background: "var(--surface)",
            }}
          >
            {code}
          </span>
        ))}
      </div>
    </article>
  );
}
