"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getSession, signOut } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAIAssistant } from "../lib/ai-assistant-context";
import { useTheme } from "../lib/theme";
import NotificationsPanel from "./NotificationsPanel";

type UserRole = "AuditTeam" | "Viewer" | "Auditee" | "Pending";

type SidebarUser = {
  id?: string;
  name?: string | null;
  role?: UserRole;
  is_admin?: boolean;
};

type NotificationItem = {
  id: string;
  user_name: string;
  user_email: string;
  change_type: string;
  batch_id: string;
  created_at: string;
  is_read: boolean;
};

type NavItem = {
  label: string;
  href: string;
  icon: string;
  badge?: number | null;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

const SIDEBAR_STORAGE_KEY = "ia-sidebar";

const MAIN_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "⌂" },
  { label: "Insights", href: "/insights", icon: "◌" },
  { label: "Audits", href: "/audits", icon: "◫" },
  { label: "Action Plans", href: "/action-plans", icon: "✓" },
];

const AUDIT_TOOL_ITEMS: NavItem[] = [
  { label: "Create Records", href: "/records/new", icon: "+" },
  { label: "AI Ingest", href: "/ai/ingest", icon: "✦" },
  { label: "AI Extractions", href: "/ai/extractions", icon: "◌" },
];

const ADMIN_ITEMS: NavItem[] = [
  { label: "Users", href: "/admin?tab=users", icon: "◎" },
  { label: "Entities", href: "/admin?tab=entities", icon: "⇧" },
  { label: "Settings", href: "/admin?tab=roles", icon: "⚙" },
];

