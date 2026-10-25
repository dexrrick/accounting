import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createAuthorityEvidencePresentation, hasCompleteRequestRepresentation, hasCurrentAuthorityEvidencePresentation } from '../../src/utils/authorityEvidencePresentation.ts';
import {
  shouldUseAuthorityEvidenceRuntime,
  shouldUseUnmappedAccountingRuleExplanationRuntime
} from '../../src/utils/authorityEvidenceRouting.ts';
import { createChatPreview } from '../../src/utils/chatPresentation.ts';
import { ComplianceRationale } from '../../src/components/ComplianceRationale.tsx';
import { InputHandlerPanel } from '../../src/components/InputHandlerPanel.tsx';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import { renderAuthorityEvidenceResponseText } from '../../src/services/authorityEvidenceResponse.ts';
import { applyAcraAnnualReturnDeadline, identifyAcraAnnualReturnCompanyFacts, isAcraAnnualReturnApplicationQuestion } from '../../src/engine/acraAnnualReturnApplication.ts';
import { createRequestCompletenessContext, ensureRequestCompletenessContext } from '../../src/services/requestCompleteness.ts';
import { getRequestedQuestionConcepts, reconcileQuestionUnderstanding } from '../../src/services/semanticQuestionUnderstanding.ts';
import { defaultQueryTopicResolver, isBoundedAcraAnnualReturnMissingFactsQuestion } from '../../src/retrieval/queryTopicResolver.ts';
import { getAcraAnnualReturnDeadlineMonths } from '../../src/retrieval/acraAnnualReturnFilingRule.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';

function source({ id, authority, title, validFrom = '2026-01-01', validTo, officialSourceUrl = '', sourceText = 'A complete paragraph from the reviewed source.', domain = authority === 'IRAS' ? 'IRAS_TAX' : 'CPF_PAYROLL' }) {
  return {
    id,
    authority,
    authorityName: authority,
    sourcePublisher: `${authority} publisher`,
    legalOrStandardInstrument: `${authority} guidance`,
    documentTitle: title,
    standardOrActCode: `${authority}-GUIDE`,
    paragraphOrSection: 'Guidance',
    sourceText,
    principleSummary: 'Reviewed local guidance summary.',
    effectiveDate: validFrom,
    revisionDate: validFrom,
    officialSourceUrl,
    domain,
    jurisdiction: 'Singapore',
    tags: [],
    sourceStatus: 'VERIFIED',
    sourceType: 'OFFICIAL_GUIDANCE',
    evidenceTier: 'OFFICIAL_GUIDANCE',
    isVerbatimText: true,
    validFrom,
    ...(validTo ? { validTo } : {}),
    lastVerifiedDate: '2026-09-01',
    provenance: 'LOCAL_STATIC',
    lifecycleState: 'ACTIVE',
    recordRole: 'EVIDENCE',
    groundingEligible: true,
    verificationMethod: 'STATUTORY_LEGISLATION_AUDIT'
  };
}

function syntheticAcraDeadlineSource({ id = 'TEST_ONLY_ACRA_DEADLINE_TABLE', nonListedMonths = 7, validTo } = {}) {
  const officialSourceUrl = UNIFIED_SOURCE_REGISTRY.ACRA_SEC175_197_AGM_ANNUAL_RETURN_TIMELINES.officialSourceUrl;
  const sourceText = [
    'Companies must file an annual return with ACRA.',
    '',
    'Company type | Filing deadline',
    'Listed companies | Within five months after FYE.',
    'Listed companies with share capital and an overseas branch register | Within six months after FYE.',
    `Non-listed companies | Within ${numberAsWord(nonListedMonths)} months after FYE.`,
    'Non-listed companies with share capital and an overseas branch register | Within eight months after FYE.'
  ].join('\n');
  return {
    ...source({
      id, authority: 'ACRA', title: 'Synthetic test-only ACRA annual return table', validFrom: '2020-01-01', validTo,
      sourceText, officialSourceUrl, domain: 'ACRA_CORP'
    }),
    sourcePublisher: 'Accounting and Corporate Regulatory Authority',
    relatedTopicIds: ['acra_annual-returns'],
    tags: ['acra_annual-returns'],
    canonicalSourceUrl: officialSourceUrl,
    urlVerificationStatus: 'VERIFIED'
  };
}

function numberAsWord(value) {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  return words[value] || String(value);
}

function fetchedLikeLiveSource({ id, authority, title, url, domain, urlVerificationStatus = 'VERIFIED', canonicalSourceUrl = url }) {
  return {
    ...source({ id, authority, title, officialSourceUrl: url, domain }),
    sourceStatus: 'NEEDS_REVIEW',
    provenance: 'LIVE_EXTERNAL',
    lifecycleState: 'CANDIDATE',
    recordRole: 'DISCOVERED_EVIDENCE',
    groundingEligible: true,
    urlVerificationStatus,
    canonicalSourceUrl,
    verificationMethod: 'LIVE_OFFICIAL_TOPIC_VERIFIED'
  };
}

function plannedIssue({ id, authority, domain, subject, population = 'COMPANY', status = 'MAPPED', mappedTopicIds = ['test-topic'],
  operation = 'EXPLAIN_RULE', evidenceRequirement = 'AUTHORITATIVE_SOURCE', contextualAuthorities = [] }) {
  return {
    id,
    subject,
    population,
    domain,
    governingAuthorities: [authority],
    contextualAuthorities,
    operation,
    mappedTopicIds,
    evidenceRequirement,
    confidence: 0.96,
    status,
    ...(status === 'UNRESOLVED' ? { unresolvedReason: 'NO_COVERAGE_TOPIC' } : {})
  };
}

function evidenceIssue(plan, supportingSource, claimOverrides = {}) {
  const claim = {
    text: 'The verified rule supports the requested topic.',
    quote: 'A complete paragraph from the reviewed source.',
    recordId: supportingSource.id,
    supportKind: 'EXACT_SOURCE_QUOTE',
    ...claimOverrides
  };
  return {
    issueId: plan.id,
    subject: plan.subject,
    population: plan.population,
    domain: plan.domain,
    operation: plan.operation,
    evidenceRequirement: plan.evidenceRequirement,
    governingAuthority: plan.governingAuthorities[0],
    sourceSections: [],
    lifecycle: { requested: true, mapped: true, retrievalAttempted: true, evidenceFound: true, admitted: true, verified: true, covered: true },
    evidenceStatus: 'VERIFIED',
    applicationStatus: 'NOT_REQUIRED',
    verifiedClaims: [claim],
    sources: [supportingSource],
    gaps: []
  };
}

const irasSource = source({ id: 'iras-source-1', authority: 'IRAS', title: 'IRAS income tax guidance' });
const cpfSource = source({ id: 'cpf-source-1', authority: 'CPF', title: 'CPF contribution guidance' });
const irasPlanA = plannedIssue({ id: 'iras-company-issue', authority: 'IRAS', domain: 'IRAS_INCOME_TAX', subject: 'Company tax deduction', population: 'COMPANY' });
const irasPlanB = plannedIssue({ id: 'iras-employee-issue', authority: 'IRAS', domain: 'IRAS_INCOME_TAX', subject: 'Employee benefit tax treatment', population: 'COMPANY' });
const cpfPlan = plannedIssue({ id: 'cpf-issue', authority: 'CPF', domain: 'CPF_PAYROLL', subject: 'Employer CPF contribution', population: 'EMPLOYER', mappedTopicIds: ['cpf_contribution_rates'] });
const irasIssueA = evidenceIssue(irasPlanA, irasSource);
const irasIssueB = evidenceIssue(irasPlanB, irasSource, {
  text: 'Reviewed local summary of the same source.',
  supportKind: 'REVIEWED_EDITORIAL_SUMMARY'
});
const cpfIssue = evidenceIssue(cpfPlan, cpfSource);

const result = {
  query: 'Company housing benefits, employee tax, and CPF obligations',
  requestCompletenessContext: createRequestCompletenessContext('Company housing benefits, employee tax, and CPF obligations'),
  issuePlan: {
    source: 'SEMANTIC_ISSUES',
    coverageEstablished: true,
    hasUnmappedResidual: false,
    issues: [irasPlanA, irasPlanB, cpfPlan]
  },
  workstreams: [
    {
      id: 'IRAS:IRAS_CORPORATE_TAX', authority: 'IRAS', domain: 'IRAS_CORPORATE_TAX', sourceSections: [], populations: ['COMPANY'],
      issues: [irasIssueA, irasIssueB], evidenceStatus: 'VERIFIED', applicationStatus: 'NOT_REQUIRED',
      verifiedClaims: [...irasIssueA.verifiedClaims, ...irasIssueB.verifiedClaims], sources: [irasSource], gaps: []
    },
    {
      id: 'CPF:CPF_PAYROLL', authority: 'CPF', domain: 'CPF_PAYROLL', sourceSections: [], populations: ['EMPLOYER'],
      issues: [cpfIssue], evidenceStatus: 'VERIFIED', applicationStatus: 'NOT_REQUIRED',
      verifiedClaims: cpfIssue.verifiedClaims, sources: [cpfSource], gaps: []
    }
  ],
  evidenceStatus: 'VERIFIED',
  applicationStatus: 'NOT_REQUIRED',
  status: 'VERIFIED',
  gaps: []
};

const presentation = createAuthorityEvidencePresentation(result);
assert.equal(presentation.status, 'CONDITIONAL',
  'Mapped evidence cannot confirm whole-question acceptance while the exact-query representation is uncertain.');
assert.equal(presentation.evidenceStatus, 'VERIFIED', 'Evidence status remains separate from request completeness.');
assert.equal(presentation.workstreams.length, 2);
assert.equal(presentation.workstreams[0].issues[0].population, 'Company');
assert.equal(presentation.workstreams[1].issues[0].population, 'Employer');
assert.equal(presentation.workstreams[0].sources.length, 1, 'same source is grouped once within a workstream');
assert.equal(presentation.workstreams[0].sources[0].claims.length, 2, 'distinct exact and reviewed claims remain visible');
assert.deepEqual(presentation.workstreams[0].sources[0].claims[0].issueIds, ['iras-company-issue']);
assert.equal(presentation.workstreams[0].sources[0].claims[1].supportKind, 'REVIEWED_EDITORIAL_SUMMARY');
assert.equal(presentation.workstreams[0].sources[0].validFrom, '2026-01-01');
assert.ok(hasCurrentAuthorityEvidencePresentation(presentation, result.query));
assert.equal(hasCompleteRequestRepresentation(presentation), false);
assert.equal(hasCurrentAuthorityEvidencePresentation(presentation, ` ${result.query} `), false,
  'diagnostic presentations are bound to the exact raw query');
assert.equal(hasCurrentAuthorityEvidencePresentation(presentation, 'A different follow-up'), false);
assert.equal(hasCurrentAuthorityEvidencePresentation({ ...presentation, status: 'VERIFIED' }, result.query), false,
  'a spread copy cannot inherit presentation authenticity');

const completeCpfQuery = 'How much CPF must the employer contribute?';
const completeCpfContext = ensureRequestCompletenessContext(completeCpfQuery, undefined, {
  mode: 'SEMANTIC_INTERPRETATION',
  interpretation: {
    schemaVersion: 2, jurisdiction: ['Singapore'], authorityCandidates: ['CPF'], contextualAuthorities: [],
    domain: 'CPF_PAYROLL', population: 'EMPLOYER', primarySubject: 'employer CPF contribution amount', concepts: [],
    requestedOperation: 'CALCULATE', factsExplicitlyProvided: [], confidence: 0.96,
    issues: [{ subject: 'employer CPF contribution amount', population: 'EMPLOYER', domain: 'CPF_PAYROLL',
      governingAuthorities: ['CPF'], contextualAuthorities: [], operation: 'CALCULATE', mappedTopicIds: [],
      evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 0.96 }]
  }
});
assert.equal(completeCpfContext.evaluation.status, 'COMPLETE');
const completeButInsufficientResult = structuredClone(result);
completeButInsufficientResult.query = completeCpfQuery;
completeButInsufficientResult.requestCompletenessContext = completeCpfContext;
completeButInsufficientResult.status = 'INSUFFICIENT';
completeButInsufficientResult.evidenceStatus = 'INSUFFICIENT';
completeButInsufficientResult.workstreams[0].evidenceStatus = 'INSUFFICIENT';
completeButInsufficientResult.workstreams[0].issues[0].evidenceStatus = 'INSUFFICIENT';
completeButInsufficientResult.workstreams[0].issues[0].lifecycle.covered = false;
const completeButInsufficientPresentation = createAuthorityEvidencePresentation(completeButInsufficientResult);
assert.equal(completeButInsufficientPresentation.requestCompletenessContext.evaluation.status, 'COMPLETE');
assert.equal(completeButInsufficientPresentation.status, 'INSUFFICIENT',
  'complete request representation never promotes insufficient evidence');
const completeAndVerifiedResult = {
  ...result,
  query: completeCpfQuery,
  requestCompletenessContext: completeCpfContext,
  issuePlan: { ...result.issuePlan, issues: [cpfPlan] },
  workstreams: [result.workstreams[1]]
};
const completeAndVerifiedPresentation = createAuthorityEvidencePresentation(completeAndVerifiedResult);
assert.equal(completeAndVerifiedPresentation.status, 'VERIFIED',
  'Only complete exact-query representation with verified evidence receives whole-question verified status.');
assert.equal(hasCompleteRequestRepresentation(completeAndVerifiedPresentation), true);
const missingCompletenessPresentation = createAuthorityEvidencePresentation({ ...result, requestCompletenessContext: undefined });
assert.equal(missingCompletenessPresentation.status, 'CONDITIONAL',
  'Missing request completeness evidence cannot yield whole-question VERIFIED status.');
const incorrectCpfOperationObservation = structuredClone(completeCpfContext.observationSnapshot.normalizedInterpretation);
incorrectCpfOperationObservation.requestedOperation = 'EXPLAIN_RULE';
incorrectCpfOperationObservation.issues[0].operation = 'EXPLAIN_RULE';
const incompleteCpfContext = ensureRequestCompletenessContext(completeCpfQuery, undefined, {
  mode: 'SEMANTIC_INTERPRETATION', interpretation: incorrectCpfOperationObservation
});
assert.equal(incompleteCpfContext.evaluation.status, 'INCOMPLETE');
const incompleteRepresentationPresentation = createAuthorityEvidencePresentation({
  ...completeAndVerifiedResult, requestCompletenessContext: incompleteCpfContext
});
assert.equal(incompleteRepresentationPresentation.status, 'CONDITIONAL',
  'An explicit operation mismatch leaves verified mapped evidence conditional.');
const staleCompletenessPresentation = createAuthorityEvidencePresentation({
  ...result, requestCompletenessContext: completeCpfContext
});
assert.equal(staleCompletenessPresentation.status, 'CONDITIONAL',
  'A complete evaluation for another query cannot confirm this request.');
const forgedAggregate = createAuthorityEvidencePresentation({
  ...result, requestCompletenessContext: { ...result.requestCompletenessContext, identity: 'forged' }
});
assert.equal(forgedAggregate.requestCompletenessContext, undefined,
  'aggregate presentation rejects caller-built diagnostic contexts');

const panel = renderToStaticMarkup(React.createElement(ComplianceRationale, {
  citations: [], standard: 'SFRS_I', rawQuery: result.query, authorityEvidencePresentation: presentation
}));
assert.match(panel, /Statutory Compliance &amp; Legal Authority/);
assert.match(panel, /Employer CPF contribution/);
assert.match(panel, /Reviewed local summary/);
assert.match(panel, /01\/01\/2026/);
assert.match(panel, /Supports: Company tax deduction/);
assert.match(panel, /Evidence verified for mapped issues; full request coverage unconfirmed/,
  'The compliance panel makes uncertain whole-request coverage explicit.');
assert.match(renderAuthorityEvidenceResponseText(presentation, false), /full request coverage unconfirmed/,
  'Text responses preserve the same distinction between evidence and request coverage.');

