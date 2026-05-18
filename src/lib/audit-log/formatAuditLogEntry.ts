import { STATUS_LABELS } from "../constants";
import { formatAuditType } from "../audit-type-mapping";

type Status = keyof typeof STATUS_LABELS;

export type AuditLogLike = {
  action: string;
  before_json: unknown;
  after_json: unknown;
};

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function getJsonString(value: unknown, key: string) {
  if (!isJsonRecord(value)) {
    return null;
  }

  const item = value[key];
  return typeof item === "string" ? item : null;
}

function getJsonNumber(value: unknown, key: string) {
  if (!isJsonRecord(value)) {
    return null;
  }

  const item = value[key];
  return typeof item === "number" ? item : null;
}

function getJsonBoolean(value: unknown, key: string) {
  if (!isJsonRecord(value)) {
    return false;
  }

  return value[key] === true;
}

function getJsonArray(value: unknown, key: string) {
  if (!isJsonRecord(value)) {
    return null;
  }

  const item = value[key];
  return Array.isArray(item) ? item : null;
}

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

function formatClosureDate(value: string | null) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatFileSize(bytes: number | null) {
  if (!bytes) {
    return "";
  }

  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function normalizeStatus(status: string | null) {
  return status && status in STATUS_LABELS ? STATUS_LABELS[status as Status] : status ?? "Not set";
}

function humanizeActionName(action: string) {
  const words = action.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/([a-z])([A-Z])/g, "$1 $2");
  const parts = words.split(/\s+/).filter(Boolean);

  if (parts[0] === "AI" && parts[1] === "Extract") {
    return "AI extraction";
  }

  return parts.join(" ");
}

