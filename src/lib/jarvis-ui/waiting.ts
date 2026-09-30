import type { AgentState } from '@livekit/components-react';

/**
 * On LiveKit's free plan the agent sleeps between calls and takes 10 to 20
 * seconds to wake. A "Connecting" that lasts that long looks stuck, so after
 * a few seconds the status line says what is happening.
 */

export const COLD_START_AFTER_MS = 4000;
export const COLD_START_STATUS = 'Waking Jarvis up, about 15 seconds';

/** The states in which Jarvis has not joined the call yet. */
const WAITING: ReadonlySet<AgentState> = new Set([
  'connecting',
  'initializing',
  'pre-connect-buffering',
]);

export function isWaitingForJarvis(state: AgentState | undefined): boolean {
  return state !== undefined && WAITING.has(state);
}

export function statusWhileWaiting(
  state: AgentState | undefined,
  waitingMs: number,
  status: string | null
): string | null {
  return isWaitingForJarvis(state) && waitingMs >= COLD_START_AFTER_MS ? COLD_START_STATUS : status;
}
