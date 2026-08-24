"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps a page current without anyone touching it.
 *
 * `router.refresh()` re-runs the server components and swaps the data in
 * place, so the screen never blanks or flashes the way a full reload would.
 *
 * Sixty seconds, and the render it triggers fetches a genuinely new audience
 * reading rather than re-reading the database, because freshen.ts runs during
 * that render. It used to be five minutes, which was the right answer when the
 * collectors behind the screen ran a couple of times a day and a tighter
 * interval would only have re-rendered the same numbers.
 *
 * Not faster than sixty seconds, because the platforms are the limit now
 * rather than the screen. A 50k Telegram channel gains a member every several
 * minutes, so a tighter loop would spend requests to redraw an identical
 * figure. This is push-like in effect without holding a socket open.
 *
 * Written for the wall display, which has to survive being unplugged, and used
 * on the audience and business pages for the same reason in miniature: a tab
 * left open on somebody's second monitor should not quietly go hours stale.
 */
const REFRESH_MS = 60 * 1000;

export function AutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), REFRESH_MS);

    // A TV that has been asleep, or a tab that has been in the background for
    // an hour, comes back stale. Refresh the moment it becomes visible again
    // rather than making somebody look at old numbers until the timer fires.
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return null;
}
