function normalizedWords(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

function containsAnchor(words, anchor) {
  return anchor.length > 0 && anchor.every(term => words.some(word => word === term || word.startsWith(term)));
}

/** Matches by subject meaning only; predicted dimensions are scored separately. */
export function isExpectedIssue(issue, expected) {
  const words = normalizedWords(issue.subject);
  if (expected.rejectAny?.some(term => normalizedWords(term).every(word => words.some(actual => actual.startsWith(word))))) return false;
  const anchors = [...(expected.matchAny || []), ...(expected.aliases || []).map(alias => Array.isArray(alias) ? alias : normalizedWords(alias))];
  return anchors.some(anchor => containsAnchor(words, anchor));
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
