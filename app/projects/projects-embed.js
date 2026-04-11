"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ProjectsClient from "./projects-client";

export default function ProjectsEmbed() {
  const [phase, setPhase] = useState("loading");
  const [payload, setPayload] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/vercel/projects", { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        setPayload(data);
        setPhase("ready");
      } catch {
        if (cancelled) return;
        setPayload({ ok: false, reason: "api_error", apiMessage: "Request failed" });
        setPhase("ready");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (phase === "loading" || !payload) {
    return (
      <p style={{ margin: 0, fontSize: 14, color: "var(--note-text-secondary)" }}>
        Loading Vercel projects…
      </p>
    );
  }

  if (!payload.ok && payload.reason === "missing_token") {
    return (
      <div style={{ fontSize: 14, lineHeight: 1.55, color: "var(--note-text)" }}>
        <p style={{ margin: "0 0 8px", fontWeight: 600 }}>Add VERCEL_TOKEN</p>
        <p style={{ margin: 0, color: "var(--note-text-secondary)" }}>
          {payload.onVercel
            ? "Set it in Vercel → Project → Environment Variables, then redeploy."
            : "Add it to .env.local for local dev."}{" "}
          <Link href="/projects" style={{ color: "var(--note-accent)", fontWeight: 600 }}>
            Details →
          </Link>
        </p>
      </div>
    );
  }

  if (!payload.ok && payload.reason === "api_error") {
    return (
      <div style={{ fontSize: 14, lineHeight: 1.55, color: "var(--note-text)" }}>
        <p style={{ margin: "0 0 8px", fontWeight: 600 }}>
          Vercel API error{payload.status != null ? ` (${payload.status})` : ""}
        </p>
        <p
          style={{
            margin: 0,
            wordBreak: "break-word",
            color: "var(--note-text-secondary)",
          }}
        >
          {payload.apiMessage || "Unknown error"}
        </p>
        <p style={{ margin: "14px 0 0" }}>
          <Link href="/projects" style={{ color: "var(--note-accent)", fontWeight: 600 }}>
            Troubleshooting →
          </Link>
        </p>
      </div>
    );
  }

  if (payload.ok && payload.empty) {
    return (
      <p style={{ margin: 0, fontSize: 14, color: "var(--note-text-secondary)" }}>
        No projects for this token.
      </p>
    );
  }

  if (payload.ok && Array.isArray(payload.items) && payload.items.length > 0) {
    return (
      <ProjectsClient
        items={payload.items}
        teamSlug={payload.teamSlug ?? null}
        embedded
      />
    );
  }

  return (
    <p style={{ margin: 0, fontSize: 14, color: "var(--note-text-secondary)" }}>
      Could not load projects.
    </p>
  );
}
