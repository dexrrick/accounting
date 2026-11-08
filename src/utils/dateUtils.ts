/**
 * Singapore Date and Time Sequence Utilities (DD/MM/YYYY)
 */

export function isValidCalendarDate(day: number, month: number, year: number): boolean {
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) {
    return false;
  }
  if (year < 1900 || year > 2200) {
    return false;
  }
  if (month < 1 || month > 12) {
    return false;
  }
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  const maxDays = [
    31, // Jan
    isLeapYear ? 29 : 28, // Feb
    31, // Mar
    30, // Apr
    31, // May
    30, // Jun
    31, // Jul
    31, // Aug
    30, // Sep
    31, // Oct
    30, // Nov
    31  // Dec
  ][month - 1];
  return day >= 1 && day <= maxDays;
}

const MONTH_NAME_MAP: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12
};

export function formatSingaporeDate(dateInput: string | Date | undefined | null): string {
  if (!dateInput) return '';

  let str: string;
  if (typeof dateInput === 'string') {
    str = dateInput.trim();
  } else if (dateInput instanceof Date) {
    if (isNaN(dateInput.getTime())) return '';
    str = dateInput.toISOString();
  } else {
    str = String(dateInput).trim();
  }

  if (!str) return '';

  // Reject incomplete period strings like "February 2025", "Jan 2026", "2025", "Q1 2025"
  if (
    /^(?:FY|YA|CY|Q[1-4]|H[12])\b/i.test(str) ||
    /^\d{4}$/.test(str) ||
    /^(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}$/i.test(str) ||
    /^\d{4}[-/](?:0?[1-9]|1[0-2])$/.test(str) ||
    /^(?:0?[1-9]|1[0-2])[-/]\d{4}$/.test(str)
  ) {
    return '';
  }

  // If YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymdMatch) {
    const y = parseInt(ymdMatch[1], 10);
    const m = parseInt(ymdMatch[2], 10);
    const d = parseInt(ymdMatch[3], 10);
    if (!isValidCalendarDate(d, m, y)) return '';
    return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
  }

  // If DD/MM/YYYY or DD-MM-YYYY (or 2-digit year)
  const dmyMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (dmyMatch) {
    const d = parseInt(dmyMatch[1], 10);
    const m = parseInt(dmyMatch[2], 10);
    let y = parseInt(dmyMatch[3], 10);
    if (dmyMatch[3].length === 2) {
      y = 2000 + y;
    }
    if (!isValidCalendarDate(d, m, y)) return '';
    return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
  }

  // Check explicit named day-month-year patterns (preventing JS Date month overflow like 31 Feb -> 3 March)
  const namedMatch1 = str.match(/\b(\d{1,2})\s+([A-Za-z]+)\s+(\d{2,4})\b/i);
  if (namedMatch1) {
    const d = parseInt(namedMatch1[1], 10);
    const m = MONTH_NAME_MAP[namedMatch1[2].toLowerCase()];
    if (m) {
      let y = parseInt(namedMatch1[3], 10);
      if (namedMatch1[3].length === 2) y = 2000 + y;
      if (!isValidCalendarDate(d, m, y)) return '';
      return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
    }
  }

  const namedMatch2 = str.match(/\b([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})\b/i);
  if (namedMatch2) {
    const m = MONTH_NAME_MAP[namedMatch2[1].toLowerCase()];
    if (m) {
      const d = parseInt(namedMatch2[2], 10);
      let y = parseInt(namedMatch2[3], 10);
      if (namedMatch2[3].length === 2) y = 2000 + y;
      if (!isValidCalendarDate(d, m, y)) return '';
      return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
    }
  }

  // If ISO datetime YYYY-MM-DDTHH:mm
  if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str)) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const day = d.getDate();
      const month = d.getMonth() + 1;
      const year = d.getFullYear();
      if (isValidCalendarDate(day, month, year)) {
        return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
      }
    }
  }

  return '';
}

export function getSingaporeTimestamp(): string {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

/**
 * Returns the current wall-clock instant as a Date.
 * The Date object itself is timezone-agnostic; use `getSingaporeDateString`
 * when a calendar date in Asia/Singapore is required.
 */
export function getSingaporeNow(): Date {
  return new Date();
}

/**
 * Formats a Date as an ISO calendar date string (`YYYY-MM-DD`) in the
 * Asia/Singapore timezone. If no date is provided, the current Singapore
 * date is returned.
 */
export function getSingaporeDateString(dateInput?: Date | string): string {
  const date =
    dateInput instanceof Date
      ? dateInput
      : dateInput
      ? new Date(dateInput)
      : new Date();

  if (isNaN(date.getTime())) {
    return '';
  }

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const day = parts.find((p) => p.type === 'day')?.value.padStart(2, '0') || '01';
  const month = parts.find((p) => p.type === 'month')?.value.padStart(2, '0') || '01';
  const year = parts.find((p) => p.type === 'year')?.value || '1970';

  return `${year}-${month}-${day}`;
}
