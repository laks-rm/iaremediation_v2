"use client";

import { signOut } from "next-auth/react";

export default function PendingAccessPage() {
  return (
    <main className="pending-page">
      <section className="pending-card" aria-label="Pending access">
        <div className="auth-logo" style={{ justifyContent: "center" }}>
          <span className="sidebar__shield" aria-hidden="true">
            ◈
          </span>
          <span>IA Tracker</span>
        </div>
        <h1 className="auth-title">Welcome to IA Tracker</h1>
        <p className="auth-subtitle">
          Your account has been created, but access has not been granted yet.
          Please contact the IA team to request the correct role.
        </p>
        <button
          className="button button--primary"
          onClick={() => signOut({ callbackUrl: "/login" })}
          type="button"
        >
          Logout
        </button>
      </section>
    </main>
  );
}
