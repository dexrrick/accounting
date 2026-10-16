import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createAuthorityEvidencePresentation, hasCurrentAuthorityEvidencePresentation } from '../../src/utils/authorityEvidencePresentation.ts';
import { shouldUseAuthorityEvidenceRuntime } from '../../src/utils/authorityEvidenceRouting.ts';
import { createChatPreview } from '../../src/utils/chatPresentation.ts';
import { ComplianceRationale } from '../../src/components/ComplianceRationale.tsx';
import { InputHandlerPanel } from '../../src/components/InputHandlerPanel.tsx';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { createRequestCompletenessContext, ensureRequestCompletenessContext } from '../../src/services/requestCompleteness.ts';
import { defaultQueryTopicResolver } from '../../src/retrieval/queryTopicResolver.ts';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';

function source({ id, authority, title, validFrom = '2026-01-01', validTo, officialSourceUrl = '', domain = authority === 'IRAS' ? 'IRAS_TAX' : 'CPF_PAYROLL' }) {
  return {
    id,
    authority,
    authorityName: authority,
    sourcePublisher: `${authority} publisher`,
    legalOrStandardInstrument: `${authority} guidance`,
    documentTitle: title,
    standardOrActCode: `${authority}-GUIDE`,
    paragraphOrSection: 'Guidance',
    sourceText: 'A complete paragraph from the reviewed source.',
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
    groundingEligible: true
  };
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

function plannedIssue({ id, authority, domain, subject, population = 'COMPANY', status = 'MAPPED', mappedTopicIds = ['test-topic'] }) {
  return {
    id,
    subject,
    population,
    domain,
    governingAuthorities: [authority],
    contextualAuthorities: [],
    operation: 'EXPLAIN_RULE',
    mappedTopicIds,
    evidenceRequirement: 'AUTHORITATIVE_SOURCE',
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
assert.equal(presentation.status, 'VERIFIED');
assert.equal(presentation.workstreams.length, 2);
assert.equal(presentation.workstreams[0].issues[0].population, 'Company');
assert.equal(presentation.workstreams[1].issues[0].population, 'Employer');
assert.equal(presentation.workstreams[0].sources.length, 1, 'same source is grouped once within a workstream');
assert.equal(presentation.workstreams[0].sources[0].claims.length, 2, 'distinct exact and reviewed claims remain visible');
assert.deepEqual(presentation.workstreams[0].sources[0].claims[0].issueIds, ['iras-company-issue']);
assert.equal(presentation.workstreams[0].sources[0].claims[1].supportKind, 'REVIEWED_EDITORIAL_SUMMARY');
assert.equal(presentation.workstreams[0].sources[0].validFrom, '2026-01-01');
assert.ok(hasCurrentAuthorityEvidencePresentation(presentation, result.query));
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
  assert.match(livePanel, /All requested evidence verified/);

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
  assert.match(conditionalPanel, /Evidence verified; application unresolved/);

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
assert.match(createChatPreview('legacy unsupported statutory prose', freshScenario), /Verified evidence covers the resolved material workstreams/);
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
let acraDeadlineResponse;
try {
  acraDeadlineResponse = await processAccountingQuery(acraDeadlineQuery, null, 'SFRS_I');
} finally {
  globalThis.fetch = acraDeadlineFetch;
}
const acraDeadlinePresentation = acraDeadlineResponse.scenarioState.authorityEvidencePresentation;
assert.ok(acraDeadlinePresentation, 'the standalone company deadline request uses authority evidence presentation');
assert.equal(acraDeadlinePresentation.status, 'INSUFFICIENT',
  'without a provider or successful source retrieval the deadline remains explicitly unverified');
assert.equal(acraDeadlinePresentation.query, acraDeadlineQuery, 'the evidence projection retains the exact original query');
assert.equal(acraDeadlineResponse.scenarioState.rawQuery, acraDeadlineQuery, 'the standalone response retains the original scope');
assert.equal(acraDeadlineResponse.scenarioState.requestCompletenessContext.rawQuery, acraDeadlineQuery);
assert.equal(acraDeadlineResponse.scenarioState.isComplete, false, 'missing evidence cannot produce a complete statutory answer');
assert.deepEqual(acraDeadlineResponse.scenarioState.directGroups, [], 'a statutory deadline question does not create a journal');
assert.ok(acraDeadlinePresentation.workstreams.some(stream => stream.authority === 'ACRA' && stream.domain === 'ACRA_CORPORATE' &&
  stream.issues.length > 0), 'the preserved issue remains in ACRA corporate scope');
assert.doesNotMatch(acraDeadlineResponse.messageText, /variable capital company|\bVCC\b/i,
  'the company deadline answer does not inherit unrelated VCC editorial material');
assert.doesNotMatch(acraDeadlineResponse.messageText, /\b(?:within|no later than)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:days?|weeks?|months?)\b|\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i,
  'the offline response does not invent a filing deadline');

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

console.log('Authority evidence presentation and routing regressions passed.');
