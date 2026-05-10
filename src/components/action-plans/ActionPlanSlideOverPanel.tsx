"use client";

import { type JSX, FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { formatAuditLogEntry } from "../../lib/audit-log/formatAuditLogEntry";
import { useAIAssistant } from "../../lib/ai-assistant-context";
import {
  AUDIT_TYPE_COLORS,
  AUDIT_TYPE_LABELS,
  STATUS_LABELS,
} from "../../lib/constants";
import ConfirmDialog from "../ConfirmDialog";
import EmptyState from "../EmptyState";
import { useToast } from "../Toast";
import type {
  DashboardActionPlan,
  DashboardComment,
  DashboardUser,
  UserOption,
} from "./ActionPlanTable";

type Role = "AuditTeam" | "Viewer" | "Auditee" | "Pending";
type Status =
  | "NotStarted"
  | "InProgress"
  | "PendingValidation"
  | "Closed"
  | "RiskAccepted"
  | "Dropped";
type Priority = "High" | "Moderate" | "Low";
type AuditType = keyof typeof AUDIT_TYPE_LABELS;
type DashboardEvidence = DashboardActionPlan["evidence"][0];
type DashboardTargetDateRevision = DashboardActionPlan["target_date_revisions"][0];
type RelatedUser = DashboardActionPlan["action_plan_owners"][0]["user"];

type AuditLogEntry = {
  id: string;
  action: string;
  before_json: unknown;
  after_json: unknown;
  created_at: string;
  user: {
    name: string;
  } | null;
};

const STATUS_ORDER: Status[] = [
  "NotStarted",
  "InProgress",
  "PendingValidation",
  "RiskAccepted",
  "Dropped",
  "Closed",
];

const STATUS_ACCENTS: Record<Status, string> = {
  NotStarted: "#64748b",
  InProgress: "#2563eb",
  PendingValidation: "#d97706",
  Closed: "#16a34a",
  RiskAccepted: "#7c3aed",
  Dropped: "#71717a",
};

const PRIORITY_OPTIONS: (Priority | null)[] = ["High", "Moderate", "Low", null];
const CONTROL_RATING_OPTIONS = ["Effective", "PartiallyEffective", "NotEffective", null];

function formatDate(value: string | null) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Not set";
  }

  const date = new Date(value);
  return `${date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}, ${date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function formatDateInputValue(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function getTodayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function getInitials(name?: string | null) {
  return (name ?? "User")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
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

function getResponseError(body: unknown, fallback: string) {
  return typeof body === "object" && body && "error" in body ? String(body.error) : fallback;
}

function canEditActionPlan(user: DashboardUser | null, actionPlan: DashboardActionPlan) {
  if (!user || user.role === "Viewer") {
    return false;
  }

  if (user.role === "AuditTeam") {
    return true;
  }

  return actionPlan.action_plan_owners.some((owner) => owner.user.id === user.id);
}

function AuditTypeBadge({ auditType }: { auditType?: AuditType | null }) {
  if (!auditType) {
    return null;
  }

  const colors = AUDIT_TYPE_COLORS[auditType];

  return (
    <span
      className={`${colors.bg} ${colors.text}`}
      style={{
        borderRadius: 3,
        display: "inline-flex",
        fontSize: 10,
        fontWeight: 600,
        lineHeight: 1.4,
        padding: "1px 6px",
        width: "fit-content",
      }}
    >
      {AUDIT_TYPE_LABELS[auditType]}
    </span>
  );
}

function getAuditLogColor(action: string) {
  if (action === "StatusChange") return "#2563eb";
  if (action.includes("owner") || action.includes("auditor")) return "#0d9488";
  if (action.includes("target") || action.includes("Target")) return "#f59e0b";
  if (action === "EvidenceUpload" || action === "EvidenceReplace") return "#16a34a";
  if (action === "Delete") return "#dc2626";
  if (action === "Create") return "#64748b";
  return "#999";
}

type ActionPlanSlideOverPanelProps = {
  actionPlan: DashboardActionPlan;
  user: DashboardUser | null;
  userOptions: UserOption[];
  auditLogOpen: boolean;
  auditLogs: AuditLogEntry[];
  onClose: () => void;
  patchActionPlanLocal: (actionPlanId: string, patch: Partial<DashboardActionPlan>) => void;
  addCommentLocal: (actionPlanId: string, createdComment: DashboardComment) => void;
  loadAuditLog: (actionPlan: DashboardActionPlan) => Promise<void>;
  forceReloadAuditLog: (actionPlan: DashboardActionPlan) => Promise<void>;
  refreshActionPlans: () => Promise<void>;
};

export default function ActionPlanSlideOverPanel({
  actionPlan,
  user,
  userOptions,
  auditLogOpen,
  auditLogs,
  onClose,
  patchActionPlanLocal,
  addCommentLocal,
  loadAuditLog,
  forceReloadAuditLog,
  refreshActionPlans,
}: ActionPlanSlideOverPanelProps) {
  const toast = useToast();
  const { openAssistant } = useAIAssistant();
  const evidenceInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  const audit = actionPlan.finding?.audit ?? null;
  const isAdmin = user?.is_admin === true;
  const canEdit = canEditActionPlan(user, actionPlan);
  const canEditFinding = user?.role === "AuditTeam";
  const canManageAssignments = user?.role === "AuditTeam";

  // Tab state
  const [activeTab, setActiveTab] = useState<"details" | "people" | "evidence" | "activity">("details");

  // Panel width state
  const [panelWidth, setPanelWidth] = useState(400);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  // Dialogs
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Buffered draft state
  const [draftTitle, setDraftTitle] = useState(actionPlan.title ?? "");
  const [draftDescription, setDraftDescription] = useState(actionPlan.description);
  const [draftRequiredEvidence, setDraftRequiredEvidence] = useState(actionPlan.required_evidence ?? "");
  const [draftPriority, setDraftPriority] = useState(actionPlan.priority);
  const [draftStatus, setDraftStatus] = useState(actionPlan.status);
  const [draftStatusRemarks, setDraftStatusRemarks] = useState("");
  const [draftClosedAt, setDraftClosedAt] = useState<string | null>(actionPlan.closed_at);
  const [draftClosureRemarks, setDraftClosureRemarks] = useState(actionPlan.closure_remarks ?? "");
  const [isSaving, setIsSaving] = useState(false);

  // Track which fields the user has actively edited (to preserve during background refreshes)
  const [userEditedFields, setUserEditedFields] = useState<Set<string>>(new Set());

  // Target date revision
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionDate, setRevisionDate] = useState("");
  const [revisionJustification, setRevisionJustification] = useState("");
  const [revisionErrors, setRevisionErrors] = useState<Record<string, string>>({});
  const [revisionHistoryOpen, setRevisionHistoryOpen] = useState(false);

  // Comments
  const [comment, setComment] = useState("");
  const [commentError, setCommentError] = useState("");
  const [fullCommentsLoaded, setFullCommentsLoaded] = useState(false);
  const [totalCommentCount, setTotalCommentCount] = useState(actionPlan.comments.length);

  // Evidence
  const [evidenceError, setEvidenceError] = useState("");
  const [evidenceDescription, setEvidenceDescription] = useState("");
  const [analyzingEvidenceId, setAnalyzingEvidenceId] = useState<string | null>(null);
  const [analysisDrafts, setAnalysisDrafts] = useState<Record<string, string>>({});
  const [analysisErrors, setAnalysisErrors] = useState<Record<string, string>>({});
  const [previewEvidence, setPreviewEvidence] = useState<DashboardEvidence | null>(null);

  // People assignment
  const [assigningType, setAssigningType] = useState<"owner" | "auditor" | null>(null);
  const [includeFormerEmployees, setIncludeFormerEmployees] = useState(false);
  const [localUserOptions, setLocalUserOptions] = useState<UserOption[]>(userOptions);

  // Audit log
  const [localAuditLogOpen, setLocalAuditLogOpen] = useState(auditLogOpen);

  // Finding context expansion
  const [findingExpanded, setFindingExpanded] = useState(false);

  // AI loading states
  const [isGeneratingEvidenceSuggestion, setIsGeneratingEvidenceSuggestion] = useState(false);
  const [isGeneratingClosureRemarks, setIsGeneratingClosureRemarks] = useState(false);

  // Track changed fields
  const changedFields = useMemo(() => {
    const fields: string[] = [];
    if (draftTitle !== (actionPlan.title ?? "")) fields.push("Title");
    if (draftDescription !== actionPlan.description) fields.push("Description");
    if (draftRequiredEvidence !== (actionPlan.required_evidence ?? "")) fields.push("Required Evidence");
    if (draftPriority !== actionPlan.priority) fields.push("Priority");
    if (draftStatus !== actionPlan.status) fields.push("Status");
    if (draftStatusRemarks.trim() && draftStatus !== actionPlan.status) fields.push("Status Remarks");
    if (draftClosedAt !== actionPlan.closed_at) fields.push("Closure Date");
    if (draftClosureRemarks !== (actionPlan.closure_remarks ?? "")) fields.push("Closure Remarks");
    return fields;
  }, [
    draftTitle,
    draftDescription,
    draftRequiredEvidence,
    draftPriority,
    draftStatus,
    draftStatusRemarks,
    draftClosedAt,
    draftClosureRemarks,
    actionPlan,
  ]);

  const hasUnsavedChanges = changedFields.length > 0;

  // Completion signals for the ring
  const completionSignals = useMemo(() => {
    const signals: string[] = [];
    if (actionPlan.description?.trim()) signals.push("Description filled");
    if (actionPlan.action_plan_owners.length > 0) signals.push("Owner assigned");
    if (actionPlan.required_evidence?.trim()) signals.push("Required evidence specified");
    if (actionPlan.current_target_date) signals.push("Target date set");
    if (actionPlan.evidence_count > 0) signals.push("Evidence uploaded");
    return signals;
  }, [actionPlan]);

  const completionPercent = (completionSignals.length / 5) * 100;

  // Reset drafts when actionPlan changes, but preserve user edits
  useEffect(() => {
    // Only reset fields that the user has NOT actively edited
    if (!userEditedFields.has("title")) {
      setDraftTitle(actionPlan.title ?? "");
    }
    if (!userEditedFields.has("description")) {
      setDraftDescription(actionPlan.description);
    }
    if (!userEditedFields.has("required_evidence")) {
      setDraftRequiredEvidence(actionPlan.required_evidence ?? "");
    }
    if (!userEditedFields.has("priority")) {
      setDraftPriority(actionPlan.priority);
    }
    if (!userEditedFields.has("status")) {
      setDraftStatus(actionPlan.status);
      // Also clear status remarks if status wasn't user-edited
      setDraftStatusRemarks("");
    }
    if (!userEditedFields.has("closed_at")) {
      setDraftClosedAt(actionPlan.closed_at);
    }
    if (!userEditedFields.has("closure_remarks")) {
      setDraftClosureRemarks(actionPlan.closure_remarks ?? "");
    }

    // Development mode logging when preserving unsaved changes
    if (process.env.NODE_ENV === "development" && userEditedFields.size > 0) {
      console.warn(
        "[ActionPlan] Background refresh with unsaved changes. Preserving:",
        Array.from(userEditedFields),
      );
    }
  }, [actionPlan, userEditedFields]);

  // Auto-set closure date when status changes to Closed/RiskAccepted
  useEffect(() => {
    if ((draftStatus === "Closed" || draftStatus === "RiskAccepted") && !draftClosedAt) {
      setDraftClosedAt(getTodayInputValue());
    }
  }, [draftStatus, draftClosedAt]);

  // Fetch users when includeFormerEmployees toggle changes
  useEffect(() => {
    if (!canManageAssignments) {
      setLocalUserOptions(userOptions);
      return;
    }

    const query = includeFormerEmployees ? "?include_inactive=true" : "";
    fetch(`/api/v1/records/new/options${query}`)
      .then(async (response) => {
        const body = await readResponseBody(response);
        if (!response.ok) {
          return userOptions;
        }

        return body && typeof body === "object" && "users" in body && Array.isArray(body.users)
          ? (body.users as UserOption[])
          : userOptions;
      })
      .then(setLocalUserOptions)
      .catch(() => setLocalUserOptions(userOptions));
  }, [includeFormerEmployees, canManageAssignments, userOptions]);

  // Sync local audit log state
  useEffect(() => {
    setLocalAuditLogOpen(auditLogOpen);
  }, [auditLogOpen, actionPlan.id]);

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        handleCloseRequest();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasUnsavedChanges]);

  // Initialize panel width from localStorage
  useEffect(() => {
    const MIN_WIDTH = 360;
    const getMaxWidth = () => Math.floor(window.innerWidth * 0.6);
    
    const saved = localStorage.getItem("iaTracker.actionPlanPanel.width");
    if (saved) {
      const parsedWidth = Number.parseInt(saved, 10);
      if (!Number.isNaN(parsedWidth)) {
        const clampedWidth = Math.max(MIN_WIDTH, Math.min(parsedWidth, getMaxWidth()));
        setPanelWidth(clampedWidth);
      }
    }
  }, []);

  // Handle viewport resize
  useEffect(() => {
    const MIN_WIDTH = 360;
    const getMaxWidth = () => Math.floor(window.innerWidth * 0.6);

    function handleResize() {
      const maxWidth = getMaxWidth();
      setPanelWidth((current) => Math.min(current, maxWidth));
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Resize handle drag logic
  useEffect(() => {
    const MIN_WIDTH = 360;
    const getMaxWidth = () => Math.floor(window.innerWidth * 0.6);

    function handleMouseMove(event: MouseEvent) {
      if (!isDragging) return;

      const deltaX = dragStartX.current - event.clientX;
      const newWidth = Math.max(MIN_WIDTH, Math.min(dragStartWidth.current + deltaX, getMaxWidth()));

      requestAnimationFrame(() => {
        setPanelWidth(newWidth);
      });
    }

    function handleMouseUp() {
      if (!isDragging) return;

      setIsDragging(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";

      localStorage.setItem("iaTracker.actionPlanPanel.width", String(panelWidth));
    }

    if (isDragging) {
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);

      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, panelWidth]);

  function handleResizeStart(event: React.MouseEvent) {
    event.preventDefault();
    setIsDragging(true);
    dragStartX.current = event.clientX;
    dragStartWidth.current = panelWidth;
  }

  function handleResizeDoubleClick() {
    setPanelWidth(400);
    localStorage.setItem("iaTracker.actionPlanPanel.width", "400");
  }

  function handleResizeKeyDown(event: React.KeyboardEvent) {
    const MIN_WIDTH = 360;
    const getMaxWidth = () => Math.floor(window.innerWidth * 0.6);
    const STEP = 16;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      const newWidth = Math.max(MIN_WIDTH, panelWidth - STEP);
      setPanelWidth(newWidth);
      localStorage.setItem("iaTracker.actionPlanPanel.width", String(newWidth));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      const newWidth = Math.min(getMaxWidth(), panelWidth + STEP);
      setPanelWidth(newWidth);
      localStorage.setItem("iaTracker.actionPlanPanel.width", String(newWidth));
    } else if (event.key === "Home") {
      event.preventDefault();
      setPanelWidth(400);
      localStorage.setItem("iaTracker.actionPlanPanel.width", "400");
    } else if (event.key === "End") {
      event.preventDefault();
      const maxWidth = getMaxWidth();
      setPanelWidth(maxWidth);
      localStorage.setItem("iaTracker.actionPlanPanel.width", String(maxWidth));
    }
  }

  function discardChanges() {
    setDraftTitle(actionPlan.title ?? "");
    setDraftDescription(actionPlan.description);
    setDraftRequiredEvidence(actionPlan.required_evidence ?? "");
    setDraftPriority(actionPlan.priority);
    setDraftStatus(actionPlan.status);
    setDraftStatusRemarks("");
    setDraftClosedAt(actionPlan.closed_at);
    setDraftClosureRemarks(actionPlan.closure_remarks ?? "");
    // Clear edited fields tracking
    setUserEditedFields(new Set());
  }

  async function postMutationAuditLogSync(actionPlan: DashboardActionPlan) {
    const isOpen = auditLogOpen || localAuditLogOpen;
    if (isOpen) {
      await forceReloadAuditLog(actionPlan);
    }
  }

  async function saveChanges() {
    setIsSaving(true);
    const savedValues = {
      title: draftTitle || null,
      description: draftDescription,
      required_evidence: draftRequiredEvidence || null,
      priority: draftPriority,
      status: draftStatus,
      closed_at: draftClosedAt,
      closure_remarks: draftClosureRemarks || null,
    };

    try {
      // Build the patch payload for main action plan fields
      const patch: Record<string, unknown> = {};
      if (draftTitle !== (actionPlan.title ?? "")) patch.title = draftTitle || null;
      if (draftDescription !== actionPlan.description) patch.description = draftDescription;
      if (draftRequiredEvidence !== (actionPlan.required_evidence ?? ""))
        patch.required_evidence = draftRequiredEvidence || null;
      if (draftPriority !== actionPlan.priority) patch.priority = draftPriority;
      if (draftClosureRemarks !== (actionPlan.closure_remarks ?? ""))
        patch.closure_remarks = draftClosureRemarks || null;
      if (draftClosedAt !== actionPlan.closed_at) patch.closed_at = draftClosedAt;

      // Save main fields via PATCH if any changed
      if (Object.keys(patch).length > 0) {
        const response = await fetch(`/api/v1/action-plans/${actionPlan.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const body = await readResponseBody(response);

        if (!response.ok) {
          throw new Error(getResponseError(body, "Unable to save changes."));
        }
      }

      // Save status change separately if changed
      if (draftStatus !== actionPlan.status) {
        const statusPayload: Record<string, unknown> = { new_status: draftStatus };
        // TODO: Wire status remarks when API supports it
        if (draftStatusRemarks.trim()) {
          statusPayload.remarks = draftStatusRemarks.trim();
        }

        const response = await fetch(`/api/v1/action-plans/${actionPlan.id}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(statusPayload),
        });
        const body = await readResponseBody(response);

        if (!response.ok) {
          throw new Error(getResponseError(body, "Unable to save status change."));
        }
      }

      // Update local state
      patchActionPlanLocal(actionPlan.id, savedValues);
      setDraftTitle(savedValues.title ?? "");
      setDraftDescription(savedValues.description);
      setDraftRequiredEvidence(savedValues.required_evidence ?? "");
      setDraftPriority(savedValues.priority);
      setDraftStatus(savedValues.status);
      setDraftStatusRemarks("");
      setDraftClosedAt(savedValues.closed_at);
      setDraftClosureRemarks(savedValues.closure_remarks ?? "");
      // Clear edited fields tracking after successful save
      setUserEditedFields(new Set());

      await postMutationAuditLogSync(actionPlan);

      toast.success("Changes saved successfully");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save changes.");
    } finally {
      setIsSaving(false);
    }
  }

  function handleCloseRequest() {
    if (hasUnsavedChanges) {
      setShowUnsavedDialog(true);
    } else {
      onClose();
    }
  }

  async function saveAndClose() {
    await saveChanges();
    setShowUnsavedDialog(false);
    onClose();
  }

  function discardAndClose() {
    discardChanges();
    setShowUnsavedDialog(false);
    onClose();
  }

  async function handleDelete() {
    setShowDeleteDialog(false);
    try {
      const response = await fetch(`/api/v1/action-plans/${actionPlan.id}`, {
        method: "DELETE",
      });
      const body = await readResponseBody(response);

      if (!response.ok) {
        throw new Error(getResponseError(body, "Unable to delete action plan."));
      }

      toast.success("Action plan deleted successfully");
      onClose();
      await refreshActionPlans();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete action plan.");
    }
  }

  async function reviseTargetDate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!revisionDate) nextErrors.date = "New target date is required.";
    if (!revisionJustification.trim()) nextErrors.justification = "Justification is required.";
    setRevisionErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    try {
      const response = await fetch(`/api/v1/action-plans/${actionPlan.id}/revise-target`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          new_target_date: revisionDate,
          justification: revisionJustification,
        }),
      });
      const body = await readResponseBody(response);

      if (!response.ok) {
        throw new Error(getResponseError(body, "Unable to revise target date."));
      }

      toast.success("Target date revised.");
      patchActionPlanLocal(actionPlan.id, { current_target_date: revisionDate });
      setRevisionOpen(false);
      setRevisionDate("");
      setRevisionJustification("");
      await postMutationAuditLogSync(actionPlan);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to revise target date.");
    }
  }

  async function uploadEvidence(file: File | undefined) {
    if (!file) return;
    setEvidenceError("");
    const formData = new FormData();
    formData.append("file", file);
    if (evidenceDescription.trim()) {
      formData.append("description", evidenceDescription.trim());
    }

    const response = await fetch(`/api/v1/action-plans/${actionPlan.id}/evidence`, {
      method: "POST",
      body: formData,
    });
    const body = await readResponseBody(response);
    if (!response.ok) {
      setEvidenceError(
        typeof body === "object" && body && "error" in body ? String(body.error) : "Unable to upload evidence.",
      );
      return;
    }

    toast.success("Evidence uploaded.");
    setEvidenceDescription("");
    if (evidenceInputRef.current) evidenceInputRef.current.value = "";

    // Update local state
    if (body && typeof body === "object" && "evidence" in body) {
      const newEvidence = body.evidence as DashboardEvidence;
      
      // Development mode warning for missing relations
      if (process.env.NODE_ENV === "development" && !newEvidence.uploaded_by) {
        console.warn("[ActionPlan] Evidence missing uploaded_by relation:", newEvidence.id);
      }
      
      patchActionPlanLocal(actionPlan.id, {
        evidence: [...actionPlan.evidence, newEvidence],
        evidence_count: actionPlan.evidence_count + 1,
      });
    }

    await postMutationAuditLogSync(actionPlan);
  }

  async function deleteEvidence(evidence: DashboardEvidence) {
    try {
      const response = await fetch(
        `/api/v1/action-plans/${actionPlan.id}/evidence/${evidence.id}`,
        { method: "DELETE" },
      );
      const body = await readResponseBody(response);

      if (!response.ok) {
        throw new Error(getResponseError(body, "Unable to delete evidence."));
      }

      toast.success("Evidence deleted.");
      patchActionPlanLocal(actionPlan.id, {
        evidence: actionPlan.evidence.filter((item) => item.id !== evidence.id),
        evidence_count: actionPlan.evidence_count - 1,
      });
      await postMutationAuditLogSync(actionPlan);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete evidence.");
    }
  }

  async function analyzeEvidence(evidence: DashboardEvidence) {
    setAnalyzingEvidenceId(evidence.id);
    setAnalysisErrors((current) => ({ ...current, [evidence.id]: "" }));
    setAnalysisDrafts((current) => {
      const next = { ...current };
      delete next[evidence.id];
      return next;
    });

    try {
      const response = await fetch(
        `/api/v1/action-plans/${actionPlan.id}/evidence/${evidence.id}/analyze`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ evidence_id: evidence.id }),
        },
      );
      const body = await readResponseBody(response);

      if (!response.ok) {
        setAnalysisErrors((current) => ({
          ...current,
          [evidence.id]:
            typeof body === "object" && body && "error" in body ? String(body.error) : "Unable to analyse evidence.",
        }));
        return;
      }

      const analysis =
        body && typeof body === "object" && "analysis" in body ? String(body.analysis ?? "") : "";
      setAnalysisDrafts((current) => ({ ...current, [evidence.id]: analysis }));
    } finally {
      setAnalyzingEvidenceId(null);
    }
  }

  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!comment.trim()) {
      setCommentError("Comment is required.");
      return;
    }

    const createdComment = await postCommentText(comment);
    if (createdComment) {
      addCommentLocal(actionPlan.id, createdComment);
      setComment("");
      await postMutationAuditLogSync(actionPlan);
    }
  }

  async function postCommentText(commentText: string) {
    const response = await fetch(`/api/v1/action-plans/${actionPlan.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment: commentText }),
    });
    const body = await readResponseBody(response);

    if (!response.ok) {
      setCommentError(
        typeof body === "object" && body && "error" in body ? String(body.error) : "Unable to add comment.",
      );
      return null;
    }

    if (body && typeof body === "object" && "comment" in body) {
      return (body as { comment: DashboardComment }).comment;
    }

    return null;
  }

  async function deleteComment(commentId: string) {
    try {
      const response = await fetch(
        `/api/v1/action-plans/${actionPlan.id}/comments/${commentId}`,
        { method: "DELETE" },
      );
      const body = await readResponseBody(response);

      if (!response.ok) {
        throw new Error(getResponseError(body, "Unable to delete comment."));
      }

      toast.success("Comment deleted.");
      patchActionPlanLocal(actionPlan.id, {
        comments: actionPlan.comments.filter((item) => item.id !== commentId),
      });
      await postMutationAuditLogSync(actionPlan);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete comment.");
    }
  }

  async function loadFullComments() {
    try {
      const response = await fetch(`/api/v1/action-plans/${actionPlan.id}/comments`);
      const body = await readResponseBody(response);

      if (!response.ok) {
        throw new Error("Unable to load comments.");
      }

      if (body && typeof body === "object" && "comments" in body && Array.isArray(body.comments)) {
        const fullComments = body.comments as DashboardComment[];
        patchActionPlanLocal(actionPlan.id, { comments: fullComments });
        setTotalCommentCount(fullComments.length);
        setFullCommentsLoaded(true);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load full comments.");
    }
  }

  async function assignOwner(userId: string) {
    const selectedUser = localUserOptions.find((option) => option.id === userId);
    if (!selectedUser) return;

    const response = await fetch(`/api/v1/action-plans/${actionPlan.id}/owners`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, is_primary: actionPlan.action_plan_owners.length === 0 }),
    });
    const body = await readResponseBody(response);

    if (!response.ok) {
      toast.error(getResponseError(body, "Unable to assign owner."));
      return;
    }

    const ownerId =
      body && typeof body === "object" && "owner" in body
        ? String((body as { owner?: { id?: unknown } }).owner?.id ?? userId)
        : userId;
    patchActionPlanLocal(actionPlan.id, {
      action_plan_owners: [
        ...actionPlan.action_plan_owners,
        {
          id: ownerId,
          is_primary: actionPlan.action_plan_owners.length === 0,
          user: selectedUser,
        },
      ],
    });

    await postMutationAuditLogSync(actionPlan);
  }

  async function removeOwner(userId: string) {
    const response = await fetch(
      `/api/v1/action-plans/${actionPlan.id}/owners?user_id=${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
    const body = await readResponseBody(response);

    if (!response.ok) {
      toast.error(getResponseError(body, "Unable to remove owner."));
      return;
    }

    patchActionPlanLocal(actionPlan.id, {
      action_plan_owners: actionPlan.action_plan_owners.filter((owner) => owner.user.id !== userId),
    });

    await postMutationAuditLogSync(actionPlan);
  }

  async function assignFollowUpAuditor(userId: string) {
    const selectedUser = localUserOptions.find((option) => option.id === userId);
    if (!selectedUser) return;

    const response = await fetch(`/api/v1/action-plans/${actionPlan.id}/follow-up-auditors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
    });
    const body = await readResponseBody(response);

    if (!response.ok) {
      toast.error(getResponseError(body, "Unable to assign follow-up auditor."));
      return;
    }

    const auditorId =
      body && typeof body === "object" && "auditor" in body
        ? String((body as { auditor?: { id?: unknown } }).auditor?.id ?? userId)
        : userId;
    patchActionPlanLocal(actionPlan.id, {
      action_plan_follow_up_auditors: [
        ...actionPlan.action_plan_follow_up_auditors,
        {
          id: auditorId,
          user: selectedUser,
        },
      ],
    });

    await postMutationAuditLogSync(actionPlan);
  }

  async function removeFollowUpAuditor(userId: string) {
    const response = await fetch(
      `/api/v1/action-plans/${actionPlan.id}/follow-up-auditors?user_id=${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
    const body = await readResponseBody(response);

    if (!response.ok) {
      toast.error(getResponseError(body, "Unable to remove follow-up auditor."));
      return;
    }

    patchActionPlanLocal(actionPlan.id, {
      action_plan_follow_up_auditors: actionPlan.action_plan_follow_up_auditors.filter(
        (auditor) => auditor.user.id !== userId,
      ),
    });

    await postMutationAuditLogSync(actionPlan);
  }

  async function updateFinding(patch: Record<string, unknown>) {
    if (!actionPlan.finding?.id) return;

    const response = await fetch(`/api/v1/findings/${actionPlan.finding.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = await readResponseBody(response);

    if (!response.ok) {
      throw new Error(getResponseError(body, "Unable to update finding."));
    }

    patchActionPlanLocal(actionPlan.id, {
      finding: actionPlan.finding ? { ...actionPlan.finding, ...patch } : undefined,
    });
  }

  async function suggestEvidenceWithAI() {
    if (!actionPlan.finding) return;

    setIsGeneratingEvidenceSuggestion(true);
    try {
      const response = await fetch("/api/v1/ai/suggest-evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          finding_title: actionPlan.finding.title,
          finding_description: actionPlan.finding.description,
          finding_recommendation: actionPlan.finding.recommendation,
          finding_priority: actionPlan.finding.priority,
          action_plan_description: draftDescription,
          audit_name: audit?.name,
        }),
      });
      const body = await readResponseBody(response);

      if (!response.ok) {
        throw new Error(getResponseError(body, "Unable to generate evidence suggestion."));
      }

      const suggestion =
        body && typeof body === "object" && "required_evidence" in body
          ? String(body.required_evidence)
          : "";

      if (suggestion) {
        setDraftRequiredEvidence(suggestion);
        setUserEditedFields((prev) => new Set(prev).add("required_evidence"));
        toast.success("Evidence suggestion generated.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to generate evidence suggestion.");
    } finally {
      setIsGeneratingEvidenceSuggestion(false);
    }
  }

  async function generateClosureRemarksWithAI() {
    setIsGeneratingClosureRemarks(true);
    try {
      const response = await fetch(`/api/v1/action-plans/${actionPlan.id}/generate-closure-remarks`, {
        method: "POST",
      });
      const body = await readResponseBody(response);

      if (!response.ok) {
        throw new Error(getResponseError(body, "Unable to generate closure remarks."));
      }

      const remarks =
        body && typeof body === "object" && "closure_remarks" in body
          ? String(body.closure_remarks)
          : "";

      if (remarks) {
        setDraftClosureRemarks(remarks);
        setUserEditedFields((prev) => new Set(prev).add("closure_remarks"));
        toast.success("Closure remarks generated.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to generate closure remarks.");
    } finally {
      setIsGeneratingClosureRemarks(false);
    }
  }

  function handleOpenAIAssistant() {
    // Pass the action plan context to the AI assistant
    openAssistant();
  }

  // Helper for file type icons
  function getFileIcon(filename: string) {
    const lower = filename.toLowerCase();
    if (lower.endsWith(".pdf") || lower.includes(".doc")) return "📄";
    if (lower.match(/\.(jpg|jpeg|png|gif|webp)$/)) return "🖼️";
    if (lower.match(/\.(xls|xlsx|csv)$/)) return "📊";
    return "📎";
  }

  return (
    <>
      <ConfirmDialog
        cancelLabel="Discard changes"
        confirmLabel="Save changes"
        isOpen={showUnsavedDialog}
        message={`You have unsaved changes to: ${changedFields.join(", ")}. Would you like to save before closing?`}
        title="Unsaved changes"
        onCancel={discardAndClose}
        onConfirm={saveAndClose}
      />
      <ConfirmDialog
        cancelLabel="Cancel"
        confirmLabel="Delete"
        isOpen={showDeleteDialog}
        isDangerous
        message="This action plan will be permanently deleted. This cannot be undone."
        title="Delete action plan?"
        onCancel={() => setShowDeleteDialog(false)}
        onConfirm={handleDelete}
      />

      <aside className="action-plan-slide-over" ref={panelRef} style={{ width: `${panelWidth}px` }}>
        {/* Resize handle */}
        <div
          ref={resizeHandleRef}
          className="action-plan-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={panelWidth}
          aria-valuemin={360}
          aria-valuemax={Math.floor(window.innerWidth * 0.6)}
          tabIndex={0}
          onMouseDown={handleResizeStart}
          onDoubleClick={handleResizeDoubleClick}
          onKeyDown={handleResizeKeyDown}
        />

        {/* SECTION 3: Panel Header */}
        <header className="action-plan-slide-over__header">
          {/* ROW 1: Identity row */}
          <div className="slide-over-identity-row">
            <span className="slide-over-display-id">{actionPlan.display_id}</span>
            
            <svg
              className="slide-over-completion-ring"
              width="22"
              height="22"
              viewBox="0 0 22 22"
            >
              <title>
                {`Completion: ${completionSignals.join(", ")}${completionSignals.length < 5 ? "\nMissing: " + ["Description filled", "Owner assigned", "Required evidence specified", "Target date set", "Evidence uploaded"].filter(s => !completionSignals.includes(s)).join(", ") : ""}`}
              </title>
              <circle cx="11" cy="11" r="8" fill="none" stroke="#e5e7eb" strokeWidth="2" />
              <circle
                cx="11"
                cy="11"
                r="8"
                fill="none"
                stroke="#16a34a"
                strokeWidth="2"
                strokeDasharray={`${(completionPercent / 100) * 50.27} 50.27`}
                strokeLinecap="round"
                transform="rotate(-90 11 11)"
              />
            </svg>

            {canEditFinding ? (
              <button
                className="slide-over-ai-button"
                onClick={handleOpenAIAssistant}
                type="button"
              >
                ✦ Ask AI
              </button>
            ) : null}

            <button
              className="slide-over-icon-button"
              onClick={async () => {
                const url = `${window.location.origin}/action-plans?expand=${actionPlan.id}`;
                await navigator.clipboard.writeText(url);
                toast.success("Link copied!");
              }}
              title="Copy link to this action plan"
              type="button"
            >
              🔗
            </button>

            {isAdmin ? (
              <button
                className="slide-over-icon-button slide-over-icon-button--danger"
                onClick={() => setShowDeleteDialog(true)}
                title="Delete action plan"
                type="button"
              >
                🗑️
              </button>
            ) : null}

            <button
              className="slide-over-close-button"
              onClick={handleCloseRequest}
              type="button"
            >
              ×
            </button>
          </div>

          {/* ROW 2: Status row */}
          <div className="slide-over-status-row">
            <select
              className="slide-over-status-dropdown"
              disabled={!canEdit}
              value={draftStatus}
              onChange={(event) => {
                setDraftStatus(event.target.value as Status);
                setUserEditedFields((prev) => new Set(prev).add("status"));
              }}
              style={{
                borderColor: STATUS_ACCENTS[draftStatus],
                color: STATUS_ACCENTS[draftStatus],
              }}
            >
              {STATUS_ORDER.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>

            {draftStatus !== "RiskAccepted" && draftStatus !== "Dropped" ? (
              <>
                <span className="slide-over-due-chip">
                  {formatDate(actionPlan.current_target_date)}
                  {actionPlan.is_overdue ? ` (Overdue ${actionPlan.days_overdue}d)` : ""}
                </span>
                
                {actionPlan.reschedule_count > 0 ? (
                  <span className="slide-over-reschedule-badge">
                    Rescheduled ×{actionPlan.reschedule_count}
                  </span>
                ) : null}

                <button
                  className="button slide-over-reschedule-button"
                  disabled={!canEdit}
                  onClick={() => setRevisionOpen((current) => !current)}
                  type="button"
                >
                  {revisionOpen ? "Cancel" : "Reschedule"}
                </button>
              </>
            ) : null}
          </div>

          {/* ROW 3: Status remarks (conditional) */}
          {draftStatus !== actionPlan.status ? (
            <div className="slide-over-status-remarks-row">
              <label htmlFor="status-remarks">Status change remarks (optional)</label>
              <input
                id="status-remarks"
                type="text"
                placeholder="Why is the status changing?"
                value={draftStatusRemarks}
                onChange={(event) => {
                  setDraftStatusRemarks(event.target.value);
                  // Status remarks are tied to status change, so mark status as edited
                  setUserEditedFields((prev) => new Set(prev).add("status"));
                }}
                disabled={!canEdit}
              />
            </div>
          ) : null}

          {/* ROW 4: Reschedule form (conditional) */}
          {revisionOpen ? (
            <form
              className="slide-over-reschedule-form"
              onSubmit={reviseTargetDate}
            >
              <div>
                <label htmlFor="revision-date">New target date</label>
                <input
                  id="revision-date"
                  type="date"
                  value={revisionDate}
                  onChange={(event) => {
                    setRevisionDate(event.target.value);
                    setRevisionErrors((current) => ({ ...current, date: "" }));
                  }}
                  style={{
                    borderColor: revisionErrors.date ? "var(--red)" : undefined,
                  }}
                />
                {revisionErrors.date ? (
                  <span className="field-error">{revisionErrors.date}</span>
                ) : null}
              </div>

              <div>
                <label htmlFor="revision-justification">Justification</label>
                <input
                  id="revision-justification"
                  type="text"
                  placeholder="Why is this date being changed?"
                  value={revisionJustification}
                  onChange={(event) => {
                    setRevisionJustification(event.target.value);
                    setRevisionErrors((current) => ({ ...current, justification: "" }));
                  }}
                  style={{
                    borderColor: revisionErrors.justification ? "var(--red)" : undefined,
                  }}
                />
                {revisionErrors.justification ? (
                  <span className="field-error">{revisionErrors.justification}</span>
                ) : null}
              </div>

              <button className="button button--primary" type="submit">
                Submit
              </button>

              <button
                className="button"
                type="button"
                onClick={() => {
                  setRevisionOpen(false);
                  setRevisionDate("");
                  setRevisionJustification("");
                  setRevisionErrors({});
                }}
              >
                Cancel
              </button>
            </form>
          ) : null}

          {/* ROW 5: Context strip */}
          <div className="slide-over-context-strip">
            {audit ? (
              <>
                <span>{audit.name}</span>
                {audit.reference_number ? (
                  <span className="context-chip">{audit.reference_number}</span>
                ) : null}
                <AuditTypeBadge auditType={audit.audit_type} />
                {audit.audit_entities.map(({ entity }) => (
                  <span key={entity.id} className="context-chip">
                    {entity.code} ({entity.country ?? "Unknown"})
                  </span>
                ))}
              </>
            ) : (
              <span>Standalone action plan</span>
            )}
            <span className="context-chip">{actionPlan.created_via}</span>
            {actionPlan.was_implemented_at_issuance ? (
              <span className="context-chip">✓ Implemented at issuance</span>
            ) : null}
          </div>
        </header>

        {/* SECTION 4: Tabs */}
        <nav className="slide-over-tabs">
          <button
            className={activeTab === "details" ? "slide-over-tab slide-over-tab--active" : "slide-over-tab"}
            onClick={() => setActiveTab("details")}
            type="button"
          >
            Details
          </button>
          <button
            className={activeTab === "people" ? "slide-over-tab slide-over-tab--active" : "slide-over-tab"}
            onClick={() => setActiveTab("people")}
            type="button"
          >
            People
            {actionPlan.action_plan_owners.length === 0 ? (
              <span className="slide-over-tab-badge slide-over-tab-badge--warning" />
            ) : null}
          </button>
          <button
            className={activeTab === "evidence" ? "slide-over-tab slide-over-tab--active" : "slide-over-tab"}
            onClick={() => setActiveTab("evidence")}
            type="button"
          >
            Evidence
            {actionPlan.evidence_count > 0 ? (
              <span className="slide-over-tab-badge">{actionPlan.evidence_count}</span>
            ) : null}
          </button>
          <button
            className={activeTab === "activity" ? "slide-over-tab slide-over-tab--active" : "slide-over-tab"}
            onClick={() => setActiveTab("activity")}
            type="button"
          >
            Activity
            {actionPlan.comments.length > 0 ? (
              <span className="slide-over-tab-badge">{actionPlan.comments.length}</span>
            ) : null}
          </button>
        </nav>

        {/* Tab content */}
        <div className="slide-over-body">
          {/* SECTION 5: Details Tab */}
          {activeTab === "details" ? (
            <div className="slide-over-tab-content">
              {/* 1. Title input */}
              <div className="detail-field">
                <label>Title (optional)</label>
                <input
                  type="text"
                  placeholder="Optional action plan title..."
                  value={draftTitle}
                  onChange={(event) => {
                    setDraftTitle(event.target.value);
                    setUserEditedFields((prev) => new Set(prev).add("title"));
                  }}
                  disabled={!canEdit}
                />
              </div>

              {/* 2. Description textarea */}
              <div className="detail-field">
                <label>Action plan</label>
                <textarea
                  value={draftDescription}
                  onChange={(event) => {
                    setDraftDescription(event.target.value);
                    setUserEditedFields((prev) => new Set(prev).add("description"));
                  }}
                  disabled={!canEdit}
                  style={{ minHeight: "100px" }}
                />
              </div>

              {/* 3. Required evidence + AI suggest */}
              <div className="detail-field">
                <label>
                  Required evidence
                  {canEditFinding ? (
                    <button
                      className="slide-over-ai-button slide-over-ai-button--inline"
                      onClick={suggestEvidenceWithAI}
                      disabled={isGeneratingEvidenceSuggestion}
                      type="button"
                    >
                      {isGeneratingEvidenceSuggestion ? "◌ Generating…" : "✦ Suggest with AI"}
                    </button>
                  ) : null}
                </label>
                <textarea
                  value={draftRequiredEvidence}
                  onChange={(event) => {
                    setDraftRequiredEvidence(event.target.value);
                    setUserEditedFields((prev) => new Set(prev).add("required_evidence"));
                  }}
                  disabled={!canEdit}
                  placeholder="Specify what evidence should be provided..."
                  style={{ minHeight: "80px" }}
                />
              </div>

              {/* 4. Priority dropdown */}
              <div className="detail-field">
                <label>Priority</label>
                <select
                  value={draftPriority ?? ""}
                  onChange={(event) => {
                    setDraftPriority((event.target.value || null) as Priority | null);
                    setUserEditedFields((prev) => new Set(prev).add("priority"));
                  }}
                  disabled={!canEdit}
                >
                  <option value="">Not set</option>
                  {PRIORITY_OPTIONS.filter((p): p is Priority => p !== null).map((priority) => (
                    <option key={priority} value={priority}>
                      {priority}
                    </option>
                  ))}
                </select>
              </div>

              {/* 5. Target dates section */}
              <div className="detail-field">
                <label>Target dates</label>
                <div className="target-dates-display">
                  <span>Original: {formatDate(actionPlan.original_target_date)}</span>
                  <span>
                    Current: {formatDate(actionPlan.current_target_date)}
                    {actionPlan.is_overdue ? (
                      <strong style={{ color: "var(--red)" }}>
                        {" "}
                        (Overdue {actionPlan.days_overdue}d)
                      </strong>
                    ) : null}
                  </span>
                  {actionPlan.reschedule_count > 0 ? (
                    <button
                      className="revision-history-toggle"
                      onClick={() => setRevisionHistoryOpen((current) => !current)}
                      type="button"
                    >
                      {revisionHistoryOpen ? "Hide" : "Show"} revision history ({actionPlan.target_date_revisions.length})
                    </button>
                  ) : null}
                </div>
                {revisionHistoryOpen && actionPlan.target_date_revisions.length > 0 ? (
                  <div className="revision-history">
                    {actionPlan.target_date_revisions.map((revision) => (
                      <div key={revision.id} className="revision-history-item">
                        <strong>
                          {formatDate(revision.old_date)} → {formatDate(revision.new_date)}
                        </strong>
                        <em>{revision.justification}</em>
                        <span>
                          Revised by {revision.revised_by?.name ?? "Unknown user"} on {formatDate(revision.revised_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* 6. Closure section (conditional) */}
              {draftStatus === "Closed" || draftStatus === "RiskAccepted" ? (
                <>
                  <div className="detail-field">
                    <label>Closure date</label>
                    <input
                      type="date"
                      max={getTodayInputValue()}
                      value={formatDateInputValue(draftClosedAt) || getTodayInputValue()}
                      onChange={(event) => {
                        setDraftClosedAt(event.target.value || null);
                        setUserEditedFields((prev) => new Set(prev).add("closed_at"));
                      }}
                      disabled={!canEdit}
                    />
                  </div>

                  <div className="detail-field">
                    <label>
                      Closure remarks
                      {canEditFinding ? (
                        <button
                          className="slide-over-ai-button slide-over-ai-button--inline"
                          onClick={generateClosureRemarksWithAI}
                          disabled={isGeneratingClosureRemarks}
                          type="button"
                        >
                          {isGeneratingClosureRemarks ? "◌ Drafting…" : "✦ Draft with AI"}
                        </button>
                      ) : null}
                    </label>
                    <textarea
                      value={draftClosureRemarks}
                      onChange={(event) => {
                        setDraftClosureRemarks(event.target.value);
                        setUserEditedFields((prev) => new Set(prev).add("closure_remarks"));
                      }}
                      disabled={!canEdit}
                      placeholder="Describe how this action plan was closed..."
                      style={{ minHeight: "100px" }}
                    />
                  </div>
                </>
              ) : null}

              {/* 7. Finding context section */}
              <div className="detail-field">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <label>Finding context</label>
                  <button
                    className="revision-history-toggle"
                    onClick={() => setFindingExpanded((current) => !current)}
                    type="button"
                  >
                    {findingExpanded ? "Collapse" : "Expand"}
                  </button>
                </div>
                <div className="finding-context-preview">
                  <strong>{actionPlan.finding?.title ?? "No finding linked"}</strong>
                  <p style={{ 
                    display: "-webkit-box",
                    WebkitLineClamp: findingExpanded ? "unset" : 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}>
                    {actionPlan.finding?.description ?? "No description"}
                  </p>
                </div>

                {findingExpanded && actionPlan.finding && canEditFinding ? (
                  <div className="finding-edit-fields">
                    <div className="detail-field">
                      <label>Root cause</label>
                      <textarea
                        value={actionPlan.finding.root_cause ?? ""}
                        onChange={(event) => updateFinding({ root_cause: event.target.value })}
                        placeholder="What caused this finding?"
                        style={{ minHeight: "60px" }}
                      />
                    </div>

                    <div className="detail-field">
                      <label>Potential impact</label>
                      <textarea
                        value={actionPlan.finding.potential_impact ?? ""}
                        onChange={(event) => updateFinding({ potential_impact: event.target.value })}
                        placeholder="What are the potential consequences?"
                        style={{ minHeight: "60px" }}
                      />
                    </div>

                    <div className="detail-field">
                      <label>Recommendation</label>
                      <textarea
                        value={actionPlan.finding.recommendation ?? ""}
                        onChange={(event) => updateFinding({ recommendation: event.target.value })}
                        placeholder="What actions should be taken?"
                        style={{ minHeight: "60px" }}
                      />
                    </div>

                    <div className="detail-field">
                      <label>Control rating</label>
                      <select
                        value={actionPlan.finding.control_rating ?? ""}
                        onChange={(event) =>
                          updateFinding({ control_rating: event.target.value || null })
                        }
                      >
                        <option value="">Not set</option>
                        {CONTROL_RATING_OPTIONS.filter((r): r is string => r !== null).map((rating) => (
                          <option key={rating} value={rating}>
                            {rating.replace(/([A-Z])/g, " $1").trim()}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="detail-field">
                      <label>External reference</label>
                      <input
                        type="text"
                        value={actionPlan.finding.external_ref ?? ""}
                        onChange={(event) => updateFinding({ external_ref: event.target.value })}
                        placeholder="External tracking ID or reference..."
                      />
                    </div>
                  </div>
                ) : null}

                {actionPlan.finding ? (
                  <div className="finding-metadata">
                    <span className="context-chip">
                      Priority: {actionPlan.finding.priority ?? "Not set"}
                    </span>
                    <span className="context-chip">
                      Issued: {formatDate(audit?.report_issue_date ?? null)}
                    </span>
                  </div>
                ) : null}
              </div>

              {/* 8. Audit info section */}
              {audit ? (
                <div className="detail-field">
                  <label>Audit info</label>
                  <div className="audit-info-display">
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <strong>{audit.name}</strong>
                      <AuditTypeBadge auditType={audit.audit_type} />
                      <a
                        href={`/audits/${audit.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="slide-over-link"
                      >
                        View Audit →
                      </a>
                    </div>
                    {audit.reference_number ? (
                      <p>Reference: {audit.reference_number}</p>
                    ) : null}
                    {audit.report_issue_date ? (
                      <p>Report issue date: {formatDate(audit.report_issue_date)}</p>
                    ) : null}
                    {audit.audit_entities.length > 0 ? (
                      <p>
                        Entities:{" "}
                        {audit.audit_entities
                          .map(({ entity }) => `${entity.code} (${entity.country ?? "Unknown"})`)
                          .join(", ")}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* SECTION 6: People Tab */}
          {activeTab === "people" ? (
            <div className="slide-over-tab-content">
              {/* Owners section */}
              <div className="detail-field">
                <label>Owners</label>
                {actionPlan.action_plan_owners.length > 0 ? (
                  <div className="people-list">
                    {actionPlan.action_plan_owners.map((owner) => (
                      <PersonRow
                        key={owner.id}
                        user={owner.user}
                        roleBadge={owner.is_primary ? "Primary" : "Owner"}
                        canRemove={canManageAssignments}
                        onRemove={() => removeOwner(owner.user.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <p style={{ color: "var(--text3)", fontSize: "13px" }}>No owners assigned yet</p>
                )}

                {canManageAssignments ? (
                  assigningType === "owner" ? (
                    <div className="assignment-inline-form">
                      <label style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                        <input
                          type="checkbox"
                          checked={includeFormerEmployees}
                          onChange={(event) => setIncludeFormerEmployees(event.target.checked)}
                        />
                        Include former employees
                      </label>
                      <select
                        defaultValue=""
                        onChange={(event) => {
                          if (event.target.value) {
                            assignOwner(event.target.value);
                            setAssigningType(null);
                          }
                        }}
                      >
                        <option disabled value="">
                          Select owner...
                        </option>
                        {localUserOptions
                          .filter((u) => !actionPlan.action_plan_owners.some((o) => o.user.id === u.id))
                          .reduce((acc, option, index, arr) => {
                            const prevOption = arr[index - 1];
                            if (prevOption?.is_active && !option.is_active) {
                              acc.push(
                                <option key="divider" disabled style={{ borderTop: "1px solid var(--border)", padding: "0" }}>
                                  ──────────
                                </option>
                              );
                            }
                            acc.push(
                              <option 
                                key={option.id} 
                                value={option.id}
                                style={!option.is_active ? { color: "var(--text3)" } : undefined}
                              >
                                {option.name}{!option.is_active ? " (former)" : ""}
                                {option.department ? ` - ${option.department}` : ""}
                              </option>
                            );
                            return acc;
                          }, [] as JSX.Element[])}
                      </select>
                      <button onClick={() => setAssigningType(null)} type="button">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      className="assignment-add-button"
                      onClick={() => setAssigningType("owner")}
                      type="button"
                    >
                      + Assign Owner
                    </button>
                  )
                ) : null}
              </div>

              {/* Follow-up auditors section */}
              <div className="detail-field">
                <label>Follow-up auditors</label>
                {actionPlan.action_plan_follow_up_auditors.length > 0 ? (
                  <div className="people-list">
                    {actionPlan.action_plan_follow_up_auditors.map((auditor) => (
                      <PersonRow
                        key={auditor.id}
                        user={auditor.user}
                        roleBadge="Follow-up Auditor"
                        canRemove={canManageAssignments}
                        onRemove={() => removeFollowUpAuditor(auditor.user.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <p style={{ color: "var(--text3)", fontSize: "13px" }}>No follow-up auditors assigned</p>
                )}

                {canManageAssignments ? (
                  assigningType === "auditor" ? (
                    <div className="assignment-inline-form">
                      <label style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                        <input
                          type="checkbox"
                          checked={includeFormerEmployees}
                          onChange={(event) => setIncludeFormerEmployees(event.target.checked)}
                        />
                        Include former employees
                      </label>
                      <select
                        defaultValue=""
                        onChange={(event) => {
                          if (event.target.value) {
                            assignFollowUpAuditor(event.target.value);
                            setAssigningType(null);
                          }
                        }}
                      >
                        <option disabled value="">
                          Select auditor...
                        </option>
                        {localUserOptions
                          .filter(
                            (u) =>
                              u.is_internal_auditor &&
                              !actionPlan.action_plan_follow_up_auditors.some((a) => a.user.id === u.id),
                          )
                          .reduce((acc, option, index, arr) => {
                            const prevOption = arr[index - 1];
                            if (prevOption?.is_active && !option.is_active) {
                              acc.push(
                                <option key="divider" disabled style={{ borderTop: "1px solid var(--border)", padding: "0" }}>
                                  ──────────
                                </option>
                              );
                            }
                            acc.push(
                              <option 
                                key={option.id} 
                                value={option.id}
                                style={!option.is_active ? { color: "var(--text3)" } : undefined}
                              >
                                {option.name}{!option.is_active ? " (former)" : ""}
                                {option.department ? ` - ${option.department}` : ""}
                              </option>
                            );
                            return acc;
                          }, [] as JSX.Element[])}
                      </select>
                      <button onClick={() => setAssigningType(null)} type="button">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      className="assignment-add-button"
                      onClick={() => setAssigningType("auditor")}
                      type="button"
                    >
                      + Assign Follow-up Auditor
                    </button>
                  )
                ) : null}
              </div>

              {/* Line managers section */}
              <div className="detail-field">
                <label>Line managers (read-only)</label>
                {actionPlan.action_plan_line_managers.length > 0 ? (
                  <div className="people-list">
                    {actionPlan.action_plan_line_managers.map((manager) => (
                      <PersonRow
                        key={manager.id}
                        user={manager.user}
                        roleBadge="Line Manager"
                        canRemove={false}
                        onRemove={() => {}}
                      />
                    ))}
                  </div>
                ) : (
                  <p style={{ color: "var(--text3)", fontSize: "13px" }}>No line managers linked</p>
                )}
              </div>

              {/* Metadata row */}
              <div className="detail-field" style={{ borderTop: "1px solid var(--border)", paddingTop: "16px" }}>
                <label>Metadata</label>
                <div className="metadata-chips">
                  <span className="context-chip">{actionPlan.created_via}</span>
                  {actionPlan.was_implemented_at_issuance ? (
                    <span className="context-chip">✓ Implemented at issuance</span>
                  ) : null}
                  <span className="context-chip">Created: {formatDate(actionPlan.created_at)}</span>
                  <span className="context-chip">Updated: {formatDate(actionPlan.updated_at)}</span>
                </div>
              </div>
            </div>
          ) : null}

          {/* SECTION 7: Evidence Tab */}
          {activeTab === "evidence" ? (
            <div className="slide-over-tab-content">
              {/* Required evidence display */}
              <div className="detail-field">
                <label>Required evidence</label>
                {actionPlan.required_evidence ? (
                  <p style={{ whiteSpace: "pre-wrap" }}>{actionPlan.required_evidence}</p>
                ) : (
                  <p style={{ color: "var(--text3)" }}>
                    Not specified yet. Set this on the Details tab.
                  </p>
                )}
              </div>

              {/* Upload dropzone */}
              {canEdit ? (
                <div className="detail-field">
                  <div
                    className="evidence-dropzone"
                    onClick={() => evidenceInputRef.current?.click()}
                  >
                    <span className="evidence-dropzone-icon">📎</span>
                    <span className="evidence-dropzone-text">
                      Click to upload or drag and drop
                    </span>
                    <input
                      className="evidence-description-input"
                      type="text"
                      placeholder="What does this file show? (optional)"
                      value={evidenceDescription}
                      onChange={(event) => setEvidenceDescription(event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                    />
                  </div>
                  <input
                    hidden
                    ref={evidenceInputRef}
                    type="file"
                    onChange={(event) => uploadEvidence(event.target.files?.[0])}
                  />
                  {evidenceError ? <span className="field-error">{evidenceError}</span> : null}
                </div>
              ) : null}

              {/* Uploaded files list */}
              {actionPlan.evidence.length > 0 ? (
                <div className="detail-field">
                  <label>Uploaded files ({actionPlan.evidence_count})</label>
                  <div className="evidence-list">
                    {actionPlan.evidence.map((evidence) => (
                      <div key={evidence.id} className="evidence-item">
                        <div className="evidence-item-header">
                          <span className="evidence-icon">{getFileIcon(evidence.original_name)}</span>
                          <div className="evidence-item-info">
                            <a
                              href={`/api/v1/action-plans/${actionPlan.id}/evidence/${evidence.id}/download`}
                              rel="noreferrer"
                              target="_blank"
                              className="evidence-filename"
                            >
                              {evidence.original_name}
                            </a>
                            <div className="evidence-meta">
                              {formatFileSize(evidence.file_size)} · {evidence.uploaded_by?.name ?? "Unknown user"} ·{" "}
                              {formatDate(evidence.created_at)}
                              {evidence.description ? (
                                <>
                                  {" · "}
                                  <em>{evidence.description}</em>
                                </>
                              ) : null}
                            </div>
                          </div>
                          <div className="evidence-item-actions">
                            <button
                              className="evidence-action-button"
                              onClick={() => setPreviewEvidence(evidence)}
                              type="button"
                            >
                              Preview
                            </button>
                            {canEditFinding ? (
                              <button
                                className="evidence-action-button evidence-action-button--ai"
                                onClick={() => analyzeEvidence(evidence)}
                                disabled={analyzingEvidenceId === evidence.id}
                                type="button"
                              >
                                {analyzingEvidenceId === evidence.id ? "◌ Analyzing…" : "✦ AI"}
                              </button>
                            ) : null}
                            {canEditFinding ? (
                              <button
                                className="evidence-action-button evidence-action-button--danger"
                                onClick={() => {
                                  if (confirm(`Delete ${evidence.original_name}?`)) {
                                    deleteEvidence(evidence);
                                  }
                                }}
                                type="button"
                              >
                                ×
                              </button>
                            ) : null}
                          </div>
                        </div>

                        {analysisErrors[evidence.id] ? (
                          <div className="field-error">{analysisErrors[evidence.id]}</div>
                        ) : null}

                        {analysisDrafts[evidence.id] !== undefined ? (
                          <div className="evidence-analysis-draft">
                            <textarea
                              value={analysisDrafts[evidence.id]}
                              onChange={(event) =>
                                setAnalysisDrafts((current) => ({
                                  ...current,
                                  [evidence.id]: event.target.value,
                                }))
                              }
                              style={{ minHeight: "120px" }}
                            />
                            <div style={{ display: "flex", gap: "8px" }}>
                              <button
                                className="button button--primary"
                                onClick={async () => {
                                  const analysis = analysisDrafts[evidence.id]?.trim();
                                  if (!analysis) return;
                                  const createdComment = await postCommentText(
                                    `AI Evidence Analysis — ${evidence.original_name}:\n\n${analysis}`,
                                  );
                                  if (createdComment) {
                                    addCommentLocal(actionPlan.id, createdComment);
                                    setAnalysisDrafts((current) => {
                                      const next = { ...current };
                                      delete next[evidence.id];
                                      return next;
                                    });
                                    toast.success("Analysis saved to comments");
                                  }
                                }}
                                type="button"
                              >
                                Save as Comment
                              </button>
                              <button
                                className="button"
                                onClick={() =>
                                  setAnalysisDrafts((current) => {
                                    const next = { ...current };
                                    delete next[evidence.id];
                                    return next;
                                  })
                                }
                                type="button"
                              >
                                Dismiss
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <EmptyState title="No evidence uploaded yet" subtitle="Upload files to document this action plan." />
              )}
            </div>
          ) : null}

          {/* SECTION 8: Activity Tab */}
          {activeTab === "activity" ? (
            <div className="slide-over-tab-content">
              {/* Comments section */}
              <div className="detail-field">
                <label>
                  Comments
                  {totalCommentCount > actionPlan.comments.length && !fullCommentsLoaded ? (
                    <span style={{ fontSize: "12px", color: "var(--text3)", fontWeight: "normal" }}>
                      {" "}
                      (showing {actionPlan.comments.length} of {totalCommentCount})
                    </span>
                  ) : null}
                </label>

                {totalCommentCount > actionPlan.comments.length && !fullCommentsLoaded ? (
                  <button
                    className="button"
                    onClick={loadFullComments}
                    type="button"
                    style={{ marginBottom: "12px" }}
                  >
                    Show all {totalCommentCount} comments
                  </button>
                ) : null}

                {actionPlan.comments.length > 0 ? (
                  <div className="comments-list">
                    {actionPlan.comments.map((item) => (
                      <div key={item.id} className="comment-item">
                        <div className="comment-header">
                          <strong>{item.user?.name ?? "Unknown user"}</strong>
                          <span className="comment-date">{formatDateTime(item.created_at)}</span>
                          {(user?.id === item.user?.id || user?.role === "AuditTeam") ? (
                            <button
                              className="comment-delete"
                              onClick={() => {
                                if (confirm("Delete this comment?")) {
                                  deleteComment(item.id);
                                }
                              }}
                              type="button"
                            >
                              ×
                            </button>
                          ) : null}
                        </div>
                        <p className="comment-text">{item.comment}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No comments yet" subtitle="Comments and discussion notes will appear here." />
                )}

                {canEdit ? (
                  <form className="comment-form" onSubmit={addComment}>
                    <input
                      className={commentError ? "input-error" : undefined}
                      placeholder="Add a comment..."
                      value={comment}
                      onChange={(event) => {
                        setComment(event.target.value);
                        setCommentError("");
                      }}
                    />
                    <button className="button" type="submit">
                      Add
                    </button>
                    {commentError ? <span className="field-error">{commentError}</span> : null}
                  </form>
                ) : null}
              </div>

              {/* Audit log section */}
              <div className="detail-field" style={{ borderTop: "1px solid var(--border)", paddingTop: "16px" }}>
                <button
                  className="audit-log-toggle"
                  onClick={() => {
                    if (localAuditLogOpen) {
                      setLocalAuditLogOpen(false);
                    } else {
                      loadAuditLog(actionPlan);
                      setLocalAuditLogOpen(true);
                    }
                  }}
                  type="button"
                >
                  {localAuditLogOpen ? "Hide audit log" : "Show audit log"}
                </button>
                {localAuditLogOpen ? (
                  auditLogs.length > 0 ? (
                    <div className="audit-log-timeline">
                      {auditLogs.map((entry, index) => {
                        const color = getAuditLogColor(entry.action);
                        const formatted = formatAuditLogEntry(entry);
                        const lines = formatted.split("\n");
                        const title = lines[0];
                        const detail = lines.slice(1).join("\n").trim();

                        return (
                          <div key={entry.id} className="audit-log-entry">
                            <div className="audit-log-dot-container">
                              <span
                                className="audit-log-dot"
                                style={{ backgroundColor: color }}
                              />
                              {index < auditLogs.length - 1 ? (
                                <span className="audit-log-line" />
                              ) : null}
                            </div>
                            <div className="audit-log-content">
                              <span className="audit-log-title">{title}</span>
                              {detail ? (
                                <span className="audit-log-detail">{detail}</span>
                              ) : null}
                              <span className="audit-log-meta">
                                {entry.user?.name ?? "System"} · {formatDate(entry.created_at)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <EmptyState title="No audit log yet" subtitle="Changes to this action plan will appear here." />
                  )
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        {/* SECTION 9: Sticky Footer */}
        <footer className="slide-over-footer">
          {hasUnsavedChanges ? (
            <>
              <div className="slide-over-unsaved-chip">
                Unsaved: {changedFields.join(", ")}
              </div>
              <div className="slide-over-footer-actions">
                <button
                  className="button"
                  disabled={isSaving}
                  onClick={discardChanges}
                  type="button"
                >
                  Discard
                </button>
                <button
                  className="button button--primary"
                  disabled={isSaving}
                  onClick={saveChanges}
                  type="button"
                >
                  {isSaving ? "Saving..." : "Save changes"}
                </button>
                <button
                  className="button"
                  disabled={isSaving}
                  onClick={handleCloseRequest}
                  type="button"
                >
                  Close
                </button>
              </div>
            </>
          ) : (
            <div className="slide-over-footer-actions" style={{ marginLeft: "auto" }}>
              <button className="button" onClick={onClose} type="button">
                Close
              </button>
            </div>
          )}
        </footer>
      </aside>

      {/* Evidence preview modal */}
      {previewEvidence ? (
        <div
          className="evidence-preview-modal"
          onClick={() => setPreviewEvidence(null)}
        >
          <div
            className="evidence-preview-content"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="evidence-preview-header">
              <strong>{previewEvidence.original_name}</strong>
              <button onClick={() => setPreviewEvidence(null)} type="button">
                ×
              </button>
            </div>
            <div className="evidence-preview-body">
              {previewEvidence.original_name.toLowerCase().endsWith(".pdf") ? (
                <iframe
                  src={`/api/v1/action-plans/${actionPlan.id}/evidence/${previewEvidence.id}/download`}
                  style={{ width: "100%", height: "100%", border: "none" }}
                  title="PDF preview"
                />
              ) : previewEvidence.original_name.toLowerCase().match(/\.(jpg|jpeg|png|gif|webp)$/) ? (
                <img
                  alt={previewEvidence.original_name}
                  src={`/api/v1/action-plans/${actionPlan.id}/evidence/${previewEvidence.id}/download`}
                  style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                />
              ) : (
                <div style={{ textAlign: "center", padding: "60px 20px" }}>
                  <p style={{ color: "var(--text3)", marginBottom: "20px" }}>
                    This file type cannot be previewed — download instead.
                  </p>
                  <a
                    href={`/api/v1/action-plans/${actionPlan.id}/evidence/${previewEvidence.id}/download`}
                    className="button button--primary"
                    download
                  >
                    Download {previewEvidence.original_name}
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

// SECTION 6 Helper: Person row with hover tooltip
function PersonRow({
  user,
  roleBadge,
  canRemove,
  onRemove,
}: {
  user: RelatedUser;
  roleBadge: string;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  function handleMouseEnter(event: React.MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const tooltipWidth = 250;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x = rect.left - tooltipWidth - 10;
    let y = rect.top;

    // Flip right if would overflow left
    if (x < 0) {
      x = rect.right + 10;
    }

    // Flip up if would overflow bottom
    const estimatedHeight = 150;
    if (y + estimatedHeight > viewportHeight) {
      y = Math.max(0, viewportHeight - estimatedHeight - 10);
    }

    setTooltipPos({ x, y });
    setShowTooltip(true);
  }

  return (
    <>
      <div
        className="person-row"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <span 
          className="person-avatar"
          style={user.is_active === false ? { opacity: 0.7 } : undefined}
        >
          {getInitials(user.name)}
        </span>
        <span 
          className="person-name"
          style={user.is_active === false ? { color: "var(--text3)" } : undefined}
        >
          {user.name}{user.is_active === false ? " (former)" : ""}
        </span>
        <span className={`person-role-badge person-role-badge--${roleBadge.toLowerCase().replace(/\s+/g, "-")}`}>
          {roleBadge}
        </span>
        {canRemove ? (
          <button
            className="person-remove-button"
            onClick={onRemove}
            type="button"
          >
            ×
          </button>
        ) : null}
      </div>

      {showTooltip ? (
        <div
          className="person-tooltip"
          style={{
            position: "fixed",
            left: `${tooltipPos.x}px`,
            top: `${tooltipPos.y}px`,
          }}
        >
          <div className="person-tooltip-header">{user.name}</div>
          {user.job_title ? (
            <div className="person-tooltip-row">
              <strong>Title:</strong> {user.job_title}
            </div>
          ) : null}
          {user.department ? (
            <div className="person-tooltip-row">
              <strong>Department:</strong> {user.department}
            </div>
          ) : null}
          {user.team_l1 ? (
            <div className="person-tooltip-row">
              <strong>Team L1:</strong> {user.team_l1}
            </div>
          ) : null}
          {user.manager_name ? (
            <div className="person-tooltip-row">
              <strong>Manager:</strong> {user.manager_name}
            </div>
          ) : null}
          {user.email ? (
            <div className="person-tooltip-row">
              <strong>Email:</strong>{" "}
              <a href={`mailto:${user.email}`} style={{ color: "#2563eb" }}>
                {user.email}
              </a>
            </div>
          ) : null}
          <div className="person-tooltip-divider" />
          <div className="person-tooltip-row">
            {user.is_active === false ? (
              <>
                <span className="person-status-dot" style={{ backgroundColor: "#71717a" }} />
                Inactive
              </>
            ) : (
              <>
                <span className="person-status-dot person-status-dot--active" />
                Active
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
