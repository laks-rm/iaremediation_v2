"use client";

import { useLayoutEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { CLOSURE_RATE_THRESHOLDS } from "../../lib/kpi/closure";

export type TrendBucketRow = {
  period_label: string;
  from: string;
  to: string;
  due_in_period: number;
  overdue_brought_forward: number;
  due: number;
  closed: number;
  closure_rate: number | null;
  overdue_at_period_end: number;
  overdue_created_in_period: number;
  net_movement: number;
};

export type ResolvedChartPalette = {
  red: string;
  mitigated: string;
  quality: string;
  text3: string;
  border: string;
  surface2: string;
};

type ChartPoint = TrendBucketRow & {
  closure_rate_num: number | null;
};

function readPaletteFromDocument(): ResolvedChartPalette | null {
  if (typeof document === "undefined") {
    return null;
  }
  const cs = getComputedStyle(document.documentElement);
  return {
    red: cs.getPropertyValue("--red").trim(),
    mitigated: cs.getPropertyValue("--insight-mitigated-text").trim(),
    quality: cs.getPropertyValue("--insight-quality-text").trim(),
    text3: cs.getPropertyValue("--text3").trim(),
    border: cs.getPropertyValue("--border").trim(),
    surface2: cs.getPropertyValue("--surface2").trim(),
  };
}

type Props = {
  buckets: TrendBucketRow[];
};

export default function ClosureKpiCharts({ buckets }: Props) {
  const [palette, setPalette] = useState<ResolvedChartPalette | null>(null);

  useLayoutEffect(() => {
    function sync() {
      setPalette(readPaletteFromDocument());
    }
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  const lineData = useMemo((): ChartPoint[] => {
    return buckets.map((row) => ({
      ...row,
      closure_rate_num: row.closure_rate,
    }));
  }, [buckets]);

  const barGroupData = useMemo(() => {
    return buckets.map((row) => ({
      ...row,
      name: row.period_label,
      due: row.due,
      closed: row.closed,
      overdue: row.overdue_at_period_end,
    }));
  }, [buckets]);

  const netData = useMemo(() => {
    return buckets.map((row) => ({
      name: row.period_label,
      net: row.net_movement,
    }));
  }, [buckets]);

  if (!palette) {
    return (
      <div className="insights-chart" style={{ padding: 24, color: "var(--text3)" }}>
        Charts unavailable (CSS variables not resolved).
      </div>
    );
  }

  return (
    <div className="insights-grid closure-kpi-charts-wrap" style={{ gridTemplateColumns: "1fr", gap: 20 }}>
      <article className="insights-card">
        <h2>Closure rate trend</h2>
        <div className="insights-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={lineData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={palette.border} strokeDasharray="3 3" />
              <XAxis
                dataKey="period_label"
                tick={{ fill: palette.text3, fontSize: 11 }}
                interval={0}
                angle={-25}
                textAnchor="end"
                height={68}
              />
              <YAxis domain={[0, 100]} tick={{ fill: palette.text3, fontSize: 11 }} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) {
                    return null;
                  }
                  const row = payload[0].payload as ChartPoint;
                  return (
                    <div
                      style={{
                        border: `1px solid ${palette.border}`,
                        borderRadius: 12,
                        padding: 12,
                        background: "var(--surface)",
                        color: "var(--text)",
                        fontSize: 13,
                      }}
                    >
                      <strong>{row.period_label}</strong>
                      <div>Closure rate: {row.closure_rate_num === null ? "—" : `${row.closure_rate_num.toFixed(1)}%`}</div>
                      <div>Due (total): {row.due}</div>
                      <div>Closed: {row.closed}</div>
                    </div>
                  );
                }}
              />
              <ReferenceLine
                y={CLOSURE_RATE_THRESHOLDS.good}
                stroke={palette.mitigated}
                strokeDasharray="5 5"
              />
              <ReferenceLine
                y={CLOSURE_RATE_THRESHOLDS.warning}
                stroke={palette.quality}
                strokeDasharray="5 5"
              />
              <Line
                type="monotone"
                dataKey="closure_rate_num"
                stroke={palette.mitigated}
                strokeWidth={2}
                dot={{ r: 3, fill: palette.mitigated }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </article>

      <div
        className="closure-kpi-charts__row"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          gap: 20,
        }}
      >
        <article className="insights-card">
          <h2>Due vs closed vs overdue</h2>
          <div className="insights-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barGroupData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={palette.border} strokeDasharray="3 3" />
                <XAxis
                  dataKey="name"
                  tick={{ fill: palette.text3, fontSize: 10 }}
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={58}
                />
                <YAxis tick={{ fill: palette.text3, fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    border: `1px solid ${palette.border}`,
                    borderRadius: 12,
                    background: "var(--surface)",
                  }}
                />
                <Legend />
                <Bar dataKey="due" name="Due (total)" fill={palette.quality} radius={[4, 4, 0, 0]} />
                <Bar dataKey="closed" name="Closed" fill={palette.mitigated} radius={[4, 4, 0, 0]} />
                <Bar dataKey="overdue" name="Overdue at end" fill={palette.red} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="insights-card">
          <h2>Net movement</h2>
          <div className="insights-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={netData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={palette.border} strokeDasharray="3 3" />
                <XAxis
                  dataKey="name"
                  tick={{ fill: palette.text3, fontSize: 10 }}
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={58}
                />
                <YAxis tick={{ fill: palette.text3, fontSize: 11 }} />
                <ReferenceLine y={0} stroke={palette.border} />
                <Tooltip
                  contentStyle={{
                    border: `1px solid ${palette.border}`,
                    borderRadius: 12,
                    background: "var(--surface)",
                  }}
                />
                <Bar dataKey="net" name="Net movement" radius={[4, 4, 0, 0]}>
                  {netData.map((entry, index) => (
                    <Cell
                      key={`cell-${entry.name}-${index}`}
                      fill={entry.net >= 0 ? palette.mitigated : palette.red}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </div>
    </div>
  );
}
