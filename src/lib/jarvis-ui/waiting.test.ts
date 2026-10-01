import { describe, expect, it } from 'vitest';

import { COLD_START_STATUS, statusWhileWaiting } from './waiting';

/**
 * On LiveKit's free plan the agent sleeps between calls and takes 10 to 20
 * seconds to wake. Past the first few seconds the status line says so, instead
 * of a "Connecting" that looks stuck.
 */

describe('statusWhileWaiting', () => {
  it('keeps the usual line for the first few seconds', () => {
    expect(statusWhileWaiting('connecting', 3000, 'Connecting')).toBe('Connecting');
  });

  it('explains a longer wait while Jarvis has not joined', () => {
    for (const state of ['connecting', 'initializing', 'pre-connect-buffering'] as const) {
      expect(statusWhileWaiting(state, 4000, 'Waking up')).toBe(COLD_START_STATUS);
    }
    expect(COLD_START_STATUS).toMatch(/about 20 seconds/);
  });

  it('leaves the line alone once Jarvis is there', () => {
    expect(statusWhileWaiting('listening', 60_000, 'Listening')).toBe('Listening');
    expect(statusWhileWaiting(undefined, 60_000, null)).toBeNull();
  });
});
