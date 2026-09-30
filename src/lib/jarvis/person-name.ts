/**
 * A caller's first name, as they typed it on the call screen, or nothing.
 *
 * Letters, joined by at most a space, apostrophe or hyphen, forty characters
 * at most: "Dilnoza", "Oʻlmas", "Ольга", "Anna-Maria". Anything else is
 * dropped rather than passed on, because the name reaches Jarvis's
 * instructions. The agent checks it the same way (its authority.py).
 */

export const MAX_PERSON_CHARS = 40;
const PERSON = /^\p{L}+(?:[ 'ʻʼ’-]\p{L}+)*$/u;

export function personName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const name = raw.split(/\s+/).filter(Boolean).join(" ");
  return name.length <= MAX_PERSON_CHARS && PERSON.test(name) ? name : "";
}
