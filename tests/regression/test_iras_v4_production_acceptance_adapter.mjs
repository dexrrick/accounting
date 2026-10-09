import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import { readV4Contract } from '../evaluation/singapore/iras-first-targeted-acceptance-v4.mjs';
import { bindProductionControlledRetriever } from '../../scripts/iras_v4_capture_replay_runner.mjs';
import { runV4AcceptanceCase } from '../../scripts/iras_v4_production_acceptance_adapter.mjs';

const contract = await readV4Contract();
const privateCase = contract.cases.find(row => row.caseId === 'private-expense-treatment');
const unsupportedCase = contract.cases.find(row => row.caseId === 'unsupported-sfrsi-6-exploration-evaluation');
assert.ok(privateCase && unsupportedCase, 'The isolated adapter controls use fixed V4 contract rows.');

const PRIVATE_URL = 'https://www.iras.gov.sg/taxes/corporate-income-tax/income-deductions-for-companies/business-expenses';
const SITEMAP_URL = 'https://www.iras.gov.sg/sitemap';
const ROBOTS_URL = 'https://www.iras.gov.sg/robots.txt';
const SYNTHETIC_PRIVATE_HTML = '<html><head><title>Business Expenses | IRAS</title></head><body>' +
  '<!-- SYNTHETIC API-FREE FIXTURE; this is not current IRAS content. -->' +
  '<main><h1>Business Expenses</h1><p>For income tax, companies may deduct expenses wholly and exclusively incurred in producing income under the general deduction rule in section 14. This explains whether a company expense is tax deductible and whether it is deductible for tax purposes. Private and domestic expenses are not deductible under section 15, subject to the statutory exceptions and qualifications. This guidance explains the treatment of business expenses for corporate income tax.</p></main></body></html>';
const SYNTHETIC_SITEMAP_XML = '<?xml version="1.0"?><urlset><url>' +
  '<loc>https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-reliefs-rebates-and-deductions/tax-reliefs/cpf-relief-employees</loc>' +
  '<lastmod>2026-10-04</lastmod></url></urlset>';
const SYNTHETIC_RESPONSE_BYTES = Buffer.byteLength(SYNTHETIC_PRIVATE_HTML, 'utf8');
const SYNTHETIC_RESPONSE_SHA256 = createHash('sha256').update(SYNTHETIC_PRIVATE_HTML).digest('hex');

function makeSemanticWire({ subject, domain, population, authority, operation, concepts, facts = [] }) {
  return {
    schemaVersion: 2,
    jurisdiction: ['Singapore'],
    authorityCandidates: [authority],
    contextualAuthorities: [],
    domain,
    population,
    primarySubject: subject,
    concepts,
    requestedOperation: operation,
    factsExplicitlyProvided: facts,
    confidence: 0.96,
    issues: [{
      subject,
      population,
      domain,
      governingAuthorities: [authority],
      contextualAuthorities: [],
      operation,
      mappedTopicIds: [],
      evidenceRequirement: operation === 'EXPLAIN_RULE' ? 'AUTHORITATIVE_SOURCE' : 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS',
      confidence: 0.96
    }]
  };
}

const privateSubject = 'company private holiday travel expense corporate income tax treatment';
const privateSemanticWire = makeSemanticWire({
  subject: privateSubject,
  domain: 'IRAS_INCOME_TAX',
  population: 'COMPANY',
  authority: 'IRAS',
  operation: 'DETERMINE_TREATMENT',
  concepts: [
    { concept: 'company expense tax deductibility', role: 'PRIMARY' },
    { concept: 'private and domestic expenses', role: 'RELATED' }
  ],
  facts: ['SGD 900', 'director private holiday', 'travel expense']
});
const unsupportedSubject = 'general SFRS(I) 6 rules for mineral exploration and evaluation expenditure';
const unsupportedSemanticWire = makeSemanticWire({
  subject: unsupportedSubject,
  domain: 'ACCOUNTING',
  population: 'COMPANY',
  authority: 'ACCOUNTING_STANDARDS',
  operation: 'EXPLAIN_RULE',
  concepts: [{ concept: 'mineral exploration and evaluation expenditure', role: 'PRIMARY' }]
});

function makeFixtureTransport() {
  const fixtureResponses = new Map([
    [PRIVATE_URL, [SYNTHETIC_PRIVATE_HTML, 'text/html']],
    [SITEMAP_URL, [SYNTHETIC_SITEMAP_XML, 'application/xml']],
    [ROBOTS_URL, ['User-agent: *\nDisallow:', 'text/plain']]
  ]);
  return async url => {
    const response = fixtureResponses.get(String(url));
    return new Response(response?.[0] || 'SYNTHETIC_API_FREE_FIXTURE_MISSING', {
      status: response ? 200 : 404,
      headers: { 'content-type': response?.[1] || 'text/plain' }
    });
  };
}

