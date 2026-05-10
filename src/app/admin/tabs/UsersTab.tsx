"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

import ConfirmDialog from "../../../components/ConfirmDialog";
import EmptyState from "../../../components/EmptyState";
import { useToast } from "../../../components/Toast";
import {
  AdminUser,
  ErrorBanner,
  LoadingRows,
  RoleBadge,
  SlideOver,
  getInitials,
  parseCsv,
  readResponseBody,
  responseError,
} from "./admin-tab-utils";

type Filter = "all" | "active" | "pending" | "leavers";

const emptyUser = {
  name: "",
  email: "",
  role: "Pending",
  is_internal_auditor: false,
  is_admin: false,
  is_active: true,
  department: "",
  job_title: "",
  team_l1: "",
  team_l2: "",
  team_l3: "",
  company: "",
  location: "",
  manager_name: "",
  manager_email: "",
} as Partial<AdminUser>;

export default function UsersTab() {
  const toast = useToast();
  const activeInputRef = useRef<HTMLInputElement>(null);
  const leaversInputRef = useRef<HTMLInputElement>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editingUser, setEditingUser] = useState<Partial<AdminUser> | null>(null);
  const [hoverUser, setHoverUser] = useState<{ user: AdminUser; x: number; y: number } | null>(null);
  const [importPreview, setImportPreview] = useState<{ rows: Record<string, string>[]; fileName: string; fileType: "active" | "leavers" } | null>(null);
  const [csvMismatch, setCsvMismatch] = useState<"looks-like-leavers" | "looks-like-active" | null>(null);
  const [banner, setBanner] = useState("");
  const [bannerType, setBannerType] = useState<"success" | "warning">("success");
  const [isImporting, setIsImporting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [resetUser, setResetUser] = useState<AdminUser | null>(null);
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  useEffect(() => { loadUsers(); }, []);

  async function loadUsers() {
    setIsLoading(true);
    const response = await fetch("/api/v1/admin/users");
    const body = await readResponseBody(response);
    if (!response.ok) setError(responseError(body, "Unable to load users."));
    else setUsers((body as { users: AdminUser[] }).users);
    setIsLoading(false);
  }

  const filtered = useMemo(() => {
    const needle = search.toLowerCase();
    return users.filter((user) => {
      const matchesSearch = !needle || `${user.name} ${user.email}`.toLowerCase().includes(needle);
      const matchesFilter =
        filter === "all" ||
        (filter === "active" && user.is_active) ||
        (filter === "pending" && user.role === "Pending") ||
        (filter === "leavers" && user.employment_status === "Left");
      return matchesSearch && matchesFilter;
    });
  }, [filter, search, users]);
  const active = users.filter((user) => user.is_active).length;
  const pending = users.filter((user) => user.role === "Pending").length;

  async function onCsvSelected(event: ChangeEvent<HTMLInputElement>, fileType: "active" | "leavers") {
    const file = event.target.files?.[0];
    if (!file) return;
    const rows = parseCsv(await file.text());
    
    let mismatch: "looks-like-leavers" | "looks-like-active" | null = null;
    
    if (fileType === "active") {
      const leaverRowCount = rows.filter(row => {
        const lastWorking = String(row.last_working_date ?? row.end_date ?? "").trim();
        return lastWorking.length > 0;
      }).length;
      if (leaverRowCount > rows.length / 2) {
        mismatch = "looks-like-leavers";
      }
    } else {
      const activeRowCount = rows.filter(row => {
        const lastWorking = String(row.last_working_date ?? "").trim();
        const endDate = String(row.end_date ?? "").trim();
        return lastWorking.length === 0 && endDate.length === 0;
      }).length;
      if (activeRowCount > rows.length / 2) {
        mismatch = "looks-like-active";
      }
    }
    
    setCsvMismatch(mismatch);
    setImportPreview({ rows, fileName: file.name, fileType });
    event.target.value = "";
  }

  async function confirmImport() {
    if (!importPreview) return;
    setIsImporting(true);
    const response = await fetch("/api/v1/admin/users/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        users: importPreview.rows,
        file_type: importPreview.fileType,
      }),
    });
    const body = await readResponseBody(response);
    setIsImporting(false);
    if (!response.ok) {
      setError(responseError(body, "Unable to import users."));
      return;
    }
    const summary = (body as { summary: Record<string, number> }).summary;
    
    const counts = [];
    if (summary.created > 0) counts.push(`${summary.created} created`);
    if (summary.updated > 0) counts.push(`${summary.updated} updated`);
    if (summary.deactivated > 0 && importPreview.fileType === "leavers") {
      counts.push(`${summary.deactivated} deactivated`);
    }
    if (summary.unchanged > 0) counts.push(`${summary.unchanged} unchanged`);
    if (summary.skipped > 0) counts.push(`${summary.skipped} skipped`);
    
    let bannerText = `Import complete:\n• ${counts.join("\n• ")}`;
    if (summary.skipped > 0) {
      bannerText += `\n\n${summary.skipped} rows were skipped because they had neither email nor employee_id. Check your CSV for malformed rows.`;
    }
    
    const hasChanges = (summary.created ?? 0) > 0 || (summary.updated ?? 0) > 0 || (summary.deactivated ?? 0) > 0;
    setBannerType(hasChanges ? "success" : "warning");
    setBanner(bannerText);
    
    setCsvMismatch(null);
    setImportPreview(null);
    window.dispatchEvent(new Event("ia:notifications-refresh"));
    await loadUsers();
  }

  async function saveUser() {
    if (!editingUser) return;
    const nextErrors: Record<string, string> = {};
    if (!editingUser.name?.trim()) nextErrors.name = "Name is required.";
    if (!editingUser.email?.trim()) nextErrors.email = "Email is required.";
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    const isEdit = Boolean(editingUser.id);
    const response = await fetch(isEdit ? `/api/v1/admin/users/${editingUser.id}` : "/api/v1/admin/users", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editingUser),
    });
    const body = await readResponseBody(response);
    if (!response.ok) {
      setError(responseError(body, "Unable to save user."));
      return;
    }
    setEditingUser(null);
    toast.success("User saved.");
    await loadUsers();
  }

  async function resetPassword() {
    if (!resetUser || isResettingPassword) {
      return;
    }

    setIsResettingPassword(true);
    const response = await fetch(`/api/v1/admin/users/${resetUser.id}/reset-password`, {
      method: "POST",
    });
    const body = await readResponseBody(response);
    setIsResettingPassword(false);

    if (!response.ok) {
      toast.error(responseError(body, "Unable to reset password."));
      return;
    }

    toast.success(`Password reset link sent to ${resetUser.email}`);
    setResetUser(null);
    await loadUsers();
  }

  function showHover(user: AdminUser, target: HTMLElement) {
    window.setTimeout(() => {
      const rect = target.getBoundingClientRect();
      setHoverUser({ user, x: rect.left, y: rect.bottom + 8 });
    }, 300);
  }

  return (
    <section className="admin-tab">
      <ErrorBanner message={error} onRetry={loadUsers} />
      {banner ? <div className={bannerType === "success" ? "admin-success-banner" : "admin-warning-banner"} style={{ whiteSpace: "pre-line" }}>{banner}</div> : null}
      <div className="admin-tab-toolbar">
        <strong>{users.length} users · {active} active · {pending} pending access</strong>
      <button className="button button--primary" onClick={() => { setFieldErrors({}); setEditingUser(emptyUser); }} type="button">Add User</button>
      </div>
      <div className="admin-import-card">
        <input hidden ref={activeInputRef} type="file" accept=".csv,text/csv" onChange={(event) => onCsvSelected(event, "active")} />
        <input hidden ref={leaversInputRef} type="file" accept=".csv,text/csv" onChange={(event) => onCsvSelected(event, "leavers")} />
        <button className="button" onClick={() => activeInputRef.current?.click()} type="button">⬆ Import Active Staff</button>
        <button className="button" onClick={() => leaversInputRef.current?.click()} type="button">⬆ Import Leavers</button>
        {importPreview ? (
          <div className="admin-import-preview">
            <span>Ready to import {importPreview.rows.length} users from {importPreview.fileName}</span>
            {csvMismatch === "looks-like-leavers" ? (
              <div style={{ background: "#FEF3C7", border: "1px solid #F59E0B", borderRadius: 6, color: "#92400E", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
                <span>⚠ This file appears to contain leavers (most rows have a last_working_date). Did you mean to click &apos;Import Leavers&apos; instead?</span>
                <button 
                  className="button" 
                  onClick={() => { setImportPreview({ ...importPreview, fileType: "leavers" }); setCsvMismatch(null); }} 
                  type="button"
                  style={{ alignSelf: "flex-start" }}
                >
                  Switch to Leavers Import
                </button>
              </div>
            ) : null}
            {csvMismatch === "looks-like-active" ? (
              <div style={{ background: "#FEF3C7", border: "1px solid #F59E0B", borderRadius: 6, color: "#92400E", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
                <span>⚠ This file appears to contain active employees (most rows have no last_working_date). Did you mean to click &apos;Import Active Staff&apos; instead?</span>
                <button 
                  className="button" 
                  onClick={() => { setImportPreview({ ...importPreview, fileType: "active" }); setCsvMismatch(null); }} 
                  type="button"
                  style={{ alignSelf: "flex-start" }}
                >
                  Switch to Active Import
                </button>
              </div>
            ) : null}
            <button
              className="button button--primary"
              disabled={isImporting}
              onClick={confirmImport}
              type="button"
            >
              {isImporting
                ? `Importing ${importPreview.rows.length} users…`
                : "Confirm Import"}
            </button>
            <button className="button" onClick={() => { setCsvMismatch(null); setImportPreview(null); }} type="button">Cancel</button>
          </div>
        ) : null}
      </div>
      <div className="admin-filters">
        <input placeholder="Search name or email" value={search} onChange={(event) => setSearch(event.target.value)} />
        {(["all", "active", "pending", "leavers"] as Filter[]).map((item) => (
          <button className={filter === item ? "admin-filter active" : "admin-filter"} key={item} onClick={() => setFilter(item)} type="button">{item}</button>
        ))}
      </div>
      <div className="admin-users-table">
        <div className="admin-users-head"><span>User</span><span>Role</span><span>Internal Auditor</span><span>Department</span><span>Admin</span><span>Status</span><span>Actions</span></div>
        {isLoading ? <LoadingRows /> : filtered.map((user) => (
          <div className="admin-users-row" key={user.id}>
            <span className="admin-user-cell" onMouseEnter={(event) => showHover(user, event.currentTarget)} onMouseLeave={() => setHoverUser(null)}>
              <i>{getInitials(user.name)}</i><span><strong>{user.name}</strong><em>{user.email}</em></span>
            </span>
            <RoleBadge role={user.role} />
            <span>{user.is_internal_auditor ? "✓" : "—"}</span>
            <span>{user.department ?? "—"}</span>
            <span>{user.is_admin ? "🛡" : "—"}</span>
            <span className={user.is_active ? "admin-status admin-status--active" : "admin-status admin-status--inactive"}>{user.is_active ? "Active" : user.employment_status === "Left" ? `Left ${user.last_working_date ?? ""}` : "Inactive"}</span>
            <button className="admin-icon-button" onClick={() => { setFieldErrors({}); setEditingUser(user); }} type="button">✎</button>
          </div>
        ))}
        {!isLoading && filtered.length === 0 ? (
          <EmptyState title="No users found" subtitle="Try a different search or filter." />
        ) : null}
      </div>
      {hoverUser ? <UserHoverCard user={hoverUser.user} x={hoverUser.x} y={hoverUser.y} /> : null}
      {editingUser ? (
        <UserEditor
          errors={fieldErrors}
          user={editingUser}
          setUser={(nextUser) => {
            setEditingUser(nextUser);
            setFieldErrors((current) => ({
              ...current,
              name: nextUser.name?.trim() ? "" : current.name,
              email: nextUser.email?.trim() ? "" : current.email,
            }));
          }}
          onClose={() => setEditingUser(null)}
          onResetPassword={() => {
            if (editingUser.id) {
              setResetUser(editingUser as AdminUser);
            }
          }}
          onSave={saveUser}
        />
      ) : null}
      <ConfirmDialog
        cancelLabel="Cancel"
        confirmLabel="Confirm"
        isOpen={Boolean(resetUser)}
        message={
          resetUser
            ? `This will send ${resetUser.name} a password reset link and invalidate their current password. Continue?`
            : ""
        }
        onCancel={() => {
          if (!isResettingPassword) {
            setResetUser(null);
          }
        }}
        onConfirm={resetPassword}
        title="Reset password"
      />
    </section>
  );
}

function UserHoverCard({ user, x, y }: { user: AdminUser; x: number; y: number }) {
  return <div className="admin-hover-card" style={{ left: x, top: y }}>
    <strong>{user.job_title ?? "No title"}</strong>
    <span>{user.department ?? "No department"} · {user.company ?? "No company"}</span>
    <span>{user.location ?? "No location"}</span>
    <span>Manager: {user.manager_name ?? "Not set"}</span>
    <span><i className={user.is_active ? "dot green" : "dot red"} />{user.employment_status ?? (user.is_active ? "Active" : "Inactive")}</span>
  </div>;
}

function UserEditor({
  user,
  setUser,
  onClose,
  onSave,
  onResetPassword,
  errors,
}: {
  user: Partial<AdminUser>;
  setUser: (user: Partial<AdminUser>) => void;
  onClose: () => void;
  onSave: () => void;
  onResetPassword: () => void;
  errors: Record<string, string>;
}) {
  return (
    <SlideOver title={user.id ? "Edit User" : "Add User"} onClose={onClose}>
      <div className="admin-form">
        <input className={errors.name ? "input-error" : undefined} placeholder="Name" value={user.name ?? ""} onChange={(e) => setUser({ ...user, name: e.target.value })} />
        {errors.name ? <span className="field-error">{errors.name}</span> : null}
        <input className={errors.email ? "input-error" : undefined} placeholder="Email" value={user.email ?? ""} onChange={(e) => setUser({ ...user, email: e.target.value })} />
        {errors.email ? <span className="field-error">{errors.email}</span> : null}
        <select value={user.role ?? "Pending"} onChange={(e) => setUser({ ...user, role: e.target.value as AdminUser["role"] })}>
          <option value="AuditTeam">Audit Team — manage audit records</option>
          <option value="Viewer">Viewer — read-only access</option>
          <option value="Auditee">Auditee — assigned action plans</option>
          <option value="Pending">Pending — no access yet</option>
        </select>
        <label><input checked={Boolean(user.is_internal_auditor)} type="checkbox" onChange={(e) => setUser({ ...user, is_internal_auditor: e.target.checked })} /> Internal Auditor</label>
        <label><input checked={Boolean(user.is_admin)} type="checkbox" onChange={(e) => setUser({ ...user, is_admin: e.target.checked })} /> Admin <em>Grants full system admin access</em></label>
        {user.id ? <label><input checked={user.is_active !== false} type="checkbox" onChange={(e) => setUser({ ...user, is_active: e.target.checked })} /> Active</label> : null}
        {["department", "job_title", "team_l1", "team_l2", "team_l3", "company", "location", "manager_name", "manager_email"].map((field) => (
          <input key={field} placeholder={field} value={String(user[field as keyof AdminUser] ?? "")} onChange={(e) => setUser({ ...user, [field]: e.target.value })} />
        ))}
        {user.id ? (
          <button className="button" onClick={onResetPassword} type="button">
            Reset password
          </button>
        ) : null}
        <button className="button button--primary" onClick={onSave} type="button">Save</button>
      </div>
    </SlideOver>
  );
}
