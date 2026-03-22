/**
 * Edge middleware verification (Web Crypto). Must match `lib/notes-gate.js` token format.
 */

function base64UrlToBytes(s) {
  let b = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b.length % 4;
  if (pad) b += "=".repeat(4 - pad);
  const binary = atob(b);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * @param {string} secret
 * @param {string | undefined} token
 * @returns {Promise<boolean>}
 */
export async function verifySessionCookieValue(secret, token) {
  if (!secret?.trim() || !token || typeof token !== "string") return false;
  const dot = token.indexOf(".");
  if (dot === -1) return false;
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  let payloadStr;
  try {
    payloadStr = new TextDecoder().decode(base64UrlToBytes(payloadB64));
  } catch {
    return false;
  }
  let data;
  try {
    data = JSON.parse(payloadStr);
  } catch {
    return false;
  }
  if (data.v !== 1 || typeof data.exp !== "number" || data.exp < Date.now()) {
    return false;
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const sig = base64UrlToBytes(sigB64);
  try {
    return await crypto.subtle.verify("HMAC", key, sig, enc.encode(payloadStr));
  } catch {
    return false;
  }
}
