import { PageHeader } from "@/components/dashboard/page-header";
import { AskPanel } from "@/components/dashboard/ask-panel";

export const dynamic = "force-dynamic";

/**
 * Chat with the analyst.
 *
 * Its own page rather than a panel on /analyst: that page is a document you
 * read top to bottom, and a scrolling conversation wedged into it would make
 * both worse. Same agent, same data, two ways in — the report it writes
 * unprompted each morning, and the questions you bring it.
 */
export default function AskPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        title="Ask"
        note="The analyst, with the whole dashboard in front of it."
      />
      <AskPanel />
    </div>
  );
}
