import "server-only";

import { fetchJson } from "@/lib/collectors/http";
import { commentBotEnv } from "@/lib/env";

/**
 * The YouTube comment bot's activity feed.
 *
 * The bot answers comments on the Ustoz AI channel in the brand's voice, and
 * escalates anything a person should handle. It keeps its own Supabase project
 * so a leak of its key cannot reach this dashboard's user data, which is why
 * this reads over HTTP rather than through the shared service client.
 *
 * Unlike the ustoz collectors, nothing here is persisted into our own database.
 * The bot's audit log is already the durable record, and copying a handful of
 * rows a day into a second store would only create something to fall out of
 * sync. If long-range charts are ever wanted, add a collector then.
 */

export class CommentBotNotConfiguredError extends Error {
  constructor(reason = "COMMENT_BOT_BASE_URL is not set") {
    super(reason);
    this.name = "CommentBotNotConfiguredError";
  }
}

export interface CommentActivityItem {
  commentId: string;
  at: string;
  /** "reply" posted publicly, "flag" sent to a human, "skip" left alone. */
  category: string;
  author: string | null;
  comment: string | null;
  reply: string | null;
  /** Why it acted that way, including which topics are out of scope. */
  reason: string | null;
  posted: boolean;
  videoId: string | null;
}

export interface CommentActivity {
  health: {
    lastPolledAt: string | null;
    minutesSincePoll: number | null;
    /** False when polling has stopped, and false when it has never run. */
    alive: boolean;
  };
  counts: {
    replied24h: number;
    flagged24h: number;
    skipped24h: number;
  };
  recent: CommentActivityItem[];
}

export async function fetchCommentActivity(): Promise<CommentActivity> {
  const config = commentBotEnv();
  if (!config) throw new CommentBotNotConfiguredError();

  const activity = await fetchJson<CommentActivity>(
    `${config.baseUrl}/api/activity`,
    { attempts: 2, timeoutMs: 15_000 },
    {
      accept: "application/json",
      "x-activity-token": config.token,
    },
  );

  // fetchJson answers null when the request fails. Returning that as an empty
  // feed would draw a calm page of zeroes over a bot that is actually down,
  // which is the one outcome this page exists to prevent.
  if (!activity) {
    throw new Error("comment bot did not answer; check COMMENT_BOT_TOKEN and that it is deployed");
  }

  return activity;
}
