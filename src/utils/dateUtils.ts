/**
 * Singapore Date and Time Sequence Utilities (DD/MM/YYYY)
 */

export function formatSingaporeDate(dateInput: string | Date | undefined | null): string {
  if (!dateInput) return '';

  let str: string;
  if (typeof dateInput === 'string') {
    str = dateInput.trim();
  } else if (dateInput instanceof Date) {
    if (isNaN(dateInput.getTime())) return '';
    str = dateInput.toISOString();
  } else {
    str = String(dateInput);
  }

  // If already in DD/MM/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
    const parts = str.split('/');
    return `${parts[0].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[2]}`;
  }

  // If YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  }

  // If DD-MM-YYYY
  const dmyMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  }

  // Fallback to JS Date parsing
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  return str;
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
