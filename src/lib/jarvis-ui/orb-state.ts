import type { AgentState } from '@livekit/components-react';
import type { AIState } from '@/components/smoothui/ai-core';

/** Whose voice the orb reacts to: the user's microphone, Jarvis's reply, or nobody. */
export type AmplitudeSource = 'microphone' | 'agent' | 'none';

export interface OrbView {
  /** The Siri Orb state that best shows what Jarvis is doing. */
  orb: AIState;
  /** One short line under the orb, or null when the orb says it alone. */
  status: string | null;
  amplitude: AmplitudeSource;
}

const IDLE: OrbView = { orb: 'idle', status: null, amplitude: 'none' };

const VIEWS: Record<AgentState, OrbView> = {
  disconnected: IDLE,
  idle: IDLE,
  connecting: { orb: 'thinking', status: 'Connecting', amplitude: 'none' },
  initializing: { orb: 'thinking', status: 'Waking up', amplitude: 'none' },
  'pre-connect-buffering': { orb: 'listening', status: 'Listening', amplitude: 'microphone' },
  listening: { orb: 'listening', status: 'Listening', amplitude: 'microphone' },
  thinking: { orb: 'thinking', status: 'Thinking', amplitude: 'none' },
  // Jarvis's own voice drives the orb, so a caption would only repeat it.
  speaking: { orb: 'streaming', status: null, amplitude: 'agent' },
  failed: { orb: 'error', status: 'Call ended', amplitude: 'none' },
};

/**
 * How the orb and status line show a LiveKit agent state. A state added by a
 * newer LiveKit falls back to idle, which is quiet rather than wrong.
 */
export function orbViewFor(state: AgentState | undefined): OrbView {
  return (state && VIEWS[state]) || IDLE;
}

const READY: ReadonlySet<AgentState> = new Set(['idle', 'listening', 'thinking', 'speaking']);

/**
 * Whether Jarvis has joined the call. Speech before that is buffered and
 * delivered when it arrives; typed text is not, so typing waits for this.
 */
export function isAgentReady(state: AgentState): boolean {
  return READY.has(state);
}

/** How the orb settles after Jarvis ends the call itself, on purpose. */
export const GOODBYE_VIEW: OrbView = { orb: 'done', status: 'Goodbye', amplitude: 'none' };

export type CallOutcome = 'goodbye' | 'failed';

/**
 * Why a live call just lost Jarvis, or null. LiveKit reports any agent exit as
 * `failed`, including the planned one after a goodbye, so the goodbye note
 * tells the two apart. A `failed` state left over after the call is gone is
 * ignored, so it can never linger on the welcome screen.
 */
export function callOutcome(
  state: AgentState,
  isConnected: boolean,
  ending: boolean
): CallOutcome | null {
  if (state !== 'failed' || !isConnected) return null;
  return ending ? 'goodbye' : 'failed';
}
