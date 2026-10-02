import { describe, expect, it } from 'vitest';

import { agentFailureReason, failedCallReport, gaveUp, startFailureReason } from './failed-call';

/**
 * What the call screen reports when a call never got going, so the Calls page
 * shows it. Jarvis cannot report these itself: it was never there.
 */

describe('agentFailureReason', () => {
  // LiveKit's own sentences, from @livekit/components-react.
  it('tells "never joined" from "joined but never got ready"', () => {
    expect(agentFailureReason(['Agent did not join the room.'])).toBe('never_joined');
    expect(agentFailureReason(['Agent joined the room but did not complete initializing.'])).toBe('not_ready');
  });

  it('calls anything else Jarvis dropping out', () => {
    expect(agentFailureReason(['Agent left the room unexpectedly.'])).toBe('dropped');
    expect(agentFailureReason([])).toBe('dropped');
  });
});

describe('gaveUp', () => {
  it('counts leaving once the screen has said Jarvis is waking up', () => {
    expect(gaveUp(4000)).toBe(true);
    expect(gaveUp(30_000)).toBe(true);
  });

  it('ignores a call ended in its first seconds, which is a slip, not a failure', () => {
    expect(gaveUp(1500)).toBe(false);
  });
});

describe('failedCallReport', () => {
  it('sends the room, the reason and the wait in whole seconds', () => {
    expect(
      failedCallReport({
        room: 'jarvis_marketing_c14ed7e9',
        identity: 'marketing_c14ed7e9',
        reason: 'never_joined',
        waitedMs: 60_400,
        person: 'Dilnoza',
      })
    ).toEqual({
      room: 'jarvis_marketing_c14ed7e9',
      identity: 'marketing_c14ed7e9',
      reason: 'never_joined',
      waited_s: 60,
      person: 'Dilnoza',
    });
  });

  it('has nothing to send before the room was joined', () => {
    expect(failedCallReport({ room: '', identity: '', reason: 'gave_up', waitedMs: 9000, person: '' })).toBeNull();
  });
});

describe('startFailureReason', () => {
  const named = (name: string) => Object.assign(new Error('boom'), { name });

  // The browser refused it, found none, or another app holds it: the call
  // never started, though its room may still have connected for a moment.
  it('logs a microphone the browser could not use', () => {
    for (const name of ['NotAllowedError', 'NotFoundError', 'NotReadableError']) {
      expect(startFailureReason(named(name))).toBe('no_microphone');
    }
  });

  it('logs nothing for a cancelled start or a refused call token, which never reach a room', () => {
    expect(startFailureReason(named('AbortError'))).toBeNull();
    expect(
      startFailureReason(new Error('Error generating token from endpoint /api/jarvis-token: received 429 / {}'))
    ).toBeNull();
    expect(startFailureReason('nope')).toBeNull();
  });
});
