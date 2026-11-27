/** Shared recognition for the existing foreign-equity fixture and its FX ownership assessment. */
export function isForeignEquityInvestmentQuery(query: string): boolean {
  const q = query.toLowerCase();
  return (q.includes('apple') || q.includes('aapl') || q.includes('tesla') || q.includes('tsla') ||
    q.includes('microsoft') || ((q.includes('fvtpl') || q.includes('fvtoci')) && (q.includes('foreign') || q.includes('usd')))) &&
    !q.includes('own company') && !q.includes('share capital') && !q.includes('unpaid') && !q.includes('director');
}

/** True only for the existing foreign-share fixture when a foreign currency is stated. */
export function isForeignEquityFxScenarioQuery(query: string): boolean {
  return isForeignEquityInvestmentQuery(query) && /\b(?:usd|us\s+dollars?|eur|gbp)\b/i.test(query);
}