function humanizeFieldName(key: string) {
  const labels: Record<string, string> = {
    current_target_date: "Target date",
    target_date: "Target date",
    description: "Description",
    department: "Department",
    required_evidence: "Required evidence",
    closure_remarks: "Closure remarks",
    closed_at: "Closure date",
    priority: "Priority",
    status: "Status",
    title: "Title",
    recommendation: "Recommendation",
  };

  return labels[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatChangedField(key: string, beforeJson: unknown, afterJson: unknown) {
  const beforeValue = getJsonString(beforeJson, key);
  const afterValue = getJsonString(afterJson, key);

  switch (key) {
    case "current_target_date":
    case "target_date":
      return `Target date: ${formatDate(beforeValue)} -> ${formatDate(afterValue)}`;
    case "description":
      return "Description updated";
    case "department":
      return `Department: ${beforeValue ?? "Not set"} -> ${afterValue ?? "Not set"}`;
    case "required_evidence":
      return "Required evidence updated";
    case "closure_remarks":
      return "Closure remarks updated";
    case "closed_at":
      return beforeValue
        ? `Closure date changed from ${formatClosureDate(beforeValue)} to ${formatClosureDate(afterValue)}`
        : `Closure date set to ${formatClosureDate(afterValue)}`;
    case "priority":
      return `Priority: ${beforeValue ?? "Not set"} -> ${afterValue ?? "Not set"}`;
    case "audit_type":
      return `Audit type changed: ${beforeValue ? formatAuditType(beforeValue as "IT" | "RegulatoryIT" | "Operations" | "RegulatoryOperations" | "External") : "Not set"} → ${afterValue ? formatAuditType(afterValue as "IT" | "RegulatoryIT" | "Operations" | "RegulatoryOperations" | "External") : "Not set"}`;
    default:
      return null;
  }
}

export function getChangedFieldNames(beforeJson: unknown, afterJson: unknown) {
  const before = isJsonRecord(beforeJson) ? beforeJson : {};
  const after = isJsonRecord(afterJson) ? afterJson : {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  return [...keys].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

export function getAuditLogChangeSummary(entry: AuditLogLike) {
  const beforeStatus =
    getJsonString(entry.before_json, "status") ?? getJsonString(entry.before_json, "from_status");
  const afterStatus = getJsonString(entry.after_json, "status") ?? getJsonString(entry.after_json, "to_status");
  const remarks = getJsonString(entry.after_json, "remarks");

  if (entry.action === "StatusChange") {
    return {
      title: `Status: ${normalizeStatus(beforeStatus)} -> ${normalizeStatus(afterStatus)}`,
      detail: remarks,
    };
  }

  if (entry.action === "Update") {
    const change = getJsonString(entry.after_json, "change");

    // Link/unlink events
    if (change === "mirror_added") {
      const mirrorDisplayId = getJsonString(entry.after_json, "mirror_display_id");
      return {
        title: `${mirrorDisplayId ?? "A plan"} was linked as a mirror of this plan`,
        detail: null,
      };
    }

    if (change === "mirror_removed") {
      const mirrorDisplayId = getJsonString(entry.after_json, "mirror_display_id");
      return {
        title: `${mirrorDisplayId ?? "A plan"} was unlinked from this plan`,
        detail: null,
      };
    }

    const beforeLinkedId = getJsonString(entry.before_json, "linked_primary_id");
    const afterLinkedId = getJsonString(entry.after_json, "linked_primary_id");

    if (beforeLinkedId === null && afterLinkedId !== null && afterLinkedId !== undefined) {
      const linkedDisplayId = getJsonString(entry.after_json, "linked_to_display_id");
      return {
        title: `Linked as mirror of ${linkedDisplayId ?? afterLinkedId}`,
        detail: null,
      };
    }

    if (beforeLinkedId !== null && beforeLinkedId !== undefined && afterLinkedId === null) {
      const linkedDisplayId = getJsonString(entry.before_json, "linked_to_display_id");
      return {
        title: `Unlinked from ${linkedDisplayId ?? beforeLinkedId}`,
        detail: null,
      };
    }

    if (change === "owner_assigned") {
      const ownerName = getJsonString(entry.after_json, "owner_name") ?? "Unknown user";
      return {
        title: `Owner assigned: ${ownerName}${getJsonBoolean(entry.after_json, "is_primary") ? " (Primary)" : ""}`,
        detail: null,
      };
    }

    if (change === "owner_removed") {
      return {
        title: `Owner removed: ${getJsonString(entry.after_json, "owner_name") ?? "Unknown user"}`,
        detail: null,
      };
    }

    if (change === "follow_up_auditor_assigned") {
      return {
        title: `Follow-up auditor assigned: ${getJsonString(entry.after_json, "auditor_name") ?? "Unknown user"}`,
        detail: null,
      };
    }

    if (change === "follow_up_auditor_removed") {
      return {
        title: `Follow-up auditor removed: ${getJsonString(entry.after_json, "auditor_name") ?? "Unknown user"}`,
        detail: null,
      };
    }

    // Check for entity_ids changes
    const beforeEntityCodes = getJsonArray(entry.before_json, "entity_codes");
    const afterEntityCodes = getJsonArray(entry.after_json, "entity_codes");

    if (beforeEntityCodes !== null || afterEntityCodes !== null) {
      const beforeSet = new Set(beforeEntityCodes ?? []);
      const afterSet = new Set(afterEntityCodes ?? []);
      const added = (afterEntityCodes ?? []).filter((code) => !beforeSet.has(code));
      const removed = (beforeEntityCodes ?? []).filter((code) => !afterSet.has(code));

      if (added.length > 0 && removed.length === 0) {
        return {
          title: added.length === 1 ? `Entity added: ${added[0]}` : `Entities added: ${added.join(", ")}`,
          detail: null,
        };
      }

      if (removed.length > 0 && added.length === 0) {
        return {
          title:
            removed.length === 1 ? `Entity removed: ${removed[0]}` : `Entities removed: ${removed.join(", ")}`,
          detail: null,
        };
      }

      if (added.length > 0 && removed.length > 0) {
        const changes = [...added.map((code) => `+${code}`), ...removed.map((code) => `-${code}`)];
        return {
          title: `Entities updated: ${changes.join(", ")}`,
          detail: null,
        };
      }
    }

    const changedFields = getChangedFieldNames(entry.before_json, entry.after_json);
    const formatted = changedFields
      .map((key) => formatChangedField(key, entry.before_json, entry.after_json))
      .filter((changeItem): changeItem is string => Boolean(changeItem));

    if (formatted.length === 1) {
      const justification = getJsonString(entry.after_json, "justification");
      return {
        title: formatted[0],
        detail: justification,
      };
    }

    if (changedFields.length > 1) {
      return {
        title: `${changedFields.length} fields changed`,
        detail: changedFields.map(humanizeFieldName).join(", "),
      };
    }

    return {
      title: "Action plan updated",
      detail: null,
    };
  }

  if (entry.action === "EvidenceUpload" || entry.action === "EvidenceReplace") {
    const evidenceType = getJsonString(entry.after_json, "evidence_type") ?? "file";
    const isLink = evidenceType === "link";

    if (isLink) {
      const description = getJsonString(entry.after_json, "description") ?? "link";
      const linkUrl = getJsonString(entry.after_json, "link_url");
      let hostname = "unknown";

      if (linkUrl) {
        try {
          hostname = new URL(linkUrl).hostname;
        } catch {
          hostname = "unknown";
        }
      }

      // Truncate description to 60 characters
      const truncatedDescription =
        description.length > 60 ? `${description.slice(0, 60)}...` : description;

      return {
        title: `Link: ${truncatedDescription} (${hostname})`,
        detail: entry.action === "EvidenceReplace" ? "Link evidence replaced" : "Link evidence added",
      };
    }

    const filename =
      getJsonString(entry.after_json, "original_name") ??
      getJsonString(entry.before_json, "original_name") ??
      getJsonString(entry.after_json, "filename") ??
      "file";
    const size = formatFileSize(getJsonNumber(entry.after_json, "file_size"));

    return {
      title: `File: ${filename}${size ? ` (${size})` : ""}`,
      detail: entry.action === "EvidenceReplace" ? "Evidence replaced" : "Evidence uploaded",
    };
  }

  if (entry.action === "Delete") {
    const evidenceType = getJsonString(entry.before_json, "evidence_type") ?? "file";
    const isLink = evidenceType === "link";

    if (isLink) {
      const description = getJsonString(entry.before_json, "description") ?? "link";
      const truncatedDescription =
        description.length > 60 ? `${description.slice(0, 60)}...` : description;

      return {
        title: "Link evidence removed",
        detail: truncatedDescription,
      };
    }

    const snippet =
      getJsonString(entry.before_json, "original_name") ??
      getJsonString(entry.before_json, "description") ??
      getJsonString(entry.before_json, "title") ??
      getJsonString(entry.before_json, "comment");

    return {
      title: "Record deleted",
      detail: snippet,
    };
  }

  if (entry.action === "Create") {
    return {
      title: `Created via ${getJsonString(entry.after_json, "created_via") ?? "system"}`,
      detail: getJsonString(entry.after_json, "title") ?? getJsonString(entry.after_json, "description"),
    };
  }

  if (entry.action === "LoginFailed") {
    const attempts = getJsonNumber(entry.after_json, "failed_attempts");
    return {
      title: `Failed login attempt${attempts ? ` (${attempts} in last hour)` : ""}`,
      detail: getJsonString(entry.after_json, "user_agent") ?? getJsonString(entry.before_json, "user_agent"),
    };
  }

  if (entry.action === "AIExtract") {
    const findingsCount = getJsonNumber(entry.after_json, "findings_created") ?? getJsonNumber(entry.after_json, "findings");
    const actionPlansCount =
      getJsonNumber(entry.after_json, "action_plans_created") ?? getJsonNumber(entry.after_json, "action_plans");
    const filename =
      getJsonString(entry.after_json, "original_name") ??
      getJsonString(entry.before_json, "original_name") ??
      getJsonString(entry.after_json, "filename") ??
      getJsonString(entry.before_json, "filename");

    return {
      title:
        findingsCount !== null || actionPlansCount !== null
          ? `Approved extraction -> ${findingsCount ?? 0} findings, ${actionPlansCount ?? 0} action plans created`
          : "AI extraction approved",
      detail: filename,
    };
  }

  return {
    title: humanizeActionName(entry.action),
    detail: null,
  };
}

export function formatAuditLogEntry(entry: AuditLogLike) {
  const summary = getAuditLogChangeSummary(entry);
  return summary.detail ? `${summary.title}\n${summary.detail}` : summary.title;
}
