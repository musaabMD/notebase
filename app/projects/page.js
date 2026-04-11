import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Vercel projects",
  description: "Projects from your Vercel account (via API token)",
};

async function fetchVercelProjects() {
  const token = process.env.VERCEL_TOKEN?.trim();
  if (!token) {
    return {
      ok: false,
      reason: "missing_token",
      projects: [],
      apiMessage: null,
    };
  }

  const teamId = process.env.VERCEL_TEAM_ID?.trim();

  async function requestProjects(withTeamId) {
    const url = new URL("https://api.vercel.com/v9/projects");
    url.searchParams.set("limit", "100");
    if (withTeamId) url.searchParams.set("teamId", withTeamId);
    return fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  }

  // Prefer team scope when set; if the token rejects it (common with personal
  // tokens or wrong slug vs team id), retry without teamId.
  let res = await requestProjects(teamId);
  let usedTeamFallback = false;
  if (!res.ok && res.status === 403 && teamId) {
    res = await requestProjects(null);
    usedTeamFallback = true;
  }

  if (!res.ok) {
    let detail = "";
    try {
      const err = await res.json();
      detail =
        typeof err?.error?.message === "string"
          ? err.error.message
          : JSON.stringify(err);
    } catch {
      detail = await res.text();
    }
    return {
      ok: false,
      reason: "api_error",
      status: res.status,
      projects: [],
      apiMessage: detail.slice(0, 500),
    };
  }

  const data = await res.json();
  const projects = Array.isArray(data.projects) ? data.projects : [];
  return {
    ok: true,
    reason: null,
    projects,
    apiMessage: null,
    usedTeamFallback,
  };
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return String(iso);
  }
}

export default async function VercelProjectsPage() {
  const result = await fetchVercelProjects();
  const teamSlug = process.env.VERCEL_TEAM_SLUG?.trim();

  return (
    <div
      style={{
        minHeight: "100dvh",
        padding: 24,
        maxWidth: 960,
        margin: "0 auto",
        background: "var(--note-page-bg, #fafafa)",
        color: "var(--note-text, #111)",
        fontFamily:
          "var(--font-geist-sans), system-ui, -apple-system, sans-serif",
      }}
    >
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              margin: 0,
            }}
          >
            Vercel projects
          </h1>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 14,
              color: "var(--note-text-secondary, #525252)",
            }}
          >
            Loaded with your server{" "}
            <code
              style={{
                fontFamily:
                  "var(--font-geist-mono), ui-monospace, monospace",
                fontSize: 12,
              }}
            >
              VERCEL_TOKEN
            </code>
            . This app does not log into Vercel for you.
          </p>
        </div>
        <Link
          href="/"
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "var(--note-accent, #1a1a1a)",
            textDecoration: "none",
          }}
        >
          ← Notes
        </Link>
      </header>

      {result.ok && result.usedTeamFallback && (
        <div
          role="status"
          style={{
            marginBottom: 20,
            padding: 12,
            borderRadius: 12,
            border: "1px solid var(--note-border-subtle, #e8e6e3)",
            background: "var(--note-surface-muted, #fafaf9)",
            fontSize: 13,
            color: "var(--note-text-secondary, #525252)",
          }}
        >
          <strong style={{ color: "var(--note-text)" }}>Team scope skipped.</strong>{" "}
          Your{" "}
          <code
            style={{
              fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
              fontSize: 12,
            }}
          >
            VERCEL_TEAM_ID
          </code>{" "}
          was rejected (403), so this list was loaded without a team filter. Remove
          it or set it to the exact team id from Vercel → Team Settings → General.
        </div>
      )}

      {!result.ok && result.reason === "missing_token" && (
        <div
          role="status"
          style={{
            padding: 16,
            borderRadius: 12,
            border: "1px solid var(--note-border, #d4d1cc)",
            background: "var(--note-surface, #fff)",
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          <p style={{ margin: "0 0 8px" }}>
            Add a Vercel token to your environment (e.g.{" "}
            <code
              style={{
                fontFamily:
                  "var(--font-geist-mono), ui-monospace, monospace",
                fontSize: 12,
              }}
            >
              .env.local
            </code>
            ):
          </p>
          <pre
            style={{
              margin: 0,
              padding: 12,
              borderRadius: 8,
              background: "var(--note-surface-muted, #fafaf9)",
              fontSize: 12,
              overflow: "auto",
              fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
            }}
          >
            {`VERCEL_TOKEN=…
# Optional: team scope (slug or id) if projects are not on your personal account
# VERCEL_TEAM_ID=team_…
# Optional: used only for “Open” links (your team slug or username)
# VERCEL_TEAM_SLUG=my-team`}
          </pre>
          <p style={{ margin: "12px 0 0", color: "var(--note-text-tertiary)" }}>
            Create a token under Account → Tokens on{" "}
            <a
              href="https://vercel.com/account/tokens"
              target="_blank"
              rel="noreferrer"
              style={{ color: "inherit" }}
            >
              vercel.com/account/tokens
            </a>
            , then restart the dev server.
          </p>
        </div>
      )}

      {!result.ok && result.reason === "api_error" && (
        <div
          role="alert"
          style={{
            padding: 16,
            borderRadius: 12,
            border: "1px solid var(--note-border-strong, #b8b4ae)",
            background: "var(--note-surface, #fff)",
            fontSize: 14,
          }}
        >
          <p style={{ margin: "0 0 8px", fontWeight: 600 }}>
            Vercel API error {result.status != null ? `(${result.status})` : ""}
          </p>
          <p style={{ margin: 0, wordBreak: "break-word" }}>
            {result.apiMessage || "Request failed."}
          </p>
          <p style={{ margin: "12px 0 0", color: "var(--note-text-tertiary)" }}>
            Check that the token is valid and that{" "}
            <code
              style={{
                fontFamily:
                  "var(--font-geist-mono), ui-monospace, monospace",
                fontSize: 12,
              }}
            >
              VERCEL_TEAM_ID
            </code>{" "}
            matches the team you want (if not using a personal account).
          </p>
        </div>
      )}

      {result.ok && result.projects.length === 0 && (
        <p style={{ color: "var(--note-text-secondary)" }}>
          No projects returned for this token and scope.
        </p>
      )}

      {result.ok && result.projects.length > 0 && (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {result.projects.map((p) => {
            const href =
              teamSlug && p?.name
                ? `https://vercel.com/${encodeURIComponent(teamSlug)}/${encodeURIComponent(p.name)}`
                : null;
            return (
              <li
                key={p.id ?? p.name}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "14px 16px",
                  borderRadius: 12,
                  border: "1px solid var(--note-border-subtle, #e8e6e3)",
                  background: "var(--note-surface, #fff)",
                  boxShadow: "var(--note-card-shadow)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 15,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {p.name ?? "(unnamed)"}
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 12,
                      color: "var(--note-text-tertiary)",
                      fontFamily:
                        "var(--font-geist-mono), ui-monospace, monospace",
                    }}
                  >
                    {p.framework ? `${p.framework} · ` : ""}
                    updated {fmtDate(p.updatedAt)}
                  </div>
                </div>
                {href && (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      flexShrink: 0,
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--note-accent, #1a1a1a)",
                      textDecoration: "none",
                    }}
                  >
                    Open →
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
