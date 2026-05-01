import { ActionPlanStatus, Prisma } from "@prisma/client";
import { NextRequest } from "next/server";

import { requireRole } from "../auth/requireRole";
import { prisma } from "../db/prisma";

export const CLOSED_STATUSES: ActionPlanStatus[] = ["Closed", "Dropped", "RiskAccepted"];

export const safeUserSelect = {
  id: true,
  employee_id: true,
  email: true,
  name: true,
  role: true,
  is_admin: true,
  is_internal_auditor: true,
  is_active: true,
  job_title: true,
  department: true,
  team_l1: true,
  team_l2: true,
  team_l3: true,
  company: true,
  location: true,
  manager_name: true,
  manager_email: true,
  employment_status: true,
} satisfies Prisma.usersSelect;

export const actionPlanInclude = {
  finding: {
    include: {
      audit: {
        include: {
          audit_entities: {
            include: {
              entity: true,
            },
          },
        },
      },
    },
  },
  action_plan_owners: {
    include: {
      user: {
        select: safeUserSelect,
      },
    },
  },
  action_plan_follow_up_auditors: {
    include: {
      user: {
        select: safeUserSelect,
      },
    },
  },
  action_plan_line_managers: {
    include: {
      user: {
        select: safeUserSelect,
      },
    },
  },
  action_plan_entities: {
    include: {
      entity: true,
    },
  },
  evidence: {
    where: {
      is_deleted: false,
    },
    include: {
      uploaded_by: {
        select: safeUserSelect,
      },
    },
    orderBy: {
      created_at: "desc",
    },
  },
  comments: {
    where: {
      is_deleted: false,
    },
    include: {
      user: {
        select: safeUserSelect,
      },
    },
    orderBy: {
      created_at: "desc",
    },
  },
  status_history: {
    include: {
      changed_by: {
        select: safeUserSelect,
      },
    },
    orderBy: {
      changed_at: "desc",
    },
  },
  target_date_revisions: {
    include: {
      revised_by: {
        select: safeUserSelect,
      },
    },
    orderBy: {
      revised_at: "desc",
    },
  },
} satisfies Prisma.action_plansInclude;

export type ActionPlanAccess = {
  id: string;
  status: ActionPlanStatus;
  current_target_date: Date | null;
  action_plan_owners: { user_id: string }[];
};

export type ActionPlanUser = Awaited<ReturnType<typeof requireRole>>;

export function getClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip");
}

export function nullableString(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function parseNullableDate(value: string | null | undefined) {
  const trimmed = nullableString(value);
  if (!trimmed) {
    return null;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date");
  }

  return parsed;
}

export function toAuditJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function canViewActionPlan(currentUser: ActionPlanUser, actionPlan: ActionPlanAccess) {
  if (currentUser.role === "AuditTeam" || currentUser.role === "Viewer") {
    return true;
  }

  return actionPlan.action_plan_owners.some((owner) => owner.user_id === currentUser.id);
}

export function canMutateOwnedActionPlan(currentUser: ActionPlanUser, actionPlan: ActionPlanAccess) {
  if (currentUser.role === "AuditTeam") {
    return true;
  }

  return actionPlan.action_plan_owners.some((owner) => owner.user_id === currentUser.id);
}

export function enrichActionPlan<T extends { current_target_date: Date | null; status: ActionPlanStatus }>(
  actionPlan: T,
) {
  const today = getStartOfToday();
  const isOverdue =
    actionPlan.current_target_date !== null &&
    actionPlan.current_target_date < today &&
    !CLOSED_STATUSES.includes(actionPlan.status);

  return {
    ...actionPlan,
    is_overdue: isOverdue,
    days_overdue: isOverdue
      ? Math.floor((today.getTime() - actionPlan.current_target_date.getTime()) / 86_400_000)
      : 0,
  };
}

export async function getActionPlanForAccess(id: string) {
  return prisma.action_plans.findFirst({
    where: {
      id,
      is_deleted: false,
    },
    select: {
      id: true,
      status: true,
      current_target_date: true,
      action_plan_owners: {
        select: {
          user_id: true,
        },
      },
    },
  });
}

export async function getActionPlanPayload(id: string) {
  const actionPlan = await prisma.action_plans.findFirst({
    where: {
      id,
      is_deleted: false,
    },
    include: actionPlanInclude,
  });

  if (!actionPlan) {
    return null;
  }

  const auditLogs = await prisma.audit_log.findMany({
    where: {
      entity_id: id,
      entity_type: {
        in: ["ActionPlan", "action_plans"],
      },
    },
    include: {
      user: {
        select: safeUserSelect,
      },
    },
    orderBy: {
      created_at: "desc",
    },
  });

  return {
    action_plan: enrichActionPlan(actionPlan),
    audit_logs: auditLogs,
  };
}

function getStartOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}
