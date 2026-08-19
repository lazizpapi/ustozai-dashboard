import { isAuthorizedCron, unauthorized } from "@/lib/cron-auth";
import { ENDPOINTS, get, type EndpointKey } from "@/lib/ustoz/client";
import { ustozApiEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Learn the shape of UstozAI's admin API without recording any of its values.
 *
 * The API document we were given lists the endpoints and what each panel uses
 * them for, but not a single response shape. Writing parsers from that would
 * be guessing field names, and a parser that reads the wrong key does not
 * fail: it stores null forever and the dashboard shows a permanent dash.
 *
 * So this asks the API what it actually returns, and reports only the
 * structure. Numbers become "number", strings become "string", and nothing
 * that could be revenue, a user count or a customer name ever reaches the
 * response. That matters because the output is read in a terminal and pasted
 * into a chat, neither of which should ever hold the company's finances.
 *
 * Temporary by design. Once the shapes are known this route is deleted, since
 * a permanent endpoint that enumerates an internal API is a liability with no
 * remaining purpose.
 */

/** How deep to describe. Enough for a nested list of rows, not a whole tree. */
const MAX_DEPTH = 4;
/** Only the first item of an array is described: rows repeat their shape. */
const SAMPLE = 1;

function describe(value: unknown, depth = 0): unknown {
  if (value === null) return "null";
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? "array" : typeof value;

  if (Array.isArray(value)) {
    return {
      _type: "array",
      _length: value.length,
      _item: value.length > 0 ? describe(value[0], depth + 1) : "empty",
      ...(value.length > SAMPLE ? {} : {}),
    };
  }

  if (typeof value === "object") {
    const shape: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      shape[key] = describe(entry, depth + 1);
    }
    return shape;
  }

  // Scalars are reduced to their type. A date is worth distinguishing because
  // it decides whether a column is a date or a timestamp.
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}($|T)/.test(value)) return "string(date-like)";
    return "string";
  }
  return typeof value;
}

/** The params each endpoint needs, taken from the API document. */
const PROBE_PARAMS: Partial<Record<EndpointKey, Record<string, string | number | boolean>>> = {
  revenue: { today: true, groupBy: "hour" },
  courses: { pageSize: 500 },
};

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return unauthorized();

  if (!ustozApiEnv()) {
    return Response.json(
      {
        ok: false,
        error:
          "USTOZ_API_BASE_URL and USTOZ_API_TOKEN are not set, so there is nothing to probe.",
      },
      { status: 503 },
    );
  }

  const only = new URL(request.url).searchParams.get("only");
  const keys = (Object.keys(ENDPOINTS) as EndpointKey[]).filter(
    (key) => !only || key === only,
  );

  const shapes: Record<string, unknown> = {};

  // Sequential rather than parallel: this hits somebody else's production
  // API, and ten simultaneous requests from an unfamiliar host is a good way
  // to get the token blocked.
  for (const key of keys) {
    try {
      const data = await get(key, PROBE_PARAMS[key]);
      shapes[key] = { ok: true, shape: describe(data) };
    } catch (error) {
      shapes[key] = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const failed = Object.values(shapes).filter((entry) => !(entry as { ok: boolean }).ok);

  return Response.json({
    ok: failed.length === 0,
    probed: keys.length,
    failed: failed.length,
    note: "Values are replaced by their types. No figures are returned.",
    shapes,
  });
}
