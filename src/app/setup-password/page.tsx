"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useMemo, useState } from "react";

function SetupPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const requirements = useMemo(
    () => ({
      length: password.length >= 12,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      numberOrSpecial: /[\d\W_]/.test(password),
    }),
    [password],
  );

  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const canSubmit = Object.values(requirements).every(Boolean) && passwordsMatch;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    setError("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/v1/auth/setup-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = (await response.json().catch(() => null)) as
        | { success?: boolean; error?: string }
        | null;

      if (!response.ok || !body?.success) {
        setError(body?.error ?? "Unable to set password.");
        return;
      }

      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl: "/dashboard",
      });

      if (result?.error) {
        setError("Password was created, but automatic sign-in failed.");
        return;
      }

      router.push(result?.url ?? "/dashboard");
      router.refresh();
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-label="Create password">
        <div className="auth-card__body">
          <div className="auth-logo">
            <span className="sidebar__shield" aria-hidden="true">
              ◈
            </span>
            <span>IA Tracker</span>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            <div>
              <h1 className="auth-title">Create your password</h1>
              <p className="auth-subtitle">
                Set a secure password before accessing your remediation workspace.
              </p>
            </div>

            {error ? <div className="auth-error">{error}</div> : null}

            <label className="auth-field">
              <span className="auth-label">Email</span>
              <input
                autoComplete="email"
                className="auth-input"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </label>

            <label className="auth-field">
              <span className="auth-label">Password</span>
              <span className="auth-input-wrap">
                <input
                  autoComplete="new-password"
                  className="auth-input"
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type={showPassword ? "text" : "password"}
                  value={password}
                />
                <button
                  className="auth-password-toggle"
                  onClick={() => setShowPassword((current) => !current)}
                  type="button"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </span>
            </label>

            <ul className="password-checklist">
              <li
                className={`password-checklist__item${
                  requirements.length ? " password-checklist__item--met" : ""
                }`}
              >
                {requirements.length ? "✓" : "○"} At least 12 characters
              </li>
              <li
                className={`password-checklist__item${
                  requirements.uppercase ? " password-checklist__item--met" : ""
                }`}
              >
                {requirements.uppercase ? "✓" : "○"} Uppercase letter
              </li>
              <li
                className={`password-checklist__item${
                  requirements.lowercase ? " password-checklist__item--met" : ""
                }`}
              >
                {requirements.lowercase ? "✓" : "○"} Lowercase letter
              </li>
              <li
                className={`password-checklist__item${
                  requirements.numberOrSpecial
                    ? " password-checklist__item--met"
                    : ""
                }`}
              >
                {requirements.numberOrSpecial ? "✓" : "○"} Number or special character
              </li>
            </ul>

            <label className="auth-field">
              <span className="auth-label">Confirm password</span>
              <input
                autoComplete="new-password"
                className="auth-input"
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
              />
            </label>

            <button
              className="button button--primary"
              disabled={!canSubmit || isLoading}
              type="submit"
            >
              {isLoading ? "Creating password..." : "Create Password"}
            </button>
          </form>
        </div>
        <footer className="auth-footer">
          Your password is encrypted and never stored in plain text.
        </footer>
      </section>
      <div className="auth-gradient-stripe" />
    </main>
  );
}

export default function SetupPasswordPage() {
  return (
    <Suspense>
      <SetupPasswordForm />
    </Suspense>
  );
}
