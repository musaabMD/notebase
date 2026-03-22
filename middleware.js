import { NextResponse } from "next/server";
import { verifySessionCookieValue } from "./lib/notes-gate-edge";

function isPublicPath(pathname) {
  if (pathname.startsWith("/_next")) return true;
  if (pathname === "/api/auth/login") return true;
  if (pathname === "/api/auth/logout") return true;
  if (pathname === "/favicon.ico") return true;
  if (pathname === "/manifest.webmanifest") return true;
  if (pathname === "/icon" || pathname === "/apple-icon") return true;
  if (pathname === "/sw.js") return true;
  if (/\.(?:ico|png|svg|webp|jpg|jpeg|gif|webmanifest)$/i.test(pathname)) {
    return true;
  }
  return false;
}

export async function middleware(request) {
  if (process.env.NOTES_GATE_DISABLE === "1") {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  const secret = process.env.NOTES_GATE_SECRET?.trim();

  if (pathname === "/login") {
    if (secret) {
      const token = request.cookies.get("notes_session")?.value;
      const ok = await verifySessionCookieValue(secret, token);
      if (ok) {
        return NextResponse.redirect(new URL("/", request.url));
      }
    }
    return NextResponse.next();
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (!secret) {
    return new NextResponse(
      "Notes access is locked but NOTES_GATE_SECRET is not set. Add it to .env.local",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }

  const token = request.cookies.get("notes_session")?.value;
  const ok = await verifySessionCookieValue(secret, token);
  if (!ok) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
