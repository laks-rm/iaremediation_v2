"use client";

import { getSession } from "next-auth/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import AppLayout from "../../components/AppLayout";
import { useToast } from "../../components/Toast";

type UserRole = "AuditTeam" | "Viewer" | "Auditee" | "Pending";
type InsightType =
  | "risk_concentration"
  | "bottleneck"
  | "quality_gap"
  | "forward_look"
  | "anomaly"
  | "risk_mitigated";
type InsightSeverity = "High" | "Moderate" | "Low";
type InsightConfidence = "High" | "Medium" | "Low";

type AiInsightCard = {
  id: string;
  cardVersion: string;
  insightType: InsightType;
  severity: InsightSeverity;
  confidence: InsightConfidence;
  headline: string;
  narrative: string;
  findings: Record<string, unknown>;
  relatedItems: {
    actionPlanIds: string[];
    findingIds: string[];
  };
  drillThroughFilter: Record<string, string | string[] | number | boolean | null | undefined>;
  supportingNumbers: {
    label: string;
    value: string | number;
  }[];
};

type AiInsightsPayload = {
  version: "ai-insights-v1";
  promptVersion: string;
  generatedAt: string;
  executiveBrief: string;
  cards: AiInsightCard[];
  categoryCounts: Record<InsightType | "all", number>;
};

type AiInsightsSnapshot = {
  id: string;
  generated_at: string;
  generated_by: string | null;
  trigger: string;
  model_used: string;
  prompt_version: string;
  duration_ms: number;
  payload: AiInsightsPayload;
};

type CurrentUser = {
  id: string;
  role: UserRole;
  is_admin: boolean;
};

const CATEGORY_TABS: { id: InsightType | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "risk_concentration", label: "Risk concentration" },
  { id: "bottleneck", label: "Bottlenecks" },
  { id: "quality_gap", label: "Quality gaps" },
  { id: "forward_look", label: "Forward look" },
  { id: "anomaly", label: "Anomalies" },
  { id: "risk_mitigated", label: "Risk mitigated" },
];

const CATEGORY_LABELS: Record<InsightType, string> = {
  risk_concentration: "Risk concentration",
  bottleneck: "Bottleneck",
  quality_gap: "Quality gap",
  forward_look: "Forward look",
  anomaly: "Anomaly",
  risk_mitigated: "Risk mitigated",
};

async function readResponseBody(response: Response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function responseError(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "error" in body) return String((body as { error?: unknown }).error);
  if (body && typeof body === "object" && "message" in body) return String((body as { message?: unknown }).message);
  return fallback;
}

function formatRelativeTime(value: string) {
  const diffSeconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (diffSeconds < 60) return "just now";
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

function formatCooldown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

function serializeDrillThroughFilter(filter: AiInsightCard["drillThroughFilter"]) {
  const params = new URLSearchParams();

  Object.entries(filter).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      params.set(key, value.join(","));
      return;
    }
    params.set(key, String(value));
  });

  return params.toString();
}

function InsightsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const activeTopTab = searchParams.get("tab") === "board-report" ? "board-report" : "insights";
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [snapshot, setSnapshot] = useState<AiInsightsSnapshot | null>(null);
  const [activeCategory, setActiveCategory] = useState<InsightType | "all">("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  const canRefresh = currentUser?.is_admin === true || currentUser?.role === "AuditTeam";
  const isBoardReport = activeTopTab === "board-report";

  useEffect(() => {
    getSession().then((session) => {
      if (!session?.user) return;
      setCurrentUser({
        id: session.user.id,
        role: session.user.role as UserRole,
        is_admin: session.user.is_admin,
      });
    });
  }, []);

  async function loadSnapshot() {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/v1/insights/ai");
      const body = await readResponseBody(response);
      if (!response.ok) throw new Error(responseError(body, "Unable to load AI insights."));
      setSnapshot((body as { snapshot?: AiInsightsSnapshot | null }).snapshot ?? null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to load AI insights.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadSnapshot();
  }, []);

  useEffect(() => {
    if (cooldownSeconds <= 0) return undefined;

    const timer = window.setInterval(() => {
      setCooldownSeconds((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [cooldownSeconds]);

  async function refreshSnapshot() {
    setIsRefreshing(true);
    try {
      const response = await fetch("/api/v1/insights/ai/refresh", { method: "POST" });
      const body = await readResponseBody(response);

      if (response.status === 429) {
        const retryAfter = Number((body as { retry_after?: unknown } | null)?.retry_after ?? 0);
        setCooldownSeconds(Math.max(0, retryAfter));
        return;
      }

      if (!response.ok) throw new Error(responseError(body, "Unable to refresh AI insights."));
      setSnapshot((body as { snapshot: AiInsightsSnapshot }).snapshot);
      setCooldownSeconds(0);
    } catch (caughtError) {
      toast.error(caughtError instanceof Error ? caughtError.message : "Unable to refresh AI insights.");
    } finally {
      setIsRefreshing(false);
    }
  }

  const cards = snapshot?.payload.cards ?? [];
  const visibleCards = useMemo(
    () => (activeCategory === "all" ? cards : cards.filter((card) => card.insightType === activeCategory)),
    [activeCategory, cards],
  );

  function drillThrough(card: AiInsightCard) {
    const query = serializeDrillThroughFilter(card.drillThroughFilter);
    router.push(query ? `/action-plans?${query}` : "/action-plans");
  }

  return (
    <AppLayout>
      <div className="insights-page">
        <div className="insights-tabs">
          <Link className={activeTopTab === "insights" ? "insights-tab insights-tab--active" : "insights-tab"} href="/insights">
            Insights
          </Link>
          <Link
            className={isBoardReport ? "insights-tab insights-tab--active" : "insights-tab"}
            href="/insights?tab=board-report"
          >
            Board Report
          </Link>
        </div>

        {isBoardReport ? (
          <section className="insights-construction">
            <span>▧</span>
            <h1>Board Report is currently under development.</h1>
            <p>It will be available in a future release.</p>
          </section>
        ) : (
          <>
            <header className="ai-insights-header">
              <div>
                <p>AI Insights</p>
                <h1>AI Insights</h1>
                <span>
                  {snapshot ? `Updated ${formatRelativeTime(snapshot.generated_at)} ago` : "Patterns, risks, and bottlenecks across the audit portfolio."}
                </span>
              </div>
              {canRefresh ? (
                <button
                  className="button button--primary ai-insights-refresh"
                  disabled={isRefreshing || cooldownSeconds > 0}
                  onClick={refreshSnapshot}
                  type="button"
                >
                  {isRefreshing ? <span className="ai-insights-spinner" /> : null}
                  {isRefreshing
                    ? "Generating..."
                    : cooldownSeconds > 0
                      ? `Refresh available in ${formatCooldown(cooldownSeconds)}`
                      : "Refresh"}
                </button>
              ) : null}
            </header>

            {isRefreshing ? (
              <p className="ai-insights-refresh-note">
                Generating insights takes 20-40 seconds. You can navigate away while the snapshot is refreshed.
              </p>
            ) : null}

            {isLoading ? <AiInsightsSkeleton /> : null}

            {!isLoading && error ? (
              <section className="ai-insights-empty">
                <h2>Unable to load AI insights</h2>
                <p>{error}</p>
                <button className="button" onClick={loadSnapshot} type="button">
                  Retry
                </button>
              </section>
            ) : null}

            {!isLoading && !error && !snapshot ? (
              <section className="ai-insights-empty">
                <h2>No insights have been generated yet</h2>
                <p>Refresh AI insights to generate the first grounded snapshot for this portfolio.</p>
                {canRefresh ? (
                  <button
                    className="button button--primary ai-insights-refresh"
                    disabled={isRefreshing || cooldownSeconds > 0}
                    onClick={refreshSnapshot}
                    type="button"
                  >
                    {isRefreshing ? <span className="ai-insights-spinner" /> : null}
                    {isRefreshing
                      ? "Generating..."
                      : cooldownSeconds > 0
                        ? `Refresh available in ${formatCooldown(cooldownSeconds)}`
                        : "Refresh"}
                  </button>
                ) : null}
              </section>
            ) : null}

            {!isLoading && !error && snapshot ? (
              <main className="ai-insights-stack">
                <nav aria-label="AI insight categories" className="ai-insights-category-tabs">
                  {CATEGORY_TABS.map((tab) => (
                    <button
                      className={activeCategory === tab.id ? "ai-insights-category-tab ai-insights-category-tab--active" : "ai-insights-category-tab"}
                      key={tab.id}
                      onClick={() => setActiveCategory(tab.id)}
                      type="button"
                    >
                      <span>{tab.label}</span>
                      <strong>{snapshot.payload.categoryCounts[tab.id] ?? 0}</strong>
                    </button>
                  ))}
                </nav>

                {snapshot.payload.executiveBrief.trim() ? (
                  <section className="ai-insights-brief">
                    <span>Executive Brief</span>
                    <p>{snapshot.payload.executiveBrief}</p>
                  </section>
                ) : null}

                {visibleCards.length === 0 ? (
                  <section className="ai-insights-empty ai-insights-empty--compact">
                    <p>No insights in this category for the current period.</p>
                  </section>
                ) : (
                  <section className="ai-insights-cards">
                    {visibleCards.map((card) => (
                      <article className="ai-insight-card" key={card.id}>
                        <header>
                          <div>
                            <span className={`ai-insight-badge ai-insight-badge--${card.insightType}`}>
                              {CATEGORY_LABELS[card.insightType]}
                            </span>
                            <span className={`ai-insight-severity ai-insight-severity--${card.severity.toLowerCase()}`}>
                              {card.severity}
                            </span>
                          </div>
                          <em>Confidence: {card.confidence.toLowerCase()}</em>
                        </header>
                        <h2>{card.headline}</h2>
                        <p>{card.narrative}</p>
                        <footer>
                          <div className="ai-insight-supporting-numbers">
                            {card.supportingNumbers.map((item) => (
                              <span key={`${card.id}-${item.label}`}>
                                <small>{item.label}</small>
                                <strong>{item.value}</strong>
                              </span>
                            ))}
                          </div>
                          {card.relatedItems.actionPlanIds.length > 0 ? (
                            <button onClick={() => drillThrough(card)} type="button">
                              View {card.relatedItems.actionPlanIds.length} items →
                            </button>
                          ) : null}
                        </footer>
                      </article>
                    ))}
                  </section>
                )}

                <p className="ai-insights-footer-note">
                  Insights are grounded in live remediation data. Each 'View items' link filters action plans to the exact items referenced.
                </p>
              </main>
            ) : null}
          </>
        )}
      </div>
    </AppLayout>
  );
}

function AiInsightsSkeleton() {
  return (
    <div className="ai-insights-stack">
      <div className="ai-insights-skeleton ai-insights-skeleton--tabs" />
      <div className="ai-insights-skeleton ai-insights-skeleton--brief" />
      {Array.from({ length: 3 }, (_item, index) => (
        <div className="ai-insights-skeleton ai-insights-skeleton--card" key={index} />
      ))}
    </div>
  );
}

export default function InsightsPage() {
  return (
    <Suspense>
      <InsightsPageContent />
    </Suspense>
  );
}
