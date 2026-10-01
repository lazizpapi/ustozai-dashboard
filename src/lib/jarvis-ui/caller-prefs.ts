import { personName } from '@/lib/jarvis/person-name';

/**
 * What a caller chose on the call screen: the language Jarvis greets them in,
 * and a first name. Remembered on their phone only, as a convenience; the
 * dashboard signs both into the call token beside the department, which they
 * cannot choose (src/lib/jarvis/call-token.ts).
 */

export type CallLanguage = 'en' | 'uz' | 'ru';
export type CallerPrefs = { lang: CallLanguage; name: string };

export const DEFAULT_PREFS: CallerPrefs = { lang: 'en', name: '' };
export const PREFS_KEY = 'jarvis.caller.v1';

/** Each language in its own words, as the caller reads it. */
export const LANGUAGE_LABELS: Record<CallLanguage, string> = {
  en: 'English',
  uz: 'Oʻzbek',
  ru: 'Русский',
};

function isLanguage(value: unknown): value is CallLanguage {
  return value === 'en' || value === 'uz' || value === 'ru';
}

/** What was saved, or the defaults when nothing usable was. */
export function readPrefs(stored: string | null): CallerPrefs {
  let parsed: unknown;
  try {
    parsed = stored ? JSON.parse(stored) : null;
  } catch {
    return DEFAULT_PREFS;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return DEFAULT_PREFS;
  const { lang, name } = parsed as Record<string, unknown>;
  return { lang: isLanguage(lang) ? lang : 'en', name: personName(name) };
}

/** One short line for the welcome screen: "Dilnoza · Oʻzbek", or "English". */
export function prefsSummary(prefs: CallerPrefs): string {
  const language = LANGUAGE_LABELS[prefs.lang];
  return prefs.name ? `${prefs.name} · ${language}` : language;
}

/** What the call screen asks the token for. */
export function tokenOptions(prefs: CallerPrefs): {
  participantName?: string;
  participantAttributes: { lang: CallLanguage };
} {
  return {
    ...(prefs.name ? { participantName: prefs.name } : {}),
    participantAttributes: { lang: prefs.lang },
  };
}

/**
 * How long the call screen waits for Jarvis to join. On LiveKit's free plan
 * the agent is scaled to zero between calls, and the cold start "adds 10 to
 * 20 seconds before the agent joins the room" (LiveKit's docs). The library's
 * own default is 20 seconds, the very top of that range, so the first call
 * after a quiet spell failed about half the time. A minute leaves room to
 * spare; past it, Jarvis is really down and the error is right.
 */
export const AGENT_JOIN_WAIT_MS = 60_000;

/** Everything the call screen passes to the session. */
export function sessionOptions(prefs: CallerPrefs): ReturnType<typeof tokenOptions> & {
  agentConnectTimeoutMilliseconds: number;
} {
  return { ...tokenOptions(prefs), agentConnectTimeoutMilliseconds: AGENT_JOIN_WAIT_MS };
}
