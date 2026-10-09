import { writeFile } from 'node:fs/promises';
import { buildGroundedReasoningContext, GROUNDING_SOURCE_MAX_RESULTS } from '../../../../src/services/groundingContextBuilder.ts';
import { renderIrasEvidenceResponse } from '../../../../src/services/irasEvidencePolicy.ts';
import { buildAuthorityWorkstreams } from '../../../../src/services/authorityWorkstreams.ts';
import { evaluateEvidenceQuality } from '../../../../src/retrieval/evidenceQualityGate.ts';
import { findRecordEligibilityRejection, verifyEvidenceClaims } from '../../../../src/verification/claimEvidenceVerifier.ts';
import { defaultAdvancedSourceRetriever } from '../../../../src/retrieval/advancedSourceRetriever.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../../../src/standards/unifiedSourceModel.ts';
import { getCoverageTopicById } from '../../../../src/standards/coverageRegistry.ts';
import { supportGeneralIrasRuleConcept } from '../../../../src/retrieval/irasRuleConceptSupport.ts';
import { getRequestedQuestionConcepts } from '../../../../src/services/semanticQuestionUnderstanding.ts';
import { defaultTargetDateResolver } from '../../../../src/retrieval/targetDateResolver.ts';

const referenceDate = '2026-10-03';
const fallbackUnderstanding = { mode: 'DETERMINISTIC_FALLBACK' };
const cases = [
  {
    id: 'private-expense-treatment',
    query: "Our Singapore company paid SGD 900 for the director's private holiday and recorded it as travel expense. What is its corporate income-tax treatment?",
    issue: {
      id: 'company-private-expense-tax-treatment',
      subject: 'corporate income-tax treatment of company expense for director private holiday',
      population: 'COMPANY', domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'], contextualAuthorities: ['ACCOUNTING_STANDARDS'],
      operation: 'DETERMINE_TREATMENT', mappedTopicIds: ['iras-cit-deductibility', 'iras-cit-disallowed-expenses'],
      evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS', confidence: 1, status: 'MAPPED'
    },
    workstream: { authority: 'IRAS', domain: 'IRAS_CORPORATE_TAX', topicIds: ['iras-cit-deductibility', 'iras-cit-disallowed-expenses'], domainId: 'IRAS_CORPORATE_TAX' }
  },
  {
    id: 'gst-input-tax-general-rule',
    query: 'What are the general Singapore GST rules for claiming input tax on business purchases by a GST-registered company?',
    issue: {
      id: 'general-gst-input-tax-recovery-rules',
      subject: 'general GST input-tax recovery rules for business purchases by a GST-registered company',
      population: 'COMPANY', domain: 'IRAS_GST', governingAuthorities: ['IRAS'], contextualAuthorities: [],
      operation: 'EXPLAIN_RULE', mappedTopicIds: ['iras-gst-input-tax'],
      evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 1, status: 'MAPPED'
    },
    workstream: { authority: 'IRAS', domain: 'IRAS_GST', topicIds: ['iras-gst-input-tax'], domainId: 'IRAS_GST' }
  }
];

function scopeFor(testCase, requestedConcepts) {
  return {
    authority: 'IRAS', domain: testCase.workstream.domain, topicIds: testCase.workstream.topicIds, requestedConcepts,
    context: {
      domainId: testCase.workstream.domainId, population: 'COMPANY', primarySubject: testCase.issue.subject,
      concepts: [testCase.issue.subject], requestedOperation: testCase.issue.operation
    }
  };
}
function recordSummary(record) {
  return {
    id: record.id, authority: record.authority, sourceAuthority: record.sourceAuthority, domain: record.domain,
    provenance: record.provenance, sourceStatus: record.sourceStatus, lifecycleState: record.lifecycleState,
    verificationMethod: record.verificationMethod, sourceType: record.sourceType, evidenceTier: record.evidenceTier,
    canonicalSourceUrl: record.canonicalSourceUrl, tags: record.tags, relatedTopicIds: record.relatedTopicIds,
    sourceMapTopicIds: record.sourceMapTopicIds, retrievalHints: record.retrievalHints,
    sourceText: record.sourceText
  };
}

