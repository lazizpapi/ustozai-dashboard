/**
 * Pictures of Jarvis's browser, sent by the agent after each step that can
 * change the page (the agent's src/screen.py). Hosted, the browser has no
 * window, so this is how the caller sees what Jarvis is looking at.
 */

export const SCREEN_TOPIC = 'jarvis.screen';
const PROTOCOL_VERSION = '1';
const PICTURE_TYPES = new Set(['image/jpeg', 'image/png']);

export type ScreenCaption = {
  /** The site, without "www.", or empty when the address is not a web page. */
  host: string;
  /** The page title, or the site when the page has none. */
  title: string;
  /** A link to the page for the caller, only ever http or https. */
  href: string | null;
};

function webAddress(raw: string | undefined): URL | null {
  try {
    const url = new URL(raw ?? '');
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

/** The caption for a picture, or null when it is not one this screen shows. */
export function readScreen(
  mimeType: string,
  attributes: Record<string, string> | undefined
): ScreenCaption | null {
  if (!PICTURE_TYPES.has(mimeType) || attributes?.v !== PROTOCOL_VERSION) return null;
  const url = webAddress(attributes.url);
  const host = url ? url.hostname.replace(/^www\./, '') : '';
  const title = attributes.title?.trim() || host;
  return { host, title, href: url ? url.href : null };
}
