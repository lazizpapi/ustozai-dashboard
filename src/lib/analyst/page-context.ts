/**
 * What the chat knows about where it was opened from.
 *
 * The dock floats over every page, so the page you are looking at is free
 * context: "how are we doing?" means something different on Market than on
 * Reviews. That drives two things, the starter chips and one line appended to
 * the system prompt.
 *
 * Pure and keyed by pathname so it can be tested without a router.
 */

export interface PageContext {
  /** How the page is described to the model. */
  name: string;
  /** Starter questions offered when the conversation is empty. */
  suggestions: string[];
}

/** Offered when the path is unknown, and on pages with no special angle. */
const GENERAL: string[] = [
  "How are we doing this week?",
  "What should we work on next?",
  "Is anything broken or stale in the data?",
];

export const PAGE_CONTEXT: Record<string, PageContext> = {
  "/": {
    name: "Overview",
    suggestions: [
      "How are we doing this week?",
      "What changed since yesterday?",
      "What should we work on next?",
    ],
  },
  "/analyst": {
    name: "Analyst (the daily report)",
    suggestions: [
      "Explain the latest report in one paragraph",
      "What did the analyst miss?",
      "Which recommendation should we do first?",
    ],
  },
  "/growth": {
    name: "Growth (net change per period)",
    suggestions: [
      "Which audience is growing fastest?",
      "Was last week better or worse than the one before?",
      "Are downloads accelerating or flattening?",
    ],
  },
  "/rankings": {
    name: "Rankings (chart position over time)",
    suggestions: [
      "Why did our chart rank move?",
      "What is our best rank in the last month?",
      "Who overtook us recently?",
    ],
  },
  "/market": {
    name: "Market (competitors)",
    suggestions: [
      "Which competitor is growing fastest?",
      "Why are apps with fewer installs ranked above us?",
      "Has any competitor changed their listing lately?",
    ],
  },
  "/downloads": {
    name: "Downloads (installs and the conversion funnel)",
    suggestions: [
      "Where are we losing people in the funnel?",
      "How do this week's downloads compare to last week?",
      "Is the Play install count actually moving?",
    ],
  },
  "/keywords": {
    name: "Keywords (search positions and suggestions)",
    suggestions: [
      "Which keywords should we target next?",
      "What new search suggestions appeared?",
      "Which tracked terms are we not ranking for?",
    ],
  },
  "/reviews": {
    name: "Reviews",
    suggestions: [
      "What are people complaining about?",
      "Has our rating moved recently?",
      "What do the worst reviews have in common?",
    ],
  },
};

/** Strips the query string and any trailing slash, keeping "/" intact. */
function normalise(pathname: string): string {
  const path = (pathname || "/").split("?")[0].split("#")[0];
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/**
 * The page's name, or null when it is not one we know.
 *
 * Null rather than a guess: this ends up in the system prompt, and telling the
 * model the user is on a page they are not is worse than telling it nothing.
 */
export function pageName(pathname: string): string | null {
  return PAGE_CONTEXT[normalise(pathname)]?.name ?? null;
}

export function pageSuggestions(pathname: string): string[] {
  return PAGE_CONTEXT[normalise(pathname)]?.suggestions ?? GENERAL;
}
