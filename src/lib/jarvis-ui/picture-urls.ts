/**
 * Pictures of Jarvis's browser live as object URLs until freed. Two can
 * arrive within one render, and the first is then never shown, so freeing
 * only the one that leaves the screen would leak it. Every URL made is kept
 * in the order it was made; once one is on screen, all made before it are
 * freed, and any made after it, still on their way to the screen, are kept.
 * When the call ends, all go.
 */
export function staleUrls(made: readonly string[], current: string | null): string[] {
  if (current === null) return [...made];
  const shown = made.indexOf(current);
  return shown === -1 ? [] : made.slice(0, shown);
}
