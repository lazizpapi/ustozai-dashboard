'use client';

import { useCallback, useEffect, useRef } from 'react';
import { ConnectionState } from 'livekit-client';
import { toast } from 'sonner';
import { useSessionContext } from '@livekit/components-react';
import type { FailedStartReason } from '@/lib/jarvis/calls';
import { startFailureReason } from '@/lib/jarvis-ui/failed-call';
import { startErrorMessage } from '@/lib/jarvis-ui/start-error';

/** A fixed id: a second failed start replaces the message instead of stacking it. */
const START_FAILED_TOAST = 'jarvis-start-failed';
/** Long enough to act on: a refused microphone means a trip to the browser's settings. */
const START_FAILED_SHOWN_MS = 10_000;

interface StartCallOptions {
  /** Told why a call never started, while its room still has a name, for the call log. */
  onFailure?: (reason: FailedStartReason) => void;
}

/**
 * Starts a call, says once why it could not start, and leaves no call behind.
 *
 * LiveKit fetches the token, connects to the room and turns the microphone on
 * all at once, and start() rejects with the first failure while the others
 * carry on. A microphone the browser already blocks fails at once, often
 * before the room has even begun connecting, and ending the session then
 * changes nothing: the room connects a moment later and the call goes on with
 * no microphone, Jarvis greeting a caller it cannot hear.
 *
 * So a failed start is remembered until the next one, and a room that
 * connects for it is left as soon as it does. Such a call is ended rather than
 * kept for typing: the caller was just told to fix it and try again. It is
 * logged as it is left, while the room still has a name; logged only once it
 * had closed, it would count as the caller giving up.
 */
export function useStartCall({ onFailure }: StartCallOptions = {}): () => void {
  const session = useSessionContext();
  const { isConnected, end } = session;
  const failedStart = useRef<{ reason: FailedStartReason | null } | null>(null);

  useEffect(() => {
    const failed = failedStart.current;
    if (!isConnected || !failed) return;
    // Not forgotten here: pressed twice, both failed starts can connect a room,
    // one after the other. Only the next start clears it.
    if (failed.reason) onFailure?.(failed.reason);
    void end();
  }, [isConnected, end, onFailure]);

  return useCallback(() => {
    failedStart.current = null;
    session.start().catch((error: unknown) => {
      console.error('Could not start the call:', error);
      const connected = session.room.state === ConnectionState.Connected;
      const message = startErrorMessage(error, connected);
      if (message) {
        toast.error(message, { id: START_FAILED_TOAST, duration: START_FAILED_SHOWN_MS });
      }
      const reason = startFailureReason(error);
      if (!connected) failedStart.current = { reason };
      else if (reason) onFailure?.(reason);
      void session.end();
    });
  }, [session, onFailure]);
}
