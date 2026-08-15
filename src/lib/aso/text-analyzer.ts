/**
 * Keyword frequency and density for any pasted listing text — Asomobile's
 * Text Analyzer, minus their proprietary volume estimates.
 *
 * Pure and client-safe: it runs in the browser on whatever the user pastes,
 * with no storage and no round trip.
 *
 * No stopword filtering, deliberately. There is no reliable Uzbek stopword
 * list, and silently applying an English one to mixed uz/ru/en text would
 * distort exactly the comparisons this exists for. Common words simply rank
 * high, and the reader can see that they are common words.
 */

export interface KeywordStat {
  term: string;
  count: number;
  /** Share of all words, 0..1. */
  density: number;
}

export interface TrackedMatch {
  keyword: string;
  count: number;
}

export interface TextAnalysis {
  wordCount: number;
  words: KeywordStat[];
  phrases: KeywordStat[];
  tracked: TrackedMatch[];
}

/**
 * Uzbek Latin writes its apostrophes several ways depending on the keyboard:
 * U+02BB (the official turned comma in oʻ and gʻ), U+02BC (the glottal stop
 * in taʼlim), U+2018/U+2019 (smart quotes phones substitute), or plain ASCII.
 * They are the same letterforms in the same words, so they normalise together
 * before anything is counted.
 */
const normalise = (text: string): string =>
  text.toLowerCase().replace(/[’ʻʼ‘`]/g, "'");

/** Words: letters and digits, with in-word apostrophes kept (oʻrganish, ta'lim). */
const WORD_PATTERN = /[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu;

const tokenize = (text: string): string[] =>
  [...normalise(text.replace(/<[^>]+>/g, " ")).matchAll(WORD_PATTERN)].map(
    (match) => match[0],
  );

function countTerms(terms: string[], total: number, limit: number): KeywordStat[] {
  const counts = new Map<string, number>();
  for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);

  return [...counts.entries()]
    .map(([term, count]) => ({ term, count, density: total === 0 ? 0 : count / total }))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
    .slice(0, limit);
}

/** Non-overlapping occurrences of a token sequence within another. */
function countPhrase(tokens: string[], phrase: string[]): number {
  if (phrase.length === 0) return 0;
  let count = 0;
  for (let i = 0; i + phrase.length <= tokens.length; i += 1) {
    if (phrase.every((word, offset) => tokens[i + offset] === word)) {
      count += 1;
      i += phrase.length - 1;
    }
  }
  return count;
}

export function analyzeText(
  text: string,
  trackedKeywords: readonly string[],
): TextAnalysis {
  const tokens = tokenize(text);
  const wordCount = tokens.length;

  const bigrams = tokens
    .slice(0, -1)
    .map((token, index) => `${token} ${tokens[index + 1]}`);

  // Tracked keywords deduplicate on their normalised form: the rank table
  // watches ta'lim in two spellings because Apple indexes them separately,
  // but in text they are one word and two identical rows would look broken.
  const seen = new Set<string>();
  const tracked: TrackedMatch[] = [];
  for (const keyword of trackedKeywords) {
    const phrase = tokenize(keyword);
    const key = phrase.join(" ");
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    tracked.push({ keyword, count: countPhrase(tokens, phrase) });
  }

  return {
    wordCount,
    words: countTerms(tokens, wordCount, 30),
    phrases: countTerms(bigrams, Math.max(bigrams.length, 1), 20).filter(
      (stat) => stat.count > 1,
    ),
    tracked,
  };
}
