"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps the wall display current without anyone touching it.
 *
 * `router.refresh()` re-runs the server components and swaps the data in
 * place, so the screen never blanks or flashes the way a full reload would.
 *
 * Sixty seconds, and the render it triggers fetches a genuinely new audience
 * reading rather than re-reading the database. It used to be five minutes,
 * which was the right answer when the collectors behind the screen ran a
 * couple of times a day and a tighter interval would only have re-rendered the
 * same numbers.
 *
 * Not faster than sixty seconds, because the platforms are the limit now
 * rather than the screen. A 50k Telegram channel gains a member every several
 * minutes, so a tighter loop would spend requests to redraw an identical
 * figure. This is push-like in effect without holding a socket open on a
 * display that has to survive being unplugged.
 */
const REFRESH_MS = 60 * 1000;

export function AutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), REFRESH_MS);

    // A TV that has been asleep or on another input comes back stale. Refresh
    // the moment it becomes visible again rather than waiting out the timer.
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
