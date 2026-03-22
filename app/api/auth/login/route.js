import { NextResponse } from "next/server";
import {
  NOTES_SESSION_COOKIE,
  createSessionCookieValue,
  sessionCookieOptions,
  verifyPassword,
} from "../../../../lib/notes-gate";

export const dynamic = "force-dynamic";

export async function POST(request) {
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
