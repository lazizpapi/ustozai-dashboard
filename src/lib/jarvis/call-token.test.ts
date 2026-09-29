import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";

import { liveKitConfigFrom, mintCallToken, type LiveKitConfig } from "./call-token";

/**
 * The token that lets a signed-in person talk to Jarvis.
 *
 * The dashboard signs it with the LiveKit key, and it carries the caller's
 * department as a participant attribute. The agent trusts that attribute
 * because the browser cannot change a signed token, which is the whole reason
 * the token is minted here, beside the session cookie, and not in the page.
 */

const CONFIG: LiveKitConfig = {
  url: "wss://example.livekit.cloud",
  apiKey: "APIkey123",
  apiSecret: "a-test-secret-that-is-long-enough-for-hs256",
  agentName: "my-agent",
};

type Details = {
  serverUrl: string;
  roomName: string;
  participantName: string;
  participantToken: string;
};

async function mint(overrides: Partial<Parameters<typeof mintCallToken>[0]> = {}) {
  return mintCallToken({ role: "marketing", scope: "person", config: CONFIG, suffix: "ab12cd", ...overrides });
}

describe("a call token", () => {
  it("is refused to someone who is not signed in", async () => {
    const result = await mint({ role: null, scope: null });
    expect(result.status).toBe(401);
  });

  it("is refused to Jarvis's own browser session", async () => {
    // Jarvis signs its browser in to show pages. That session must never be
    // able to open a voice call, or a page Jarvis reads could start one.
    const result = await mint({ role: "ceo", scope: "jarvis" });
    expect(result.status).toBe(403);
  });

  it("says Jarvis is not set up when the LiveKit settings are missing", async () => {
    const result = await mint({ config: null });
    expect(result.status).toBe(503);
  });

  it("carries the caller's department inside the signed token", async () => {
    const result = await mint();
    expect(result.status).toBe(200);
    const details = result.body as Details;
    const claims = decodeJwt(details.participantToken);

    expect(claims.attributes).toEqual({ role: "marketing", name: "Marketing", v: "1" });
    expect(claims.sub).toBe("marketing_ab12cd");
    expect(details).toMatchObject({
      serverUrl: CONFIG.url,
      roomName: "jarvis_marketing_ab12cd",
      participantName: "Marketing",
    });
  });

  it("cannot rewrite its own department after joining", async () => {
    const { participantToken } = (await mint()).body as Details;
    const video = decodeJwt(participantToken).video as Record<string, unknown>;

    expect(video).toMatchObject({
      room: "jarvis_marketing_ab12cd",
      roomJoin: true,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
    });
    expect(video.canUpdateOwnMetadata).toBeFalsy();
  });

  it("opens a room for the caller and Jarvis alone, with Jarvis dispatched", async () => {
    // A second person in the room could say the yes that sends a team
    // message. LiveKit does not count agents toward the limit, so one means
    // the caller alone (a room limited to one still took Jarvis, 2026-09-29).
    const { participantToken } = (await mint()).body as Details;
    const roomConfig = decodeJwt(participantToken).roomConfig as Record<string, unknown>;

    expect(roomConfig.maxParticipants).toBe(1);
    expect(roomConfig.agents).toEqual([expect.objectContaining({ agentName: "my-agent" })]);
  });
});

describe("liveKitConfigFrom", () => {
  it("reads the four settings", () => {
    expect(
      liveKitConfigFrom({
        LIVEKIT_URL: "wss://x.livekit.cloud",
        LIVEKIT_API_KEY: "k",
        LIVEKIT_API_SECRET: "s",
        JARVIS_AGENT_NAME: "jarvis",
      }),
    ).toEqual({ url: "wss://x.livekit.cloud", apiKey: "k", apiSecret: "s", agentName: "jarvis" });
  });

  it("uses the agent's registered name when none is set", () => {
    const config = liveKitConfigFrom({ LIVEKIT_URL: "u", LIVEKIT_API_KEY: "k", LIVEKIT_API_SECRET: "s" });
    expect(config?.agentName).toBe("my-agent");
  });

  it("is null when any LiveKit setting is missing or blank", () => {
    expect(liveKitConfigFrom({ LIVEKIT_URL: "u", LIVEKIT_API_KEY: " " })).toBeNull();
  });
});
