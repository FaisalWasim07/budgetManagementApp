// Currencies offered in the pickers. Frankfurter (the rate source) covers all
// of these; a code it doesn't know simply shows as unconverted.
export const CURRENCIES = [
  'AED', 'PKR', 'USD', 'EUR', 'GBP', 'INR', 'SAR', 'CAD',
  'AUD', 'CHF', 'JPY', 'CNY', 'TRY', 'PHP', 'BDT', 'LKR',
];

// `compact` means "this is a total": balances, month figures, chart labels.
// Those are read for their size, and trailing cents on a five-figure sum are
// noise. Individual entries are not compact and keep their cents, because
// there the exact amount is the point.
export function formatCurrency(amount, currency = 'AED', { compact = false } = {}) {
  if (amount == null || Number.isNaN(amount)) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      ...(compact ? { maximumFractionDigits: 0 } : {}),
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

// Axis ticks: "30k", "1.2M". Twelve of them across half a screen, so the axis
// has to stay out of the way of the chart it is labelling.
export function formatTick(value) {
  const size = Math.abs(value);
  if (size >= 1e6) return `${(value / 1e6).toFixed(size >= 1e7 ? 0 : 1)}M`;
  if (size >= 1000) return `${(value / 1000).toFixed(size >= 10000 ? 0 : 1)}k`;
  return String(Math.round(value));
}

export function formatNumber(amount) {
  if (amount == null || Number.isNaN(amount)) return '—';
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(amount);
}
