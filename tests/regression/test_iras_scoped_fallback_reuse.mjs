import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import { defaultAdvancedSourceRetriever } from '../../src/retrieval/advancedSourceRetriever.ts';
import { evaluateEvidenceQuality } from '../../src/retrieval/evidenceQualityGate.ts';
import { resolveMappedOfficialSourceFallback } from '../../src/services/groundingContextBuilder.ts';
import {
  getRequestedQuestionConcepts,
  validateSemanticQuestionInterpretation,
  reconcileQuestionUnderstanding
} from '../../src/services/semanticQuestionUnderstanding.ts';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import { getCoverageTopicById } from '../../src/standards/coverageRegistry.ts';
import { readV4Contract } from '../evaluation/singapore/iras-first-targeted-acceptance-v4.mjs';

const acceptanceRoot = 'artifacts/iras-v4-acceptance-repaired-2026-10-06/';
const capturePath = `${acceptanceRoot}post-repair-2026-10-08/official-capture/capture-payload.json`;
const runnerPath = `${acceptanceRoot}semantic-run-v4-post-repair-2026-10-08/runner-v4.partial.jsonl`;
const capture = JSON.parse(await readFile(capturePath, 'utf8'));
const runnerRows = (await readFile(runnerPath, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
const retainedResponse = runnerRows.find(row => row.caseId === 'A-paraphrase-2' && row.semanticResponseBase64);
assert.ok(retainedResponse, 'The retained A-paraphrase-2 semantic response is available.');
const question = (await readV4Contract()).cases.find(row => row.caseId === 'A-paraphrase-2')?.question;
assert.ok(question, 'The retained CPF case question is available.');
const responseBytes = Buffer.from(retainedResponse.semanticResponseBase64, 'base64');
assert.equal(createHash('sha256').update(responseBytes).digest('hex'), retainedResponse.semanticResponseSha256,
  'The retained semantic response bytes match their recorded SHA-256.');
const understanding = {
  mode: 'SEMANTIC_INTERPRETATION',
  interpretation: validateSemanticQuestionInterpretation(JSON.parse(responseBytes.toString('utf8')), question)
};
const issuePlan = reconcileQuestionUnderstanding(question, classifyQuestion(question), understanding).issuePlan;
const irasIssue = issuePlan.issues.find(issue => issue.governingAuthorities.includes('IRAS'));
assert.ok(irasIssue, 'The retained interpretation contains its IRAS relief issue.');
const cpfUrl = capture.entries.find(entry => entry.request.family === 'relief' && entry.request.url.includes('central-provident-fund(cpf)'))?.request.url;
assert.ok(cpfUrl, 'The retained capture includes the mapped CPF relief page.');
const requestedConcepts = getRequestedQuestionConcepts(question, understanding)
  .filter(concept => concept.topicIds.length === 0 || concept.topicIds.some(id => irasIssue.mappedTopicIds.includes(id)));
const evidenceScope = {
  authority: 'IRAS',
  domain: 'IRAS_INDIVIDUAL_TAX',
  topicIds: irasIssue.mappedTopicIds,
  requestedConcepts,
  context: {
    domainId: 'IRAS_INDIVIDUAL_TAX',
    population: irasIssue.population,
    primarySubject: irasIssue.subject,
    concepts: [irasIssue.subject],
    requestedOperation: irasIssue.operation
  }
};

const fetchRequests = [];
const customFetch = async (input, init = {}) => {
  const url = String(input);
  fetchRequests.push(url);
  const entry = capture.entries.find(candidate => candidate.request.url === url && candidate.request.method === (init.method || 'GET'));
  if (!entry) throw new Error(`OFFLINE_UNCAPTURED_REQUEST:${url}`);
  const bytes = Buffer.from(entry.bodyBase64, 'base64');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.bodySha256,
    `Captured response bytes match the recorded SHA-256 for ${url}.`);
  const response = new Response(bytes, { status: entry.status, headers: entry.headers });
  Object.defineProperty(response, 'url', { value: entry.actualUrl });
  return response;
};
const webRetriever = new ControlledWebRetriever(undefined, new SourceCache());
const searchQueries = [];
const offlineOptions = {
  questionUnderstanding: understanding,
  referenceDate: '2026-10-08',
  webRetriever,
  fetchOptions: { customFetch, useCache: false },
  officialDomainSearchAdapter: {
    async searchOfficialDomainCandidates(request) { searchQueries.push(request); return []; }
  }
};

const priorFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('OFFLINE_NETWORK_DISABLED'); };
try {
  const runtime = await buildAuthorityWorkstreams(question, issuePlan, {
    questionUnderstanding: understanding,
    referenceDate: '2026-10-08',
    groundingOptions: offlineOptions
  });
  const workstreams = runtime.workstreams;
  const irasRuntime = workstreams.find(workstream => workstream.authority === 'IRAS')?.issues.find(issue => issue.issueId === irasIssue.id);
  assert.equal(irasRuntime?.evidenceStatus, 'VERIFIED', 'The mapped IRAS rule remains verified.');
  assert.equal(irasRuntime?.applicationStatus, 'UNRESOLVED', 'Case-specific eligibility/calculation remains unresolved.');
  const employerRuntime = workstreams.find(workstream => workstream.authority === 'CPF')?.issues.find(issue => issue.population === 'EMPLOYER');
  assert.equal(employerRuntime?.evidenceStatus, 'INSUFFICIENT', 'The CPF relief page does not establish the employer contribution calculation.');
  assert.equal(employerRuntime?.lifecycle.admitted, false, 'The employer CPF issue remains outside admitted IRAS relief evidence.');

  const result = await resolveMappedOfficialSourceFallback(irasIssue.mappedTopicIds, question, defaultAdvancedSourceRetriever, {
    ...offlineOptions,
    evidenceScope,
    authorityLevelDiscovery: true
  });
  assert.equal(searchQueries.length, 0, 'Sufficient mapped evidence does not reach official-domain search.');
  assert.ok(result.records.some(record => record.tags.includes('iras-individual-cpf-relief')),
    'The mapped CPF relief page is reused as an eligible record.');
  assert.equal(fetchRequests.some(url => /\/srs-contributions-and-tax-relief(?:\?|$)/i.test(url)), false,
    'The complete mapped CPF page does not trigger an unrelated SRS page fetch.');
  assert.equal(result.trace.attempts.some(attempt => /\/srs-contributions-and-tax-relief(?:\?|$)/i.test(attempt.candidateUrl || '')), false,
    'No SRS candidate is attempted for the fully covered CPF request.');
  const topiclessDecision = result.trace.coverageDecisions?.find(decision =>
    decision.scope === 'TOPIC' && decision.targetTopicIds.includes('iras-authority-query-concept-semantic-personal-income-tax-relief'));
  assert.ok(topiclessDecision, 'The topicless semantic target has a bounded coverage decision trace.');
  assert.ok(topiclessDecision.admissionTopicIds.includes('iras-individual-cpf-relief'),
    'The same-domain registered CPF topic is retained for record admission.');
  assert.ok(topiclessDecision.eligibleRecordIds.some(id => id.startsWith('LIVE_TOPIC_iras-individual-cpf-relief_')),
    'The captured CPF record is eligible in that admission scope.');
  assert.equal(topiclessDecision.uncoveredTopicIds.includes(topiclessDecision.targetTopicIds[0]), false,
    'The requested topicless personal-relief scope is covered by the page content.');

  const srsConcept = {
    id: 'srs_relief', label: 'SRS contribution tax relief',
    terms: ['SRS contribution relief', 'Supplementary Retirement Scheme contributions'],
    topicIds: ['iras-individual-srs-relief']
  };
  const discoveryScopes = [];
  const srsResult = await resolveMappedOfficialSourceFallback(irasIssue.mappedTopicIds, question, defaultAdvancedSourceRetriever, {
    ...offlineOptions,
    evidenceScope: { ...evidenceScope, requestedConcepts: [...requestedConcepts, srsConcept] },
    authorityLevelDiscovery: true,
    discoveryAdapter: {
      async discoverOfficialSourceCandidates(request) { discoveryScopes.push(request); return []; },
      getLastFetchTrace() { return []; }
    }
  });
  assert.ok(srsResult.records.some(record => record.tags.includes('iras-individual-cpf-relief')),
    'The covered CPF topic remains available when a separate concept is unresolved.');
  assert.ok(discoveryScopes.some(request => request.topicId === 'iras-authority-query-concept-srs-relief'),
    'A distinct unsupported SRS concept still receives its own discovery attempt.');
  const srsDecision = srsResult.trace.coverageDecisions?.find(decision =>
    decision.scope === 'TOPIC' && decision.targetTopicIds.includes('iras-authority-query-concept-srs-relief'));
  assert.ok(srsDecision?.uncoveredTopicIds.includes('iras-authority-query-concept-srs-relief'),
    'CPF relief evidence does not close the distinct SRS coverage target.');

  const corporateTopic = getCoverageTopicById('iras-cit-loss-carry-forward');
  assert.ok(corporateTopic, 'A registered corporate IRAS topic is available for the cross-domain guard.');
  const crossDomainConcept = {
    id: 'corporate_loss_carry_forward', label: 'corporate tax loss carry-forward',
    terms: ['corporate tax losses', 'carry forward tax losses'], topicIds: [corporateTopic.id]
  };
  const crossDomainDiscoveries = [];
  const crossDomainResult = await resolveMappedOfficialSourceFallback(irasIssue.mappedTopicIds, question, defaultAdvancedSourceRetriever, {
    ...offlineOptions,
    evidenceScope: { ...evidenceScope, requestedConcepts: [...requestedConcepts, crossDomainConcept] },
    authorityLevelDiscovery: true,
    discoveryAdapter: {
      async discoverOfficialSourceCandidates(request) { crossDomainDiscoveries.push(request); return []; },
      getLastFetchTrace() { return []; }
    }
  });
  assert.ok(crossDomainDiscoveries.some(request => request.topicId === 'iras-authority-query-concept-corporate-loss-carry-forward'),
    'The foreign corporate scope remains uncovered despite an admitted individual CPF record.');
  const crossDomainDecision = crossDomainResult.trace.coverageDecisions?.find(decision =>
    decision.scope === 'TOPIC' && decision.targetTopicIds.includes('iras-authority-query-concept-corporate-loss-carry-forward'));
  assert.ok(crossDomainDecision, 'The corporate scope decision is traced.');
  assert.equal(crossDomainDecision.admissionTopicIds.includes('iras-individual-cpf-relief'), false,
    'An individual IRAS topic is not an admission topic for corporate IRAS evidence.');
  assert.equal(crossDomainDecision.eligibleRecordIds.some(id => id.startsWith('LIVE_TOPIC_iras-individual-cpf-relief_')), false,
    'The individual CPF record cannot satisfy the corporate topic.');

  const liveCpf = result.records.find(record => record.tags.includes('iras-individual-cpf-relief'));
  assert.ok(liveCpf, 'A live CPF record is available for the ineligible-evidence check.');
  const ineligible = evaluateEvidenceQuality({
    query: question,
    topicIds: irasIssue.mappedTopicIds,
    records: [{ ...liveCpf, id: `${liveCpf.id}_ineligible`, groundingEligible: false }],
    missingFacts: [], requestedConcepts, authorities: ['IRAS'],
    scopedSubject: irasIssue.subject, scopedPopulation: irasIssue.population,
    referenceDate: '2026-10-08', sourceMapFallbackTrace: result.trace
  });
  assert.equal(ineligible.eligibleRecords.length, 0, 'Evidence eligibility controls remain fail-closed.');
  assert.ok(ineligible.rejectedRecords.some(rejection => rejection.code === 'SOURCE_MAP_POINTER_NOT_EVIDENCE'),
    'A record marked as non-grounding evidence stays rejected.');
} finally {
  globalThis.fetch = priorFetch;
}

console.log('Scoped IRAS fallback reuse and negative-scope regressions passed.');
