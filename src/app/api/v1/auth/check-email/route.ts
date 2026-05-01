import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "../../../../../lib/db/prisma";

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;

const requestCounts = new Map<string, { count: number; resetAt: number }>();

const checkEmailSchema = z.object({
  email: z.string().email().max(320),
});

function getClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() ?? "unknown";
  }

  return request.headers.get("x-real-ip") ?? "unknown";
}

function isRateLimited(key: string) {
  const now = Date.now();
  const current = requestCounts.get(key);

  if (!current || current.resetAt <= now) {
    requestCounts.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  current.count += 1;
  return current.count > RATE_LIMIT_MAX_REQUESTS;
}

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);

  if (isRateLimited(clientIp)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const parsed = checkEmailSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const user = await prisma.users.findFirst({
    where: {
      email: {
        equals: parsed.data.email.trim(),
        mode: "insensitive",
      },
    },
    select: {
      name: true,
      is_active: true,
      password_must_change: true,
      is_internal_auditor: true,
      team_l1: true,
      team_l3: true,
    },
  });

  if (!user) {
    return NextResponse.json({ exists: false });
  }

  if (!user.is_active) {
    return NextResponse.json({ exists: true, is_active: false });
  }

  return NextResponse.json({
    exists: true,
    is_active: true,
    needs_password_setup: user.password_must_change,
    name: user.name,
    is_internal_audit:
      user.is_internal_auditor ||
      user.team_l1 === "Internal Audit" ||
      user.team_l3 === "AI - Internal Audit",
  });
}
