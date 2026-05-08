"use client";

import { getSession } from "next-auth/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import AppLayout from "../../components/AppLayout";
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
    status: searchParams.get("status") ?? "",
    priority: searchParams.get("priority") ?? "",
    audit: searchParams.get("audit") ?? "",
    owner: searchParams.get("owner") ?? "",
    due_bucket: searchParams.get("due_bucket") ?? "",
    created_via: searchParams.get("created_via") ?? "",
    entity: searchParams.get("entity") ?? "",
    audit_type: searchParams.get("audit_type") ?? "",
    department: searchParams.get("department") ?? "",
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
    left.status === right.status &&
    left.priority === right.priority &&
    left.audit === right.audit &&
    left.owner === right.owner &&
    left.due_bucket === right.due_bucket &&
    left.created_via === right.created_via &&
    left.entity === right.entity &&
    left.audit_type === right.audit_type &&
    left.department === right.department &&
    left.overdue === right.overdue &&
    left.sort_by === right.sort_by &&
    left.sort_dir === right.sort_dir
  );
}

function setStringParam(params: URLSearchParams, key: string, value: string | null) {
  if (value?.trim()) {
    params.set(key, value.trim());
  }
}

function buildUrlQuery(filters: Filters, groupByAudit: boolean) {
  const params = new URLSearchParams();

  setStringParam(params, "q", filters.q);
  setStringParam(params, "status", filters.status);
  setStringParam(params, "priority", filters.priority);
  setStringParam(params, "audit", filters.audit);
  setStringParam(params, "owner", filters.owner);
  setStringParam(params, "due_bucket", filters.due_bucket);
  setStringParam(params, "created_via", filters.created_via);
  setStringParam(params, "entity", filters.entity);
  setStringParam(params, "audit_type", filters.audit_type);
  setStringParam(params, "department", filters.department);
  setStringParam(params, "sort_by", filters.sort_by);
  setStringParam(params, "sort_dir", filters.sort_dir);
  setStringParam(params, "ids", filters.ids);

  if (filters.overdue) {
    params.set("overdue", "1");
  }

  if (filters.assigned_to_me) {
    params.set("assigned_to_me", "1");
  }

  if (groupByAudit) {
    params.set("group", "audit");
  }

  return params.toString();
}

function buildDashboardApiQuery(filters: Filters) {
  const params = new URLSearchParams();

  setStringParam(params, "q", filters.q);
  setStringParam(params, "status", filters.status);
  setStringParam(params, "priority", filters.priority);
  setStringParam(params, "audit", filters.audit);
  setStringParam(params, "owner", filters.owner);
  setStringParam(params, "entity", filters.entity);
  setStringParam(params, "due_bucket", filters.due_bucket);
  setStringParam(params, "created_via", filters.created_via);
  setStringParam(params, "audit_type", filters.audit_type);
  setStringParam(params, "department", filters.department);
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

function buildActionPlanExportQuery(filters: Filters) {
  const params = new URLSearchParams();

  setStringParam(params, "q", filters.q);
  setStringParam(params, "status", filters.status);
  setStringParam(params, "priority", filters.priority);
  setStringParam(params, "audit", filters.audit);
  setStringParam(params, "owner", filters.owner);
  setStringParam(params, "due_bucket", filters.due_bucket);
  setStringParam(params, "created_via", filters.created_via);
  setStringParam(params, "ids", filters.ids);
  setStringParam(params, "entity", filters.entity);
  setStringParam(params, "audit_type", filters.audit_type);
  setStringParam(params, "department", filters.department);
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
  const [user, setUser] = useState<DashboardUser | null>(null);
  const [data, setData] = useState<ActionPlanTableData>(emptyData);
  const [filters, setFilters] = useState<Filters>(() =>
    readActionPlanFilters(new URLSearchParams(searchParams.toString())),
  );
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
  }, [filters, toast]);

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
    const nextFilters = readActionPlanFilters(new URLSearchParams(searchParams.toString()));
    setFilters((current) => (filtersEqual(current, nextFilters) ? current : nextFilters));
    setGroupByAudit((current) => {
      const nextGroupByAudit = searchParams.get("group") === "audit";
      return current === nextGroupByAudit ? current : nextGroupByAudit;
    });
  }, [searchParams]);

  useEffect(() => {
    const nextQuery = buildUrlQuery(filters, groupByAudit);
    const currentQuery = searchParams.toString();

    if (nextQuery === currentQuery) {
      return;
    }

    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [filters, groupByAudit, pathname, router]);

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
      const query = buildActionPlanExportQuery(filters);

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
          actionPlans={data.action_plans}
          facets={data.facets}
          filteredCount={data.filtered_count}
          filters={filters}
          groupByAudit={groupByAudit}
          isExporting={isExporting}
          loading={isLoading}
          onAddComment={addCommentLocal}
          onError={toast.error}
          onExport={handleExport}
          onFilterChange={setFilter}
          onFiltersChange={setFilters}
          onGroupByAuditChange={setGroupByAudit}
          onPatchActionPlan={patchActionPlanLocal}
          onRefresh={fetchActionPlans}
          onSortChange={cycleSort}
          showGroupingToggle
          showOverdueToggle
          sortBy={(filters.sort_by as SortBy) || null}
          sortDir={filters.sort_dir === "asc" || filters.sort_dir === "desc" ? filters.sort_dir : null}
          total={data.total}
          totalUnfiltered={data.total_unfiltered}
          user={user}
          userOptions={userOptions}
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
