import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { ThemeProvider } from "@/components/dashboard/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Ustoz AI store metrics",
  description: "App Store and Google Play position, ratings, reviews and downloads.",
  // Internal tool. Keep it out of search results regardless of who has the URL.
  robots: { index: false, follow: false },
};

/**
 * Root layout: document, fonts, providers. Nothing visual.
 *
 * The header and nav live in (app)/layout.tsx so that /login and /tv can render
 * without them. A wall display in particular should be all data and no chrome.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <ThemeProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