// These fetched-like fixtures exercise the real projection and panel link gate.
// They validate presentation behavior only; they are not production acceptance evidence.
for (const authority of ['ACRA', 'CPF', 'MOM', 'MAS']) {
  const officialUrl = {
    ACRA: 'https://www.acra.gov.sg/',
    CPF: 'https://www.cpf.gov.sg/',
    MOM: 'https://www.mom.gov.sg/',
    MAS: 'https://www.mas.gov.sg/'
  }[authority];
  const authorityDomain = {
    ACRA: 'ACRA_CORPORATE', CPF: 'CPF_PAYROLL', MOM: 'MOM_EMPLOYMENT', MAS: 'MAS_FUNDS'
  }[authority];
  const liveEvidence = fetchedLikeLiveSource({
    id: `${authority.toLowerCase()}-live-candidate`, authority,
    title: `${authority} fetched-like candidate`, url: officialUrl,
    domain: { ACRA: 'ACRA_CORP', CPF: 'CPF_BOARD', MOM: 'MOM_EMPLOYMENT', MAS: 'MAS_FUNDS' }[authority]
  });
  const livePlan = plannedIssue({
    id: `${authority.toLowerCase()}-live-issue`, authority, domain: authorityDomain,
    subject: `${authority} live evidence topic`, population: 'COMPANY'
  });
  const liveIssue = evidenceIssue(livePlan, liveEvidence);
  const liveQuery = `What does ${authority} require?`;
  const liveAuthorityResult = {
    query: liveQuery,
    requestCompletenessContext: createRequestCompletenessContext(liveQuery),
    issuePlan: { source: 'SEMANTIC_ISSUES', coverageEstablished: true, hasUnmappedResidual: false, issues: [livePlan] },
    workstreams: [{
      id: `${authority}:${authorityDomain}`, authority, domain: authorityDomain,
      sourceSections: [], populations: ['COMPANY'],
      issues: [liveIssue], evidenceStatus: 'VERIFIED', applicationStatus: 'NOT_REQUIRED',
      verifiedClaims: liveIssue.verifiedClaims, sources: [liveEvidence], gaps: []
    }],
    evidenceStatus: 'VERIFIED', applicationStatus: 'NOT_REQUIRED', status: 'VERIFIED', gaps: []
  };
  const liveResult = createAuthorityEvidencePresentation(liveAuthorityResult);
  const livePanel = renderToStaticMarkup(React.createElement(ComplianceRationale, {
    citations: [], standard: 'SFRS_I', rawQuery: liveQuery, authorityEvidencePresentation: liveResult
  }));
  assert.match(livePanel, new RegExp(officialUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `${authority} verified live URL is shown exactly`);
  assert.match(livePanel, /Evidence verified for mapped issues; full request coverage unconfirmed/);

  const conditionalIssue = { ...liveIssue, applicationStatus: 'UNRESOLVED', applicationReason: 'The relevant application facts are unresolved.' };
  const conditionalPresentation = createAuthorityEvidencePresentation({
    ...liveAuthorityResult,
    status: 'CONDITIONAL', applicationStatus: 'UNRESOLVED',
    workstreams: [{ ...liveAuthorityResult.workstreams[0], applicationStatus: 'UNRESOLVED', issues: [conditionalIssue] }]
  });
  const conditionalPanel = renderToStaticMarkup(React.createElement(ComplianceRationale, {
    citations: [], standard: 'SFRS_I', rawQuery: liveQuery, authorityEvidencePresentation: conditionalPresentation
  }));
  assert.equal(conditionalPresentation.status, 'CONDITIONAL');
  assert.match(conditionalPanel, /full request coverage unconfirmed; application unresolved/);

  const unresolvedGap = plannedIssue({
    id: `${authority.toLowerCase()}-unresolved-residual`, authority: 'UNKNOWN', domain: 'UNKNOWN',
    subject: `${authority} unresolved requested issue`, status: 'UNRESOLVED', mappedTopicIds: []
  });
  const insufficientPresentation = createAuthorityEvidencePresentation({
    ...liveAuthorityResult,
    status: 'INSUFFICIENT', evidenceStatus: 'INSUFFICIENT',
    issuePlan: { ...liveAuthorityResult.issuePlan, coverageEstablished: false, hasUnmappedResidual: true,
      issues: [livePlan, unresolvedGap] },
    gaps: [{ subject: unresolvedGap.subject, reason: 'The requested scope could not be mapped to reviewed coverage.' }]
  });
  const insufficientPanel = renderToStaticMarkup(React.createElement(ComplianceRationale, {
    citations: [], standard: 'SFRS_I', rawQuery: liveQuery, authorityEvidencePresentation: insufficientPresentation
  }));
  assert.equal(insufficientPresentation.status, 'INSUFFICIENT');
  assert.match(insufficientPanel, /Evidence incomplete/);
  assert.match(insufficientPanel, /Whole-question gaps/);
  assert.match(insufficientPanel, new RegExp(`${authority} unresolved requested issue`));

  const mutatedEvidence = { ...liveEvidence, officialSourceUrl: `${officialUrl}mutated` };
  const mutatedPresentation = createAuthorityEvidencePresentation({
    ...liveAuthorityResult,
    workstreams: [{ ...liveAuthorityResult.workstreams[0], issues: [evidenceIssue(livePlan, mutatedEvidence)],
      verifiedClaims: evidenceIssue(livePlan, mutatedEvidence).verifiedClaims, sources: [mutatedEvidence] }]
  });
  const mutatedPanel = renderToStaticMarkup(React.createElement(ComplianceRationale, {
    citations: [], standard: 'SFRS_I', rawQuery: liveQuery, authorityEvidencePresentation: mutatedPresentation
  }));
  assert.doesNotMatch(mutatedPanel, new RegExp(`${officialUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}mutated`),
    `${authority} mutated URL does not appear as a trusted link`);

  const unverifiedEvidence = { ...liveEvidence, urlVerificationStatus: 'CANDIDATE' };
  const unverifiedPresentation = createAuthorityEvidencePresentation({
    ...liveAuthorityResult,
    workstreams: [{ ...liveAuthorityResult.workstreams[0], issues: [evidenceIssue(livePlan, unverifiedEvidence)],
      verifiedClaims: evidenceIssue(livePlan, unverifiedEvidence).verifiedClaims, sources: [unverifiedEvidence] }]
  });
  const unverifiedPanel = renderToStaticMarkup(React.createElement(ComplianceRationale, {
    citations: [], standard: 'SFRS_I', rawQuery: liveQuery, authorityEvidencePresentation: unverifiedPresentation
  }));
  assert.doesNotMatch(unverifiedPanel, new RegExp(officialUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `${authority} unverified URL marker prevents the link from being shown`);
}

const insufficientResult = structuredClone(result);
insufficientResult.status = 'CONDITIONAL';
insufficientResult.evidenceStatus = 'INSUFFICIENT';
insufficientResult.applicationStatus = 'NOT_REQUIRED';
insufficientResult.workstreams[0].issues[0].evidenceStatus = 'INSUFFICIENT';
insufficientResult.workstreams[0].issues[0].lifecycle.covered = false;
insufficientResult.workstreams[0].evidenceStatus = 'INSUFFICIENT';
const insufficient = createAuthorityEvidencePresentation(insufficientResult);
assert.equal(insufficient.status, 'INSUFFICIENT', 'an evidence gap takes precedence over application status');
assert.equal(insufficient.applicationStatus, 'NOT_REQUIRED', 'evidence coverage and case application remain separate');
assert.equal(insufficient.workstreams[0].applicationStatus, 'NOT_REQUIRED');

const omittedIssueResult = structuredClone(result);
omittedIssueResult.workstreams[1].issues = [];
omittedIssueResult.workstreams[1].evidenceStatus = 'INSUFFICIENT';
assert.equal(createAuthorityEvidencePresentation(omittedIssueResult).status, 'INSUFFICIENT', 'an omitted planned issue cannot inherit another stream’s verified state');

const contaminatedResult = structuredClone(result);
contaminatedResult.workstreams[1].issues[0].sources = [irasSource];
assert.equal(createAuthorityEvidencePresentation(contaminatedResult).status, 'INSUFFICIENT', 'a claim from another authority cannot cover the issue');

const unresolvedPlanResult = structuredClone(result);
unresolvedPlanResult.issuePlan.issues.push(plannedIssue({
  id: 'unresolved-plan-issue', authority: 'IRAS', domain: 'IRAS_OTHER',
  subject: 'Unresolved requested issue', status: 'UNRESOLVED', mappedTopicIds: []
}));
const unresolvedPlanPresentation = createAuthorityEvidencePresentation(unresolvedPlanResult);
assert.ok(unresolvedPlanPresentation.gaps.some(gap => /No reviewed topic was resolved for this issue/.test(gap)));
assert.doesNotMatch(unresolvedPlanPresentation.gaps.join(' '), /NO_COVERAGE_TOPIC|UNKNOWN_DOMAIN|UNASSIGNED_QUERY_TOPIC/);

const staleScenario = {
  scenarioType: 'STATUTORY_ADVISORY', rawQuery: 'What IRAS relief applies?', transactionTitle: 'Tax question',
  functionalCurrency: 'SGD', transactionCurrency: 'SGD', directGroups: [], primaryDomain: 'IRAS_TAX',
  queryIntent: 'STATUTORY_ADVISORY', authorityEvidencePresentation: presentation
};
const stalePanel = renderToStaticMarkup(React.createElement(ComplianceRationale, {
  citations: [], standard: 'SFRS_I', rawQuery: staleScenario.rawQuery,
  authorityEvidencePresentation: presentation, primaryDomain: staleScenario.primaryDomain,
  queryIntent: staleScenario.queryIntent
}));
assert.doesNotMatch(stalePanel, /Employer CPF contribution/);
const staleFacts = renderToStaticMarkup(React.createElement(InputHandlerPanel, {
  scenario: staleScenario, onResetToDefaults: () => {}
}));
assert.doesNotMatch(staleFacts, /Employment requirements \+ CPF contributions/);

const irasOnlyPresentation = {
  query: 'What IRAS relief applies?', domainLabel: 'IRAS Income Tax', status: 'VERIFIED',
  chatAnswer: 'Legacy IRAS response', overview: '', applicationStatus: 'Verified', sourceGroups: []
};
const currentSingleIrasScenario = { ...staleScenario, rawQuery: irasOnlyPresentation.query, irasEvidencePresentation: irasOnlyPresentation };
const legacyPreview = createChatPreview('Legacy answer body', currentSingleIrasScenario);
assert.match(legacyPreview, /complete admitted IRAS passages/);
assert.equal(createChatPreview('Legacy answer body', { ...currentSingleIrasScenario, authorityEvidencePresentation: undefined }), legacyPreview,
  'single-IRAS preview remains on the legacy path');

const freshScenario = { ...staleScenario, rawQuery: presentation.query, authorityEvidencePresentation: presentation };
assert.match(createChatPreview('legacy unsupported statutory prose', freshScenario), /Evidence verified for mapped issues; full request coverage unconfirmed/);
const balancedScenario = {
  ...freshScenario, queryIntent: 'HYBRID', scenarioType: 'EXPENSE',
  directGroups: [{ title: 'Operating expense', totalDebit: 120, totalCredit: 120, isBalanced: true, lines: [{}] }]
};
const balancedPreview = createChatPreview('legacy unsupported statutory prose', balancedScenario);
assert.match(balancedPreview, /balanced operating expense journal/i);
assert.match(balancedPreview, /evidence review/i);

function classification(overrides = {}) {
  return {
    primaryDomain: 'MIXED', domains: [], authorities: [], multiAuthority: true,
    currentInformationRequired: false, accountingAnalysisRequired: false, taxAnalysisRequired: true,
    regulatoryAnalysisRequired: true, calculationRequired: false, journalEntryRequired: false,
    missingFacts: [], intent: 'STATUTORY_ADVISORY', reasoning: '', ...overrides
  };
}

const semanticIssues = (issues, overrides = {}) => ({
  source: 'SEMANTIC_ISSUES', issues, coverageEstablished: true, hasUnmappedResidual: false, ...overrides
});
const standaloneStatutoryCases = [
  { authority: 'ACRA', domain: 'ACRA_CORPORATE', sourceSection: 'ACRA_COMPANIES', topicId: 'acra_record_retention' },
  { authority: 'CPF', domain: 'CPF_PAYROLL', sourceSection: 'CPF_CONTRIBUTIONS', topicId: 'cpf_contribution_rates' },
  { authority: 'MOM', domain: 'MOM_EMPLOYMENT', sourceSection: 'MOM_EMPLOYMENT', topicId: 'mom-employment-act-coverage' },
  { authority: 'MAS', domain: 'MAS_FUNDS', sourceSection: 'MAS_FUND_MANAGEMENT', topicId: 'mas-cms-licence' }
];
for (const item of standaloneStatutoryCases) {
  const issue = plannedIssue({
    id: `standalone-${item.authority.toLowerCase()}`, authority: item.authority, domain: item.domain,
    subject: `${item.authority} statutory requirements`, mappedTopicIds: [item.topicId]
  });
  const routeClassification = classification({
    authorities: [item.authority], domains: [item.sourceSection], intent: 'STATUTORY_ADVISORY',
    regulatoryAnalysisRequired: true, accountingAnalysisRequired: false, journalEntryRequired: false
  });
  assert.equal(shouldUseAuthorityEvidenceRuntime({
    issuePlan: semanticIssues([issue]), classification: routeClassification,
    explicitIrasEvidenceRequest: false, hasImages: false
  }), true, `mapped, classifier-confirmed ${item.authority} advisory uses the evidence runtime`);
}

const standaloneCpfPlan = plannedIssue({
  id: 'standalone-cpf', authority: 'CPF', domain: 'CPF_PAYROLL', subject: 'Employer CPF contribution',
  population: 'EMPLOYER', mappedTopicIds: ['cpf_contribution_rates']
});
const standaloneCpfClassification = classification({
  authorities: ['CPF'], domains: ['CPF_CONTRIBUTIONS'], intent: 'STATUTORY_ADVISORY',
  regulatoryAnalysisRequired: true, accountingAnalysisRequired: false, journalEntryRequired: false
});
const standaloneRoute = (plan = semanticIssues([standaloneCpfPlan]), routeClass = standaloneCpfClassification, extra = {}) =>
  shouldUseAuthorityEvidenceRuntime({ issuePlan: plan, classification: routeClass,
    explicitIrasEvidenceRequest: false, hasImages: false, ...extra });
assert.equal(standaloneRoute(semanticIssues([standaloneCpfPlan]), classification({
  authorities: ['MOM'], domains: ['CPF_CONTRIBUTIONS']
})), false, 'a mapped topic cannot overcome a mismatched classifier authority');
assert.equal(standaloneRoute(semanticIssues([standaloneCpfPlan]), classification({
  authorities: ['CPF'], domains: ['MOM_EMPLOYMENT']
})), false, 'a matching authority cannot overcome a mismatched classifier domain');
const contextualOnlyCpf = plannedIssue({
  id: 'contextual-only-cpf', authority: 'UNKNOWN', domain: 'CPF_PAYROLL', subject: 'CPF contextual reference',
  mappedTopicIds: ['cpf_contribution_rates']
});
contextualOnlyCpf.contextualAuthorities = ['CPF'];
assert.equal(standaloneRoute(semanticIssues([contextualOnlyCpf])), false,
  'contextual CPF metadata does not create a governed workstream');
const unknownOnlyIssue = plannedIssue({
  id: 'standalone-unknown', authority: 'UNKNOWN', domain: 'UNKNOWN', subject: 'Unknown authority issue', status: 'UNRESOLVED', mappedTopicIds: []
});
assert.equal(standaloneRoute(semanticIssues([unknownOnlyIssue]), classification({ authorities: ['CPF'], domains: ['CPF_CONTRIBUTIONS'] })), false,
  'an unknown issue alone cannot be routed from classifier metadata');
assert.equal(standaloneRoute(semanticIssues([plannedIssue({
  id: 'iras-standalone', authority: 'IRAS', domain: 'IRAS_INCOME_TAX', subject: 'Individual income tax', mappedTopicIds: ['iras-individual-tax-relief']
})]), classification({ authorities: ['IRAS'], domains: ['IRAS_INDIVIDUAL_TAX'] })), false,
  'standalone IRAS remains on its specialist route');
assert.equal(standaloneRoute(semanticIssues([plannedIssue({
  id: 'asc-accounting', authority: 'ACCOUNTING_STANDARDS', domain: 'ACCOUNTING', subject: 'SFRS(I) accounting treatment', mappedTopicIds: ['sfrsi_leases']
})]), classification({ authorities: ['ASC'], domains: ['ACCOUNTING_SFRS'], accountingAnalysisRequired: true })), false,
  'accounting standards stay outside the non-IRAS statutory advisory route');
assert.equal(standaloneRoute(semanticIssues([plannedIssue({
  id: 'acra-routed-accounting', authority: 'ACRA', domain: 'ACCOUNTING', subject: 'SFRS(I) accounting treatment', mappedTopicIds: ['sfrsi_leases']
})]), classification({
  authorities: ['ACRA'], domains: ['ACCOUNTING_SFRS'], intent: 'STATUTORY_ADVISORY',
  regulatoryAnalysisRequired: true, accountingAnalysisRequired: false
})), false, 'ACRA routing metadata for an accounting standard cannot enter the statutory advisory path');
assert.equal(standaloneRoute(semanticIssues([standaloneCpfPlan]), standaloneCpfClassification, { hasImages: true }), false,
  'image requests remain on the extraction path');
assert.equal(standaloneRoute(semanticIssues([standaloneCpfPlan]), classification({
  authorities: ['CPF'], domains: ['CPF_CONTRIBUTIONS'], intent: 'TRANSACTION', journalEntryRequired: true
})), false, 'ordinary payroll journal requests stay on the accounting path');
assert.equal(standaloneRoute(semanticIssues([standaloneCpfPlan]), classification({
  authorities: ['CPF'], domains: ['CPF_CONTRIBUTIONS'], intent: 'HYBRID'
})), false, 'hybrid statutory/accounting requests stay on the established path');
assert.equal(standaloneRoute(semanticIssues([standaloneCpfPlan]), classification({
  authorities: ['CPF'], domains: ['CPF_CONTRIBUTIONS'], regulatoryAnalysisRequired: false
})), false, 'a mapped scope without a regulatory analysis request stays on the established path');
const focusedMasPlan = plannedIssue({
  id: 'focused-mas', authority: 'MAS', domain: 'MAS_FUNDS', subject: 'MAS licensing admission criteria',
  mappedTopicIds: ['mas-fund-management-licensing-admission-criteria', 'mas-vcc-substantive-fund-management-activity']
});
assert.equal(shouldUseAuthorityEvidenceRuntime({
  issuePlan: semanticIssues([focusedMasPlan]),
  classification: classification({ authorities: ['MAS'], domains: ['MAS_FUND_MANAGEMENT'] }),
  explicitIrasEvidenceRequest: false, hasImages: false
}), true, 'the existing focused two-document MAS route remains enabled');
const unresolvedCpfResidual = plannedIssue({
  id: 'standalone-unknown-residual', authority: 'UNKNOWN', domain: 'UNKNOWN', subject: 'Unmapped material CPF issue', status: 'UNRESOLVED', mappedTopicIds: []
});
assert.equal(shouldUseAuthorityEvidenceRuntime({
  issuePlan: semanticIssues([standaloneCpfPlan, unresolvedCpfResidual]),
  classification: standaloneCpfClassification,
  explicitIrasEvidenceRequest: false, hasImages: false
}), true, 'a mapped statutory issue still uses the whole-question runtime when an unresolved residual exists');
const cIssue = plannedIssue({ id: 'company-deduction', authority: 'IRAS', domain: 'IRAS_INCOME_TAX', subject: 'Company deduction', population: 'COMPANY', status: 'UNRESOLVED', mappedTopicIds: [] });
const dIssue = plannedIssue({ id: 'employee-benefit', authority: 'IRAS', domain: 'IRAS_INCOME_TAX', subject: 'Employee benefit tax', population: 'EMPLOYEE', status: 'UNRESOLVED', mappedTopicIds: [] });
assert.equal(shouldUseAuthorityEvidenceRuntime({
  issuePlan: semanticIssues([cIssue, dIssue]), classification: classification({ authorities: ['IRAS'] }),
  explicitIrasEvidenceRequest: false, hasImages: false
}), true, 'known but unmapped C/D material scopes still use whole-question review');

const knownPlusUnknown = plannedIssue({ id: 'unknown-residual', authority: 'UNKNOWN', domain: 'UNKNOWN', subject: 'Unmapped material issue', status: 'UNRESOLVED', mappedTopicIds: [] });
assert.equal(shouldUseAuthorityEvidenceRuntime({
  issuePlan: semanticIssues([cIssue, knownPlusUnknown], { hasUnmappedResidual: true }),
  classification: classification({ authorities: ['IRAS'] }), explicitIrasEvidenceRequest: false, hasImages: false
}), true, 'a known scope plus unsupported material issue cannot drop residual coverage');

const sameAreaMappedIssues = [
  plannedIssue({ id: 'relief-one', authority: 'IRAS', domain: 'IRAS_INCOME_TAX', subject: 'Relief one', population: 'INDIVIDUAL' }),
  plannedIssue({ id: 'relief-two', authority: 'IRAS', domain: 'IRAS_INCOME_TAX', subject: 'Relief two', population: 'INDIVIDUAL' })
];
assert.equal(shouldUseAuthorityEvidenceRuntime({
  issuePlan: semanticIssues(sameAreaMappedIssues), classification: classification({ authorities: ['IRAS'] }),
  explicitIrasEvidenceRequest: true, hasImages: false
}), false, 'same-area IRAS relief questions preserve legacy behavior');

const fallbackJournalPlan = {
  source: 'TAXONOMY_FALLBACK', coverageEstablished: true, hasUnmappedResidual: false,
  issues: [
    plannedIssue({ id: 'accounting', authority: 'ACCOUNTING_STANDARDS', domain: 'ACCOUNTING', subject: 'Journal treatment', mappedTopicIds: ['sfrsi_leases'] }),
    plannedIssue({ id: 'stipulated-gst', authority: 'IRAS', domain: 'IRAS_GST', subject: 'Stipulated GST amount', mappedTopicIds: ['gst_compulsory_registration'] })
  ]
};
assert.equal(shouldUseAuthorityEvidenceRuntime({
  issuePlan: fallbackJournalPlan,
  classification: classification({ intent: 'TRANSACTION', authorities: ['ACRA', 'IRAS'], domains: ['ACCOUNTING_SFRS', 'IRAS_GST'], journalEntryRequired: true }),
  explicitIrasEvidenceRequest: false, hasImages: false
}), false, 'taxonomy fallback for an ordinary journal with stated GST does not reroute');
assert.equal(shouldUseAuthorityEvidenceRuntime({
  issuePlan: fallbackJournalPlan,
  classification: classification({ intent: 'HYBRID', authorities: ['ACRA', 'IRAS'], domains: ['ACCOUNTING_SFRS', 'IRAS_GST'] }),
  explicitIrasEvidenceRequest: true, hasImages: false
}), true, 'explicit tax rule questions with classifier-confirmed multi-domains can use the generic path');

const knownCpfWithResidual = {
  source: 'TAXONOMY_FALLBACK', coverageEstablished: false, hasUnmappedResidual: true,
  issues: [cpfPlan]
};
const cpfStatutoryClassification = classification({
  primaryDomain: 'PAYROLL', domains: ['CPF_CONTRIBUTIONS'], authorities: ['CPF'],
  intent: 'STATUTORY_ADVISORY', regulatoryAnalysisRequired: true, taxAnalysisRequired: false
});
assert.equal(shouldUseAuthorityEvidenceRuntime({
  issuePlan: knownCpfWithResidual, classification: cpfStatutoryClassification,
  explicitIrasEvidenceRequest: true, hasImages: false
}), true, 'a known CPF scope plus unresolved explicit tax-request residual is shown as incomplete without inventing another authority');
assert.equal(shouldUseAuthorityEvidenceRuntime({
  issuePlan: knownCpfWithResidual, classification: cpfStatutoryClassification,
  explicitIrasEvidenceRequest: false, hasImages: false
}), true, 'a mapped CPF advisory keeps its unresolved whole-question residual visible');

const contextualCpfPlan = {
  source: 'TAXONOMY_FALLBACK', coverageEstablished: true, hasUnmappedResidual: false,
  issues: [sameAreaMappedIssues[0], plannedIssue({ id: 'contextual-cpf', authority: 'CPF', domain: 'CPF_PAYROLL', subject: 'CPF relief context', mappedTopicIds: ['cpf_contribution_rates'] })]
};
assert.equal(shouldUseAuthorityEvidenceRuntime({
  issuePlan: contextualCpfPlan,
  classification: classification({ authorities: ['IRAS'], domains: ['IRAS_INDIVIDUAL_TAX'] }),
  explicitIrasEvidenceRequest: true, hasImages: false
}), false, 'contextual CPF metadata alone does not create a second workstream');

assert.equal(shouldUseAuthorityEvidenceRuntime({
  issuePlan: semanticIssues([cIssue, dIssue]), classification: classification({ authorities: ['IRAS'] }),
  explicitIrasEvidenceRequest: false, hasImages: true
}), false, 'image requests remain on the established extraction path');

const promptA = "An employee earns SGD 6,000 per month. What CPF contributions must the employer and employee make, and how do the employee's compulsory CPF contributions affect personal income tax relief?";
const semanticA = {
  jurisdiction: ['Singapore'], authorityCandidates: ['CPF', 'IRAS'], contextualAuthorities: ['CPF'],
  domain: 'CPF_PAYROLL', population: 'EMPLOYER', primarySubject: 'CPF contribution obligations',
  concepts: [{ concept: 'CPF contribution rates', role: 'PRIMARY' }, { concept: 'personal income tax relief', role: 'RELATED' }],
  requestedOperation: 'CALCULATE', requiresUserSpecificFacts: true, calculationRequested: true,
  factsExplicitlyProvided: ['SGD 6,000 monthly salary'], confidence: 0.96,
  issues: [
    { subject: 'employer CPF contribution obligations', population: 'EMPLOYER', domain: 'CPF_PAYROLL', governingAuthorities: ['CPF'], contextualAuthorities: [], operation: 'CALCULATE', mappedTopicIds: ['cpf_contribution_rates'], evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS', confidence: 0.96 },
    { subject: 'employee CPF contribution obligations', population: 'EMPLOYEE', domain: 'CPF_PAYROLL', governingAuthorities: ['CPF'], contextualAuthorities: [], operation: 'CALCULATE', mappedTopicIds: ['cpf_contribution_rates'], evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS', confidence: 0.96 },
    { subject: 'employee personal income tax relief for compulsory CPF contributions', population: 'INDIVIDUAL', domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'], contextualAuthorities: ['CPF'], operation: 'DETERMINE_TREATMENT', mappedTopicIds: ['iras-individual-cpf-relief'], evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS', confidence: 0.96 }
  ]
};
const originalFetch = globalThis.fetch;
const fetchHosts = [];
let semanticInterpretationCalls = 0;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  fetchHosts.push(url.hostname);
  if (url.hostname === 'generativelanguage.googleapis.com') {
    const payload = JSON.parse(init?.body || '{}');
    const prompt = payload.contents?.flatMap(item => item.parts || []).map(part => part.text || '').join('\n') || '';
    if (prompt.includes('Return a V2 JSON object')) semanticInterpretationCalls++;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(semanticA) }] } }] }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  }
  throw new Error(`Blocked network request in offline regression: ${url.hostname}`);
};
let runtimeA;
let runtimeAuthorityResult;
try {
  runtimeA = await processAccountingQuery(promptA, null, 'SFRS_I', 'test-key-1234567890', undefined, [], undefined, {
    onAuthorityWorkstreams: result => { runtimeAuthorityResult = result; }
  });
} finally {
  globalThis.fetch = originalFetch;
}
assert.ok(runtimeA.scenarioState.authorityEvidencePresentation, 'validated semantic multi-issues use the whole-question runtime');
assert.equal(semanticInterpretationCalls, 1, 'the main authority route performs exactly one semantic interpretation');
assert.equal(runtimeA.scenarioState.requestCompletenessContext.rawQuery, promptA,
  'the whole-question response carries diagnostics bound to the exact original query');
