import { ActionPlanStatus, Priority, Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { AuthError, requireRole } from "../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../lib/db/prisma";
import { writeAuditLog } from "../../../../../lib/audit-log/writeAuditLog";
import {
  canViewActionPlan,
  getActionPlanForAccess,
  getActionPlanPayload,
  getClientIp,
  nullableString,
  toAuditJson,
} from "../../../../../lib/action-plans/access";

const updateSchema = z.object({
  title: z.string().nullable().optional(),
  description: z.string().min(1).optional(),
  required_evidence: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  closure_remarks: z.string().nullable().optional(),
  closed_at: z.string().nullable().optional(),
  priority: z.enum(["High", "Moderate", "Low"]).nullable().optional(),
  entity_ids: z.array(z.string().uuid()).optional(),
  link_to: z.string().uuid().optional(),
  unlink: z.literal(true).optional(),
});

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

async function propagateToMirrors(
  primaryId: string,
  fields: { status?: ActionPlanStatus; current_target_date?: Date | null; closed_at?: Date | null; closure_remarks?: string | null },
) {
  await prisma.action_plans.updateMany({
    where: { linked_primary_id: primaryId, is_deleted: false },
    data: fields,
  });
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const currentUser = await requireRole(["AuditTeam", "Viewer", "Auditee"]);
    const { id } = await context.params;
    const accessRecord = await getActionPlanForAccess(id);

    if (!accessRecord) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!canViewActionPlan(currentUser, accessRecord)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const payload = await getActionPlanPayload(id);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const currentUser = await requireRole(["AuditTeam"]);
    const { id } = await context.params;
    const existing = await prisma.action_plans.findFirst({
      where: { id, is_deleted: false },
      include: {
        action_plan_entities: {
          select: {
            entity_id: true,
          },
        },
        linked_mirrors: {
          where: { is_deleted: false },
          select: { id: true, display_id: true },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const parsed = updateSchema.safeParse(await request.json().catch(() => null));

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    // --- LINK OPERATION ---
    if (parsed.data.link_to !== undefined) {
      const primaryId = parsed.data.link_to;

      if (primaryId === id) {
        return NextResponse.json({ error: "Cannot link a plan to itself" }, { status: 400 });
      }

      if (existing.linked_mirrors.length > 0) {
        return NextResponse.json(
          { error: "This plan already has mirrors. Unlink its mirrors before linking it to a primary." },
          { status: 400 },
        );
      }

      if (existing.linked_primary_id === primaryId) {
        return NextResponse.json({ error: "This plan is already linked to that primary" }, { status: 400 });
      }

      const primary = await prisma.action_plans.findFirst({
        where: { id: primaryId, is_deleted: false },
        select: {
          id: true,
          display_id: true,
          linked_primary_id: true,
          status: true,
          current_target_date: true,
          closed_at: true,
          closure_remarks: true,
        },
      });

      if (!primary) {
        return NextResponse.json({ error: "Target action plan not found" }, { status: 404 });
      }

      if (primary.linked_primary_id !== null) {
        return NextResponse.json(
          { error: "Cannot link to a mirror plan — only link to a primary or standalone plan" },
          { status: 400 },
        );
      }

      const updated = await prisma.action_plans.update({
        where: { id },
        data: {
          linked_primary_id: primaryId,
          status: primary.status,
          current_target_date: primary.current_target_date,
          closed_at: primary.closed_at,
          closure_remarks: primary.closure_remarks,
        },
      });

      await writeAuditLog({
        userId: currentUser.id,
        action: "Update",
        entityType: "ActionPlan",
        entityId: id,
        beforeJson: toAuditJson({ linked_primary_id: existing.linked_primary_id }),
        afterJson: toAuditJson({ linked_primary_id: primaryId, linked_to_display_id: primary.display_id }),
        ipAddress: getClientIp(request),
      });

      await writeAuditLog({
        userId: currentUser.id,
        action: "Update",
        entityType: "ActionPlan",
        entityId: primaryId,
        beforeJson: toAuditJson({ change: "mirror_added" }),
        afterJson: toAuditJson({ change: "mirror_added", mirror_display_id: existing.display_id }),
        ipAddress: getClientIp(request),
      });

      const payload = await getActionPlanPayload(id);
      return NextResponse.json({ ...payload, updated });
    }

    // --- UNLINK OPERATION ---
    if (parsed.data.unlink === true) {
      if (!existing.linked_primary_id) {
        return NextResponse.json({ error: "This plan is not currently linked to a primary" }, { status: 400 });
      }

      const primaryDisplayId = await prisma.action_plans.findFirst({
        where: { id: existing.linked_primary_id },
        select: { display_id: true, id: true },
      });

      await prisma.action_plans.update({
        where: { id },
        data: { linked_primary_id: null },
      });

      await writeAuditLog({
        userId: currentUser.id,
        action: "Update",
        entityType: "ActionPlan",
        entityId: id,
        beforeJson: toAuditJson({
          linked_primary_id: existing.linked_primary_id,
          linked_to_display_id: primaryDisplayId?.display_id,
        }),
        afterJson: toAuditJson({ linked_primary_id: null }),
        ipAddress: getClientIp(request),
      });

      if (primaryDisplayId) {
        await writeAuditLog({
          userId: currentUser.id,
          action: "Update",
          entityType: "ActionPlan",
          entityId: primaryDisplayId.id,
          beforeJson: toAuditJson({ change: "mirror_removed" }),
          afterJson: toAuditJson({ change: "mirror_removed", mirror_display_id: existing.display_id }),
          ipAddress: getClientIp(request),
        });
      }

      const payload = await getActionPlanPayload(id);
      return NextResponse.json(payload);
    }

    // --- REGULAR UPDATE ---

    // Validate entity_ids if provided
    if (parsed.data.entity_ids !== undefined) {
      const validEntities = await prisma.entities.findMany({
        where: {
          id: {
            in: parsed.data.entity_ids,
          },
        },
        select: {
          id: true,
        },
      });

      if (validEntities.length !== parsed.data.entity_ids.length) {
        return NextResponse.json(
          { error: "One or more entity IDs are invalid" },
          { status: 400 },
        );
      }
    }

    const data: Prisma.action_plansUpdateInput = {};
    let validatedClosedAt: Date | null | undefined;

    if (parsed.data.title !== undefined) {
      data.title = nullableString(parsed.data.title);
    }
    if (parsed.data.description !== undefined) {
      data.description = parsed.data.description;
    }
    if (parsed.data.required_evidence !== undefined) {
      data.required_evidence = nullableString(parsed.data.required_evidence);
    }
    if (parsed.data.department !== undefined) {
      data.department = nullableString(parsed.data.department);
    }
    if (parsed.data.closure_remarks !== undefined) {
      data.closure_remarks = nullableString(parsed.data.closure_remarks);
    }
    if (parsed.data.closed_at !== undefined) {
      if (parsed.data.closed_at === null) {
        validatedClosedAt = null;
      } else {
        const parsedClosedAt = new Date(parsed.data.closed_at);
        if (Number.isNaN(parsedClosedAt.getTime()) || parsedClosedAt > new Date()) {
          return NextResponse.json(
            { error: "closed_at must be a valid date and cannot be in the future" },
            { status: 400 },
          );
        }
        validatedClosedAt = parsedClosedAt;
      }
      data.closed_at = validatedClosedAt;
    }
    if (parsed.data.priority !== undefined) {
      data.priority = parsed.data.priority as Priority | null;
    }

    // Handle entity updates in transaction
    if (parsed.data.entity_ids !== undefined) {
      const oldEntityIds = existing.action_plan_entities.map((ae) => ae.entity_id);

      await prisma.$transaction([
        // Update action plan fields
        prisma.action_plans.update({
          where: { id },
          data,
        }),
        // Delete existing entity associations
        prisma.action_plan_entities.deleteMany({
          where: {
            action_plan_id: id,
          },
        }),
        // Insert new entity associations
        ...(parsed.data.entity_ids.length > 0
          ? [
              prisma.action_plan_entities.createMany({
                data: parsed.data.entity_ids.map((entity_id) => ({
                  action_plan_id: id,
                  entity_id,
                })),
              }),
            ]
          : []),
      ]);

      await writeAuditLog({
        userId: currentUser.id,
        action: "Update",
        entityType: "ActionPlan",
        entityId: id,
        beforeJson: toAuditJson({ entity_ids: oldEntityIds }),
        afterJson: toAuditJson({ entity_ids: parsed.data.entity_ids }),
        ipAddress: getClientIp(request),
      });
    } else {
      // No entity changes, just update action plan fields
      const updated = await prisma.action_plans.update({
        where: { id },
        data,
      });

      if (Object.keys(data).length > 0 || parsed.data.closed_at !== undefined) {
        await writeAuditLog({
          userId: currentUser.id,
          action: "Update",
          entityType: "ActionPlan",
          entityId: id,
          beforeJson:
            parsed.data.closed_at !== undefined
              ? toAuditJson({ closed_at: existing.closed_at })
              : toAuditJson(existing),
          afterJson:
            parsed.data.closed_at !== undefined
              ? toAuditJson({ closed_at: updated.closed_at })
              : toAuditJson(updated),
          ipAddress: getClientIp(request),
        });

        // Propagate synced fields to mirrors if this is a primary plan
        if (existing.linked_primary_id === null) {
          const syncedChanged =
            parsed.data.closure_remarks !== undefined ||
            parsed.data.closed_at !== undefined;

          if (syncedChanged) {
            await propagateToMirrors(id, {
              closure_remarks: updated.closure_remarks,
              closed_at: updated.closed_at,
            });
          }
        }
      }
    }

    const payload = await getActionPlanPayload(id);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const currentUser = await requireRole(["AuditTeam"]);
    if (!currentUser.is_admin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id } = await context.params;
    const existing = await prisma.action_plans.findFirst({
      where: { id, is_deleted: false },
      select: {
        id: true,
        display_id: true,
        description: true,
        status: true,
        linked_primary_id: true,
        linked_mirrors: {
          where: { is_deleted: false },
          select: { id: true },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // If this is a primary with mirrors, unlink all mirrors first
    if (existing.linked_primary_id === null && existing.linked_mirrors.length > 0) {
      await prisma.action_plans.updateMany({
        where: { linked_primary_id: id, is_deleted: false },
        data: { linked_primary_id: null },
      });
    }

    const updated = await prisma.action_plans.update({
      where: { id },
      data: {
        is_deleted: true,
      },
    });

    await writeAuditLog({
      userId: currentUser.id,
      action: "Delete",
      entityType: "ActionPlan",
      entityId: id,
      beforeJson: toAuditJson(existing),
      afterJson: toAuditJson(updated),
      ipAddress: getClientIp(request),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
