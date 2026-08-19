/**
 * Page and section chrome.
 *
 * Sections are bordered cards. An earlier version of this dashboard used
 * hairlines instead, on the argument that boxes waste the space that makes
 * figures comparable. That holds for a row of metrics and fails for a whole
 * page: several of these pages carry six or more sections, and without a
 * container they read as one continuous scroll with headings floating in it.
 * A card per section is also the Vercel dashboard language the team asked
 * for, so the two reasons agree.
 *
 * The header sits inside the card above a divider rather than above the card,
 * which is what makes the note read as a caption on that panel rather than as
 * a stray line of page copy.
 */

export function PageHeader({
  title,
  note,
}: {
  title: string;
  note?: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {note ? <p className="text-muted-foreground text-sm">{note}</p> : null}
    </div>
  );
}

export function Section({
  title,
  note,
  children,
  /** Drops the inner padding, for a table that should meet the card edge. */
  flush = false,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
  flush?: boolean;
}) {
  return (
    /*
     * min-w-0 because a Section is usually a grid or flex child, and both
     * default to min-width:auto. A chart inside then refuses to shrink below
     * its intrinsic size and drags the whole page wider than the phone.
     */
    <section className="bg-card min-w-0 rounded-lg border">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b px-4 py-3">
        <h2 className="text-sm font-medium">{title}</h2>
        {note ? <span className="text-muted-foreground text-xs">{note}</span> : null}
      </div>
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground py-10 text-sm">{children}</p>;
}
