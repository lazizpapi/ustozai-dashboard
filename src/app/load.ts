import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { hasAnyData } from "@/lib/db/queries";
import { SESSION_COOKIE, isValidSessionToken } from "@/lib/gate";

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

export async function requireSession(): Promise<void> {
  if (!(await isSignedIn())) redirect("/login");
}

export async function load<T>(fetcher: () => Promise<T>): Promise<LoadResult<T>> {
  // Outside the try on purpose. redirect() signals by throwing, and catching it
  // here would turn a sign-in redirect into a misleading "not configured" page.
  await requireSession();

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
