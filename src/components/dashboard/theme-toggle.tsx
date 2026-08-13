"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

/**
 * Light and dark switch.
 *
 * Dark is the default because the brand's own ground is a near-black slate
 * navy, but both modes are first-class: the series colours are separately
 * stepped for each surface and validated against both, not flipped.
 *
 * Both icons are always rendered and CSS picks one off the `dark` class on the
 * root. The usual alternative is a `mounted` flag set in an effect, which costs
 * a cascading render and still flashes; letting CSS decide means the correct
 * icon is right in the very first paint, server and client alike.
 */
export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Switch between light and dark mode"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="hidden size-4 dark:block" />
      <Moon className="size-4 dark:hidden" />
    </Button>
  );
}
