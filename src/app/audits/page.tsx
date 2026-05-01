"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import AppLayout from "../../components/AppLayout";
import EmptyState from "../../components/EmptyState";
import { useToast } from "../../components/Toast";
import { AUDIT_TYPE_LABELS } from "../../lib/constants";

type AuditType = keyof typeof AUDIT_TYPE_LABELS;
type OpinionRating = "Satisfactory" | "NeedsImprovement" | "Unsatisfactory";

type AuditListItem = {
  id: string;
  name: string;
  reference_number: string | null;
  audit_type: AuditType;
  opinion_rating: OpinionRating | null;
  report_issue_date: string | null;
  created_at: string;
  finding_count: number;
  action_plan_count: number;
  open_action_plan_count: number;
  audit_entities: {
    entity: {
      id: string;
      code: string;
      full_name: string;
    };
  }[];
};

const AUDIT_TYPES: AuditType[] = [
  "IT",
  "RegulatoryIT",
  "Operations",
  "RegulatoryOperations",
  "External",
];
const OPINION_RATINGS: OpinionRating[] = [
  "Satisfactory",
  "NeedsImprovement",
  "Unsatisfactory",
];

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
  return typeof body === "object" && body && "error" in body ? String(body.error) : fallback;
}

function formatDate(value: string | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function auditTypeClass(type: AuditType) {
  return `audit-badge audit-badge--type-${type.toLowerCase()}`;
}

function opinionClass(rating: OpinionRating | null) {
  return `audit-badge audit-badge--opinion-${(rating ?? "none").toLowerCase()}`;
}

export default function AuditsPage() {
  const toast = useToast();
  const [audits, setAudits] = useState<AuditListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [auditType, setAuditType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [opinionRating, setOpinionRating] = useState("");
  const [year, setYear] = useState("");

  const loadAudits = useCallback(() => {
    let isMounted = true;
    setIsLoading(true);
    setError("");

    fetch("/api/v1/audits")
      .then(async (response) => {
        const body = await readResponseBody(response);
        if (!response.ok) {
          throw new Error(responseError(body, "Unable to load audits."));
        }
        return body as { audits: AuditListItem[] };
      })
      .then((body) => {
        if (isMounted) {
          setAudits(body.audits);
        }
      })
      .catch((caughtError: Error) => {
        if (isMounted) {
          setError(caughtError.message);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => loadAudits(), [loadAudits]);

  const entities = useMemo(() => {
    const map = new Map<string, { code: string; full_name: string }>();
    audits.forEach((audit) => {
      audit.audit_entities.forEach(({ entity }) => {
        map.set(entity.id, { code: entity.code, full_name: entity.full_name });
      });
    });
    return [...map.entries()].sort((left, right) => left[1].code.localeCompare(right[1].code));
  }, [audits]);

  const years = useMemo(() => {
    const values = new Set<string>();
    audits.forEach((audit) => {
      if (audit.report_issue_date) {
        values.add(String(new Date(audit.report_issue_date).getFullYear()));
      }
    });
    return [...values].sort((left, right) => Number(right) - Number(left));
  }, [audits]);

  const filteredAudits = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return audits.filter((audit) => {
      const matchesSearch =
        !needle ||
        [audit.name, audit.reference_number ?? ""].join(" ").toLowerCase().includes(needle);
      const matchesType = !auditType || audit.audit_type === auditType;
      const matchesEntity =
        !entityId || audit.audit_entities.some(({ entity }) => entity.id === entityId);
      const matchesOpinion = !opinionRating || audit.opinion_rating === opinionRating;
      const matchesYear =
        !year ||
        (audit.report_issue_date &&
          String(new Date(audit.report_issue_date).getFullYear()) === year);

      return matchesSearch && matchesType && matchesEntity && matchesOpinion && matchesYear;
    });
  }, [auditType, audits, entityId, opinionRating, search, year]);

  function handleExport() {
    try {
      const params = new URLSearchParams();

      if (search.trim()) params.set("search", search.trim());
      if (auditType) params.set("audit_type", auditType);
      if (entityId) params.set("entity_id", entityId);
      if (opinionRating) params.set("opinion_rating", opinionRating);
      if (year) params.set("year", year);

      const query = params.toString();
      setIsExporting(true);
      window.setTimeout(() => setIsExporting(false), 300);
      window.location.href = query ? `/api/v1/audits/export?${query}` : "/api/v1/audits/export";
    } catch {
      toast.error("Unable to start export.");
      setIsExporting(false);
    }
  }

  return (
    <AppLayout>
      <div className="audits-page">
        <header className="audits-header">
          <div>
            <p>Audit library</p>
            <h1>Audit Reports</h1>
            <span>Browse audit reports, findings, and remediation coverage.</span>
          </div>
          <div className="audits-header__actions">
            <Link className="button button--primary" href="/records/new?mode=audit">
              + New Audit Report
            </Link>
            <button className="button" disabled={isExporting} onClick={handleExport} type="button">
              Export
            </button>
          </div>
        </header>

        {error ? (
          <div className="auth-error inline-error-banner">
            <span>{error}</span>
            <button className="button" onClick={() => loadAudits()} type="button">Retry</button>
          </div>
        ) : null}

        <section className="audits-filterbar">
          <input
            aria-label="Search audits"
            placeholder="Search name or reference number"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select value={auditType} onChange={(event) => setAuditType(event.target.value)}>
            <option value="">All audit types</option>
            {AUDIT_TYPES.map((type) => (
              <option key={type} value={type}>
                {AUDIT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <select value={entityId} onChange={(event) => setEntityId(event.target.value)}>
            <option value="">All entities</option>
            {entities.map(([id, entity]) => (
              <option key={id} value={id}>
                {entity.code} — {entity.full_name}
              </option>
            ))}
          </select>
          <select value={opinionRating} onChange={(event) => setOpinionRating(event.target.value)}>
            <option value="">All opinions</option>
            {OPINION_RATINGS.map((rating) => (
              <option key={rating} value={rating}>
                {rating}
              </option>
            ))}
          </select>
          <select value={year} onChange={(event) => setYear(event.target.value)}>
            <option value="">All years</option>
            {years.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </section>

        <section className="audits-table-card">
          <div className="audits-table">
            <div className="audits-table__head">
              <span>Reference Number</span>
              <span>Audit Name</span>
              <span>Type</span>
              <span>Opinion Rating</span>
              <span>Issue Date</span>
              <span>Entities</span>
              <span>Findings</span>
              <span>Action Plans</span>
              <span>Actions</span>
            </div>

            {isLoading ? (
              Array.from({ length: 5 }, (_, index) => (
                <div className="audits-row audits-row--skeleton" key={index}>
                  {Array.from({ length: 9 }, (_item, cellIndex) => (
                    <span key={cellIndex} />
                  ))}
                </div>
              ))
            ) : null}

            {!isLoading && filteredAudits.length === 0 ? (
              <EmptyState
                actionHref="/records/new?mode=audit"
                actionLabel="+ Create First Audit Report"
                subtitle="Create an audit report to start tracking findings and action plans."
                title="No audit reports found"
              />
            ) : null}

            {!isLoading
              ? filteredAudits.map((audit) => (
                  <Link className="audits-row" href={`/audits/${audit.id}`} key={audit.id}>
                    <span className="audits-mono">{audit.reference_number || "N/A"}</span>
                    <span>
                      <strong>{audit.name}</strong>
                    </span>
                    <span>
                      <i className={auditTypeClass(audit.audit_type)}>
                        {AUDIT_TYPE_LABELS[audit.audit_type]}
                      </i>
                    </span>
                    <span>
                      <i className={opinionClass(audit.opinion_rating)}>
                        {audit.opinion_rating ?? "Not set"}
                      </i>
                    </span>
                    <span>{formatDate(audit.report_issue_date)}</span>
                    <span className="audits-entity-badges">
                      {audit.audit_entities.map(({ entity }) => (
                        <em key={entity.id}>{entity.code}</em>
                      ))}
                    </span>
                    <span>{audit.finding_count}</span>
                    <span>
                      {audit.open_action_plan_count}/{audit.action_plan_count} open
                    </span>
                    <span className="audits-action">View →</span>
                  </Link>
                ))
              : null}
          </div>
        </section>
      </div>
    </AppLayout>
  );
}
