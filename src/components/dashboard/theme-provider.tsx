"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * One theme for the whole page, never per section.
 *
 * Dark is the default because the app icon's own ground is a near-black slate
 * navy, but the OS preference wins when the viewer has one, and the toggle wins
 * over both.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
