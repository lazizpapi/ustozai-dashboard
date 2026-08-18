import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { hasAnyData } from "@/lib/db/queries";
import { SESSION_COOKIE, isValidSessionToken, roleFromToken } from "@/lib/gate";
import { canSee, type Role } from "@/lib/roles";

/**
 * Shared page loader: the access check, then the data.
 *
 * The access check is repeated here even though proxy.ts already redirects.
 * Next's own guidance is that a proxy check is optimistic and the authoritative
 * one belongs beside the data. Every page reaches its figures through this
 * function, which makes it the single choke point worth guarding.
 */

export type LoadResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "no-data" }
  | { kind: "unconfigured"; detail: string };

export async function isSignedIn(): Promise<boolean> {
  const store = await cookies();
  return isValidSessionToken(store.get(SESSION_COOKIE)?.value);
}

/** The signed-in department, or null. Never throws, so layouts can branch. */
export async function currentRole(): Promise<Role | null> {
  const store = await cookies();
  return roleFromToken(store.get(SESSION_COOKIE)?.value);
}

export async function requireSession(): Promise<Role> {
  const role = await currentRole();
  if (!role) redirect("/login");
  return role;
}

/**
 * The authoritative page check, beside the data rather than in the proxy.
 *
 * A department reaching a page it does not own goes to its own dashboard
 * rather than to an error. There is nothing for them to do about it, and a
 * 403 would confirm the page exists, which is a small thing not to leak.
 */
export async function requireAccess(path: string): Promise<Role> {
  const role = await requireSession();
  if (!canSee(role, path)) redirect("/");
  return role;
}

export async function load<T>(
  fetcher: () => Promise<T>,
  /** When given, the page is also checked against the department's access. */
  path?: string,
): Promise<LoadResult<T>> {
  // Outside the try on purpose. redirect() signals by throwing, and catching it
  // here would turn a sign-in redirect into a misleading "not configured" page.
  if (path) await requireAccess(path);
  else await requireSession();

  try {
    if (!(await hasAnyData())) return { kind: "no-data" };
    return { kind: "ok", data: await fetcher() };
  } catch (error) {
    return {
      kind: "unconfigured",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
