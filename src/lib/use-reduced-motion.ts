"use client";

import { useSyncExternalStore } from "react";

/**
 * Reads the OS reduced-motion setting.
 *
 * useSyncExternalStore rather than an effect writing state: this is a
 * subscription to something outside React, which is exactly what that hook is
 * for, and it avoids the extra render an effect would cost. The server
 * snapshot is false so the markup matches, and the client corrects on hydrate.
 */

const MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOTION_QUERY).matches,
    () => false,
  );
}
