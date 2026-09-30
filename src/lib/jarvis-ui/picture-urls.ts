/**
 * Pictures of Jarvis's browser live as object URLs until freed. Two can
 * arrive within one render, and the first is then never shown, so freeing
 * only the one that leaves the screen would leak it. Every URL made is kept,
 * and all but the one on screen are freed.
 */
export function staleUrls(made: ReadonlySet<string>, current: string | null): string[] {
  return [...made].filter((url) => url !== current);
}
