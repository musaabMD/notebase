/**
 * Server helpers for Vercel REST API (used by app/projects).
 * @see https://vercel.com/docs/rest-api
 */

/** Build a public git URL from a project's `link` object (GitHub / GitLab / Bitbucket). */
export function repoUrlFromLink(link) {
  if (!link || typeof link !== "object") return null;
  const { type, org, repo, projectUrl } = link;
  if (projectUrl && /^https?:\/\//i.test(String(projectUrl))) {
    return String(projectUrl).replace(/\/+$/, "");
  }
  if (!repo && !org) return null;
  if (type === "github") {
    const path =
      typeof repo === "string" && repo.includes("/")
        ? repo
        : org && repo
          ? `${org}/${repo}`
          : repo;
    return path ? `https://github.com/${path.replace(/^\/+/, "")}` : null;
  }
  if (type === "gitlab") {
    if (org && repo) return `https://gitlab.com/${org}/${repo}`;
    return null;
  }
  if (type === "bitbucket") {
    if (org && repo) return `https://bitbucket.org/${org}/${repo}`;
    return null;
  }
  return null;
}

function withTeam(url, teamId) {
  if (teamId) url.searchParams.set("teamId", teamId);
}

export async function fetchLatestDeployment(token, projectId, teamId) {
  const url = new URL("https://api.vercel.com/v6/deployments");
  url.searchParams.set("limit", "1");
  url.searchParams.set("projectId", projectId);
  withTeam(url, teamId);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.deployments?.[0] ?? null;
}

/** Custom domains attached to the project (production aliases). */
export async function fetchProjectDomains(token, projectId, teamId) {
  const path = `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}/domains`;
  const url = new URL(path);
  withTeam(url, teamId);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data.domains) ? data.domains : [];
}

async function mapInChunks(items, chunkSize, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    out.push(...(await Promise.all(chunk.map(fn))));
  }
  return out;
}

/**
 * Attach latest deployment + domains per project. Uses existing `latestDeployments[0]` when present.
 * Batches network calls to avoid hammering the API.
 */
export async function enrichVercelProjects(token, teamId, projects, options = {}) {
  const { chunkSize = 8 } = options;
  if (!Array.isArray(projects) || projects.length === 0) return [];

  return mapInChunks(projects, chunkSize, async (p) => {
    const id = p.id;
    const embedded = Array.isArray(p.latestDeployments)
      ? p.latestDeployments[0]
      : null;

    const [latestDeployment, domains] = await Promise.all([
      embedded
        ? Promise.resolve(embedded)
        : id
          ? fetchLatestDeployment(token, id, teamId)
          : Promise.resolve(null),
      id ? fetchProjectDomains(token, id, teamId) : Promise.resolve([]),
    ]);

    return {
      ...p,
      _latestDeployment: latestDeployment,
      _domains: domains,
    };
  });
}

/** Dashboard deep links (team slug + project name). */
export function vercelProjectDashboardUrls(teamSlug, projectName) {
  if (!teamSlug || !projectName) return null;
  const base = `https://vercel.com/${encodeURIComponent(teamSlug)}/${encodeURIComponent(projectName)}`;
  return {
    project: base,
    analytics: `${base}/analytics`,
    speedInsights: `${base}/speed-insights`,
    deployments: `${base}/deployments`,
    logs: `${base}/logs`,
    domains: `${base}/settings/domains`,
  };
}