assert.equal(runtimeA.scenarioState.authorityEvidencePresentation.requestCompletenessContext.rawQuery, promptA);
assert.equal(runtimeA.scenarioState.scenarioType, 'AUTHORITY_ADVISORY', 'classifier payroll inference does not create a journal absent an accounting issue');
assert.deepEqual(runtimeA.scenarioState.directGroups, [], 'no unsupported payroll journal is generated');
assert.doesNotMatch(runtimeA.messageText, /double entry journal|calculated CPF amount/i);
assert.ok(fetchHosts.includes('www.iras.gov.sg'), `mapped IRAS retrieval was attempted through the network mock: ${JSON.stringify(fetchHosts)}`);
const mappedIrasAttempt = runtimeAuthorityResult?.workstreams
  .filter(workstream => workstream.authority === 'IRAS')
  .flatMap(workstream => workstream.issues.flatMap(issue => issue.retrievalTrace?.attempts || []))
  .find(attempt => attempt.topicId.startsWith('iras-'));
assert.ok(mappedIrasAttempt, `runtime diagnostics retain the scoped mapped IRAS attempt: ${JSON.stringify(runtimeAuthorityResult?.workstreams.map(workstream => workstream.issues.map(issue => issue.retrievalTrace)))}`);

const promptB = 'We hired a foreign employee in Singapore. What employment/work-pass requirements apply, whether CPF contributions are required, and what employer tax reporting obligations should we consider?';
const noProviderFetch = globalThis.fetch;
globalThis.fetch = async input => { throw new Error(`Unexpected network access in no-provider test: ${String(input)}`); };
let noProviderMulti;
try {
  noProviderMulti = await processAccountingQuery(promptB, null, 'SFRS_I');
} finally {
  globalThis.fetch = noProviderFetch;
}
assert.ok(noProviderMulti.scenarioState.authorityEvidencePresentation, 'no-provider multi-authority requests retain an explicit whole-question projection');
assert.equal(noProviderMulti.scenarioState.authorityEvidencePresentation.status, 'INSUFFICIENT', 'uncovered fallback scope and unresolved residual fail closed without a provider');
assert.equal(noProviderMulti.scenarioState.requestCompletenessContext.rawQuery, promptB,
  'provider-unavailable fallback remains bound to the original request');
assert.equal(noProviderMulti.scenarioState.requestCompletenessContext.evaluation.structuralAcceptance, 'REJECTED');
assert.ok(noProviderMulti.scenarioState.requestCompletenessContext.evaluation.findings.some(item => item.code === 'OBSERVATION_WRAPPER_FAILED'));

const b1AnnualReturnQuery = 'For a Singapore-incorporated non-listed company with no overseas branch register, what is the general annual-return filing deadline in months after financial year end? Explain the rule only; do not prepare a journal.';
const acraDeadlineQuery = 'For a Singapore private company with a 31 December financial year end, when must it file its annual return?';
const acraDeadlineTopics = defaultQueryTopicResolver.decomposeQuery(acraDeadlineQuery).topics.map(topic => topic.id);
assert.ok(acraDeadlineTopics.includes('acra_annual-returns'),
  'the company deadline phrasing resolves to the governed annual-returns topic');
for (const query of [
  'When must a private company file its annual return?',
  'When must local companies file their annual returns?',
  'When must a Singapore company file the annual returns?'
]) {
  assert.ok(defaultQueryTopicResolver.decomposeQuery(query).topics.some(topic => topic.id === 'acra_annual-returns'),
    `the annual-return deadline pattern covers the realistic company phrasing: ${query}`);
}
const vccAnnualReturnQuery = 'For a Singapore variable capital company, when must it file its annual return?';
const vccAnnualReturnTopics = defaultQueryTopicResolver.decomposeQuery(vccAnnualReturnQuery).topics.map(topic => topic.id);
assert.ok(vccAnnualReturnTopics.includes('acra_vcc'), 'an explicit VCC question retains VCC scope');
assert.ok(!vccAnnualReturnTopics.includes('acra_annual-returns'),
  'the company annual-returns topic does not bleed into an explicit VCC-only question');
const separatedCompanyAndVccQuery = 'A private company is dormant; for a VCC when must it file its annual return?';
const separatedCompanyAndVccTopics = defaultQueryTopicResolver.decomposeQuery(separatedCompanyAndVccQuery).topics.map(topic => topic.id);
assert.ok(separatedCompanyAndVccTopics.includes('acra_vcc'), 'the VCC question after a clause boundary retains VCC scope');
assert.ok(!separatedCompanyAndVccTopics.includes('acra_annual-returns'),
  'a company mentioned in a separate clause cannot qualify the VCC annual-return question');
for (const query of [
  'A private company is dormant, and for a VCC when must it file its annual return?',
  'For a Singapore company structured as a VCC, when must it file its annual return?'
]) {
  const topicIds = defaultQueryTopicResolver.decomposeQuery(query).topics.map(topic => topic.id);
  assert.ok(topicIds.includes('acra_vcc'), `the VCC route remains available for: ${query}`);
  assert.ok(!topicIds.includes('acra_annual-returns'),
    `a VCC referent cannot inherit a company qualifier from the same phrase: ${query}`);
}
const mixedAcraAnnualReturnQuery = 'For a Singapore VCC and private company, when must each file its annual return?';
const mixedAcraAnnualReturnTopics = defaultQueryTopicResolver.decomposeQuery(mixedAcraAnnualReturnQuery).topics.map(topic => topic.id);
assert.ok(mixedAcraAnnualReturnTopics.includes('acra_vcc') && mixedAcraAnnualReturnTopics.includes('acra_annual-returns'),
  'mixed VCC/company questions retain both distinct filing scopes');
const b1AnnualReturnDecomposition = defaultQueryTopicResolver.decomposeQuery(b1AnnualReturnQuery);
const b1AnnualReturnTopics = b1AnnualReturnDecomposition.topics.map(topic => topic.id);
assert.ok(b1AnnualReturnTopics.includes('acra_annual-returns'),
  'the hyphenated annual-return deadline wording resolves to ACRA company filing coverage');
