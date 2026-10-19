import { NextResponse, type NextRequest } from "next/server";

/**
 * UX convenience ONLY: bounce visitors with no session cookie to /login.
 * It is NOT a security boundary — every page, action and route handler
 * re-checks the session and membership on the server.
 */
export function middleware(req: NextRequest) {
  if (req.cookies.has("ld_session") || req.cookies.has("__Host-ld_session")) return NextResponse.next();
  const url = req.nextUrl.clone();
  const next = req.nextUrl.pathname;
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/businesses/:path*", "/admin/:path*"] };
