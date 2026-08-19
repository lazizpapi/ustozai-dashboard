import "server-only";

import { z } from "zod";

/**
 * Server-side configuration, validated once at first use.
 *
 * Split into three groups on purpose. The public collectors need nothing at
 * all, so the dashboard runs and collects rank, rating, reviews and Play
 * installs before any credential exists. App Store Connect and Telegram each
 * degrade independently: missing config disables that feature and says so,
 * rather than crashing a cron run that would otherwise have succeeded.
 */

const supabaseSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  CRON_SECRET: z.string().min(16),
});

const ascSchema = z.object({
  ASC_KEY_ID: z.string().min(6),
  ASC_ISSUER_ID: z.string().uuid(),
  ASC_VENDOR_NUMBER: z.string().regex(/^\d+$/, "vendor number is digits only"),
  /**
   * The .p8 private key, base64 encoded so it survives a single-line env var.
   * Encode with: base64 -i AuthKey_XXXXXXXXXX.p8 | tr -d '\n'
   */
  ASC_PRIVATE_KEY_B64: z.string().min(100),
});

/**
 * The ongoing Analytics report request. Optional: without it the download
 * totals still collect from Sales and Trends, only the source breakdown is
 * missing. Created once with POST /v1/analyticsReportRequests and never
 * changes, so it lives in config rather than being rediscovered each run.
 */
export function analyticsRequestId(): string | null {
  return process.env.ASC_ANALYTICS_REQUEST_ID?.trim() || null;
}

/**
 * The OpenAI credential the analyst runs on.
 *
 * Optional, and its absence is a skip rather than a failure: without it every
 * collector still runs and every page still renders, and only the analyst is
 * dormant. Same pattern as the App Store and Instagram credentials.
 */
export function openaiKey(): string | null {
  return process.env.OPENAI_API_KEY?.trim() || null;
}

/**
 * Model override for the analyst. One env var covers both the daily report and
 * the chat, since they want the same judgement.
 */
export function analystModel(): string {
  return process.env.ANALYST_MODEL?.trim() || "gpt-5.6";
}

/**
 * The secret Telegram echoes back on every webhook call, in the
 * X-Telegram-Bot-Api-Secret-Token header. Set once at setWebhook time.
 *
 * Optional: without it the webhook route refuses everything, which is the
 * correct closed state for a deploy that has not been given the secret. The
 * five-minute pulse keeps the member count moving regardless, so the feature
 * degrades from live to near-live rather than breaking.
 *
 * Telegram restricts this to 1 to 256 characters of A-Z, a-z, 0-9, _ and -,
 * which is why the generated value is hex rather than base64url.
 */
export function telegramWebhookSecret(): string | null {
  return process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || null;
}

/**
 * UstozAI's own admin API: the only source for anything about the app itself
 * rather than the store pages around it. Revenue, subscriptions, active users
 * and course drop-off all live behind it.
 *
 * The base URL is stored without a trailing slash so path joining stays
 * predictable, and the token is required alongside it: a base URL with no
 * token would produce a run of 401s that look like an outage rather than a
 * missing setting.
 */
const ustozApiSchema = z.object({
  USTOZ_API_BASE_URL: z
    .string()
    .url("must be a full URL, for example https://api.example.com")
    .transform((value) => value.replace(/\/+$/, "")),
  USTOZ_API_TOKEN: z.string().min(10),
});

const telegramSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(20),
  TELEGRAM_CHAT_ID: z.string().min(1),
});

export type AscConfig = z.infer<typeof ascSchema>;
export type TelegramConfig = z.infer<typeof telegramSchema>;

/**
 * Audience accounts. Each platform is independent: an unset handle disables
 * only that collector, which then records itself as skipped rather than
 * failed. Telegram reuses TELEGRAM_BOT_TOKEN, since a bot can read any public
 * channel's member count without joining it.
 */
export interface SocialConfig {
  telegram: { channel: string; botToken: string } | null;
  instagram: { handle: string } | null;
  youtube: { handle: string; apiKey: string | null } | null;
}

/** Strips a leading @ and any surrounding whitespace. */
function handle(value: string | undefined): string | null {
  const trimmed = value?.trim().replace(/^@/, "");
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function socialEnv(): SocialConfig {
  const channel = handle(process.env.SOCIAL_TELEGRAM_CHANNEL);
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const instagram = handle(process.env.SOCIAL_INSTAGRAM_HANDLE);
  const youtube = handle(process.env.SOCIAL_YOUTUBE_HANDLE);

  return {
    telegram: channel && botToken ? { channel, botToken } : null,
    instagram: instagram ? { handle: instagram } : null,
    youtube: youtube
      ? { handle: youtube, apiKey: process.env.YOUTUBE_API_KEY?.trim() || null }
      : null,
  };
}

/** Throws. Supabase is the one hard requirement: without it nothing persists. */
export function requireSupabaseEnv() {
  const parsed = supabaseSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Supabase configuration is incomplete: ${missing}`);
  }
  return parsed.data;
}

/** Returns null when unconfigured. Callers skip the iOS download collectors. */
export function ascEnv(): AscConfig | null {
  const parsed = ascSchema.safeParse(process.env);
  return parsed.success ? parsed.data : null;
}

/** Returns null when unconfigured. The digest is skipped, the run still passes. */
export function telegramEnv(): TelegramConfig | null {
  const parsed = telegramSchema.safeParse(process.env);
  return parsed.success ? parsed.data : null;
}

export interface UstozApiConfig {
  baseUrl: string;
  token: string;
}

/**
 * Returns null when unconfigured, which closes the integration rather than
 * half-enabling it. Every caller treats null as "skip", the same way the
 * iOS download collectors treat a missing App Store Connect key.
 */
export function ustozApiEnv(): UstozApiConfig | null {
  const parsed = ustozApiSchema.safeParse(process.env);
  if (!parsed.success) return null;
  return {
    baseUrl: parsed.data.USTOZ_API_BASE_URL,
    token: parsed.data.USTOZ_API_TOKEN,
  };
}

/** Why the UstozAI panels are dormant, for the setup notice. */
export function ustozApiProblem(): string | null {
  const parsed = ustozApiSchema.safeParse(process.env);
  if (parsed.success) return null;
  return parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
}

/** Human-readable reason the iOS download panels are dormant, for the UI. */
export function ascConfigProblem(): string | null {
  const parsed = ascSchema.safeParse(process.env);
  if (parsed.success) return null;
  return parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
}
