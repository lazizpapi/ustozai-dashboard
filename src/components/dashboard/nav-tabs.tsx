"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * The primary nav, as Vercel tabs.
 *
 * A client component only because the active tab depends on the current path,
 * and the server layout that renders it has no access to that. The items
 * themselves still come from roles.ts on the server, so a department is never
 * sent markup for a page it cannot open.
 *
 * The active tab is marked twice, by weight and by an underline that sits at
 * the bottom of the tab, directly above the header's own rule. Weight alone is
 * too quiet at this size, and an underline alone disappears for anyone who does
 * not notice a two pixel rule; together they are unambiguous without adding
 * colour, which the single accent is reserved for.
 */

export function NavTabs({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();

  return (
    <nav
      /*
       * min-w-0 is load-bearing. A flex child defaults to min-width:auto, so
       * without it the tab row refuses to shrink below its content, widens the
       * header, and every card on the page stretches to match: the whole
       * dashboard scrolled sideways on a phone because of this one rule.
       *
       * overflow-y-hidden is load-bearing too, and less obviously so. Setting
       * overflow on one axis forces the other to compute to auto rather than
       * visible, so overflow-x-auto alone makes this a scroll box on BOTH axes.
       * The tab row is exactly as tall as the header, which left nothing to
       * scroll vertically except a stray pixel, and Windows duly painted a full
       * scrollbar with arrows down the right-hand edge of the nav for it.
       *
       * The horizontal scrollbar is hidden rather than styled. The row still
       * scrolls by wheel, trackpad and touch when the tabs outgrow a narrow
       * window; a classic Windows scrollbar would eat 15px of a 56px header.
       */
      className={cn(
        "flex h-full min-w-0 items-stretch gap-1",
        "overflow-x-auto overflow-y-hidden",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      )}
      aria-label="Sections"
    >
      {items.map((item) => {
        // Exact match for the dashboard, prefix for everything else, so
        // /market/praktika keeps the Market tab lit.
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex items-center px-3 text-sm whitespace-nowrap transition-colors",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
            {active ? (
              // bottom-0, not -bottom-px. Hanging the underline a pixel below
              // its parent is what gave the nav something to scroll.
              <span
                className="bg-foreground absolute inset-x-2 bottom-0 h-0.5 rounded-full"
                aria-hidden
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