assert.deepEqual(b1AnnualReturnDecomposition.unresolvedTopics, [],
  'a standalone negative journal instruction does not remain as unresolved query scope');
const b1Classification = classifyQuestion(b1AnnualReturnQuery);
assert.equal(b1Classification.primaryDomain, 'CORPORATE_REGULATORY', 'a negated journal mention does not override the ACRA subject');
assert.ok(b1Classification.domains.includes('ACRA_COMPANIES'), 'the classified annual-return question retains ACRA corporate scope');
assert.equal(b1Classification.intent, 'STATUTORY_ADVISORY', 'the rule-only question remains statutory advisory');
assert.equal(b1Classification.accountingAnalysisRequired, false, 'a negated journal instruction does not create accounting analysis');
assert.equal(b1Classification.journalEntryRequired, false, 'a negated journal instruction does not request an entry');
const vccHyphenatedAnnualReturnQuery = 'For a Singapore company structured as a VCC, what is its annual-return filing deadline in months after financial year end?';
assert.ok(!defaultQueryTopicResolver.decomposeQuery(vccHyphenatedAnnualReturnQuery).topics.some(topic => topic.id === 'acra_annual-returns'),
  'hyphenated company filing wording does not let a VCC inherit company annual-return scope');
for (const query of [
  'For a Singapore variable-capital company, what is its annual-return filing deadline in months after financial year end?',
  'For a Singapore VCC company, what is its annual-return filing deadline in months after financial year end?',
  'For a Singapore company structured as a variable-capital company, what is its annual-return filing deadline in months after financial year end?',
  'For a Singapore company structured as a variable capital company, what is its annual-return filing deadline in months after financial year end?'
]) {
  assert.ok(!defaultQueryTopicResolver.decomposeQuery(query).topics.some(topic => topic.id === 'acra_annual-returns'),
    `hyphenated annual-return routing does not match a VCC noun phrase: ${query}`);
}
for (const query of [
  b1AnnualReturnQuery.replace('do not prepare a journal', "don't prepare a journal-entry"),
  b1AnnualReturnQuery.replace('do not prepare a journal', 'do not prepare a double-entry journal')
]) {
  const negativeJournalClassification = classifyQuestion(query);
  assert.equal(negativeJournalClassification.journalEntryRequired, false,
    `explicitly negated journal wording does not request an entry: ${query}`);
  assert.deepEqual(defaultQueryTopicResolver.decomposeQuery(query).unresolvedTopics, [],
    `a natural negative journal variant does not leave unresolved scope: ${query}`);
}
const positiveAfterNegativeQuery = b1AnnualReturnQuery.replace('do not prepare a journal.',
  'do not prepare a journal, but prepare a journal entry to record the filing fee.');
assert.ok(defaultQueryTopicResolver.decomposeQuery(positiveAfterNegativeQuery).unresolvedTopics.some(fragment =>
  /prepare a journal entry to record the filing fee/.test(fragment)),
'a positive journal request after a negative directive remains substantive unresolved scope');
const b1WithUnknownSuffixQuery = `${b1AnnualReturnQuery} Also explain the unregistered xylophone regime.`;
const b1WithUnknownSuffixDecomposition = defaultQueryTopicResolver.decomposeQuery(b1WithUnknownSuffixQuery);
assert.ok(b1WithUnknownSuffixDecomposition.unresolvedTopics.some(fragment => /xylophone/.test(fragment)),
  'ignoring a negative journal directive does not hide a substantive unknown suffix');
assert.ok(!b1WithUnknownSuffixDecomposition.unresolvedTopics.some(fragment => /do not prepare a journal/.test(fragment)),
  'only the recognized negative directive is removed from unresolved scope');
const mixedJournalPolarityQuery = 'We paid the annual return filing fee. Do not prepare a journal for the filing deadline, but prepare a journal-entry to record the fee.';
const mixedJournalPolarityClassification = classifyQuestion(mixedJournalPolarityQuery);
assert.equal(mixedJournalPolarityClassification.primaryDomain, 'ACCOUNTING');
assert.equal(mixedJournalPolarityClassification.journalEntryRequired, true,
  'a separate positive fee journal remains active beside a negative journal instruction');
const companyThenVccQuery = 'For a private company, when must it file its annual return? Separately, for a VCC, when must it file its annual return?';
const companyThenVccTopics = defaultQueryTopicResolver.decomposeQuery(companyThenVccQuery).topics.map(topic => topic.id);
assert.ok(companyThenVccTopics.includes('acra_vcc') && companyThenVccTopics.includes('acra_annual-returns'),
  'an explicit company filing clause remains eligible when a separate VCC reference follows it');
const journalAnnualReturnQuery = 'We paid the annual return filing fee. What journal entry records this payment?';
assert.equal(classifyQuestion(journalAnnualReturnQuery).journalEntryRequired, true,
  'a genuine filing-fee journal request remains on the accounting route');

const acraDeadlineFetch = globalThis.fetch;
globalThis.fetch = async input => {
  throw new Error(`Blocked network request in offline ACRA deadline regression: ${String(input)}`);
};
try {
  for (const query of [acraDeadlineQuery, b1AnnualReturnQuery]) {
    const response = await processAccountingQuery(query, null, 'SFRS_I');
    const presentation = response.scenarioState.authorityEvidencePresentation;
    assert.ok(presentation, `the standalone company deadline request uses authority evidence presentation: ${query}`);
    assert.equal(presentation.status, 'INSUFFICIENT',
      `without a provider or successful source retrieval the deadline remains unverified: ${query}`);
    assert.equal(presentation.query, query, 'the evidence projection retains the exact original query');
    assert.equal(response.scenarioState.rawQuery, query, 'the standalone response retains the original scope');
    assert.equal(response.scenarioState.requestCompletenessContext.rawQuery, query);
    assert.equal(response.scenarioState.isComplete, false, 'missing evidence cannot produce a complete statutory answer');
    assert.deepEqual(response.scenarioState.directGroups, [], 'a statutory deadline question does not create a journal');
    assert.ok(presentation.workstreams.some(stream => stream.authority === 'ACRA' && stream.domain === 'ACRA_CORPORATE' &&
      stream.issues.length > 0), 'the preserved issue remains in ACRA corporate scope');
    assert.doesNotMatch(response.messageText, /variable capital company|\bVCC\b/i,
      'the company deadline answer does not inherit unrelated VCC editorial material');
    assert.doesNotMatch(response.messageText, /\b(?:within|no later than)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:days?|weeks?|months?)\b|\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i,
      'the offline response does not invent a filing deadline');
  }
} finally {
  globalThis.fetch = acraDeadlineFetch;
}

const b1SemanticInterpretation = {
  schemaVersion: 2, jurisdiction: ['Singapore'], authorityCandidates: ['ACRA'], contextualAuthorities: [],
  domain: 'ACRA_CORPORATE', population: 'COMPANY', primarySubject: 'annual-return filing deadline',
  concepts: [{ concept: 'annual return filing deadline', role: 'PRIMARY' }], requestedOperation: 'EXPLAIN_RULE',
  factsExplicitlyProvided: [], confidence: 0.96,
  issues: [{ subject: 'annual-return filing deadline', population: 'COMPANY', domain: 'ACRA_CORPORATE',
    governingAuthorities: ['ACRA'], contextualAuthorities: [], operation: 'EXPLAIN_RULE',
    mappedTopicIds: ['acra_annual-returns'], evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 0.96 }]
};
const b1UnderstandingForSubject = (subject, issueOverrides = {}) => ({
  mode: 'SEMANTIC_INTERPRETATION', assessmentStatus: 'PASSED',
  interpretation: {
    ...b1SemanticInterpretation,
    primarySubject: subject,
    issues: [{ ...b1SemanticInterpretation.issues[0], subject, ...issueOverrides }]
  }
});
const annualReturnUnderstanding = (operation = 'EXPLAIN_RULE', subject = 'annual-return filing deadline') => ({
  mode: 'SEMANTIC_INTERPRETATION', assessmentStatus: 'PASSED',
  interpretation: {
    ...b1SemanticInterpretation,
    primarySubject: subject,
    requestedOperation: operation,
    issues: [{ ...b1SemanticInterpretation.issues[0], subject, operation }]
  }
});
const b1IssuePlanFor = (query, understanding) => reconcileQuestionUnderstanding(
  query, classifyQuestion(query), understanding
).issuePlan;
const spacedB1IssuePlan = b1IssuePlanFor(b1AnnualReturnQuery,
  b1UnderstandingForSubject('annual return filing deadline'));
const hyphenatedB1IssuePlan = b1IssuePlanFor(b1AnnualReturnQuery,
  b1UnderstandingForSubject('annual-return filing deadline'));
const qualifiedHyphenatedB1IssuePlan = b1IssuePlanFor(b1AnnualReturnQuery,
  b1UnderstandingForSubject('general Singapore company annual-return filing deadline'));
for (const [label, plan] of [['spaced', spacedB1IssuePlan], ['hyphenated', hyphenatedB1IssuePlan]]) {
  assert.equal(plan.coverageEstablished, true, `${label} annual-return subject maps against the raw company topic inventory`);
  assert.equal(plan.hasUnmappedResidual, false, `${label} annual-return subject leaves no unsupported query scope`);
  assert.deepEqual(plan.issues[0].mappedTopicIds, ['acra_annual-returns']);
}
assert.equal(hyphenatedB1IssuePlan.issues[0].subject, 'annual-return filing deadline',
  'topic normalization does not rewrite the provider subject in diagnostics');
assert.deepEqual(hyphenatedB1IssuePlan.issues[0].mappedTopicIds, spacedB1IssuePlan.issues[0].mappedTopicIds,
  'hyphenated and spaced semantic labels reconcile to the same governed topic');
assert.deepEqual(qualifiedHyphenatedB1IssuePlan.issues[0].mappedTopicIds, spacedB1IssuePlan.issues[0].mappedTopicIds,
  'ordinary company and Singapore qualifiers remain within the bounded annual-return label vocabulary');
const b2AnnualReturnQuery = 'For a Singapore-incorporated non-listed company with no overseas branch register and financial year ending 31/12/2025, what is the annual-return filing deadline? Show the date as DD/MM/YYYY; do not prepare a journal.';
for (const operation of ['EXPLAIN_RULE', 'FILING_REQUIREMENT', 'DETERMINE_TREATMENT', 'CALCULATE']) {
  const subject = operation === 'EXPLAIN_RULE' ? 'annual-return filing deadline' : 'annual return filing deadline';
  const plan = b1IssuePlanFor(b2AnnualReturnQuery, annualReturnUnderstanding(operation, subject));
  assert.equal(plan.coverageEstablished, true,
    `${operation} retains full coverage when the only residuals are bounded ACRA company facts and date formatting`);
  assert.equal(plan.issues[0].operation, operation, `${operation} remains the requested operation after subject normalization`);
  assert.equal(plan.issues[0].subject, subject, `${operation} preserves the provider's original subject label`);
  assert.deepEqual(plan.issues[0].mappedTopicIds, ['acra_annual-returns'],
    `${operation} maps the ordinary-company annual-return label to its independently recognized ACRA topic`);
}
const b2FyeAliasUnderstanding = annualReturnUnderstanding();
b2FyeAliasUnderstanding.interpretation.concepts = [
  ...b2FyeAliasUnderstanding.interpretation.concepts,
  { concept: 'financial year end', role: 'RELATED' }
];
const b2FyeAliasConcepts = getRequestedQuestionConcepts(b2AnnualReturnQuery, b2FyeAliasUnderstanding);
assert.ok(b2FyeAliasConcepts.some(concept => concept.id === 'acra_annual_return_financial_year_end'),
  'the original B2 financial-year-ending date owns its canonical FYE concept');
assert.ok(!b2FyeAliasConcepts.some(concept => concept.id === 'semantic_financial_year_end'),
  'the matching plain FYE label is not emitted as an unassigned semantic topic');
assert.equal(isAcraAnnualReturnApplicationQuestion(b2AnnualReturnQuery, 'EXPLAIN_RULE'), true,
  'an explicit FYE in the raw query still triggers date application when a model labels the request EXPLAIN_RULE');
const b3AnnualReturnQuery = 'When is my company annual return due? I have not provided its financial year end, listing status or overseas branch register status. Identify the missing facts; do not assume them or prepare a journal.';
assert.equal(isBoundedAcraAnnualReturnMissingFactsQuestion(b3AnnualReturnQuery), true,
  'the complete missing-facts request has a narrow raw-input recognition path');
const b3RawDecomposition = defaultQueryTopicResolver.decomposeQuery(b3AnnualReturnQuery);
assert.ok(b3RawDecomposition.topics.some(topic => topic.id === 'acra_annual-returns'),
  'the missing-facts request remains mapped to its ACRA company annual-return issue');
assert.deepEqual(b3RawDecomposition.unresolvedTopics, [],
  'the explicitly negated assume-or-journal instruction does not create unowned residual scope');
const b3ObservedSubject = 'company annual return due date filing rules';
for (const operation of ['EXPLAIN_RULE', 'FILING_REQUIREMENT', 'DETERMINE_TREATMENT']) {
  const plan = b1IssuePlanFor(b3AnnualReturnQuery, annualReturnUnderstanding(operation, b3ObservedSubject));
  assert.equal(plan.coverageEstablished, true,
    `${operation} maps the bounded ordinary-company due-date subject against the exact B3 query`);
  assert.deepEqual(plan.issues.map(issue => [issue.operation, issue.mappedTopicIds]), [
    [operation, ['acra_annual-returns']]
  ]);
}
for (const subject of [
  'foreign company annual return due date filing rules',
  'company annual return due date extension rules',
  'company annual return due date filing rules and xylophone regime'
]) {
  const plan = b1IssuePlanFor(b3AnnualReturnQuery, annualReturnUnderstanding('DETERMINE_TREATMENT', subject));
  assert.ok(!plan.issues.some(issue => issue.subject === subject && issue.mappedTopicIds.includes('acra_annual-returns')),
    `the bounded due-date vocabulary does not absorb unsupported subject scope: ${subject}`);
}
const b3ObservedPlan = b1IssuePlanFor(b3AnnualReturnQuery,
  annualReturnUnderstanding('DETERMINE_TREATMENT', b3ObservedSubject));
const b3ObservedWorkstreams = await buildAuthorityWorkstreams(b3AnnualReturnQuery, b3ObservedPlan, {
  referenceDate: '2026-10-19', localOnly: true,
  providers: { ACRA: { authority: 'ACRA', retrieve: async () => ({ candidates: [] }) } }
});
const b3ObservedPresentation = createAuthorityEvidencePresentation(b3ObservedWorkstreams);
const b3ObservedIssue = b3ObservedPresentation.workstreams.flatMap(stream => stream.issues)[0];
assert.equal(b3ObservedIssue.subject, b3ObservedSubject,
  'the full B3 semantic route preserves the observed due-date subject in presentation');
assert.equal(b3ObservedIssue.applicationStatus, 'UNRESOLVED');
assert.match(renderAuthorityEvidenceResponseText(b3ObservedPresentation, false),
  /financial year end, listing status, overseas branch register status/i,
  'the full B3 route identifies missing facts instead of calculating a date');
assert.doesNotMatch(renderAuthorityEvidenceResponseText(b3ObservedPresentation, false), /\b\d{1,2}\/\d{1,2}\/\d{4}\b/);
assert.deepEqual(b3ObservedWorkstreams.workstreams.flatMap(stream => stream.issues.flatMap(issue => issue.verifiedClaims)), []);
const b3FallbackPlan = b1IssuePlanFor(b3AnnualReturnQuery, { mode: 'DETERMINISTIC_FALLBACK' });
assert.equal(b3FallbackPlan.coverageEstablished, true,
  'an exact, bounded ACRA missing-facts query stays on its recognized statutory issue after semantic fallback');
assert.deepEqual(b3FallbackPlan.issues.map(issue => [issue.domain, issue.population, issue.operation, issue.mappedTopicIds]), [
  ['ACRA_CORPORATE', 'COMPANY', 'DETERMINE_TREATMENT', ['acra_annual-returns']]
]);
const b3MissingFactsParaphrases = [
  'I have not supplied our FYE, listing status or overseas branch register status. What is the filing deadline for our Singapore-incorporated company annual return? Please list the missing facts.',
  'We do not know the company financial year end, whether it is listed, or whether it keeps an overseas branch register. When should our company file its annual return? What facts do you need?',
  'What company information do you need to determine when our company annual return is due? Its FYE, listing status and overseas branch register status are unknown.'
];
for (const [index, query] of b3MissingFactsParaphrases.entries()) {
  assert.equal(isBoundedAcraAnnualReturnMissingFactsQuestion(query), true,
    `ordinary bounded paraphrase ${index + 1} recognizes annual-return fact requests`);
  const plan = b1IssuePlanFor(query, { mode: 'DETERMINISTIC_FALLBACK' });
  assert.equal(plan.coverageEstablished, true,
    `ordinary bounded paraphrase ${index + 1} remains on the ACRA company annual-return route`);
  assert.deepEqual(plan.issues.map(issue => [issue.domain, issue.population, issue.operation, issue.mappedTopicIds]), [
    ['ACRA_CORPORATE', 'COMPANY', 'DETERMINE_TREATMENT', ['acra_annual-returns']]
  ]);
}
const b3UnknownSuffix = `${b3AnnualReturnQuery} Also explain the unregistered xylophone regime.`;
assert.equal(isBoundedAcraAnnualReturnMissingFactsQuestion(b3UnknownSuffix), false,
  'an unknown appended issue does not enter the narrow missing-facts fallback');
