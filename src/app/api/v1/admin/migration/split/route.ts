import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "../../../../../../lib/audit-log/writeAuditLog";
import { AuthError, requireAdmin } from "../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../lib/db/prisma";

const splitSchema = z.object({
  action_plan_id: z.string().uuid(),
  mirrors: z.array(
    z.object({
      entity_code: z.string().min(1),
      finding_id: z.string().uuid(),
    }),
  ).min(1),
});

async function getUniqueDisplayId(year: number): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
    const displayId = `AP-${year}-${suffix}`;
    const existing = await prisma.action_plans.findUnique({
      where: { display_id: displayId },
      select: { id: true },
    });
    if (!existing) return displayId;
  }
  throw new Error("Unable to generate display id");
}

export async function POST(request: NextRequest) {
  try {
    const currentUser = await requireAdmin();

    const body = splitSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { action_plan_id, mirrors } = body.data;

    const ap = await prisma.action_plans.findFirst({
      where: { id: action_plan_id, is_deleted: false },
      select: {
        id: true,
        display_id: true,
        finding_id: true,
        title: true,
        description: true,
        priority: true,
        status: true,
        original_target_date: true,
        current_target_date: true,
        required_evidence: true,
        department: true,
        closed_at: true,
        closure_remarks: true,
        linked_primary_id: true,
        finding: {
          select: {
            audit: {
              select: { report_issue_date: true },
            },
          },
        },
        action_plan_entities: {
          select: {
            entity_id: true,
            entity: { select: { id: true, code: true } },
          },
        },
      },
    });

    if (!ap) {
      return NextResponse.json({ error: "Action plan not found" }, { status: 404 });
    }

    if (ap.linked_primary_id !== null) {
      return NextResponse.json(
        { error: "Action plan is already a mirror — cannot split a mirror AP" },
        { status: 400 },
      );
    }

    const apEntityCodes = new Set(ap.action_plan_entities.map((e) => e.entity.code));
    const requestedCodes = mirrors.map((m) => m.entity_code);
    const invalidCodes = requestedCodes.filter((code) => !apEntityCodes.has(code));
    if (invalidCodes.length > 0) {
      return NextResponse.json(
        { error: `Entity codes not on this AP: ${invalidCodes.join(", ")}` },
        { status: 400 },
      );
    }

    const findingIds = [...new Set(mirrors.map((m) => m.finding_id))];
    const foundFindings = await prisma.findings.findMany({
      where: { id: { in: findingIds }, is_deleted: false },
      select: { id: true },
    });
    if (foundFindings.length !== findingIds.length) {
      return NextResponse.json({ error: "One or more target findings not found" }, { status: 400 });
    }

    const entityByCode = new Map(
      ap.action_plan_entities.map((e) => [e.entity.code, e]),
    );

    const year = ap.finding?.audit?.report_issue_date
      ? ap.finding.audit.report_issue_date.getFullYear()
      : new Date().getFullYear();

    const mirrorDisplayIds: string[] = [];
    for (let i = 0; i < mirrors.length; i += 1) {
      mirrorDisplayIds.push(await getUniqueDisplayId(year));
    }

    const mirrorEntityIds = mirrors.map((m) => entityByCode.get(m.entity_code)!.entity_id);

    const createdMirrors = await prisma.$transaction(async (tx) => {
      const created = [];
      for (let i = 0; i < mirrors.length; i += 1) {
        const mirror = mirrors[i];
        const entityEntry = entityByCode.get(mirror.entity_code)!;
        const newAp = await tx.action_plans.create({
          data: {
            display_id: mirrorDisplayIds[i],
            finding_id: mirror.finding_id,
            title: ap.title,
            description: ap.description,
            priority: ap.priority,
            status: ap.status,
            original_target_date: ap.original_target_date,
            current_target_date: ap.current_target_date,
            required_evidence: ap.required_evidence,
            department: ap.department,
            closed_at: ap.closed_at,
            closure_remarks: ap.closure_remarks,
            created_via: "Manual",
            created_by_id: currentUser.id,
            linked_primary_id: ap.id,
            action_plan_entities: {
              create: [{ entity_id: entityEntry.entity_id }],
            },
          },
        });
        created.push(newAp);
      }

      await tx.action_plan_entities.deleteMany({
        where: {
          action_plan_id: ap.id,
          entity_id: { in: mirrorEntityIds },
        },
      });

      await tx.action_plans.update({
        where: { id: ap.id },
        data: { updated_at: new Date() },
      });

      return created;
    });

    const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      ?? request.headers.get("x-real-ip");

    for (const mirror of createdMirrors) {
      await writeAuditLog({
        userId: currentUser.id,
        action: "Create",
        entityType: "action_plan",
        entityId: mirror.id,
        afterJson: {
          display_id: mirror.display_id,
          linked_primary_id: ap.id,
          primary_display_id: ap.display_id,
          migration_op: "split_mirror",
        },
        ipAddress,
      });
    }

    await writeAuditLog({
      userId: currentUser.id,
      action: "Update",
      entityType: "action_plan",
      entityId: ap.id,
      beforeJson: {
        entity_count: ap.action_plan_entities.length,
      },
      afterJson: {
        entity_count: ap.action_plan_entities.length - mirrors.length,
        mirrors_created: createdMirrors.map((m) => m.display_id),
        migration_op: "split_primary",
      },
      ipAddress,
    });

    return NextResponse.json({
      ok: true,
      created_count: createdMirrors.length,
      created_display_ids: createdMirrors.map((m) => m.display_id),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
