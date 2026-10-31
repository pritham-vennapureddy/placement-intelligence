// Normalisers for values read from spreadsheets.

/** Indian mobile numbers as 10 digits; other lengths are kept as digits. Null when no digits. */
export function normalizeMobile(value: string | null | undefined): string | null {
  if (!value) return null;
  let digits = String(value).replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits.length >= 7 ? digits : null;
}

export function isPlausibleMobile(value: string | null): boolean {
  return value !== null && /^[6-9]\d{9}$/.test(value);
}

export function normalizeEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function cleanText(value: string | null | undefined, max = 500): string | null {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

export function parseNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const match = String(value).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

export function parseYear(value: string | null | undefined): number | null {
  const year = parseNumber(value);
  return year !== null && Number.isInteger(year) && year >= 1980 && year <= 2100 ? year : null;
}

/** Dates as ISO strings. Accepts ISO, dd-mm-yyyy / dd/mm/yyyy, Excel serial numbers and JS date strings. */
export function parseDate(value: string | null | undefined): Date | null {
  const text = value?.trim();
  if (!text) return null;
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial > 20000 && serial < 80000) {
      return new Date(Math.round((serial - 25569) * 86400 * 1000));
    }
  }
  const dmy = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (dmy) {
    const [, d, m, y, hh = "0", mm = "0"] = dmy;
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm)));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  // "Sun Oct 25 2026 13:59:59 GMT+0530 (India Standard Time)" → drop the zone name.
  const parsed = new Date(text.replace(/\s*\([^)]*\)\s*$/, ""));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isUrl(value: string | null | undefined): boolean {
  return Boolean(value && /^https?:\/\/\S+$/i.test(value.trim()));
}

/** Case- and punctuation-insensitive key used to compare header names and sheet values. */
export function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
