import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../lib/auth/getCurrentUser";
import { AUDIT_TYPE_LABELS, STATUS_LABELS } from "../../../../../lib/constants";
import {
  buildWhere,
  getOwnershipScope,
  getPrismaOrderBy,
  getRawSortedIds,
  getStartOfTodayUtc,
  parseFilters,
  usesRawSort,
} from "../../../../../lib/dashboard/filters";
import { prisma } from "../../../../../lib/db/prisma";
import {
  buildXlsxResponse,
  createExportWorksheet,
  formatExportDate,
  getUtcDateString,
} from "../../../../../lib/export/xlsx";

const EXPORT_ROW_CAP = 10_000;
const EXPORT_WARNING = "Export capped at 10,000 rows. Apply filters to narrow the result.";

const columns = [
  "AP Reference",
  "Finding Title",
  "Audit Name",
  "Audit Type",
  "Owner Name",
  "Owner Department",
  "Status",
  "Priority",
  "Original Target Date",
  "Current Target Date",
  "Reschedule Count",
  "Evidence Count",
  "Entities",
  "Follow-up Auditors",
];

const actionPlanExportInclude = {
  finding: {
    select: {
      title: true,
      audit: {
        select: {
          name: true,
          audit_type: true,
        },
      },
    },
  },
  action_plan_owners: {
    where: {
      is_primary: true,
    },
    take: 1,
    select: {
      user: {
        select: {
          name: true,
          department: true,
          team_l2: true,
        },
      },
    },
  },
  action_plan_entities: {
    select: {
      entity: {
        select: {
          code: true,
        },
      },
    },
    orderBy: {
      entity: {
        code: "asc",
      },
    },
  },
  action_plan_follow_up_auditors: {
    select: {
      user: {
        select: {
          name: true,
        },
      },
    },
    orderBy: {
      assigned_at: "asc",
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

type ActionPlanExportRecord = Prisma.action_plansGetPayload<{ include: typeof actionPlanExportInclude }>;

async function getExportRows(where: Prisma.action_plansWhereInput, filters: ReturnType<typeof parseFilters>) {
  if (!usesRawSort(filters)) {
    return prisma.action_plans.findMany({
      where,
      include: actionPlanExportInclude,
      orderBy: getPrismaOrderBy(filters),
      take: EXPORT_ROW_CAP + 1,
    });
  }

  const orderedIds = await getRawSortedIds(where, filters, EXPORT_ROW_CAP + 1);

  if (orderedIds.length === 0) {
    return [];
  }

  const actionPlans = await prisma.action_plans.findMany({
    where: {
      id: {
        in: orderedIds,
      },
    },
    include: actionPlanExportInclude,
  });
  const orderMap = new Map(orderedIds.map((id, index) => [id, index]));

  return actionPlans.sort(
    (left, right) =>
      (orderMap.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (orderMap.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

function getPrimaryOwner(actionPlan: ActionPlanExportRecord) {
  return actionPlan.action_plan_owners[0]?.user ?? null;
}

function toExportRow(actionPlan: ActionPlanExportRecord) {
  const owner = getPrimaryOwner(actionPlan);

  return [
    actionPlan.display_id,
    actionPlan.finding.title,
    actionPlan.finding.audit?.name ?? "",
    actionPlan.finding.audit?.audit_type ? AUDIT_TYPE_LABELS[actionPlan.finding.audit.audit_type] : "",
    owner?.name ?? "Unassigned",
    owner ? owner.team_l2?.trim() || owner.department?.trim() || "" : "",
    STATUS_LABELS[actionPlan.status],
    actionPlan.priority ?? "",
    formatExportDate(actionPlan.original_target_date),
    formatExportDate(actionPlan.current_target_date),
    actionPlan.reschedule_count,
    actionPlan._count.evidence,
    actionPlan.action_plan_entities.map(({ entity }) => entity.code).join(", "),
    actionPlan.action_plan_follow_up_auditors.map(({ user }) => user.name).join(", "),
  ];
}

export async function GET(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const today = getStartOfTodayUtc();
    const filters = parseFilters(request);
    const baseWhere: Prisma.action_plansWhereInput = {
      is_deleted: false,
      ...(currentUser.role === "Auditee" ? getOwnershipScope(currentUser.id) : {}),
    };
    const filteredWhere = buildWhere(baseWhere, filters, today);
    const actionPlans = await getExportRows(filteredWhere, filters);
    const isCapped = actionPlans.length > EXPORT_ROW_CAP;
    const exportRows = actionPlans.slice(0, EXPORT_ROW_CAP);
    const { workbook, worksheet } = createExportWorksheet({
      columns,
      name: "Action Plans",
      warning: isCapped ? EXPORT_WARNING : undefined,
    });

    exportRows.forEach((actionPlan) => {
      worksheet.addRow(toExportRow(actionPlan));
    });

    return await buildXlsxResponse(workbook, `action-plans-${getUtcDateString()}.xlsx`);
  } catch {
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
