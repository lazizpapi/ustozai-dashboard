import { describe, expect, it } from 'vitest';
import { startErrorMessage } from './start-error';

const named = (name: string) => Object.assign(new Error('boom'), { name });

describe('startErrorMessage', () => {
  it('asks for the microphone when the browser refused it', () => {
    expect(startErrorMessage(named('NotAllowedError'), true)).toMatch(/allow the microphone/i);
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

  it('copes with something thrown that is not an Error', () => {
    expect(startErrorMessage('nope', false)).toMatch(/could not connect/i);
  });
});
