import { describe, expect, it } from 'vitest';
import {
  CALL_ENDING_KEY,
  MAX_ENTRIES,
  START_TTL_MS,
  applyActivity,
  currentLabel,
  isCallEnding,
  nextExpiry,
  parseActivity,
  pruneActivity,
} from './activity';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe('parseActivity', () => {
  it('reads a start event', () => {
    expect(
      parseActivity(
        encode({ v: 1, phase: 'start', key: 'search_the_web', label: 'Searching the web' })
      )
    ).toEqual({
      phase: 'start',
      key: 'search_the_web',
      label: 'Searching the web',
      ttlMs: START_TTL_MS,
    });
  });

  it('reads a note with its own lifetime', () => {
    expect(
      parseActivity(
        encode({
          v: 1,
          phase: 'note',
          key: 'team_draft',
          label: 'Waiting for your yes',
          ttl_s: 120,
        })
      )
    ).toEqual({ phase: 'note', key: 'team_draft', label: 'Waiting for your yes', ttlMs: 120_000 });
  });

  it('reads a done event without a label', () => {
    expect(parseActivity(encode({ v: 1, phase: 'done', key: 'search_the_web' }))).toEqual({
      phase: 'done',
      key: 'search_the_web',
    });
  });

  it.each([
    ['bytes that are not JSON', new TextEncoder().encode('not json')],
    ['another protocol version', encode({ v: 2, phase: 'start', key: 'a', label: 'b' })],
    ['an unknown phase', encode({ v: 1, phase: 'explode', key: 'a', label: 'b' })],
    ['a missing key', encode({ v: 1, phase: 'start', label: 'b' })],
    ['a start with no label', encode({ v: 1, phase: 'start', key: 'a' })],
    ['a blank label', encode({ v: 1, phase: 'start', key: 'a', label: '   ' })],
    [
      'a label too long for one line',
      encode({ v: 1, phase: 'start', key: 'a', label: 'x'.repeat(121) }),
    ],
    ['a lifetime out of range', encode({ v: 1, phase: 'note', key: 'a', label: 'b', ttl_s: 9999 })],
    ['an array', encode([1, 2])],
  ])('rejects %s', (_, bytes) => {
    expect(parseActivity(bytes)).toBeNull();
  });
});

describe('applyActivity', () => {
  const start = (key: string, label: string) =>
    ({ phase: 'start', key, label, ttlMs: START_TTL_MS }) as const;

  it('shows the newest activity', () => {
    let state = applyActivity([], start('open_url', 'Opening a page'), 0);
    state = applyActivity(state, start('get_revenue', 'Reading the dashboard'), 10);
    expect(currentLabel(state)).toBe('Reading the dashboard');
  });

  it('falls back to what is still running when the newest one finishes', () => {
    let state = applyActivity([], start('open_url', 'Opening a page'), 0);
    state = applyActivity(state, start('get_revenue', 'Reading the dashboard'), 10);
    state = applyActivity(state, { phase: 'done', key: 'get_revenue' }, 20);
    expect(currentLabel(state)).toBe('Opening a page');
  });

  it('shows nothing once everything has finished', () => {
    let state = applyActivity([], start('open_url', 'Opening a page'), 0);
    state = applyActivity(state, { phase: 'done', key: 'open_url' }, 5);
    expect(currentLabel(state)).toBeNull();
  });

  it('finishes one run at a time when the same tool runs twice', () => {
    let state = applyActivity([], start('read_page', 'Reading the page'), 0);
    state = applyActivity(state, start('read_page', 'Reading the page'), 1);
    state = applyActivity(state, { phase: 'done', key: 'read_page' }, 2);
    expect(currentLabel(state)).toBe('Reading the page');
  });

  it('replaces a note with the same key instead of stacking it', () => {
    const note = {
      phase: 'note',
      key: 'team_draft',
      label: 'Waiting for your yes',
      ttlMs: 1000,
    } as const;
    let state = applyActivity([], note, 0);
    state = applyActivity(state, { ...note, label: 'Still waiting' }, 1);
    expect(state).toHaveLength(1);
    expect(currentLabel(state)).toBe('Still waiting');
  });

  it('ignores a done for something it never saw', () => {
    const state = applyActivity([], start('open_url', 'Opening a page'), 0);
    expect(applyActivity(state, { phase: 'done', key: 'click' }, 1)).toBe(state);
  });

  it('keeps only the most recent entries', () => {
    let state: ReturnType<typeof applyActivity> = [];
    for (let i = 0; i < MAX_ENTRIES + 3; i += 1) {
      state = applyActivity(state, start(`tool_${i}`, `Step ${i}`), i);
    }
    expect(state).toHaveLength(MAX_ENTRIES);
    expect(currentLabel(state)).toBe(`Step ${MAX_ENTRIES + 2}`);
  });

  it('never mutates the state it was given', () => {
    const state = Object.freeze(applyActivity([], start('open_url', 'Opening a page'), 0));
    expect(() => applyActivity(state, start('click', 'Clicking'), 1)).not.toThrow();
    expect(state).toHaveLength(1);
  });
});

describe('pruneActivity', () => {
  it('drops an activity whose done was lost, so no line is stuck on screen', () => {
    const state = applyActivity(
      [],
      { phase: 'start', key: 'open_url', label: 'Opening a page', ttlMs: START_TTL_MS },
      0
    );
    expect(pruneActivity(state, START_TTL_MS - 1)).toBe(state);
    expect(pruneActivity(state, START_TTL_MS)).toEqual([]);
  });
});

describe('nextExpiry', () => {
  it('is the earliest time an entry runs out', () => {
    let state = applyActivity([], { phase: 'start', key: 'a', label: 'A', ttlMs: 5000 }, 0);
    state = applyActivity(state, { phase: 'note', key: 'b', label: 'B', ttlMs: 1000 }, 100);
    expect(nextExpiry(state)).toBe(1100);
  });

  it('is null when there is nothing to expire', () => {
    expect(nextExpiry([])).toBeNull();
  });
});

describe('isCallEnding', () => {
  it('is true while the goodbye note is up', () => {
    const state = applyActivity(
      [],
      { phase: 'note', key: CALL_ENDING_KEY, label: 'Saying goodbye', ttlMs: 60_000 },
      0
    );
    expect(isCallEnding(state)).toBe(true);
  });

  it('is false for any other activity', () => {
    const state = applyActivity(
      [],
      { phase: 'start', key: 'c1', label: 'Opening the page', ttlMs: START_TTL_MS },
      0
    );
    expect(isCallEnding(state)).toBe(false);
  });
});
