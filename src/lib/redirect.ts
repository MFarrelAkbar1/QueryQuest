/**
 * Only allow same-site relative paths as post-login redirects (prevents open redirects
 * such as `?next=https://evil.example` or `?next=//evil.example`).
 */
export function safeNextPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
