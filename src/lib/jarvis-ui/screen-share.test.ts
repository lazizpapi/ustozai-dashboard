import { describe, expect, it } from 'vitest';

import { canShareScreen } from './screen-share';

/**
 * Phone browsers cannot share their screen with a web page (MDN: no
 * getDisplayMedia on Safari for iOS, Chrome for Android or Firefox for
 * Android), so the call dock offers screen sharing only where it can work.
 */

describe('canShareScreen', () => {
  it('is true in a desktop browser', () => {
    expect(canShareScreen({ getUserMedia() {}, getDisplayMedia() {} })).toBe(
      true,
    );
  });

  it('is false on a phone, which has a camera but no screen sharing', () => {
    expect(canShareScreen({ getUserMedia() {} })).toBe(false);
  });

  it('is false where the page has no media devices at all', () => {
    expect(canShareScreen(undefined)).toBe(false);
  });
});
