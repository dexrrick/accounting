import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComplianceRationale } from '../../../src/components/ComplianceRationale.tsx';
import { classifyQuestion } from '../../../src/classification/questionClassifier.ts';
import { evaluateEvidenceQuality } from '../../../src/retrieval/evidenceQualityGate.ts';
import { verifyEvidenceClaims } from '../../../src/verification/claimEvidenceVerifier.ts';
import { defaultAdvancedSourceRetriever } from '../../../src/retrieval/advancedSourceRetriever.ts';
import { createIrasEvidencePresentation, hasCurrentIrasEvidencePresentation } from '../../../src/utils/irasEvidencePresentation.ts';
import { createChatPreview } from '../../../src/utils/chatPresentation.ts';
import { getRequestedQuestionConcepts, interpretSemanticQuestion, reconcileQuestionUnderstanding } from '../../../src/services/semanticQuestionUnderstanding.ts';
import { buildGroundedReasoningContext } from '../../../src/services/groundingContextBuilder.ts';
import { executeStructuredLlmCall } from '../../../src/services/aiTransport.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixturePath = path.join(root, 'tests/evaluation/singapore/semantic-question-adversarial.json');
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const live = process.argv.includes('--live');
const onlyCase = process.argv.find(argument => argument.startsWith('--case='))?.slice(7);
const apiKey = process.env.GEMINI_API_KEY?.trim();
if (live && !apiKey) throw new Error('Configure GEMINI_API_KEY locally before --live evaluation. No provider call was made.');

function makeTransientTopics(concepts) {
  return concepts.map(concept => ({
    id: `iras-authority-query-concept-${concept.id.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}`,
    title: `IRAS individual income tax — ${concept.label}`,
    domainId: 'IRAS_INDIVIDUAL_TAX', priority: 'P1', status: 'MISSING', authorities: ['IRAS'],
    legacyDomains: ['IRAS_TAX'], sourceRecordIds: [], requiredChecks: [], keywords: [concept.label, ...concept.terms],
    aliases: concept.terms, exclusionKeywords: [], requestedConcepts: [concept], mappedTopicIds: concept.topicIds
  }));
}

function makeEvidence(id, sourceText, tags, url) {
  return {
    id, authority: 'IRAS', authorityName: 'IRAS', sourcePublisher: 'IRAS',
    legalOrStandardInstrument: 'IRAS guidance', documentTitle: id.replaceAll('_', ' '), standardOrActCode: 'IRAS',
    paragraphOrSection: 'IRAS guidance', sourceText, principleSummary: 'Official IRAS guidance',
    officialSourceUrl: url, canonicalSourceUrl: url, domain: 'IRAS_TAX', jurisdiction: 'Singapore', tags,
    sourceStatus: 'VERIFIED', verificationMethod: 'CURATED_EDITORIAL_REVIEW', sourceType: 'OFFICIAL_GUIDANCE',
    evidenceTier: 'OFFICIAL_GUIDANCE', isVerbatimText: true, lastVerifiedDate: '2026-09-26',
    lifecycleState: 'ACTIVE', provenance: 'LOCAL_STATIC', recordRole: 'EVIDENCE', groundingEligible: true
  };
}

