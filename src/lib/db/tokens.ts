import "server-only";

import { serviceClient } from "./client";

/**
 * Rotating credentials for third-party APIs.
 *
 * Instagram's long-lived tokens last 60 days and are refreshed by trading the
 * current one for a replacement. The property that shapes everything here: a
 * token that goes 60 days without a refresh expires permanently, and the only
 * cure is a person signing in again. So the job refreshes early, and shouts
 * before the deadline rather than after it.
 */

export type TokenProvider = "instagram";

export interface StoredToken {
  provider: TokenProvider;
  accessToken: string;
  expiresAt: string;
  refreshedAt: string;
}

/** Refresh once fewer than this remains, leaving a month of slack. */
export const REFRESH_WHEN_DAYS_LEFT = 30;

/** Inside this, a failed refresh stops being routine and needs a human. */
export const ESCALATE_WHEN_DAYS_LEFT = 14;

/** Meta requires a token to be at least a day old before it can be refreshed. */
const MIN_TOKEN_AGE_MS = 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export async function loadToken(provider: TokenProvider): Promise<StoredToken | null> {
  const { data, error } = await serviceClient()
    .from("integration_tokens")
    .select("provider, access_token, expires_at, refreshed_at")
    .eq("provider", provider)
    .maybeSingle();

  if (error) throw new Error(`loadToken(${provider}): ${error.message}`);
  if (!data) return null;

  return {
    provider: data.provider as TokenProvider,
    accessToken: data.access_token as string,
    expiresAt: data.expires_at as string,
    refreshedAt: data.refreshed_at as string,
  };
}

export async function saveToken(
  provider: TokenProvider,
  accessToken: string,
  expiresInSeconds: number,
): Promise<void> {
  const now = new Date();
  const { error } = await serviceClient().from("integration_tokens").upsert(
    {
      provider,
      access_token: accessToken,
      expires_at: new Date(now.getTime() + expiresInSeconds * 1000).toISOString(),
      refreshed_at: now.toISOString(),
    },
    { onConflict: "provider" },
  );
  if (error) throw new Error(`saveToken(${provider}): ${error.message}`);
}

export function daysUntilExpiry(token: StoredToken, now = Date.now()): number {
  return (new Date(token.expiresAt).getTime() - now) / DAY_MS;
}

/**
 * Pure so the arithmetic is testable without a database or a clock.
 *
 * Both conditions matter. Refreshing too eagerly is refused by Meta because
 * the token is under a day old; refreshing too late is unrecoverable.
 */
export function shouldRefresh(token: StoredToken, now = Date.now()): boolean {
  const oldEnough = now - new Date(token.refreshedAt).getTime() >= MIN_TOKEN_AGE_MS;
  const remaining = daysUntilExpiry(token, now);
  return oldEnough && remaining > 0 && remaining < REFRESH_WHEN_DAYS_LEFT;
}

interface RefreshResponse {
  access_token?: string;
  expires_in?: number;
}

/**
 * Trade the current Instagram token for a fresh 60 days.
 *
 * Returns false when nothing needed doing, so the caller can record a skipped
 * rather than a successful step and the health log stays truthful.
 */
export async function refreshInstagramToken(
  token: StoredToken,
  now = Date.now(),
): Promise<boolean> {
  if (!shouldRefresh(token, now)) return false;

  const url =
    "https://graph.instagram.com/refresh_access_token" +
    `?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token.accessToken)}`;

  const response = await fetch(url);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Instagram token refresh ${response.status}: ${detail.slice(0, 200)}`);
  }

  const body = (await response.json()) as RefreshResponse;
  if (!body.access_token || typeof body.expires_in !== "number") {
    throw new Error("Instagram token refresh returned no usable token");
  }

  await saveToken("instagram", body.access_token, body.expires_in);
  return true;
}

/**
 * The credential to use, seeding from the environment on first run.
 *
 * INSTAGRAM_ACCESS_TOKEN is a bootstrap only. Once a row exists the table is
 * the source of truth, because the stored token is the one that has been
 * rotated and the env var is frozen at whatever was first pasted in. Reading
 * the env var forever would mean using a token that eventually expires while a
 * perfectly good refreshed one sat in the database.
 */
export async function instagramToken(): Promise<StoredToken | null> {
  const stored = await loadToken("instagram");
  if (stored) return stored;

  const seed = process.env.INSTAGRAM_ACCESS_TOKEN?.trim();
  if (!seed) return null;

  // Meta issues these with 60 days of life. Assume the shorter end so the
  // first refresh happens early rather than late.
  const ASSUMED_LIFETIME_SECONDS = 55 * 24 * 60 * 60;
  await saveToken("instagram", seed, ASSUMED_LIFETIME_SECONDS);
  return loadToken("instagram");
}