const resultCases = [];
for (const testCase of cases) {
  const requestedConcepts = getRequestedQuestionConcepts(testCase.query, fallbackUnderstanding);
  const context = await buildGroundedReasoningContext(testCase.query, null, defaultAdvancedSourceRetriever, undefined, {
    questionUnderstanding: fallbackUnderstanding,
    evidenceScope: scopeFor(testCase, requestedConcepts),
    localOnly: true,
    referenceDate
  });
  const quality = context.evidenceQuality;
  const rendered = renderIrasEvidenceResponse({}, context, testCase.query, null, 'SFRS_I', 'LOCAL');
  const suggestedClaims = rendered.claimVerification.accepted.map(claim => ({
    kind: 'RULE', text: claim.text, quote: claim.quote, recordId: claim.recordId,
    ...(claim.canonicalUrl ? { citationUrl: claim.canonicalUrl } : {})
  }));
  const targetDate = quality.targetDate || defaultTargetDateResolver.resolveTargetDate(testCase.query, referenceDate).targetDate;
  const secondQuality = evaluateEvidenceQuality({
    query: testCase.query, topicIds: testCase.workstream.topicIds, records: quality.eligibleRecords,
    missingFacts: [], targetDate, referenceDate, authorities: ['IRAS'], requestedConcepts,
    sourceMapFallbackTrace: context.sourceMapFallbackTrace
  });
  const secondLiteralCheck = verifyEvidenceClaims(suggestedClaims, secondQuality.eligibleRecords, {
    missingFacts: [], targetDate
  });
  const issuePlan = { source: 'SEMANTIC_ISSUES', issues: [testCase.issue], coverageEstablished: true, hasUnmappedResidual: false };
  const workstreams = await buildAuthorityWorkstreams(testCase.query, issuePlan, {
    questionUnderstanding: fallbackUnderstanding, referenceDate, localOnly: true,
    providers: { IRAS: {
      authority: 'IRAS',
      async retrieve() { return { candidates: quality.eligibleRecords, claims: suggestedClaims, evidenceQualityTrace: context.sourceMapFallbackTrace }; }
    } }
  });
  const issueResult = workstreams.workstreams.flatMap(row => row.issues).find(row => row.issueId === testCase.issue.id);
  const supportChecks = [];
  for (const claim of secondLiteralCheck.accepted) {
    const record = secondQuality.eligibleRecords.find(item => item.id === claim.recordId);
    const topicChecks = [];
    for (const topicId of testCase.workstream.topicIds) {
      const topic = getCoverageTopicById(topicId);
      const topicBound = Boolean(topic && (topic.sourceRecordIds.includes(record?.id || '') || record?.tags?.includes(topicId) ||
        record?.relatedTopicIds?.includes(topicId) || record?.sourceMapTopicIds?.includes(topicId) || record?.retrievalHints?.includes(topicId)));
      const generalRuleSupport = topic ? supportGeneralIrasRuleConcept({
        sourceText: claim.quote, domainId: topic.domainId,
        topicIds: [...new Set([...testCase.issue.mappedTopicIds, topicId, ...requestedConcepts.flatMap(item => item.topicIds)])],
        subject: testCase.issue.subject, population: testCase.issue.population, concepts: requestedConcepts
      }) : undefined;
      topicChecks.push({ topicId, topicBound, generalRuleSupport });
    }
    supportChecks.push({ recordId: claim.recordId, quote: claim.quote, topicChecks });
  }
  const allCandidateIds = [...new Set([...quality.eligibleRecords.map(record => record.id), ...quality.rejectedRecords.map(item => item.recordId)])];
  resultCases.push({
    caseId: testCase.id, query: testCase.query, syntheticIssueScope: { id: testCase.issue.id, subject: testCase.issue.subject, topicIds: testCase.issue.mappedTopicIds },
    requestedConcepts,
    localOnly: true,
    evidenceQuality: {
      status: quality.status, candidateIds: allCandidateIds,
      eligibleRecords: quality.eligibleRecords.map(recordSummary), rejectedRecords: quality.rejectedRecords,
      coveredTopicIds: quality.coveredTopicIds, uncoveredTopicIds: quality.uncoveredTopicIds,
      coveredConcepts: quality.coveredConcepts, uncoveredConcepts: quality.uncoveredConcepts
    },
    suggestedClaims,
    initialLiteralRejections: rendered.claimVerification.rejected,
    secondPassQuality: {
      status: secondQuality.status, eligibleRecordIds: secondQuality.eligibleRecords.map(record => record.id),
      rejectedRecords: secondQuality.rejectedRecords, coveredTopicIds: secondQuality.coveredTopicIds,
      uncoveredTopicIds: secondQuality.uncoveredTopicIds, uncoveredConcepts: secondQuality.uncoveredConcepts
    },
    secondLiteralAccepted: secondLiteralCheck.accepted.map(claim => ({ recordId: claim.recordId, text: claim.text, quote: claim.quote })),
    secondLiteralRejected: secondLiteralCheck.rejected,
    postfilterSupportDiagnostics: supportChecks,
    finalIssueLifecycle: issueResult?.lifecycle,
    finalVerifiedClaims: issueResult?.verifiedClaims,
    finalSources: issueResult?.sources.map(record => record.id),
    finalGaps: issueResult?.gaps.map(({ code, stage, reason }) => ({ code, stage, reason })),
    finalEvidenceStatus: issueResult?.evidenceStatus,
    finalApplicationStatus: issueResult?.applicationStatus
  });
}

