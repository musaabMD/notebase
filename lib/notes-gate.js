import { createHash, createHmac, timingSafeEqual } from "crypto";

export const NOTES_SESSION_COOKIE = "notes_session";

/** 30 days */
const SESSION_MS = 1000 * 60 * 60 * 24 * 30;

/**
 * Constant-time compare of UTF-8 strings via SHA-256 digests (fixed length).
 */
export function verifyPassword(input, expectedFromEnv) {
  if (typeof input !== "string" || !expectedFromEnv) return false;
  const a = createHash("sha256").update(input, "utf8").digest();
  const b = createHash("sha256").update(expectedFromEnv, "utf8").digest();
  return timingSafeEqual(a, b);
}

/**
 * Cookie value: base64url(payloadJson) + "." + base64url(hmacSha256(secret, payloadJson))
 */
export function createSessionCookieValue(secret) {
  if (!secret?.trim()) throw new Error("NOTES_GATE_SECRET missing");
  const payloadStr = JSON.stringify({
    v: 1,
    exp: Date.now() + SESSION_MS,
  });
  const sig = createHmac("sha256", secret).update(payloadStr).digest();
  const payloadB64 = Buffer.from(payloadStr, "utf8").toString("base64url");
  const sigB64 = Buffer.from(sig).toString("base64url");
  return `${payloadB64}.${sigB64}`;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_MS / 1000),
  };
}
