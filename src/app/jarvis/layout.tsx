import type { Metadata, Viewport } from "next";

import "./jarvis.css";

/**
 * Jarvis's own full-screen layout: no dashboard header, like /tv, and always
 * dark, because the orb is the only light on the screen.
 *
 * The manifest makes this page installable on a phone. Its scope is the whole
 * site so that signing in happens inside the installed app: iOS keeps a home
 * screen app's cookies apart from Safari's.
 */

export const metadata: Metadata = {
  title: "Jarvis",
  description: "UstozAI's voice assistant",
  manifest: "/jarvis.webmanifest",
  appleWebApp: { capable: true, title: "Jarvis", statusBarStyle: "black-translucent" },
  icons: { icon: "/jarvis-icon-192.png", apple: "/jarvis-apple-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#05080d",
  colorScheme: "dark",
  viewportFit: "cover",
};

export default function JarvisLayout({ children }: { children: React.ReactNode }) {
  return <div className="jarvis dark bg-background text-foreground min-h-dvh">{children}</div>;
}
