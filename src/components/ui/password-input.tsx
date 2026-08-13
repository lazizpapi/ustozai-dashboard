"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Password field with a reveal toggle.
 *
 * Three details that custom password fields usually get wrong:
 *
 * The `name` and `autoComplete` props pass straight through to a real `input`,
 * so password managers still recognise, fill and offer to save the field. This
 * is the most common casualty of a hand-rolled password control.
 *
 * Visibility is never persisted. It resets to hidden on every mount, so a
 * revealed password cannot survive a back button or a restored tab.
 *
 * The toggle is `type="button"`. Inside a form, the default `submit` would mean
 * revealing the password also submits it.
 */
export function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type">) {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        // Room for the toggle, so a long value never runs underneath it.
        className={cn("pr-10", className)}
      />

      <button
        type="button"
        onClick={() => setVisible((shown) => !shown)}
        // Announces both the action and the current state.
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className={cn(
          "text-muted-foreground hover:text-foreground absolute inset-y-0 right-0",
          "flex w-10 items-center justify-center rounded-r-lg transition-colors",
          "active:translate-y-px",
          // A real tab stop with its own focus ring. Removing it from the tab
          // order would tidy the flow and make the control keyboard-inoperable,
          // which fails WCAG 2.1.1; the ring is inset so it does not collide
          // with the field's own focus ring.
          "focus-visible:ring-ring/40 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset",
        )}
      >
        {visible ? (
          <EyeOff className="size-4" aria-hidden />
        ) : (
          <Eye className="size-4" aria-hidden />
        )}
      </button>
    </div>
  );
}
