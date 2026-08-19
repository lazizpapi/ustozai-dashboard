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
 * The active tab is marked twice, by weight and by an underline that sits on
 * the header's own bottom border. Weight alone is too quiet at this size, and
 * an underline alone disappears for anyone who does not notice a two pixel
 * rule; together they are unambiguous without adding colour, which the single
 * accent is reserved for.
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
       */
      className="flex h-full min-w-0 items-stretch gap-1 overflow-x-auto"
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
              <span
                className="bg-foreground absolute inset-x-2 -bottom-px h-0.5 rounded-full"
                aria-hidden
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
