import { describe, expect, it } from 'vitest';
import type { AgentState } from '@livekit/components-react';
import { GOODBYE_VIEW, callOutcome, isAgentReady, orbViewFor } from './orb-state';

describe('orbViewFor', () => {
  it.each<[AgentState | undefined, string, string | null, string]>([
    [undefined, 'idle', null, 'none'],
    ['disconnected', 'idle', null, 'none'],
    ['connecting', 'thinking', 'Connecting', 'none'],
    ['initializing', 'thinking', 'Waking up', 'none'],
    ['pre-connect-buffering', 'listening', 'Listening', 'microphone'],
    ['idle', 'idle', null, 'none'],
    ['listening', 'listening', 'Listening', 'microphone'],
    ['thinking', 'thinking', 'Thinking', 'none'],
    ['speaking', 'streaming', null, 'agent'],
    ['failed', 'error', 'Call ended', 'none'],
  ])('maps %s to orb %s, status %s, amplitude from %s', (agent, orb, status, amplitude) => {
    expect(orbViewFor(agent)).toEqual({ orb, status, amplitude });
  });

  it('treats a state it does not know as idle rather than throwing', () => {
    expect(orbViewFor('something-new' as AgentState)).toEqual({
      orb: 'idle',
      status: null,
      amplitude: 'none',
    });
  });
});

describe('isAgentReady', () => {
  it.each<[AgentState, boolean]>([
    ['disconnected', false],
    ['connecting', false],
    ['pre-connect-buffering', false],
    ['initializing', false],
    ['failed', false],
    ['idle', true],
    ['listening', true],
    ['thinking', true],
    ['speaking', true],
  ])('%s: %s', (state, ready) => {
    expect(isAgentReady(state)).toBe(ready);
  });
});

describe('callOutcome', () => {
  it('is a goodbye when Jarvis leaves after saying it would', () => {
    expect(callOutcome('failed', true, true)).toBe('goodbye');
  });

  it('is a failure when Jarvis leaves without warning', () => {
    expect(callOutcome('failed', true, false)).toBe('failed');
  });

  it('ignores a failed state left over once the call is gone', () => {
    expect(callOutcome('failed', false, false)).toBeNull();
  });

  it('is nothing while the call is running normally', () => {
    expect(callOutcome('listening', true, true)).toBeNull();
  });
});

describe('GOODBYE_VIEW', () => {
  it('settles the orb with a goodbye instead of an error', () => {
    expect(GOODBYE_VIEW).toEqual({ orb: 'done', status: 'Goodbye', amplitude: 'none' });
  });
});
