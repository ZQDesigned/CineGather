/** Accounting days are calendar days in Asia/Shanghai, never host-local dates. */
export function pointsDay(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}
export function awardedAmount(expected: number, earned: number, cap: number) {
  return Math.max(0, Math.min(expected, cap - earned));
}
