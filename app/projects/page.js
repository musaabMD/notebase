import Link from "next/link";
import {
  enrichVercelProjects,
  repoUrlFromLink,
  vercelProjectDashboardUrls,
} from "../../lib/vercel-projects";

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

  let enriched = projects;
  try {
    enriched = await enrichVercelProjects(token, teamId, projects);
  } catch {
    enriched = projects.map((p) => ({
      ...p,
      _latestDeployment: null,
      _domains: [],
    }));
  }

  return {
    ok: true,
    reason: null,
    projects: enriched,
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
  /** Set automatically on Vercel builds/runtimes (not on plain `localhost`). */
  const onVercel = Boolean(process.env.VERCEL);

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
          {onVercel ? (
            <>
              <p style={{ margin: "0 0 8px", fontWeight: 600 }}>
                Production has no{" "}
                <code
                  style={{
                    fontFamily:
                      "var(--font-geist-mono), ui-monospace, monospace",
                    fontSize: 12,
                  }}
                >
                  VERCEL_TOKEN
                </code>
              </p>
              <p style={{ margin: "0 0 12px" }}>
                Values in{" "}
                <code
                  style={{
                    fontFamily:
                      "var(--font-geist-mono), ui-monospace, monospace",
                    fontSize: 12,
                  }}
                >
                  .env.local
                </code>{" "}
                are not deployed. Add the same variables on Vercel:
              </p>
              <ol
                style={{
                  margin: "0 0 12px",
                  paddingLeft: 20,
                }}
              >
                <li style={{ marginBottom: 8 }}>
                  Open your project →{" "}
                  <strong>Settings → Environment Variables</strong>.
                </li>
                <li style={{ marginBottom: 8 }}>
                  Add{" "}
                  <code
                    style={{
                      fontFamily:
                        "var(--font-geist-mono), ui-monospace, monospace",
                      fontSize: 12,
                    }}
                  >
                    VERCEL_TOKEN
                  </code>{" "}
                  (create a token at{" "}
                  <a
                    href="https://vercel.com/account/tokens"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "inherit" }}
                  >
                    vercel.com/account/tokens
                  </a>
                  ). Enable <strong>Production</strong> (and Preview if you want).
                </li>
                <li>
                  Optionally add{" "}
                  <code
                    style={{
                      fontFamily:
                        "var(--font-geist-mono), ui-monospace, monospace",
                      fontSize: 12,
                    }}
                  >
                    VERCEL_TEAM_SLUG
                  </code>{" "}
                  for Open links. Redeploy (or wait for a new deployment) so the
                  server sees the new env.
                </li>
              </ol>
            </>
          ) : (
            <>
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
            </>
          )}
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
        <>
          {teamSlug ? (
            <p
              style={{
                fontSize: 12,
                lineHeight: 1.45,
                color: "var(--note-text-tertiary)",
                margin: "0 0 16px",
              }}
            >
              <strong style={{ color: "var(--note-text-secondary)" }}>
                Analytics &amp; metrics:
              </strong>{" "}
              Page views, visitors, and Web Vitals are shown in the Vercel dashboard (links per project below).
              There is no public REST API for aggregate Web Analytics yet; for programmatic data see{" "}
              <a
                href="https://vercel.com/docs/drains/reference/analytics"
                target="_blank"
                rel="noreferrer"
                style={{ color: "inherit" }}
              >
                Web Analytics Drains
              </a>{" "}
              (team plans) or export CSV from the Analytics UI.
            </p>
          ) : (
            <p
              style={{
                fontSize: 12,
                color: "var(--note-text-tertiary)",
                margin: "0 0 16px",
              }}
            >
              Set{" "}
              <code
                style={{
                  fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
                  fontSize: 12,
                }}
              >
                VERCEL_TEAM_SLUG
              </code>{" "}
              for dashboard links (Analytics, Speed Insights, logs).
            </p>
          )}
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {result.projects.map((p) => {
              const dash = vercelProjectDashboardUrls(teamSlug, p?.name);
              const projectHref = dash?.project;
              const repoHref = repoUrlFromLink(p.link);
              const branch = p.link?.productionBranch;
              const dep = p._latestDeployment;
              const depUrl =
                dep?.url && typeof dep.url === "string"
                  ? `https://${dep.url}`
                  : null;
              const regions =
                Array.isArray(dep?.regions) && dep.regions.length > 0
                  ? dep.regions.join(", ")
                  : null;
              const domainRows = Array.isArray(p._domains) ? p._domains : [];

              const linkChip = {
                fontSize: 12,
                fontWeight: 500,
                color: "var(--note-accent, #1a1a1a)",
                textDecoration: "none",
                marginRight: 10,
              };

              return (
                <li
                  key={p.id ?? p.name}
                  style={{
                    padding: "14px 16px",
                    borderRadius: 12,
                    border: "1px solid var(--note-border-subtle, #e8e6e3)",
                    background: "var(--note-surface, #fff)",
                    boxShadow: "var(--note-card-shadow)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <div style={{ minWidth: 0, flex: "1 1 200px" }}>
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
                          marginTop: 6,
                          fontSize: 12,
                          color: "var(--note-text-tertiary)",
                          lineHeight: 1.45,
                        }}
                      >
                        {p.framework ? (
                          <span>
                            {p.framework}
                            {p.nodeVersion ? ` · Node ${p.nodeVersion}` : ""}
                          </span>
                        ) : (
                          p.nodeVersion && <span>Node {p.nodeVersion}</span>
                        )}
                        {p.serverlessFunctionRegion ? (
                          <span>
                            {p.framework || p.nodeVersion ? " · " : ""}
                            region {p.serverlessFunctionRegion}
                          </span>
                        ) : null}
                        <br />
                        <span
                          style={{
                            fontFamily:
                              "var(--font-geist-mono), ui-monospace, monospace",
                            fontSize: 11,
                          }}
                        >
                          id {p.id ?? "—"}
                        </span>
                        {" · "}
                        created {fmtDate(p.createdAt)} · updated{" "}
                        {fmtDate(p.updatedAt)}
                      </div>
                    </div>
                    {projectHref && (
                      <a
                        href={projectHref}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          flexShrink: 0,
                          fontSize: 13,
                          fontWeight: 600,
                          color: "var(--note-accent, #1a1a1a)",
                          textDecoration: "none",
                        }}
                      >
                        Dashboard →
                      </a>
                    )}
                  </div>

                  {(repoHref || branch) && (
                    <div
                      style={{
                        marginTop: 10,
                        fontSize: 12,
                        color: "var(--note-text-secondary)",
                      }}
                    >
                      <strong style={{ color: "var(--note-text-tertiary)" }}>
                        Git
                      </strong>
                      {repoHref ? (
                        <>
                          {" "}
                          <a
                            href={repoHref}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: "inherit", wordBreak: "break-all" }}
                          >
                            {repoHref.replace(/^https?:\/\//, "")}
                          </a>
                        </>
                      ) : null}
                      {branch ? (
                        <span>
                          {repoHref ? " · " : " "}
                          branch <code>{branch}</code>
                        </span>
                      ) : null}
                    </div>
                  )}

                  {domainRows.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          color: "var(--note-text-tertiary)",
                          marginBottom: 4,
                        }}
                      >
                        Domains (API)
                      </div>
                      <ul
                        style={{
                          margin: 0,
                          paddingLeft: 18,
                          fontSize: 12,
                          color: "var(--note-text-secondary)",
                        }}
                      >
                        {domainRows.slice(0, 8).map((d) => (
                          <li key={d.name ?? d.id}>
                            {d.name ?? "—"}
                            {d.verified ? " · verified" : ""}
                          </li>
                        ))}
                        {domainRows.length > 8 ? (
                          <li style={{ color: "var(--note-text-tertiary)" }}>
                            +{domainRows.length - 8} more
                          </li>
                        ) : null}
                      </ul>
                    </div>
                  )}

                  {dep && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: "10px 12px",
                        borderRadius: 8,
                        background: "var(--note-surface-muted, #fafaf9)",
                        fontSize: 12,
                        color: "var(--note-text-secondary)",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          color: "var(--note-text-tertiary)",
                          marginBottom: 6,
                        }}
                      >
                        Latest deployment (API)
                      </div>
                      {depUrl ? (
                        <div style={{ wordBreak: "break-all" }}>
                          <a
                            href={depUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: "inherit" }}
                          >
                            {depUrl}
                          </a>
                        </div>
                      ) : null}
                      <div style={{ marginTop: 4 }}>
                        {dep.readyState ?? dep.state ?? "—"}
                        {dep.target ? ` · ${dep.target}` : ""}
                        {dep.createdAt ? ` · ${fmtDate(dep.createdAt)}` : ""}
                      </div>
                      {regions ? (
                        <div style={{ marginTop: 4 }}>Regions: {regions}</div>
                      ) : null}
                    </div>
                  )}

                  {dash && (
                    <div
                      style={{
                        marginTop: 12,
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "4px 0",
                        alignItems: "center",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          color: "var(--note-text-tertiary)",
                          marginRight: 8,
                        }}
                      >
                        Dashboard
                      </span>
                      <a
                        href={dash.analytics}
                        target="_blank"
                        rel="noreferrer"
                        style={linkChip}
                      >
                        Web Analytics
                      </a>
                      <a
                        href={dash.speedInsights}
                        target="_blank"
                        rel="noreferrer"
                        style={linkChip}
                      >
                        Speed Insights
                      </a>
                      <a
                        href={dash.deployments}
                        target="_blank"
                        rel="noreferrer"
                        style={linkChip}
                      >
                        Deployments
                      </a>
                      <a
                        href={dash.logs}
                        target="_blank"
                        rel="noreferrer"
                        style={linkChip}
                      >
                        Logs
                      </a>
                      <a
                        href={dash.domains}
                        target="_blank"
                        rel="noreferrer"
                        style={linkChip}
                      >
                        Domains
                      </a>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
