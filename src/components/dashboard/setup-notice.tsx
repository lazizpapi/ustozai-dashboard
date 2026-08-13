import { formatNumber } from "@/lib/format";

/**
 * Shown before the database is connected or before the first collector run.
 *
 * It states real, measured figures for the app rather than mocked ones, and it
 * is explicit that history starts at first run. Neither Apple nor Google
 * publishes historical rank, so there is nothing to backfill and it is better
 * to say so than to leave someone waiting for charts that will never fill in
 * retroactively.
 */

interface SetupNoticeProps {
  reason: "unconfigured" | "no-data";
  detail?: string;
}

const STEPS: Record<SetupNoticeProps["reason"], string[]> = {
  unconfigured: [
    "Create a Supabase project and run supabase/migrations/0001_init.sql in its SQL editor.",
    "Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and CRON_SECRET.",
    "Call /api/cron/poll with the CRON_SECRET as a bearer token to take the first reading.",
  ],
  "no-data": [
    "Call /api/cron/poll with the CRON_SECRET as a bearer token to take the first reading.",
    "Call /api/cron/daily for keyword positions and reviews.",
    "Add both to a schedule so the series keeps building.",
  ],
};

export function SetupNotice({ reason, detail }: SetupNoticeProps) {
  return (
    <div className="max-w-2xl space-y-8 py-8">
      <div className="space-y-3">
        <h1 className="text-2xl font-medium tracking-tight">
          {reason === "unconfigured" ? "Not connected yet" : "No readings yet"}
        </h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {reason === "unconfigured"
            ? "The dashboard is built and the collectors are verified, but there is no database to write to."
            : "The database is connected and empty. Nothing has been collected yet."}
        </p>
      </div>

      <ol className="space-y-3 border-t pt-6 text-sm">
        {STEPS[reason].map((stepText, index) => (
          <li key={stepText} className="flex gap-4">
            <span className="tnum text-muted-foreground">{index + 1}</span>
            <span className="leading-relaxed">{stepText}</span>
          </li>
        ))}
      </ol>

      <div className="space-y-3 border-t pt-6">
        <p className="text-sm">Verified live before this was built:</p>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground text-xs">Education, Uzbekistan</dt>
            <dd className="tnum text-lg">#21</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Play installs</dt>
            <dd className="tnum text-lg">{formatNumber(530577)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Ratings</dt>
            <dd className="tnum text-lg">4.69 iOS, 4.76 Play</dd>
          </div>
        </dl>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Those are readings from 11 August 2026, kept here as a reference point only.
          Rank and rating history begins at the first collector run: neither store
          publishes past positions, so earlier days cannot be backfilled. iOS
          downloads are the exception and can be pulled back about a year once an
          App Store Connect key is connected.
        </p>
      </div>

      {detail ? (
        <p className="text-muted-foreground border-t pt-6 font-mono text-xs">{detail}</p>
      ) : null}
    </div>
  );
}