assert.ok(defaultQueryTopicResolver.decomposeQuery(b3UnknownSuffix).unresolvedTopics.some(fragment => /xylophone/.test(fragment)),
  'the unknown appended issue remains visible as unresolved scope');
for (const query of [
  b3AnnualReturnQuery.replace('my company', 'my VCC'),
  b3AnnualReturnQuery.replace('my company', 'my foreign-incorporated company'),
  `${b3AnnualReturnQuery} Also explain the company tax treatment.`
]) {
  assert.equal(isBoundedAcraAnnualReturnMissingFactsQuestion(query), false,
    `VCC, foreign and mixed scope does not bind into the ordinary-company fallback: ${query}`);
  assert.equal(b1IssuePlanFor(query, { mode: 'DETERMINISTIC_FALLBACK' }).coverageEstablished, false,
    'out-of-scope or mixed clauses remain unresolved through fallback routing');
}
const companyFreeAnnualReturnQuery = 'When is the annual return due? List the missing facts.';
assert.equal(isBoundedAcraAnnualReturnMissingFactsQuestion(companyFreeAnnualReturnQuery), false,
  'a deadline and missing-facts request without company ownership cannot imply an ordinary company');
assert.equal(b1IssuePlanFor(companyFreeAnnualReturnQuery, { mode: 'DETERMINISTIC_FALLBACK' }).coverageEstablished, false,
  'the company-free fallback leaves company-specific ownership unresolved');
const b3Classification = classifyQuestion(b3AnnualReturnQuery);
assert.equal(b3Classification.primaryDomain, 'CORPORATE_REGULATORY');
assert.equal(b3Classification.journalEntryRequired, false,
  'the shared coordinated negation keeps the missing-facts question out of the journal route');
assert.equal(b3Classification.calculationRequired, false);
const b4CpfIrasQuery = 'What are the 2026 CPF rates for a Singapore citizen employee aged 45, and can employee CPF contributions qualify for Singapore personal income tax relief? Explain the CPF rates and IRAS relief as separate issues; do not calculate amounts or prepare a journal.';
const b4Classification = classifyQuestion(b4CpfIrasQuery);
assert.equal(b4Classification.journalEntryRequired, false,
  'the coordinated negative calculation-or-journal instruction does not request a journal');
assert.equal(b4Classification.calculationRequired, false,
  'a negated calculation phrase remains a non-calculation request');
assert.ok(b4Classification.authorities.includes('CPF') && b4Classification.authorities.includes('IRAS'),
  'the mixed query retains the separate CPF and IRAS scopes');
const b5Classification = classifyQuestion('Explain the SFRS(I) 6 accounting treatment for exploration and evaluation assets. Explain the rule only; do not calculate amounts or prepare a journal.');
assert.equal(b5Classification.primaryDomain, 'ACCOUNTING');
assert.equal(b5Classification.journalEntryRequired, false);
assert.equal(b5Classification.calculationRequired, false,
  'the negated calculation clause does not block the unsupported-standards evidence guard');
for (const query of [
  `${b2AnnualReturnQuery} Also explain the unregistered xylophone regime.`,
  b2AnnualReturnQuery.replace('annual-return filing deadline?', 'annual-return filing deadline and the extension rules?')
]) {
  const plan = b1IssuePlanFor(query, annualReturnUnderstanding('EXPLAIN_RULE'));
  assert.equal(plan.coverageEstablished, false,
    `unknown appended or same-clause deadline scope remains an unbound raw-query residual: ${query}`);
  assert.equal(plan.hasUnmappedResidual, true);
}
const negativeBranchFacts = identifyAcraAnnualReturnCompanyFacts(
  'For a Singapore-incorporated non-listed company that does not have an overseas branch register, financial year end 31/12/2025.'
);
assert.equal(negativeBranchFacts.hasOverseasBranchRegister, false,
  'a grammatically negative branch-register fact is accepted without also matching the positive “have” form');
assert.ok(!negativeBranchFacts.unresolvedFacts.some(fact => /branch register status.*conflicting/i.test(fact)));
const unassertedCompanyFactQueries = [
  'For a Singapore-incorporated non-listed company with no overseas branch register, do not assume financial year end 31/12/2025.',
  'For a Singapore-incorporated non-listed company with financial year ending 31/12/2025, it may have an overseas branch register.'
];
const unassertedCompanyFacts = unassertedCompanyFactQueries.map(query => identifyAcraAnnualReturnCompanyFacts(query));
assert.ok(unassertedCompanyFacts[0].unresolvedFacts.some(fact => /financial year end.*not assumed/i.test(fact)),
  'a date in an explicitly unassumed FYE span remains unresolved');
assert.equal(unassertedCompanyFacts[0].financialYearEnd, undefined);
assert.ok(unassertedCompanyFacts[1].unresolvedFacts.some(fact => /overseas branch register status.*uncertain/i.test(fact)),
  'a conditional branch-register mention remains unresolved');
assert.equal(unassertedCompanyFacts[1].hasOverseasBranchRegister, undefined);
for (const uncertainQuery of [
  'For a company with financial year end 31/12/2025, I am not sure whether it is listed.',
  'For a company with financial year end 31/12/2025, do not assume it is non-listed.'
]) {
  const facts = identifyAcraAnnualReturnCompanyFacts(uncertainQuery);
  assert.ok(facts.unresolvedFacts.some(fact => /listing status.*uncertain|listing status.*not assumed/i.test(fact)),
    `uncertain or expressly unassumed listing status remains unresolved: ${uncertainQuery}`);
  assert.equal(facts.listingStatus, undefined);
}

for (const subject of [
  'VCC annual-return filing deadline',
  'variable-capital-company annual-return filing deadline',
  'foreign-company annual-return filing deadline',
  'foreign-incorporated company annual-return filing deadline',
  'overseas incorporated company annual-return filing deadline',
  'annual-return filing deadline for a company incorporated in Malaysia',
  'annual-return filing deadline and xylophone statutory regime'
]) {
  const plan = b1IssuePlanFor(b1AnnualReturnQuery, b1UnderstandingForSubject(subject));
  assert.ok(!plan.issues.some(issue => issue.subject === subject && issue.mappedTopicIds.includes('acra_annual-returns')),
    `the bounded annual-return subject vocabulary does not absorb out-of-scope label words: ${subject}`);
}
const mixedVccQuery = 'For a Singapore VCC and private company, when must each file its annual return?';
const mixedVccPlan = b1IssuePlanFor(mixedVccQuery,
  b1UnderstandingForSubject('annual-return filing deadline'));
assert.equal(mixedVccPlan.coverageEstablished, false,
  'an incomplete semantic issue cannot absorb a competing raw-query VCC scope');
assert.equal(mixedVccPlan.hasUnmappedResidual, true,
  'the ambiguous mixed VCC/company query remains fail-closed');
const wrongAuthorityPlan = b1IssuePlanFor(b1AnnualReturnQuery,
  b1UnderstandingForSubject('annual-return filing deadline', { governingAuthorities: ['IRAS'] }));
assert.equal(wrongAuthorityPlan.coverageEstablished, false,
  'an ACRA annual-return subject with an incompatible governing authority remains fail-closed');
const unknownSubjectPlan = b1IssuePlanFor(b1AnnualReturnQuery,
  b1UnderstandingForSubject('xylophone statutory regime', { mappedTopicIds: ['acra_annual-returns', 'not-a-declared-topic'] }));
assert.ok(!unknownSubjectPlan.issues.some(issue => issue.subject === 'xylophone statutory regime' &&
  issue.mappedTopicIds.includes('acra_annual-returns')),
'semantic topic hints alone do not map an unsupported subject');
const b1ProviderCalls = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname === 'generativelanguage.googleapis.com') {
    const payload = JSON.parse(init?.body || '{}');
    const prompt = payload.contents?.flatMap(item => item.parts || []).map(part => part.text || '').join('\n') || '';
    if (prompt.includes('Return a V2 JSON object')) {
      b1ProviderCalls.push('semantic');
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(b1SemanticInterpretation) }] } }] }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    }
  }
  b1ProviderCalls.push(url.hostname);
  throw new Error(`Blocked network request in mocked B1 provider test: ${url.hostname}`);
};
let b1ProviderResponse;
let b1AuthorityWorkstreams;
try {
  b1ProviderResponse = await processAccountingQuery(
    b1AnnualReturnQuery, null, 'SFRS_I', 'test-key-1234567890', undefined, [], undefined,
    { onAuthorityWorkstreams: result => { b1AuthorityWorkstreams = result; } }
  );
} finally {
  globalThis.fetch = originalFetch;
}
assert.equal(b1ProviderCalls.filter(host => host === 'semantic').length, 1,
  'the B1 provider path uses one valid mocked semantic interpretation');
assert.ok(b1AuthorityWorkstreams, 'the B1 provider path exposes its authority planning diagnostics');
assert.equal(b1AuthorityWorkstreams.issuePlan.coverageEstablished, true,
  'the B1 issue plan is covered after ignoring only the negative journal directive');
assert.equal(b1AuthorityWorkstreams.issuePlan.hasUnmappedResidual, false,
  'the negative journal directive does not create an unmapped residual');
assert.equal(b1AuthorityWorkstreams.issuePlan.issues[0].subject, 'annual-return filing deadline',
  'the actual mocked provider path preserves the original hyphenated semantic subject');
assert.deepEqual(b1AuthorityWorkstreams.issuePlan.issues[0].mappedTopicIds, ['acra_annual-returns'],
  'the actual mocked provider path maps the hyphenated label through ACRA company coverage');
const b1ProviderPresentation = b1ProviderResponse.scenarioState.authorityEvidencePresentation;
assert.ok(b1ProviderPresentation, 'the valid provider interpretation uses authority evidence presentation');
assert.equal(b1ProviderPresentation.status, 'INSUFFICIENT',
  'without admitted ACRA evidence the valid provider path remains explicitly insufficient');
assert.equal(b1ProviderPresentation.query, b1AnnualReturnQuery, 'the provider response preserves the exact original B1 query');
assert.equal(b1ProviderResponse.scenarioState.rawQuery, b1AnnualReturnQuery);
assert.deepEqual(b1ProviderResponse.scenarioState.directGroups, [], 'the provider path does not create a journal for B1');
assert.equal(b1ProviderResponse.scenarioState.isComplete, false);
assert.doesNotMatch(b1ProviderResponse.messageText, /\b(?:within|no later than)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:days?|weeks?|months?)\b|\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i,
  'the valid provider path does not supply a definite filing deadline without admitted evidence');

const withTemporaryRegistrySource = async (record, action) => {
  const previous = UNIFIED_SOURCE_REGISTRY[record.id];
  UNIFIED_SOURCE_REGISTRY[record.id] = record;
  try { return await action(); }
  finally {
    if (previous) UNIFIED_SOURCE_REGISTRY[record.id] = previous;
    else delete UNIFIED_SOURCE_REGISTRY[record.id];
  }
};
const runAcraWorkstreams = (query, operation, candidates, evidenceQualityTrace, understandingOverride) => {
  const understanding = understandingOverride || annualReturnUnderstanding(operation);
  const issuePlan = b1IssuePlanFor(query, understanding);
  return buildAuthorityWorkstreams(query, issuePlan, {
    questionUnderstanding: understanding,
    referenceDate: '2026-10-19',
    localOnly: true,
    providers: { ACRA: {
      authority: 'ACRA',
      retrieve: async () => ({ candidates, ...(evidenceQualityTrace ? { evidenceQualityTrace } : {}) })
    } }
  });
};
const b2HistoricalFixture = syntheticAcraDeadlineSource();
const acceptanceMatrixFailures = [];
const b1HistoricalFixture = syntheticAcraDeadlineSource({ id: 'TEST_ONLY_ACRA_GENERAL_RULE_TABLE' });
const b1Workstreams = await withTemporaryRegistrySource(b1HistoricalFixture,
  () => runAcraWorkstreams(b1AnnualReturnQuery, 'EXPLAIN_RULE', [b1HistoricalFixture]));
const b1PositiveIssue = b1Workstreams.workstreams.flatMap(stream => stream.issues)[0];
assert.equal(b1Workstreams.issuePlan.coverageEstablished, true, 'the general B1 question retains independently established raw ACRA coverage');
assert.equal(b1PositiveIssue.evidenceStatus, 'VERIFIED', 'the B1 table passes real local admission and claim verification');
assert.equal(b1PositiveIssue.applicationStatus, 'NOT_REQUIRED', 'the general rule request remains source-only without a date calculation');
assert.equal(b1PositiveIssue.applicationReason, undefined);
const b1PositivePresentation = createAuthorityEvidencePresentation(b1Workstreams);
assert.equal(b1PositivePresentation.status, 'CONDITIONAL',
  'verified ACRA source coverage remains conditional while whole-request representation is unconfirmed');
assert.match(renderAuthorityEvidenceResponseText(b1PositivePresentation, false), /full request coverage unconfirmed/);
assert.doesNotMatch(renderAuthorityEvidenceResponseText(b1PositivePresentation, false), /31\/07\/2026/,
  'B1 reports the rule without calculating a filing deadline date');
const b2SemanticUnderstanding = annualReturnUnderstanding('EXPLAIN_RULE');
b2SemanticUnderstanding.interpretation.concepts = [
  ...b2SemanticUnderstanding.interpretation.concepts,
  { concept: 'Singapore-incorporated non-listed company', role: 'RELATED' },
  { concept: 'financial year ending 31/12/2025', role: 'RELATED' }
];
const b2SemanticConcepts = getRequestedQuestionConcepts(b2AnnualReturnQuery, b2SemanticUnderstanding);
assert.ok(b2SemanticConcepts.some(concept => concept.id === 'acra_annual_return_listing_status'));
assert.ok(b2SemanticConcepts.some(concept => concept.id === 'acra_annual_return_financial_year_end'));
assert.ok(!b2SemanticConcepts.some(concept => /semantic_(?:singapore_incorporated_non_listed_company|financial_year_ending_31_12_2025)/.test(concept.id)),
  'semantic descriptors matching the query facts are covered by their canonical ACRA concepts');
assert.deepEqual(b2SemanticUnderstanding.interpretation.concepts.slice(-2).map(concept => concept.concept), [
  'Singapore-incorporated non-listed company', 'financial year ending 31/12/2025'
], 'covering semantic descriptors preserves the raw provider diagnostics');
const mismatchedB2LabelUnderstanding = annualReturnUnderstanding('EXPLAIN_RULE');
mismatchedB2LabelUnderstanding.interpretation.concepts = [
  ...mismatchedB2LabelUnderstanding.interpretation.concepts,
  { concept: 'financial year ending 31/12/2024', role: 'RELATED' },
  { concept: 'Singapore-incorporated non-listed company with an extension', role: 'RELATED' }
];
const mismatchedB2Concepts = getRequestedQuestionConcepts(b2AnnualReturnQuery, mismatchedB2LabelUnderstanding);
assert.ok(mismatchedB2Concepts.some(concept => concept.id === 'semantic_financial_year_ending_31_12_2024'),
  'a semantic date that disagrees with the asserted FYE remains a material concept');
assert.ok(mismatchedB2Concepts.some(concept => concept.label === 'Singapore-incorporated non-listed company with an extension'),
  'an added semantic condition remains material instead of being absorbed by the listing concept');
const b2Workstreams = await withTemporaryRegistrySource(b2HistoricalFixture,
  () => runAcraWorkstreams(b2AnnualReturnQuery, 'EXPLAIN_RULE', [b2HistoricalFixture], undefined, b2SemanticUnderstanding));
