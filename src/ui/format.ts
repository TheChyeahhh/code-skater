/**
 * src/ui/format.ts (ui track): pure text formatting for the HUD and menus (REQ-HUD-01, REQ-HUD-03).
 * No em dashes anywhere (REQ-HUD-06).
 */

/** "46,600" */
export function formatScore(n: number): string {
  return Math.floor(n).toLocaleString('en-US');
}

/** Seconds left -> "2:00", "1:23", "0:09", "0:00". Rounds up so 0:01 shows until the clock really hits 0. */
export function formatClock(clockS: number): string {
  const total = Math.max(0, Math.ceil(clockS - 1e-6));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Multiplier: whole numbers stay whole ("9"), half steps show one decimal ("9.5"). */
export function formatMultiplier(m: number): string {
  const r = Math.round(m * 2) / 2;
  return Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1);
}

/** "1,644 x 9.5" */
export function formatComboTotal(base: number, multiplier: number): string {
  return `${formatScore(base)} x ${formatMultiplier(multiplier)}`;
}

/** "+1,000" */
export function formatBonus(n: number): string {
  return `+${formatScore(n)}`;
}
