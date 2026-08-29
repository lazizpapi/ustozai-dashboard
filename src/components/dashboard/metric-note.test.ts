import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Metric } from "./metric";

/**
 * The markup around a note marker, checked rather than assumed.
 *
 * There is one real hazard in this component and it is invisible in review: the
 * tile is often a link, a popover trigger is a button, and a button inside an
 * anchor is invalid markup that browsers resolve by following the link. The
 * note would open and the page would navigate out from under it.
 *
 * So the marker is rendered as a sibling of the anchor rather than a child, and
 * this asserts that arrangement on the actual output. Rendered statically,
 * which is enough: the nesting is decided at render time, not on click.
 */

const note = {
  noteUz: "Yuklab olishlar ikki baravar oshdi.",
  movementDate: "2026-08-27",
  direction: "up" as const,
  magnitude: "240 on 2026-08-27, against a typical 100 a day",
};

/** The anchor and everything it contains, or null when there is no link. */
function anchorOf(html: string): string | null {
  const match = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/);
  return match?.[0] ?? null;
}

describe("Metric with a note", () => {
  it("keeps the trigger out of the link", () => {
    const html = renderToStaticMarkup(
      createElement(Metric, {
        label: "App Store downloads",
        value: "240",
        href: "/downloads",
        note,
      }),
    );

    expect(html).toContain("<button");
    expect(html).toContain("<a");

    // The whole point: the button exists, and it is not inside the anchor.
    expect(anchorOf(html)).not.toContain("<button");
  });

  it("names the movement for a reader who cannot see the glyph", () => {
    const html = renderToStaticMarkup(
      createElement(Metric, { label: "App Store downloads", value: "240", note }),
    );

    expect(html).toContain("AI izohi");
    expect(html).toContain("240 on 2026-08-27");
  });

  it("renders a tile without a note exactly as it always did", () => {
    /*
     * The wrapper only appears when there is something to hang on it. Nearly
     * every tile on nearly every day has no note, and those must not pay a
     * layout element for the ones that do.
     */
    const plain = renderToStaticMarkup(
      createElement(Metric, { label: "App Store downloads", value: "240", href: "/downloads" }),
    );

    expect(plain).not.toContain("<button");
    expect(plain).not.toContain("relative h-full");
    expect(plain.startsWith("<a")).toBe(true);
  });
});
