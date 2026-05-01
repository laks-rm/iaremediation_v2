"use client";

import { useEffect, type ReactNode } from "react";

export type AdminUser = {
  id: string;
  employee_id: string | null;
  email: string;
  name: string;
  role: "AuditTeam" | "Viewer" | "Auditee" | "Pending";
  is_admin: boolean;
  is_internal_auditor: boolean;
  is_active: boolean;
  job_title: string | null;
  department: string | null;
  team_l1: string | null;
  team_l2: string | null;
  team_l3: string | null;
  company: string | null;
  location: string | null;
  manager_name: string | null;
  manager_email: string | null;
  employment_status: string | null;
  last_working_date: string | null;
};

export type EntityRecord = {
  id: string;
  code: string;
  entity_id: string | null;
  full_name: string;
  country: string | null;
  group_category: string | null;
  is_active: boolean;
  display_order: number;
};

export async function readResponseBody(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function responseError(body: unknown, fallback: string) {
  return typeof body === "object" && body && "error" in body ? String(body.error) : fallback;
}

export function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function parseCsv(text: string) {
  const rows = parseCsvRows(text);
  const headers = rows[0]?.map(normalizeHeader) ?? [];
  return rows.slice(1).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])),
  );
}

function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(cell.trim());
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) {
    rows.push(row);
  }

  return rows;
}

export function normalizeHeader(header: string) {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  if (!message) return null;
  return (
    <div className="auth-error admin-error-banner">
      <span>{message}</span>
      <button className="button" onClick={onRetry} type="button">Retry</button>
    </div>
  );
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, index) => (
        <div className="admin-skeleton-row" key={index} />
      ))}
    </>
  );
}

export function SlideOver({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="admin-slide-over">
      <div className="admin-slide-over__panel">
        <header>
          <h2>{title}</h2>
          <button onClick={onClose} type="button">×</button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function RoleBadge({ role }: { role: AdminUser["role"] }) {
  return <span className={`admin-role-badge admin-role-badge--${role.toLowerCase()}`}>{role}</span>;
}
