import { PageHeader, Section } from "@/components/dashboard/page-header";
import { RankChart } from "@/components/dashboard/rank-chart";
import { SetupNotice } from "@/components/dashboard/setup-notice";
import { load } from "@/app/load";
import { rankHistory } from "@/lib/db/queries";
import { EDUCATION_GENRE, OVERALL_GENRE } from "@/lib/collectors/config";

export const dynamic = "force-dynamic";

/**
 * Chart position across the feeds we poll.
 *
 * Each chart is its own panel rather than four series on one axis: they are
 * different populations, and overlaying them would invite reading a gap between
 * "iPhone Education" and "overall free" as movement when it is just a different
 * denominator.
 */

const CHARTS = [
  {
    key: "topfree",
    genre: EDUCATION_GENRE,
    title: "Education, iPhone",
    note: "top free, Uzbekistan",
  },
  {
    key: "topfreeipad",
    genre: EDUCATION_GENRE,
    title: "Education, iPad",
    note: "top free, Uzbekistan",
  },
  {
    key: "topfree",
    genre: OVERALL_GENRE,
    title: "All categories, iPhone",
    note: "top free overall, Uzbekistan",
  },
  {
    key: "topgrossing",
    genre: EDUCATION_GENRE,
    title: "Education, top grossing",
    note: "Uzbekistan",
  },
] as const;

export default async function RankingsPage() {
  const result = await load(() =>
    Promise.all(
      CHARTS.map((chart) => rankHistory(chart.key, "uz", chart.genre, 90)),
    ),
  );

  if (result.kind === "unconfigured") {
    return <SetupNotice reason="unconfigured" detail={result.detail} />;
  }
  if (result.kind === "no-data") return <SetupNotice reason="no-data" />;

  return (
    <div className="space-y-12">
      <PageHeader
        title="Rankings"
        note="Last 90 days. Lower is better, so the axis is inverted."
      />

      {CHARTS.map((chart, index) => (
        <Section
          key={`${chart.key}-${chart.genre}`}
          title={chart.title}
          note={chart.note}
        >
          <RankChart points={result.data[index]} />
        </Section>
      ))}
    </div>
  );
}
