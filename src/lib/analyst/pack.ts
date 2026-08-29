/**
 * The briefing handed to the analyst.
 *
 * Pure, and deliberately the agent's entire world. It reasons only from what
 * is in here, so this module has two jobs: include everything that could
 * explain a change, and never state a number the database did not produce.
 *
 * Everything is trimmed to a byte cap. An unbounded briefing eventually costs
 * more than the analysis is worth, and the trimming happens here — visibly,
 * newest-first — rather than as a truncation somewhere downstream that would
 * hand the model a torn-off half of a JSON document.
 */

export const PACK_MAX_BYTES = 25_000;

export interface PackInput {
  generatedAt: string;
  iosDownloads: { date: string; downloads: number }[];
  androidInstalls: { date: string; installs: number }[];
  funnel: {
    from: string;
    to: string;
    impressions: number;
    taps: number;
    pageViews: number;
    firstTimeDownloads: number;
  } | null;
  market: {
    name: string;
    isOurs: boolean;
    rank: number | null;
    rankPrevious: number | null;
    playInstalls: number | null;
    playInstallsPrevious: number | null;
    playRating: number | null;
    iosRating: number | null;
  }[];
  keywords: { keyword: string; position: number | null; previous: number | null }[];
  /**
   * What the team has taught the assistant, and what it was told last time.
   *
   * Both live in the pack rather than being appended to the prompt, because
   * the pack is stored with the report and is meant to be the whole of what
   * the model saw. A report shaped by a taught fact has to show that fact in
   * its own audit trail, or a wrong conclusion months later is untraceable.
   */
  teamFacts: string[];
  previousRecommendations: {
    date: string;
    items: { action: string; expectedImpact: string }[];
  } | null;
  newSuggestions: { store: string; seed: string; term: string }[];
  listingChanges: {
    appName: string;
    platform: string;
    detectedAt: string;
    changedFields: string[];
  }[];
  reviews: {
    total: number;
    averageRating: number | null;
    worst: { rating: number; title: string | null; body: string | null; platform: string }[];
  } | null;
  audience: { platform: string; current: number | null; previous: number | null }[];
  health: { source: string; status: string; error?: string | null }[];
  /** The visible top of the Education chart, so "who is above us" is answerable. */
  chartTop?: { rank: number; name: string; vsWeek: number | null }[];
}

/** Trimmed to keep a single bad review from eating the briefing. */
const REVIEW_BODY_CHARS = 300;

/** A taught fact is a sentence; the caps keep one from crowding the numbers. */
const FACT_CHARS = 300;
const MAX_FACTS = 30;

/** Last time's advice, trimmed to what is needed to judge whether it happened. */
const ACTION_CHARS = 200;
const IMPACT_CHARS = 160;
const MAX_PREVIOUS_RECOMMENDATIONS = 5;

/**
 * Collectors whose failure invalidates the analysis.
 *
 * Deliberately not "any failing collector". YouTube being blocked does not
 * make a download trend wrong, and treating every failure as fatal would mean
 * the report refuses to run on days when nothing important is broken.
 */
const CORE_SOURCES = [
  "itunes-lookup",
  "itunes-charts",
  "play-details",
  "asc-sales",
  "persist:",
];

const clip = (text: string | null, max: number): string | null =>
  text === null ? null : text.length <= max ? text : `${text.slice(0, max)}…`;

export interface AnalystPack {
  generatedAt: string;
  downloads: {
    ios: { recent: { date: string; downloads: number }[]; note: string };
    android: { recent: { date: string; installs: number }[]; note: string };
  };
  conversion: PackInput["funnel"];
  market: PackInput["market"];
  keywords: PackInput["keywords"];
  newSuggestions: PackInput["newSuggestions"];
  listingChanges: PackInput["listingChanges"];
  reviews: PackInput["reviews"];
  audience: PackInput["audience"];
  chartTop: NonNullable<PackInput["chartTop"]>;
  teamFacts: string[];
  previousRecommendations: PackInput["previousRecommendations"];
  pipeline: { failing: { source: string; error?: string | null }[] };
}