function makeRetriever(evidenceTransport = makeFixtureTransport()) {
  return bindProductionControlledRetriever({
    transport: { fetch: evidenceTransport },
    cache: new SourceCache()
  });
}

function makeSemanticSender(wire, record = {}) {
  return async request => {
    record.count = (record.count || 0) + 1;
    record.lastRequest = request;
    return JSON.stringify(wire);
  };
}

async function runCase({ caseId, wire, referenceDate, evidenceTransport, sendSemantic, webRetriever } = {}) {
  return runV4AcceptanceCase({
    caseId,
    referenceDate,
    sendSemantic: sendSemantic || makeSemanticSender(wire),
    evidenceTransport,
    withEvidenceFamily: async (_family, callback) => callback(),
    webRetriever: webRetriever || makeRetriever(evidenceTransport || makeFixtureTransport())
  });
}

// Exercise the real V2 interpreter, query/topic resolution, local-only runtime,
// governed runtime, ControlledWebRetriever validation, admission and claim verifier.
{
  const sender = {};
  const evidenceTransport = makeFixtureTransport();
  const guardedRetriever = makeRetriever(evidenceTransport);
  const guardedMethod = guardedRetriever.fetchOfficialSource;
  assert.equal(Object.isFrozen(guardedRetriever), true, 'The runner-controlled retriever is frozen before adapter observation.');
  const result = await runCase({
    caseId: privateCase.caseId,
    wire: privateSemanticWire,
    referenceDate: '2026-10-04',
    evidenceTransport,
    webRetriever: guardedRetriever,
    sendSemantic: makeSemanticSender(privateSemanticWire, sender)
  });
  assert.equal(Object.isFrozen(guardedRetriever), true, 'The adapter preserves the guarded retriever freeze.');
  assert.strictEqual(guardedRetriever.fetchOfficialSource, guardedMethod,
    'Observation does not replace or restore the original guarded method.');
  assert.equal(sender.count, 1, 'Exactly one semantic request is sent for this fixed case.');
  assert.deepEqual(sender.lastRequest.provider, {
    activeProvider: 'gemini', gemini: { model: 'gemini-3.5-flash-lite' }
  }, 'The semantic bridge sends the approved model-only provider object; no key enters the callback.');
  assert.equal(sender.lastRequest.options.jsonMode, true);
  assert.equal(sender.lastRequest.options.timeoutMs, 8_000);
  assert.equal(Object.values(result.stageVerdicts).every(Boolean), true,
    `The actual private-expense path passes its independent production stages: ${JSON.stringify(result.stageVerdicts)}`);
  assert.equal(result.layerVerdicts.governed.stages.GOVERNED_RETRIEVAL, true);
  assert.equal(result.layerVerdicts.governed.stages.EVIDENCE_ADMISSION, true);
  assert.equal(result.layerVerdicts.governed.stages.CLAIM_VERIFICATION, true);
  assert.equal(result.layerVerdicts.governed.stages.REQUESTED_CONCEPT_COVERAGE, true);

  const governed = result.productionDiagnostics.governed;
  const observation = governed.governedIssueObservations[0];
  const fetch = governed.fetchValidationObservations.find(row => row.url === PRIVATE_URL && row.status === 'SUCCESS');
  assert.ok(fetch, 'The fixed mapped IRAS page was reached through the production retriever.');
  assert.equal(fetch.sourceUrl, PRIVATE_URL);
  assert.equal(fetch.finalUrl, PRIVATE_URL);
  assert.equal(fetch.pageTitle, 'Business Expenses | IRAS');
  assert.equal(fetch.topicValidationPresent, true);
  assert.equal(fetch.topicMatched && fetch.titleMatched && fetch.contentMatched, true);
  assert.equal(fetch.rawContentBytes, SYNTHETIC_RESPONSE_BYTES);
  assert.equal(fetch.rawContentSha256, SYNTHETIC_RESPONSE_SHA256);
  assert.equal(fetch.contentHash, SYNTHETIC_RESPONSE_SHA256);
  assert.equal(fetch.contentHashBoundToObservedBytes, true);
  assert.equal(observation.transportBinding.complete, true);
  assert.deepEqual(observation.transportBinding.liveSourceIds, observation.transportBinding.boundSourceIds);
  assert.equal(observation.transportBinding.liveSourceIds.length, 1);
  assert.equal(observation.transportBinding.observedAttempts[0].associationBasis,
    'sanitized_production_attempt_plus_unique_observed_validated_fetch');
  const boundRecord = observation.recordDiagnostics.find(record =>
    record.recordId === observation.transportBinding.boundSourceIds[0]);
  assert.ok(boundRecord, 'The returned LIVE_EXTERNAL source has a bounded diagnostic projection.');
  assert.equal(boundRecord.provenance, 'LIVE_EXTERNAL');
  assert.equal(boundRecord.contentHash, SYNTHETIC_RESPONSE_SHA256);
  assert.equal(boundRecord.documentHash, SYNTHETIC_RESPONSE_SHA256);
  assert.equal(boundRecord.documentTitle, fetch.pageTitle);
  assert.equal(boundRecord.officialSourceUrl, fetch.finalUrl);
  assert.equal(boundRecord.canonicalSourceUrl, fetch.finalUrl);
  assert.ok(observation.verifiedClaims.some(claim => claim.recordId === boundRecord.recordId &&
    /statutory exceptions and qualifications/i.test(claim.quote)),
  'The production verifier returns an actual quote preserving the private-expense qualification.');
  assert.equal(observation.candidateInventoryKind,
    'observed_through_call_records_plus_actual_returned_sources');
  assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') < 1_500_000);
  assert.equal(JSON.stringify(result).includes('SYNTHETIC API-FREE FIXTURE'), false,
    'Raw synthetic HTML is omitted from the bounded result; the actual verified quote remains.');
}

