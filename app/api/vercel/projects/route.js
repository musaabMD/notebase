import { NextResponse } from "next/server";
import { fetchVercelProjects } from "@/lib/vercel-projects-fetch";
import { serializeProjectCard } from "@/lib/vercel-projects";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await fetchVercelProjects();
  const teamSlug = process.env.VERCEL_TEAM_SLUG?.trim() ?? null;
  const onVercel = Boolean(process.env.VERCEL);

  if (!result.ok) {
    return NextResponse.json({
      ok: false,
      reason: result.reason,
      status: result.status,
      apiMessage: result.apiMessage,
      onVercel,
    });
  }

  const items = result.projects.map((p) => serializeProjectCard(p, teamSlug));

  return NextResponse.json({
    ok: true,
    items,
    teamSlug,
    usedTeamFallback: result.usedTeamFallback,
    empty: items.length === 0,
  });
}
