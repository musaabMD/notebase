"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowUpRight, BarChart2, GitBranch, Search, X } from "lucide-react";

function GitHubMark({ size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386C24 5.373 18.627 0 12 0z" />
    </svg>
  );
}

function fmtTickDate(iso) {
  try {
    return new Date(iso + "T12:00:00").toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 10,
        padding: "8px 12px",
        border: "1px solid #E5E7EB",
        boxShadow: "0 8px 24px rgba(0,0,0,0.1)",
        fontSize: 13,
        fontWeight: 700,
        color: "#111827",
      }}
    >
      <p style={{ margin: "0 0 4px", fontSize: 10, color: "#9CA3AF", fontWeight: 600 }}>
        {fmtTickDate(label)}
      </p>
      <p style={{ margin: 0 }}>{payload[0].value} deploys</p>
    </div>
  );
}

function GitRepoIcon({ provider, href }) {
  if (!href) return null;
  const common = {
    href,
    target: "_blank",
    rel: "noreferrer",
    "aria-label": "Open repository",
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: 36,
      height: 36,
      borderRadius: 10,
      border: "1px solid #E5E7EB",
      background: "#fff",
      color: "#111827",
      flexShrink: 0,
    },
  };
  if (provider === "github") {
    return (
      <a {...common}>
        <GitHubMark size={18} />
      </a>
    );
  }
  return (
    <a {...common}>
      <GitBranch size={18} strokeWidth={2} />
    </a>
  );
}

