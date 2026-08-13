/**
 * Audience collector parsers.
 *
 * Fixtures are real responses captured on 2026-08-12, so the expected values
 * double as a record of where the accounts stood that day. The YouTube fixture
 * deliberately includes a recommended channel's count alongside the real one,
 * because that is the failure this parser exists to avoid.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  RateLimitedError,
  parseCompactCount,
  parseInstagramApi,
  parseInstagramProfile,
  parseTelegramCount,
  parseYoutubeApi,
  parseYoutubeSubscribers,
} from "./social";
import { ParseError } from "./types";

const read = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
const json = (name: string) => JSON.parse(read(name));

describe("parseTelegramCount", () => {
  it("reads the member count of the real channel", () => {
    const snapshot = parseTelegramCount(json("telegram-members.json"), "ustozai");

    expect(snapshot.followers).toBe(50389);
    expect(snapshot.platform).toBe("telegram");
    expect(snapshot.isExact).toBe(true);
  });

  it("surfaces Telegram's own error text when the call is refused", () => {
    expect(() =>
      parseTelegramCount({ ok: false, description: "Bad Request: chat not found" }, "nope"),
    ).toThrow(/chat not found/);
  });

  it("rejects a response with no numeric result", () => {
    expect(() => parseTelegramCount({ ok: true }, "ustozai")).toThrow(ParseError);
  });
});

describe("parseInstagramProfile", () => {
  it("reads the follower count of the real profile", () => {
    const snapshot = parseInstagramProfile(json("instagram-profile.json"), "ustozai");

    expect(snapshot.followers).toBe(69306);
    expect(snapshot.isExact).toBe(true);
  });

  it("refuses a payload describing a different account", () => {
    // A block or a redirect can return a perfectly well-formed body for some
    // other profile. Recording that as our own follower count would be a
    // confident lie, so the username has to echo back.
    expect(() => parseInstagramProfile(json("instagram-profile.json"), "someoneelse")).toThrow(
      /expected profile someoneelse/,
    );
  });

  it("matches the username case-insensitively", () => {
    expect(parseInstagramProfile(json("instagram-profile.json"), "UstozAI").followers).toBe(69306);
  });

  it("throws on a login wall or empty body rather than returning zero", () => {
    expect(() => parseInstagramProfile({}, "ustozai")).toThrow(ParseError);
    expect(() =>
      parseInstagramProfile({ data: { user: { username: "ustozai" } } }, "ustozai"),
    ).toThrow(/follower count/);
  });
});

describe("parseInstagramApi", () => {
  it("reads followers_count from the official endpoint", () => {
    const snapshot = parseInstagramApi(
      { followers_count: 69312, username: "ustozai" },
      "ustozai",
    );

    expect(snapshot.followers).toBe(69312);
    expect(snapshot.isExact).toBe(true);
    expect(snapshot.platform).toBe("instagram");
  });

  it("trusts the username the token actually belongs to", () => {
    // The API answers for whoever authorised the token. If that is a different
    // account than we configured, recording our configured handle would label
    // someone else's follower count as ours.
    expect(
      parseInstagramApi({ followers_count: 100, username: "someoneelse" }, "ustozai").handle,
    ).toBe("someoneelse");
  });

  it("throws rather than reporting zero when the field is absent", () => {
    // An expired or under-scoped token returns a body with no count. Zero
    // followers would be a confident lie and would wreck the weekly delta.
    expect(() => parseInstagramApi({}, "ustozai")).toThrow(ParseError);
    expect(() => parseInstagramApi({ followers_count: null }, "ustozai")).toThrow(ParseError);
  });
});

describe("RateLimitedError", () => {
  it("is distinguishable from an ordinary failure", () => {
    // This is the check run-step uses to decide skipped versus failed.
    // Confirmed in production: the identical Instagram request returns 200
    // from a residential address and 429 from Vercel, three times running.
    const limited: unknown = new RateLimitedError("instagram");
    const broken: unknown = new Error("instagram returned 500");

    expect(limited instanceof RateLimitedError).toBe(true);
    expect(broken instanceof RateLimitedError).toBe(false);
  });

  it("says the limitation is the host, not the collector", () => {
    expect(new RateLimitedError("instagram").message).toContain("rate limited from this host");
  });
});

describe("parseCompactCount", () => {
  it("expands the suffixes YouTube uses", () => {
    expect(parseCompactCount("174K")).toBe(174_000);
    expect(parseCompactCount("53K")).toBe(53_000);
    expect(parseCompactCount("1.2M")).toBe(1_200_000);
    expect(parseCompactCount("2.5B")).toBe(2_500_000_000);
  });

  it("handles plain and comma-grouped integers", () => {
    expect(parseCompactCount("174")).toBe(174);
    expect(parseCompactCount("1,174")).toBe(1174);
  });

  it("returns null for anything unparseable", () => {
    for (const bad of ["", "abc", "12X", "K"]) expect(parseCompactCount(bad)).toBeNull();
  });
});

describe("parseYoutubeSubscribers", () => {
  const page = read("youtube-channel.html");

  it("reads the channel's own count, not a recommended channel's", () => {
    // The fixture contains a real 53K from a suggested-channel shelf ahead of
    // the real 174K. A loose scan of the live page returns 53K first, which
    // would be wrong by a factor of three.
    const snapshot = parseYoutubeSubscribers(page, "UstozAI");

    expect(snapshot.followers).toBe(174_000);
    expect(page).toContain("53K subscribers");
  });

  it("marks the figure as rounded", () => {
    // YouTube rounds to three significant figures everywhere, its own API
    // included, so the UI must not imply more precision than exists.
    expect(parseYoutubeSubscribers(page, "UstozAI").isExact).toBe(false);
  });

  it("throws when the page shape changes rather than guessing", () => {
    expect(() => parseYoutubeSubscribers("<html>nothing here</html>", "UstozAI")).toThrow(
      /page shape likely changed/,
    );
  });

  it("ignores a bare mention of subscribers with no header anchor", () => {
    expect(() =>
      parseYoutubeSubscribers('<div>12.3K subscribers</div>', "UstozAI"),
    ).toThrow(ParseError);
  });
});

describe("parseYoutubeApi", () => {
  it("reads the Data API shape when a key is configured", () => {
    const snapshot = parseYoutubeApi(
      { items: [{ statistics: { subscriberCount: "174000" } }] },
      "UstozAI",
    );

    expect(snapshot.followers).toBe(174_000);
    // Still rounded: the official API applies the same rule as the page.
    expect(snapshot.isExact).toBe(false);
  });

  it("throws on an empty items array", () => {
    expect(() => parseYoutubeApi({ items: [] }, "UstozAI")).toThrow(ParseError);
  });
});
