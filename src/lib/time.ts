/**
 * Display-time formatters built around one configurable IANA time zone.
 *
 * The runtime supplies UTC instants; these helpers only format them for display.
 * Change the zone in the constants below and see docs/TIMEZONE.md.
 */
export const HONG_KONG_TIME_ZONE = 'Asia/Hong_Kong';
export const HONG_KONG_UTC_OFFSET = '+08:00';

// Rough reading-time estimate for content that mixes Chinese (no spaces
// between words) and English. Each CJK character counts as one reading
// unit; each Latin/number token counts as one unit too, then we divide by
// an approximate combined reading speed of 300 units/minute.
const CJK_RANGE = /[\u3400-\u9fff\uf900-\ufaff]/;
export function estimateReadingMinutes(body: string): number {
  const stripped = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[#>*_~`-]/g, ' ');
  const cjkCount = (stripped.match(new RegExp(CJK_RANGE, 'g')) || []).length;
  const latinWords = (stripped.replace(new RegExp(CJK_RANGE, 'g'), ' ').match(/[A-Za-z0-9']+/g) || []).length;
  const units = cjkCount + latinWords;
  return Math.max(1, Math.round(units / 300));
}

export function formatHKT(value: Date | string | number, options: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat('zh-HK', {
    timeZone: HONG_KONG_TIME_ZONE,
    ...options,
  }).format(new Date(value));
}

export function formatHKTDate(value: Date | string | number) {
  return formatHKT(value, { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function formatHKTDateTime(value: Date | string | number) {
  return formatHKT(value, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatHKTTime(value: Date | string | number) {
  return formatHKT(value, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}
