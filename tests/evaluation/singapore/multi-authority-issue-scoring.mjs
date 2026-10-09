function normalizedWords(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

function containsAnchor(words, anchor) {
  return anchor.length > 0 && anchor.every(term => words.some(word => word === term || word.startsWith(term)));
}

function hasCompanyEntityConcept(words) {
  return words.some(word => ['company', 'companies', 'corporate', 'corporation', 'corporations'].includes(word)) ||
    words.some((word, index) => word === 'business' && (words[index + 1] === 'entity' || words[index + 1] === 'entities'));
}

function hasTaxConcept(words) {
  return words.some(word => ['tax', 'taxes', 'taxation'].includes(word));
}

function hasResidenceConcept(words) {
  return words.some(word => ['residence', 'residency', 'resident', 'residents', 'nonresident', 'nonresidents'].includes(word));
}

const GENERIC_RESIDENCY_SUBJECT_WORDS = new Set([
  'a', 'an', 'the', 'this', 'in', 'for', 'of', 'and', 'to', 'on', 'by', 'as', 'with', 'from', 'given',
  'general', 'rule', 'rules', 'treatment', 'status', 'determine', 'determining', 'determination',
  'control', 'management', 'strategic', 'director', 'directors', 'decision', 'decisions', 'current', 'year',
  'singapore', 'income',
  'company', 'companies', 'corporate', 'corporation', 'corporations', 'business', 'entity', 'entities',
  'tax', 'taxes', 'taxation', 'residence', 'residency', 'resident', 'residents', 'nonresident', 'nonresidents',
  'certificate', 'certificates', 'cor', 'treaty', 'treaties', 'dta', 'double', 'agreement', 'exempt', 'exemption', 'exemptions',
  'non', 'not'
]);

function hasNonResidentQualifier(words) {
  const residenceForms = new Set(['residence', 'residency', 'resident', 'residents']);
  if (words.some(word => word.startsWith('nonresident'))) return true;
  return words.some((word, index) => {
    if (word !== 'non' && word !== 'not') return false;
    const following = words.slice(index + 1, index + 4);
    const residenceIndex = following.findIndex(item => residenceForms.has(item));
    if (residenceIndex < 0) return false;
    return residenceIndex <= 2;
  });
}

function materialResidencyQualifiers(words) {
  const containsSequence = (...sequence) => words.some((_word, start) =>
    start + sequence.length <= words.length && sequence.every((expected, offset) => words[start + offset] === expected));
  return {
    certificate: words.some(word => word === 'certificate' || word === 'certificates' || word === 'cor') ||
      containsSequence('certificate', 'of', 'residence'),
    treaty: words.some(word => word === 'treaty' || word === 'treaties' || word === 'dta') ||
      containsSequence('double', 'tax', 'agreement'),
    exemption: words.some(word => word.startsWith('exempt')),
    nonResident: hasNonResidentQualifier(words)
  };
}

/**
 * A bounded generic paraphrase path for the company tax-residence concept.
 * It is selected from the expected subject meaning alone; predicted domain,
 * authority, population, and operation remain independently scored.
 */
function isCompanyTaxResidenceScope(words) {
  return hasCompanyEntityConcept(words) && hasTaxConcept(words) && hasResidenceConcept(words);
}

function isBoundedGenericCompanyTaxResidence(words) {
  return isCompanyTaxResidenceScope(words) && words.every(word => GENERIC_RESIDENCY_SUBJECT_WORDS.has(word));
}

function isCompanyTaxResidenceSubject(expectedWords, actualWords) {
  if (!isBoundedGenericCompanyTaxResidence(expectedWords) || !isBoundedGenericCompanyTaxResidence(actualWords)) return false;

  if (!hasCompanyEntityConcept(actualWords) ||
      !hasTaxConcept(actualWords) || !hasResidenceConcept(actualWords)) return false;

  const expectedQualifiers = materialResidencyQualifiers(expectedWords);
  const actualQualifiers = materialResidencyQualifiers(actualWords);
  return Object.keys(expectedQualifiers).every(key => expectedQualifiers[key] === actualQualifiers[key]);
}

/** Matches by subject meaning only; predicted dimensions are scored separately. */
export function isExpectedIssue(issue, expected) {
  const words = normalizedWords(issue.subject);
  if (expected.rejectAny?.some(term => normalizedWords(term).every(word => words.some(actual => actual.startsWith(word))))) return false;
  const expectedWords = normalizedWords(expected.subject);
  if (isBoundedGenericCompanyTaxResidence(expectedWords)) {
    return isCompanyTaxResidenceSubject(expectedWords, words);
  }
  const anchors = [...(expected.matchAny || []), ...(expected.aliases || []).map(alias => Array.isArray(alias) ? alias : normalizedWords(alias))];
  if (anchors.some(anchor => containsAnchor(words, anchor))) return true;
  return false;
}

/** Maximum one-to-one matching prevents one merged model issue earning two credits. */
export function matchIssues(expectedIssues, actualIssues) {
  const ownerByExpected = new Map();
  const visit = (actualIndex, seen) => {
    for (let expectedIndex = 0; expectedIndex < expectedIssues.length; expectedIndex += 1) {
      if (seen.has(expectedIndex) || !isExpectedIssue(actualIssues[actualIndex], expectedIssues[expectedIndex])) continue;
      seen.add(expectedIndex);
      const previous = ownerByExpected.get(expectedIndex);
      if (previous === undefined || visit(previous, seen)) {
        ownerByExpected.set(expectedIndex, actualIndex);
        return true;
      }
    }
    return false;
  };
  for (let index = 0; index < actualIssues.length; index += 1) visit(index, new Set());
  const expectedByActual = new Map([...ownerByExpected.entries()].map(([expectedIndex, actualIndex]) => [actualIndex, expectedIndex]));
  return { ownerByExpected, expectedByActual };
}

function sameSet(actual, expected) {
  return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length &&
    [...actual].sort().every((item, index) => item === [...expected].sort()[index]);
}

/** Dimension correctness stays visible after a subject match, including wrong-domain matches. */
export function scoreIssueDimensions(actual, expected) {
  return {
    governingAuthority: sameSet(actual.governingAuthorities, expected.governingAuthorities),
    contextualAuthority: expected.contextualAuthoritiesAnyOf.some(candidate => sameSet(actual.contextualAuthorities, candidate)),
    domain: expected.domain.includes(actual.domain),
    population: expected.population.includes(actual.population),
    operation: expected.operation.includes(actual.operation)
  };
}