if (!b2Workstreams.issuePlan.coverageEstablished || b2Workstreams.issuePlan.hasUnmappedResidual) {
  acceptanceMatrixFailures.push('B2 exact query leaves raw-input residual text despite its independently mapped ACRA annual-return issue');
}
const b2Issue = b2Workstreams.workstreams.flatMap(stream => stream.issues)[0];
assert.equal(b2Issue.operation, 'EXPLAIN_RULE', 'the application result preserves the semantic operation label');
assert.equal(b2Issue.evidenceStatus, 'VERIFIED', 'the synthetic historical fixture passes the real local admission and claim-verification path');
assert.deepEqual(b2Issue.gaps, [], 'covered B2 semantic descriptors create no spurious whole-question gaps');
assert.equal(b2Issue.applicationStatus, 'VERIFIED', 'a verified historical table and complete explicit facts permit deterministic date application');
assert.match(b2Issue.applicationReason, /31\/07\/2026/);
assert.match(b2Issue.applicationReason, /7 months/, 'the application explanation reports the matching table row');
assert.ok(b2Issue.verifiedClaims.every(claim => !claim.quote.includes('31/07/2026')),
  'derived date math remains separate from verbatim verified source claims');
const b2Presentation = createAuthorityEvidencePresentation(b2Workstreams);
const b2ResponseText = renderAuthorityEvidenceResponseText(b2Presentation, false);
assert.equal(b2Presentation.status, 'CONDITIONAL',
  'verified evidence and date application stay conditional until request representation is complete');
assert.match(b2ResponseText, /full request coverage unconfirmed/);
assert.match(b2ResponseText, /\*\*Application:\*\* .*31\/07\/2026/,
  'the text renderer presents the deterministic date as an application result');
assert.doesNotMatch(b2ResponseText, /Application unresolved/);
assert.doesNotMatch(b2ResponseText, /journal/i, 'the dated statutory answer does not prepare a journal');

const changedMonthFixture = syntheticAcraDeadlineSource({ id: 'TEST_ONLY_ACRA_DEADLINE_TABLE_NINE_MONTHS', nonListedMonths: 9 });
const changedMonthWorkstreams = await withTemporaryRegistrySource(changedMonthFixture,
  () => runAcraWorkstreams(b2AnnualReturnQuery, 'DETERMINE_TREATMENT', [changedMonthFixture]));
const changedMonthIssue = changedMonthWorkstreams.workstreams.flatMap(stream => stream.issues)[0];
assert.equal(changedMonthIssue.applicationStatus, 'VERIFIED');
assert.match(changedMonthIssue.applicationReason, /9 months.*30\/09\/2026/,
  'the computed date follows a deliberately varied verified table value rather than a statutory month constant');
const actualBranchRowSourceText = syntheticAcraDeadlineSource({ id: 'TEST_ONLY_ACRA_BRANCH_ROWS' }).sourceText
  .replace('Listed companies with share capital and an overseas branch register',
    'Listed companies with: A share capital; An overseas branch register')
  .replace('Non-listed companies with share capital and an overseas branch register',
    'Non-listed companies with: A share capital; An overseas branch register');
assert.equal(getAcraAnnualReturnDeadlineMonths(actualBranchRowSourceText, {
  listingStatus: 'NON_LISTED', hasOverseasBranchRegister: true, hasShareCapital: true
}), 8, 'the actual qualified row label selects its verified eight-month value');
assert.equal(getAcraAnnualReturnDeadlineMonths(actualBranchRowSourceText, {
  listingStatus: 'NON_LISTED', hasOverseasBranchRegister: true
}), undefined, 'branch status without explicit share-capital status cannot select a deadline row');
assert.equal(getAcraAnnualReturnDeadlineMonths(actualBranchRowSourceText, {
  listingStatus: 'NON_LISTED', hasOverseasBranchRegister: false
}), 7, 'the base row is selected alone when the company has no branch register');
const explicitQualifiedCompanyQuery = 'For a Singapore-incorporated non-listed company with a share capital and an overseas branch register, financial year ending 31/12/2025.';
const explicitQualifiedFacts = identifyAcraAnnualReturnCompanyFacts(explicitQualifiedCompanyQuery);
assert.equal(explicitQualifiedFacts.listingStatus, 'NON_LISTED');
assert.equal(explicitQualifiedFacts.hasShareCapital, true,
  'the explicit phrase “with a share capital” supplies the required qualification fact');
assert.equal(explicitQualifiedFacts.hasOverseasBranchRegister, true,
  'the coordinated share-capital and branch-register clause supplies branch status');
assert.deepEqual(explicitQualifiedFacts.unresolvedFacts, []);
const qualifiedBranchEvidence = {
  evidenceStatus: 'VERIFIED', targetDate: '2025-12-31',
  lifecycle: { admitted: true, verified: true, covered: true },
  sources: [{ id: 'TEST_ONLY_ACRA_ACTUAL_BRANCH_ROWS', sourceText: actualBranchRowSourceText, validFrom: '2020-01-01', effectiveDate: '2020-01-01' }],
  verifiedClaims: [{ recordId: 'TEST_ONLY_ACRA_ACTUAL_BRANCH_ROWS', quote: actualBranchRowSourceText }]
};
const qualifiedBranchApplication = applyAcraAnnualReturnDeadline(explicitQualifiedCompanyQuery, qualifiedBranchEvidence);
assert.equal(qualifiedBranchApplication.applicationStatus, 'VERIFIED',
  'the full fact set selects and applies the qualified branch-register row');
assert.match(qualifiedBranchApplication.applicationReason, /8 months.*31\/08\/2026/,
  'the calculated deadline uses the qualified row in the admitted table');
for (const query of unassertedCompanyFactQueries) {
  const application = applyAcraAnnualReturnDeadline(query, {
    ...qualifiedBranchEvidence,
    targetDate: '2025-12-31'
  });
  assert.equal(application.applicationStatus, 'UNRESOLVED',
    `an unasserted fact cannot produce a deadline: ${query}`);
  assert.equal(application.deadlineDate, undefined);
  assert.doesNotMatch(application.applicationReason, /\b\d{1,2}\/\d{2}\/\d{4}\b/);
}
const leapYearFixture = syntheticAcraDeadlineSource({ id: 'TEST_ONLY_ACRA_DEADLINE_TABLE_SIX_MONTHS', nonListedMonths: 6 });
const leapYearQuery = b2AnnualReturnQuery.replace('31/12/2025', '31/08/2023');
const leapYearWorkstreams = await withTemporaryRegistrySource(leapYearFixture,
  () => runAcraWorkstreams(leapYearQuery, 'CALCULATE', [leapYearFixture]));
const leapYearIssue = leapYearWorkstreams.workstreams.flatMap(stream => stream.issues)[0];
assert.equal(leapYearIssue.applicationStatus, 'VERIFIED');
assert.match(leapYearIssue.applicationReason, /29\/02\/2024/,
  'month-end arithmetic clamps correctly across a leap-year February');
const tooShortValidityFixture = syntheticAcraDeadlineSource({
  id: 'TEST_ONLY_ACRA_DEADLINE_TABLE_SHORT_VALIDITY', validTo: '2026-06-30'
});
const tooShortValidityWorkstreams = await withTemporaryRegistrySource(tooShortValidityFixture,
  () => runAcraWorkstreams(b2AnnualReturnQuery, 'CALCULATE', [tooShortValidityFixture]));
const tooShortValidityIssue = tooShortValidityWorkstreams.workstreams.flatMap(stream => stream.issues)[0];
assert.equal(tooShortValidityIssue.evidenceStatus, 'VERIFIED', 'the source is admitted for the stated FYE within its validity interval');
assert.equal(tooShortValidityIssue.applicationStatus, 'UNRESOLVED',
  'a source that expires before the derived filing date cannot support a verified application');
assert.doesNotMatch(tooShortValidityIssue.applicationReason, /31\/07\/2026/);
const targetDateMismatch = applyAcraAnnualReturnDeadline(b2AnnualReturnQuery, {
  evidenceStatus: 'VERIFIED', targetDate: '2024-01-01', lifecycle: b2Issue.lifecycle,
  sources: b2Issue.sources, verifiedClaims: b2Issue.verifiedClaims
});
assert.equal(targetDateMismatch.applicationStatus, 'UNRESOLVED',
  'a source admitted against a different target date cannot be reused for the FYE calculation');
assert.doesNotMatch(targetDateMismatch.applicationReason, /31\/07\/2026/);
const extensionApplication = applyAcraAnnualReturnDeadline(
  `${b2AnnualReturnQuery} The company has an approved extension of time.`,
  { evidenceStatus: 'VERIFIED', targetDate: '2025-12-31', lifecycle: b2Issue.lifecycle,
    sources: b2Issue.sources, verifiedClaims: b2Issue.verifiedClaims }
);
assert.equal(extensionApplication.applicationStatus, 'UNRESOLVED',
  'an ordinary table row does not silently answer a case mentioning an extension');
assert.doesNotMatch(extensionApplication.applicationReason, /31\/07\/2026/);

const currentSnapshotFixture = {
  ...fetchedLikeLiveSource({ id: 'TEST_ACRA_CURRENT_SNAPSHOT', authority: 'ACRA',
    title: 'Current ACRA annual return guidance', url: b2HistoricalFixture.officialSourceUrl, domain: 'ACRA_CORP' }),
  sourceText: b2HistoricalFixture.sourceText,
  sourceAuthority: 'ACRA',
  sourceMapTopicIds: ['acra_annual-returns'],
  retrievedAt: '2026-10-19T00:00:00.000Z',
  relatedTopicIds: ['acra_annual-returns'],
  tags: ['acra_annual-returns']
};
const currentSnapshotTrace = {
  path: 'official-source-map', selectedRecordIds: [currentSnapshotFixture.id],
  finalVerifiedUrls: [currentSnapshotFixture.officialSourceUrl],
  attempts: [{ topicId: 'acra_annual-returns', fetchStatus: 'SUCCESS', finalUrl: currentSnapshotFixture.officialSourceUrl,
    pageTitle: currentSnapshotFixture.documentTitle, titleMatched: true, contentMatched: true }]
};
const currentSnapshotWorkstreams = await runAcraWorkstreams(
  b2AnnualReturnQuery, 'EXPLAIN_RULE', [currentSnapshotFixture], currentSnapshotTrace
);
const currentSnapshotIssue = currentSnapshotWorkstreams.workstreams.flatMap(stream => stream.issues)[0];
assert.equal(currentSnapshotIssue.evidenceStatus, 'INSUFFICIENT',
  'a current live page is not admitted as evidence for the earlier FYE');
assert.equal(currentSnapshotIssue.applicationStatus, 'UNRESOLVED');
assert.match(currentSnapshotIssue.applicationReason, /historical applicability/);
assert.doesNotMatch(currentSnapshotIssue.applicationReason, /31\/07\/2026/,
  'the historical gap is not bypassed by calculating from a current snapshot');

const b3MissingFactsQuery = 'When is my company annual return due? I have not provided its financial year end, listing status or overseas branch register status. Identify the missing facts; do not assume them or prepare a journal.';
const b3IssuePlan = semanticIssues([plannedIssue({
  id: 'b3-acra-deadline', authority: 'ACRA', domain: 'ACRA_CORPORATE', subject: 'annual-return filing deadline',
  mappedTopicIds: ['acra_annual-returns'], operation: 'EXPLAIN_RULE'
})]);
const b3Workstreams = await buildAuthorityWorkstreams(b3MissingFactsQuery, b3IssuePlan, {
  referenceDate: '2026-10-19', localOnly: true,
  providers: { ACRA: { authority: 'ACRA', retrieve: async () => ({ candidates: [] }) } }
});
const b3Issue = b3Workstreams.workstreams.flatMap(stream => stream.issues)[0];
assert.equal(b3Issue.applicationStatus, 'UNRESOLVED');
assert.match(b3Issue.applicationReason, /financial year end, listing status, overseas branch register status/,
  'the missing-facts case names each required company fact and does not assume a default');
assert.doesNotMatch(b3Issue.applicationReason, /\b\d{1,2}\/\d{2}\/\d{4}\b/);
assert.deepEqual(b3Issue.sources, []);
assert.deepEqual(b3Workstreams.workstreams.flatMap(stream => stream.issues.flatMap(issue => issue.verifiedClaims)), []);

const b3Interpretation = {
  schemaVersion: 2, jurisdiction: ['Singapore'], authorityCandidates: ['ACRA'], contextualAuthorities: [],
  domain: 'ACRA_CORPORATE', population: 'COMPANY', primarySubject: 'company annual return due date and filing requirements',
  concepts: [{ concept: 'filing due date', role: 'PRIMARY' }], requestedOperation: 'EXPLAIN_RULE', factsExplicitlyProvided: [], confidence: 0.96,
  issues: [{ subject: 'company annual return due date and filing requirements', population: 'COMPANY', domain: 'ACRA_CORPORATE',
    governingAuthorities: ['ACRA'], contextualAuthorities: [], operation: 'EXPLAIN_RULE',
    mappedTopicIds: ['acra_annual-returns'], evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 0.96 }]
};
const b3SemanticConcepts = getRequestedQuestionConcepts(b3MissingFactsQuery, b3Interpretation);
assert.ok(b3SemanticConcepts.some(concept => concept.id === 'acra_annual_return_filing_deadline'));
assert.ok(!b3SemanticConcepts.some(concept => concept.id === 'semantic_filing_due_date'),
  'the filing due-date semantic alias is covered by the canonical annual-return deadline concept');
assert.deepEqual(b3Interpretation.concepts, [{ concept: 'filing due date', role: 'PRIMARY' }],
  'covering the semantic alias preserves the raw provider diagnostic');
for (const alias of [
  'due date', 'filing deadline', 'filing due date', 'annual return deadline',
  'annual return due date', 'annual return filing deadline', 'annual return filing due date'
]) {
  const aliasConcepts = getRequestedQuestionConcepts(b3MissingFactsQuery, {
    ...b3Interpretation, concepts: [{ concept: alias, role: 'RELATED' }]
  });
  assert.ok(!aliasConcepts.some(concept => concept.label === alias),
    `the bounded annual-return deadline alias is covered: ${alias}`);
}
const b3ExtendedDeadlineInterpretation = {
  ...b3Interpretation, concepts: [{ concept: 'filing due date extension', role: 'PRIMARY' }]
};
const b3ExtendedDeadlineUnderstanding = {
  mode: 'SEMANTIC_INTERPRETATION', assessmentStatus: 'PASSED', interpretation: b3ExtendedDeadlineInterpretation
};
const b3ExtendedDeadlineConcepts = getRequestedQuestionConcepts(b3MissingFactsQuery, b3ExtendedDeadlineUnderstanding);
assert.ok(b3ExtendedDeadlineConcepts.some(concept => concept.label === 'filing due date extension'),
  'a semantic deadline label with an extra condition remains material');
const b3ExtendedDeadlinePlan = b1IssuePlanFor(b3MissingFactsQuery, b3ExtendedDeadlineUnderstanding);
const b3ExtendedDeadlineWorkstreams = await buildAuthorityWorkstreams(b3MissingFactsQuery, b3ExtendedDeadlinePlan, {
  referenceDate: '2026-10-19', localOnly: true,
  questionUnderstanding: b3ExtendedDeadlineUnderstanding,
  providers: { ACRA: { authority: 'ACRA', retrieve: async () => ({ candidates: [] }) } }
});
const b3ExtendedDeadlinePresentation = createAuthorityEvidencePresentation(b3ExtendedDeadlineWorkstreams);
assert.ok(b3ExtendedDeadlinePresentation.gaps.some(gap => /filing due date extension.*not assigned/i.test(gap)),
  'the extra semantic condition remains a whole-question unassigned gap');
assert.equal(b3ExtendedDeadlinePresentation.workstreams.flatMap(stream => stream.issues)[0].applicationStatus, 'UNRESOLVED',
  'retaining an extra semantic condition does not invent an annual-return deadline');
let b3SemanticCalls = 0;
const b3UnexpectedModelCalls = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname !== 'generativelanguage.googleapis.com') return new Response('', { status: 404 });
  const payload = JSON.parse(init?.body || '{}');
  const prompt = payload.contents?.flatMap(item => item.parts || []).map(part => part.text || '').join('\n') || '';
  if (prompt.includes('Return a V2 JSON object')) {
    b3SemanticCalls++;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(b3Interpretation) }] } }] }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  }
  b3UnexpectedModelCalls.push(prompt);
  return new Response('', { status: 404 });
};
let b3RuntimeResponse;
let b3RuntimeError;
try {
  b3RuntimeResponse = await processAccountingQuery(b3MissingFactsQuery, null, 'SFRS_I', 'test-key-1234567890');
} catch (error) {
  b3RuntimeError = error;
} finally {
  globalThis.fetch = originalFetch;
}
assert.ifError(b3RuntimeError);
assert.equal(b3SemanticCalls, 1, 'the exact B3 request receives one mocked semantic interpretation');
assert.deepEqual(b3UnexpectedModelCalls, [], 'the missing-facts request cannot escape to an ungoverned legacy answer');
assert.ok(b3RuntimeResponse.scenarioState.authorityEvidencePresentation,
  'the exact B3 request remains in the whole-question authority renderer');
