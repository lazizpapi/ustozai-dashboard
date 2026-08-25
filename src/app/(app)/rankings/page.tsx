import { APP_STORE_MARK, GOOGLE_PLAY_MARK } from "@/components/tv/brand-logo";
import { PageHeader, Section } from "@/components/dashboard/page-header";
import { RankChart } from "@/components/dashboard/rank-chart";
import { SetupNotice } from "@/components/dashboard/setup-notice";
import { load } from "@/app/load";
import { rankHistory } from "@/lib/db/queries";
import {
  EDUCATION_GENRE,
  OVERALL_GENRE,
  PLAY_EDUCATION_CATEGORY,
} from "@/lib/collectors/config";

export const dynamic = "force-dynamic";

/**
 * Chart position across the feeds we poll.
 *
 * Each chart is its own panel rather than several series on one axis: they are
 * different populations, and overlaying them would invite reading a gap between
 * "iPhone Education" and "overall free" as movement when it is just a different
 * denominator. That argument holds twice over for the two stores, which rank
 * against entirely separate catalogues.
 *
 * Both stores have been polled every three hours since the Play collector
 * landed, but only Apple was ever drawn here. The Play series existed in
 * chart_ranks the whole time with nothing reading it.
 *
 * Ordered by chart rather than by store, so the pair that answers one question
 * sits together: Education first, since that is the chart the app competes in,
 * then the ungenred feed, then top grossing. Apple leads each pair throughout.
 */

const CHARTS = [
  {
    key: "topfree",
    genre: EDUCATION_GENRE,
    platform: "ios",
    icon: APP_STORE_MARK,
    title: "Education, iPhone",
    note: "top free, Uzbekistan",
    context: "in Education, App Store UZ",
  },
  {
    key: "topfreeipad",
    genre: EDUCATION_GENRE,
    platform: "ios",
    icon: APP_STORE_MARK,
    title: "Education, iPad",
    note: "top free, Uzbekistan",
    context: "in Education, App Store UZ",
  },
  {
    key: "topfree",
    genre: PLAY_EDUCATION_CATEGORY,
    platform: "android",
    icon: GOOGLE_PLAY_MARK,
    title: "Education, Google Play",
    note: "top free, Uzbekistan",
    context: "in Education, Google Play UZ",
  },
  {
    key: "topfree",
    genre: OVERALL_GENRE,
    platform: "ios",
    icon: APP_STORE_MARK,
    title: "All categories, iPhone",
    note: "top free overall, Uzbekistan",
    context: "in all categories, App Store UZ",
  },
  {
    key: "topfree",
    genre: OVERALL_GENRE,
    platform: "android",
    icon: GOOGLE_PLAY_MARK,
    title: "All categories, Google Play",
    note: "top free overall, Uzbekistan",
    context: "in all categories, Google Play UZ",
  },
  {
    key: "topgrossing",
    genre: EDUCATION_GENRE,
    platform: "ios",
    icon: APP_STORE_MARK,
    title: "Education, top grossing",
    note: "Uzbekistan",
    context: "in Education top grossing, App Store UZ",
  },
] as const;

export default async function RankingsPage() {
  const result = await load(
    () =>
      Promise.all(
        CHARTS.map((chart) =>
          rankHistory(chart.key, "uz", chart.genre, 90, chart.platform),
        ),
      ),
    "/rankings",
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
        // Keyed on the platform too: the two ungenred panels share a chart type
        // and a genre, and differ only in which store they read.
        <Section
          key={`${chart.platform}-${chart.key}-${chart.genre}`}
          icon={chart.icon}
          title={chart.title}
          note={chart.note}
        >
          <RankChart points={result.data[index]} context={chart.context} />
        </Section>
      ))}
    </div>
  );
}
