import { NextResponse, type NextRequest } from "next/server";

/**
 * Issues the device key that stands in for a login.
 *
 * It lives in a cookie rather than localStorage because every page here is
 * server-rendered: the server has to know who you are *while* it renders, and
 * it cannot read localStorage. A cookie is still stored on the device, which
 * is what the no-accounts model actually promised.
 *
 * httpOnly, so page scripts cannot read it. The key is a capability — whoever
 * holds it is that member — and no client code needs it: mutations are server
 * actions, and they read the cookie themselves.
 */

export const DEVICE_COOKIE = "ste_device";

const FIVE_YEARS = 60 * 60 * 24 * 365 * 5;

export function middleware(request: NextRequest) {
  const existing = request.cookies.get(DEVICE_COOKIE)?.value;
  const key = existing ?? crypto.randomUUID().replaceAll("-", "");

  // Set it on the *request* too, so the very first page load already sees the
  // key rather than rendering once as a stranger.
  request.cookies.set(DEVICE_COOKIE, key);

  const response = NextResponse.next({ request: { headers: request.headers } });

  if (!existing) {
    response.cookies.set(DEVICE_COOKIE, key, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: FIVE_YEARS,
      path: "/",
    });
  }

  return response;
}

export const config = {
  matcher: ["/((?!api/health|_next/static|_next/image|favicon.ico|.*\\.svg$).*)"],
};
