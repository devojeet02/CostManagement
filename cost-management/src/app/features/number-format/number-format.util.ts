// Shared number-formatting helpers.
//
// Used by the `appNumberFormat` directive (editable input cells) AND by the
// data-grid screens' read-only total/label rendering, so every amount on every
// screen displays the same way: thousand separators with up to `maxDecimals`
// (default 2) decimal places — e.g. 1234 → "1,234", 1234.5 → "1,234.5",
// 1234.567 → "1,234.57". Millions work out of the box.

/** Format a number for display with thousand separators and up to `maxDecimals` decimals. */
export function formatAmount(value: number | null | undefined, maxDecimals = 2): string {
  if (value === null || value === undefined) return '';
  const n = typeof value === 'number' ? value : Number(value);
  if (isNaN(n)) return '';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals
  });
}

/**
 * Parse user-typed text (which may contain thousand separators, currency noise,
 * a leading minus for credit notes, and a single decimal point) back to a number.
 * Returns null for empty / partial input so the bound model can stay null.
 */
export function parseAmount(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const cleaned = String(text).replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '-.') return null;
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}
