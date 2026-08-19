import "server-only";

import { fetchJson } from "@/lib/collectors/http";
import { ustozApiEnv } from "@/lib/env";

/**
 * UstozAI's own admin API.
 *
 * Every other collector in this project reads a public store feed. This one
 * reads the app's own backend, which is the only place that can answer what
 * the stores never will: how many people are actually using the product, what
 * they pay, and where they stop inside a lesson.
 *
 * Three details come from the API document and are wrong to guess at:
 *
 * Everything is v1 except the course list, which is v2.
 *
 * Payloads are wrapped twice. The HTTP body is `{data: {data: ...}}`, so the
 * useful part is two levels down, and unwrapping once silently yields an
 * envelope that looks like data.
 *
 * Authentication is a bearer token with no refresh flow, so a 401 is a
 * configuration problem rather than an expiry to retry through. The token is
 * optional here because probing found the /statistics family answering
 * without one; it is sent whenever configured, so nothing breaks on the day
 * those endpoints are correctly put behind auth.
 */

/** Endpoints that required a bearer token when probed on 2026-08-19. */
export const NEEDS_TOKEN: ReadonlySet<EndpointKey> = new Set([
  "main",
  "usersAnalytics",
  "revenue",
  "mrr",
  "lessonDropoff",
  "courses",
]);

export const ENDPOINTS = {
  main: { path: "/admin/statistics/main", version: "v1" },
  usersAnalytics: { path: "/admin/statistics/users-analytics", version: "v1" },
  revenue: { path: "/admin/statistics/revenue", version: "v1" },
  mrr: { path: "/admin/statistics/mrr", version: "v1" },
  dauDaily: { path: "/statistics/views/daily", version: "v1" },
  mauGeneral: { path: "/statistics/dau/general-stats", version: "v1" },
  visitSummary: { path: "/statistics/visit-summary", version: "v1" },
  lessonDropoff: { path: "/admin/statistics/lesson-drop-off", version: "v1" },
  courses: { path: "/course/", version: "v2" },
  transactionsByProvider: {
    path: "/statistics/transactions/by-provider-date",
    version: "v1",
  },
} as const;

export type EndpointKey = keyof typeof ENDPOINTS;

export class UstozApiError extends Error {
  constructor(
    readonly endpoint: string,
    message: string,
  ) {
    super(`ustoz api ${endpoint}: ${message}`);
    this.name = "UstozApiError";
  }
}

/** Thrown when the integration is not configured, so callers can skip it. */
export class UstozNotConfiguredError extends Error {
  constructor(reason = "USTOZ_API_BASE_URL is not set") {
    super(reason);
    this.name = "UstozNotConfiguredError";
  }
}

type Params = Record<string, string | number | boolean | undefined>;

function buildUrl(baseUrl: string, version: string, path: string, params: Params): string {
  const url = new URL(`${baseUrl}/${version}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * Peel the `{data: {data: X}}` envelope.
 *
 * Tolerant of a single wrap, because an API that returns two shapes across
 * ten endpoints is likelier than one that is uniform, and being strict here
 * would turn a working endpoint into a failed collector.
 */
function unwrap(body: unknown, endpoint: string): unknown {
  if (body === null || typeof body !== "object") {
    throw new UstozApiError(endpoint, "response was not an object");
  }
  const outer = (body as { data?: unknown }).data;
  if (outer === undefined) return body;
  if (outer !== null && typeof outer === "object" && "data" in outer) {
    return (outer as { data: unknown }).data;
  }
  return outer;
}

/**
 * One GET against the admin API, unwrapped.
 *
 * Retries are inherited from fetchJson, which is right for a flaky network
 * and wrong for a bad token, so a 401 is surfaced as its own error rather
 * than being retried into a timeout.
 */
export async function get(endpoint: EndpointKey, params: Params = {}): Promise<unknown> {
  const config = ustozApiEnv();
  if (!config) throw new UstozNotConfiguredError();

  // Fail before the request rather than reading a 401 as an outage. Without a
  // token these endpoints can never succeed, and a clear reason in collector
  // health is worth more than a retried failure.
  if (NEEDS_TOKEN.has(endpoint) && !config.token) {
    throw new UstozNotConfiguredError(
      `${endpoint} needs USTOZ_API_TOKEN, which is not set`,
    );
  }

  const spec = ENDPOINTS[endpoint];
  const url = buildUrl(config.baseUrl, spec.version, spec.path, params);

  const body = await fetchJson<unknown>(
    url,
    { attempts: 2, timeoutMs: 20_000 },
    {
      accept: "application/json",
      ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
    },
  );

  if (body === null) throw new UstozApiError(endpoint, "empty response");
  return unwrap(body, endpoint);
}
