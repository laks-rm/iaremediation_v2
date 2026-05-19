"use client";

import { getSession } from "next-auth/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import AppLayout from "../../components/AppLayout";
import AuditRatingsTab from "./tabs/AuditRatingsTab";
import AuditTypesTab from "./tabs/AuditTypesTab";
import ActivityLogTab from "./tabs/ActivityLogTab";
import ControlEffectivenessTab from "./tabs/ControlEffectivenessTab";
import EntitiesTab from "./tabs/EntitiesTab";
import RolesPermissionsTab from "./tabs/RolesPermissionsTab";
import UsersTab from "./tabs/UsersTab";

const TABS = [
  { id: "users", label: "Users & Access" },
  { id: "entities", label: "Entities" },
  { id: "roles", label: "Roles & Permissions" },
  { id: "audit-types", label: "Audit Types" },
  { id: "audit-ratings", label: "Audit Ratings" },
  { id: "control-effectiveness", label: "Control Effectiveness" },
  { id: "activity-log", label: "Activity Log" },
];

function AdminPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") ?? "users";
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    getSession().then((session) => {
      if (!session?.user?.is_admin) {
        router.replace("/dashboard");
        return;
      }
      setIsChecking(false);
    });
  }, [router]);

  const content = useMemo(() => {
    if (activeTab === "entities") return <EntitiesTab />;
    if (activeTab === "roles") return <RolesPermissionsTab />;
    if (activeTab === "audit-types") return <AuditTypesTab />;
    if (activeTab === "audit-ratings") return <AuditRatingsTab />;
    if (activeTab === "control-effectiveness") return <ControlEffectivenessTab />;
    if (activeTab === "activity-log") return <ActivityLogTab />;
    return <UsersTab />;
  }, [activeTab]);

  if (isChecking) {
    return <AppLayout><div className="admin-page"><div className="audits-empty">Checking admin access...</div></div></AppLayout>;
  }

  return (
    <AppLayout>
      <div className="admin-page">
        <header className="admin-header">
          <div>
            <p>System administration</p>
            <h1>Admin</h1>
            <span>Manage access, entities, role configuration, and system labels.</span>
          </div>
        </header>
        <nav className="admin-tabs" aria-label="Admin tabs">
          {TABS.map((tab) => (
            <Link
              className={activeTab === tab.id ? "admin-tab-link admin-tab-link--active" : "admin-tab-link"}
              href={`/admin?tab=${tab.id}`}
              key={tab.id}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        <div style={{ padding: "8px 0 0" }}>
          <Link className="admin-tab-link" href="/admin/migration">⚙ Migration Support</Link>
        </div>
        {content}
      </div>
    </AppLayout>
  );
}

export default function AdminPage() {
  return <Suspense><AdminPageContent /></Suspense>;
}
