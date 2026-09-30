import { describe, expect, it } from 'vitest';

import { staleUrls } from './picture-urls';

describe('staleUrls', () => {
  it('frees every picture but the one on screen, including any never shown', () => {
    // Two pictures can arrive in one render; the first is never shown, and
    // must still be freed.
    expect(staleUrls(new Set(['blob:a', 'blob:b', 'blob:c']), 'blob:c')).toEqual(['blob:a', 'blob:b']);
  });

  it('frees them all when the call has ended', () => {
    expect(staleUrls(new Set(['blob:a']), null)).toEqual(['blob:a']);
  });
});
