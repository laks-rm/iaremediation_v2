"use client";

import { getSession } from "next-auth/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import AppLayout from "../../components/AppLayout";
import ActionPlanFilters, {
  type ActionPlanFiltersOptionMaps,
} from "../../components/action-plans/ActionPlanFilters";
import ActionPlanTable, {
  type ActionPlanTableData,
  type DashboardActionPlan,
  type DashboardComment,
  type DashboardUser,
  type Filters,
  type SortBy,
  type UserOption,
} from "../../components/action-plans/ActionPlanTable";
import { useToast } from "../../components/Toast";
import {
  applyFilters,
  migrateLegacySearchParams,
  parseFiltersParam,
  serializeFilters,
  stackableFiltersToLegacyQuery,
  type ActionPlanFilterChip,
} from "../../lib/action-plan-filters";

const emptyData: ActionPlanTableData = {
  action_plans: [],
  total: 0,
  filtered_count: 0,
  total_unfiltered: 0,
  facets: {
    status: {
      NotStarted: 0,
      InProgress: 0,
      PendingValidation: 0,
      Closed: 0,
      RiskAccepted: 0,
      Dropped: 0,
    },
    priority: {
      High: 0,
      Moderate: 0,
      Low: 0,
    },
    created_via: {
      Manual: 0,
      AIIngestion: 0,
      Migration: 0,
      Standalone: 0,
    },
    audit: [],
    owner: [],
    due_bucket: {
      overdue_gt14: 0,
      overdue_1to14: 0,
      due_today: 0,
      due_this_week: 0,
      due_this_month: 0,
      future: 0,
      no_date: 0,
    },
  },
};

