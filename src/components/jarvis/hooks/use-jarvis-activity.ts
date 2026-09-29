'use client';

import { useCallback, useEffect, useState } from 'react';
import { useDataChannel } from '@livekit/components-react';
import {
  ACTIVITY_TOPIC,
  type ActivityState,
  applyActivity,
  currentLabel,
  isCallEnding,
  nextExpiry,
  parseActivity,
  pruneActivity,
} from '@/lib/jarvis-ui/activity';

export interface JarvisActivity {
  /** What Jarvis is doing right now, or null. */
  label: string | null;
  /** Jarvis has said it is ending the call, so its exit is planned. */
  ending: boolean;
}

/**
 * What Jarvis is doing, from the agent's `jarvis.activity` messages. Only the
 * agent may set it, and every entry expires on its own, so nothing can get stuck.
 */
export function useJarvisActivity(isConnected: boolean): JarvisActivity {
  const [state, setState] = useState<ActivityState>([]);

  const onMessage = useCallback((msg: { payload: Uint8Array; from?: { isAgent: boolean } }) => {
    if (!msg.from?.isAgent) return;
    const event = parseActivity(msg.payload);
    if (event) setState((previous) => applyActivity(previous, event, Date.now()));
  }, []);

  useDataChannel(ACTIVITY_TOPIC, onMessage);

  // Wake up exactly when the next entry runs out, instead of polling.
  useEffect(() => {
    const at = nextExpiry(state);
    if (at === null) return;
    const timer = window.setTimeout(
      () => setState((previous) => pruneActivity(previous, Date.now())),
      Math.max(0, at - Date.now()) + 20
    );
    return () => window.clearTimeout(timer);
  }, [state]);

  // A new call starts with a clean slate. Adjusted during render, not in an effect.
  const [wasConnected, setWasConnected] = useState(isConnected);
  if (wasConnected !== isConnected) {
    setWasConnected(isConnected);
    if (!isConnected) setState([]);
  }

  return { label: currentLabel(state), ending: isCallEnding(state) };
}
