import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseEnv } from "@/lib/env";

/**
 * Service-role Supabase client for collectors and cron routes.
 *
 * This key bypasses row level security, so it must never reach the browser.
 * The `server-only` import above turns any accidental client-side import into
 * a build error rather than a leaked credential.
 *
 * Read paths that run in the user's session should use an anon-key client
 * instead, so RLS applies. See src/lib/db/queries.ts.
 */

let cached: SupabaseClient | null = null;

export function serviceClient(): SupabaseClient {
  if (cached) return cached;

  const env = requireSupabaseEnv();
  cached = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
