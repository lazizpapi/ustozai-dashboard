import "server-only";

import { SignJWT, importPKCS8 } from "jose";

import type { AscConfig } from "@/lib/env";

/**
 * App Store Connect request tokens.
 *
 * Per Apple's spec: ES256 only, `kid` in the header, and `aud` of
 * appstoreconnect-v1. The constraint that shapes this module is the expiry
 * ceiling: Apple rejects any token valid more than 20 minutes into the future,
 * so tokens are minted per run and never cached to disk.
 *
 * A .p8 file is already PKCS8 PEM, so it imports directly. We hold it base64
 * encoded in the environment purely so a multi-line PEM survives a single-line
 * env var.
 */

/** Comfortably inside Apple's 20 minute ceiling, with room for clock skew. */
const LIFETIME_SECONDS = 15 * 60;

export function decodePrivateKey(base64: string): string {
  const pem = Buffer.from(base64, "base64").toString("utf8").trim();

  if (!pem.includes("BEGIN PRIVATE KEY")) {
    // The overwhelmingly common mistake is grabbing the wrong file. A
    // certificate signing request is not an API key, and neither is the key id.
    const hint = pem.includes("CERTIFICATE REQUEST")
      ? "that is a certificate signing request, not an API key"
      : "expected a PKCS8 PEM beginning with -----BEGIN PRIVATE KEY-----";
    throw new Error(`ASC_PRIVATE_KEY_B64 does not hold a .p8 private key: ${hint}`);
  }
  return pem;
}

export async function createAscToken(config: AscConfig): Promise<string> {
  const pem = decodePrivateKey(config.ASC_PRIVATE_KEY_B64);
  const key = await importPKCS8(pem, "ES256");
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: config.ASC_KEY_ID, typ: "JWT" })
    .setIssuer(config.ASC_ISSUER_ID)
    .setAudience("appstoreconnect-v1")
    .setIssuedAt(now)
    .setExpirationTime(now + LIFETIME_SECONDS)
    .sign(key);
}
