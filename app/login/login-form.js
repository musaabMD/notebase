"use client";

import { useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";

export function LoginForm() {
  const searchParams = useSearchParams();
  const from = useMemo(() => {
    const f = searchParams.get("from");
    if (!f || !f.startsWith("/") || f.startsWith("//")) return "/";
    return f;
  }, [searchParams]);

  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errorMsg =
          typeof data.error === "string"
            ? data.error
            : res.status === 429
              ? "Too many failed attempts. Please wait before trying again."
              : "Could not sign in";
        setError(errorMsg);
        setBusy(false);
        return;
      }
      window.location.href = from;
    } catch {
      setError("Network error");
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{
        width: "100%",
        maxWidth: 360,
        padding: 28,
        borderRadius: 16,
        border: "1px solid var(--note-border, #e5e5e5)",
        background: "var(--note-surface, #fff)",
        boxShadow: "0 8px 30px rgba(0,0,0,0.06)",
      }}
    >
      <h1
        style={{
          margin: "0 0 8px",
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: "-0.03em",
        }}
      >
        Notes
      </h1>
      <p
        style={{
          margin: "0 0 22px",
          fontSize: 14,
          color: "var(--note-text-secondary, #525252)",
          lineHeight: 1.5,
        }}
      >
        Enter the access password to open your notebooks.
      </p>
      <label
        htmlFor="gate-password"
        style={{
          display: "block",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--note-text-tertiary, #737373)",
          marginBottom: 8,
        }}
      >
        Password
      </label>
      <input
        id="gate-password"
        type="password"
        name="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={busy}
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "12px 14px",
          borderRadius: 10,
          border: "1px solid var(--note-border, #e5e5e5)",
          fontSize: 16,
          marginBottom: 16,
        }}
      />
      {error ? (
        <p
          role="alert"
          style={{
            margin: "0 0 14px",
            fontSize: 13,
            color: "var(--note-danger, #b42318)",
          }}
        >
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy || !password}
        style={{
          width: "100%",
          padding: "12px 16px",
          borderRadius: 10,
          border: "none",
          background: "var(--note-accent, #171717)",
          color: "var(--note-on-accent, #fff)",
          fontSize: 15,
          fontWeight: 600,
          cursor: busy ? "wait" : "pointer",
          opacity: busy || !password ? 0.6 : 1,
        }}
      >
        {busy ? "Checking…" : "Unlock"}
      </button>
    </form>
  );
}
