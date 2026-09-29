/**
 * Siri Orb mesh stops: cyan leading, electric blue and violet underneath.
 *
 * The core colour matters more than it looks. The orb lays a dot pattern of
 * `bg` over the mesh with an overlay blend: a pale core lifts every blue into
 * cyan and a dark one crushes it into navy. A mid-tone azure keeps the stops true.
 */
export const ORB_COLORS = {
  bg: 'oklch(64% 0.08 245)',
  c1: 'oklch(82% 0.12 224)',
  c2: 'oklch(57% 0.22 264)',
  c3: 'oklch(55% 0.22 294)',
  c4: 'oklch(70% 0.16 236)',
} as const;

/** Orb diameters in px: centre stage on wide and narrow screens, and docked above the transcript. */
export const ORB_SIZE = { stage: 232, stageNarrow: 168, docked: 56 } as const;
