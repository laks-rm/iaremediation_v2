"use client";

import { useEffect } from "react";

import EmptyState from "./EmptyState";

type NotificationItem = {
  id: string;
  user_name: string;
  user_email: string;
  change_type: string;
  batch_id: string;
  created_at: string;
  is_read: boolean;
};

export default function NotificationsPanel({
  isOpen,
  notifications,
  onClose,
  onMarkAllRead,
}: {
  isOpen: boolean;
  notifications: NotificationItem[];
  onClose: () => void;
  onMarkAllRead: () => void;
}) {
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  const groups = notifications.reduce<Record<string, NotificationItem[]>>((acc, item) => {
    acc[item.batch_id] = [...(acc[item.batch_id] ?? []), item];
    return acc;
  }, {});

  return (
    <aside className={`notifications-panel${isOpen ? " notifications-panel--open" : ""}`}>
      <header>
        <div>
          <strong>Staff Changes</strong>
          <span>{notifications.length} unread</span>
        </div>
        <button className="button" onClick={onMarkAllRead} type="button">Mark all read</button>
        <button aria-label="Close notifications" onClick={onClose} type="button">×</button>
      </header>
      <div className="notifications-panel__body">
        {notifications.length === 0 ? (
          <EmptyState
            title="All caught up"
            subtitle="There are no unread staff change notifications."
          />
        ) : null}
        {Object.entries(groups).map(([batchId, items]) => (
          <section className="notifications-group" key={batchId}>
            <h3>{new Date(batchId).toLocaleString()}</h3>
            {items.map((item) => (
              <article className={item.is_read ? "notification-item" : "notification-item notification-item--unread"} key={item.id}>
                <i className={`notification-dot notification-dot--${item.change_type.split(",")[0]}`} />
                <div>
                  <strong>{item.user_name}</strong>
                  <span>{item.user_email}</span>
                  <p>{describeChange(item.change_type)}</p>
                  <em>{new Date(item.created_at).toLocaleString()}</em>
                </div>
              </article>
            ))}
          </section>
        ))}
      </div>
    </aside>
  );
}

function describeChange(changeType: string) {
  if (changeType === "created") return "New staff record created";
  if (changeType === "leaver") return "Marked as leaver";
  return `Updated: ${changeType}`;
}
