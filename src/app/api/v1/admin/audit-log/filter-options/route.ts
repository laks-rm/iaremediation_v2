import { NextResponse } from "next/server";

import { AuthError, requireAdmin } from "../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../lib/db/prisma";

const CACHE_MS = 5 * 60 * 1000;

let cache:
  | {
      expiresAt: number;
      payload: {
        entity_types: string[];
        users: {
          id: string;
          name: string;
          email: string;
        }[];
      };
    }
  | null = null;

export async function GET() {
  try {
    await requireAdmin();

    if (cache && cache.expiresAt > Date.now()) {
      return NextResponse.json(cache.payload);
    }

    const [entityTypes, users] = await Promise.all([
      prisma.audit_log.findMany({
        distinct: ["entity_type"],
        orderBy: {
          entity_type: "asc",
        },
        select: {
          entity_type: true,
        },
      }),
      prisma.users.findMany({
        where: {
          audit_logs: {
            some: {},
          },
        },
        orderBy: {
          name: "asc",
        },
        select: {
          id: true,
          name: true,
          email: true,
        },
      }),
    ]);

    const payload = {
      entity_types: entityTypes.map((item) => item.entity_type),
      users,
    };
    cache = {
      expiresAt: Date.now() + CACHE_MS,
      payload,
    };

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
