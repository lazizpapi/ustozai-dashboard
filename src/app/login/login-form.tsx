"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { signIn } from "./actions";

/**
 * Shared password entry.
 *
 * The password is posted to a server action and compared there; it is never
 * held in client state beyond the input itself, and never reaches the browser
 * in any response.
 *
 * Field and button are both h-10 rather than the h-8 default. This is the only
 * thing on the page, and the compact size that suits a dense dashboard reads as
 * cramped on an otherwise empty sign-in screen. They stay the same height as
 * each other, which is the part that matters.
 */
export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(signIn, {} as { error?: string });

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      <div className="space-y-2">
        <label htmlFor="password" className="block text-sm">
          Password
        </label>
        <PasswordInput
          id="password"
          name="password"
          required
          autoFocus
          autoComplete="current-password"
          aria-invalid={state?.error ? true : undefined}
          aria-describedby={state?.error ? "password-error" : undefined}
          className="h-10"
        />
      </div>

      <Button type="submit" disabled={pending} className="h-10 w-full">
        {pending ? "Checking" : "Enter"}
      </Button>

      {state?.error ? (
        <p id="password-error" className="text-status-critical text-sm" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