// Malformed output remains visible as a failed semantic layer and does not abort the case loop.
{
  let sendCount = 0;
  const result = await runCase({
    caseId: privateCase.caseId,
    referenceDate: undefined,
    sendSemantic: async () => { sendCount += 1; return '{malformed-json'; }
  });
  assert.equal(sendCount, 1);
  assert.equal(result.semanticUnderstanding.sendCount, 1);
  assert.equal(result.semanticUnderstanding.response.parsed, false);
  assert.equal(result.semanticUnderstanding.failure, 'INVALID_RESPONSE');
  assert.equal(result.layerVerdicts.semantic.stages.SEMANTIC_VALIDATION, false);
  assert.equal(result.firstFailure, 'SEMANTIC_VALIDATION');
  assert.doesNotThrow(() => JSON.stringify(result));
}

// The unsupported topic is scored from its actual reconciled plan and completed governed runtime.
{
  const result = await runCase({
    caseId: unsupportedCase.caseId,
    wire: unsupportedSemanticWire,
    referenceDate: '2026-10-04',
    evidenceTransport: makeFixtureTransport()
  });
  assert.equal(Object.values(result.stageVerdicts).every(Boolean), true,
    `Actual unsupported no-coverage control should pass its defined negative expectations: ${JSON.stringify(result.stageVerdicts)}`);
  assert.equal(result.issuePlan.issues.some(issue => issue.unresolvedReason === 'NO_COVERAGE_TOPIC'), true);
  assert.equal(result.layerVerdicts.governed.expectedNoCoverageTopic, true);
  assert.equal(result.layerVerdicts.governed.expectedNoClaims, true);
  assert.equal(result.productionDiagnostics.governed.available, true,
    'A completed production runtime is required to accept the unsupported/no-coverage control.');
  assert.equal(result.productionDiagnostics.governed.governedIssueObservations[0].source,
    'actual_issue_plan_and_governed_runtime');
  assert.equal(result.productionDiagnostics.governed.governedIssueObservations[0].coverageStatus,
    'NO_COVERAGE_TOPIC');
  assert.equal(result.productionDiagnostics.governed.governedIssueObservations[0].claimCount, 0);
}

// Missing either the source reference date or controlled evidence transport must fail closed.
for (const missingInput of ['reference-date', 'evidence-transport']) {
  const result = await runCase({
    caseId: unsupportedCase.caseId,
    wire: unsupportedSemanticWire,
    referenceDate: missingInput === 'reference-date' ? undefined : '2026-10-04',
    evidenceTransport: missingInput === 'evidence-transport' ? undefined : makeFixtureTransport()
  });
  assert.equal(result.layerVerdicts.governed.stages.GOVERNED_RETRIEVAL, false, missingInput);
  assert.equal(result.layerVerdicts.governed.stages.EVIDENCE_ADMISSION, false, missingInput);
  assert.equal(result.layerVerdicts.governed.stages.CLAIM_VERIFICATION, false, missingInput);
  assert.equal(result.layerVerdicts.governed.stages.REQUESTED_CONCEPT_COVERAGE, false, missingInput);
  assert.equal(result.layerVerdicts.governed.expectedNoCoverageTopic, false, missingInput);
  assert.equal(result.layerVerdicts.governed.observationFailure,
    missingInput === 'reference-date' ? 'REFERENCE_DATE_MISSING_OR_INVALID' : 'CONTROLLED_EVIDENCE_TRANSPORT_MISSING');
}

console.log('IRAS V4 production acceptance adapter regression passed (private evidence binding, malformed output, actual no-coverage, missing-input fail-closed controls).');
