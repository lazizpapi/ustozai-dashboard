'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { type CallerPrefs, PREFS_KEY, readPrefs } from '@/lib/jarvis-ui/caller-prefs';

/**
 * The caller's choices, remembered on this phone. Storage can be blocked or
 * full (a private window, an iOS home screen app); the choice then still
 * holds for this visit, kept in memory.
 */

const listeners = new Set<() => void>();
let chosenThisVisit: string | undefined;

function subscribe(listener: () => void) {
  // A choice made in another tab is stored there: read storage again.
  const fromAnotherTab = (event: StorageEvent) => {
    if (event.key !== PREFS_KEY) return;
    chosenThisVisit = undefined;
    listener();
  };
  listeners.add(listener);
  window.addEventListener('storage', fromAnotherTab);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', fromAnotherTab);
  };
}

function stored(): string | null {
  if (chosenThisVisit !== undefined) return chosenThisVisit;
  try {
    return window.localStorage.getItem(PREFS_KEY);
  } catch {
    return null;
  }
}

export function useCallerPrefs(): [CallerPrefs, (next: CallerPrefs) => void] {
  // The server has no storage: it renders the defaults, and the phone's own
  // choice replaces them once the page is running.
  const saved = useSyncExternalStore(subscribe, stored, () => null);
  const prefs = useMemo(() => readPrefs(saved), [saved]);

  const choose = useCallback((next: CallerPrefs) => {
    chosenThisVisit = JSON.stringify(next);
    try {
      window.localStorage.setItem(PREFS_KEY, chosenThisVisit);
    } catch {
      // Remembered for this visit only.
    }
    for (const listener of listeners) listener();
  }, []);

  return [prefs, choose];
}
