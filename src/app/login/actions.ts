"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  configuredPassword,
  issueSessionToken,
  passwordMatches,
} from "@/lib/gate";

/**
 * Sign in with the shared password.
 *
 * The deliberate delay on a wrong password is the only brute-force defence
 * here. Proper rate limiting needs shared state that serverless functions do
 * not have, so the real protection is the password being long; this just makes
 * an online guessing attack slow enough to be pointless.
 */

const WRONG_PASSWORD_DELAY_MS = 1000;

function safeNext(raw: FormDataEntryValue | null): string {
  const value = typeof raw === "string" ? raw : "/";
  // Only ever an in-app path. An absolute URL here would be an open redirect.
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export async function signIn(_state: { error?: string }, formData: FormData) {
  const next = safeNext(formData.get("next"));
  const password = formData.get("password");

  if (!configuredPassword()) {
    return { error: "No password is configured for this dashboard." };
  }

  if (typeof password !== "string" || !passwordMatches(password)) {
    await new Promise((resolve) => setTimeout(resolve, WRONG_PASSWORD_DELAY_MS));
    return { error: "That password is not right." };
  }

  const token = issueSessionToken();
  if (!token) return { error: "Could not start a session." };

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true, // Unreadable from JavaScript, so XSS cannot lift it.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  redirect(next);
}

export async function signOut() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
