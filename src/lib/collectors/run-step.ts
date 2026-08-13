import { RateLimitedError } from "./social";
import type { RunOutcome } from "@/lib/db/persist";

/**
 * Wraps one collector call so it can never take down a whole cron run.
 *
 * A single broken feed is the expected case, not the exceptional one: the
 * iTunes RSS is undocumented and Play's payload layout is internal. Each step
 * captures its own failure, and the caller persists whatever the healthy
 * sources returned.
 */

export interface StepResult<T> {
  outcome: RunOutcome;
  value: T | null;
}

export async function step<T>(
  source: string,
  run: () => Promise<T>,
): Promise<StepResult<T>> {
  const started = Date.now();
  try {
    const value = await run();
    const records = Array.isArray(value) ? value.length : value === null ? 0 : 1;
    return {
      value,
      outcome: { source, status: "ok", records, durationMs: Date.now() - started },
    };
  } catch (error) {
    // Being refused for the address we call from is a known limitation of the
    // host, not an incident. Recorded as skipped so the health panel does not
    // show a permanent red warning that teaches people to ignore warnings.
    if (error instanceof RateLimitedError) {
      return {
        value: null,
        outcome: {
          source,
          status: "skipped",
          error: error.message,
          durationMs: Date.now() - started,
        },
      };
    }

    return {
      value: null,
      outcome: {
        source,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started,
      },
    };
  }
}

export function skipped(source: string, reason: string): StepResult<never> {
  return { value: null, outcome: { source, status: "skipped", error: reason } };
}

/** Collects the non-null values from a batch of steps. */
export function values<T>(results: StepResult<T>[]): T[] {
  return results.flatMap((result) => (result.value === null ? [] : [result.value]));
}

export function outcomes(results: StepResult<unknown>[]): RunOutcome[] {
  return results.map((result) => result.outcome);
}
