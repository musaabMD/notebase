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

const ACCENT_PALETTE = [
  "#2563EB",
  "#DC2626",
  "#059669",
  "#D97706",
  "#7C3AED",
  "#0891B2",
  "#BE185D",
];

export function accentFromId(id) {
  const s = String(id ?? "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return ACCENT_PALETTE[h % ACCENT_PALETTE.length];
}

export function initialsFromName(name) {
  const w = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (w.length >= 2) return (w[0][0] + w[1][0]).toUpperCase().slice(0, 2);
  const s = w[0] || "?";
  return s.slice(0, 2).toUpperCase();
}

function lastNDaysKeys(n) {
  const keys = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    keys.push(d.toISOString().split("T")[0]);
  }
  return keys;
}

export function emptyDeploymentSeries(days = 30) {
  return lastNDaysKeys(days).map((date) => ({ date, count: 0 }));
}

function isProductionDeployment(dep) {
  const t = dep?.target;
  return t === "production";
}

/**
 * Latest deployment + last 30 days deploy counts (all vs production-only) from one API call.
 */
export async function fetchDeploymentsBundle(token, projectId, teamId) {
  const url = new URL("https://api.vercel.com/v6/deployments");
  url.searchParams.set("projectId", projectId);
  url.searchParams.set("limit", "100");
  withTeam(url, teamId);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    return {
      latest: null,
      seriesAll: emptyDeploymentSeries(30),
      seriesProduction: emptyDeploymentSeries(30),
    };
  }
  const data = await res.json();
  const deployments = data.deployments ?? [];
  const latest = deployments[0] ?? null;
  const keys = lastNDaysKeys(30);
  const mapAll = new Map(keys.map((k) => [k, 0]));
  const mapProd = new Map(keys.map((k) => [k, 0]));
  for (const dep of deployments) {
    const raw = dep.createdAt ?? dep.created;
    if (!raw) continue;
    const key = new Date(raw).toISOString().split("T")[0];
    if (!mapAll.has(key)) continue;
    mapAll.set(key, mapAll.get(key) + 1);
    if (isProductionDeployment(dep)) {
      mapProd.set(key, mapProd.get(key) + 1);
    }
  }
  const seriesAll = keys.map((date) => ({ date, count: mapAll.get(date) }));
  const seriesProduction = keys.map((date) => ({
    date,
    count: mapProd.get(date),
  }));
  return { latest, seriesAll, seriesProduction };
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
 * Per project: deployment activity (Vercel API) for charts + latest deploy URL.
 */
export async function enrichVercelProjects(token, teamId, projects, options = {}) {
  const { chunkSize = 8 } = options;
  if (!Array.isArray(projects) || projects.length === 0) return [];

  return mapInChunks(projects, chunkSize, async (p) => {
    const id = p.id;
    if (!id) {
      return {
        ...p,
        _latestDeployment: null,
        _deploymentSeriesAll: emptyDeploymentSeries(30),
        _deploymentSeriesProduction: emptyDeploymentSeries(30),
      };
    }
    const bundle = await fetchDeploymentsBundle(token, id, teamId);
    return {
      ...p,
      _latestDeployment: bundle.latest,
      _deploymentSeriesAll: bundle.seriesAll,
      _deploymentSeriesProduction: bundle.seriesProduction,
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
  };
}

export function serializeProjectCard(p, teamSlug) {
  const dash = vercelProjectDashboardUrls(teamSlug, p.name);
  const repoUrl = repoUrlFromLink(p.link);
  const t = p.link?.type;
  const gitProvider =
    t === "github" || t === "gitlab" || t === "bitbucket" ? t : repoUrl ? "other" : null;
  const latest = p._latestDeployment;
  const latestUrl =
    latest?.url && typeof latest.url === "string"
      ? `https://${latest.url}`
      : null;
  return {
    id: p.id,
    name: p.name ?? "(unnamed)",
    framework: p.framework ?? null,
    accent: accentFromId(p.id),
    initials: initialsFromName(p.name),
    repoUrl,
    gitProvider,
    dash,
    seriesAll: p._deploymentSeriesAll ?? emptyDeploymentSeries(30),
    seriesProduction: p._deploymentSeriesProduction ?? emptyDeploymentSeries(30),
    latestUrl,
  };
}
