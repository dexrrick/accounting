import assert from 'node:assert/strict';
import {
  buildGroundedReasoningContext
} from '../../src/services/groundingContextBuilder.ts';
import {
  createRequestCompletenessContext,
  ensureRequestCompletenessContext,
  isCurrentRequestCompletenessContext,
  readRequestCompletenessObservation
} from '../../src/services/requestCompleteness.ts';

function issue(subject, population, domain = 'CPF_PAYROLL', authority = 'CPF', operation = 'EXPLAIN_RULE', overrides = {}) {
  return {
    subject, population, domain, governingAuthorities: [authority], contextualAuthorities: [],
    operation, mappedTopicIds: [], evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 0.96,
    ...overrides
  };
}

function interpretation(issues, { confidence = 0.96, domain, authority, population, operation } = {}) {
  const first = issues[0];
  return {
    schemaVersion: 2,
    jurisdiction: ['Singapore'],
    authorityCandidates: [authority || first.governingAuthorities[0]],
    contextualAuthorities: [],
    domain: domain || first.domain,
    population: population || first.population,
    primarySubject: first.subject,
    concepts: [],
    requestedOperation: operation || first.operation,
    factsExplicitlyProvided: [],
    confidence,
    issues
  };
}

function observation(issues, options) {
  return { mode: 'SEMANTIC_INTERPRETATION', interpretation: interpretation(issues, options) };
}

function evaluate(query, issues, options) {
  return ensureRequestCompletenessContext(query, undefined, observation(issues, options));
}

const employeeAndEmployer = 'How much CPF do the employee and employer contribute?';
const bothContributions = evaluate(employeeAndEmployer, [
  issue('employee CPF contributions', 'EMPLOYEE', 'CPF_PAYROLL', 'CPF', 'CALCULATE'),
  issue('employer CPF contributions', 'EMPLOYER', 'CPF_PAYROLL', 'CPF', 'CALCULATE')
], { operation: 'CALCULATE' });
assert.equal(bothContributions.inventory.state, 'COMPLETE');
assert.equal(bothContributions.evaluation.status, 'COMPLETE');
assert.equal(bothContributions.evaluation.matches.length, 2);
assert.ok(Object.isFrozen(bothContributions) && Object.isFrozen(bothContributions.inventory.outcomes));

const bothContributionAmounts = evaluate(employeeAndEmployer, [
  issue('employee CPF contribution amount', 'EMPLOYEE', 'CPF_PAYROLL', 'CPF', 'CALCULATE'),
  issue('employer CPF contribution amount', 'EMPLOYER', 'CPF_PAYROLL', 'CPF', 'CALCULATE')
], { operation: 'CALCULATE' });
assert.equal(bothContributionAmounts.evaluation.status, 'COMPLETE',
  'The dual-actor amounts production remains compatible with exact employer/employee amount descriptors.');
assert.equal(bothContributionAmounts.evaluation.matches.length, 2);

const omittedEmployer = evaluate(employeeAndEmployer, [
  issue('employee CPF contributions', 'EMPLOYEE', 'CPF_PAYROLL', 'CPF', 'CALCULATE')
], { operation: 'CALCULATE' });
assert.equal(omittedEmployer.evaluation.status, 'INCOMPLETE');
assert.ok(omittedEmployer.evaluation.findings.some(item => item.code === 'MISSING_REQUESTED_OUTCOME'));

const oneEmployerAsk = 'How much CPF must the employer contribute?';
const extraObservedIssue = evaluate(oneEmployerAsk, [
  issue('employer CPF contributions', 'EMPLOYER', 'CPF_PAYROLL', 'CPF', 'CALCULATE'),
  issue('individual tax relief categories', 'INDIVIDUAL', 'IRAS_INCOME_TAX', 'IRAS', 'EXPLAIN_RULE')
], { domain: 'UNKNOWN', authority: 'UNKNOWN', population: 'UNKNOWN', operation: 'OTHER' });
assert.equal(extraObservedIssue.evaluation.status, 'INCOMPLETE');
assert.ok(extraObservedIssue.evaluation.findings.some(item => item.code === 'EXTRA_UNREQUESTED_ISSUE'));

