import type { AuditLogAction, Prisma } from "@prisma/client";

import { prisma } from "../db/prisma";

type WriteAuditLogInput = {
  userId?: string | null;
  action: AuditLogAction;
  entityType: string;
  entityId?: string | null;
  beforeJson?: Prisma.InputJsonValue | null;
  afterJson?: Prisma.InputJsonValue | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function writeAuditLog({
  userId,
  action,
  entityType,
  entityId,
  beforeJson,
  afterJson,
  ipAddress,
  userAgent,
}: WriteAuditLogInput) {
  return prisma.audit_log.create({
    data: {
      user: userId
        ? {
            connect: {
              id: userId,
            },
          }
        : undefined,
      action,
      entity_type: entityType,
      entity_id: entityId ?? null,
      before_json: beforeJson ?? undefined,
      after_json: afterJson ?? undefined,
      ip_address: ipAddress ?? null,
      user_agent: userAgent ?? null,
    },
  });
}
