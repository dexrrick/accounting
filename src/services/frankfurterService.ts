export interface FxRateResult {
  rate: number;
  date: string;
  from: string;
  to: string;
  source: string; // e.g. "Frankfurter API (European Central Bank)"
  sourceAuthority?: 'REFERENCE_API';
  sourceClass?: 'REFERENCE_DATA';
}

const cache: Record<string, FxRateResult> = {};

/**
 * Fetches real foreign exchange spot rates from Frankfurter API (powered by ECB).
 * Free, public, no API key required.
 */
export async function getExchangeRate(
  fromCurrency: string,
  toCurrency: string,
  date?: string,
  signal?: AbortSignal
): Promise<FxRateResult> {
  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();

  signal?.throwIfAborted();
  const isValidIsoDate = (value: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const dateValue = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(dateValue.getTime()) && dateValue.toISOString().slice(0, 10) === value;
  };
  if (!date || !isValidIsoDate(date)) {
    throw new Error('[INVALID_FX_DATE] A valid transaction date is required for the exchange-rate record.');
  }

  if (from === to) {
    return {
      rate: 1.0,
      date,
      from,
      to,
      source: 'Identical Currencies'
    };
  }

  const queryDate = date;
  if (queryDate > new Date().toISOString().slice(0, 10)) {
    throw new Error(`[FX_RATE_UNAVAILABLE] No historical exchange rate is available for future date ${queryDate}.`);
  }

  const cacheKey = `${from}_${to}_${queryDate}`;
  if (cache[cacheKey]) {
    return cache[cacheKey];
  }

  const url = `https://api.frankfurter.dev/v1/${queryDate}?base=${from}&symbols=${to}`;
  const res = await fetch(url, { signal });
  signal?.throwIfAborted();
  if (!res.ok) {
    throw new Error(`Frankfurter API HTTP ${res.status}`);
  }

  const data: unknown = await res.json();
  signal?.throwIfAborted();
  if (!data || typeof data !== 'object') {
    throw new Error('Frankfurter API returned an invalid response.');
  }
  const observation = data as { date?: unknown; base?: unknown; rates?: Record<string, unknown> };
  const rate = observation.rates?.[to];
  const observationDate = observation.date;
  const requestedDate = queryDate;
  const isValidObservationDate = typeof observationDate === 'string' && isValidIsoDate(observationDate);

  if (observation.base !== from || !isValidObservationDate || observationDate !== requestedDate ||
      typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Frankfurter API did not return a verified ${from}/${to} rate for ${requestedDate}.`);
  }

  const result: FxRateResult = {
    rate,
    date: observationDate as string,
    from,
    to,
    source: `Frankfurter API (European Central Bank Reference, ${observationDate})`,
    sourceAuthority: 'REFERENCE_API',
    sourceClass: 'REFERENCE_DATA'
  };
  cache[cacheKey] = result;
  return result;
}
