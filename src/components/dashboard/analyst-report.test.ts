import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AnalystReportBody } from "./analyst-report";
import type { AnalystReport } from "@/lib/analyst/schema";

/**
 * Rendering a report, including the ones written before followUp existed.
 *
 * The history page draws every stored report through this component, and the
 * table holds reports from before the field was added. Those must render as
 * the complete reports they are, not as a page with an empty heading on it or
 * a crash inside a disclosure nobody opened during review.
 */

const base: AnalystReport = {
  health: "yellow",
  headline: "Downloads held steady while the Play rating slipped.",
  changes: [
    {
      metric: "App Store downloads",
      detail: "185 on 25 Aug, flat on the week",
      direction: "flat",
    },
  ],
  causes: [],
  recommendations: [
    {
      action: "Reply to the two one-star reviews",
      why: "Play rating fell 4.76 to 4.75",
      expectedImpact: "Rating stops sliding",
      effort: "low",
    },
  ],
  competitorWatch: [],
  dataGaps: [],
};

describe("AnalystReportBody", () => {
  it("renders a report written before followUp existed", () => {
    const html = renderToStaticMarkup(createElement(AnalystReportBody, { report: base }));

    expect(html).toContain("App Store downloads");
    expect(html).toContain("Reply to the two one-star reviews");
    // No heading for a section that has nothing under it.
    expect(html).not.toContain("Since last time");
  });

  it("leads with the follow-up when there is one", () => {
    /*
     * Above what moved today, because it is the only part of the report that
     * answers for itself. Advice nobody revisits costs attention every morning
     * and never has to be right.
     */
    const html = renderToStaticMarkup(
      createElement(AnalystReportBody, {
        report: {
          ...base,
          followUp: [
            { action: "Reply to the reviews", outcome: "Done; rating recovered to 4.76" },
          ],
        },
      }),
    );

    expect(html).toContain("Since last time");
    expect(html).toContain("Done; rating recovered to 4.76");
    expect(html.indexOf("Since last time")).toBeLessThan(html.indexOf("What moved"));
  });

  it("says nothing at all when the follow-up came back empty", () => {
    // An empty array is what a report writes when the briefing carried no
    // previous advice. That is not a section with nothing in it, it is no
    // section.
    const html = renderToStaticMarkup(
      createElement(AnalystReportBody, { report: { ...base, followUp: [] } }),
    );

    expect(html).not.toContain("Since last time");
  });
});
