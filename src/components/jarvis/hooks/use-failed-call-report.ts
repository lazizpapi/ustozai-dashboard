'use client';

import { useCallback, useEffect, useRef } from 'react';
import { ConnectionState } from 'livekit-client';
import { useAgent, useSessionContext } from '@livekit/components-react';
import type { FailedStartReason } from '@/lib/jarvis/calls';
import { failedCallReport, gaveUp } from '@/lib/jarvis-ui/failed-call';

/**
 * Reports a call that never got going, so the CEO's Calls page shows it.
 * Jarvis cannot report these itself: it was never there.
 *
 * Each call attempt is followed from the moment it starts connecting. Once
 * Jarvis is ready the call happened, and Jarvis records it; before that, the
 * first failure is reported once: LiveKit's (the reporter is returned, for
 * useAgentErrors), or the caller ending the call or leaving the page after the
 * screen said Jarvis was waking up.
 */

const READY = new Set(['listening', 'thinking', 'speaking']);
const ENDPOINT = '/api/jarvis-call-failed';

type Attempt = {
  startedAt: number;
  room: string;
  identity: string;
  ready: boolean;
  reported: boolean;
};

export function useFailedCallReport(person: string): (reason: FailedStartReason) => void {
  const session = useSessionContext();
  const agent = useAgent();
  const attempt = useRef<Attempt | null>(null);

  const report = useCallback(
    (reason: FailedStartReason) => {
      const current = attempt.current;
      if (!current || current.ready || current.reported) return;
      const body = failedCallReport({
        room: current.room || session.room.name,
        identity: current.identity || session.room.localParticipant.identity,
        reason,
        waitedMs: Date.now() - current.startedAt,
        person,
      });
      if (!body) return;
      current.reported = true;
      // keepalive: the report still goes out when the caller is leaving the page.
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch((error: unknown) => console.warn('Could not report the failed call:', error));
    },
    [session.room, person]
  );

  const { connectionState } = session;
  useEffect(() => {
    if (connectionState !== ConnectionState.Disconnected) {
      attempt.current ??= { startedAt: Date.now(), room: '', identity: '', ready: false, reported: false };
      if (connectionState === ConnectionState.Connected) {
        // Kept now: once the room has closed, it no longer says its name.
        attempt.current.room = session.room.name;
        attempt.current.identity = session.room.localParticipant.identity;
      }
      return;
    }
    const ended = attempt.current;
    if (ended && gaveUp(Date.now() - ended.startedAt)) report('gave_up');
    attempt.current = null;
  }, [connectionState, session.room, report]);

  useEffect(() => {
    if (attempt.current && READY.has(agent.state)) attempt.current.ready = true;
  }, [agent.state]);

  useEffect(() => {
    const leaving = () => {
      const current = attempt.current;
      if (current && gaveUp(Date.now() - current.startedAt)) report('gave_up');
    };
    window.addEventListener('pagehide', leaving);
    return () => window.removeEventListener('pagehide', leaving);
  }, [report]);

  return report;
}
