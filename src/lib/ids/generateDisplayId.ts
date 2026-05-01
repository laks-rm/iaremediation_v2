import { randomBytes } from "node:crypto";

export function generateDisplayId() {
  const year = new Date().getFullYear();
  const randomHex = randomBytes(3).toString("hex").toUpperCase();

  return `AP-${year}-${randomHex}`;
}
