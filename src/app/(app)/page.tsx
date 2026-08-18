import { CeoView } from "@/components/dashboard/views/ceo";
import { ItView } from "@/components/dashboard/views/it";
import { MarketingView } from "@/components/dashboard/views/marketing";
import { ProductView } from "@/components/dashboard/views/product";
import { requireSession } from "@/app/load";
import { viewFor } from "@/lib/roles";

export const dynamic = "force-dynamic";

/**
 * The dashboard, chosen by who signed in.
 *
 * There was a switcher here offering all four views to everybody. It went
 * because departments should not read each other's screens: the password
 * decides the dashboard, and there is no control to move between them.
 *
 * Each view fetches only what it shows, so a department never even queries
 * the data it is not entitled to.
 */
export default async function OverviewPage() {
  const role = await requireSession();

  switch (viewFor(role)) {
    case "marketing":
      return <MarketingView />;
    case "product":
      return <ProductView />;
    case "it":
      return <ItView />;
    default:
      return <CeoView />;
  }
}
