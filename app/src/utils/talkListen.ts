/** The API ratio is user speech divided by other speech, not a percentage. */
export function talkListenPercent(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((ratio / (1 + ratio)) * 100)));
}
