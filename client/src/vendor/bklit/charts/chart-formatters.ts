// Bayt's own edit: every chart built from this vendored copy plots one row a
// month, on an arbitrary mid-month day that exists only so the x-axis has a
// real Date to scale against. The upstream formats (day-of-month, weekday)
// answer a question daily data would ask and monthly data does not — a tick
// reading "Aug 15" or a tooltip titled "Sat, Aug 15" implies the 15th
// mattered, when nothing did.
export const shortDateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
});

export const weekdayDateFmt = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});

export const hmsTimeFmt = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

// `Intl.NumberFormat.prototype.format` is a bound getter — safe to extract.
export const intFmt = new Intl.NumberFormat("en-US").format;
