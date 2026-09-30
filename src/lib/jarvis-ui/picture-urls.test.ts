import { describe, expect, it } from 'vitest';

import { staleUrls } from './picture-urls';

describe('staleUrls', () => {
  it('frees every picture older than the one on screen, including any never shown', () => {
    // Two pictures can arrive in one render; the first is never shown, and
    // must still be freed.
    expect(staleUrls(['blob:a', 'blob:b', 'blob:c'], 'blob:c')).toEqual(['blob:a', 'blob:b']);
  });

  it('keeps a newer picture that has arrived but is not on screen yet', () => {
    expect(staleUrls(['blob:a', 'blob:b', 'blob:c'], 'blob:b')).toEqual(['blob:a']);
  });

  it('frees them all when the call has ended', () => {
    expect(staleUrls(['blob:a', 'blob:b'], null)).toEqual(['blob:a', 'blob:b']);
  });

  it('frees nothing it does not know about', () => {
    expect(staleUrls(['blob:a'], 'blob:z')).toEqual([]);
  });
});
