import { ViewSwitcher, resolveView } from "@/components/dashboard/view-switcher";
import { CeoView } from "@/components/dashboard/views/ceo";
import { ItView } from "@/components/dashboard/views/it";
import { MarketingView } from "@/components/dashboard/views/marketing";
import { ProductView } from "@/components/dashboard/views/product";

export const dynamic = "force-dynamic";

/**
 * The overview, in four readings.
 *
 * One warehouse, four curated screens. Each view fetches only what it shows,
 * so switching to the pipeline view does not pay for the funnel query.
 *
 * Every view fits one viewport at lg and above: the height is fixed here and
 * the views distribute it internally, with their own lists scrolling rather
 * than the page. Below lg the frame is released and the page scrolls
 * normally, because a phone screen cannot hold a command centre and
 * pretending otherwise just clips it.
 *
 * The 8rem subtracted is the header's 4rem plus the 4rem of vertical padding
 * on the main element that wraps this.
 */
export default async function OverviewPage({
  searchParams,
}: PageProps<"/">) {
  const params = await searchParams;
  const raw = Array.isArray(params.view) ? params.view[0] : params.view;
  const view = resolveView(raw);

  return (
    <div className="lg:flex lg:h-[calc(100dvh-8rem)] lg:flex-col lg:overflow-hidden">
      <ViewSwitcher current={view} />

      <div className="lg:min-h-0 lg:flex-1">
        {view === "marketing" ? (
          <MarketingView />
        ) : view === "product" ? (
          <ProductView />
        ) : view === "it" ? (
          <ItView />
        ) : (
          <CeoView />
        )}
      </div>
    </div>
  );
}