assert.equal(b3RuntimeResponse.scenarioState.authorityEvidencePresentation.status, 'INSUFFICIENT');
const b3RuntimePresentation = b3RuntimeResponse.scenarioState.authorityEvidencePresentation;
assert.deepEqual(b3RuntimeResponse.scenarioState.authorityEvidencePresentation.workstreams.map(stream => stream.authority), ['ACRA'],
  'the full route does not introduce a VCC or unrelated authority workstream');
assert.equal(b3RuntimeResponse.scenarioState.authorityEvidencePresentation.workstreams.flatMap(stream => stream.issues)[0].subject,
  'company annual return due date and filing requirements', 'the full route preserves the original bounded semantic subject');
assert.equal(b3RuntimePresentation.workstreams.flatMap(stream => stream.issues)[0].applicationStatus, 'UNRESOLVED',
  'the missing company facts keep the deadline application unresolved');
assert.ok(!b3RuntimePresentation.gaps.some(gap => /filing due date|unassigned|unrouted/i.test(gap)),
  'the covered filing due-date alias does not create a topicless or unassigned gap');
assert.match(b3RuntimeResponse.messageText, /financial year end, listing status, overseas branch register status/i,
  'the rendered answer explicitly names all missing company facts');
assert.deepEqual(b3RuntimeResponse.scenarioState.directGroups, [], 'a missing-facts filing question does not prepare a journal');

for (const [index, query] of b3MissingFactsParaphrases.entries()) {
  let semanticCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname !== 'generativelanguage.googleapis.com') return new Response('', { status: 404 });
    const payload = JSON.parse(init?.body || '{}');
    const prompt = payload.contents?.flatMap(item => item.parts || []).map(part => part.text || '').join('\n') || '';
    if (prompt.includes('Return a V2 JSON object')) {
      semanticCalls++;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(b3Interpretation) }] } }] }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    }
    return new Response('', { status: 404 });
  };
  let response;
  let error;
  try {
    response = await processAccountingQuery(query, null, 'SFRS_I', 'test-key-1234567890');
  } catch (caught) {
    error = caught;
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.ifError(error);
  assert.equal(semanticCalls, 1, `B3 paraphrase ${index + 1} uses one mocked semantic interpretation`);
  const presentation = response.scenarioState.authorityEvidencePresentation;
  assert.ok(presentation, `B3 paraphrase ${index + 1} stays on the authority evidence route`);
  assert.equal(presentation.status, 'INSUFFICIENT');
  assert.match(response.messageText, /financial year end/i,
    `B3 paraphrase ${index + 1} names the missing financial year end`);
  assert.match(response.messageText, /listing status/i,
    `B3 paraphrase ${index + 1} names the missing listing status`);
  assert.match(response.messageText, /overseas branch register status/i,
    `B3 paraphrase ${index + 1} names the missing branch-register status`);
  assert.doesNotMatch(response.messageText, /\b\d{2}\/\d{2}\/\d{4}\b/,
    `B3 paraphrase ${index + 1} does not invent a deadline`);
  assert.deepEqual(response.scenarioState.directGroups, [],
    `B3 paraphrase ${index + 1} does not produce a journal`);
}

let companyFreeSemanticCalls = 0;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname !== 'generativelanguage.googleapis.com') return new Response('', { status: 404 });
  const payload = JSON.parse(init?.body || '{}');
  const prompt = payload.contents?.flatMap(item => item.parts || []).map(part => part.text || '').join('\n') || '';
  if (prompt.includes('Return a V2 JSON object')) {
    companyFreeSemanticCalls++;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(b3Interpretation) }] } }] }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  }
  return new Response('', { status: 404 });
};
let companyFreeAnnualReturnResponse;
let companyFreeAnnualReturnError;
try {
  companyFreeAnnualReturnResponse = await processAccountingQuery(
    companyFreeAnnualReturnQuery, null, 'SFRS_I', 'test-key-1234567890'
  );
} catch (error) {
  companyFreeAnnualReturnError = error;
} finally {
  globalThis.fetch = originalFetch;
}
assert.ifError(companyFreeAnnualReturnError);
const companyFreePresentation = companyFreeAnnualReturnResponse.scenarioState.authorityEvidencePresentation;
assert.equal(companyFreeSemanticCalls, 1);
assert.ok(!companyFreePresentation || companyFreePresentation.status === 'INSUFFICIENT',
  'a company-free annual-return question does not receive a verified company-specific answer');
assert.ok(!companyFreePresentation?.workstreams.some(stream => stream.issues.some(issue => issue.applicationStatus === 'VERIFIED')),
  'missing company ownership cannot activate ordinary-company deadline application');
assert.doesNotMatch(companyFreeAnnualReturnResponse.messageText, /\b\d{2}\/\d{2}\/\d{4}\b/,
  'a company-free missing-facts request does not calculate an unsupported deadline');
assert.ok(companyFreeAnnualReturnResponse.scenarioState.directGroups.every(group => !group.lines?.length),
  'a company-free missing-facts request does not prepare a journal');

const unassertedAnnualReturnRouteQuery = 'For my Singapore-incorporated non-listed company, what is its annual-return filing deadline if we do not assume a financial year end of 31/12/2025 and it may have an overseas branch register?';
let unassertedAnnualReturnSemanticCalls = 0;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname !== 'generativelanguage.googleapis.com') return new Response('', { status: 404 });
  const payload = JSON.parse(init?.body || '{}');
  const prompt = payload.contents?.flatMap(item => item.parts || []).map(part => part.text || '').join('\n') || '';
  if (prompt.includes('Return a V2 JSON object')) {
    unassertedAnnualReturnSemanticCalls++;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(b3Interpretation) }] } }] }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  }
  return new Response('', { status: 404 });
};
let unassertedAnnualReturnResponse;
let unassertedAnnualReturnError;
try {
  unassertedAnnualReturnResponse = await processAccountingQuery(
    unassertedAnnualReturnRouteQuery, null, 'SFRS_I', 'test-key-1234567890'
  );
} catch (error) {
  unassertedAnnualReturnError = error;
} finally {
  globalThis.fetch = originalFetch;
}
assert.ifError(unassertedAnnualReturnError);
assert.equal(unassertedAnnualReturnSemanticCalls, 1);
const unassertedAnnualReturnPresentation = unassertedAnnualReturnResponse.scenarioState.authorityEvidencePresentation;
assert.ok(unassertedAnnualReturnPresentation, 'the unasserted FYE remains on the ACRA issue route');
const unassertedAnnualReturnIssue = unassertedAnnualReturnPresentation.workstreams
  .find(stream => stream.authority === 'ACRA')?.issues[0];
assert.equal(unassertedAnnualReturnIssue?.applicationStatus, 'UNRESOLVED');
assert.match(unassertedAnnualReturnIssue?.applicationReason || '', /financial year end.*not assumed/i);
assert.match(unassertedAnnualReturnIssue?.applicationReason || '', /overseas branch register status.*uncertain/i);
assert.doesNotMatch(unassertedAnnualReturnIssue?.applicationReason || '', /\b\d{1,2}\/\d{2}\/\d{4}\b/);
assert.deepEqual(unassertedAnnualReturnResponse.scenarioState.directGroups, []);

const b3NoProviderFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('No-provider B3 regression must stay offline.'); };
let b3NoProviderResponse;
try {
  b3NoProviderResponse = await processAccountingQuery(b3MissingFactsQuery, null, 'SFRS_I');
} finally {
  globalThis.fetch = b3NoProviderFetch;
}
assert.ok(b3NoProviderResponse.scenarioState.authorityEvidencePresentation,
  'the raw-input fallback also stays on the ACRA evidence route without a semantic provider');
assert.equal(b3NoProviderResponse.scenarioState.authorityEvidencePresentation.status, 'INSUFFICIENT');
assert.deepEqual(b3NoProviderResponse.scenarioState.authorityEvidencePresentation.workstreams.map(stream => stream.authority), ['ACRA']);
assert.match(b3NoProviderResponse.messageText, /financial year end, listing status, overseas branch register status/i);
assert.deepEqual(b3NoProviderResponse.scenarioState.directGroups, []);

const b4IssuePlan = semanticIssues([
  plannedIssue({ id: 'b4-cpf-rates', authority: 'CPF', domain: 'CPF_PAYROLL', subject: 'employee CPF contribution rates',
    population: 'EMPLOYEE', mappedTopicIds: ['cpf_contribution_rates'], operation: 'EXPLAIN_RULE' }),
  plannedIssue({ id: 'b4-iras-relief', authority: 'IRAS', domain: 'IRAS_INCOME_TAX', subject: 'employee CPF personal income tax relief',
    population: 'INDIVIDUAL', mappedTopicIds: ['iras-individual-cpf-relief'], operation: 'EXPLAIN_RULE',
    contextualAuthorities: ['CPF'] })
]);
const emptyAuthorityProvider = authority => ({ authority, retrieve: async () => ({ candidates: [] }) });
const b4Workstreams = await buildAuthorityWorkstreams(b4CpfIrasQuery, b4IssuePlan, {
  referenceDate: '2026-10-19', localOnly: true,
  providers: { CPF: emptyAuthorityProvider('CPF'), IRAS: emptyAuthorityProvider('IRAS') }
});
const b4Presentation = createAuthorityEvidencePresentation(b4Workstreams);
const b4Issues = b4Presentation.workstreams.flatMap(stream => stream.issues);
assert.ok(b4Presentation.workstreams.some(stream => stream.authority === 'CPF' && stream.domain === 'CPF_PAYROLL'));
assert.ok(b4Presentation.workstreams.some(stream => stream.authority === 'IRAS' && stream.domain === 'IRAS_INDIVIDUAL_TAX'));
assert.ok(b4Issues.every(issue => issue.evidenceStatus === 'INSUFFICIENT'),
  'the CPF rate and IRAS relief issues remain independently insufficient without their own admitted evidence');
assert.deepEqual(b4Presentation.workstreams.flatMap(stream => stream.sources), [],
  'the CPF/IRAS case does not manufacture evidence or borrow sources across authorities');
assert.deepEqual(b4Presentation.workstreams.flatMap(stream => stream.issues.flatMap(issue => issue.claims)), []);
assert.equal(b4Presentation.status, 'INSUFFICIENT');
assert.doesNotMatch(renderAuthorityEvidenceResponseText(b4Presentation, false), /journal/i);

const weakCpfRateQuotes = [
  'CPF contributions are payable to employees who are Singapore Citizens and Singapore Permanent Residents (SPRs) at current CPF contribution rates. Learn how to calculate the amount of CPF contributions you need to pay.',
  'Contribution rates from 1 January 2026',
  "CPF contribution rates vary based on your employee's citizenship status, age group, and total wages. As an employer, you are required to pay CPF contributions for your employees who are Singapore Citizens or Singapore Permanent Residents and who are earning total wages of more than $50 per month."
];
const weakCpfRateFixture = {
  ...UNIFIED_SOURCE_REGISTRY.CPF_WAGE_CEILINGS_2026,
  id: 'TEST_ONLY_CPF_GENERIC_RATE_EXCERPTS',
  sourceText: weakCpfRateQuotes.join('\n\n'),
  relatedTopicIds: ['cpf_contribution_rates'],
  tags: ['cpf_contribution_rates']
};
const weakCpfRateClaims = weakCpfRateQuotes.map(quote => ({
  text: quote,
  quote,
  recordId: weakCpfRateFixture.id,
  supportKind: 'EXACT_SOURCE_QUOTE'
}));
const weakCpfRateWorkstreams = await withTemporaryRegistrySource(weakCpfRateFixture, () => buildAuthorityWorkstreams(
  b4CpfIrasQuery, b4IssuePlan, {
    referenceDate: '2026-10-19', localOnly: true,
    providers: {
      CPF: { authority: 'CPF', retrieve: async () => ({ candidates: [weakCpfRateFixture], claims: weakCpfRateClaims }) },
      IRAS: emptyAuthorityProvider('IRAS')
    }
  }
));
const weakCpfRatePresentation = createAuthorityEvidencePresentation(weakCpfRateWorkstreams);
const weakCpfIssue = weakCpfRatePresentation.workstreams.find(stream => stream.authority === 'CPF')?.issues[0];
const weakCpfRuntimeIssue = weakCpfRateWorkstreams.workstreams.find(stream => stream.authority === 'CPF')?.issues[0];
assert.equal(weakCpfIssue?.evidenceStatus, 'INSUFFICIENT',
  'generic CPF intro, date heading, and eligibility factors do not cover a numeric rate request');
assert.equal(weakCpfRuntimeIssue?.lifecycle.admitted, true,
  'the negative rate result is tested after the weak excerpts pass source admission');
assert.deepEqual(weakCpfIssue?.claims, [], 'the generic excerpts cannot be presented as verified numeric CPF rate claims');
assert.ok(weakCpfRateWorkstreams.workstreams.find(stream => stream.authority === 'CPF')?.issues[0].gaps
  .some(gap => gap.code === 'CPF_RATE_SCHEDULE_UNVERIFIED'),
  'the rate issue names the absent independently validated schedule mechanism');
assert.deepEqual(weakCpfRatePresentation.workstreams.find(stream => stream.authority === 'CPF')?.sources, [],
  'a heading-only CPF source is not presented as support for the rate issue');
assert.equal(weakCpfRatePresentation.workstreams.find(stream => stream.authority === 'IRAS')?.issues[0].evidenceStatus, 'INSUFFICIENT',
  'CPF rate evidence cannot satisfy the independently owned IRAS relief question');
assert.equal(weakCpfRatePresentation.status, 'INSUFFICIENT');

const firstYearSprRateQuery = 'What are the 2026 CPF rates for a first-year Singapore Permanent Resident employee aged 45?';
const cpfRateOnlyPlan = (query, subjectOverride) => semanticIssues([plannedIssue({ id: 'cpf-rate-only', authority: 'CPF', domain: 'CPF_PAYROLL',
  subject: subjectOverride || (query.includes('first-year') ? 'first-year SPR employee CPF contribution rates' : 'employee CPF contribution rates'),
  population: 'EMPLOYEE', mappedTopicIds: ['cpf_contribution_rates'], operation: 'EXPLAIN_RULE' })]);
const adversarialCpfRateCases = [
  {
    query: b4CpfIrasQuery,
    quote: '2026 CPF contribution rates for Singapore citizens aged 55 and below with total monthly wages apply the citizen age band; for employees aged above 60 to 65 with total monthly wages, employer contributions are 12% and employee contributions are 7%.'
  },
  {
    query: firstYearSprRateQuery,
    quote: '2026 CPF contribution rates for first-year Singapore Permanent Residents aged 55 and below depend on total monthly wages; for third-year Singapore Permanent Residents aged above 60 to 65, employer contributions are 12% and employee contributions are 7%.'
  },
  {
    query: 'What rates apply to CPF contributions in 2026 for a Singapore citizen aged 45?',
    subject: 'employer and employee contribution rates',
    quote: 'Employer and employee contribution rates are part of employer CPF obligations. For Singapore citizens aged 45, 2026 CPF contribution rates depend on the applicable age band; for Singapore citizens aged above 60 to 65 with total monthly wages, employer contributions are 12% and employee contributions are 7%.'
  },
  {
    query: 'What rates apply to CPF contributions in 2026 for a Singapore citizen aged 45?',
    subject: 'employer CPF obligations',
    quote: 'Employer and employee contribution rates are part of employer CPF obligations. For Singapore citizens aged 45, 2026 CPF contribution rates depend on the applicable age band; for Singapore citizens aged above 60 to 65 with total monthly wages, employer contributions are 12% and employee contributions are 7%.'
  }
];
for (const [index, adversarial] of adversarialCpfRateCases.entries()) {
  const recordId = `TEST_ONLY_CPF_ADVERSARIAL_RATE_QUOTE_${index + 1}`;
  const record = {
    ...UNIFIED_SOURCE_REGISTRY.CPF_WAGE_CEILINGS_2026,
    id: recordId,
    sourceText: adversarial.quote,
    relatedTopicIds: ['cpf_contribution_rates'],
    tags: ['cpf_contribution_rates']
  };
  const workstreams = await withTemporaryRegistrySource(record, () => buildAuthorityWorkstreams(
    adversarial.query, cpfRateOnlyPlan(adversarial.query, adversarial.subject), {
      referenceDate: '2026-10-19', localOnly: true,
      providers: { CPF: { authority: 'CPF', retrieve: async () => ({ candidates: [record], claims: [{
        text: adversarial.quote, quote: adversarial.quote, recordId, supportKind: 'EXACT_SOURCE_QUOTE'
      }] }) } }
    }
  ));
  const rateIssue = workstreams.workstreams.find(stream => stream.authority === 'CPF')?.issues[0];
  assert.equal(rateIssue?.lifecycle.admitted, true,
    `the adversarial age/population quote is admitted before rate coverage is withheld (${recordId}): ${JSON.stringify(rateIssue)}`);
  assert.equal(rateIssue?.evidenceStatus, 'INSUFFICIENT',
    `cross-band or cross-population percentages cannot verify the requested rate schedule (${recordId})`);
  assert.deepEqual(rateIssue?.verifiedClaims, [], 'the runtime emits no unvalidated CPF rate claims');
  assert.deepEqual(rateIssue?.sources, [], 'the rate source is not cited as verified support');
  assert.ok(rateIssue?.gaps.some(gap => gap.code === 'CPF_RATE_SCHEDULE_UNVERIFIED'));
}
const mixedNonRateCpfIrasRateQuery = 'What is the IRAS corporate income tax rate, and what employer CPF obligations apply to this employee?';
const mixedNonRateCpfIrasRate = await buildAuthorityWorkstreams(mixedNonRateCpfIrasRateQuery, semanticIssues([
  plannedIssue({ id: 'cpf-obligations-non-rate', authority: 'CPF', domain: 'CPF_PAYROLL',
    subject: 'employer CPF obligations', population: 'EMPLOYEE', mappedTopicIds: ['cpf_contribution_rates'] }),
  plannedIssue({ id: 'iras-corporate-rate', authority: 'IRAS', domain: 'IRAS_INCOME_TAX',
    subject: 'corporate income tax rate', population: 'COMPANY', mappedTopicIds: ['iras-cit-tax-rate'] })
]), {
  referenceDate: '2026-10-19', localOnly: true,
  providers: { CPF: emptyAuthorityProvider('CPF'), IRAS: emptyAuthorityProvider('IRAS') }
});
const mixedCpfIssue = mixedNonRateCpfIrasRate.workstreams.find(stream => stream.authority === 'CPF')?.issues[0];
assert.equal(mixedCpfIssue?.evidenceStatus, 'INSUFFICIENT');
assert.ok(!mixedCpfIssue?.gaps.some(gap => gap.code === 'CPF_RATE_SCHEDULE_UNVERIFIED'),
  'an IRAS rate question does not trigger the dedicated CPF rate-schedule gap for a separate CPF-obligations issue');