const cases = [];
for (const item of fixture.cases.filter(testCase => !onlyCase || testCase.id === onlyCase)) {
  const questionUnderstanding = live
    ? await interpretSemanticQuestion(item.question, apiKey, (...args) => executeStructuredLlmCall(...args))
    : { mode: 'SEMANTIC_INTERPRETATION', interpretation: item.interpretation };
  const reconciled = reconcileQuestionUnderstanding(item.question, classifyQuestion(item.question), questionUnderstanding);
  const context = await buildGroundedReasoningContext(item.question, null, defaultAdvancedSourceRetriever, undefined, {
    questionUnderstanding: reconciled.understanding,
    authorityLevelDiscovery: true,
    fetchOptions: { useCache: false, customFetch: async () => new Response('Offline adversarial evaluation', { status: 503 }) },
    discoveryAdapter: { discoverOfficialSourceCandidates: async () => [] },
    officialDomainSearchAdapter: { searchOfficialDomainCandidates: async () => [] }
  });
  const interpretation = reconciled.understanding.interpretation;
  const expectedDomain = item.expected.domain;
  const expectedDomainMatched = expectedDomain ? context.classification.domains.includes(expectedDomain) : true;
  const expectedPopulationMatched = item.expected.population ? interpretation?.population === item.expected.population : true;
  const expectedTopicMatched = (item.expected.topicIds || []).every(id => context.classification.topicIds.includes(id));
  const requestedConcepts = getRequestedQuestionConcepts(item.question, reconciled.understanding);
  const quality = context.evidenceQuality;
  const presentation = quality ? createIrasEvidencePresentation({
    query: item.question, classification: context.classification, quality, acceptedClaims: [],
    missingFacts: context.missingFacts, applicationConclusions: [], hasVerifiedCalculation: false, hasApplicationUncertainty: true
  }) : undefined;
  const mappedTopics = [...new Set([
    ...context.classification.topicIds,
    ...requestedConcepts.flatMap(concept => concept.topicIds)
  ])];
  cases.push({
    id: item.id,
    question: item.question,
    interpretationSource: live ? 'LIVE_PROVIDER' : 'ORACLE_FIXTURE',
    modelUnderstandingMeasured: live,
    semanticInterpretation: interpretation ? {
      domain: interpretation.domain, population: interpretation.population,
      primarySubject: interpretation.primarySubject, concepts: interpretation.concepts.filter(concept => concept.role !== 'CONTEXT_ONLY')
    } : undefined,
    reconciledDomainPopulation: {
      domains: context.classification.domains.filter(domain => domain.startsWith('IRAS_')),
      population: interpretation?.population || 'UNKNOWN'
    },
    requestedConcepts: requestedConcepts.map(concept => concept.label),
    mappedTopics,
    acceptedOfficialSources: quality?.eligibleRecords.map(record => ({ title: record.documentTitle, url: record.canonicalSourceUrl || record.officialSourceUrl })) || [],
    evidenceCoverage: {
      status: quality?.status || 'NO_IRAS_EVIDENCE_GATE',
      coveredConcepts: quality?.coveredConcepts || [],
      uncoveredConcepts: quality?.uncoveredConcepts || requestedConcepts.map(concept => concept.label),
      acceptedSourceGroups: quality?.acceptedSourceGroups || [],
      uncoveredTopicIds: quality?.uncoveredTopicIds || []
    },
    presentationDomainLabel: presentation?.domainLabel,
    oracleRoutingChecks: {
      domain: expectedDomainMatched,
      population: expectedPopulationMatched,
      requiredTopics: expectedTopicMatched
    },
    liveModelChecks: live ? {
      validInterpretation: Boolean(questionUnderstanding.interpretation),
      failure: questionUnderstanding.failure,
      expectedPopulation: expectedPopulationMatched,
      expectedDomain: expectedDomainMatched
    } : 'NOT_MEASURED_ORACLE_INPUT'
  });
}

const reliefCase = fixture.cases.find(item => item.id === 'multi-relief-cap-cpf-srs-family');
const reliefInterpretation = { mode: 'SEMANTIC_INTERPRETATION', interpretation: reliefCase.interpretation };
const reliefConcepts = getRequestedQuestionConcepts(reliefCase.question, reliefInterpretation);
const reliefTopics = makeTransientTopics(reliefConcepts);
const tags = reliefTopics.map(topic => topic.id);
const generic = makeEvidence('GENERIC_IRAS_RELIEF',
  'IRAS provides tax information for individuals, companies, employers and businesses. Refer to official tax pages for applicable relief.',
  tags, 'https://www.iras.gov.sg/taxes/individual-income-tax');
