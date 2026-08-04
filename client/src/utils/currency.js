// Currencies offered in the pickers. Frankfurter (the rate source) covers all
// of these; a code it doesn't know simply shows as unconverted.
export const CURRENCIES = [
  'AED', 'PKR', 'USD', 'EUR', 'GBP', 'INR', 'SAR', 'CAD',
  'AUD', 'CHF', 'JPY', 'CNY', 'TRY', 'PHP', 'BDT', 'LKR',
];

export function formatCurrency(amount, currency = 'AED', { compact = false } = {}) {
  if (amount == null || Number.isNaN(amount)) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: compact && Math.abs(amount) >= 1000 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function formatNumber(amount) {
  if (amount == null || Number.isNaN(amount)) return '—';
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(amount);
}
