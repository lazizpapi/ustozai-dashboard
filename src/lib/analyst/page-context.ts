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
  "/business": {
    name: "Business (takings, payment providers and active users)",
    suggestions: [
      "How much did we take last month?",
      "Which payment provider is growing?",
      "Are active users keeping pace with takings?",
    ],
  },
  "/audience": {
    name: "Audience (followers across the three channels)",
    suggestions: [
      "Which channel is growing fastest?",
      "Did any channel stop growing?",
      "How much of our audience is on Telegram?",
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

/**
 * Routes with something variable in the path.
 *
 * A competitor profile lives at /market/{slug} and a platform at
 * /audience/{platform}, so neither can be a key in the table above. They were
 * simply missing before: the dock rendered on both and sent no context at all,
 * which is the case this list closes. Ordered longest first, since a prefix
 * table is only unambiguous if the more specific entry is tried first.
 */
const PREFIX_CONTEXT: [string, PageContext][] = [
  [
    "/market/",
    {
      name: "a single competitor profile",
      suggestions: [
        "How is this app doing against us?",
        "What has this app changed recently?",
        "Is this app growing faster than we are?",
      ],
    },
  ],
  [
    "/audience/",
    {
      name: "one audience platform in detail",
      suggestions: [
        "How fast is this channel growing?",
        "When did this channel last move?",
        "How does this compare with the other channels?",
      ],
    },
  ],
];

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
function resolve(pathname: string): PageContext | null {
  const path = normalise(pathname);
  return PAGE_CONTEXT[path] ?? PREFIX_CONTEXT.find(([at]) => path.startsWith(at))?.[1] ?? null;
}

export function pageName(pathname: string): string | null {
  return resolve(pathname)?.name ?? null;
}

export function pageSuggestions(pathname: string): string[] {
  return resolve(pathname)?.suggestions ?? GENERAL;
}
