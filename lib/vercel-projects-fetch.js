/**
 * Server-only: list projects from Vercel REST API (used by /projects and /api/vercel/projects).
 * @see https://vercel.com/docs/rest-api/reference/endpoints/projects/retrieve-a-list-of-projects
 */

import { enrichVercelProjects } from "./vercel-projects";

async function readVercelErrorBody(res) {
  try {
    const err = await res.json();
    if (err?.error?.invalidToken === true) {
      return "Not authorized (invalid or expired token). Create a new token at vercel.com/account/tokens";
    }
    return typeof err?.error?.message === "string"
      ? err.error.message
      : JSON.stringify(err);
  } catch {
    return (await res.text()) || "";
  }
}

/**
 * Lists all projects (paginated). Vercel returns up to `limit` per page; `pagination.next` is the `from` cursor.
 */
async function fetchAllProjectsPages(token, teamId) {
  const projects = [];
  let from = null;

  for (;;) {
    const url = new URL("https://api.vercel.com/v10/projects");
    url.searchParams.set("limit", "100");
    if (teamId) url.searchParams.set("teamId", teamId);
    if (from != null && from !== "") url.searchParams.set("from", String(from));

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        projects: [],
        apiMessage: (await readVercelErrorBody(res)).slice(0, 500),
      };
    }

    const data = await res.json();
    const batch = Array.isArray(data.projects) ? data.projects : [];
    projects.push(...batch);

    const next = data.pagination?.next;
    if (!next) break;
    from = next;
  }

  return { ok: true, status: 200, projects, apiMessage: null };
}

export async function fetchVercelProjects() {
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

  let usedTeamFallback = false;
  let list = await fetchAllProjectsPages(token, teamId);

  if (!list.ok && list.status === 403 && teamId) {
    list = await fetchAllProjectsPages(token, null);
    usedTeamFallback = true;
  }

  if (!list.ok) {
    return {
      ok: false,
      reason: "api_error",
      status: list.status,
      projects: [],
      apiMessage: list.apiMessage,
    };
  }

  const projects = list.projects;
  const effectiveTeamId = usedTeamFallback ? null : teamId || null;

  let enriched = projects;
  try {
    enriched = await enrichVercelProjects(token, effectiveTeamId, projects);
  } catch {
    enriched = projects.map((p) => ({
      ...p,
      _latestDeployment: null,
      _deploymentSeriesAll: null,
      _deploymentSeriesProduction: null,
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
