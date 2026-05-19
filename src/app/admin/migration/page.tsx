"use client";

import { getSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import AppLayout from "../../../components/AppLayout";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EntityEntry = { entity: { code: string } };

type ApResult = {
  id: string;
  display_id: string;
  title: string | null;
  description: string;
  status: string;
  finding: {
    id: string;
    title: string;
    audit: { id: string; name: string } | null;
  } | null;
  action_plan_entities: EntityEntry[];
};

type FindingResult = {
  id: string;
  title: string;
  audit_id: string | null;
  audit_name: string | null;
};

// ---------------------------------------------------------------------------
// Shared search-box components
// ---------------------------------------------------------------------------

type ApSearchBoxProps = {
  label: string;
  onSelect: (ap: ApResult) => void;
  excludeIds?: string[];
  includeMultiEntityOnly?: boolean;
};

function ApSearchBox({ label, onSelect, excludeIds = [], includeMultiEntityOnly = false }: ApSearchBoxProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ApResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const search = useCallback(
    (q: string) => {
      setLoading(true);
      const params = new URLSearchParams({ q });
      if (includeMultiEntityOnly) params.set("multi_entity_only", "true");
      fetch(`/api/v1/admin/migration/search-aps?${params}`)
        .then((r) => {
          if (!r.ok) return r.text().then((t) => Promise.reject(new Error(t)));
          return r.json();
        })
        .then((data: { action_plans: ApResult[] }) => {
          const filtered = excludeIds.length
            ? data.action_plans.filter((ap) => !excludeIds.includes(ap.id))
            : data.action_plans;
          setResults(filtered);
          setOpen(filtered.length > 0);
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [includeMultiEntityOnly, excludeIds.join(",")],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val), 300);
  };

  const handleSelect = (ap: ApResult) => {
    setQuery("");
    setResults([]);
    setOpen(false);
    onSelect(ap);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const entityCodes = (ap: ApResult) =>
    ap.action_plan_entities.map((e) => e.entity.code).join(", ");

  return (
    <div className="migration-search-box" ref={wrapperRef}>
      <label className="migration-label">{label}</label>
      <input
        className="migration-input"
        value={query}
        onChange={handleChange}
        placeholder={loading ? "Searching…" : "Type to search…"}
        autoComplete="off"
      />
      {open && results.length > 0 && (
        <div className="migration-dropdown">
          {results.map((ap) => (
            <div
              key={ap.id}
              className="migration-dropdown-item"
              onMouseDown={() => handleSelect(ap)}
            >
              <div className="migration-ap-id">{ap.display_id}</div>
              <div className="migration-ap-desc">
                {ap.title || ap.description.slice(0, 80)}
              </div>
              <div className="migration-ap-meta">
                {ap.finding?.audit?.name ?? "—"} · {entityCodes(ap) || "no entities"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type FindingSearchBoxProps = {
  label: string;
  onSelect: (f: FindingResult) => void;
};

function FindingSearchBox({ label, onSelect }: FindingSearchBoxProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FindingResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const search = useCallback((q: string) => {
    setLoading(true);
    fetch(`/api/v1/admin/migration/search-findings?q=${encodeURIComponent(q)}`)
      .then((r) => {
        if (!r.ok) return r.text().then((t) => Promise.reject(new Error(t)));
        return r.json();
      })
      .then((data: { findings: FindingResult[] }) => {
        setResults(data.findings);
        setOpen(data.findings.length > 0);
      })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val), 300);
  };

  const handleSelect = (f: FindingResult) => {
    setQuery("");
    setResults([]);
    setOpen(false);
    onSelect(f);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="migration-search-box" ref={wrapperRef}>
      <label className="migration-label">{label}</label>
      <input
        className="migration-input"
        value={query}
        onChange={handleChange}
        placeholder={loading ? "Searching…" : "Type to search…"}
        autoComplete="off"
      />
      {open && results.length > 0 && (
        <div className="migration-dropdown">
          {results.map((f) => (
            <div
              key={f.id}
              className="migration-dropdown-item"
              onMouseDown={() => handleSelect(f)}
            >
              <div className="migration-ap-desc">{f.title}</div>
              <div className="migration-ap-meta">{f.audit_name ?? "—"}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Re-home Tool
// ---------------------------------------------------------------------------

type RehomeStep = "select-ap" | "select-finding" | "preview" | "done";

function RehomeTool() {
  const [step, setStep] = useState<RehomeStep>("select-ap");
  const [ap, setAp] = useState<ApResult | null>(null);
  const [targetFinding, setTargetFinding] = useState<FindingResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; display_id?: string; error?: string } | null>(null);

  const reset = () => {
    setStep("select-ap");
    setAp(null);
    setTargetFinding(null);
    setResult(null);
    setSubmitting(false);
  };

  const handleApSelect = (selected: ApResult) => {
    setAp(selected);
    setStep("select-finding");
  };

  const handleFindingSelect = (f: FindingResult) => {
    setTargetFinding(f);
    setStep("preview");
  };

  const execute = async () => {
    if (!ap || !targetFinding) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/admin/migration/rehome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action_plan_id: ap.id, target_finding_id: targetFinding.id }),
      });
      const body = await res.json() as { ok?: boolean; display_id?: string; error?: string };
      if (!res.ok) {
        setResult({ ok: false, error: body.error ?? "Unknown error" });
      } else {
        setResult({ ok: true, display_id: body.display_id });
        setStep("done");
      }
    } catch {
      setResult({ ok: false, error: "Network error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="migration-tool-header">
        <h2>Re-home AP</h2>
        <p>Move an action plan from its current finding to a different finding.</p>
      </div>

      <div className="migration-form">
        {/* Step 1 */}
        <div className="migration-step">
          <div className="migration-step-num">1</div>
          <div className="migration-step-body">
            {ap === null ? (
              <ApSearchBox label="Search for action plan" onSelect={handleApSelect} />
            ) : (
              <div>
                <div className="migration-label">Selected action plan</div>
                <div className="migration-selected-card">
                  <button className="migration-clear" onClick={() => { setAp(null); setTargetFinding(null); setStep("select-ap"); setResult(null); }} aria-label="Clear">×</button>
                  <div className="migration-selected-id">{ap.display_id}</div>
                  <div className="migration-selected-desc">{ap.title || ap.description.slice(0, 100)}</div>
                  <div className="migration-selected-meta">
                    Finding: {ap.finding?.title ?? "—"} · Audit: {ap.finding?.audit?.name ?? "—"}
                  </div>
                  <div className="migration-selected-meta" style={{ marginTop: 2 }}>
                    Entities: {ap.action_plan_entities.map((e) => e.entity.code).join(", ") || "none"}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Step 2 */}
        {ap !== null && step !== "select-ap" && (
          <div className="migration-step">
            <div className="migration-step-num">2</div>
            <div className="migration-step-body">
              {targetFinding === null ? (
                <FindingSearchBox label="Search for target finding" onSelect={handleFindingSelect} />
              ) : (
                <div>
                  <div className="migration-label">Target finding</div>
                  <div className="migration-selected-card migration-selected-card--target">
                    <button className="migration-clear" onClick={() => { setTargetFinding(null); setStep("select-finding"); setResult(null); }} aria-label="Clear">×</button>
                    <div className="migration-selected-desc">{targetFinding.title}</div>
                    <div className="migration-selected-meta">{targetFinding.audit_name ?? "—"}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 3 */}
        {step === "preview" && ap && targetFinding && (
          <div className="migration-step">
            <div className="migration-step-num">3</div>
            <div className="migration-step-body">
              <div className="migration-preview" style={{ marginBottom: 14 }}>
                <div className="migration-preview-title">Preview</div>
                <div className="migration-preview-row">
                  <span style={{ fontWeight: 600, minWidth: 60 }}>AP</span>
                  <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11 }}>{ap.display_id}</span>
                </div>
                <div className="migration-preview-row">
                  <span style={{ fontWeight: 600, minWidth: 60 }}>From</span>
                  <span>{ap.finding?.title ?? "—"} ({ap.finding?.audit?.name ?? "—"})</span>
                </div>
                <div className="migration-preview-row migration-preview-row--highlight">
                  <span style={{ fontWeight: 600, minWidth: 60 }}>To</span>
                  <span>{targetFinding.title} ({targetFinding.audit_name ?? "—"})</span>
                </div>
                <div className="migration-preview-note">
                  This is a direct database update. The AP display_id, entities, owners, evidence, and comments are not changed.
                </div>
              </div>

              {result && !result.ok && (
                <div className="migration-result migration-result--err" style={{ marginBottom: 12 }}>
                  {result.error}
                </div>
              )}

              <button
                className="btn btn--primary"
                onClick={execute}
                disabled={submitting}
              >
                {submitting ? "Executing…" : "Execute Re-home"}
              </button>
            </div>
          </div>
        )}

        {/* Done */}
        {step === "done" && result?.ok && (
          <div className="migration-step">
            <div className="migration-step-num">✓</div>
            <div className="migration-step-body">
              <div className="migration-result migration-result--ok" style={{ marginBottom: 12 }}>
                Successfully re-homed <strong>{result.display_id}</strong> to &ldquo;{targetFinding?.title}&rdquo;.
              </div>
              <button className="btn btn--secondary" onClick={reset}>Start over</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Split Tool
// ---------------------------------------------------------------------------

type MirrorRole = "primary" | "mirror";

type EntityMapping = {
  entity_code: string;
  entity_id: string;
  role: MirrorRole;
  targetFinding: FindingResult | null;
};

type SplitStep = "select-ap" | "map-entities" | "preview" | "done";

function SplitTool() {
  const [step, setStep] = useState<SplitStep>("select-ap");
  const [ap, setAp] = useState<ApResult | null>(null);
  const [mappings, setMappings] = useState<EntityMapping[]>([]);
  const [primaryFinding, setPrimaryFinding] = useState<FindingResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; created_display_ids?: string[]; error?: string } | null>(null);

  const reset = () => {
    setStep("select-ap");
    setAp(null);
    setMappings([]);
    setPrimaryFinding(null);
    setResult(null);
    setSubmitting(false);
  };

  const handleApSelect = (selected: ApResult) => {
    setAp(selected);
    setPrimaryFinding(null);
    const initial: EntityMapping[] = selected.action_plan_entities.map((e, i) => ({
      entity_code: e.entity.code,
      entity_id: "",
      role: i === 0 ? "primary" : "mirror",
      targetFinding: null,
    }));
    setMappings(initial);
    setStep("map-entities");
  };

  const setRole = (code: string, role: MirrorRole) => {
    setMappings((prev) => {
      if (role === "primary") {
        // Only one primary at a time
        return prev.map((m) =>
          m.entity_code === code
            ? { ...m, role: "primary" }
            : m.role === "primary"
              ? { ...m, role: "mirror" }
              : m,
        );
      }
      return prev.map((m) => (m.entity_code === code ? { ...m, role: "mirror" } : m));
    });
  };

  const setFinding = (code: string, f: FindingResult) => {
    setMappings((prev) =>
      prev.map((m) => (m.entity_code === code ? { ...m, targetFinding: f } : m)),
    );
  };

  const clearFinding = (code: string) => {
    setMappings((prev) =>
      prev.map((m) => (m.entity_code === code ? { ...m, targetFinding: null } : m)),
    );
  };

  const mirrorMappings = mappings.filter((m) => m.role === "mirror");
  const allMirrorsHaveFindings = mirrorMappings.length > 0 && mirrorMappings.every((m) => m.targetFinding !== null);

  const execute = async () => {
    if (!ap || !allMirrorsHaveFindings) return;
    setSubmitting(true);
    try {
      const mirrorsPayload = mirrorMappings.map((m) => ({
        entity_code: m.entity_code,
        finding_id: m.targetFinding!.id,
      }));
      const res = await fetch("/api/v1/admin/migration/split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action_plan_id: ap.id,
          mirrors: mirrorsPayload,
          primary_finding_id: primaryFinding?.id ?? null,
        }),
      });
      const body = await res.json() as { ok?: boolean; created_display_ids?: string[]; error?: string };
      if (!res.ok) {
        setResult({ ok: false, error: body.error ?? "Unknown error" });
      } else {
        setResult({ ok: true, created_display_ids: body.created_display_ids });
        setStep("done");
      }
    } catch {
      setResult({ ok: false, error: "Network error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="migration-tool-header">
        <h2>Split AP to Mirrors</h2>
        <p>Split a multi-entity AP into separate mirror APs, one per entity.</p>
      </div>

      <div className="migration-form">
        {/* Step 1 */}
        <div className="migration-step">
          <div className="migration-step-num">1</div>
          <div className="migration-step-body">
            {ap === null ? (
              <ApSearchBox
                label="Search for multi-entity action plan"
                onSelect={handleApSelect}
                includeMultiEntityOnly
              />
            ) : (
              <div>
                <div className="migration-label">Selected action plan</div>
                <div className="migration-selected-card">
                  <button className="migration-clear" onClick={reset} aria-label="Clear">×</button>
                  <div className="migration-selected-id">{ap.display_id}</div>
                  <div className="migration-selected-desc">{ap.title || ap.description.slice(0, 100)}</div>
                  <div className="migration-selected-meta">
                    Finding: {ap.finding?.title ?? "—"} · Audit: {ap.finding?.audit?.name ?? "—"}
                  </div>
                  <div className="migration-selected-meta" style={{ marginTop: 2 }}>
                    Entities: {ap.action_plan_entities.map((e) => e.entity.code).join(", ")}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Step 2: Entity mapping */}
        {step !== "select-ap" && ap !== null && step !== "done" && (
          <div className="migration-step">
            <div className="migration-step-num">2</div>
            <div className="migration-step-body">
              <div className="migration-label">Assign roles to entities</div>
              <div className="migration-hint" style={{ marginBottom: 10 }}>
                One entity must stay as Primary. All others become Mirror APs — each needs a target finding.
              </div>
              <div className="migration-entity-rows">
                {mappings.map((m) => (
                  <div key={m.entity_code} className="migration-entity-row">
                    <div className="migration-entity-left">
                      <span style={{
                        display: "inline-block",
                        fontFamily: "JetBrains Mono, monospace",
                        fontSize: 12,
                        fontWeight: 700,
                        background: "var(--surface2)",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        padding: "2px 8px",
                        color: "var(--text)",
                      }}>
                        {m.entity_code}
                      </span>
                      <div className="migration-role-toggle">
                        <button
                          className={`migration-role-btn ${m.role === "primary" ? "migration-role-btn--active" : ""}`}
                          onClick={() => setRole(m.entity_code, "primary")}
                        >
                          Primary
                        </button>
                        <button
                          className={`migration-role-btn migration-role-btn--mirror ${m.role === "mirror" ? "migration-role-btn--active" : ""}`}
                          onClick={() => setRole(m.entity_code, "mirror")}
                        >
                          Mirror
                        </button>
                      </div>
                    </div>
                    <div className="migration-entity-right">
                      {m.role === "primary" && primaryFinding === null && (
                        <FindingSearchBox
                          label="Re-home primary to a different finding (optional)"
                          onSelect={(f) => setPrimaryFinding(f)}
                        />
                      )}
                      {m.role === "primary" && primaryFinding !== null && (
                        <div className="migration-selected-card migration-selected-card--target migration-selected-card--inline">
                          <button className="migration-clear" onClick={() => setPrimaryFinding(null)} aria-label="Clear">×</button>
                          <div className="migration-selected-desc" style={{ fontSize: 12 }}>{primaryFinding.title}</div>
                          <div className="migration-selected-meta">{primaryFinding.audit_name ?? "—"}</div>
                        </div>
                      )}
                      {m.role === "mirror" && m.targetFinding === null && (
                        <FindingSearchBox
                          label="Target finding for mirror"
                          onSelect={(f) => setFinding(m.entity_code, f)}
                        />
                      )}
                      {m.role === "mirror" && m.targetFinding !== null && (
                        <div className="migration-selected-card migration-selected-card--target migration-selected-card--inline">
                          <button className="migration-clear" onClick={() => clearFinding(m.entity_code)} aria-label="Clear">×</button>
                          <div className="migration-selected-desc" style={{ fontSize: 12 }}>{m.targetFinding.title}</div>
                          <div className="migration-selected-meta">{m.targetFinding.audit_name ?? "—"}</div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {allMirrorsHaveFindings && step === "map-entities" && (
                <button
                  className="btn btn--primary"
                  style={{ marginTop: 16 }}
                  onClick={() => setStep("preview")}
                >
                  Review &amp; Execute
                </button>
              )}
            </div>
          </div>
        )}

        {/* Step 3: Preview */}
        {step === "preview" && ap && (
          <div className="migration-step">
            <div className="migration-step-num">3</div>
            <div className="migration-step-body">
              <div className="migration-preview" style={{ marginBottom: 14 }}>
                <div className="migration-preview-title">Split preview</div>
                <div className={`migration-preview-row${primaryFinding ? " migration-preview-row--highlight" : ""}`}>
                  <span style={{ fontWeight: 600, minWidth: 80 }}>Primary AP</span>
                  <span>
                    <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11 }}>{ap.display_id}</span>
                    {" "}— {mappings.filter((m) => m.role === "primary").map((m) => m.entity_code).join(", ")}
                    {" "}
                    {primaryFinding
                      ? <>→ Re-homed to {primaryFinding.title} ({primaryFinding.audit_name ?? "—"})</>
                      : <>→ Stays under current finding ({ap.finding?.title ?? "—"})</>}
                  </span>
                </div>
                {mirrorMappings.map((m) => (
                  <div key={m.entity_code} className="migration-preview-row migration-preview-row--highlight">
                    <span style={{ fontWeight: 600, minWidth: 80 }}>New mirror</span>
                    <span>
                      entity <strong>{m.entity_code}</strong> → {m.targetFinding?.title} ({m.targetFinding?.audit_name ?? "—"})
                    </span>
                  </div>
                ))}
                <div className="migration-preview-note">
                  Owners, follow-up auditors, evidence, and comments are NOT copied to mirror APs. Mirrors must be staffed manually after creation.
                </div>
              </div>

              {result && !result.ok && (
                <div className="migration-result migration-result--err" style={{ marginBottom: 12 }}>
                  {result.error}
                </div>
              )}

              <div style={{ display: "flex", gap: 10 }}>
                <button
                  className="btn btn--secondary"
                  onClick={() => setStep("map-entities")}
                  disabled={submitting}
                >
                  Back
                </button>
                <button
                  className="btn btn--primary"
                  onClick={execute}
                  disabled={submitting}
                >
                  {submitting
                    ? "Creating…"
                    : `Execute Split (creates ${mirrorMappings.length} mirror AP${mirrorMappings.length !== 1 ? "s" : ""})`}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Done */}
        {step === "done" && result?.ok && (
          <div className="migration-step">
            <div className="migration-step-num">✓</div>
            <div className="migration-step-body">
              <div className="migration-result migration-result--ok" style={{ marginBottom: 12 }}>
                <div style={{ marginBottom: 4 }}>
                  Split complete. {result.created_display_ids?.length ?? 0} mirror AP{(result.created_display_ids?.length ?? 0) !== 1 ? "s" : ""} created:
                </div>
                <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}>
                  {result.created_display_ids?.join(", ")}
                </div>
              </div>
              <button className="btn btn--secondary" onClick={reset}>Split another AP</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type ActiveTool = "rehome" | "split";

export default function MigrationPage() {
  const router = useRouter();
  const [isChecking, setIsChecking] = useState(true);
  const [activeTool, setActiveTool] = useState<ActiveTool>("rehome");

  useEffect(() => {
    getSession().then((session) => {
      if (!session?.user?.is_admin) {
        router.replace("/dashboard");
        return;
      }
      setIsChecking(false);
    });
  }, [router]);

  if (isChecking) {
    return (
      <AppLayout>
        <div className="admin-page">
          <div className="audits-empty">Checking admin access…</div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="admin-page">
        <header className="admin-header">
          <div>
            <p>
              <a href="/admin" style={{ color: "var(--text3)", textDecoration: "none" }}>Admin</a>
              {" › "}
              <span>Migration Support</span>
            </p>
            <h1>Migration Support</h1>
            <span>One-time data cleanup tools for re-homing and splitting action plans.</span>
          </div>
        </header>

        <nav className="admin-tabs" aria-label="Migration tools">
          <button
            className={activeTool === "rehome" ? "admin-tab-link admin-tab-link--active" : "admin-tab-link"}
            onClick={() => setActiveTool("rehome")}
            style={{ border: "none", cursor: "pointer", background: "none" }}
          >
            Re-home AP
          </button>
          <button
            className={activeTool === "split" ? "admin-tab-link admin-tab-link--active" : "admin-tab-link"}
            onClick={() => setActiveTool("split")}
            style={{ border: "none", cursor: "pointer", background: "none" }}
          >
            Split AP to Mirrors
          </button>
        </nav>

        <div style={{ padding: "28px 32px" }}>
          {activeTool === "rehome" ? <RehomeTool /> : <SplitTool />}
        </div>
      </div>
    </AppLayout>
  );
}
