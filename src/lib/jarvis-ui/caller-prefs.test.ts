import { describe, expect, it } from 'vitest';

import { DEFAULT_PREFS, prefsSummary, readPrefs, sessionOptions, tokenOptions } from './caller-prefs';

/**
 * What a caller chose on the call screen, remembered on their phone: the
 * language Jarvis greets them in, and a first name. Storage may be empty,
 * blocked or hand-edited, so every read falls back to English and no name.
 */

describe('readPrefs', () => {
  it('reads what was saved', () => {
    expect(readPrefs('{"lang":"uz","name":"Dilnoza"}')).toEqual({ lang: 'uz', name: 'Dilnoza' });
  });

  it('falls back for nothing saved, broken JSON, or values it does not know', () => {
    expect(readPrefs(null)).toEqual(DEFAULT_PREFS);
    expect(readPrefs('{oops')).toEqual(DEFAULT_PREFS);
    expect(readPrefs('{"lang":"de","name":"<b>x</b>"}')).toEqual(DEFAULT_PREFS);
    expect(readPrefs('[1,2]')).toEqual(DEFAULT_PREFS);
  });
});

describe('prefsSummary', () => {
  it('names the language, and the caller when they gave a name', () => {
    expect(prefsSummary({ lang: 'en', name: '' })).toBe('English');
    expect(prefsSummary({ lang: 'uz', name: 'Dilnoza' })).toBe('Dilnoza · Oʻzbek');
    expect(prefsSummary({ lang: 'ru', name: 'Ольга' })).toBe('Ольга · Русский');
  });
});

describe('tokenOptions', () => {
  it('asks for the chosen language, and the name only when there is one', () => {
    expect(tokenOptions({ lang: 'uz', name: 'Dilnoza' })).toEqual({
      participantName: 'Dilnoza',
      participantAttributes: { lang: 'uz' },
    });
    expect(tokenOptions({ lang: 'en', name: '' })).toEqual({ participantAttributes: { lang: 'en' } });
  });
});

describe('sessionOptions', () => {
  // On LiveKit's free plan the agent sleeps between calls, and waking it takes
  // 10 to 20 seconds (LiveKit's docs). The library gives up after 20 by
  // default, which turned the first call of 1 October into "Jarvis left".
  it('waits a full minute for a sleeping Jarvis', () => {
    expect(sessionOptions(DEFAULT_PREFS).agentConnectTimeoutMilliseconds).toBe(60_000);
  });

  it('still asks the token for the chosen language and name', () => {
    expect(sessionOptions({ lang: 'uz', name: 'Dilnoza' })).toEqual({
      participantName: 'Dilnoza',
      participantAttributes: { lang: 'uz' },
      agentConnectTimeoutMilliseconds: 60_000,
    });
  });
});