function ProjectCard({ p }) {
  const [metric, setMetric] = useState("all");
  const data = metric === "all" ? p.seriesAll : p.seriesProduction;
  const total = useMemo(
    () => data.reduce((s, d) => s + (d.count || 0), 0),
    [data],
  );

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 20,
        border: "1px solid #E5E7EB",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        boxShadow:
          "0 1px 3px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.04)",
      }}
    >
      <div style={{ padding: "18px 18px 14px", borderBottom: "1px solid #F3F4F6" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 13,
                background: p.accent,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                fontWeight: 800,
                color: "#fff",
                letterSpacing: "0.03em",
                flexShrink: 0,
                boxShadow: `0 4px 12px ${p.accent}40`,
              }}
            >
              {p.initials}
            </div>
            <div style={{ minWidth: 0 }}>
              <h3
                style={{
                  margin: 0,
                  fontSize: 15,
                  fontWeight: 800,
                  color: "#111827",
                  letterSpacing: "-0.02em",
                  lineHeight: 1.2,
                }}
              >
                {p.name}
              </h3>
              <p
                style={{
                  margin: "4px 0 0",
                  fontSize: 12,
                  color: "#6B7280",
                  fontWeight: 500,
                }}
              >
                {p.framework || "Project"}
                {p.latestUrl ? (
                  <>
                    {" · "}
                    <a
                      href={p.latestUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "inherit" }}
                    >
                      Latest
                    </a>
                  </>
                ) : null}
              </p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <GitRepoIcon provider={p.gitProvider} href={p.repoUrl} />
            {p.dash?.project && (
              <a
                href={p.dash.project}
                target="_blank"
                rel="noreferrer"
                title="Vercel project"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  border: "1px solid #E5E7EB",
                  background: "#fff",
                  color: "#111827",
                }}
              >
                <ArrowUpRight size={18} strokeWidth={2} />
              </a>
            )}
            {p.dash?.analytics && (
              <a
                href={p.dash.analytics}
                target="_blank"
                rel="noreferrer"
                title="Web Analytics (Vercel)"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  border: "1px solid #E5E7EB",
                  background: "#111827",
                  color: "#fff",
                }}
              >
                <BarChart2 size={18} strokeWidth={2} />
              </a>
            )}
          </div>
        </div>
      </div>

      <div style={{ borderBottom: "1px solid #F3F4F6" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
          {[
            { id: "all", label: "All deploys", sub: "last 30d" },
            { id: "prod", label: "Production", sub: "last 30d" },
          ].map((tab, i) => {
            const active =
              (tab.id === "all" && metric === "all") ||
              (tab.id === "prod" && metric === "prod");
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setMetric(tab.id === "all" ? "all" : "prod")}
                style={{
                  cursor: "pointer",
                  padding: "12px 16px",
                  border: "none",
                  borderLeft: i === 1 ? "1px solid #F3F4F6" : "none",
                  background: active ? "#FAFAFA" : "#fff",
                  position: "relative",
                  textAlign: "left",
                }}
              >
                {active && (
                  <div
                    style={{
                      position: "absolute",
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: 2,
                      background: p.accent,
                      borderRadius: "2px 2px 0 0",
                    }}
                  />
                )}
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: active ? "#374151" : "#9CA3AF",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  {tab.label}
                </div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 800,
                    color: "#111827",
                    marginTop: 4,
                  }}
                >
                  {total}
                </div>
                <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 2 }}>{tab.sub}</div>
              </button>
            );
          })}
        </div>
        <div style={{ padding: "12px 8px 10px" }}>
          <ResponsiveContainer width="100%" height={128}>
            {metric === "all" ? (
              <BarChart
                data={data}
                margin={{ left: 4, right: 4, top: 4, bottom: 0 }}
                barSize={5}
                barCategoryGap="28%"
              >
                <CartesianGrid strokeDasharray="3 6" stroke="#F3F4F6" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 9, fill: "#D1D5DB" }}
                  minTickGap={24}
                  tickFormatter={fmtTickDate}
                />
                <YAxis hide />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: `${p.accent}12` }} />
                <Bar dataKey="count" fill={p.accent} radius={[3, 3, 0, 0]} fillOpacity={0.9} />
              </BarChart>
            ) : (
              <AreaChart data={data} margin={{ left: 4, right: 4, top: 4, bottom: 0 }}>
                <defs>
                  <linearGradient
                    id={`a-${String(p.id).replace(/[^a-zA-Z0-9_-]/g, "_")}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor={p.accent} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={p.accent} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 6" stroke="#F3F4F6" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 9, fill: "#D1D5DB" }}
                  minTickGap={24}
                  tickFormatter={fmtTickDate}
                />
                <YAxis hide />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke={p.accent}
                  strokeWidth={2}
                  fill={`url(#a-${String(p.id).replace(/[^a-zA-Z0-9_-]/g, "_")})`}
                  dot={false}
                />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>

      {p.dash?.speedInsights && (
        <div
          style={{
            padding: "10px 16px 14px",
            borderTop: "1px solid #F9FAFB",
            fontSize: 11,
            color: "#9CA3AF",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span>
            Charts = deploys from the Vercel API. Page views &amp; Web Vitals:{" "}
            <a href={p.dash.analytics} target="_blank" rel="noreferrer" style={{ color: "#6B7280" }}>
              Analytics
            </a>
            {" · "}
            <a href={p.dash.speedInsights} target="_blank" rel="noreferrer" style={{ color: "#6B7280" }}>
              Speed Insights
            </a>
          </span>
        </div>
      )}
    </div>
  );
}

export default function ProjectsClient({ items, teamSlug, embedded = false }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.framework && p.framework.toLowerCase().includes(q)),
    );
  }, [items, query]);

  return (
    <div
      style={{
        minHeight: embedded ? "auto" : "100vh",
        background: embedded ? "transparent" : "#F9FAFB",
        margin: embedded ? "0 -4px" : undefined,
      }}
    >
      <header
        style={{
          position: embedded ? "relative" : "sticky",
          top: 0,
          zIndex: embedded ? undefined : 50,
          background: embedded ? "#fff" : "rgba(255,255,255,0.92)",
          backdropFilter: embedded ? undefined : "blur(12px)",
          borderBottom: "1px solid #E5E7EB",
          borderRadius: embedded ? 12 : undefined,
        }}
      >
        <div
          style={{
            maxWidth: 1400,
            margin: "0 auto",
            padding: "0 clamp(16px,4vw,36px)",
            display: "flex",
            alignItems: "center",
            minHeight: 56,
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: 17,
              fontWeight: 800,
              color: "#111827",
              letterSpacing: "-0.03em",
            }}
          >
            Projects
          </span>
          <span style={{ fontSize: 12, color: "#D1D5DB", fontWeight: 500 }}>
            {filtered.length}
          </span>
          <div
            style={{
              flex: 1,
              minWidth: 200,
              maxWidth: 360,
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "#F3F4F6",
              borderRadius: 11,
              padding: "0 11px",
              height: 36,
            }}
          >
            <Search size={14} color="#9CA3AF" strokeWidth={2.5} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              aria-label="Search projects"
              style={{
                flex: 1,
                border: "none",
                background: "transparent",
                fontSize: 13,
                outline: "none",
              }}
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear"
                style={{
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  padding: 0,
                  display: "flex",
                  color: "#9CA3AF",
                }}
              >
                <X size={14} strokeWidth={2.5} />
              </button>
            ) : null}
          </div>
          <div style={{ flex: 1 }} />
          {embedded ? (
            <Link
              href="/projects"
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#374151",
                textDecoration: "none",
              }}
            >
              Full page
            </Link>
          ) : (
            <Link
              href="/"
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#374151",
                textDecoration: "none",
              }}
            >
              Notes
            </Link>
          )}
        </div>
      </header>

      {!teamSlug && items.length > 0 && (
        <p
          style={{
            margin: 0,
            padding: "12px clamp(16px,4vw,36px) 0",
            maxWidth: 1400,
            marginLeft: "auto",
            marginRight: "auto",
            fontSize: 12,
            color: "#9CA3AF",
          }}
        >
          Set <code>VERCEL_TEAM_SLUG</code> for Vercel dashboard &amp; Analytics links.
        </p>
      )}

      <main
        style={{
          maxWidth: 1400,
          margin: "0 auto",
          padding: embedded
            ? "16px 0 0"
            : "clamp(20px,3vw,32px) clamp(16px,4vw,36px)",
        }}
      >
        {filtered.length === 0 ? (
          <p style={{ color: "#6B7280", fontSize: 14 }}>No projects match.</p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: 18,
            }}
          >
            {filtered.map((p) => (
              <ProjectCard key={p.id} p={p} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