const mixedQuery = 'For someone earning SGD 6,000 a month, what can they claim for personal tax relief on compulsory CPF, and what does the employer have to pay into CPF?';
const cpfRows = await defaultAdvancedSourceRetriever.retrieveSources({
  query: mixedQuery, domain: 'CPF_PAYROLL', authorities: ['CPF'], topicIds: ['cpf_contribution_rates'],
  maxResults: GROUNDING_SOURCE_MAX_RESULTS, referenceDate
});
const cpfRecord = cpfRows.find(record => record.id === 'CPF_RATES_BY_AGE_2026') || UNIFIED_SOURCE_REGISTRY.CPF_RATES_BY_AGE_2026;
const cpfRejectionCode = cpfRecord ? findRecordEligibilityRejection(cpfRecord, undefined, referenceDate) : 'RECORD_NOT_FOUND';
const cpfIssue = {
  id: 'employer-cpf-contribution', subject: 'employer CPF contribution amount', population: 'EMPLOYER', domain: 'CPF_PAYROLL',
  governingAuthorities: ['CPF'], contextualAuthorities: [], operation: 'CALCULATE', mappedTopicIds: ['cpf_contribution_rates'],
  evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS', confidence: 1, status: 'MAPPED'
};
const cpfWorkstreams = await buildAuthorityWorkstreams(mixedQuery,
  { source: 'SEMANTIC_ISSUES', issues: [cpfIssue], coverageEstablished: true, hasUnmappedResidual: false },
  { questionUnderstanding: fallbackUnderstanding, referenceDate, providers: { CPF: {
    authority: 'CPF', async retrieve() { return { candidates: cpfRecord ? [cpfRecord] : [], trace: undefined }; }
  } } }
);
const cpfIssueResult = cpfWorkstreams.workstreams.flatMap(row => row.issues).find(row => row.issueId === cpfIssue.id);
const report = {
  protocol: 'API_FREE_LOCAL_CONTRACT_DIAGNOSTIC',
  profile: 'iras-first-targeted-acceptance-v3',
  referenceDate,
  rawFrozenProviderSubjectsAndClaimsRetained: false,
  note: 'This report reruns only deterministic local evidence functions using fixture query text and frozen route/topic expectations. It does not reconstruct unretained provider subjects. localOnly=true suppresses mapped source/network fallback; no provider, fetch, harness, or consumed artifact is called.',
  cases: resultCases,
  cpfMixedCase: {
    query: mixedQuery, issueId: cpfIssue.id, retrievedCandidateIds: cpfRows.map(record => record.id),
    candidate: cpfRecord ? recordSummary(cpfRecord) : undefined,
    exactEligibilityRejection: cpfRejectionCode,
    finalLifecycle: cpfIssueResult?.lifecycle,
    finalVerifiedClaims: cpfIssueResult?.verifiedClaims,
    finalSources: cpfIssueResult?.sources.map(record => record.id),
    finalGaps: cpfIssueResult?.gaps.map(({ code, stage, reason }) => ({ code, stage, reason })),
    finalEvidenceStatus: cpfIssueResult?.evidenceStatus,
    finalApplicationStatus: cpfIssueResult?.applicationStatus
  }
};
const outputPath = new URL('./contract-audit-diagnostic.json', import.meta.url);
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
