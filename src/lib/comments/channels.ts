import type { CommentActivityItem, CommentChannel } from "./client";

/**
 * The Comments page, one channel at a time.
 *
 * Pure on purpose: which channel a link opens, how repeats fold, and what each
 * outcome is called are the decisions worth testing, and none needs a page.
 */

const LABELS: Record<string, string> = {
  youtube: "YouTube",
  telegram: "Telegram",
  instagram: "Instagram",
};

/** The channel's name as the team says it, including one the bot adds before this file knows it. */
export function channelLabel(platform: string): string {
  return LABELS[platform] ?? platform.charAt(0).toUpperCase() + platform.slice(1);
}

/** The channel a link asked for, else the first one, so an old or mistyped link still opens a page. */
export function pickChannel(channels: CommentChannel[], requested: string | undefined): CommentChannel | null {
  return channels.find((channel) => channel.platform === requested) ?? channels[0] ?? null;
}

export interface FoldedRow {
  /** The newest comment of the run, which stands for the rest. */
  item: CommentActivityItem;
  /** How many identical decisions in a row it stands for, 1 when it is alone. */
  count: number;
}

/** Each of these needs reading on its own, however alike two of them look. */
const NEVER_FOLDED = new Set(["reply", "flag", "error"]);

/**
 * Folds runs of identical quiet decisions into one row.
 *
 * One person posting fifteen photos, or the same scam five times, otherwise
 * fills the table and pushes everything else off it. Only neighbours fold, so
 * the order of events survives, and only when the comment itself is the same:
 * two different questions turned down for the same reason stay two rows.
 */
export function foldRepeats(items: CommentActivityItem[]): FoldedRow[] {
  return items.reduce<FoldedRow[]>((rows, item) => {
    const last = rows.at(-1);
    return last && sameQuietDecision(last.item, item)
      ? [...rows.slice(0, -1), { ...last, count: last.count + 1 }]
      : [...rows, { item, count: 1 }];
  }, []);
}

function sameQuietDecision(a: CommentActivityItem, b: CommentActivityItem): boolean {
  return (
    !NEVER_FOLDED.has(a.category) &&
    a.category === b.category &&
    a.author === b.author &&
    (a.comment ?? "") === (b.comment ?? "") &&
    a.reason === b.reason &&
    a.moderation === b.moderation
  );
}

export interface Outcome {
  label: string;
  /** Set for the outcomes someone may need to act on. */
  strong: boolean;
}

/** What the bot did, as a word rather than a coloured dot. */
export function outcomeOf(item: CommentActivityItem): Outcome {
  if (item.moderation === "would_delete") return { label: "spam, left up", strong: true };
  if (item.moderation === "delete" || item.category === "deleted") return { label: "deleted as spam", strong: false };
  switch (item.category) {
    case "reply":
      return { label: "replied", strong: true };
    case "flag":
      return { label: "to a human", strong: true };
    case "error":
      return { label: "failed", strong: true };
    case "pending":
      return { label: "in progress", strong: false };
    default:
      return { label: "stayed quiet", strong: false };
  }
}
