import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function num(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Proxies OpenRouter key + optional account credits so the browser never sees the secret.
 * @see https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key
 * @see https://openrouter.ai/docs/api/api-reference/credits/get-credits (management key)
 */
export async function GET() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key?.trim()) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY is not set" },
      { status: 503 }
    );
  }

  const auth = { Authorization: `Bearer ${key.trim()}` };

  const [keyRes, creditsRes] = await Promise.all([
    fetch("https://openrouter.ai/api/v1/key", {
      method: "GET",
      headers: auth,
      cache: "no-store",
    }),
    fetch("https://openrouter.ai/api/v1/credits", {
      method: "GET",
      headers: auth,
      cache: "no-store",
    }),
  ]);

  const body = await keyRes.json().catch(() => ({}));

  if (!keyRes.ok) {
    return NextResponse.json(
      {
        error: "openrouter_error",
        status: keyRes.status,
        message: body?.error?.message ?? keyRes.statusText,
      },
      { status: 502 }
    );
  }

  const d = body?.data;
  if (!d || typeof d !== "object") {
    return NextResponse.json({ error: "invalid_response" }, { status: 502 });
  }

  let limitRemaining = num(d.limit_remaining);
  const limit = num(d.limit);
  const usage = num(d.usage);

  if (limitRemaining == null && limit != null && usage != null) {
    limitRemaining = limit - usage;
  }

  let totalCredits = null;
  let totalUsage = null;
  let accountRemaining = null;

  if (creditsRes.ok) {
    const cBody = await creditsRes.json().catch(() => ({}));
    const c = cBody?.data;
    if (c && typeof c === "object") {
      totalCredits = num(c.total_credits);
      totalUsage = num(c.total_usage);
      if (totalCredits != null && totalUsage != null) {
        accountRemaining = totalCredits - totalUsage;
      }
    }
  }

  const keyShowsRemaining = limitRemaining != null && Number.isFinite(limitRemaining);
  const accountShowsRemaining =
    accountRemaining != null && Number.isFinite(accountRemaining);

  let displayRemaining = null;
  let displaySource = "unlimited";
  if (keyShowsRemaining) {
    displayRemaining = limitRemaining;
    displaySource = "key";
  } else if (accountShowsRemaining) {
    displayRemaining = accountRemaining;
    displaySource = "account";
  }

  return NextResponse.json({
    limit,
    usage,
    limitRemaining,
    limitReset: d.limit_reset,
    label: d.label,
    isFreeTier: d.is_free_tier,
    totalCredits,
    totalUsage,
    accountRemaining: accountShowsRemaining ? accountRemaining : null,
    creditsEndpointOk: creditsRes.ok,
    creditsEndpointStatus: creditsRes.status,
    displayRemaining,
    displaySource,
  });
}