const srs = makeEvidence('SRS_RELIEF',
  'SRS Relief may be available for qualifying Supplementary Retirement Scheme contributions.',
  [reliefTopics.find(topic => topic.requestedConcepts[0].id === 'srs_relief').id],
  'https://www.iras.gov.sg/taxes/individual-income-tax/srs');
const reliefHub = makeEvidence('DIRECT_IRAS_RELIEF_HUB',
  'Individual income tax reliefs are subject to an overall relief cap of $80,000. CPF Relief and SRS Relief are among the claims. Parent Relief, Grandparent Caregiver Relief, Working Mother’s Child Relief (WMCR), and Qualifying Child Relief (QCR) are available according to the applicable conditions.',
  [...tags, 'iras-individual-relief-cap'], 'https://www.iras.gov.sg/taxes/individual-income-tax/tax-reliefs');

const evidenceScenarios = [];
for (const scenario of fixture.evidenceScenarios) {
  const records = scenario.sourceProfile === 'SRS_ONLY_PLUS_GENERIC_OFFICIAL' ? [srs, generic] : [generic];
  const assessment = evaluateEvidenceQuality({
    query: reliefCase.question, topicIds: ['iras-individual-relief-cap'], provisionalTopics: reliefTopics,
    requestedConcepts: reliefConcepts, records, missingFacts: [], authorities: ['IRAS'], domain: 'IRAS_TAX',
    referenceDate: '2026-09-26'
  });
  evidenceScenarios.push({
    id: scenario.id, question: reliefCase.question,
    requestedConcepts: assessment.requestedConcepts,
    coveredConcepts: assessment.coveredConcepts,
    uncoveredConcepts: assessment.uncoveredConcepts,
    acceptedSourceGroups: assessment.acceptedSourceGroups,
    evidenceStatus: assessment.status,
    acceptedRecordIds: assessment.eligibleRecords.map(record => record.id),
    rejectedRecords: assessment.rejectedRecords
  });
}
const hubAssessment = evaluateEvidenceQuality({
  query: reliefCase.question, topicIds: ['iras-individual-relief-cap'], provisionalTopics: reliefTopics,
  requestedConcepts: reliefConcepts, records: [reliefHub], missingFacts: [], authorities: ['IRAS'],
  domain: 'IRAS_TAX', referenceDate: '2026-09-26'
});
evidenceScenarios.push({
  id: 'direct-relief-hub-covers-named-reliefs-but-not-order', question: reliefCase.question,
  requestedConcepts: hubAssessment.requestedConcepts, coveredConcepts: hubAssessment.coveredConcepts,
  uncoveredConcepts: hubAssessment.uncoveredConcepts, acceptedSourceGroups: hubAssessment.acceptedSourceGroups,
  evidenceStatus: hubAssessment.status, acceptedRecordIds: hubAssessment.eligibleRecords.map(record => record.id),
  rejectedRecords: hubAssessment.rejectedRecords
});

const benefitCase = fixture.cases.find(item => item.id === 'employee-benefits-context-company');
const benefitUnderstanding = { mode: 'SEMANTIC_INTERPRETATION', interpretation: benefitCase.interpretation };
const benefitReconciled = reconcileQuestionUnderstanding(benefitCase.question, classifyQuestion(benefitCase.question), benefitUnderstanding);
const panelRecord = makeEvidence('PRESENTATION_INVARIANT_SOURCE',
  'Employee benefits in kind are reported under the applicable employment income rules.',
  ['iras-employment-benefits'], 'https://www.iras.gov.sg/taxes/individual-income-tax/employers/benefits');
const acceptedPassage = 'Employee benefits in kind are reported under the applicable employment income rules.';
const verifiedPanelClaims = verifyEvidenceClaims([{ text: acceptedPassage, quote: acceptedPassage,
  recordId: panelRecord.id, kind: 'RULE' }], [panelRecord], { targetDate: '2026-09-26' });
