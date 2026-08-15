import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Which reading of the same numbers you want.
 *
 * Four audiences ask four different questions of one warehouse, which is how
 * companies large enough to have four departments run a dashboard: not four
 * products, one set of collectors with a curated screen each.
 *
 * The URL carries the choice rather than client state, so a view is
 * linkable. "Look at /?view=it" is a useful thing to be able to say in a
 * message, and it also means the whole switcher stays a server component.
 */

export const VIEWS = [
  { key: "ceo", label: "Company", question: "are we growing?" },
  { key: "marketing", label: "Marketing", question: "is acquisition working?" },
  { key: "product", label: "Product", question: "what do users feel?" },
  { key: "it", label: "Pipeline", question: "is the data sound?" },
] as const;

export type ViewKey = (typeof VIEWS)[number]["key"];

/** Unknown values land on the company view rather than a 404. */
export function resolveView(value: string | undefined): ViewKey {
  return VIEWS.some((view) => view.key === value) ? (value as ViewKey) : "ceo";
}

export function ViewSwitcher({ current }: { current: ViewKey }) {
  const active = VIEWS.find((view) => view.key === current);

  return (
    <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b pb-2.5">
      <nav className="flex items-center gap-4 text-sm">
        {VIEWS.map((view) => (
          <Link
            key={view.key}
            href={view.key === "ceo" ? "/" : `/?view=${view.key}`}
            aria-current={view.key === current ? "page" : undefined}
            className={cn(
              "transition-colors",
              view.key === current
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {view.label}
          </Link>
        ))}
      </nav>
      {/* The question each view answers, which is more use than a title
          repeating the word already highlighted beside it. */}
      <span className="text-muted-foreground text-xs">{active?.question}</span>
    </div>
  );
}
