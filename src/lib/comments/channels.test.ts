import { describe, expect, it } from "vitest";

import type { CommentActivityItem, CommentChannel } from "./client";
import { channelLabel, foldRepeats, outcomeOf, pickChannel } from "./channels";

function item(overrides: Partial<CommentActivityItem> = {}): CommentActivityItem {
  return {
    commentId: "c1",
    at: "2026-11-18T08:00:00Z",
    category: "skip",
    author: "Zinnura (@Zinnuramen)",
    comment: null,
    reply: null,
    reason: "No text to answer",
    posted: false,
    videoId: null,
    platform: "telegram",
    moderation: null,
    ...overrides,
  };
}

function channel(platform: string): CommentChannel {
  return {
    platform,
    health: { kind: "pushed", lastCommentAt: null, minutesSinceComment: null },
    counts: { replied24h: 0, flagged24h: 0, skipped24h: 0, deleted24h: 0, wouldDelete24h: 0, stuck24h: 0 },
    recent: [],
  };
}

describe("pickChannel", () => {
  const channels = [channel("youtube"), channel("telegram")];

  it("opens the channel the link asked for", () => {
    expect(pickChannel(channels, "telegram")?.platform).toBe("telegram");
  });

  it("opens the first channel when the link names none, or one the bot does not report", () => {
    expect(pickChannel(channels, undefined)?.platform).toBe("youtube");
    expect(pickChannel(channels, "instagram")?.platform).toBe("youtube");
  });

  it("has nothing to open when the bot reports no channels", () => {
    expect(pickChannel([], "telegram")).toBeNull();
  });
});

describe("channelLabel", () => {
  it("names the channels the way the team does", () => {
    expect(channelLabel("youtube")).toBe("YouTube");
    expect(channelLabel("telegram")).toBe("Telegram");
    expect(channelLabel("instagram")).toBe("Instagram");
  });

  it("still names a channel the bot adds before the dashboard knows it", () => {
    expect(channelLabel("tiktok")).toBe("Tiktok");
  });
});

describe("foldRepeats", () => {
  it("folds a run of photo-only comments from one person into a single row", () => {
    const rows = foldRepeats([
      item({ commentId: "a", at: "2026-11-18T08:03:00Z" }),
      item({ commentId: "b", at: "2026-11-18T08:02:00Z" }),
      item({ commentId: "c", at: "2026-11-18T08:01:00Z" }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 3, item: { commentId: "a" } });
  });

  it("folds the same spam posted again and again", () => {
    const spam = { comment: "37 000 000 so'm yordam oldim", moderation: "would_delete" as const };
    const rows = foldRepeats([item({ commentId: "a", ...spam }), item({ commentId: "b", ...spam })]);
    expect(rows.map((row) => row.count)).toEqual([2]);
  });

  it("keeps different comments apart, even from the same person for the same reason", () => {
    const reason = 'Topic "howto" is outside the auto-reply scope';
    const rows = foldRepeats([
      item({ commentId: "a", comment: "Kitob qaysi yilniki?", reason }),
      item({ commentId: "b", comment: "Darslar qachon?", reason }),
    ]);
    expect(rows.map((row) => row.count)).toEqual([1, 1]);
  });

  it("never folds replies or questions sent to a person, which each need reading", () => {
    const rows = foldRepeats([
      item({ commentId: "a", category: "flag", comment: "Oflayn kurslar bormi" }),
      item({ commentId: "b", category: "flag", comment: "Oflayn kurslar bormi" }),
      item({ commentId: "c", category: "reply", comment: "Rahmat", reply: "Marhamat 🙌" }),
      item({ commentId: "d", category: "reply", comment: "Rahmat", reply: "Marhamat 🙌" }),
    ]);
    expect(rows).toHaveLength(4);
  });

  it("only folds runs that sit next to each other, so the order of events survives", () => {
    const rows = foldRepeats([
      item({ commentId: "a" }),
      item({ commentId: "b", author: "Otamurod Norpulatov (@startup_founder_uzb)" }),
      item({ commentId: "c" }),
    ]);
    expect(rows.map((row) => row.item.commentId)).toEqual(["a", "b", "c"]);
  });
});

describe("outcomeOf", () => {
  it("says what the bot did in a word", () => {
    expect(outcomeOf(item({ category: "reply" })).label).toBe("replied");
    expect(outcomeOf(item({ category: "flag" })).label).toBe("to a human");
    expect(outcomeOf(item({ category: "error" })).label).toBe("failed");
    expect(outcomeOf(item({ category: "skip" })).label).toBe("stayed quiet");
  });

  it("calls caught spam spam, not a comment it chose to ignore", () => {
    expect(outcomeOf(item({ category: "skip", moderation: "would_delete" })).label).toBe("spam, left up");
    expect(outcomeOf(item({ category: "deleted", moderation: "delete" })).label).toBe("deleted as spam");
  });

  it("shows a comment still being handled as in progress", () => {
    expect(outcomeOf(item({ category: "pending" })).label).toBe("in progress");
  });

  it("makes the outcomes someone may need to act on stand out", () => {
    expect(outcomeOf(item({ category: "flag" })).strong).toBe(true);
    expect(outcomeOf(item({ category: "skip", moderation: "would_delete" })).strong).toBe(true);
    expect(outcomeOf(item({ category: "skip" })).strong).toBe(false);
  });
});