async function readResponseBody(response: Response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function readActionPlanFilters(searchParams: URLSearchParams): Filters {
  return {
    ids: searchParams.has("ids") ? searchParams.get("ids") ?? "" : null,
    q: searchParams.get("q") ?? "",
    status: "",
    priority: "",
    audit: "",
    owner: "",
    due_bucket: "",
    created_via: "",
    entity: "",
    audit_type: "",
    department: "",
    overdue: searchParams.get("overdue") === "1",
    assigned_to_me: searchParams.get("assigned_to_me") === "1",
    sort_by: searchParams.get("sort_by") ?? "",
    sort_dir: searchParams.get("sort_dir") ?? "",
  };
}

function filtersEqual(left: Filters, right: Filters) {
  return (
    left.ids === right.ids &&
    left.q === right.q &&
    left.overdue === right.overdue &&
    left.assigned_to_me === right.assigned_to_me &&
    left.sort_by === right.sort_by &&
    left.sort_dir === right.sort_dir
  );
}

function setStringParam(params: URLSearchParams, key: string, value: string | null) {
  if (value?.trim()) {
    params.set(key, value.trim());
  }
}

function buildUrlQuery(
  filters: Filters,
  groupByAudit: boolean,
  stackableFilters: ActionPlanFilterChip[],
  currentSearch: URLSearchParams,
) {
  const params = new URLSearchParams();

  setStringParam(params, "q", filters.q);
  setStringParam(params, "sort_by", filters.sort_by);
  setStringParam(params, "sort_dir", filters.sort_dir);
  setStringParam(params, "ids", filters.ids);

  const filtersSerialized = serializeFilters(stackableFilters);
  if (filtersSerialized) {
    params.set("filters", filtersSerialized);
  }

  if (filters.overdue) {
    params.set("overdue", "1");
  }

  if (filters.assigned_to_me) {
    params.set("assigned_to_me", "1");
  }

  if (groupByAudit) {
    params.set("group", "audit");
  }

  const expand = currentSearch.get("expand");
  if (expand) {
    params.set("expand", expand);
  }

  return params.toString();
}

function buildDashboardApiQuery(filters: Filters) {
  const params = new URLSearchParams();

  setStringParam(params, "q", filters.q);
  setStringParam(params, "sort_by", filters.sort_by);
  setStringParam(params, "sort_dir", filters.sort_dir);
  setStringParam(params, "ids", filters.ids);

  if (filters.overdue) {
    params.set("overdue", "1");
  }

  if (filters.assigned_to_me) {
    params.set("assigned_to_me", "1");
  }

  return params.toString();
}

function buildActionPlanExportQuery(filters: Filters, stackableFilters: ActionPlanFilterChip[]) {
  const params = new URLSearchParams();
  const legacy = stackableFiltersToLegacyQuery(stackableFilters);

  setStringParam(params, "q", filters.q);
  setStringParam(params, "status", legacy.status);
  setStringParam(params, "priority", legacy.priority);
  setStringParam(params, "audit", legacy.audit);
  setStringParam(params, "owner", legacy.owner);
  setStringParam(params, "due_bucket", filters.due_bucket);
  setStringParam(params, "created_via", legacy.created_via);
  setStringParam(params, "ids", filters.ids);
  setStringParam(params, "entity", legacy.entity);
  setStringParam(params, "audit_type", legacy.audit_type);
  setStringParam(params, "department", legacy.department);
  setStringParam(params, "sort_by", filters.sort_by);
  setStringParam(params, "sort_dir", filters.sort_dir);

  if (filters.overdue) {
    params.set("overdue", "1");
  }

  return params.toString();
}

function ActionPlansPageContent() {
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const showDashboardBackLink = searchParams.has("ids");
  const expandActionPlanId = searchParams.get("expand");
  const [user, setUser] = useState<DashboardUser | null>(null);
  const [data, setData] = useState<ActionPlanTableData>(emptyData);
  const [filters, setFilters] = useState<Filters>(() =>
    readActionPlanFilters(new URLSearchParams(searchParams.toString())),
  );
  const [stackableFilters, setStackableFilters] = useState<ActionPlanFilterChip[]>(() => {
    const sp = new URLSearchParams(searchParams.toString());
    const filtersParam = sp.get("filters");
    if (filtersParam) {
      return parseFiltersParam(filtersParam);
    }

    return migrateLegacySearchParams(sp);
  });
  const [groupByAudit, setGroupByAudit] = useState(searchParams.get("group") === "audit");
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);

  const fetchActionPlans = useCallback(async () => {
    setIsLoading(true);

    try {
      const query = buildDashboardApiQuery(filters);
      const response = await fetch(`/api/v1/dashboard/summary?${query}`);
      const body = await readResponseBody(response);

      if (!response.ok) {
        toast.error(
          typeof body === "object" && body && "error" in body
            ? String(body.error)
            : "Unable to load action plans.",
        );
        setData(emptyData);
        return;
      }

      const summary = body as ActionPlanTableData;
      setData({
        action_plans: summary.action_plans,
        total: summary.total,
        filtered_count: summary.filtered_count,
        total_unfiltered: summary.total_unfiltered,
        facets: summary.facets,
      });
    } catch {
      toast.error("Unable to load action plans.");
      setData(emptyData);
    } finally {
      setIsLoading(false);
    }
  }, [filters.q, filters.ids, filters.overdue, filters.assigned_to_me, filters.sort_by, filters.sort_dir, toast]);

  useEffect(() => {
    getSession().then((session) => {
      if (!session?.user) {
        return;
      }

      setUser({
        id: session.user.id,
        name: session.user.name,
        role: session.user.role,
        is_admin: session.user.is_admin,
      });
    });
  }, []);

  useEffect(() => {
    fetchActionPlans();
  }, [fetchActionPlans]);

  useEffect(() => {
    const sp = new URLSearchParams(searchParams.toString());
    const nextFilters = readActionPlanFilters(sp);
    setFilters((current) => (filtersEqual(current, nextFilters) ? current : nextFilters));
    setGroupByAudit((current) => {
      const nextGroupByAudit = sp.get("group") === "audit";
      return current === nextGroupByAudit ? current : nextGroupByAudit;
    });

    const filtersParam = sp.get("filters");
    const nextStackable = filtersParam ? parseFiltersParam(filtersParam) : migrateLegacySearchParams(sp);
    setStackableFilters((current) =>
      serializeFilters(current) === serializeFilters(nextStackable) ? current : nextStackable,
    );
  }, [searchParams]);

  useEffect(() => {
    const sp = new URLSearchParams(searchParams.toString());
    const nextQuery = buildUrlQuery(filters, groupByAudit, stackableFilters, sp);
    const currentQuery = sp.toString();

    if (nextQuery === currentQuery) {
      return;
    }

    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [filters, groupByAudit, stackableFilters, pathname, router, searchParams]);

  useEffect(() => {
    if (user?.role !== "AuditTeam") {
      setUserOptions([]);
      return;
    }

    fetch("/api/v1/records/new/options")
      .then(async (response) => {
        const body = await readResponseBody(response);
        if (!response.ok) {
          return [];
        }

        return body && typeof body === "object" && "users" in body && Array.isArray(body.users)
          ? (body.users as UserOption[])
          : [];
      })
      .then(setUserOptions)
      .catch(() => setUserOptions([]));
  }, [user?.role]);

  const clientFilteredPlans = useMemo(
    () => applyFilters(data.action_plans, stackableFilters),
    [data.action_plans, stackableFilters],
  );

  const stackableFiltersKey = useMemo(() => serializeFilters(stackableFilters), [stackableFilters]);

  const filterPickerOptions: ActionPlanFiltersOptionMaps = useMemo(() => {
    const plans = data.action_plans;
    const userById = new Map<string, { id: string; name: string; email?: string | null }>();
    const auditById = new Map<string, string>();
    const entityByCode = new Map<string, { code: string; label: string }>();
    const departments = new Set<string>();

    for (const plan of plans) {
      if (plan.department?.trim()) {
        departments.add(plan.department.trim());
      }

      const audit = plan.finding?.audit;
      if (audit?.id) {
        auditById.set(audit.id, audit.name);
      }

      for (const row of plan.action_plan_owners) {
        userById.set(row.user.id, {
          id: row.user.id,
          name: row.user.name,
          email: row.user.email ?? null,
        });
      }

      for (const row of plan.action_plan_follow_up_auditors) {
        userById.set(row.user.id, {
          id: row.user.id,
          name: row.user.name,
          email: row.user.email ?? null,
        });
      }

      for (const row of plan.action_plan_line_managers) {
        userById.set(row.user.id, {
          id: row.user.id,
          name: row.user.name,
          email: row.user.email ?? null,
        });
      }

      for (const row of plan.action_plan_entities) {
        const code = row.entity.code;
        entityByCode.set(code, { code, label: row.entity.full_name || code });
      }
    }

    for (const option of userOptions) {
      if (!userById.has(option.id)) {
        userById.set(option.id, {
          id: option.id,
          name: option.name,
          email: option.email ?? null,
        });
      }
    }

    for (const audit of data.facets.audit) {
      if (!auditById.has(audit.id)) {
        auditById.set(audit.id, audit.name);
      }
    }

    const audits = [...auditById.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const entityOptions = [...entityByCode.values()].sort((a, b) => a.code.localeCompare(b.code));

    return {
      audits,
      users: [...userById.values()].sort((a, b) => a.name.localeCompare(b.name)),
      entityOptions,
      departmentOptions: [...departments].sort((a, b) => a.localeCompare(b)),
    };
  }, [data.action_plans, data.facets.audit, userOptions]);

  function patchActionPlanLocal(actionPlanId: string, patch: Partial<DashboardActionPlan>) {
    setData((current) => ({
      ...current,
      action_plans: current.action_plans.map((actionPlan) =>
        actionPlan.id === actionPlanId ? { ...actionPlan, ...patch } : actionPlan,
      ),
    }));
  }

  function addCommentLocal(actionPlanId: string, createdComment: DashboardComment) {
    setData((current) => ({
      ...current,
      action_plans: current.action_plans.map((actionPlan) =>
        actionPlan.id === actionPlanId
          ? { ...actionPlan, comments: [createdComment, ...actionPlan.comments] }
          : actionPlan,
      ),
    }));
  }

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function cycleSort(sortBy: SortBy) {
    setFilters((current) => {
      if (current.sort_by !== sortBy) {
        return { ...current, sort_by: sortBy, sort_dir: "asc" };
      }

      if (current.sort_dir === "asc") {
        return { ...current, sort_dir: "desc" };
      }

      return { ...current, sort_by: "", sort_dir: "" };
    });
  }

  function handleExport() {
    try {
      const query = buildActionPlanExportQuery(filters, stackableFilters);

      setIsExporting(true);
      window.setTimeout(() => setIsExporting(false), 300);
      window.location.href = query
        ? `/api/v1/action-plans/export?${query}`
        : "/api/v1/action-plans/export";
    } catch {
      toast.error("Unable to start export.");
      setIsExporting(false);
    }
  }

  return (
    <AppLayout>
      <div className="dashboard-page">
        <header className="dashboard-header">
          <div>
            {showDashboardBackLink ? (
              <button className="audit-breadcrumb action-plans-back-link" onClick={() => router.back()} type="button">
                ← Back to dashboard
              </button>
            ) : null}
            <h1>Action Plans</h1>
            <span>All remediation action plans across the audit portfolio.</span>
          </div>
        </header>

        <ActionPlanTable
          actionPlans={clientFilteredPlans}
          belowSearchSlot={
            <ActionPlanFilters
              chips={stackableFilters}
              onChange={setStackableFilters}
              options={filterPickerOptions}
            />
          }
          facets={data.facets}
          filteredCount={clientFilteredPlans.length}
          filters={filters}
          groupByAudit={groupByAudit}
          hasStackableFilters={stackableFilters.length > 0}
          isExporting={isExporting}
          loading={isLoading}
          onAddComment={addCommentLocal}
          onClearStackableFilters={() => setStackableFilters([])}
          onError={toast.error}
          onExport={handleExport}
          onFilterChange={setFilter}
          onGroupByAuditChange={setGroupByAudit}
          onPatchActionPlan={patchActionPlanLocal}
          onRefresh={fetchActionPlans}
          onSortChange={cycleSort}
          serverMatchedCount={data.action_plans.length}
          showGroupingToggle
          showOverdueToggle
          sortBy={(filters.sort_by as SortBy) || null}
          sortDir={filters.sort_dir === "asc" || filters.sort_dir === "desc" ? filters.sort_dir : null}
          stackableFiltersKey={stackableFiltersKey}
          total={clientFilteredPlans.length}
          totalUnfiltered={data.total_unfiltered}
          user={user}
          userOptions={userOptions}
          initialExpandedId={expandActionPlanId}
        />
      </div>
    </AppLayout>
  );
}

export default function ActionPlansPage() {
  return (
    <Suspense>
      <ActionPlansPageContent />
    </Suspense>
  );
}