const actorMismatch = evaluate(oneEmployerAsk, [
  issue('employer CPF contributions', 'EMPLOYER', 'CPF_PAYROLL', 'CPF', 'CALCULATE'),
  issue('employee CPF contributions', 'EMPLOYEE', 'CPF_PAYROLL', 'CPF', 'CALCULATE')
], { domain: 'UNKNOWN', authority: 'UNKNOWN', population: 'UNKNOWN', operation: 'OTHER' });
assert.equal(actorMismatch.evaluation.status, 'INCOMPLETE');
assert.ok(actorMismatch.evaluation.findings.some(item => item.code === 'POPULATION_OR_ACTOR_MISMATCH'));

const duplicateIssue = evaluate(oneEmployerAsk, [
  issue('employer CPF contribution amount', 'EMPLOYER', 'CPF_PAYROLL', 'CPF', 'CALCULATE'),
  issue('employer CPF contribution amount', 'EMPLOYER', 'CPF_PAYROLL', 'CPF', 'CALCULATE')
], { operation: 'CALCULATE' });
assert.equal(duplicateIssue.evaluation.status, 'INCOMPLETE');
assert.ok(duplicateIssue.evaluation.findings.some(item => item.code === 'DUPLICATE_ISSUE'));

const obligationAsk = 'Explain employer CPF contribution obligations.';
const omittedFacet = evaluate(obligationAsk, [
  issue('employer CPF contributions', 'EMPLOYER')
]);
assert.equal(omittedFacet.evaluation.status, 'INCOMPLETE');
assert.ok(omittedFacet.evaluation.findings.some(item => item.code === 'MISSING_REQUESTED_FACET' && item.facets.includes('OBLIGATION')));

const extraFacet = evaluate('Explain employer CPF contributions.', [
  issue('employer CPF contribution obligations', 'EMPLOYER')
]);
assert.equal(extraFacet.evaluation.status, 'INCOMPLETE');
assert.ok(extraFacet.evaluation.findings.some(item => item.code === 'EXTRA_OBSERVED_FACET'));

const missingParticipant = evaluate('Can I claim CPF relief for employees?', [
  issue('CPF relief', 'INDIVIDUAL', 'IRAS_INCOME_TAX', 'IRAS', 'CHECK_ELIGIBILITY')
], { domain: 'IRAS_INCOME_TAX', authority: 'IRAS', operation: 'CHECK_ELIGIBILITY' });
assert.equal(missingParticipant.evaluation.status, 'INCOMPLETE');
assert.ok(missingParticipant.evaluation.findings.some(item => item.code === 'MISSING_REQUESTED_PARTICIPANT'));

const unknownDescriptor = evaluate('Explain a widget registry requirement.', [
  issue('widget registry requirement', 'COMPANY', 'UNKNOWN', 'UNKNOWN')
], { domain: 'UNKNOWN', authority: 'UNKNOWN' });
assert.equal(unknownDescriptor.evaluation.status, 'UNCERTAIN');
assert.ok(unknownDescriptor.evaluation.findings.some(item => item.code === 'UNKNOWN_SUBJECT_DESCRIPTOR'));

const unknownCpfDescriptor = evaluate('Can I claim personal tax relief on my compulsory CPF contributions?', [
  issue('unrecognized compulsory CPF tax allowance', 'INDIVIDUAL', 'IRAS_INCOME_TAX', 'IRAS', 'CHECK_ELIGIBILITY')
], { domain: 'IRAS_INCOME_TAX', authority: 'IRAS', population: 'INDIVIDUAL', operation: 'CHECK_ELIGIBILITY' });
assert.equal(unknownCpfDescriptor.evaluation.status, 'UNCERTAIN');
assert.ok(unknownCpfDescriptor.evaluation.findings.some(item => item.code === 'UNKNOWN_SUBJECT_DESCRIPTOR'),
  'an unrecognized CPF subject is kept unresolved despite an independently recognized raw request');

const ambiguousClaim = 'For someone earning SGD 6,000 a month, What can they claim for personal tax relief for compulsory CPF contributions?';
const ambiguousContext = evaluate(ambiguousClaim, [
  issue('personal tax relief for compulsory CPF contributions', 'INDIVIDUAL', 'IRAS_INCOME_TAX', 'IRAS', 'CALCULATE')
], { domain: 'IRAS_INCOME_TAX', authority: 'IRAS', population: 'INDIVIDUAL', operation: 'CALCULATE' });
assert.equal(ambiguousContext.inventory.facts[0].amountText, '6,000');
assert.ok(ambiguousContext.inventory.findings.some(item => item.code === 'AMBIGUOUS_CLAIMABILITY_OR_AMOUNT'));
assert.equal(ambiguousContext.evaluation.status, 'UNCERTAIN');
assert.ok(ambiguousContext.evaluation.findings.some(item => item.code === 'AMBIGUOUS_REQUEST_OPERATION'));

