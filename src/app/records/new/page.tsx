"use client";

import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { ChangeEvent, DragEvent, Suspense, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import AppLayout from "../../../components/AppLayout";
import EntityMultiSelect from "../../../components/EntityMultiSelect";
import { AUDIT_TYPE_LABELS } from "../../../lib/constants";

type Mode = "newAudit" | "existingAudit" | "standalone";
type EntryMethod = "manual" | "ai";
type Priority = "High" | "Moderate" | "Low";
type ControlRating = "Effective" | "PartiallyEffective" | "NotEffective";
type AuditType = keyof typeof AUDIT_TYPE_LABELS;
type OpinionRating = "Satisfactory" | "NeedsImprovement" | "Unsatisfactory";
type CreatedVia = "Manual" | "Standalone";
type FindingType = "Finding" | "OpportunityForImprovement";

type EntityOption = {
  id: string;
  code: string;
  full_name: string;
};

type UserOption = {
  id: string;
  name: string;
  email: string;
  department: string | null;
  job_title: string | null;
  team_l2: string | null;
  is_internal_auditor: boolean;
};

type AuditOption = {
  id: string;
  name: string;
  reference_number: string | null;
  audit_type: AuditType;
  report_issue_date: string | null;
  audit_entities: {
    entity: EntityOption;
  }[];
};

type FindingOption = {
  id: string;
  audit_id: string | null;
  is_standalone: boolean;
  external_ref: string | null;
  title: string;
  description: string | null;
  root_cause: string | null;
  recommendation: string | null;
  priority: Priority | null;
  control_rating: ControlRating | null;
  finding_type?: FindingType | null;
};

type FindingDraft = {
  id: string;
  external_ref: string;
  title: string;
  description: string;
  root_cause: string;
  recommendation: string;
  priority: Priority;
  control_rating: ControlRating;
  finding_type: FindingType;
  collapsed: boolean;
};

type ActionPlanDraft = {
  id: string;
  description: string;
  priority: Priority;
  original_target_date: string;
  current_target_date: string;
  required_evidence: string;
  entity_ids: string[];
  owner_user_id: string;
  follow_up_auditor_user_id: string;
};

type AuditDraft = {
  name: string;
  reference_number: string;
  audit_type: AuditType;
  opinion_rating: OpinionRating;
  report_issue_date: string;
  executive_summary: string;
  entity_ids: string[];
};

type OptionsPayload = {
  entities: EntityOption[];
  users: UserOption[];
  follow_up_auditors: UserOption[];
};

const MODE_CONFIG: Record<Mode, { icon: string; title: string; subtitle: string }> = {
  newAudit: {
    icon: "▣",
    title: "New Audit Report",
    subtitle: "Create an audit with multiple findings and action plans.",
  },
  existingAudit: {
    icon: "+",
    title: "Add to Existing Audit",
    subtitle: "Pick an audit, choose or create a finding, then add action plans.",
  },
  standalone: {
    icon: "!",
    title: "Standalone Finding",
    subtitle: "Create a finding and action plans without linking an audit report.",
  },
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
const PRIORITIES: Priority[] = ["High", "Moderate", "Low"];
const CONTROL_RATINGS: ControlRating[] = [
  "Effective",
  "PartiallyEffective",
  "NotEffective",
];
const FINDING_TYPES: FindingType[] = ["Finding", "OpportunityForImprovement"];

const emptyAudit: AuditDraft = {
  name: "",
  reference_number: "",
  audit_type: "IT",
  opinion_rating: "Satisfactory",
  report_issue_date: "",
  executive_summary: "",
  entity_ids: [],
};

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function newFindingDraft(): FindingDraft {
  return {
    id: makeId("finding"),
    external_ref: "",
    title: "",
    description: "",
    root_cause: "",
    recommendation: "",
    priority: "Moderate",
    control_rating: "PartiallyEffective",
    finding_type: "Finding",
    collapsed: false,
  };
}

function newActionPlanDraft(entityIds: string[] = []): ActionPlanDraft {
  return {
    id: makeId("ap"),
    description: "",
    priority: "Moderate",
    original_target_date: "",
    current_target_date: "",
    required_evidence: "",
    entity_ids: [...entityIds],
    owner_user_id: "",
    follow_up_auditor_user_id: "",
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
  return typeof body === "object" && body && "error" in body ? String(body.error) : fallback;
}

function formatFileSize(size: number) {
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function entityCodes(entities: EntityOption[], ids: string[]) {
  return entities
    .filter((entity) => ids.includes(entity.id))
    .map((entity) => entity.code)
    .join(", ");
}

function userInfoText(user: UserOption | undefined, fields: Array<keyof Pick<UserOption, "job_title" | "department" | "team_l2">>) {
  const parts = fields.map((field) => user?.[field]).filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "No department info available";
}

function getStepTitle(mode: Mode | null, step: number) {
  if (!mode) {
    return "Choose Mode";
  }

  const titles: Record<Mode, string[]> = {
    newAudit: [
      "Audit Details",
      "PDF Upload",
      "Findings",
      "Action Plans",
      "Review",
    ],
    existingAudit: ["Select Audit", "Action Plans", "Review"],
    standalone: ["Finding Details", "Action Plans", "Review"],
  };

  return titles[mode][step - 1] ?? "Choose Mode";
}

function getTotalSteps(mode: Mode | null) {
  if (mode === "newAudit") return 5;
  if (mode === "existingAudit") return 3;
  if (mode === "standalone") return 3;
  return 0;
}

function Segmented<T extends string>({
  options,
  value,
  labels,
  onChange,
}: {
  options: T[];
  value: T;
  labels?: Partial<Record<T, string>>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="record-segmented">
      {options.map((option) => (
        <button
          className={value === option ? "record-segmented__item record-segmented__item--active" : "record-segmented__item"}
          key={option}
          onClick={() => onChange(option)}
          type="button"
        >
          {labels?.[option] ?? option}
        </button>
      ))}
    </div>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="record-field">
      <span>{label}</span>
      {children}
      {hint ? <em>{hint}</em> : null}
    </label>
  );
}

function NewRecordPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode | null>(null);
  const [entryMethod, setEntryMethod] = useState<EntryMethod | null>(null);
  const [step, setStep] = useState(0);
  const [audit, setAudit] = useState<AuditDraft>(emptyAudit);
  const [reportPdf, setReportPdf] = useState<File | null>(null);
  const [findings, setFindings] = useState<FindingDraft[]>([newFindingDraft()]);
  const [actionPlansByFinding, setActionPlansByFinding] = useState<Record<string, ActionPlanDraft[]>>({});
  const [flatActionPlans, setFlatActionPlans] = useState<ActionPlanDraft[]>([newActionPlanDraft()]);
  const [options, setOptions] = useState<OptionsPayload>({
    entities: [],
    users: [],
    follow_up_auditors: [],
  });
  const [audits, setAudits] = useState<AuditOption[]>([]);
  const [auditSearch, setAuditSearch] = useState("");
  const [selectedAuditId, setSelectedAuditId] = useState("");
  const [auditFindings, setAuditFindings] = useState<FindingOption[]>([]);
  const [selectedFindingId, setSelectedFindingId] = useState("new");
  const [inlineFinding, setInlineFinding] = useState<FindingDraft>(newFindingDraft());
  const [standaloneFinding, setStandaloneFinding] = useState<FindingDraft>(newFindingDraft());
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);
  const [error, setError] = useState("");
  const [submitProgress, setSubmitProgress] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [aiLoadingId, setAiLoadingId] = useState("");
  const [aiErrors, setAiErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      setIsLoadingOptions(true);
      const [optionsResponse, auditsResponse] = await Promise.all([
        fetch("/api/v1/records/new/options"),
        fetch("/api/v1/audits"),
      ]);
      const [optionsBody, auditsBody] = await Promise.all([
        readResponseBody(optionsResponse),
        readResponseBody(auditsResponse),
      ]);

      if (!isMounted) {
        return;
      }

      if (!optionsResponse.ok) {
        setError(responseError(optionsBody, "Unable to load creation options."));
      } else {
        setOptions(optionsBody as OptionsPayload);
      }

      if (auditsResponse.ok && auditsBody && typeof auditsBody === "object" && "audits" in auditsBody) {
        setAudits((auditsBody as { audits: AuditOption[] }).audits);
      }

      setIsLoadingOptions(false);
    }

    loadData().catch(() => {
      if (isMounted) {
        setError("Unable to load creation options.");
        setIsLoadingOptions(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (searchParams.get("mode") === "audit" && mode === null) {
      selectMode("newAudit");
    }
  }, [mode, searchParams]);

  useEffect(() => {
    if (!selectedAuditId) {
      setAuditFindings([]);
      return;
    }

    let isMounted = true;
    fetch(`/api/v1/findings?audit_id=${encodeURIComponent(selectedAuditId)}`)
      .then(async (response) => {
        const body = await readResponseBody(response);
        if (!response.ok) {
          throw new Error(responseError(body, "Unable to load findings."));
        }
        return body as { findings: FindingOption[] };
      })
      .then((body) => {
        if (isMounted) {
          setAuditFindings(body.findings);
          setSelectedFindingId(body.findings[0]?.id ?? "new");
        }
      })
      .catch((caughtError: Error) => {
        if (isMounted) {
          setError(caughtError.message);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [selectedAuditId]);

  useEffect(() => {
    setActionPlansByFinding((current) => {
      const next = { ...current };
      findings.forEach((finding) => {
        if (!next[finding.id]) {
          next[finding.id] = [newActionPlanDraft(audit.entity_ids)];
        }
      });
      Object.keys(next).forEach((id) => {
        if (!findings.some((finding) => finding.id === id)) {
          delete next[id];
        }
      });
      return next;
    });
  }, [audit.entity_ids, findings]);

  const selectedAudit = useMemo(
    () => audits.find((item) => item.id === selectedAuditId) ?? null,
    [audits, selectedAuditId],
  );
  const selectedAuditEntities = useMemo(
    () => selectedAudit?.audit_entities.map(({ entity }) => entity) ?? [],
    [selectedAudit],
  );
  const filteredAudits = useMemo(() => {
    const needle = auditSearch.trim().toLowerCase();
    if (!needle) {
      return audits;
    }
    return audits.filter((item) =>
      [item.name, item.reference_number ?? "", AUDIT_TYPE_LABELS[item.audit_type]]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [auditSearch, audits]);
  const activeFindingCount =
    mode === "newAudit" ? findings.length : selectedFindingId === "new" || mode === "standalone" ? 1 : 0;
  const actionPlanCount =
    mode === "newAudit"
      ? Object.values(actionPlansByFinding).flat().length
      : flatActionPlans.length;
  const currentEntities =
    mode === "newAudit"
      ? options.entities.filter((entity) => audit.entity_ids.includes(entity.id))
      : mode === "existingAudit"
        ? selectedAuditEntities
        : [];
  const totalSteps = getTotalSteps(mode);
  const stepTitle = getStepTitle(mode, step);
  const missing = getMissingRequirements();
  const isReview = mode !== null && step === totalSteps;

  function resetWizard() {
    setMode(null);
    setEntryMethod(null);
    setStep(0);
    setAudit(emptyAudit);
    setReportPdf(null);
    setFindings([newFindingDraft()]);
    setActionPlansByFinding({});
    setFlatActionPlans([newActionPlanDraft()]);
    setSelectedAuditId("");
    setSelectedFindingId("new");
    setInlineFinding(newFindingDraft());
    setStandaloneFinding(newFindingDraft());
    setSubmitProgress([]);
    setError("");
  }

  function selectMode(nextMode: Mode) {
    setMode(nextMode);
    setEntryMethod(null);
    setStep(nextMode === "newAudit" ? 0 : 1);
    setError("");
  }

  function selectEntryMethod(method: EntryMethod) {
    setEntryMethod(method);
    if (method === "ai") {
      router.push("/ai/ingest");
      return;
    }

    setStep(1);
  }

  function updateFinding(id: string, patch: Partial<FindingDraft>) {
    setFindings((current) =>
      current.map((finding) => (finding.id === id ? { ...finding, ...patch } : finding)),
    );
  }

  function updateActionPlan(
    id: string,
    patch: Partial<ActionPlanDraft>,
    findingId?: string,
  ) {
    if (findingId) {
      setActionPlansByFinding((current) => ({
        ...current,
        [findingId]: current[findingId].map((actionPlan) =>
          actionPlan.id === id ? { ...actionPlan, ...patch } : actionPlan,
        ),
      }));
    } else {
      setFlatActionPlans((current) =>
        current.map((actionPlan) => (actionPlan.id === id ? { ...actionPlan, ...patch } : actionPlan)),
      );
    }

    if ("required_evidence" in patch) {
      setAiErrors((current) => ({ ...current, [id]: "" }));
    }
  }

  function addActionPlan(findingId?: string) {
    const preselectedEntityIds = mode === "newAudit" ? audit.entity_ids : selectedAuditEntities.map((entity) => entity.id);
    if (findingId) {
      setActionPlansByFinding((current) => ({
        ...current,
        [findingId]: [...(current[findingId] ?? []), newActionPlanDraft(preselectedEntityIds)],
      }));
      return;
    }

    setFlatActionPlans((current) => [...current, newActionPlanDraft(preselectedEntityIds)]);
  }

  function removeActionPlan(id: string, findingId?: string) {
    if (findingId) {
      setActionPlansByFinding((current) => ({
        ...current,
        [findingId]: current[findingId].filter((actionPlan) => actionPlan.id !== id),
      }));
      return;
    }

    setFlatActionPlans((current) =>
      current.length > 1 ? current.filter((actionPlan) => actionPlan.id !== id) : current,
    );
  }

  function getMissingRequirements() {
    if (!mode) {
      return ["Choose a record creation mode"];
    }

    if (mode === "newAudit") {
      if (step === 1) {
        return [
          !audit.name.trim() ? "Audit name is required" : "",
          audit.entity_ids.length === 0 ? "Select at least one entity" : "",
        ].filter(Boolean);
      }
      if (step === 3) {
        return findings.some((finding) => !finding.title.trim())
          ? ["Every finding needs a title"]
          : [];
      }
      if (step === 4 || step === 5) {
        const plans = Object.values(actionPlansByFinding).flat();
        return [
          plans.length === 0 ? "Add at least one action plan" : "",
          plans.some((plan) => !plan.description.trim()) ? "Every action plan needs a description" : "",
          plans.some((plan) => !plan.owner_user_id) ? "Every action plan needs an owner" : "",
        ].filter(Boolean);
      }
    }

    if (mode === "existingAudit") {
      if (step === 1) {
        return [
          !selectedAuditId ? "Select an audit" : "",
          selectedFindingId === "new" && !inlineFinding.title.trim()
            ? "Enter the new finding title or choose an existing finding"
            : "",
        ].filter(Boolean);
      }
      if (step === 2 || step === 3) {
        return [
          flatActionPlans.length === 0 ? "Add at least one action plan" : "",
          flatActionPlans.some((plan) => !plan.description.trim())
            ? "Every action plan needs a description"
            : "",
          flatActionPlans.some((plan) => !plan.owner_user_id)
            ? "Every action plan needs an owner"
            : "",
        ].filter(Boolean);
      }
    }

    if (mode === "standalone") {
      if (step === 1) {
        return !standaloneFinding.title.trim() ? ["Finding title is required"] : [];
      }
      if (step === 2 || step === 3) {
        return [
          flatActionPlans.length === 0 ? "Add at least one action plan" : "",
          flatActionPlans.some((plan) => !plan.description.trim())
            ? "Every action plan needs a description"
            : "",
          flatActionPlans.some((plan) => !plan.owner_user_id)
            ? "Every action plan needs an owner"
            : "",
        ].filter(Boolean);
      }
    }

    return [];
  }

  function goNext() {
    if (missing.length > 0 || !mode) {
      return;
    }
    setStep((current) => Math.min(current + 1, getTotalSteps(mode)));
  }

  function goBack() {
    if (step <= 1) {
      setMode(null);
      setEntryMethod(null);
      setStep(0);
      return;
    }
    setStep((current) => current - 1);
  }

  function onPdfSelected(file: File | null) {
    if (!file) {
      setReportPdf(null);
      return;
    }

    if (file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Only PDF files are accepted.");
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      setError("PDF must be under 50MB.");
      return;
    }

    setError("");
    setReportPdf(file);
  }

  function onDropPdf(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    onPdfSelected(event.dataTransfer.files[0] ?? null);
  }

  async function createAudit() {
    const response = await fetch("/api/v1/audits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(audit),
    });
    const body = await readResponseBody(response);
    if (!response.ok) {
      throw new Error(responseError(body, "Unable to create audit."));
    }
    return (body as { audit: { id: string } }).audit;
  }

  async function uploadReport(auditId: string) {
    if (!reportPdf) {
      setSubmitProgress((current) => [...current, "Skipped PDF upload"]);
      return;
    }

    const formData = new FormData();
    formData.append("file", reportPdf);
    const response = await fetch(`/api/v1/audits/${auditId}/upload-report`, {
      method: "POST",
      body: formData,
    });
    const body = await readResponseBody(response);
    if (!response.ok) {
      throw new Error(responseError(body, "Unable to upload report."));
    }
  }

  async function createFinding(
    finding: FindingDraft,
    auditId: string | null,
    isStandalone: boolean,
  ) {
    const response = await fetch("/api/v1/findings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audit_id: auditId,
        is_standalone: isStandalone,
        external_ref: finding.external_ref,
        title: finding.title,
        description: finding.description,
        root_cause: finding.root_cause,
        recommendation: finding.recommendation,
        priority: finding.priority,
        control_rating: finding.control_rating,
        finding_type: finding.finding_type,
        created_via: isStandalone ? "Standalone" : "Manual",
      }),
    });
    const body = await readResponseBody(response);
    if (!response.ok) {
      throw new Error(responseError(body, "Unable to create finding."));
    }
    return (body as { finding: { id: string } }).finding;
  }

  async function createActionPlan(
    actionPlan: ActionPlanDraft,
    findingId: string,
    createdVia: CreatedVia,
  ) {
    const response = await fetch("/api/v1/action-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...actionPlan,
        current_target_date: actionPlan.original_target_date,
        finding_id: findingId,
        created_via: createdVia,
      }),
    });
    const body = await readResponseBody(response);
    if (!response.ok) {
      throw new Error(responseError(body, "Unable to create action plan."));
    }
    return body;
  }

  async function submitRecords() {
    if (!mode || missing.length > 0) {
      return;
    }

    setIsSubmitting(true);
    setSubmitProgress([]);
    setError("");

    try {
      if (mode === "newAudit") {
        const createdAudit = await createAudit();
        setSubmitProgress((current) => [...current, "✓ Audit created"]);

        await uploadReport(createdAudit.id);
        setSubmitProgress((current) => [...current, reportPdf ? "✓ PDF uploaded" : "✓ PDF skipped"]);

        for (const [index, finding] of findings.entries()) {
          const createdFinding = await createFinding(finding, createdAudit.id, false);
          setSubmitProgress((current) => [...current, `✓ Finding F${index + 1} created`]);

          for (const actionPlan of actionPlansByFinding[finding.id] ?? []) {
            await createActionPlan(actionPlan, createdFinding.id, "Manual");
            setSubmitProgress((current) => [...current, "✓ Action plan created"]);
          }
        }

        router.push(`/audits/${createdAudit.id}`);
        return;
      }

      if (mode === "existingAudit") {
        let findingId = selectedFindingId;
        if (selectedFindingId === "new") {
          const createdFinding = await createFinding(inlineFinding, selectedAuditId, false);
          findingId = createdFinding.id;
          setSubmitProgress((current) => [...current, "✓ Finding created"]);
        }

        for (const actionPlan of flatActionPlans) {
          await createActionPlan(actionPlan, findingId, "Manual");
          setSubmitProgress((current) => [...current, "✓ Action plan created"]);
        }

        router.push(`/audits/${selectedAuditId}`);
        return;
      }

      const createdFinding = await createFinding(standaloneFinding, null, true);
      setSubmitProgress((current) => [...current, "✓ Standalone finding created"]);
      for (const actionPlan of flatActionPlans) {
        await createActionPlan(actionPlan, createdFinding.id, "Standalone");
        setSubmitProgress((current) => [...current, "✓ Action plan created"]);
      }
      router.push("/dashboard");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to create records.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function generateEvidence(actionPlan: ActionPlanDraft, finding: FindingDraft | FindingOption) {
    if (!actionPlan.description.trim()) {
      setAiErrors((current) => ({
        ...current,
        [actionPlan.id]: "Enter the action plan description first.",
      }));
      return;
    }

    setAiLoadingId(actionPlan.id);
    setAiErrors((current) => ({ ...current, [actionPlan.id]: "" }));

    try {
      const response = await fetch("/api/v1/ai/suggest-evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          finding_title: finding.title,
          finding_description: finding.description,
          finding_recommendation: finding.recommendation,
          finding_priority: finding.priority,
          action_plan_description: actionPlan.description,
          audit_name: mode === "newAudit" ? audit.name : selectedAudit?.name ?? null,
        }),
      });
      const body = await readResponseBody(response);
      if (!response.ok) {
        throw new Error(responseError(body, "Unable to generate evidence."));
      }

      const requiredEvidence =
        body && typeof body === "object" && "required_evidence" in body
          ? String(body.required_evidence)
          : "";

      if (mode === "newAudit") {
        const findingId = findings.find((item) => item.id === finding.id)?.id;
        if (findingId) {
          updateActionPlan(actionPlan.id, { required_evidence: requiredEvidence }, findingId);
        }
      } else {
        updateActionPlan(actionPlan.id, { required_evidence: requiredEvidence });
      }
    } catch (caughtError) {
      setAiErrors((current) => ({
        ...current,
        [actionPlan.id]:
          caughtError instanceof Error ? caughtError.message : "Unable to generate evidence.",
      }));
    } finally {
      setAiLoadingId("");
    }
  }

  return (
    <AppLayout>
      <div className="records-wizard">
        <aside className="records-wizard__left">
          <div className="records-mode">
            <span>{mode ? MODE_CONFIG[mode].icon : "◇"}</span>
            <div>
              <strong>{mode ? MODE_CONFIG[mode].title : "Records Creation"}</strong>
              <em>{mode ? MODE_CONFIG[mode].subtitle : "Choose a mode to begin."}</em>
            </div>
          </div>

          <ol className="records-progress">
            {mode === "standalone" && step > 0 ? (
              <li className="records-progress__item records-progress__item--current">
                <span />
                <p>Create Standalone Finding</p>
              </li>
            ) : (mode
              ? Array.from({ length: totalSteps }, (_, index) => index + 1)
              : [0]
            ).map((item) => (
              <li
                className={
                  mode && item < step
                    ? "records-progress__item records-progress__item--done"
                    : mode && item === step
                      ? "records-progress__item records-progress__item--current"
                      : "records-progress__item"
                }
                key={item}
              >
                <span />
                <p>{item === 0 ? "Choose Mode" : getStepTitle(mode, item)}</p>
              </li>
            ))}
          </ol>

          <section className="records-summary">
            <h2>Live Summary</h2>
            <p>{audit.name || selectedAudit?.name || "No audit selected"}</p>
            <div className="records-badges">
              {(mode === "standalone" ? options.entities : currentEntities).slice(0, 6).map((entity) => (
                <span key={entity.id}>{entity.code}</span>
              ))}
              {currentEntities.length === 0 && mode !== "standalone" ? <span>No entities</span> : null}
            </div>
            <dl>
              <div>
                <dt>Findings</dt>
                <dd>{activeFindingCount}</dd>
              </div>
              <div>
                <dt>Action Plans</dt>
                <dd>{actionPlanCount}</dd>
              </div>
            </dl>
          </section>

          <button className="records-start-over" onClick={resetWizard} type="button">
            Start Over
          </button>
        </aside>

        <main className="records-wizard__right">
          {error ? <div className="auth-error">{error}</div> : null}
          {isLoadingOptions ? <div className="records-card">Loading creation options...</div> : null}
          {!isLoadingOptions ? (
            <section className="records-step fade-step">
              {step === 0 ? renderModeSelection() : null}
              {mode === "newAudit" && step === 1 ? renderAuditDetails() : null}
              {mode === "newAudit" && step === 2 ? renderPdfUpload() : null}
              {mode === "newAudit" && step === 3 ? renderFindings() : null}
              {mode === "newAudit" && step === 4 ? renderGroupedActionPlans() : null}
              {mode === "newAudit" && step === 5 ? renderReview() : null}
              {mode === "existingAudit" && step === 1 ? renderExistingAuditSelection() : null}
              {mode === "existingAudit" && step === 2 ? renderFlatActionPlans() : null}
              {mode === "existingAudit" && step === 3 ? renderReview() : null}
              {mode === "standalone" && step === 1 ? renderStandaloneSinglePage() : null}
            </section>
          ) : null}

          {mode && step > 0 && mode !== "standalone" ? (
            <nav className="records-nav">
              <button className="button" disabled={isSubmitting} onClick={goBack} type="button">
                Back
              </button>
              <span>
                Step {step} of {totalSteps} — {stepTitle}
              </span>
              <span title={missing.join(", ")}>
                <button
                  className="button button--primary"
                  disabled={missing.length > 0 || isSubmitting}
                  onClick={isReview ? submitRecords : goNext}
                  type="button"
                >
                  {isSubmitting ? "Creating..." : isReview ? "Create Records" : "Next"}
                </button>
              </span>
            </nav>
          ) : null}

          {mode === "standalone" && step === 1 ? (
            <nav className="records-nav">
              <button className="button" disabled={isSubmitting} onClick={goBack} type="button">
                Back
              </button>
              <span title={missing.join(", ")}>
                <button
                  className="button button--primary"
                  disabled={missing.length > 0 || isSubmitting}
                  onClick={submitRecords}
                  type="button"
                >
                  {isSubmitting ? "Creating..." : "Save"}
                </button>
              </span>
            </nav>
          ) : null}
        </main>
      </div>
    </AppLayout>
  );

  function renderModeSelection() {
    if (mode === "newAudit" && step === 0) {
      return (
        <>
          <header className="records-heading">
            <p>Step 0</p>
            <h1>Choose entry method</h1>
            <span>Start manually or let AI extract an audit report PDF.</span>
          </header>
          <div className="records-mode-grid">
            {[
              {
                key: "manual" as EntryMethod,
                title: "Manual Entry",
                subtitle: "Fill in the audit details, findings, and action plans yourself",
              },
              {
                key: "ai" as EntryMethod,
                title: "AI Ingest",
                subtitle: "Upload a PDF audit report and let AI extract the details",
              },
            ].map((option) => (
              <button
                className={`records-mode-card${entryMethod === option.key ? " records-mode-card--selected" : ""}`}
                key={option.key}
                onClick={() => selectEntryMethod(option.key)}
                type="button"
              >
                <span>{option.key === "manual" ? "✎" : "✦"}</span>
                <strong>{option.title}</strong>
                <em>{option.subtitle}</em>
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              setMode(null);
              setEntryMethod(null);
            }}
            style={{
              background: "transparent",
              border: 0,
              color: "#6B6860",
              cursor: "pointer",
              marginTop: 16,
              padding: 0,
            }}
            type="button"
          >
            ← Back
          </button>
        </>
      );
    }

    return (
      <>
        <header className="records-heading">
          <p>Step 0</p>
          <h1>Create records</h1>
          <span>Select how these remediation records should be created.</span>
        </header>
        <div className="records-mode-grid">
          {(Object.keys(MODE_CONFIG) as Mode[]).map((key) => (
            <button
              className={`records-mode-card${mode === key ? " records-mode-card--selected" : ""}`}
              key={key}
              onClick={() => selectMode(key)}
              type="button"
            >
              <span>{MODE_CONFIG[key].icon}</span>
              <strong>{MODE_CONFIG[key].title}</strong>
              <em>{MODE_CONFIG[key].subtitle}</em>
            </button>
          ))}
        </div>
      </>
    );
  }

  function renderAuditDetails() {
    return (
      <>
        <header className="records-heading">
          <p>Audit details</p>
          <h1>Tell us about the audit report</h1>
        </header>
        <div className="records-form-grid">
          <Field label="Audit name">
            <input value={audit.name} onChange={(event) => setAudit({ ...audit, name: event.target.value })} />
          </Field>
          <Field label="Reference number">
            <input
              className="records-mono-input"
              value={audit.reference_number}
              onChange={(event) => setAudit({ ...audit, reference_number: event.target.value })}
            />
          </Field>
          <Field label="Report issue date">
            <input
              type="date"
              value={audit.report_issue_date}
              onChange={(event) => setAudit({ ...audit, report_issue_date: event.target.value })}
            />
          </Field>
          <div className="record-field record-field--wide">
            <span>Audit type</span>
            <Segmented
              labels={AUDIT_TYPE_LABELS}
              options={AUDIT_TYPES}
              value={audit.audit_type}
              onChange={(audit_type) => setAudit({ ...audit, audit_type })}
            />
          </div>
          <div className="record-field record-field--wide">
            <span>Opinion rating</span>
            <Segmented
              options={OPINION_RATINGS}
              value={audit.opinion_rating}
              onChange={(opinion_rating) => setAudit({ ...audit, opinion_rating })}
            />
          </div>
          <div className="record-field record-field--wide">
            <span>Entities</span>
            <EntityMultiSelect
              entities={options.entities}
              selectedIds={audit.entity_ids}
              onChange={(entity_ids) => {
                setAudit({ ...audit, entity_ids });
                setActionPlansByFinding((current) =>
                  Object.fromEntries(
                    Object.entries(current).map(([findingId, plans]) => [
                      findingId,
                      plans.map((plan) => ({ ...plan, entity_ids })),
                    ]),
                  ),
                );
              }}
            />
          </div>
          <Field label="Executive summary" hint="Optional">
            <textarea
              value={audit.executive_summary}
              onChange={(event) => setAudit({ ...audit, executive_summary: event.target.value })}
            />
          </Field>
        </div>
      </>
    );
  }

  function renderPdfUpload() {
    return (
      <>
        <header className="records-heading">
          <p>PDF upload</p>
          <h1>Attach the audit report PDF</h1>
          <span>This is optional. The file will upload during final submission.</span>
        </header>
        <div
          className="records-dropzone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={onDropPdf}
        >
          <strong>Drag and drop a PDF here</strong>
          <span>PDF only, maximum 50MB</span>
          <input
            accept="application/pdf,.pdf"
            onChange={(event: ChangeEvent<HTMLInputElement>) => onPdfSelected(event.target.files?.[0] ?? null)}
            type="file"
          />
          {reportPdf ? (
            <p>
              Selected: <strong>{reportPdf.name}</strong> ({formatFileSize(reportPdf.size)})
            </p>
          ) : null}
        </div>
        <button className="button" onClick={() => setStep(3)} type="button">
          Skip
        </button>
      </>
    );
  }

  function renderFindings() {
    return (
      <>
        <header className="records-heading">
          <p>Findings</p>
          <h1>Add findings from the audit</h1>
        </header>
        <div className="records-stack">
          {findings.map((finding, index) => (
            <article className="records-card" key={finding.id}>
              <header className="records-card__header">
                <strong>F{index + 1}</strong>
                <button
                  className="button"
                  onClick={() => updateFinding(finding.id, { collapsed: !finding.collapsed })}
                  type="button"
                >
                  {finding.collapsed ? "Expand" : "Collapse"}
                </button>
                <button
                  className="button button--danger"
                  disabled={findings.length === 1}
                  onClick={() => setFindings((current) => current.filter((item) => item.id !== finding.id))}
                  type="button"
                >
                  Remove
                </button>
              </header>
              {!finding.collapsed ? renderFindingFields(finding, (patch) => updateFinding(finding.id, patch)) : null}
            </article>
          ))}
          <button
            className="button button--primary"
            onClick={() => setFindings((current) => [...current, newFindingDraft()])}
            type="button"
          >
            Add Finding
          </button>
        </div>
      </>
    );
  }

  function renderFindingFields(finding: FindingDraft, onChange: (patch: Partial<FindingDraft>) => void) {
    return (
      <div className="records-form-grid">
        <Field label="Title">
          <input value={finding.title} onChange={(event) => onChange({ title: event.target.value })} />
        </Field>
        <div className="record-field record-field--wide">
          <span>Finding Type</span>
          <Segmented
            labels={{ Finding: "Finding", OpportunityForImprovement: "OFI" }}
            options={FINDING_TYPES}
            value={finding.finding_type}
            onChange={(finding_type) => onChange({ finding_type })}
          />
        </div>
        <Field label="External reference">
          <input value={finding.external_ref} onChange={(event) => onChange({ external_ref: event.target.value })} />
        </Field>
        <div className="record-field record-field--wide">
          <span>Priority</span>
          <Segmented options={PRIORITIES} value={finding.priority} onChange={(priority) => onChange({ priority })} />
        </div>
        <div className="record-field record-field--wide">
          <span>Control rating</span>
          <Segmented
            options={CONTROL_RATINGS}
            value={finding.control_rating}
            onChange={(control_rating) => onChange({ control_rating })}
          />
        </div>
        <Field label="Description">
          <textarea value={finding.description} onChange={(event) => onChange({ description: event.target.value })} />
        </Field>
        <Field label="Root cause">
          <textarea value={finding.root_cause} onChange={(event) => onChange({ root_cause: event.target.value })} />
        </Field>
        <Field label="Recommendation">
          <textarea value={finding.recommendation} onChange={(event) => onChange({ recommendation: event.target.value })} />
        </Field>
      </div>
    );
  }

  function renderGroupedActionPlans() {
    return (
      <>
        <header className="records-heading">
          <p>Action plans</p>
          <h1>Add action plans under each finding</h1>
        </header>
        <div className="records-stack">
          {findings.map((finding, index) => (
            <section className="records-card" key={finding.id}>
              <header className="records-section-header">
                <strong>F{index + 1}: {finding.title || "Untitled finding"}</strong>
                <button className="button" onClick={() => addActionPlan(finding.id)} type="button">
                  Add Action Plan
                </button>
              </header>
              {(actionPlansByFinding[finding.id] ?? []).map((actionPlan) => (
                <ActionPlanCard
                  actionPlan={actionPlan}
                  aiError={aiErrors[actionPlan.id]}
                  aiLoading={aiLoadingId === actionPlan.id}
                  entities={options.entities.filter((entity) => audit.entity_ids.includes(entity.id))}
                  followUpAuditors={options.follow_up_auditors}
                  key={actionPlan.id}
                  users={options.users}
                  onGenerate={() => generateEvidence(actionPlan, finding)}
                  onRemove={() => removeActionPlan(actionPlan.id, finding.id)}
                  onUpdate={(patch) => updateActionPlan(actionPlan.id, patch, finding.id)}
                />
              ))}
            </section>
          ))}
        </div>
      </>
    );
  }

  function renderExistingAuditSelection() {
    return (
      <>
        <header className="records-heading">
          <p>Select audit</p>
          <h1>Choose the audit and finding</h1>
        </header>
        <Field label="Search audits">
          <input
            placeholder="Search by name, reference, or type"
            value={auditSearch}
            onChange={(event) => setAuditSearch(event.target.value)}
          />
        </Field>
        <div className="records-audit-list">
          {filteredAudits.map((item) => (
            <button
              className={`records-audit-option${item.id === selectedAuditId ? " records-audit-option--selected" : ""}`}
              key={item.id}
              onClick={() => {
                setSelectedAuditId(item.id);
                setFlatActionPlans([newActionPlanDraft(item.audit_entities.map(({ entity }) => entity.id))]);
              }}
              type="button"
            >
              <strong>{item.name}</strong>
              <span>{AUDIT_TYPE_LABELS[item.audit_type]}</span>
              <em>{item.audit_entities.map(({ entity }) => entity.code).join(", ") || "No entities"}</em>
            </button>
          ))}
        </div>
        {selectedAudit ? (
          <section className="records-card">
            <h2>Finding</h2>
            <div className="records-radio-list">
              {auditFindings.map((finding) => (
                <label key={finding.id}>
                  <input
                    checked={selectedFindingId === finding.id}
                    onChange={() => setSelectedFindingId(finding.id)}
                    type="radio"
                  />
                  <span>{finding.title}</span>
                </label>
              ))}
              <label>
                <input
                  checked={selectedFindingId === "new"}
                  onChange={() => setSelectedFindingId("new")}
                  type="radio"
                />
                <span>Create new finding</span>
              </label>
            </div>
            {selectedFindingId === "new"
              ? renderFindingFields(inlineFinding, (patch) => setInlineFinding({ ...inlineFinding, ...patch }))
              : null}
          </section>
        ) : null}
      </>
    );
  }

  function renderStandaloneFinding() {
    return (
      <>
        <header className="records-heading">
          <p>Standalone finding</p>
          <h1>Create a finding outside an audit report</h1>
          <span>This finding is not linked to an audit report. It can still have owners and evidence requirements.</span>
        </header>
        <section className="records-card">
          {renderFindingFields(standaloneFinding, (patch) =>
            setStandaloneFinding({ ...standaloneFinding, ...patch }),
          )}
        </section>
      </>
    );
  }

  function renderStandaloneSinglePage() {
    return (
      <>
        <header className="records-heading">
          <h1>Create Standalone Finding</h1>
          <span>Create a finding and action plans without linking to an audit report.</span>
        </header>
        <section className="records-card">
          <h2>Finding Details</h2>
          {renderFindingFields(standaloneFinding, (patch) =>
            setStandaloneFinding({ ...standaloneFinding, ...patch }),
          )}
        </section>
        <section className="records-card" style={{ marginTop: 24 }}>
          <h2>Action Plans</h2>
          <div className="records-stack">
            {flatActionPlans.map((actionPlan) => (
              <ActionPlanCard
                actionPlan={actionPlan}
                aiError={aiErrors[actionPlan.id]}
                aiLoading={aiLoadingId === actionPlan.id}
                entities={options.entities}
                followUpAuditors={options.follow_up_auditors}
                key={actionPlan.id}
                users={options.users}
                onGenerate={() => generateEvidence(actionPlan, standaloneFinding)}
                onRemove={() => removeActionPlan(actionPlan.id)}
                onUpdate={(patch) => updateActionPlan(actionPlan.id, patch)}
              />
            ))}
            <button className="button button--primary" onClick={() => addActionPlan()} type="button">
              + Add another action plan
            </button>
          </div>
        </section>
        {submitProgress.length > 0 ? (
          <ul className="records-submit-progress">
            {submitProgress.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        ) : null}
      </>
    );
  }

  function renderFlatActionPlans() {
    const entities = mode === "existingAudit" ? selectedAuditEntities : options.entities;
    const finding =
      mode === "standalone"
        ? standaloneFinding
        : selectedFindingId === "new"
          ? inlineFinding
          : auditFindings.find((item) => item.id === selectedFindingId) ?? inlineFinding;

    return (
      <>
        <header className="records-heading">
          <p>Action plans</p>
          <h1>Add action plans</h1>
        </header>
        <div className="records-stack">
          {flatActionPlans.map((actionPlan) => (
            <ActionPlanCard
              actionPlan={actionPlan}
              aiError={aiErrors[actionPlan.id]}
              aiLoading={aiLoadingId === actionPlan.id}
              entities={entities}
              followUpAuditors={options.follow_up_auditors}
              key={actionPlan.id}
              users={options.users}
              onGenerate={() => generateEvidence(actionPlan, finding)}
              onRemove={() => removeActionPlan(actionPlan.id)}
              onUpdate={(patch) => updateActionPlan(actionPlan.id, patch)}
            />
          ))}
          <button className="button button--primary" onClick={() => addActionPlan()} type="button">
            + Add another action plan
          </button>
        </div>
      </>
    );
  }

  function renderReview() {
    const reviewFindings =
      mode === "newAudit"
        ? findings
        : mode === "standalone"
          ? [standaloneFinding]
          : selectedFindingId === "new"
            ? [inlineFinding]
            : [];

    return (
      <>
        <header className="records-heading">
          <p>Review</p>
          <h1>Review and create records</h1>
        </header>
        <div className="records-counts">
          <span>{mode === "newAudit" ? 1 : 0} audit</span>
          <span>{reviewFindings.length} finding(s)</span>
          <span>{actionPlanCount} action plan(s)</span>
        </div>
        <section className="records-card">
          <h2>{audit.name || selectedAudit?.name || "Standalone finding"}</h2>
          <p>
            Entities:{" "}
            {mode === "newAudit"
              ? entityCodes(options.entities, audit.entity_ids)
              : selectedAuditEntities.map((entity) => entity.code).join(", ") || "All active entities available"}
          </p>
          {reportPdf ? <p>PDF: {reportPdf.name}</p> : null}
        </section>
        <div className="records-stack">
          {(mode === "newAudit" ? findings : reviewFindings).map((finding) => (
            <section className="records-card" key={finding.id}>
              <h2>{finding.title || "Selected existing finding"}</h2>
              <p>{finding.description || "No description"}</p>
              {(mode === "newAudit" ? actionPlansByFinding[finding.id] ?? [] : flatActionPlans).map((plan) => (
                <article className="records-review-ap" key={plan.id}>
                  <strong>{plan.description || "Untitled action plan"}</strong>
                  <span>Owner: {options.users.find((user) => user.id === plan.owner_user_id)?.name ?? "Missing"}</span>
                  {!plan.owner_user_id ? <em>Warning: missing owner</em> : null}
                </article>
              ))}
            </section>
          ))}
          {mode === "existingAudit" && selectedFindingId !== "new" ? (
            <section className="records-card">
              <h2>{auditFindings.find((finding) => finding.id === selectedFindingId)?.title}</h2>
              {flatActionPlans.map((plan) => (
                <article className="records-review-ap" key={plan.id}>
                  <strong>{plan.description || "Untitled action plan"}</strong>
                  <span>Owner: {options.users.find((user) => user.id === plan.owner_user_id)?.name ?? "Missing"}</span>
                </article>
              ))}
            </section>
          ) : null}
        </div>
        {submitProgress.length > 0 ? (
          <ul className="records-submit-progress">
            {submitProgress.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        ) : null}
      </>
    );
  }
}

export default function NewRecordPage() {
  return (
    <Suspense>
      <NewRecordPageContent />
    </Suspense>
  );
}

function ActionPlanCard({
  actionPlan,
  entities,
  users,
  followUpAuditors,
  aiLoading,
  aiError,
  onUpdate,
  onRemove,
  onGenerate,
}: {
  actionPlan: ActionPlanDraft;
  entities: EntityOption[];
  users: UserOption[];
  followUpAuditors: UserOption[];
  aiLoading: boolean;
  aiError?: string;
  onUpdate: (patch: Partial<ActionPlanDraft>) => void;
  onRemove: () => void;
  onGenerate: () => void;
}) {
  const selectedOwner = users.find((user) => user.id === actionPlan.owner_user_id);
  const selectedFollowUpAuditor = followUpAuditors.find(
    (user) => user.id === actionPlan.follow_up_auditor_user_id,
  );

  return (
    <article className="records-ap-card">
      <header>
        <strong>Action Plan</strong>
        <button className="button button--danger" onClick={onRemove} type="button">
          Remove
        </button>
      </header>
      <div className="records-form-grid">
        <Field label="Description">
          <textarea
            value={actionPlan.description}
            onChange={(event) => onUpdate({ description: event.target.value })}
          />
        </Field>
        <div className="record-field record-field--wide">
          <span>Priority</span>
          <Segmented
            options={PRIORITIES}
            value={actionPlan.priority}
            onChange={(priority) => onUpdate({ priority })}
          />
        </div>
        <Field label="Target date">
          <input
            type="date"
            value={actionPlan.original_target_date}
            onChange={(event) =>
              onUpdate({
                original_target_date: event.target.value,
                current_target_date: event.target.value,
              })
            }
          />
        </Field>
        <Field label="Owner">
          <select
            value={actionPlan.owner_user_id}
            onChange={(event) => onUpdate({ owner_user_id: event.target.value })}
          >
            <option value="">Select owner</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} {user.department ? `— ${user.department}` : ""}
              </option>
            ))}
          </select>
          {actionPlan.owner_user_id ? (
            <span
              style={{
                background: "#F8F7F4",
                border: "1px solid #E8E6E0",
                borderRadius: 4,
                color: "#6B6860",
                fontSize: 12,
                marginTop: 4,
                padding: "6px 10px",
              }}
            >
              {userInfoText(selectedOwner, ["job_title", "department", "team_l2"])}
            </span>
          ) : null}
        </Field>
        <Field label="Follow-up auditor">
          <select
            value={actionPlan.follow_up_auditor_user_id}
            onChange={(event) => onUpdate({ follow_up_auditor_user_id: event.target.value })}
          >
            <option value="">Optional</option>
            {followUpAuditors.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
          {actionPlan.follow_up_auditor_user_id ? (
            <span
              style={{
                background: "#F8F7F4",
                border: "1px solid #E8E6E0",
                borderRadius: 4,
                color: "#6B6860",
                fontSize: 12,
                marginTop: 4,
                padding: "6px 10px",
              }}
            >
              {userInfoText(selectedFollowUpAuditor, ["job_title", "team_l2"])}
            </span>
          ) : null}
        </Field>
        <div className="record-field record-field--wide">
          <span>Entities</span>
          <EntityMultiSelect
            entities={entities}
            selectedIds={actionPlan.entity_ids}
            onChange={(entity_ids) => onUpdate({ entity_ids })}
          />
        </div>
        <div className="record-field record-field--wide">
          <span>Required evidence</span>
          <input
            value={actionPlan.required_evidence}
            onChange={(event) => onUpdate({ required_evidence: event.target.value })}
          />
          <button className="records-ai-button" disabled={aiLoading} onClick={onGenerate} type="button">
            {aiLoading ? "Generating..." : "✦ Generate with AI"}
          </button>
          {aiError ? (
            <em className="records-inline-error" style={{ whiteSpace: "normal", wordBreak: "break-word" }}>
              {aiError}
            </em>
          ) : null}
        </div>
      </div>
    </article>
  );
}