export function buildPack(input: PackInput): AnalystPack {
  const failing = input.health
    .filter((source) => source.status === "failed")
    .map((source) => ({ source: source.source, error: clip(source.error ?? null, 200) }));

  // Newest-first everywhere, so trimming drops the oldest and least useful.
  const pack: AnalystPack = {
    generatedAt: input.generatedAt,
    downloads: {
      ios: {
        recent: [...input.iosDownloads].slice(-14).reverse(),
        note: "Apple's own reporting day, published a day or two behind.",
      },
      android: {
        recent: [...input.androidInstalls].slice(-14).reverse(),
        note:
          "Derived by differencing Google's cumulative counter, which Google " +
          "updates roughly once a day. A zero can mean the counter has not " +
          "moved yet, not that nobody installed.",
      },
    },
    conversion: input.funnel,
    market: input.market,
    keywords: input.keywords,
    newSuggestions: input.newSuggestions.slice(0, 40),
    listingChanges: input.listingChanges.slice(0, 15),
    reviews: input.reviews
      ? {
          ...input.reviews,
          worst: input.reviews.worst.slice(0, 3).map((review) => ({
            ...review,
            title: clip(review.title, 120),
            body: clip(review.body, REVIEW_BODY_CHARS),
          })),
        }
      : null,
    audience: input.audience,
    chartTop: input.chartTop ?? [],
    // Clipped, because a taught fact is meant to be a sentence and one long
    // one should not be able to crowd out the numbers it is context for.
    teamFacts: input.teamFacts.map((fact) => clip(fact, FACT_CHARS)!).slice(0, MAX_FACTS),
    previousRecommendations: input.previousRecommendations
      ? {
          date: input.previousRecommendations.date,
          items: input.previousRecommendations.items
            .slice(0, MAX_PREVIOUS_RECOMMENDATIONS)
            .map((item) => ({
              action: clip(item.action, ACTION_CHARS)!,
              expectedImpact: clip(item.expectedImpact, IMPACT_CHARS)!,
            })),
        }
      : null,
    pipeline: { failing },
  };

  return trimToCap(pack);
}

/**
 * Shrink until the briefing fits, dropping the least decision-relevant parts
 * first. Order matters: suggestions and listing history are context, whereas
 * downloads, conversion and competitors are the report's subject.
 */
function trimToCap(pack: AnalystPack): AnalystPack {
  const shrinks: ((p: AnalystPack) => void)[] = [
    (p) => (p.newSuggestions = p.newSuggestions.slice(0, 15)),
    (p) => (p.listingChanges = p.listingChanges.slice(0, 5)),
    (p) => (p.newSuggestions = []),
    (p) => (p.keywords = p.keywords.slice(0, 10)),
    (p) => {
      p.downloads.ios.recent = p.downloads.ios.recent.slice(0, 7);
      p.downloads.android.recent = p.downloads.android.recent.slice(0, 7);
    },
    (p) => {
      if (p.reviews) p.reviews.worst = p.reviews.worst.slice(0, 1);
    },
    /*
     * Last, and in this order, because these two are the point of the day's
     * report rather than background for it: the facts are what the model
     * cannot otherwise know, and the previous advice is the only thing that
     * makes a recommendation into a loop instead of a fresh opinion every
     * morning. A briefing this large has bigger problems than either.
     */
    (p) => {
      if (p.previousRecommendations) {
        p.previousRecommendations.items = p.previousRecommendations.items.slice(0, 2);
      }
    },
    (p) => (p.teamFacts = p.teamFacts.slice(0, 10)),
    (p) => (p.previousRecommendations = null),
  ];

  for (const shrink of shrinks) {
    if (JSON.stringify(pack).length <= PACK_MAX_BYTES) break;
    shrink(pack);
  }

  return pack;
}

/**
 * True when the briefing describes numbers nobody should reason about.
 *
 * The report says so plainly instead of analysing stale data, which is the
 * one failure mode that would make every other number in it look authoritative
 * while being hours or days out of date.
 */
export function pipelineBroken(pack: AnalystPack): boolean {
  return pack.pipeline.failing.some((failure) =>
    CORE_SOURCES.some((core) => failure.source.startsWith(core)),
  );
}