function getInitials(name?: string | null) {
  if (!name) {
    return "IA";
  }

  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function roleBadgeClass(role?: UserRole) {
  return `role-badge role-badge--${(role ?? "Pending").toLowerCase()}`;
}

function roleLabel(role?: UserRole) {
  if (role === "AuditTeam") {
    return "Audit Team";
  }

  return role ?? "Pending";
}

function isActivePath(pathname: string, href: string) {
  const [pathOnly] = href.split("?");

  return pathname === pathOnly || pathname.startsWith(`${pathOnly}/`);
}

export default function Sidebar() {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const { openAssistant } = useAIAssistant();
  const [collapsed, setCollapsed] = useState(false);
  const [user, setUser] = useState<SidebarUser | null>(null);
  const [openActionPlanCount, setOpenActionPlanCount] = useState<number | null>(
    null,
  );
  const [notificationCount, setNotificationCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const loadNotifications = useCallback(async () => {
    if (!user?.is_admin) return;
    const response = await fetch("/api/v1/admin/users/notifications");
    if (!response.ok) return;
    const body = (await response.json()) as { notifications: NotificationItem[]; count: number };
    setNotifications(body.notifications);
    setNotificationCount(body.count);
  }, [user?.is_admin]);

  useEffect(() => {
    const saved = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    const nextCollapsed = saved === "collapsed";
    setCollapsed(nextCollapsed);
    document.documentElement.dataset.sidebar = nextCollapsed
      ? "collapsed"
      : "expanded";
  }, []);

  useEffect(() => {
    document.documentElement.dataset.sidebar = collapsed
      ? "collapsed"
      : "expanded";
    window.localStorage.setItem(
      SIDEBAR_STORAGE_KEY,
      collapsed ? "collapsed" : "expanded",
    );
  }, [collapsed]);

  useEffect(() => {
    let isMounted = true;

    getSession().then((session) => {
      if (!isMounted) {
        return;
      }

      setUser({
        id: session?.user?.id,
        name: session?.user?.name,
        role: session?.user?.role,
        is_admin: session?.user?.is_admin,
      });
    });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (user?.role !== "Auditee") {
      return;
    }

    let isMounted = true;

    fetch("/api/v1/dashboard/summary?my_items_only=true")
      .then(async (response) => {
        if (!response.ok) {
          return null;
        }

        const body = (await response.json()) as { kpis?: { total_open?: number } };
        return typeof body.kpis?.total_open === "number" ? body.kpis.total_open : null;
      })
      .then((count) => {
        if (isMounted) {
          setOpenActionPlanCount(count);
        }
      })
      .catch(() => {
        if (isMounted) {
          setOpenActionPlanCount(null);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [user?.role]);

  useEffect(() => {
    if (!user?.is_admin) return;

    loadNotifications();
    const interval = window.setInterval(loadNotifications, 60_000);
    return () => {
      window.clearInterval(interval);
    };
  }, [loadNotifications, user?.is_admin]);

  useEffect(() => {
    window.addEventListener("ia:notifications-refresh", loadNotifications);
    return () => window.removeEventListener("ia:notifications-refresh", loadNotifications);
  }, [loadNotifications]);

  useEffect(() => {
    if (!mobileOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  const sections = useMemo<NavSection[]>(() => {
    if (user?.role === "Pending") {
      return [];
    }

    if (user?.role === "Auditee") {
      return [
        {
          title: "MY ACTIONS",
          items: [
            {
              label: "My Assigned Items",
              href: user.id ? `/action-plans?owner=${encodeURIComponent(user.id)}` : "/action-plans",
              icon: "✓",
              badge: openActionPlanCount,
            },
          ],
        },
      ];
    }

    if (user?.role === "Viewer") {
      return [{ title: "MAIN", items: MAIN_ITEMS }];
    }

    if (user?.role === "AuditTeam") {
      return [
        { title: "MAIN", items: MAIN_ITEMS },
        { title: "AUDIT TOOLS", items: AUDIT_TOOL_ITEMS },
        ...(user.is_admin ? [{ title: "ADMIN", items: ADMIN_ITEMS }] : []),
      ];
    }

    return [];
  }, [openActionPlanCount, user?.id, user?.is_admin, user?.role]);

  return (
    <>
    <div className="mobile-topbar">
      <button aria-label="Open navigation" onClick={() => setMobileOpen(true)} type="button">
        ☰
      </button>
      <span>IA Tracker</span>
    </div>
    {mobileOpen ? <button aria-label="Close navigation" className="sidebar-backdrop" onClick={() => setMobileOpen(false)} type="button" /> : null}
    <aside className={`sidebar${collapsed ? " sidebar--collapsed" : ""}${mobileOpen ? " sidebar--mobile-open" : ""}`}>
      <div className="sidebar__logo">
        <div className="sidebar__shield" aria-hidden="true">
          ◈
        </div>
        <span className="sidebar__brand">IA Tracker</span>
        <button
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="sidebar__toggle"
          onClick={() => setCollapsed((current) => !current)}
          type="button"
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>

      <nav className="sidebar__scroll" aria-label="Main navigation">
        {user?.role === "Pending" ? (
          <div className="sidebar__empty">No access granted yet</div>
        ) : null}

        {sections.map((section) => (
          <div className="sidebar__section" key={section.title}>
            <p className="sidebar__section-title">{section.title}</p>
            {section.items.map((item) => (
              <div className="sidebar__link-wrapper" key={`${item.href}:${item.label}`}>
                <Link
                  className={`sidebar__link${
                    isActivePath(pathname, item.href)
                      ? " sidebar__link--active"
                      : ""
                  }`}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                >
                  <span className="sidebar__icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="sidebar__label">{item.label}</span>
                  {typeof item.badge === "number" ? (
                    <span className="sidebar__badge">{item.badge}</span>
                  ) : null}
                </Link>
                {collapsed ? (
                  <span className="sidebar__tooltip">{item.label}</span>
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar__bottom">
        <div className="sidebar__bottom-button-wrapper">
          <button
            className="sidebar__bottom-button"
            onClick={openAssistant}
            type="button"
          >
            <span className="sidebar__icon" aria-hidden="true">
              ✦
            </span>
            <span className="sidebar__label">AI Assistant</span>
          </button>
          {collapsed ? (
            <span className="sidebar__tooltip">AI Assistant</span>
          ) : null}
        </div>

        {user?.is_admin ? (
          <div className="sidebar__bottom-button-wrapper">
            <button
              className="sidebar__bottom-button"
              onClick={() => setNotificationsOpen(true)}
              type="button"
            >
              <span className="sidebar__icon" aria-hidden="true">
                ◉
              </span>
              <span className="sidebar__label">Notifications</span>
              {notificationCount > 0 ? <span className="sidebar__badge">{notificationCount}</span> : null}
            </button>
            {collapsed ? (
              <span className="sidebar__tooltip">Notifications</span>
            ) : null}
          </div>
        ) : null}

        <div className="sidebar__bottom-button-wrapper">
          <button
            className="sidebar__bottom-button"
            onClick={toggleTheme}
            type="button"
          >
            <span className="sidebar__icon" aria-hidden="true">
              {theme === "dark" ? "☾" : "☼"}
            </span>
            <span className="sidebar__label">
              {theme === "dark" ? "Dark" : "Light"} Theme
            </span>
          </button>
          {collapsed ? (
            <span className="sidebar__tooltip">Toggle theme</span>
          ) : null}
        </div>

        <div className="sidebar__user" title={collapsed ? user?.name ?? "" : undefined}>
          <span className="sidebar__avatar">{getInitials(user?.name)}</span>
          <span className="sidebar__user-meta">
            <span className="sidebar__user-name">{user?.name ?? "User"}</span>
            <span className={roleBadgeClass(user?.role)}>{roleLabel(user?.role)}</span>
          </span>
        </div>

        <div className="sidebar__bottom-button-wrapper">
          <button
            className="sidebar__bottom-button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            type="button"
          >
            <span className="sidebar__icon" aria-hidden="true">
              ⇥
            </span>
            <span className="sidebar__label">Logout</span>
          </button>
          {collapsed ? (
            <span className="sidebar__tooltip">Logout</span>
          ) : null}
        </div>
      </div>
      <NotificationsPanel
        isOpen={notificationsOpen}
        notifications={notifications}
        onClose={() => setNotificationsOpen(false)}
        onMarkAllRead={async () => {
          await fetch("/api/v1/admin/users/notifications", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mark_all_read: true }),
          });
          setNotifications([]);
          setNotificationCount(0);
        }}
      />
    </aside>
    </>
  );
}
