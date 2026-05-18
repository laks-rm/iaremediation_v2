"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ErrorBanner,
  LoadingRows,
  SlideOver,
  getInitials,
  readResponseBody,
  responseError,
} from "./admin-tab-utils";

type AuditLogUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  is_admin: boolean;
};

type AuditLogEntry = {
  id: string;
  action: string;
  entity_type: string;
  entity_label: string;
  entity_id: string | null;
  entity_identifier: string;
  entity_href: string | null;
  before_json: unknown;
  after_json: unknown;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  user: AuditLogUser | null;
  change_summary: string;
  change_detail: string | null;
};

type FilterOptions = {
  entity_types: string[];
  users: {
    id: string;
    name: string;
    email: string;
  }[];
};

type DateRange = "7" | "30" | "90" | "all" | "custom";

const ACTIONS = [
  "Create",
  "Update",
  "Delete",
  "StatusChange",
  "Login",
  "LoginFailed",
  "Logout",
  "EvidenceUpload",
  "EvidenceReplace",
  "AIExtract",
  "PasswordChange",
  "PasswordReset",
  "AccountLocked",
];
const PAGE_SIZE = 50;

function getRangeStart(range: DateRange) {
  if (range === "all" || range === "custom") {
    return "";
  }

  const date = new Date();
  date.setDate(date.getDate() - Number(range));
  return date.toISOString().slice(0, 10);
}

function formatWhen(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function formatFullTime(value: string) {
  const date = new Date(value);
  const local = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "long",
  }).format(date);

  return `${local} (${date.toISOString()} UTC)`;
}

