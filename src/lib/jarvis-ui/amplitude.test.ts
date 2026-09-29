import { describe, expect, it } from 'vitest';
import { scaleVolume, smoothLevel } from './amplitude';

describe('scaleVolume', () => {
  it('amplifies a quiet reading into a usable level', () => {
    expect(scaleVolume(0.1, 2.5)).toBeCloseTo(0.25);
  });

  it('never goes above 1', () => {
    expect(scaleVolume(0.9, 2.5)).toBe(1);
  });

  it.each([0, -0.2, Number.NaN, Number.POSITIVE_INFINITY])('reads %s as silence', (raw) => {
    expect(scaleVolume(raw)).toBe(0);
  });
});

describe('smoothLevel', () => {
  it('rises quickly so the first syllable shows', () => {
    expect(smoothLevel(0, 1)).toBeGreaterThanOrEqual(0.5);
  });

  it('falls slowly so the orb does not flicker between words', () => {
    const next = smoothLevel(1, 0);
    expect(next).toBeLessThan(1);
    expect(next).toBeGreaterThan(0.8);
  });

  it('settles to exactly zero instead of creeping forever', () => {
    expect(smoothLevel(0.0005, 0)).toBe(0);
  });
});
