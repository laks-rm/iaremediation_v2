import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { hashPassword, passwordSchema } from "../../../../../lib/auth/password";
import { prisma } from "../../../../../lib/db/prisma";
import { writeAuditLog } from "../../../../../lib/audit-log/writeAuditLog";

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 5;

const attemptCounts = new Map<string, { count: number; resetAt: number }>();

const setupPasswordSchema = z.object({
  email: z.string().email().max(320),
  password: passwordSchema,
});

function isRateLimited(key: string) {
  const now = Date.now();
  const current = attemptCounts.get(key);

  if (!current || current.resetAt <= now) {
    attemptCounts.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  current.count += 1;
  return current.count > RATE_LIMIT_MAX_ATTEMPTS;
}

function getClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() ?? null;
  }

  return request.headers.get("x-real-ip");
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const emailForRateLimit =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : "unknown";

  if (isRateLimited(emailForRateLimit)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const parsed = setupPasswordSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const email = parsed.data.email.trim();
  const user = await prisma.users.findFirst({
    where: {
      email: {
        equals: email,
        mode: "insensitive",
      },
    },
    select: {
      id: true,
      is_active: true,
      password_must_change: true,
    },
  });

  if (!user || !user.is_active || !user.password_must_change) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const passwordHash = await hashPassword(parsed.data.password);

  await prisma.users.update({
    where: { id: user.id },
    data: {
      password_hash: passwordHash,
      password_must_change: false,
      failed_login_attempts: 0,
      locked_until: null,
    },
  });

  await writeAuditLog({
    userId: user.id,
    action: "PasswordChange",
    entityType: "users",
    entityId: user.id,
    beforeJson: { password_must_change: true },
    afterJson: { password_must_change: false },
    ipAddress: getClientIp(request),
  });

  attemptCounts.delete(email.toLowerCase());

  return NextResponse.json({ success: true });
}
