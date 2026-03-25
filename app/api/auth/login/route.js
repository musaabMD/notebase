import { NextResponse } from "next/server";
import {
  NOTES_SESSION_COOKIE,
  createSessionCookieValue,
  sessionCookieOptions,
  verifyPassword,
} from "../../../../lib/notes-gate";

export const dynamic = "force-dynamic";

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 5;

function getClientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
}

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { attempts: 1, windowStart: now });
    return { allowed: true, remaining: RATE_LIMIT_MAX_ATTEMPTS - 1 };
  }

  if (entry.attempts >= RATE_LIMIT_MAX_ATTEMPTS) {
    const waitMs = RATE_LIMIT_WINDOW_MS - (now - entry.windowStart);
    return { allowed: false, retryAfter: Math.ceil(waitMs / 1000) };
  }

  entry.attempts++;
  return { allowed: true, remaining: RATE_LIMIT_MAX_ATTEMPTS - entry.attempts };
}

export async function POST(request) {
  const ip = getClientIp(request);
  const rateLimit = checkRateLimit(ip);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${rateLimit.retryAfter} seconds.` },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } }
    );
  }

  const expected = process.env.NOTES_ACCESS_PASSWORD?.trim();
  const secret = process.env.NOTES_GATE_SECRET?.trim();

  if (!expected || !secret) {
    const missing = [
      !expected && "NOTES_ACCESS_PASSWORD",
      !secret && "NOTES_GATE_SECRET",
    ].filter(Boolean);
    return NextResponse.json(
      {
        error:
          "Server env incomplete. You need both: NOTES_ACCESS_PASSWORD (what you type on /login) and NOTES_GATE_SECRET (long random string to sign cookies). Missing: " +
          missing.join(", "),
      },
      { status: 503 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const password = typeof body.password === "string" ? body.password : "";
  if (!verifyPassword(password, expected)) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  let value;
  try {
    value = createSessionCookieValue(secret);
  } catch {
    return NextResponse.json({ error: "Session error" }, { status: 500 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(NOTES_SESSION_COOKIE, value, sessionCookieOptions());
  return res;
}
