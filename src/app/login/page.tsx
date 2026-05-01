"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";

type CheckEmailResponse =
  | { exists: false }
  | {
      exists: true;
      is_active: false;
    }
  | {
      exists: true;
      is_active: true;
      needs_password_setup: boolean;
      name: string;
      is_internal_audit: boolean;
    };

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleContinue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/v1/auth/check-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = (await response.json().catch(() => null)) as
        | CheckEmailResponse
        | { error?: string }
        | null;

      if (!response.ok) {
        setError(body && "error" in body ? body.error ?? "Unable to continue" : "Unable to continue");
        return;
      }

      if (!body || !("exists" in body) || !body.exists) {
        setError("No account was found for that email address.");
        return;
      }

      if (!body.is_active) {
        setError("This account is inactive. Contact the IA team for help.");
        return;
      }

      if (body.needs_password_setup) {
        router.push(`/setup-password?email=${encodeURIComponent(email.trim())}`);
        return;
      }

      setName(body.name);
      setStep(2);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl,
      });

      if (result?.error) {
        setError("Invalid credentials or the account is temporarily locked.");
        return;
      }

      router.push(result?.url ?? callbackUrl);
      router.refresh();
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-label="Sign in">
        <div className="auth-card__body">
          <div className="auth-logo">
            <span className="sidebar__shield" aria-hidden="true">
              ◈
            </span>
            <span>IA Tracker</span>
          </div>

          {error ? <div className="auth-error">{error}</div> : null}

          {step === 1 ? (
            <form className="auth-form fade-step" onSubmit={handleContinue}>
              <div>
                <h1 className="auth-title">Sign in</h1>
                <p className="auth-subtitle">
                  Use your work email to continue to IA Tracker.
                </p>
              </div>
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
              <button className="button button--primary" disabled={isLoading} type="submit">
                {isLoading ? "Checking..." : "Continue"}
              </button>
            </form>
          ) : (
            <form className="auth-form fade-step" onSubmit={handleSignIn}>
              <div>
                <h1 className="auth-title">Welcome, {name}</h1>
                <p className="auth-subtitle">Enter your password to continue.</p>
              </div>
              <label className="auth-field">
                <span className="auth-label">Password</span>
                <span className="auth-input-wrap">
                  <input
                    autoComplete="current-password"
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
              <button className="button button--primary" disabled={isLoading} type="submit">
                {isLoading ? "Signing in..." : "Sign In"}
              </button>
              <button
                className="button"
                disabled={isLoading}
                onClick={() => {
                  setPassword("");
                  setStep(1);
                }}
                type="button"
              >
                Use a different email
              </button>
            </form>
          )}
        </div>
        <footer className="auth-footer">
          Internal Audit Remediation Tracker. Authorized users only.
        </footer>
      </section>
      <div className="auth-gradient-stripe" />
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
