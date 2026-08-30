"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function AdminLoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      const result = (await response.json()) as { ok?: boolean; message?: string };

      if (!response.ok || !result.ok) {
        setError(result.message || "Invalid password.");
        return;
      }

      router.replace("/admin");
      router.refresh();
    } catch {
      setError("Unable to sign in. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="admin-login-form" onSubmit={handleSubmit}>
      <label htmlFor="admin-password">Password</label>
      <input
        id="admin-password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        autoFocus
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        aria-describedby={error ? "admin-login-error" : undefined}
      />
      {error ? (
        <p id="admin-login-error" className="admin-form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={submitting || !password}>
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
