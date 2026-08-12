export function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonth(month, delta) {
  const [year, mon] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, mon - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

// 'Aug' — for axis ticks, where the full name and the year never fit twelve
// times across a chart that is half a screen wide.
export function shortMonth(month) {
  const [year, mon] = String(month).split('-').map(Number);
  if (!year || !mon) return String(month);
  const date = new Date(Date.UTC(year, mon - 1, 1));
  return date.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });
}

export function formatMonth(month) {
  const [year, mon] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, mon - 1, 1));
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', timeZone: 'UTC' });
}