function relativeTime(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diff / 60000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.round(hours / 24)}d ago`;
}

function avatarColor(name: string) {
  const colors = ["#E0E7FF", "#DCFCE7", "#FEF3C7", "#FCE7F3", "#E0F2FE", "#F3E8FF"];
  const textColors = ["#3730A3", "#166534", "#92400E", "#9D174D", "#075985", "#6B21A8"];
  const seed = name.split("").reduce((total, char) => total + char.charCodeAt(0), 0);
  const index = seed % colors.length;
  return { background: colors[index], color: textColors[index] };
}

function actionTone(action: string, entityType?: string) {
  if (entityType === "Report") return "blue";
  if (action === "Create" || action === "StatusChange") return "blue";
  if (action === "Update") return "amber";
  if (action === "Delete" || action === "LoginFailed" || action === "AccountLocked") return "red";
  if (action === "EvidenceUpload" || action === "EvidenceReplace") return "green";
  if (action === "AIExtract") return "purple";
  return "grey";
}

function toQueryString(params: Record<string, string>) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) searchParams.set(key, value);
  });
  return searchParams.toString();
}

function jsonPreview(value: unknown) {
  if (value === null || value === undefined) {
    return "null";
  }

  return JSON.stringify(value, null, 2);
}

function DiffViewer({ before, after }: { before: unknown; after: unknown }) {
  const beforeRecord = before && typeof before === "object" && !Array.isArray(before) ? before as Record<string, unknown> : {};
  const afterRecord = after && typeof after === "object" && !Array.isArray(after) ? after as Record<string, unknown> : {};
  const changedKeys = new Set([
    ...Object.keys(beforeRecord),
    ...Object.keys(afterRecord),
  ].filter((key) => JSON.stringify(beforeRecord[key]) !== JSON.stringify(afterRecord[key])));

  if (!before && !after) {
    return <p className="activity-log-panel__muted">No before/after payload captured for this event.</p>;
  }

  return (
    <div className="activity-json-diff">
      <section>
        <h4>Before</h4>
        <pre>
          {Object.keys(beforeRecord).length
            ? Object.entries(beforeRecord).map(([key, value]) => (
                <span className={changedKeys.has(key) ? "json-diff-line json-diff-line--removed" : "json-diff-line"} key={key}>
                  {`"${key}": ${jsonPreview(value)}`}
                </span>
              ))
            : "null"}
        </pre>
      </section>
      <section>
        <h4>After</h4>
        <pre>
          {Object.keys(afterRecord).length
            ? Object.entries(afterRecord).map(([key, value]) => (
                <span className={changedKeys.has(key) ? "json-diff-line json-diff-line--added" : "json-diff-line"} key={key}>
                  {`"${key}": ${jsonPreview(value)}`}
                </span>
              ))
            : "null"}
        </pre>
      </section>
    </div>
  );
}

export default function ActivityLogTab() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [options, setOptions] = useState<FilterOptions>({ entity_types: [], users: [] });
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [module, setModule] = useState("");
  const [action, setAction] = useState("");
  const [userId, setUserId] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>("7");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = useMemo(() => {
    const dateFrom = dateRange === "custom" ? customFrom : getRangeStart(dateRange);
    const dateTo = dateRange === "custom" ? customTo : "";
    return toQueryString({
      search: debouncedSearch,
      module,
      action,
      user_id: userId,
      date_from: dateFrom,
      date_to: dateTo,
      page: String(page),
      page_size: String(PAGE_SIZE),
    });
  }, [action, customFrom, customTo, dateRange, debouncedSearch, module, page, userId]);

  const loadEntries = useCallback(async () => {
    setIsLoading(true);
    setError("");
    const response = await fetch(`/api/v1/admin/audit-log?${query}`);
    const body = await readResponseBody(response);
    setIsLoading(false);

    if (!response.ok) {
      setError(responseError(body, "Unable to load activity log."));
      return;
    }

    const payload = body as {
      entries: AuditLogEntry[];
      total: number;
      page_was_capped?: boolean;
      result_set_is_large?: boolean;
    };
    setEntries(payload.entries);
    setTotal(payload.total);
    setNotice(
      payload.page_was_capped || payload.result_set_is_large
        ? "Result set is large. Add more filters to narrow it down."
        : "",
    );
  }, [query]);

  useEffect(() => {
    fetch("/api/v1/admin/audit-log/filter-options")
      .then(async (response) => {
        const body = await readResponseBody(response);
        if (!response.ok) throw new Error(responseError(body, "Unable to load filter options."));
        return body as FilterOptions;
      })
      .then(setOptions)
      .catch((caughtError: Error) => setError(caughtError.message));
  }, []);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    setPage(1);
  }, [action, customFrom, customTo, dateRange, debouncedSearch, module, userId]);

  async function exportCsv() {
    setNotice("");
    const exportQuery = query.replace(/(?:^|&)page=\d+&?/, "").replace(/&$/, "");
    const response = await fetch(`/api/v1/admin/audit-log/export?${exportQuery}`);
    const body = await response.blob();

    if (!response.ok) {
      const text = await body.text();
      try {
        setNotice(JSON.parse(text).error ?? "Unable to export CSV.");
      } catch {
        setNotice("Unable to export CSV.");
      }
      return;
    }

    const url = URL.createObjectURL(body);
    const link = document.createElement("a");
    link.href = url;
    link.download = `activity-log-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="activity-log-tab">
      <header className="admin-section-header">
        <div>
          <h2>Activity Log</h2>
          <p>Every change made in the system. {total} entries.</p>
        </div>
        <button className="button button--primary" onClick={exportCsv} type="button">
          Export CSV
        </button>
      </header>

      <ErrorBanner message={error} onRetry={loadEntries} />
      {notice ? <div className="admin-notice">{notice}</div> : null}

      <div className="activity-log-filters">
        <input
          aria-label="Search activity log"
          placeholder="Search entity, user, email, IP..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select aria-label="Module" value={module} onChange={(event) => setModule(event.target.value)}>
          <option value="">All modules</option>
          {options.entity_types.map((entityType) => (
            <option key={entityType} value={entityType}>{entityType}</option>
          ))}
        </select>
        <select aria-label="Action" value={action} onChange={(event) => setAction(event.target.value)}>
          <option value="">All actions</option>
          {ACTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select aria-label="User" value={userId} onChange={(event) => setUserId(event.target.value)}>
          <option value="">All users</option>
          {options.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
        </select>
        <select aria-label="Date range" value={dateRange} onChange={(event) => setDateRange(event.target.value as DateRange)}>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="all">All time</option>
          <option value="custom">Custom range</option>
        </select>
      </div>

      {dateRange === "custom" ? (
        <div className="activity-log-custom-dates">
          <label>From <input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /></label>
          <label>To <input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></label>
        </div>
      ) : null}

      <div className="activity-log-table">
        <div className="activity-log-table__head">
          <span>When</span>
          <span>Who</span>
          <span>Action</span>
          <span>Entity</span>
          <span>Change</span>
          <span>Actions</span>
        </div>
        {isLoading ? <LoadingRows rows={6} /> : null}
        {!isLoading && entries.map((entry) => {
          const name = entry.user?.name ?? "Unknown user";
          return (
            <div
              className="activity-log-row"
              key={entry.id}
              onClick={() => setSelected(entry)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelected(entry);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <span className="activity-log-time">
                <strong>{formatWhen(entry.created_at)}</strong>
                <em>{relativeTime(entry.created_at)}</em>
              </span>
              <span className="activity-log-who">
                <i style={avatarColor(name)}>{getInitials(name)}</i>
                <span>
                  <strong>{name}</strong>
                  <code>{entry.ip_address ?? "No IP"}</code>
                </span>
              </span>
              <span>
                <mark className={`activity-action-chip activity-action-chip--${actionTone(entry.action, entry.entity_type)}`}>
                  {entry.entity_type === "Report" ? "Report" : entry.action}
                </mark>
              </span>
              <span className="activity-log-entity">
                <strong>{entry.entity_label}</strong>
                {entry.entity_href ? (
                  <Link href={entry.entity_href} onClick={(event) => event.stopPropagation()}>
                    {entry.entity_identifier}
                  </Link>
                ) : (
                  <em>{entry.entity_identifier}</em>
                )}
              </span>
              <span className="activity-log-change">
                <strong>{entry.change_summary}</strong>
                {entry.change_detail ? <em>{entry.change_detail}</em> : null}
              </span>
              <span className="activity-log-actions">
                <button onClick={(event) => { event.stopPropagation(); setSelected(entry); }} type="button">•••</button>
              </span>
            </div>
          );
        })}
      </div>

      <footer className="activity-log-pagination">
        <span>Showing {start}-{end} of {total}</span>
        <div>
          <button className="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} type="button">
            Prev
          </button>
          <button className="button" disabled={page >= lastPage || page >= 200} onClick={() => setPage((current) => current + 1)} type="button">
            Next
          </button>
        </div>
      </footer>

      {selected ? (
        <SlideOver title="Activity details" onClose={() => setSelected(null)}>
          <div className="activity-log-panel">
            <section>
              <h3>{selected.action}</h3>
              <p>{formatFullTime(selected.created_at)}</p>
            </section>
            <section className="activity-log-panel__user">
              <i style={avatarColor(selected.user?.name ?? "Unknown user")}>{getInitials(selected.user?.name ?? "Unknown")}</i>
              <div>
                <strong>{selected.user?.name ?? "Unknown user"}</strong>
                <span>{selected.user?.email ?? "No email"} · {selected.user?.role ?? "No role"}</span>
                <code>{selected.ip_address ?? "No IP"}</code>
                {selected.user_agent ? <small>{selected.user_agent}</small> : null}
              </div>
            </section>
            <section>
              <h3>Entity</h3>
              <p>{selected.entity_type} · {selected.entity_id ?? "No entity ID"}</p>
              {selected.entity_href ? (
                <Link className="button" href={selected.entity_href}>Open {selected.entity_label}</Link>
              ) : null}
            </section>
            <section>
              <h3>Before / After</h3>
              <DiffViewer before={selected.before_json} after={selected.after_json} />
            </section>
          </div>
        </SlideOver>
      ) : null}
    </section>
  );
}
