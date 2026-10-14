import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/** Pages that require a signed-in user. Pages also check on the server; this is the fast path. */
const PROTECTED = ["/dashboard", "/learn", "/achievements", "/profile", "/update-password"];
/** Auth pages a signed-in user doesn't need. */
const AUTH_ONLY_FOR_GUESTS = ["/login", "/signup", "/forgot-password"];

const matches = (path: string, prefixes: string[]) => prefixes.some((p) => path === p || path.startsWith(`${p}/`));

/** Redirect while keeping any refreshed session cookies from updateSession. */
function redirectWithCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  if (!user && matches(pathname, PROTECTED)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return redirectWithCookies(url, response);
  }
  if (user && matches(pathname, AUTH_ONLY_FOR_GUESTS)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return redirectWithCookies(url, response);
  }
  return response;
}

export const config = {
  // Skip static assets and the API routes (route handlers verify auth themselves).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
