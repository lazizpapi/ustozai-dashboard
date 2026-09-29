import "server-only";

import { RoomAgentDispatch, RoomConfiguration } from "@livekit/protocol";
import { AccessToken } from "livekit-server-sdk";

import type { SessionScope } from "@/lib/gate";
import type { Role } from "@/lib/roles";

import type { JarvisResponse } from "./handle";

/**
 * The token that lets a signed-in person talk to Jarvis.
 *
 * Minted here, on the server, beside the session cookie, because the agent
 * decides what to answer from the department inside it. The department goes
 * in as a participant attribute of a token signed with the LiveKit secret, so
 * the browser can read it but cannot change it, and the grant leaves out
 * canUpdateOwnMetadata so it cannot be rewritten after joining either.
 *
 * The room holds the caller and Jarvis and nobody else. The team-chat send
 * checks that a yes was said after the read-back; with one human in the room,
 * that yes is the caller's. LiveKit does not count agents toward
 * maxParticipants, so the limit is one. It is not a guarantee: on 2026-09-29 a
 * second person with their own token still got into such a room. The agent
 * therefore ends any call that anyone else joins, for everyone.
 *
 * Pure apart from signing, with the settings and the random suffix passed in,
 * so the tests can decode what comes out.
 */

export type LiveKitConfig = {
  url: string;
  apiKey: string;
  apiSecret: string;
  /** The name the agent registers under, which dispatch asks for. */
  agentName: string;
};

/** The agent's registered name in src/agent.py, used when none is configured. */
const DEFAULT_AGENT_NAME = "my-agent";

/** How long the token may be used to join. The call itself can run longer. */
const TOKEN_TTL = "15m";

const LABELS: Record<Role, string> = {
  ceo: "CEO",
  marketing: "Marketing",
  product: "Product",
  it: "IT",
};

export function liveKitConfigFrom(env: Record<string, string | undefined>): LiveKitConfig | null {
  const url = env.LIVEKIT_URL?.trim();
  const apiKey = env.LIVEKIT_API_KEY?.trim();
  const apiSecret = env.LIVEKIT_API_SECRET?.trim();
  if (!url || !apiKey || !apiSecret) return null;
  return { url, apiKey, apiSecret, agentName: env.JARVIS_AGENT_NAME?.trim() || DEFAULT_AGENT_NAME };
}

export type CallTokenInput = {
  role: Role | null;
  scope: SessionScope | null;
  config: LiveKitConfig | null;
  /** Random, to keep rooms and identities apart. */
  suffix: string;
};

export async function mintCallToken({ role, scope, config, suffix }: CallTokenInput): Promise<JarvisResponse> {
  if (!role) {
    return { status: 401, body: { ok: false, error: "Sign in to talk to Jarvis." } };
  }
  if (scope !== "person") {
    return { status: 403, body: { ok: false, error: "Jarvis's own session cannot start a call." } };
  }
  if (!config) {
    return {
      status: 503,
      body: { ok: false, error: "Jarvis is not set up here: LIVEKIT_URL, LIVEKIT_API_KEY or LIVEKIT_API_SECRET is missing." },
    };
  }

  const name = LABELS[role];
  const identity = `${role}_${suffix}`;
  const roomName = `jarvis_${role}_${suffix}`;

  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity,
    name,
    ttl: TOKEN_TTL,
    attributes: { role, name, v: "1" },
  });
  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  });
  token.roomConfig = new RoomConfiguration({
    maxParticipants: 1,
    agents: [new RoomAgentDispatch({ agentName: config.agentName })],
  });

  return {
    status: 200,
    body: {
      serverUrl: config.url,
      roomName,
      participantName: name,
      participantToken: await token.toJwt(),
    },
  };
}
