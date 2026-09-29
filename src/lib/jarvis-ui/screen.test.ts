import { describe, expect, it } from 'vitest';
import { readScreen } from './screen';

const attrs = (extra: Record<string, string> = {}) => ({
  v: '1',
  url: 'https://www.wikipedia.org/wiki/Tashkent',
  title: 'Tashkent - Wikipedia',
  ...extra,
});

describe('readScreen', () => {
  it('names the site and the page title for the caption', () => {
    expect(readScreen('image/jpeg', attrs())).toEqual({
      host: 'wikipedia.org',
      title: 'Tashkent - Wikipedia',
      href: 'https://www.wikipedia.org/wiki/Tashkent',
    });
  });

  it('falls back to the site when the page has no title', () => {
    expect(readScreen('image/jpeg', attrs({ title: '  ' }))?.title).toBe('wikipedia.org');
  });

  it('offers no link for an address that is not a web page', () => {
    const shown = readScreen('image/jpeg', attrs({ url: 'javascript:alert(1)' }));
    expect(shown?.href).toBeNull();
    expect(shown?.host).toBe('');
  });

  it('ignores anything that is not a picture', () => {
    expect(readScreen('text/html', attrs())).toBeNull();
  });

  it('ignores a picture from a newer agent it does not understand', () => {
    expect(readScreen('image/jpeg', attrs({ v: '2' }))).toBeNull();
    expect(readScreen('image/jpeg', undefined)).toBeNull();
  });
});