const employeeClaimabilityQuery = 'For someone earning SGD 6,000 a month, what can they claim for personal tax relief on compulsory CPF, and what does the employer have to pay into CPF?';
const employeeClaimability = evaluate(employeeClaimabilityQuery, [
  issue('employee personal tax relief eligibility for compulsory CPF', 'EMPLOYEE', 'IRAS_INCOME_TAX', 'IRAS', 'CHECK_ELIGIBILITY'),
  issue('employer compulsory CPF contribution amount', 'EMPLOYER', 'CPF_PAYROLL', 'CPF', 'CALCULATE')
], { domain: 'UNKNOWN', authority: 'UNKNOWN', population: 'UNKNOWN', operation: 'OTHER' });
assert.equal(employeeClaimability.inventory.state, 'UNCERTAIN',
  'The bounded population proof does not resolve the raw claimability-versus-amount ambiguity.');
assert.equal(employeeClaimability.evaluation.status, 'UNCERTAIN');
assert.ok(employeeClaimability.evaluation.findings.some(item => item.code === 'AMBIGUOUS_REQUEST_OPERATION'),
  'The diagnostic candidate check uses the same contextual population proof but preserves ambiguous operation status.');

const salaryAsk = 'For someone earning SGD 6,000 a month, How much CPF must the employer contribute?';
const salaryCorrect = evaluate(salaryAsk, [
  issue('employer CPF contribution amount', 'EMPLOYER', 'CPF_PAYROLL', 'CPF', 'CALCULATE')
], { operation: 'CALCULATE' });
assert.equal(salaryCorrect.evaluation.status, 'COMPLETE');
assert.equal(salaryCorrect.declaredFacts[0].amountText, '6,000');
const wrongEmployerOperation = evaluate(salaryAsk, [
  issue('employer CPF contributions', 'EMPLOYER', 'CPF_PAYROLL', 'CPF', 'EXPLAIN_RULE')
]);
assert.equal(wrongEmployerOperation.evaluation.status, 'INCOMPLETE');
assert.ok(wrongEmployerOperation.evaluation.findings.some(item => item.code === 'OPERATION_MISMATCH' && item.expected.includes('CALCULATE')));

const lowConfidence = evaluate(oneEmployerAsk, [
  issue('employer CPF contributions', 'EMPLOYER', 'CPF_PAYROLL', 'CPF', 'CALCULATE')
], { confidence: 0.71, operation: 'CALCULATE' });
assert.equal(lowConfidence.evaluation.confidenceAcceptance, 'REJECTED');
assert.equal(lowConfidence.evaluation.status, 'UNCERTAIN');

const validCachedObservation = observation([
  issue('employer CPF contribution amount', 'EMPLOYER', 'CPF_PAYROLL', 'CPF', 'CALCULATE')
], { operation: 'CALCULATE' });
const cachedContext = evaluate(oneEmployerAsk, validCachedObservation.interpretation.issues, { operation: 'CALCULATE' });
assert.equal(isCurrentRequestCompletenessContext(cachedContext, oneEmployerAsk), true,
  'the normalized V2 snapshot survives strict validator rechecking');
const readBack = readRequestCompletenessObservation(cachedContext, oneEmployerAsk);
assert.equal(readBack.mode, 'SEMANTIC_INTERPRETATION');
assert.equal(readBack.interpretation.issues[0].subject, 'employer CPF contribution amount');
assert.equal(Object.hasOwn(readBack.interpretation, 'calculationRequested'), false,
  'derived validator convenience fields are not persisted into the reusable V2 wire view');
const bareContext = ensureRequestCompletenessContext(oneEmployerAsk, undefined, validCachedObservation.interpretation);
assert.equal(bareContext.evaluation.status, 'COMPLETE');
assert.equal(readRequestCompletenessObservation(bareContext, oneEmployerAsk).mode, 'SEMANTIC_INTERPRETATION',
  'bare accepted interpretations are wrapped before semantic routing consumes them');

