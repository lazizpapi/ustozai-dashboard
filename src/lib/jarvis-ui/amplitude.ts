/** Speech rarely reads above ~0.4 from the analyser, so lift it into 0..1. */
export const VOLUME_GAIN = 2.5;
/** Share of the gap closed per frame when getting louder: fast attack. */
export const ATTACK = 0.5;
/** Share of the gap closed per frame when getting quieter: slow release. */
export const RELEASE = 0.08;
/** Below this the level snaps to zero, so an idle orb stops updating. */
const FLOOR = 0.001;

/** An analyser reading as a 0..1 level. Anything that is not a positive number is silence. */
export function scaleVolume(raw: number, gain: number = VOLUME_GAIN): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(1, raw * gain);
}

/** One frame of an envelope follower: snaps up on a peak, eases down afterwards. */
export function smoothLevel(previous: number, target: number): number {
  const rate = target > previous ? ATTACK : RELEASE;
  const next = previous + (target - previous) * rate;
  return next < FLOOR ? 0 : next;
}
