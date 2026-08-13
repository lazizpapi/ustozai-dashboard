/**
 * Fetch helpers shared by every collector.
 *
 * The retry behaviour here is not defensive boilerplate. Apple's legacy RSS
 * intermittently returns a well-formed feed with the entry array missing
 * entirely: during testing the reviews feed returned 50 entries, then five
 * consecutive empty responses for the identical URL, then 50 again. An empty
 * response is therefore never authoritative and must not be recorded as "there
 * are no reviews".
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_ATTEMPTS = 3;

/** Play serves a different payload to clients it does not recognise. */
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`${url} returned ${status}`);
    this.name = "HttpError";
  }
}

interface FetchOptions {
  attempts?: number;
  timeoutMs?: number;
  browserUa?: boolean;
  /**
   * Status codes to surface as a null result rather than an error. App Store
   * Connect returns 404 from salesReports to mean "no data for that date",
   * which is an ordinary outcome and not a failure.
   */
  emptyOn?: number[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchOnce(url: string, options: FetchOptions, headers: HeadersInit) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  try {
    return await fetch(url, { signal: controller.signal, headers });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET a URL, retrying transient failures with backoff.
 *
 * Returns null only for a status listed in `emptyOn`. Any other non-2xx after
 * the final attempt throws, so the caller records a failed run rather than
 * silently writing nothing.
 */
export async function fetchText(
  url: string,
  options: FetchOptions = {},
  extraHeaders: Record<string, string> = {},
): Promise<string | null> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const headers: Record<string, string> = {
    accept: "*/*",
    ...(options.browserUa ? { "user-agent": BROWSER_UA } : {}),
    ...extraHeaders,
  };

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchOnce(url, options, headers);
      if (options.emptyOn?.includes(response.status)) return null;
      if (response.ok) return await response.text();

      // 4xx other than the expected-empty set will not fix itself; fail fast.
      if (response.status < 500 && response.status !== 429) {
        throw new HttpError(url, response.status);
      }
      lastError = new HttpError(url, response.status);
    } catch (error) {
      if (error instanceof HttpError && error.status < 500 && error.status !== 429) {
        throw error;
      }
      lastError = error;
    }
    if (attempt < attempts) await sleep(500 * 2 ** (attempt - 1));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function fetchJson<T = unknown>(
  url: string,
  options: FetchOptions = {},
  extraHeaders: Record<string, string> = {},
): Promise<T | null> {
  const text = await fetchText(url, options, extraHeaders);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${url} returned a body that is not JSON`);
  }
}

/**
 * Retry a parse that legitimately yields nothing, for feeds that go
 * intermittently empty. Distinct from HTTP retry: the request succeeded, the
 * content was just missing.
 *
 * Returns the empty result after the final attempt rather than throwing, since
 * "genuinely nothing" and "flaked again" are indistinguishable from here. The
 * caller records the count so a run of zeroes shows up as staleness in the UI.
 */
export async function retryWhileEmpty<T>(
  attempt: () => Promise<T[]>,
  attempts = 3,
): Promise<T[]> {
  let result: T[] = [];
  for (let i = 1; i <= attempts; i += 1) {
    result = await attempt();
    if (result.length > 0) return result;
    if (i < attempts) await sleep(750 * i);
  }
  return result;
}