const malformedSchema = { ...validCachedObservation, interpretation: { ...validCachedObservation.interpretation, schemaVersion: 99 } };
const rejectedSchema = ensureRequestCompletenessContext(oneEmployerAsk, undefined, malformedSchema);
assert.equal(rejectedSchema.evaluation.structuralAcceptance, 'REJECTED');
const protoKeyInterpretation = JSON.parse(JSON.stringify(validCachedObservation.interpretation));
Object.defineProperty(protoKeyInterpretation, '__proto__', { value: 'invalid-extra-key', enumerable: true, configurable: true });
const rejectedProtoKey = ensureRequestCompletenessContext(oneEmployerAsk, undefined, {
  mode: 'SEMANTIC_INTERPRETATION', interpretation: protoKeyInterpretation
});
assert.equal(rejectedProtoKey.evaluation.structuralAcceptance, 'REJECTED',
  'an own __proto__ key remains visible to strict schema validation');
assert.equal(Object.getPrototypeOf(rejectedProtoKey.observationSnapshot), Object.prototype,
  'snapshot copies retain an ordinary data-object prototype');
const failedWrapper = { ...validCachedObservation, failure: 'NO_PROVIDER' };
const rejectedWrapper = ensureRequestCompletenessContext(oneEmployerAsk, undefined, failedWrapper);
assert.ok(rejectedWrapper.evaluation.findings.some(item => item.code === 'OBSERVATION_WRAPPER_FAILED'));

const providerBodyMarker = 'raw-provider-body-must-not-be-retained';
const invalidProviderBody = ensureRequestCompletenessContext(oneEmployerAsk, undefined, {
  mode: 'SEMANTIC_INTERPRETATION',
  interpretation: { ...validCachedObservation.interpretation, providerDebug: providerBodyMarker }
});
assert.equal(JSON.stringify(invalidProviderBody).includes(providerBodyMarker), false);

const unicodeQuery = 'Explain CPF relief for employees.\u00a0🌱';
const unicodeContext = createRequestCompletenessContext(unicodeQuery);
assert.equal(unicodeContext.identity, JSON.stringify([1, unicodeQuery]));
assert.equal(unicodeContext.inputLength, unicodeQuery.length);
assert.equal(isCurrentRequestCompletenessContext(unicodeContext, `${unicodeQuery} `), false,
  'identity is exact across whitespace and Unicode code units');
const rejectedStale = ensureRequestCompletenessContext(`${unicodeQuery} `, unicodeContext);
assert.ok(rejectedStale.evaluation.findings.some(item => item.code === 'CONTEXT_REJECTED_OR_STALE'));
assert.equal(isCurrentRequestCompletenessContext({ ...unicodeContext }, unicodeQuery), false,
  'caller-built copies do not inherit the private authenticity marker');

const mutableObservation = observation([
  issue('employer CPF contributions', 'EMPLOYER', 'CPF_PAYROLL', 'CPF', 'CALCULATE')
], { operation: 'CALCULATE' });
const ownedContext = ensureRequestCompletenessContext(oneEmployerAsk, undefined, mutableObservation);
mutableObservation.interpretation.issues[0].subject = 'changed after snapshot';
assert.equal(ownedContext.observationSnapshot.normalizedInterpretation.issues[0].subject, 'employer CPF contributions');
const cyclicObservation = { mode: 'SEMANTIC_INTERPRETATION', interpretation: {} };
cyclicObservation.interpretation.self = cyclicObservation;
const rejectedCycle = ensureRequestCompletenessContext(oneEmployerAsk, undefined, cyclicObservation);
assert.equal(rejectedCycle.evaluation.structuralAcceptance, 'REJECTED');

