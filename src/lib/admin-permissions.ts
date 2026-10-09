export type AdminRole = "MEMBER" | "ADMIN" | "OWNER";

const staffPaths = ["/admin/checkin", "/admin/rewards", "/admin/promo-codes", "/admin/coupons"];

export function canAccessAdminPath(role: unknown, pathname: string): boolean {
  // Match complete route segments, never prefixes such as /admin/members-extra.
  if (!/^\/admin(?:\/|$)/.test(pathname) || /[?#\\]|\/\.|\/\//.test(pathname)) return false;
  if (role === "OWNER") return true;
  return role === "ADMIN" && staffPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function adminLanding(role: AdminRole): string {
  return role === "OWNER" ? "/admin" : role === "ADMIN" ? "/admin/checkin" : "/member";
}
