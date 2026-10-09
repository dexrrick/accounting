import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGroundedReasoningContext } from '../../../../src/services/groundingContextBuilder.ts';
import { renderIrasEvidenceResponse } from '../../../../src/services/irasEvidencePolicy.ts';
import { buildAuthorityWorkstreams, planAuthorityWorkstreams } from '../../../../src/services/authorityWorkstreams.ts';
import { evaluateEvidenceQuality } from '../../../../src/retrieval/evidenceQualityGate.ts';
import { ControlledWebRetriever } from '../../../../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../../../../src/retrieval/sourceCache.ts';
import { defaultAdvancedSourceRetriever } from '../../../../src/retrieval/advancedSourceRetriever.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../../../src/standards/unifiedSourceModel.ts';
import { getCoverageTopicsByIds } from '../../../../src/standards/coverageRegistry.ts';

const directory = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(await readFile(path.join(directory, 'local-evidence-fixtures.json'), 'utf8'));
const referenceDate = fixtures.referenceDate;
const baseline = '22f4ae5a4f1173dc89991d602fcf30a5129012ad';
const caseIds = [
  'private-deductibility-general',
  'private-disallowed-general',
  'foreign-dividend-conditional-rule',
  'foreign-income-without-dividend-negative',
  'company-residency-natural',
  'company-residency-phrase-matched',
  'wht-royalty-hyphenated-query',
  'wht-royalty-spaced-query-control',
  'gst-input-tax-natural',
  'gst-input-tax-phrase-matched'
];

function issuePlanFor(id, fixture, subjectOverride) {
  const domain = fixture.topicId.startsWith('iras-gst-') ? 'IRAS_GST' : 'IRAS_INCOME_TAX';
  return {
    source: 'SEMANTIC_ISSUES',
    issues: [{
      id: `${id}-issue`,
      subject: subjectOverride || fixture.subject,
      population: 'COMPANY',
      domain,
      governingAuthorities: ['IRAS'],
      contextualAuthorities: [],
      operation: 'EXPLAIN_RULE',
      mappedTopicIds: [fixture.topicId],
      evidenceRequirement: 'AUTHORITATIVE_SOURCE',
      confidence: 0.95,
      status: 'MAPPED'
    }],
    coverageEstablished: true,
    hasUnmappedResidual: false
  };
}

function mapPointers(mapIds) {
  return mapIds.map(id => {
    const record = UNIFIED_SOURCE_REGISTRY[id];
    assert.equal(record?.recordRole, 'SOURCE_MAP_POINTER', `Reviewed source-map pointer exists: ${id}`);
    return record;
  });
}

function html(title, passage) {
  const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return `<html><head><title>${escape(title)}</title></head><body><main><h1>${escape(title)}</h1><p>${escape(passage)}</p></main></body></html>`;
}

function emptyLocalRetriever() {
  return {
    retrieveSources: async () => [],
    getSourceById: id => defaultAdvancedSourceRetriever.getSourceById(id),
    findSourcesByStandardOrAct: (...args) => defaultAdvancedSourceRetriever.findSourcesByStandardOrAct(...args)
  };
}

