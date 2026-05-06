import { randomBytes } from "node:crypto";

export function generateDisplayId(auditReportIssueYear?: number) {
  const year = auditReportIssueYear ?? new Date().getFullYear();
  const randomHex = randomBytes(3).toString("hex").toUpperCase();

  return `AP-${year}-${randomHex}`;
}