assert.equal(verifiedPanelClaims.accepted.length, 1, 'The presentation fixture must start from a claim verified against its source record.');
const presentationQuality = {
  status: 'LOCAL_SUFFICIENT', eligibleRecords: [panelRecord], rejectedRecords: [], coveredTopicIds: ['iras-employment-benefits'],
  uncoveredTopicIds: [], missingFacts: [], targetDateConfidence: 'HIGH'
};
const invariantPresentation = createIrasEvidencePresentation({
  query: benefitCase.question, classification: benefitReconciled.classification, quality: presentationQuality,
  acceptedClaims: verifiedPanelClaims.accepted,
  missingFacts: [], applicationConclusions: [], hasVerifiedCalculation: false, hasApplicationUncertainty: false
});
const panelHtml = renderToStaticMarkup(React.createElement(ComplianceRationale, {
  citations: [], advisories: [], standard: 'SFRS_I', primaryDomain: 'IRAS_TAX', rawQuery: benefitCase.question,
  irasEvidencePresentation: invariantPresentation
}));
const invariantPreview = createChatPreview('', {
  rawQuery: benefitCase.question, primaryDomain: 'IRAS_TAX', irasEvidencePresentation: invariantPresentation
});
const sourceGroupTitles = invariantPresentation.sourceGroups.map(group => group.title);
const presentationConsistency = {
  queryMatches: invariantPresentation.query === benefitCase.question,
  domainMatchesReconciledClassification: invariantPresentation.domainLabel === 'IRAS Employer Tax',
  sourcesHaveAcceptedClaimsForCurrentQuery: invariantPresentation.sourceGroups.length > 0 && invariantPresentation.sourceGroups.every(group =>
    group.passages.length > 0 && group.passages.every(passage => passage.claimReferences.length > 0 &&
      passage.claimReferences.every(reference => presentationQuality.eligibleRecords.some(record => record.id === reference.recordId)))),
  chatPreviewAndSidePanelUseSamePresentation: sourceGroupTitles.length > 0 &&
    invariantPreview === 'The complete admitted IRAS passages are in Supporting Official Guidance.' &&
    sourceGroupTitles.every(title => invariantPresentation.chatAnswer.includes(title) && panelHtml.includes(title)),
  staleQuestionRejected: !hasCurrentIrasEvidencePresentation(invariantPresentation, 'A different tax question', 'IRAS_TAX')
};
assert.ok(Object.values(presentationConsistency).every(value => value === true),
  `The chat and statutory panel must project one current verified evidence presentation: ${JSON.stringify(presentationConsistency)}`);

const report = {
  summary: {
    suite: fixture.suite,
    mode: live ? 'LIVE_GEMINI_WITH_OFFLINE_EVIDENCE' : 'ORACLE_ROUTING_WITH_OFFLINE_EVIDENCE',
    model: live ? 'gemini-3.5-flash-lite' : 'NOT_MEASURED_ORACLE_INPUT',
    modelUnderstandingMeasured: live,
    cases: cases.length,
    oracleRoutingPasses: cases.filter(item => Object.values(item.oracleRoutingChecks).every(value => value === true)).length,
    presentationConsistency,
    limitations: [
      'Oracle fixture interpretations measure deterministic reconciliation, not model extraction.',
      'Evidence coverage profiles are synthetic source-text fixtures; offline discovery does not measure live IRAS availability.',
      'The priority-order concept remains uncovered unless an official passage directly states how relief claims are prioritized.'
    ]
  },
  cases,
  evidenceScenarios
};
const outputDirectory = path.join(root, 'docs/evaluation/semantic-question-adversarial');
await mkdir(outputDirectory, { recursive: true });
const outputPath = path.join(outputDirectory, `${live ? 'live' : 'oracle'}-evaluation.json`);
const serialized = JSON.stringify(report, null, 2);
if (apiKey && serialized.includes(apiKey)) throw new Error('Refusing to save credential-shaped evaluation output.');
await writeFile(outputPath, serialized);
console.log(JSON.stringify(report.summary, null, 2));
console.log(`Wrote ${path.relative(root, outputPath)}`);