async function runCase(id, fixture, passageOverride, subjectOverride, questionUnderstandingOverride) {
  const passage = passageOverride || fixture.passage;
  const topic = getCoverageTopicsByIds([fixture.topicId])[0];
  assert.ok(topic, `Coverage topic resolves: ${fixture.topicId}`);
  const pointers = mapPointers(fixture.mapIds || [fixture.mapId]);
  const pages = new Map(pointers.map(pointer => [pointer.canonicalSourceUrl, {
    title: pointer.documentTitle,
    passage
  }]));
  let mappedFetchCount = 0;
  let fetchedSyntheticPassageBlockCount = 0;
  const customFetch = async url => {
    const page = pages.get(String(url));
    if (!page) throw new Error('UNEXPECTED_SYNTHETIC_URL');
    mappedFetchCount += 1;
    fetchedSyntheticPassageBlockCount += page.passage.split(/\n\s*\n/).filter(block => block.trim()).length;
    return new Response(html(page.title, page.passage), {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
  };
  const testIssuePlan = issuePlanFor(id, fixture, subjectOverride);
  const plan = planAuthorityWorkstreams(testIssuePlan)[0];
  const capture = {};
  const provider = {
    authority: 'IRAS',
    async retrieve(request) {
      const scopedTopic = getCoverageTopicsByIds(request.retrievalIntent.topicIds)[0];
      const scope = {
        authority: 'IRAS',
        domain: plan.domain,
        topicIds: request.retrievalIntent.topicIds,
        requestedConcepts: request.retrievalIntent.requestedConcepts,
        context: {
          domainId: scopedTopic.domainId,
          population: request.issue.population,
          primarySubject: request.issue.subject,
          concepts: [request.issue.subject],
          requestedOperation: request.issue.operation
        }
      };
      const context = await buildGroundedReasoningContext(
        fixture.query,
        null,
        emptyLocalRetriever(),
        undefined,
        {
          referenceDate,
          questionUnderstanding: questionUnderstandingOverride || { mode: 'DETERMINISTIC_FALLBACK' },
          evidenceScope: scope,
          webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
          fetchOptions: { timeoutMs: 3000, useCache: false, customFetch },
          discoveryAdapter: { discoverOfficialSourceCandidates: async () => [] },
          officialDomainSearchAdapter: { searchOfficialDomainCandidates: async () => [] },
          authorityLevelDiscovery: false
        }
      );
      const rendered = renderIrasEvidenceResponse({}, context, fixture.query, null, 'SFRS_I', 'LOCAL');
      const quality = context.evidenceQuality;
      const trace = context.sourceMapFallbackTrace;
      capture.context = context;
      capture.rendered = rendered;
      capture.records = quality?.eligibleRecords || [];
      capture.trace = trace;
      const candidateRecordCount = trace?.selectedRecordIds?.length || 0;
      return {
        candidates: capture.records,
        claims: rendered.claimVerification.accepted,
        evidenceQualityTrace: trace,
        trace: {
          stages: (trace?.stages || []).map(stage => ({
            stage: stage.stage,
            status: stage.status,
            reason: 'Synthetic local evidence trace.'
          })),
          attempts: (trace?.attempts || []).map(attempt => ({
            topicId: attempt.topicId,
            fetchStatus: attempt.fetchStatus,
            ...(attempt.pageTitle ? { pageTitle: attempt.pageTitle } : {})
          }))
        }
      };
    }
  };
  const workstream = await buildAuthorityWorkstreams(fixture.query, testIssuePlan, {
    referenceDate,
    questionUnderstanding: questionUnderstandingOverride || { mode: 'DETERMINISTIC_FALLBACK' },
    providers: { IRAS: provider }
  });
  const issue = workstream.workstreams.flatMap(item => item.issues)[0];
  const trace = capture.trace;
  const quality = capture.context?.evidenceQuality;
  const selectedClaimCount = (capture.rendered?.claimVerification.accepted.length || 0) +
    (capture.rendered?.claimVerification.rejected.length || 0);
  const literalVerifiedClaimCount = capture.rendered?.claimVerification.accepted.length || 0;
  const candidateRecordCount = trace?.selectedRecordIds?.length || 0;
  const admittedRecordCount = quality?.eligibleRecords.length || 0;
  const requestedConcepts = capture.context?.questionUnderstanding
    ? (await import('../../../../src/services/semanticQuestionUnderstanding.ts')).getRequestedQuestionConcepts(
      fixture.query, capture.context.questionUnderstanding
    )
    : [];
  const uncoveredConceptIds = requestedConcepts
    .filter(concept => quality?.uncoveredConcepts.includes(concept.label))
    .map(concept => concept.id);
  const statuses = (trace?.attempts || []).map(attempt => ({
    topicId: attempt.topicId,
    sourceMapId: attempt.sourceMapId,
    status: attempt.fetchStatus
  }));
  const firstFailingStage = candidateRecordCount === 0
    ? statuses.some(item => item.status === 'DOMAIN_MISMATCH') ? 'URL_DOMAIN_QUERY_COMPATIBILITY'
      : statuses.some(item => item.status === 'TOPIC_MISMATCH') ? 'PAGE_OR_EXCERPT_COMPATIBILITY'
        : statuses.length ? 'MAPPED_FETCH_NO_CANDIDATE' : 'NO_MAPPED_ATTEMPT'
    : admittedRecordCount === 0 ? 'EVIDENCE_ADMISSION'
      : selectedClaimCount === 0 ? 'RENDERER_CLAIM_SELECTION'
        : literalVerifiedClaimCount === 0 ? 'LITERAL_QUOTATION_VERIFICATION'
          : issue.verifiedClaims.length === 0 ? 'ISSUE_SUBJECT_CONCEPT_FILTER'
            : issue.gaps.some(gap => ['IRAS_SCOPE_NOT_COVERED', 'ISSUE_CONCEPT_UNCOVERED'].includes(gap.code)) ? 'REQUESTED_CONCEPT_COVERAGE'
              : 'NONE';
  return {
    id,
    topicId: fixture.topicId,
    sourceMapIds: pointers.map(pointer => pointer.id),
    mappedFetchCount,
    mappedAttemptStatuses: statuses,
    candidateRecordCount,
    admittedRecordCount,
    fetchedSyntheticPassageBlockCount,
    admittedEvidencePassageBlockCount: capture.records.reduce((count, record) => count +
      record.sourceText.split(/\n\s*\n/).filter(block => block.trim()).length, 0),
    rendererSelectedClaimCount: selectedClaimCount,
    literalVerifiedClaimCount,
    literalRejectedClaimCount: capture.rendered?.claimVerification.rejected.length || 0,
    finalIssueClaimCount: issue.verifiedClaims.length,
    issueEvidenceStatus: issue.evidenceStatus,
    finalIssueGapCodes: issue.gaps.map(gap => gap.code),
    uncoveredTopicIds: quality?.uncoveredTopicIds || [],
    uncoveredConceptCount: uncoveredConceptIds.length,
    uncoveredConceptIds,
    firstFailingStage,
    internal: { records: capture.records, context: capture.context, trace }
  };
}

const originalFetch = globalThis.fetch;
let ambientNetworkCalls = 0;
globalThis.fetch = async () => {
  ambientNetworkCalls += 1;
  throw new Error('AMBIENT_NETWORK_DISABLED');
};
let caseResults;
let negativeControls;
let residencySubjectNegativeControls;
let residencyPositiveControl;
let missingResidencyQuoteAnchors;
let cpfControl;
try {
  caseResults = [];
  for (const id of caseIds) caseResults.push(await runCase(id, fixtures.cases[id]));
  const residencyPhraseProbe = fixtures.cases['company-residency-phrase-matched'];
  residencySubjectNegativeControls = [];
  const generalResidencyQuoteDetailedSubject = await runCase(
    'negative-residency-subject-extra-material', residencyPhraseProbe, undefined,
    'company tax residency certificate of residence under a treaty for a foreign jurisdiction'
  );
  const extraConceptUnderstanding = {
    mode: 'SEMANTIC_INTERPRETATION',
    interpretation: {
      jurisdiction: ['Singapore'], authorityCandidates: ['IRAS'], contextualAuthorities: [],
      domain: 'IRAS_INCOME_TAX', population: 'COMPANY', primarySubject: 'company tax residency',
      concepts: [{ concept: 'company tax residency certificate of residence under a foreign treaty', role: 'RELATED' }],
      requestedOperation: 'EXPLAIN_RULE', requiresUserSpecificFacts: false, calculationRequested: false,
      factsExplicitlyProvided: [], confidence: 0.95
    }
  };
  const generalResidencyQuoteExtraConcept = await runCase(
    'negative-residency-concept-extra-material', residencyPhraseProbe, undefined,
    'company tax residency', extraConceptUnderstanding
  );
  const generalResidencyPositiveSubject = await runCase(
    'positive-residency-general-subject', residencyPhraseProbe, undefined, 'general company tax residence rule'
  );
  residencyPositiveControl = {
    id: 'general-company-tax-residence-subject',
    finalIssueClaimCount: generalResidencyPositiveSubject.finalIssueClaimCount,
    issueEvidenceStatus: generalResidencyPositiveSubject.issueEvidenceStatus
  };
  missingResidencyQuoteAnchors = [];
  for (const [id, passage] of [
    ['missing-tax-in-quote', 'A company residence test depends on where control and management of the business is exercised.'],
    ['missing-company-in-quote', 'Tax residence for a year is determined by where control and management of the business is exercised.'],
    ['missing-residence-in-quote', 'A company tax test depends on where control and management of the business is exercised.']
  ]) {
    const probe = await runCase(`negative-residency-${id}`, residencyPhraseProbe, passage, 'company tax residence');
    missingResidencyQuoteAnchors.push({ id, finalIssueClaimCount: probe.finalIssueClaimCount, firstFailingStage: probe.firstFailingStage });
  }
  residencySubjectNegativeControls.push({
    id: 'extra-material-subject', candidateRecordCount: generalResidencyQuoteDetailedSubject.candidateRecordCount,
    admittedRecordCount: generalResidencyQuoteDetailedSubject.admittedRecordCount,
    literalVerifiedClaimCount: generalResidencyQuoteDetailedSubject.literalVerifiedClaimCount,
    finalIssueClaimCount: generalResidencyQuoteDetailedSubject.finalIssueClaimCount,
    firstFailingStage: generalResidencyQuoteDetailedSubject.firstFailingStage
  }, {
    id: 'extra-material-concept', candidateRecordCount: generalResidencyQuoteExtraConcept.candidateRecordCount,
    admittedRecordCount: generalResidencyQuoteExtraConcept.admittedRecordCount,
    literalVerifiedClaimCount: generalResidencyQuoteExtraConcept.literalVerifiedClaimCount,
    finalIssueClaimCount: generalResidencyQuoteExtraConcept.finalIssueClaimCount,
    issueEvidenceStatus: generalResidencyQuoteExtraConcept.issueEvidenceStatus,
    finalIssueGapCodes: generalResidencyQuoteExtraConcept.finalIssueGapCodes,
    uncoveredConceptIds: generalResidencyQuoteExtraConcept.uncoveredConceptIds,
    firstFailingStage: generalResidencyQuoteExtraConcept.firstFailingStage
  });
  const residency = fixtures.cases['company-residency-natural'];
  const unrelatedIrasPage = await runCase('negative-unrelated-iras-page-topic', residency,
    fixtures.negativeControls.unrelatedIrasTopicText);
  const unrelatedSibling = await runCase('negative-unrelated-sibling', fixtures.negativeControls.unrelatedSibling);
  const foreignProbe = caseResults.find(item => item.id === 'foreign-dividend-conditional-rule');
  const foreignFixture = fixtures.cases['foreign-dividend-conditional-rule'];
  assert.ok(foreignProbe.internal.records.length > 0, 'The wrong-domain control starts from a positively admitted foreign-dividend record.');
  const wrongDomainCandidate = foreignProbe.internal.records.map(record => ({ ...record, domain: 'IRAS_GST' }));
  const wrongDomainAssessment = evaluateEvidenceQuality({
    query: foreignFixture.query,
    topicIds: [foreignFixture.topicId],
    records: wrongDomainCandidate,
    missingFacts: [],
    authorities: ['IRAS'],
    referenceDate,
    sourceMapFallbackTrace: foreignProbe.internal.trace
  });
  const privateFixture = fixtures.cases['private-deductibility-general'];
  const pointer = UNIFIED_SOURCE_REGISTRY[privateFixture.mapId];
  const urlOnlyAssessment = evaluateEvidenceQuality({
    query: privateFixture.query,
    topicIds: [privateFixture.topicId],
    records: [pointer],
    missingFacts: [],
    authorities: ['IRAS'],
    referenceDate
  });
  negativeControls = [
    {
      id: 'unrelated-iras-page-topic',
      candidateRecordCount: unrelatedIrasPage.candidateRecordCount,
      admittedRecordCount: unrelatedIrasPage.admittedRecordCount,
      firstFailingStage: unrelatedIrasPage.firstFailingStage,
      statuses: unrelatedIrasPage.mappedAttemptStatuses.map(item => item.status)
    },
    {
      id: 'unrelated-sibling-topic',
      candidateRecordCount: unrelatedSibling.candidateRecordCount,
      admittedRecordCount: unrelatedSibling.admittedRecordCount,
      firstFailingStage: unrelatedSibling.firstFailingStage,
      statuses: unrelatedSibling.mappedAttemptStatuses.map(item => item.status)
    },
    {
      id: 'wrong-evidence-domain',
      admittedRecordCount: wrongDomainAssessment.eligibleRecords.length,
      rejectedRecordCount: wrongDomainAssessment.rejectedRecords.length,
      firstFailingStage: wrongDomainAssessment.eligibleRecords.length === 0 ? 'EVIDENCE_ADMISSION' : 'NONE'
    },
    {
      id: 'official-map-url-without-evidence-text',
      admittedRecordCount: urlOnlyAssessment.eligibleRecords.length,
      rejectedRecordCount: urlOnlyAssessment.rejectedRecords.length,
      firstFailingStage: urlOnlyAssessment.eligibleRecords.length === 0 ? 'EVIDENCE_ADMISSION' : 'NONE'
    }
  ];

  const section14 = UNIFIED_SOURCE_REGISTRY.ITA_SEC14_GENERAL_DEDUCTION;
  assert.ok(section14, 'The existing local IRAS section 14 source is available for the CPF control.');
  const cpfText = 'TEST-ONLY SYNTHETIC EVIDENCE: Employees may claim CPF relief for their compulsory CPF contributions. This fixture describes CPF relief for employees.';
  const cpfRecord = {
    ...section14,
    id: 'TEST_ONLY_SYNTHETIC_IRAS_CPF_RELIEF',
    authority: 'IRAS',
    authorityName: 'IRAS (test-only synthetic fixture)',
    sourcePublisher: 'Test-only synthetic fixture',
    legalOrStandardInstrument: 'Test-only synthetic fixture',
    documentTitle: 'Test-only synthetic CPF relief evidence',
    standardOrActCode: 'TEST_ONLY',
    paragraphOrSection: 'TEST_ONLY',
    sourceText: cpfText,
    principleSummary: 'Test-only synthetic evidence; not authoritative guidance.',
    domain: 'IRAS_INCOME_TAX',
    tags: ['iras-individual-cpf-relief', 'cpf relief for employees'],
    relatedTopicIds: ['iras-individual-cpf-relief'],
    sourceMapTopicIds: [],
    retrievalHints: [],
    provenance: 'LOCAL_STATIC',
    recordRole: 'EVIDENCE',
    groundingEligible: true
  };
  const cpfQuery = 'Does an employee receive personal income tax relief for compulsory CPF contributions?';
  const cpfIssue = {
    id: 'cpf-unchanged-control',
    subject: 'employee personal income tax relief for compulsory CPF contributions',
    population: 'EMPLOYEE',
    domain: 'IRAS_INCOME_TAX',
    governingAuthorities: ['IRAS'],
    contextualAuthorities: [],
    operation: 'EXPLAIN_RULE',
    mappedTopicIds: ['iras-individual-cpf-relief'],
    evidenceRequirement: 'AUTHORITATIVE_SOURCE',
    confidence: 0.95,
    status: 'MAPPED'
  };
  const cpfResult = await buildAuthorityWorkstreams(cpfQuery, {
    source: 'SEMANTIC_ISSUES',
    issues: [cpfIssue],
    coverageEstablished: true,
    hasUnmappedResidual: false
  }, {
    referenceDate,
    questionUnderstanding: { mode: 'DETERMINISTIC_FALLBACK' },
    providers: {
      IRAS: {
        authority: 'IRAS',
        retrieve: async () => ({
          candidates: [cpfRecord],
          claims: [{ kind: 'RULE', text: cpfText, quote: cpfText, recordId: cpfRecord.id }]
        })
      }
    }
  });
  const cpfIssueResult = cpfResult.workstreams[0]?.issues[0];
  cpfControl = {
    status: cpfResult.status,
    issueEvidenceStatus: cpfIssueResult?.evidenceStatus,
    finalIssueClaimCount: cpfIssueResult?.verifiedClaims.length || 0
  };
} finally {
  globalThis.fetch = originalFetch;
}

const compactCaseResults = caseResults.map(({ internal: _internal, ...row }) => row);
const diagnostic = {
  baseline,
  mode: 'synthetic-api-free-real-retrieval-renderer-workstream',
  referenceDate,
  fixtureNotice: fixtures.notice,
  ambientNetworkCalls,
  modelCalls: 0,
  historicalV3PassageAndClaimCounts: 'NR; not reconstructed from lost raw HTML',
  cases: compactCaseResults,
  negativeControls,
  residencySubjectNegativeControls,
  residencyPositiveControl,
  residencyMissingQuoteAnchors: missingResidencyQuoteAnchors,
  cpfUnchangedControl: cpfControl
};
const outputPath = process.env.EVIDENCE_TRACE_OUTPUT;
if (outputPath) await writeFile(path.resolve(outputPath), `${JSON.stringify(diagnostic, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(diagnostic, null, 2));

assert.equal(ambientNetworkCalls, 0, 'The diagnostic performs no ambient network calls.');
assert.equal(cpfControl.issueEvidenceStatus, 'VERIFIED', 'The CPF relief local-evidence control remains verified.');
assert.equal(cpfControl.finalIssueClaimCount, 1, 'The CPF relief control retains its verified claim.');
assert.equal(negativeControls.find(item => item.id === 'official-map-url-without-evidence-text')?.admittedRecordCount, 0,
  'A reviewed map URL alone is not admitted as evidence.');
assert.equal(negativeControls.find(item => item.id === 'unrelated-iras-page-topic')?.candidateRecordCount, 0,
  'An unrelated IRAS topic page does not become a mapped candidate.');
assert.equal(negativeControls.find(item => item.id === 'unrelated-sibling-topic')?.candidateRecordCount, 0,
  'An unrelated sibling topic does not become a mapped candidate.');
assert.equal(negativeControls.find(item => item.id === 'wrong-evidence-domain')?.admittedRecordCount, 0,
  'A candidate record with a mismatched IRAS evidence domain is rejected.');
for (const item of residencySubjectNegativeControls) {
  if (item.id === 'extra-material-subject') {
    assert.equal(item.finalIssueClaimCount, 0, 'A general residency quote cannot satisfy a detailed certificate/treaty subject.');
  }
}
const extraMaterialConcept = residencySubjectNegativeControls.find(item => item.id === 'extra-material-concept');
assert.notEqual(extraMaterialConcept?.issueEvidenceStatus, 'VERIFIED', 'A general residency quote cannot satisfy a detailed certificate/treaty concept.');
assert.ok(extraMaterialConcept?.finalIssueGapCodes.includes('ISSUE_CONCEPT_UNCOVERED'),
  'The final issue retains an uncovered-concept gap for the supplied certificate/treaty requirement.');
assert.equal(diagnostic.residencyPositiveControl.issueEvidenceStatus, 'VERIFIED',
  'The general company tax residence wording remains supported by the company tax residency quote.');
for (const item of missingResidencyQuoteAnchors) {
  assert.equal(item.finalIssueClaimCount, 0, `A quote ${item.id} is not enough to verify the plain subject.`);
}
for (const id of [
  'private-deductibility-general', 'private-disallowed-general', 'foreign-dividend-conditional-rule',
  'company-residency-natural', 'company-residency-phrase-matched', 'wht-royalty-hyphenated-query',
  'wht-royalty-spaced-query-control', 'gst-input-tax-natural', 'gst-input-tax-phrase-matched'
]) {
  const row = compactCaseResults.find(item => item.id === id);
  assert.ok(row && row.admittedRecordCount > 0, `Phrase-matched local probe is admitted: ${id}`);
  assert.ok(row.literalVerifiedClaimCount > 0, `Phrase-matched local probe has a literal verified claim: ${id}`);
  assert.ok(row.finalIssueClaimCount > 0, `Phrase-matched local probe survives final issue filtering: ${id}`);
}
const foreignNegative = compactCaseResults.find(item => item.id === 'foreign-income-without-dividend-negative');
assert.equal(foreignNegative?.finalIssueClaimCount, 0, 'A general foreign-income rule without dividend wording cannot cover a dividend issue.');
assert.equal(foreignNegative?.firstFailingStage, 'ISSUE_SUBJECT_CONCEPT_FILTER');
