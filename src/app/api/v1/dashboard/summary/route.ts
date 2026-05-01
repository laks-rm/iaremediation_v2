import { ActionPlanStatus, AuditType, CreatedVia, Priority, Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { AuthError, requireRole } from "../../../../../lib/auth/requireRole";
import {
  AUDIT_TYPES,
  CLOSED_STATUSES,
  CREATED_VIA_VALUES,
  DAY_MS,
  DUE_BUCKETS,
  type DueBucket,
  type ParsedFilters,
  PRIORITIES,
  STATUSES,
  buildWhere,
  getBooleanParam,
  getDueBucketWhere,
  getOwnershipScope,
  getPrismaOrderBy,
  getRawSortedIds,
  getStartOfTodayUtc,
  parseFilters,
  usesRawSort,
} from "../../../../../lib/dashboard/filters";
import { prisma } from "../../../../../lib/db/prisma";

type Facets = {
  status: Record<ActionPlanStatus, number>;
  priority: Record<Priority, number>;
  created_via: Record<CreatedVia, number>;
  audit: { id: string; name: string; count: number }[];
  owner: { id: string; name: string; count: number }[];
  due_bucket: Record<DueBucket, number>;
};

const actionPlanInclude = {
  finding: {
    select: {
      id: true,
      title: true,
      description: true,
      external_ref: true,
      priority: true,
      control_rating: true,
      recommendation: true,
      audit: {
        select: {
          id: true,
          name: true,
          reference_number: true,
          audit_type: true,
          report_issue_date: true,
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
        select: {
          id: true,
          name: true,
          email: true,
          job_title: true,
          department: true,
        },
      },
    },
  },
  action_plan_follow_up_auditors: {
    include: {
      user: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  action_plan_line_managers: {
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          job_title: true,
          department: true,
          team_l1: true,
          manager_name: true,
        },
      },
    },
  },
  action_plan_entities: {
    select: {
      entity_id: true,
      entity: {
        select: {
          id: true,
          code: true,
          full_name: true,
        },
      },
    },
  },
  comments: {
    where: {
      is_deleted: false,
    },
    orderBy: {
      created_at: "desc",
    },
    take: 5,
    include: {
      user: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  target_date_revisions: {
    orderBy: {
      revised_at: "desc",
    },
    include: {
      revised_by: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  evidence: {
    where: {
      is_deleted: false,
    },
    orderBy: {
      created_at: "desc",
    },
    include: {
      uploaded_by: {
        select: {
          name: true,
        },
      },
    },
  },
  _count: {
    select: {
      evidence: {
        where: {
          is_deleted: false,
        },
      },
    },
  },
} satisfies Prisma.action_plansInclude;

type ActionPlanRecord = Prisma.action_plansGetPayload<{ include: typeof actionPlanInclude }>;

function getQuarterRange(now: Date) {
  const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
  const start = new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth + 3, 1));

  return { start, end };
}

function getDaysOverdue(currentTargetDate: Date | null, today: Date) {
  if (!currentTargetDate || currentTargetDate >= today) {
    return 0;
  }

  return Math.floor((today.getTime() - currentTargetDate.getTime()) / DAY_MS);
}

async function getKpis(where: Prisma.action_plansWhereInput, today: Date) {
  const { start, end } = getQuarterRange(today);
  const [totalOpen, overdue, closedThisQuarter, pendingValidation] =
    await Promise.all([
      prisma.action_plans.count({
        where: {
          ...where,
          status: {
            notIn: CLOSED_STATUSES,
          },
        },
      }),
      prisma.action_plans.count({
        where: {
          ...where,
          status: {
            notIn: CLOSED_STATUSES,
          },
          current_target_date: {
            lt: today,
          },
        },
      }),
      prisma.action_plans.count({
        where: {
          ...where,
          status: "Closed",
          updated_at: {
            gte: start,
            lt: end,
          },
        },
      }),
      prisma.action_plans.count({
        where: {
          ...where,
          status: "PendingValidation",
        },
      }),
    ]);

  return {
    total_open: totalOpen,
    overdue,
    closed_this_quarter: closedThisQuarter,
    pending_validation: pendingValidation,
  };
}

type ChartActionPlan = Prisma.action_plansGetPayload<{
  select: {
    status: true;
    priority: true;
    current_target_date: true;
    department: true;
    finding: {
      select: {
        audit: {
          select: {
            audit_type: true;
            audit_entities: {
              select: {
                entity: {
                  select: {
                    id: true;
                    code: true;
                    full_name: true;
                  };
                };
              };
            };
          };
        };
      };
    };
    action_plan_entities: {
      select: {
        entity: {
          select: {
            id: true;
            code: true;
            full_name: true;
          };
        };
      };
    };
    action_plan_owners: {
      select: {
        is_primary: true;
        user: {
          select: {
            department: true;
            team_l2: true;
          };
        };
      };
    };
  };
}>;

type CountWithOverdue = {
  openCount: number;
  overdueCount: number;
};

function createStatusCounts() {
  return STATUSES.reduce<Record<ActionPlanStatus, number>>((counts, status) => {
    counts[status] = 0;
    return counts;
  }, {} as Record<ActionPlanStatus, number>);
}

function isOpenStatus(status: ActionPlanStatus) {
  return !CLOSED_STATUSES.includes(status);
}

function isOverdueActionPlan(actionPlan: ChartActionPlan, today: Date) {
  return (
    isOpenStatus(actionPlan.status) &&
    actionPlan.current_target_date !== null &&
    actionPlan.current_target_date < today
  );
}

function getPrimaryOwner(actionPlan: ChartActionPlan) {
  return (
    actionPlan.action_plan_owners.find((owner) => owner.is_primary) ??
    actionPlan.action_plan_owners[0] ??
    null
  );
}

function getDepartment(actionPlan: ChartActionPlan) {
  const owner = getPrimaryOwner(actionPlan);
  return owner?.user.team_l2?.trim() || owner?.user.department?.trim() || actionPlan.department?.trim() || "Unassigned";
}

function getActionPlanEntities(actionPlan: ChartActionPlan) {
  const entities = actionPlan.action_plan_entities.length > 0
    ? actionPlan.action_plan_entities.map(({ entity }) => entity)
    : actionPlan.finding?.audit?.audit_entities.map(({ entity }) => entity) ?? [];
  const seen = new Set<string>();

  return entities.filter((entity) => {
    if (seen.has(entity.id)) {
      return false;
    }

    seen.add(entity.id);
    return true;
  });
}

async function getChartSummaries(where: Prisma.action_plansWhereInput, today: Date) {
  const actionPlans = await prisma.action_plans.findMany({
    where,
    select: {
      status: true,
      priority: true,
      current_target_date: true,
      department: true,
      finding: {
        select: {
          audit: {
            select: {
              audit_type: true,
              audit_entities: {
                select: {
                  entity: {
                    select: {
                      id: true,
                      code: true,
                      full_name: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
      action_plan_entities: {
        select: {
          entity: {
            select: {
              id: true,
              code: true,
              full_name: true,
            },
          },
        },
      },
      action_plan_owners: {
        orderBy: {
          is_primary: "desc",
        },
        select: {
          is_primary: true,
          user: {
            select: {
              department: true,
              team_l2: true,
            },
          },
        },
      },
    },
  });

  const statusCounts = createStatusCounts();
  const priorityCounts = new Map<Priority, CountWithOverdue>();
  const entityCounts = new Map<string, CountWithOverdue & { code: string; full_name: string }>();
  const auditTypeCounts = new Map<AuditType, number>();
  const departmentCounts = new Map<string, CountWithOverdue>();

  PRIORITIES.forEach((priority) => {
    priorityCounts.set(priority, { openCount: 0, overdueCount: 0 });
  });
  AUDIT_TYPES.forEach((auditType) => {
    auditTypeCounts.set(auditType, 0);
  });

  actionPlans.forEach((actionPlan) => {
    statusCounts[actionPlan.status] += 1;

    if (!isOpenStatus(actionPlan.status)) {
      return;
    }

    const isOverdue = isOverdueActionPlan(actionPlan, today);

    if (actionPlan.priority) {
      const current = priorityCounts.get(actionPlan.priority) ?? { openCount: 0, overdueCount: 0 };
      current.openCount += 1;
      if (isOverdue) {
        current.overdueCount += 1;
      }
      priorityCounts.set(actionPlan.priority, current);
    }

    getActionPlanEntities(actionPlan).forEach((entity) => {
      const current = entityCounts.get(entity.id) ?? {
        code: entity.code,
        full_name: entity.full_name,
        openCount: 0,
        overdueCount: 0,
      };
      current.openCount += 1;
      if (isOverdue) {
        current.overdueCount += 1;
      }
      entityCounts.set(entity.id, current);
    });

    const auditType = actionPlan.finding?.audit?.audit_type;
    if (auditType) {
      auditTypeCounts.set(auditType, (auditTypeCounts.get(auditType) ?? 0) + 1);
    }

    const department = getDepartment(actionPlan);
    const current = departmentCounts.get(department) ?? { openCount: 0, overdueCount: 0 };
    current.openCount += 1;
    if (isOverdue) {
      current.overdueCount += 1;
    }
    departmentCounts.set(department, current);
  });

  return {
    statusCounts,
    openByPriority: PRIORITIES.map((priority) => ({
      priority,
      ...(priorityCounts.get(priority) ?? { openCount: 0, overdueCount: 0 }),
    })),
    openByEntity: [...entityCounts.values()]
      .sort((left, right) => right.openCount - left.openCount || left.code.localeCompare(right.code))
      .slice(0, 7)
      .map(({ code, full_name, openCount, overdueCount }) => ({
        code,
        full_name,
        openCount,
        overdueCount,
      })),
    openByAuditType: AUDIT_TYPES.map((auditType) => ({
      auditType,
      openCount: auditTypeCounts.get(auditType) ?? 0,
    })),
    openByDepartment: [...departmentCounts.entries()]
      .sort((left, right) => right[1].openCount - left[1].openCount || left[0].localeCompare(right[0]))
      .slice(0, 6)
      .map(([department, counts]) => ({
        department,
        ...counts,
      })),
  };
}

function emptyFacets(): Facets {
  return {
    status: STATUSES.reduce<Record<ActionPlanStatus, number>>((counts, status) => {
      counts[status] = 0;
      return counts;
    }, {} as Record<ActionPlanStatus, number>),
    priority: PRIORITIES.reduce<Record<Priority, number>>((counts, priority) => {
      counts[priority] = 0;
      return counts;
    }, {} as Record<Priority, number>),
    created_via: CREATED_VIA_VALUES.reduce<Record<CreatedVia, number>>((counts, createdVia) => {
      counts[createdVia] = 0;
      return counts;
    }, {} as Record<CreatedVia, number>),
    audit: [],
    owner: [],
    due_bucket: DUE_BUCKETS.reduce<Record<DueBucket, number>>((counts, bucket) => {
      counts[bucket] = 0;
      return counts;
    }, {} as Record<DueBucket, number>),
  };
}

async function getGroupedFacet<T extends string>(
  field: "status" | "priority" | "created_via",
  values: readonly T[],
  where: Prisma.action_plansWhereInput,
) {
  const groups = await prisma.action_plans.groupBy({
    by: [field],
    where,
    _count: {
      _all: true,
    },
  });
  const counts = values.reduce<Record<T, number>>((current, value) => {
    current[value] = 0;
    return current;
  }, {} as Record<T, number>);

  groups.forEach((group) => {
    const value = group[field];
    if (value && values.includes(value as T)) {
      counts[value as T] = group._count._all;
    }
  });

  return counts;
}

async function getAuditFacet(where: Prisma.action_plansWhereInput) {
  const actionPlans = await prisma.action_plans.findMany({
    where,
    select: {
      finding: {
        select: {
          audit: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });
  const counts = new Map<string, { id: string; name: string; count: number }>();

  actionPlans.forEach((actionPlan) => {
    const audit = actionPlan.finding?.audit;
    if (!audit) {
      return;
    }

    const current = counts.get(audit.id) ?? { id: audit.id, name: audit.name, count: 0 };
    current.count += 1;
    counts.set(audit.id, current);
  });

  return [...counts.values()]
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, 50);
}

async function getOwnerFacet(where: Prisma.action_plansWhereInput) {
  const actionPlans = await prisma.action_plans.findMany({
    where,
    select: {
      action_plan_owners: {
        select: {
          user: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });
  const counts = new Map<string, { id: string; name: string; count: number }>();

  actionPlans.forEach((actionPlan) => {
    const seenOwners = new Set<string>();

    actionPlan.action_plan_owners.forEach(({ user }) => {
      if (seenOwners.has(user.id)) {
        return;
      }

      seenOwners.add(user.id);
      const current = counts.get(user.id) ?? { id: user.id, name: user.name, count: 0 };
      current.count += 1;
      counts.set(user.id, current);
    });
  });

  return [...counts.values()]
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, 50);
}

async function getDueBucketFacet(where: Prisma.action_plansWhereInput, today: Date) {
  const openItemsWhere: Prisma.action_plansWhereInput = {
    status: {
      notIn: CLOSED_STATUSES,
    },
  };
  const counts = await Promise.all(
    DUE_BUCKETS.map(async (bucket) => {
      const count = await prisma.action_plans.count({
        where: {
          AND: [where, openItemsWhere, getDueBucketWhere(bucket, today)],
        },
      });
      return [bucket, count] as const;
    }),
  );

  return counts.reduce<Record<DueBucket, number>>((current, [bucket, count]) => {
    current[bucket] = count;
    return current;
  }, emptyFacets().due_bucket);
}

async function getFacets(
  baseWhere: Prisma.action_plansWhereInput,
  filters: ParsedFilters,
  today: Date,
) {
  const [
    status,
    priority,
    createdVia,
    audit,
    owner,
    dueBucket,
  ] = await Promise.all([
    getGroupedFacet("status", STATUSES, buildWhere(baseWhere, filters, today, "status")),
    getGroupedFacet("priority", PRIORITIES, buildWhere(baseWhere, filters, today, "priority")),
    getGroupedFacet("created_via", CREATED_VIA_VALUES, buildWhere(baseWhere, filters, today, "created_via")),
    getAuditFacet(buildWhere(baseWhere, filters, today, "audit")),
    getOwnerFacet(buildWhere(baseWhere, filters, today, "owner")),
    getDueBucketFacet(buildWhere(baseWhere, filters, today, "due_bucket"), today),
  ]);

  return {
    status,
    priority,
    created_via: createdVia,
    audit,
    owner,
    due_bucket: dueBucket,
  } satisfies Facets;
}

async function getActionPlans(where: Prisma.action_plansWhereInput, filters: ParsedFilters) {
  if (!usesRawSort(filters)) {
    return prisma.action_plans.findMany({
      where,
      include: actionPlanInclude,
      orderBy: getPrismaOrderBy(filters),
    });
  }

  const orderedIds = await getRawSortedIds(where, filters);

  if (orderedIds.length === 0) {
    return [];
  }

  const actionPlans = await prisma.action_plans.findMany({
    where: {
      id: {
        in: orderedIds,
      },
    },
    include: actionPlanInclude,
  });
  const orderMap = new Map(orderedIds.map((id, index) => [id, index]));

  return actionPlans.sort(
    (left, right) =>
      (orderMap.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (orderMap.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

function enrichActionPlans(actionPlans: ActionPlanRecord[], today: Date) {
  return actionPlans.map((actionPlan) => {
    const isOverdue =
      actionPlan.current_target_date !== null &&
      actionPlan.current_target_date < today &&
      !CLOSED_STATUSES.includes(actionPlan.status);

    return {
      ...actionPlan,
      evidence_count: actionPlan._count.evidence,
      is_overdue: isOverdue,
      days_overdue: isOverdue ? getDaysOverdue(actionPlan.current_target_date, today) : 0,
    };
  });
}

export async function GET(request: NextRequest) {
  try {
    const currentUser = await requireRole(["AuditTeam", "Viewer", "Auditee"]);
    const today = getStartOfTodayUtc();
    const filters = parseFilters(request);
    const mustScopeToUser =
      currentUser.role === "Auditee" || getBooleanParam(request, "my_items_only");

    const baseWhere: Prisma.action_plansWhereInput = {
      is_deleted: false,
      ...(mustScopeToUser ? getOwnershipScope(currentUser.id) : {}),
    };
    const filteredWhere = buildWhere(baseWhere, filters, today);

    const [kpis, chartSummaries, actionPlans, facets, filteredCount, totalUnfiltered] = await Promise.all([
      getKpis(baseWhere, today),
      getChartSummaries(filteredWhere, today),
      getActionPlans(filteredWhere, filters),
      getFacets(baseWhere, filters, today),
      prisma.action_plans.count({ where: filteredWhere }),
      prisma.action_plans.count({ where: baseWhere }),
    ]);
    const enrichedActionPlans = enrichActionPlans(actionPlans, today);

    return NextResponse.json({
      kpis,
      action_plans: enrichedActionPlans,
      total: enrichedActionPlans.length,
      filtered_count: filteredCount,
      total_unfiltered: totalUnfiltered,
      ...chartSummaries,
      facets,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