const noNetworkRegistry = {
  retrieveSources: async () => [],
  findSourcesByStandardOrAct: () => [],
  getSourceById: () => undefined
};
const noDiscovery = {
  discoveryAdapter: { discoverOfficialSourceCandidates: async () => [] },
  officialDomainSearchAdapter: { searchOfficialDomainCandidates: async () => [], getLastSearchTrace: () => [] }
};
const mixedCpfAndIrasQuery = 'Explain employer CPF contributions and Explain personal tax relief for compulsory CPF contributions.';
const mixedRequestContext = ensureRequestCompletenessContext(mixedCpfAndIrasQuery, undefined, observation([
  issue('employer CPF contributions', 'EMPLOYER', 'CPF_PAYROLL', 'CPF', 'EXPLAIN_RULE'),
  issue('personal tax relief for compulsory CPF contributions', 'INDIVIDUAL', 'IRAS_INCOME_TAX', 'IRAS', 'EXPLAIN_RULE')
], { domain: 'UNKNOWN', authority: 'UNKNOWN', population: 'UNKNOWN', operation: 'OTHER' }));
assert.equal(mixedRequestContext.evaluation.status, 'COMPLETE');
const scopedGrounding = await buildGroundedReasoningContext(mixedCpfAndIrasQuery, null, noNetworkRegistry, undefined, {
  localOnly: true,
  ...noDiscovery,
  requestCompletenessContext: mixedRequestContext,
  evidenceScope: {
    authority: 'IRAS', domain: 'IRAS_INDIVIDUAL_TAX', topicIds: [], requestedConcepts: [],
    context: {
      domainId: 'IRAS_INDIVIDUAL_TAX', population: 'INDIVIDUAL',
      primarySubject: 'personal tax relief for compulsory CPF contributions',
      concepts: ['personal tax relief for compulsory CPF contributions'], requestedOperation: 'EXPLAIN_RULE'
    }
  }
});
assert.equal(scopedGrounding.requestCompletenessContext.inventory.outcomes.length, 2,
  'per-issue retrieval scoping cannot narrow the original raw-request inventory');
assert.equal(scopedGrounding.requestCompletenessContext.evaluation.status, 'COMPLETE');
let semanticCallCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname === 'generativelanguage.googleapis.com') {
    const payload = JSON.parse(init?.body || '{}');
    const prompt = payload.contents?.flatMap(item => item.parts || []).map(part => part.text || '').join('\n') || '';
    if (prompt.includes('Return a V2 JSON object')) {
      semanticCallCount++;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(validCachedObservation.interpretation) }] } }] }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    }
    throw new Error('Non-interpretation model calls are outside the semantic-call count.');
  }
  throw new Error(`Offline diagnostics regression blocked ${url.hostname}`);
};
try {
  const directDefault = await buildGroundedReasoningContext(oneEmployerAsk, null, noNetworkRegistry, 'diagnostic-test-key', {
    localOnly: true, ...noDiscovery
  });
  assert.equal(semanticCallCount, 1, 'default direct grounding performs one semantic interpretation');
  assert.equal(directDefault.requestCompletenessContext.evaluation.status, 'COMPLETE');

  semanticCallCount = 0;
  const suppliedObservation = await buildGroundedReasoningContext(oneEmployerAsk, null, noNetworkRegistry, undefined, {
    localOnly: true, ...noDiscovery, questionUnderstanding: validCachedObservation
  });
  assert.equal(semanticCallCount, 0, 'a supplied interpretation adds no semantic call');
  assert.equal(suppliedObservation.requestCompletenessContext.evaluation.status, 'COMPLETE');

  semanticCallCount = 0;
  const suppliedContext = await buildGroundedReasoningContext(oneEmployerAsk, null, noNetworkRegistry, undefined, {
    localOnly: true, ...noDiscovery, requestCompletenessContext: cachedContext
  });
  assert.equal(semanticCallCount, 0, 'a supplied context with its validated snapshot adds no semantic call');
  assert.equal(suppliedContext.requestCompletenessContext.evaluation.status, 'COMPLETE');

  semanticCallCount = 0;
  const suppliedBareContext = await buildGroundedReasoningContext(oneEmployerAsk, null, noNetworkRegistry, undefined, {
    localOnly: true, ...noDiscovery, requestCompletenessContext: bareContext
  });
  assert.equal(semanticCallCount, 0, 'a context containing a bare V2 observation adds no semantic call');
  assert.equal(suppliedBareContext.requestCompletenessContext, bareContext,
    'grounding preserves the same independently validated exact-query context');
  assert.equal(suppliedBareContext.requestCompletenessContext.evaluation.status, 'COMPLETE');
  assert.equal(suppliedBareContext.questionUnderstanding.interpretation.issues[0].subject, 'employer CPF contribution amount',
    'bare cached V2 issues remain available to semantic classification');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Request completeness diagnostic regressions passed.');
