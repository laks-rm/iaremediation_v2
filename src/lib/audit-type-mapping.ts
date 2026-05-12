import { AuditType } from "@prisma/client";

/**
 * Infer audit type from reference number based on the pattern:
 * YEAR/IA/{CODE}/{ENTITY}/{SEQUENCE}
 * 
 * Mapping rules:
 * - OP  → Operations
 * - IT  → IT
 * - REG → RegulatoryOperations
 * - EXT → External
 * - Anything else → null
 * 
 * Note: RegulatoryIT exists in schema for legacy reasons but is not used
 * for new audits via inference. Users can still select it manually.
 */
export function inferAuditTypeFromReference(referenceNumber: string | null): AuditType | null {
  if (!referenceNumber || typeof referenceNumber !== "string") {
    return null;
  }

  const trimmed = referenceNumber.trim();
  if (!trimmed) {
    return null;
  }

  const segments = trimmed.split("/");
  if (segments.length < 3) {
    return null;
  }

  const code = segments[2].toUpperCase().trim();

  switch (code) {
    case "OP":
      return "Operations";
    case "IT":
      return "IT";
    case "REG":
      return "RegulatoryOperations";
    case "EXT":
      return "External";
    default:
      return null;
  }
}

/**
 * Format audit type enum value to human-readable label.
 * Centralizes formatting logic to ensure consistency across the application.
 */
export function formatAuditType(type: AuditType): string {
  switch (type) {
    case "Operations":
      return "Operations";
    case "RegulatoryOperations":
      return "Regulatory Operations";
    case "IT":
      return "IT";
    case "RegulatoryIT":
      return "Regulatory IT";
    case "External":
      return "External";
  }
}
