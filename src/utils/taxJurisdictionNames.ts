export function normalizeTaxJurisdictionName(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

export const TAX_JURISDICTION_NAMES: ReadonlySet<string> = (() => {
  const names = new Set<string>();
  if (typeof Intl.DisplayNames === 'function') {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (const first of alphabet) {
      for (const second of alphabet) {
        const code = `${first}${second}`;
        const name = displayNames.of(code);
        // Invalid two-letter codes fall back to themselves. Keep only actual
        // region names and compare complete one-to-five-word complements.
        if (name && name.toUpperCase() !== code) names.add(normalizeTaxJurisdictionName(name));
      }
    }
  }
  for (const alias of [
    'US', 'U.S.', 'USA', 'U.S.A.', 'UK', 'U.K.', 'Britain', 'Great Britain',
    'UAE', 'Republic of Korea', 'South Korea', 'North Korea', 'Republic of China',
    'Hong Kong', 'Macao', 'Macau', 'Turkey', 'Czech Republic'
  ]) names.add(normalizeTaxJurisdictionName(alias));
  return names;
})();

function jurisdictionRegexAlternation(name: string): string {
  return name.split(' ').join('[^\\p{L}\\p{N}]+');
}

export const TAX_JURISDICTION_NAME_PATTERN =
  `(?<![\\p{L}\\p{N}])(?:${[...TAX_JURISDICTION_NAMES]
    .sort((left, right) => right.length - left.length)
    .map(jurisdictionRegexAlternation).join('|')})(?![\\p{L}\\p{N}])`;

