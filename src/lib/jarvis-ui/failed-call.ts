import type { FailedStartReason } from '@/lib/jarvis/calls';
import { COLD_START_AFTER_MS } from '@/lib/jarvis-ui/waiting';

/**
 * What the call screen reports when a call never got going, so the CEO's
 * Calls page shows it (src/lib/jarvis/failed-calls.ts checks and stores it).
 * Jarvis cannot report these itself: it was never there.
 */

/** Which failure LiveKit's own sentence describes (@livekit/components-react). */
export function agentFailureReason(reasons: readonly string[]): FailedStartReason {
  const said = reasons.join(' ');
  if (said.includes('did not join')) return 'never_joined';
  if (said.includes('did not complete initializing')) return 'not_ready';
  return 'dropped';
}

/**
 * A caller who ends the call, or leaves the page, before Jarvis is ready gave
 * up, once the screen has told them Jarvis is waking. Earlier it is a slip.
 */
export function gaveUp(waitedMs: number): boolean {
  return waitedMs >= COLD_START_AFTER_MS;
}

export type FailedCallReport = {
  room: string;
  identity: string;
  reason: FailedStartReason;
  waited_s: number;
  person: string;
};

/** The report to send, or null before the room was joined: there is no call to name. */
export function failedCallReport(call: {
  room: string;
  identity: string;
  reason: FailedStartReason;
  waitedMs: number;
  person: string;
}): FailedCallReport | null {
  if (!call.room || !call.identity) return null;
  return {
    room: call.room,
    identity: call.identity,
    reason: call.reason,
    waited_s: Math.round(call.waitedMs / 1000),
    person: call.person,
  };
}