const b4Interpretation = {
  schemaVersion: 2, jurisdiction: ['Singapore'], authorityCandidates: ['CPF', 'IRAS'], contextualAuthorities: ['CPF'],
  domain: 'CPF_PAYROLL', population: 'EMPLOYEE', primarySubject: 'CPF contribution rates and IRAS CPF relief',
  concepts: [], requestedOperation: 'EXPLAIN_RULE', factsExplicitlyProvided: [], confidence: 0.96,
  issues: [
    { subject: 'employee CPF contribution rates', population: 'EMPLOYEE', domain: 'CPF_PAYROLL',
      governingAuthorities: ['CPF'], contextualAuthorities: [], operation: 'EXPLAIN_RULE',
      mappedTopicIds: ['cpf_contribution_rates'], evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 0.96 },
    { subject: 'employee CPF personal income tax relief', population: 'INDIVIDUAL', domain: 'IRAS_INCOME_TAX',
      governingAuthorities: ['IRAS'], contextualAuthorities: ['CPF'], operation: 'EXPLAIN_RULE',
      mappedTopicIds: ['iras-individual-cpf-relief'], evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 0.96 }
  ]
};
let b4SemanticCalls = 0;
const b4UnexpectedModelCalls = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname !== 'generativelanguage.googleapis.com') return new Response('', { status: 404 });
  const payload = JSON.parse(init?.body || '{}');
  const prompt = payload.contents?.flatMap(item => item.parts || []).map(part => part.text || '').join('\n') || '';
  if (prompt.includes('Return a V2 JSON object')) {
    b4SemanticCalls++;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(b4Interpretation) }] } }] }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  }
  b4UnexpectedModelCalls.push(prompt);
  return new Response('', { status: 404 });
};
let b4RuntimeResponse;
let b4RuntimeError;
try {
  b4RuntimeResponse = await processAccountingQuery(b4CpfIrasQuery, null, 'SFRS_I', 'test-key-1234567890');
} catch (error) {
  b4RuntimeError = error;
} finally {
  globalThis.fetch = originalFetch;
}
assert.ifError(b4RuntimeError);
assert.equal(b4SemanticCalls, 1, 'the exact B4 request receives one mocked semantic interpretation');
assert.deepEqual(b4UnexpectedModelCalls, [], 'the unsupported CPF rate request cannot escape to a legacy answer');
assert.ok(b4RuntimeResponse.scenarioState.authorityEvidencePresentation);
assert.equal(b4RuntimeResponse.scenarioState.authorityEvidencePresentation.status, 'INSUFFICIENT');
assert.ok(b4RuntimeResponse.scenarioState.authorityEvidencePresentation.workstreams.some(stream => stream.authority === 'CPF'));
assert.ok(b4RuntimeResponse.scenarioState.authorityEvidencePresentation.workstreams.some(stream => stream.authority === 'IRAS'));
assert.deepEqual(b4RuntimeResponse.scenarioState.authorityEvidencePresentation.workstreams.flatMap(stream => stream.issues.flatMap(issue => issue.claims)), []);
assert.ok(b4RuntimeResponse.scenarioState.authorityEvidencePresentation.workstreams
  .find(stream => stream.authority === 'CPF')?.issues.some(issue => issue.gaps.some(gap => /no independently validated CPF rate-schedule parser/i.test(gap))),
'the displayed CPF issue reports that its rate schedule cannot be independently verified');
assert.deepEqual(b4RuntimeResponse.scenarioState.directGroups, [], 'the mixed statutory explanation does not produce a journal');

globalThis.fetch = async input => {
  const url = new URL(String(input));
  if (url.hostname === 'generativelanguage.googleapis.com') {
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'malformed semantic payload' }] } }] }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  }
  throw new Error(`Blocked network request in malformed-semantic test: ${url.hostname}`);
};
let malformedSemantic;
try {
  malformedSemantic = await processAccountingQuery(promptB, null, 'SFRS_I', 'test-key-1234567890');
} finally {
  globalThis.fetch = originalFetch;
}
assert.ok(malformedSemantic.scenarioState.authorityEvidencePresentation, 'malformed semantic output falls back to explicit multi-scope evidence handling');
assert.notEqual(malformedSemantic.scenarioState.authorityEvidencePresentation.status, 'VERIFIED');
assert.doesNotMatch(malformedSemantic.messageText, /the case definitely qualifies|is guaranteed to be exempt/i);

const standaloneQuery = 'What individual tax relief categories are available?';
const standaloneInterpretation = {
  schemaVersion: 2, jurisdiction: ['Singapore'], authorityCandidates: ['IRAS'], contextualAuthorities: [],
  domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL', primarySubject: 'individual tax relief categories',
  concepts: [], requestedOperation: 'EXPLAIN_RULE', factsExplicitlyProvided: [], confidence: 0.96,
  issues: [{ subject: 'individual tax relief categories', population: 'INDIVIDUAL', domain: 'IRAS_INCOME_TAX',
    governingAuthorities: ['IRAS'], contextualAuthorities: [], operation: 'EXPLAIN_RULE', mappedTopicIds: [],
    evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 0.96 }]
};
let standaloneSemanticCalls = 0;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname === 'generativelanguage.googleapis.com') {
    const payload = JSON.parse(init?.body || '{}');
    const prompt = payload.contents?.flatMap(item => item.parts || []).map(part => part.text || '').join('\n') || '';
    if (prompt.includes('Return a V2 JSON object')) {
      standaloneSemanticCalls++;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(standaloneInterpretation) }] } }] }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    }
  }
  throw new Error(`Blocked network request in standalone IRAS regression: ${url.hostname}`);
};
let standaloneIrasResponse;
try {
  standaloneIrasResponse = await processAccountingQuery(standaloneQuery, null, 'SFRS_I', 'test-key-1234567890');
} finally {
  globalThis.fetch = originalFetch;
}
assert.equal(standaloneSemanticCalls, 1, 'the standalone IRAS route interprets the query once');
assert.equal(standaloneIrasResponse.scenarioState.requestCompletenessContext.rawQuery, standaloneQuery);
assert.equal(standaloneIrasResponse.scenarioState.requestCompletenessContext.evaluation.status, 'COMPLETE');
assert.ok(standaloneIrasResponse.scenarioState.irasEvidencePresentation,
  'the standalone IRAS renderer attaches query-bound representation diagnostics');
assert.equal(standaloneIrasResponse.scenarioState.authorityEvidencePresentation, undefined,
  'a single IRAS route remains on its established response path');

const unsupportedAccountingRuleQuery = 'Explain the SFRS(I) 6 accounting treatment for exploration and evaluation assets. Explain the rule only; do not calculate amounts or prepare a journal.';
const unsupportedAccountingRuleInterpretation = {
  schemaVersion: 2, jurisdiction: ['Singapore'], authorityCandidates: ['ACCOUNTING_STANDARDS'], contextualAuthorities: [],
  domain: 'ACCOUNTING', population: 'COMPANY', primarySubject: 'SFRS(I) 6 exploration and evaluation assets',
  concepts: [{ concept: 'SFRS(I) 6', role: 'PRIMARY' }], requestedOperation: 'EXPLAIN_RULE', factsExplicitlyProvided: [], confidence: 0.96,
  issues: [{ subject: 'SFRS(I) 6 exploration and evaluation assets', population: 'COMPANY', domain: 'ACCOUNTING',
    governingAuthorities: ['ACCOUNTING_STANDARDS'], contextualAuthorities: [], operation: 'EXPLAIN_RULE', mappedTopicIds: [],
    evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 0.96 }]
};
let unsupportedAccountingSemanticCalls = 0;
const unsupportedAccountingBlockedRequests = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  const payload = JSON.parse(init?.body || '{}');
  const prompt = payload.contents?.flatMap(item => item.parts || []).map(part => part.text || '').join('\n') || '';
  if (url.hostname === 'generativelanguage.googleapis.com' && prompt.includes('Return a V2 JSON object')) {
    unsupportedAccountingSemanticCalls++;
    if (unsupportedAccountingSemanticCalls === 1) {
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(unsupportedAccountingRuleInterpretation) }] } }] }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    }
  }
  unsupportedAccountingBlockedRequests.push({ hostname: url.hostname, prompt });
  throw new Error(`Blocked non-semantic dispatch in offline unsupported-accounting regression: ${url.hostname}`);
};
let unsupportedAccountingRuleResponse;
let unsupportedAccountingRuleError;
try {
  unsupportedAccountingRuleResponse = await processAccountingQuery(
    unsupportedAccountingRuleQuery, null, 'SFRS_I', 'test-key-1234567890'
  );
} catch (error) {
  unsupportedAccountingRuleError = error;
} finally {
  globalThis.fetch = originalFetch;
}
assert.ifError(unsupportedAccountingRuleError, 'unsupported accounting explanation returns an explicit evidence gap');
assert.equal(unsupportedAccountingSemanticCalls, 1, 'unsupported accounting explanation makes exactly one semantic request');
assert.deepEqual(unsupportedAccountingBlockedRequests, [],
  'unsupported accounting explanation does not dispatch source, extraction, or legacy answer requests');
const unsupportedAccountingPresentation = unsupportedAccountingRuleResponse.scenarioState.authorityEvidencePresentation;
assert.ok(unsupportedAccountingPresentation, 'unsupported accounting explanation uses the authority evidence renderer');
assert.equal(unsupportedAccountingPresentation.status, 'INSUFFICIENT', 'unmapped accounting standards remain explicitly insufficient');
assert.equal(unsupportedAccountingRuleResponse.scenarioState.isComplete, false);
assert.deepEqual(unsupportedAccountingRuleResponse.scenarioState.directGroups, [], 'rule explanations do not create journals');
const unsupportedAccountingWorkstream = unsupportedAccountingPresentation.workstreams.find(stream =>
  stream.authority === 'ACCOUNTING_STANDARDS' && stream.domain === 'ACCOUNTING');
assert.ok(unsupportedAccountingWorkstream, 'the gap stays with the accounting-standards owner');
assert.equal(unsupportedAccountingWorkstream.evidenceStatus, 'INSUFFICIENT');
assert.ok(unsupportedAccountingWorkstream.issues.some(issue => issue.evidenceStatus === 'INSUFFICIENT'),
  'the accounting-standards issue remains explicitly insufficient');
assert.ok(unsupportedAccountingPresentation.workstreams.every(stream =>
  stream.authority !== 'IRAS' && stream.domain !== 'ACRA_CORPORATE'),
'an accounting classifier alias does not create IRAS or corporate ACRA evidence');
assert.deepEqual(unsupportedAccountingPresentation.workstreams.flatMap(stream => stream.sources), [],
  'unsupported accounting explanation has no admitted source citations');
assert.deepEqual(unsupportedAccountingPresentation.workstreams.flatMap(stream => stream.issues.flatMap(issue => issue.claims)), [],
  'unsupported accounting explanation has no verified claims');
assert.doesNotMatch(unsupportedAccountingRuleResponse.messageText, /IRAS|ACRA Companies Act|companies registry/i,
  'the response does not substitute corporate ACRA or IRAS material');

const narrowAccountingRuleIssue = plannedIssue({
  id: 'unmapped-accounting-rule', authority: 'ACCOUNTING_STANDARDS', domain: 'ACCOUNTING',
  subject: 'SFRS(I) 6 exploration and evaluation assets', status: 'UNRESOLVED', mappedTopicIds: []
});
const narrowAccountingRuleRoute = {
  issuePlan: semanticIssues([narrowAccountingRuleIssue], { coverageEstablished: false, hasUnmappedResidual: true }),
  classification: classification({
    primaryDomain: 'ACCOUNTING', domains: ['ACCOUNTING_SFRS'], authorities: ['ACRA'], multiAuthority: false,
    intent: 'STATUTORY_ADVISORY', accountingAnalysisRequired: true, taxAnalysisRequired: false,
    regulatoryAnalysisRequired: false, calculationRequired: false, journalEntryRequired: false
  }),
  semanticRequestedOperation: 'EXPLAIN_RULE',
  explicitIrasEvidenceRequest: false,
  explicitJournalRequest: false,
  outputJournalRequest: false,
  hasImages: false,
  isShortSemanticFollowUp: false
};
const canRouteUnmappedAccountingRule = (overrides = {}) =>
  shouldUseUnmappedAccountingRuleExplanationRuntime({ ...narrowAccountingRuleRoute, ...overrides });
assert.equal(canRouteUnmappedAccountingRule(), true, 'a single classifier-confirmed unmapped standards explanation can show its explicit gap');
assert.equal(canRouteUnmappedAccountingRule({
  issuePlan: semanticIssues([plannedIssue({
    id: 'mapped-accounting-rule', authority: 'ACCOUNTING_STANDARDS', domain: 'ACCOUNTING',
    subject: 'Mapped accounting rule', status: 'MAPPED', mappedTopicIds: ['sfrsi_leases']
  })])
}), false, 'mapped standards keep their established path');
assert.equal(canRouteUnmappedAccountingRule({ explicitJournalRequest: true }), false,
  'explicit journal requests keep their established path');
assert.equal(canRouteUnmappedAccountingRule({ outputJournalRequest: true }), false,
  'output-preference journal requests keep their established path');
assert.equal(canRouteUnmappedAccountingRule({ hasImages: true }), false,
  'image requests keep their established extraction path');
assert.equal(canRouteUnmappedAccountingRule({
  classification: classification({ ...narrowAccountingRuleRoute.classification, calculationRequired: true })
}), false, 'calculation requests keep their established path');
assert.equal(canRouteUnmappedAccountingRule({ semanticRequestedOperation: 'CALCULATE' }), false,
  'a semantic calculation request cannot use the rule-explanation gap route');
assert.equal(canRouteUnmappedAccountingRule({ isShortSemanticFollowUp: true }), false,
  'short semantic follow-ups keep their established path');
assert.equal(canRouteUnmappedAccountingRule({
  issuePlan: semanticIssues([
    narrowAccountingRuleIssue,
    plannedIssue({ id: 'mixed-tax-issue', authority: 'IRAS', domain: 'IRAS_INCOME_TAX', subject: 'Tax issue', status: 'UNRESOLVED', mappedTopicIds: [] })
  ], { coverageEstablished: false, hasUnmappedResidual: true })
}), false, 'mixed material issues keep their established path');
assert.equal(canRouteUnmappedAccountingRule({
  classification: classification({ ...narrowAccountingRuleRoute.classification, taxAnalysisRequired: true })
}), false, 'tax questions keep their established path');
assert.equal(canRouteUnmappedAccountingRule({ explicitIrasEvidenceRequest: true }), false,
  'explicit IRAS evidence requests keep their established path');

assert.deepEqual(acceptanceMatrixFailures, [],
  `the offline acceptance matrix has unresolved cases: ${acceptanceMatrixFailures.join('; ')}`);
console.log('Authority evidence presentation and routing regressions passed.');
