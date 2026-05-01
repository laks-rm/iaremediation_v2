"use client";

import { useEffect, useState } from "react";

import { useToast } from "../../../components/Toast";
import { ErrorBanner, LoadingRows, readResponseBody, responseError } from "./admin-tab-utils";

const COLORS = ["#dc2626", "#2563eb", "#16a34a", "#d97706", "#7c3aed", "#64748b"];

export function useAdminConfig<T>(key: string, fallback: T) {
  const toast = useToast();
  const [value, setValue] = useState<T>(fallback);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastSaved, setLastSaved] = useState("");

  async function load() {
    setIsLoading(true);
    const response = await fetch(`/api/v1/admin/config?key=${encodeURIComponent(key)}`);
    const body = await readResponseBody(response);
    if (!response.ok) setError(responseError(body, "Unable to load configuration."));
    else setValue(((body as { config?: { value?: T } }).config?.value ?? fallback) as T);
    setIsLoading(false);
  }

  async function save(nextValue = value) {
    const response = await fetch("/api/v1/admin/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value: nextValue }),
    });
    const body = await readResponseBody(response);
    if (!response.ok) setError(responseError(body, "Unable to save configuration."));
    else {
      setLastSaved(new Date().toLocaleString());
      toast.success("Configuration saved.");
    }
  }

  useEffect(() => { load(); }, [key]);
  return { value, setValue, isLoading, error, load, save, lastSaved };
}

export default function RolesPermissionsTab() {
  const fallback = {
    ActionPlans: { edit: { AuditTeam: true, Auditee: true }, uploadEvidence: { AuditTeam: true, Auditee: true } },
    AuditFindings: { create: { AuditTeam: true, Auditee: false }, edit: { AuditTeam: true, Auditee: false } },
    Administration: { manageUsers: { AuditTeam: false, Auditee: false }, configureSystem: { AuditTeam: false, Auditee: false } },
  };
  const { value, setValue, isLoading, error, load, save, lastSaved } = useAdminConfig("role_permissions", fallback);
  const [dirty, setDirty] = useState(false);
  if (isLoading) return <LoadingRows />;
  return <section className="admin-tab"><ErrorBanner message={error} onRetry={load} /><div className="admin-permission-table">
    <div><span>Permission</span><span>AuditTeam</span><span>Auditee</span></div>
    {Object.entries(value).map(([section, permissions]) => (
      <div className="admin-permission-section" key={section}>
        <strong>{section}</strong>
        {Object.entries(permissions as Record<string, Record<string, boolean>>).map(([permission, roles]) => (
          <div key={permission}><span>{permission}</span>{(["AuditTeam", "Auditee"] as const).map((role) => <button className="admin-switch" data-on={roles[role]} key={role} onClick={() => { setValue({ ...value, [section]: { ...(value as any)[section], [permission]: { ...roles, [role]: !roles[role] } } }); setDirty(true); }} type="button" />)}</div>
        ))}
      </div>
    ))}
  </div><button className="button button--primary" disabled={!dirty} onClick={() => { save(); setDirty(false); }} type="button">Save Changes</button><footer>Last saved: {lastSaved || "Not saved this session"}</footer></section>;
}

export function AuditTypesTab() {
  const enums = ["IT", "RegulatoryIT", "Operations", "RegulatoryOperations", "External"];
  const fallback = Object.fromEntries(enums.map((item, index) => [item, { label: item, description: "", color: COLORS[index] }]));
  const { value, setValue, isLoading, error, load, save } = useAdminConfig("audit_type_config", fallback);
  if (isLoading) return <LoadingRows />;
  return <ConfigCards title="Audit Types" enums={enums} value={value} setValue={setValue} error={error} onRetry={load} onSave={save} note="Schema-controlled values cannot be renamed; labels and descriptions only affect display." />;
}

export function AuditRatingsTab() {
  const fallback = {
    opinions: Object.fromEntries(["Satisfactory", "NeedsImprovement", "Unsatisfactory"].map((item, index) => [item, { label: item, description: "", color: COLORS[index] }])),
    statuses: Object.fromEntries(["NotStarted", "InProgress", "PendingValidation", "Closed", "RiskAccepted", "Dropped"].map((item, index) => [item, { label: item, description: "", color: COLORS[index % COLORS.length] }])),
  };
  const { value, setValue, isLoading, error, load, save } = useAdminConfig("audit_ratings_config", fallback);
  if (isLoading) return <LoadingRows />;
  return <section className="admin-tab"><ErrorBanner message={error} onRetry={load} /><div className="admin-two-panels"><ConfigCards title="Audit Opinion Rating" enums={Object.keys(value.opinions)} value={value.opinions} setValue={(opinions) => setValue({ ...value, opinions })} /><ConfigCards title="Action Plan Status Labels" enums={Object.keys(value.statuses)} value={value.statuses} setValue={(statuses) => setValue({ ...value, statuses })} /></div><button className="button button--primary" onClick={() => save()} type="button">Save Configuration</button></section>;
}

export function ControlEffectivenessTab() {
  const enums = ["Effective", "PartiallyEffective", "NotEffective"];
  const fallback = Object.fromEntries(enums.map((item, index) => [item, { label: item, description: "", criteria: "", color: COLORS[index] }]));
  const { value, setValue, isLoading, error, load, save } = useAdminConfig("control_effectiveness_config", fallback);
  if (isLoading) return <LoadingRows />;
  return <section className="admin-tab"><ErrorBanner message={error} onRetry={load} /><ConfigCards title="Control Effectiveness" enums={enums} value={value} setValue={setValue} showCriteria /><div className="admin-methodology"><h3>Methodology Reference</h3>{Object.entries(value).map(([key, config]: any) => <p key={key}><strong>{config.label}</strong>: {config.criteria || config.description || "No criteria defined."}</p>)}</div><button className="button button--primary" onClick={() => save()} type="button">Save Configuration</button></section>;
}

function ConfigCards({ title, enums, value, setValue, error = "", onRetry = () => undefined, onSave, note, showCriteria = false }: any) {
  return <section className="admin-tab"><ErrorBanner message={error} onRetry={onRetry} /><h2>{title}</h2><div className="admin-config-grid">{enums.map((item: string) => <article className="admin-config-card" key={item}><div className="admin-color-pickers">{COLORS.map((color) => <button aria-label={color} key={color} style={{ background: color }} className={value[item]?.color === color ? "active" : ""} onClick={() => setValue({ ...value, [item]: { ...value[item], color } })} type="button" />)}</div><code>{item}</code><input value={value[item]?.label ?? ""} onChange={(e) => setValue({ ...value, [item]: { ...value[item], label: e.target.value } })} /><textarea value={value[item]?.description ?? ""} onChange={(e) => setValue({ ...value, [item]: { ...value[item], description: e.target.value } })} />{showCriteria ? <textarea placeholder="Assessment criteria" value={value[item]?.criteria ?? ""} onChange={(e) => setValue({ ...value, [item]: { ...value[item], criteria: e.target.value } })} /> : null}</article>)}</div>{note ? <p className="admin-note">{note}</p> : null}{onSave ? <button className="button button--primary" onClick={() => onSave()} type="button">Save Configuration</button> : null}</section>;
}
