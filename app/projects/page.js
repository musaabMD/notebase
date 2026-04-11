import Link from "next/link";
import { fetchVercelProjects } from "../../lib/vercel-projects-fetch";
import { serializeProjectCard } from "../../lib/vercel-projects";
import ProjectsClient from "./projects-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Vercel projects",
  description: "Projects from your Vercel account (via API token)",
};

export default async function VercelProjectsPage() {
  const result = await fetchVercelProjects();
  const teamSlug = process.env.VERCEL_TEAM_SLUG?.trim();
  const onVercel = Boolean(process.env.VERCEL);

  const items =
    result.ok && result.projects.length > 0
      ? result.projects.map((p) => serializeProjectCard(p, teamSlug))
      : [];

  return (
    <div
      style={{
        minHeight: "100dvh",
        color: "#111",
        fontFamily:
          "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
      }}
    >
      {result.ok && result.usedTeamFallback && (
        <div
          role="status"
          style={{
            margin: 0,
            padding: "12px clamp(16px,4vw,36px)",
            background: "#FFFBEB",
            borderBottom: "1px solid #FDE68A",
            fontSize: 13,
            color: "#92400E",
          }}
        >
          <strong>Team scope skipped.</strong> Fix or remove{" "}
          <code>VERCEL_TEAM_ID</code> if listings look wrong.
        </div>
      )}

      {!result.ok && result.reason === "missing_token" && (
        <div
          style={{
            padding: 24,
            maxWidth: 560,
            margin: "0 auto",
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          <p style={{ margin: "0 0 8px", fontWeight: 600 }}>
            Add <code>VERCEL_TOKEN</code>
            {onVercel ? " in Vercel → Project → Environment Variables" : " to .env.local"}.
          </p>
          <p style={{ margin: 0 }}>
            <Link href="/" style={{ color: "inherit" }}>
              ← Notes
            </Link>
          </p>
        </div>
      )}

      {!result.ok && result.reason === "api_error" && (
        <div
          role="alert"
          style={{ padding: 24, maxWidth: 560, margin: "0 auto", fontSize: 14 }}
        >
          <p style={{ fontWeight: 600 }}>Vercel API error ({result.status})</p>
          <p style={{ wordBreak: "break-word" }}>{result.apiMessage}</p>
          {result.status === 403 && (
            <ul style={{ margin: "16px 0 0", paddingLeft: 20, lineHeight: 1.6 }}>
              <li>
                Use a{" "}
                <a
                  href="https://vercel.com/account/tokens"
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "inherit" }}
                >
                  Personal Access Token
                </a>{" "}
                with access to list projects (full account scope, or include Projects read). OIDC /
                deployment-only tokens are not a substitute for <code>VERCEL_TOKEN</code>.
              </li>
              <li>
                Local dev reads <code>.env.local</code> only. Dashboard env vars apply on Vercel
                after deploy; for the same values locally, run{" "}
                <code style={{ fontSize: 13 }}>vercel env pull</code>.
              </li>
              <li>
                If you set <code>VERCEL_TEAM_ID</code>, it must match a team your user can access
                (Team Settings → Team ID). A wrong ID often returns 403; leave it unset to use your
                personal scope first.
              </li>
            </ul>
          )}
          <p style={{ marginTop: 12 }}>
            <Link href="/">← Notes</Link>
          </p>
        </div>
      )}

      {result.ok && result.projects.length === 0 && (
        <p style={{ padding: 24 }}>No projects for this token.</p>
      )}

      {result.ok && result.projects.length > 0 && (
        <ProjectsClient items={items} teamSlug={teamSlug ?? null} />
      )}
    </div>
  );
}
