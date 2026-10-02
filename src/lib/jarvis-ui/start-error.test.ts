import { describe, expect, it } from 'vitest';
import { startErrorMessage } from './start-error';

const named = (name: string) => Object.assign(new Error('boom'), { name });

describe('startErrorMessage', () => {
  it('asks for the microphone when the browser refused it', () => {
    expect(startErrorMessage(named('NotAllowedError'), true)).toMatch(/allow the microphone/i);
  });

  // A microphone the browser already blocks fails the start at once, before
  // the room has begun connecting: the caller is still told, not left in silence.
  it('asks for the microphone when it was refused before the room connected', () => {
    expect(startErrorMessage(named('NotAllowedError'), false)).toBe(
      'Jarvis needs to hear you. Allow the microphone for this page, then try again.'
    );
  });

  it('says so when there is no microphone at all', () => {
    expect(startErrorMessage(named('NotFoundError'), false)).toMatch(/no microphone/i);
  });

  it('says so when another app holds the microphone', () => {
    expect(startErrorMessage(named('NotReadableError'), true)).toMatch(/another app/i);
  });

  it('stays quiet when the room connected, since the agent failure has its own message', () => {
    expect(startErrorMessage(new Error('agent did not join'), true)).toBeNull();
  });

  it('stays quiet when the user cancelled', () => {
    expect(startErrorMessage(named('AbortError'), false)).toBeNull();
  });

  it('points at the agent when the room could not be reached', () => {
    expect(startErrorMessage(new Error('token request failed'), false)).toMatch(
      /could not connect/i
    );
  });

  // The LiveKit token source puts the dashboard's status in its message.
  const tokenFailure = (status: number) =>
    new Error(`Error generating token from endpoint /api/jarvis-token: received ${status} / {}`);

  it('asks for a fresh sign-in when the session has ended', () => {
    expect(startErrorMessage(tokenFailure(401), false)).toMatch(/sign in again/i);
  });

  it("says the month's free minutes are spent, and when they come back", () => {
    expect(startErrorMessage(tokenFailure(429), false)).toMatch(/minutes.*1st/i);
  });

  it('says Jarvis is not set up when the dashboard lacks its call settings', () => {
    expect(startErrorMessage(tokenFailure(503), false)).toMatch(/not set up/i);
  });

  it('blames the dashboard, not the agent, for any other failed token request', () => {
    const message = startErrorMessage(tokenFailure(500), false);
    expect(message).toMatch(/dashboard could not start a call/i);
    expect(message).not.toMatch(/agent/i);
  });

  it('never tells the caller to check an agent they cannot see', () => {
    expect(startErrorMessage(new Error('could not reach the room'), false)).not.toMatch(/agent/i);
  });

  it('copes with something thrown that is not an Error', () => {
    expect(startErrorMessage('nope', false)).toMatch(/could not connect/i);
  });
});
