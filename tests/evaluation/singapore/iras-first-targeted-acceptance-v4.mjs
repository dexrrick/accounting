// API-free V4 harness draft, deliberately unregistered; no preregistration or live authorization.
// Nine-case localOnly runtime observations and synthetic discovery outcomes are checked; the full governed negative-control matrix remains pending.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, open, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { classifyQuestion } from '../../../src/classification/questionClassifier.ts';
import { defaultQueryTopicResolver } from '../../../src/retrieval/queryTopicResolver.ts';
import { getCoverageTopicById } from '../../../src/standards/coverageRegistry.ts';
import {
  SEMANTIC_QUESTION_TIMEOUT_MS,
  SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA,
  getRequestedQuestionConcepts,
  interpretSemanticQuestion,
  reconcileQuestionUnderstanding,
  validateSemanticQuestionInterpretation
} from '../../../src/services/semanticQuestionUnderstanding.ts';
import { matchIssuesV2, scoreIssueDimensionsV2 } from './multi-authority-issue-scoring-v2.mjs';
import { diagnoseSemanticResponse } from './semantic-contract-diagnosis.mjs';
import { loadIrasFirstV2TargetedCases } from './semantic-contract-followup-evaluation.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const CONTRACT_PATH = 'tests/evaluation/singapore/iras-first-targeted-acceptance-v4.json';
export const PROFILE = 'iras-first-targeted-acceptance-v4';
export const CASE_IDS = Object.freeze([
  'target-relief-entitlement', 'target-relief-amount', 'A-paraphrase-2', 'private-expense-treatment',
  'foreign-dividend-receipt-treatment', 'corporate-residency-general-rule', 'wht-royalty-general-rule',
  'gst-input-tax-general-rule', 'unsupported-sfrsi-6-exploration-evaluation'
]);
export const FAILURE_STAGES = Object.freeze([
  'SEMANTIC_VALIDATION', 'SEMANTIC_ISSUE_IDENTITY', 'SEMANTIC_DIMENSIONS', 'TOPIC_OWNERSHIP',
  'REQUESTED_CONCEPT_OWNERSHIP', 'WORKSTREAM_ROUTING', 'LOCAL_CAPABILITY', 'GOVERNED_RETRIEVAL',
  'EVIDENCE_ADMISSION', 'CLAIM_VERIFICATION', 'REQUESTED_CONCEPT_COVERAGE', 'APPLICATION_STATUS',
  'OVERALL_STATUS', 'INTEGRITY'
]);
export const RESOURCE_POLICY = Object.freeze({
  provider: 'gemini', model: 'gemini-3.5-flash-lite', expectedCalls: 9, callsPerCase: 1, retries: 0,
  timeoutMs: 8000, temperature: 0, jsonMode: true, maximumSemanticResponseBytes: 65_536, minimumStartGapMs: 15_250,
  reserveFloor: { fiveHourRemainingPercent: 7, weeklyRemainingPercent: 3, checkpointBufferPercentagePoints: 1 },
  allowanceRequiredBeforeReservation: true, sharedAllowanceMustBeIndependentlyReadable: true,
  authorizedGeminiCalls: 9, geminiQuotaMustNotBeAssumed: true,
  executionNodeMajor: 22, finalProfileSupported: false
});
export const FUTURE_EVIDENCE_POLICY = Object.freeze({
  evidenceMode: 'governedProductionEvidence', transportMode: 'frozenContemporaneousCapture',
  maximumCaptureAgeHours: 24, captureMaximumRequests: 60, captureMaximumRequestsPerFamily: 10,
  captureRetries: 0, liveNetworkDuringSemanticRun: false, missingResponseBehavior: 'FAIL_CLOSED',
  ambientFetchBehavior: 'THROW', productionRetriever: 'defaultAdvancedSourceRetriever',
  replayReentersProductionAdmissionVerificationAndCoverage: true,
  captureBindsContractProductionSourceSchemaPromptAndProvenance: true,
  syntheticFixturesProveCurrentIrasContent: false
});

const POLICY = Object.freeze({
  'target-relief-entitlement': {
    topicOwners: [{ topicId: 'iras-individual-cpf-relief', issueId: 'personal-cpf-relief', role: 'GOVERNING' }],
    routingTopicOwners: [{ topicId: 'iras-individual-reliefs', issueId: 'personal-cpf-relief', childTopicIds: ['iras-individual-cpf-relief'] }],
    contextualTopicOwners: [{ topicId: 'cpf_contribution_rates', issueId: 'personal-cpf-relief' }],
    requiredSubjectMarkers: [{ issueId: 'personal-cpf-relief', all: ['tax', 'relief', 'cpf'] }],
    materialConcepts: [{ id: 'cpf_relief', issueId: 'personal-cpf-relief', topicIds: ['iras-individual-cpf-relief'], allTerms: ['cpf', 'relief'], requireExtractedConcept: true }],
    canonicalWorkstreamsAnyOf: [['IRAS/IRAS_INDIVIDUAL_TAX']], factsRequired: true,
    localCapability: { IRAS: 'EXPECTED_LOCAL_GAP' },
    localIssueCapability: { 'personal-cpf-relief': 'EXPECTED_LOCAL_GAP' },
    localTopicCapability: { 'iras-individual-cpf-relief': 'EXPECTED_LOCAL_GAP' },
    governed: { required: true, issueRuleEvidence: { 'personal-cpf-relief': 'VERIFIED' } },
    application: { 'personal-cpf-relief': 'UNRESOLVED' }, allowedOverall: ['CONDITIONAL'],
    negatives: ['contextual CPF must not create a CPF payroll issue', 'cpf_contribution_rates must not remain an unrepresented material residual', 'application must remain UNRESOLVED']
  },
  'target-relief-amount': {
    topicOwners: [{ topicId: 'iras-individual-cpf-relief', issueId: 'personal-cpf-relief-amount', role: 'GOVERNING' }],
    routingTopicOwners: [{ topicId: 'iras-individual-reliefs', issueId: 'personal-cpf-relief-amount', childTopicIds: ['iras-individual-cpf-relief'] }],
    contextualTopicOwners: [{ topicId: 'cpf_contribution_rates', issueId: 'personal-cpf-relief-amount' }],
    requiredSubjectMarkers: [{ issueId: 'personal-cpf-relief-amount', all: ['tax', 'relief', 'cpf'] }],
    materialConcepts: [{ id: 'cpf_relief', issueId: 'personal-cpf-relief-amount', topicIds: ['iras-individual-cpf-relief'], allTerms: ['cpf', 'relief'], requireExtractedConcept: true }],
    canonicalWorkstreamsAnyOf: [['IRAS/IRAS_INDIVIDUAL_TAX']], factsRequired: true,
    localCapability: { IRAS: 'EXPECTED_LOCAL_GAP' },
    localIssueCapability: { 'personal-cpf-relief-amount': 'EXPECTED_LOCAL_GAP' },
    localTopicCapability: { 'iras-individual-cpf-relief': 'EXPECTED_LOCAL_GAP' },
    governed: { required: true, issueRuleEvidence: { 'personal-cpf-relief-amount': 'VERIFIED' } },
    application: { 'personal-cpf-relief-amount': 'UNRESOLVED' }, allowedOverall: ['CONDITIONAL'],
    negatives: ['tax-relief amount must not become CPF contribution-rate calculation', 'contextual CPF must not create a payroll issue', 'application must remain UNRESOLVED']
  },
  'A-paraphrase-2': {
    topicOwners: [
      { topicId: 'iras-individual-cpf-relief', issueId: 'individual-cpf-tax-relief', role: 'GOVERNING' },
      { topicId: 'cpf_contribution_rates', issueId: 'employer-cpf-contribution', role: 'GOVERNING' }
    ], routingTopicOwners: [{ topicId: 'iras-individual-reliefs', issueId: 'individual-cpf-tax-relief', childTopicIds: ['iras-individual-cpf-relief'] }],
    contextualTopicOwners: [],
    requiredSubjectMarkers: [
      { issueId: 'individual-cpf-tax-relief', all: ['tax', 'relief', 'cpf'] },
      { issueId: 'employer-cpf-contribution', all: ['employer', 'cpf', 'contribution'] }
    ],
    materialConcepts: [
      { id: 'cpf_relief', issueId: 'individual-cpf-tax-relief', topicIds: ['iras-individual-cpf-relief'], allTerms: ['cpf', 'relief'], requireExtractedConcept: true },
      { id: 'cpf_employer_contribution', issueId: 'employer-cpf-contribution', topicIds: ['cpf_contribution_rates'], allTerms: ['employer', 'cpf', 'contribution'], requireExtractedConcept: false }
    ],
    canonicalWorkstreamsAnyOf: [['CPF/CPF_PAYROLL', 'IRAS/IRAS_INDIVIDUAL_TAX']], factsRequired: true,
    localCapability: { IRAS: 'EXPECTED_LOCAL_GAP', CPF: 'INVALID_LOCAL_EVIDENCE' },
    localIssueCapability: { 'individual-cpf-tax-relief': 'EXPECTED_LOCAL_GAP', 'employer-cpf-contribution': 'INVALID_LOCAL_EVIDENCE' },
    localTopicCapability: { 'iras-individual-cpf-relief': 'EXPECTED_LOCAL_GAP', cpf_contribution_rates: 'INVALID_LOCAL_EVIDENCE' },
    localRejectionExpectation: { authority: 'CPF', requiredRejectedStatus: 'NEEDS_REVIEW', forbiddenAdmission: true },
    governed: { required: true, issueRuleEvidence: { 'individual-cpf-tax-relief': 'VERIFIED', 'employer-cpf-contribution': 'INSUFFICIENT' } },
    application: { 'individual-cpf-tax-relief': 'UNRESOLVED', 'employer-cpf-contribution': 'UNRESOLVED' },
    allowedOverall: ['INSUFFICIENT'],
    strictOperations: { 'employer-cpf-contribution': ['CALCULATE'], 'individual-cpf-tax-relief': ['CHECK_ELIGIBILITY'] },
    partialNonIrasAcceptance: { permitted: true, cpfIssueMustRemainSeparate: true, cpfOperation: 'CALCULATE', cpfEvidenceStatus: 'INSUFFICIENT', verifiedCpfAmountForbidden: true, irasIssueMustBeVerified: true },
    negatives: ['IRAS relief and CPF employer obligation must remain separate', 'NEEDS_REVIEW CPF record must remain rejected', 'no unsupported CPF calculation may be verified', 'CPF insufficiency cannot excuse an IRAS failure']
  },
  'private-expense-treatment': {
    topicOwners: [
      { topicId: 'iras-cit-deductibility', issueId: 'company-private-expense-tax-treatment', role: 'GOVERNING' },
      { topicId: 'iras-cit-disallowed-expenses', issueId: 'company-private-expense-tax-treatment', role: 'GOVERNING' }
    ], contextualTopicOwners: [],
    requiredSubjectMarkers: [{ issueId: 'company-private-expense-tax-treatment', all: ['company', 'expense', 'private', 'tax'] }],
    materialConcepts: [
      { id: 'private-expense-deductibility', issueId: 'company-private-expense-tax-treatment', topicIds: ['iras-cit-deductibility'], allTerms: ['company', 'expense'] },
      { id: 'private-expense-disallowance', issueId: 'company-private-expense-tax-treatment', topicIds: ['iras-cit-disallowed-expenses'], allTerms: ['private', 'expense'] }
    ], canonicalWorkstreamsAnyOf: [['IRAS/IRAS_CORPORATE_TAX']], factsRequired: true,
    localCapability: { IRAS: 'EXPECTED_LOCAL_GAP' },
    localIssueCapability: { 'company-private-expense-tax-treatment': 'EXPECTED_LOCAL_GAP' },
    localTopicCapability: { 'iras-cit-disallowed-expenses': 'VERIFIED_LOCAL_RULE', 'iras-cit-deductibility': 'EXPECTED_LOCAL_GAP' },
    localRequiredEvidence: { recordId: 'ITA_SEC15_PROHIBITED_DEDUCTIONS', supportKind: 'REVIEWED_SUBSTANTIVE_SECTION_15', caveatsRequired: true },
    governed: { required: true, fallbackForUncoveredTopics: true, issueRuleEvidence: { 'company-private-expense-tax-treatment': 'VERIFIED' } },
    application: { 'company-private-expense-tax-treatment': 'UNRESOLVED' }, allowedOverall: ['CONDITIONAL'],
    negatives: ['Section 14 alone is insufficient', 'motor-car-only material is insufficient', 'negated or reversed wording cannot pass', 'required statutory exceptions and scope qualifications must be retained', 'factual conjunction is not a separate material issue']
  },
  'foreign-dividend-receipt-treatment': {
    topicOwners: [{ topicId: 'iras-foreign-sourced-income', issueId: 'company-foreign-dividend-receipt-treatment', role: 'GOVERNING' }], contextualTopicOwners: [],
    requiredSubjectMarkers: [{ issueId: 'company-foreign-dividend-receipt-treatment', all: ['company', 'tax', 'dividend'], any: [['foreign'], ['overseas']], anyReceipt: [['received'], ['receipt'], ['income']] }],
    materialConcepts: [{ id: 'foreign-dividend-receipt', issueId: 'company-foreign-dividend-receipt-treatment', topicIds: ['iras-foreign-sourced-income'], allTerms: ['dividend'], anyTerms: ['foreign', 'overseas'] }],
    canonicalWorkstreamsAnyOf: [['IRAS/IRAS_CORPORATE_TAX']], factsRequired: true,
    localCapability: { IRAS: 'EXPECTED_LOCAL_GAP' }, localTopicCapability: { 'iras-foreign-sourced-income': 'EXPECTED_LOCAL_GAP' },
    localIssueCapability: { 'company-foreign-dividend-receipt-treatment': 'EXPECTED_LOCAL_GAP' },
    governed: { required: true, issueRuleEvidence: { 'company-foreign-dividend-receipt-treatment': 'VERIFIED' } },
    application: { 'company-foreign-dividend-receipt-treatment': 'UNRESOLVED' }, allowedOverall: ['CONDITIONAL'],
    negatives: ['bounded foreign or overseas dividend receipt wording is accepted', 'domestic dividend is rejected', 'company paying or distributing a dividend is a different direction', 'other income classes do not match']
  },
  'corporate-residency-general-rule': {
    topicOwners: [{ topicId: 'iras-corporate-tax-residency', issueId: 'general-company-tax-residency-rule', role: 'GOVERNING' }], contextualTopicOwners: [],
    requiredSubjectMarkers: [{ issueId: 'general-company-tax-residency-rule', all: ['company', 'tax'], any: [['resident'], ['residency'], ['residence']] }],
    materialConcepts: [{ id: 'company-tax-residency', issueId: 'general-company-tax-residency-rule', topicIds: ['iras-corporate-tax-residency'], allTerms: ['company', 'tax'], anyTerms: ['resident', 'residency', 'residence'] }],
    canonicalWorkstreamsAnyOf: [['IRAS/IRAS_CORPORATE_TAX']], factsRequired: false,
    localCapability: { IRAS: 'EXPECTED_LOCAL_GAP' }, localTopicCapability: { 'iras-corporate-tax-residency': 'EXPECTED_LOCAL_GAP' },
    localIssueCapability: { 'general-company-tax-residency-rule': 'EXPECTED_LOCAL_GAP' },
    governed: { required: true, issueRuleEvidence: { 'general-company-tax-residency-rule': 'VERIFIED' } },
    application: { 'general-company-tax-residency-rule': 'NOT_REQUIRED' }, allowedOverall: ['VERIFIED'],
    negatives: ['do not reconstruct unretained V9 quotations', 'application remains NOT_REQUIRED']
  },
  'wht-royalty-general-rule': {
    topicOwners: [
      { topicId: 'iras-withholding-tax', issueId: 'general-wht-royalty-rules', role: 'GOVERNING' },
      { topicId: 'iras-withholding-tax-interest-royalties', issueId: 'general-wht-royalty-rules', role: 'GOVERNING' }
    ], contextualTopicOwners: [],
    requiredSubjectMarkers: [{ issueId: 'general-wht-royalty-rules', all: ['company', 'royalt'], any: [['withholding', 'tax'], ['wht']], nonresidentCompanyRequired: true }],
    materialConcepts: [
      { id: 'withholding-tax', issueId: 'general-wht-royalty-rules', topicIds: ['iras-withholding-tax'], anyTerms: ['withholding tax', 'wht'] },
      { id: 'royalty-payment', issueId: 'general-wht-royalty-rules', topicIds: ['iras-withholding-tax-interest-royalties'], allTerms: ['royalt'] },
      { id: 'nonresident-company-recipient', issueId: 'general-wht-royalty-rules', topicIds: ['iras-withholding-tax-interest-royalties'], nonresidentCompanyRequired: true }
    ], canonicalWorkstreamsAnyOf: [['IRAS/IRAS_CORPORATE_TAX']], factsRequired: false,
    localCapability: { IRAS: 'EXPECTED_LOCAL_GAP' },
    localIssueCapability: { 'general-wht-royalty-rules': 'EXPECTED_LOCAL_GAP' },
    localTopicCapability: { 'iras-withholding-tax': 'EXPECTED_LOCAL_GAP', 'iras-withholding-tax-interest-royalties': 'EXPECTED_LOCAL_GAP' },
    governed: { required: true, issueRuleEvidence: { 'general-wht-royalty-rules': 'VERIFIED' }, requestedConceptCoverageRequired: true },
    application: { 'general-wht-royalty-rules': 'NOT_REQUIRED' }, allowedOverall: ['VERIFIED'],
    negatives: ['Section 45 or 45A summaries alone do not prove the complete royalty rule', 'non-resident and nonresident are bounded equivalents', 'resident-company recipient does not match', 'verified claims cannot bypass requested-concept completeness']
  },
  'gst-input-tax-general-rule': {
    topicOwners: [{ topicId: 'iras-gst-input-tax', issueId: 'general-gst-input-tax-recovery-rules', role: 'GOVERNING' }], contextualTopicOwners: [],
    requiredSubjectMarkers: [{ issueId: 'general-gst-input-tax-recovery-rules', all: ['gst', 'input', 'tax', 'company'], any: [['claim'], ['recover'], ['recovery']], anyPurchase: [['purchase'], ['acquisition'], ['acquire']], registeredRequired: true }],
    materialConcepts: [{ id: 'affirmative-input-tax-recovery', issueId: 'general-gst-input-tax-recovery-rules', topicIds: ['iras-gst-input-tax'], allTerms: ['input', 'tax'], anyTerms: ['claim', 'recover', 'recovery'] }],
    canonicalWorkstreamsAnyOf: [['IRAS/IRAS_GST']], factsRequired: false,
    localCapability: { IRAS: 'EXPECTED_LOCAL_GAP' }, localTopicCapability: { 'iras-gst-input-tax': 'EXPECTED_LOCAL_GAP' },
    localIssueCapability: { 'general-gst-input-tax-recovery-rules': 'EXPECTED_LOCAL_GAP' },
    governed: { required: true, issueRuleEvidence: { 'general-gst-input-tax-recovery-rules': 'VERIFIED' } },
    application: { 'general-gst-input-tax-recovery-rules': 'NOT_REQUIRED' }, allowedOverall: ['VERIFIED'],
    negatives: ['blocked-input-tax-only evidence does not prove affirmative general recovery', 'unregistered and private-only scopes do not match', 'input tax recovery/acquisition equivalents are bounded']
  },
  'unsupported-sfrsi-6-exploration-evaluation': {
    topicOwners: [], contextualTopicOwners: [],
    requiredSubjectMarkers: [{ issueId: 'sfrsi-6-mineral-exploration-evaluation', all: ['exploration', 'evaluation'], any: [['sfrsi', '6'], ['mineral']] }],
    materialConcepts: [{ id: 'sfrsi-6-exploration-evaluation', issueId: 'sfrsi-6-mineral-exploration-evaluation', unsupportedVisibleIssue: true }],
    canonicalWorkstreamsAnyOf: [['ACCOUNTING_STANDARDS/ACCOUNTING']], factsRequired: false,
    localCapability: { ACCOUNTING_STANDARDS: 'EXPECTED_LOCAL_GAP' }, localTopicCapability: {},
    localIssueCapability: { 'sfrsi-6-mineral-exploration-evaluation': 'EXPECTED_LOCAL_GAP' },
    governed: { required: false, expectedNoCoverageTopic: true, expectedNoClaims: true },
    application: { 'sfrsi-6-mineral-exploration-evaluation': 'NOT_REQUIRED' }, allowedOverall: ['INSUFFICIENT'],
    negatives: ['no IRAS governing authority or IRAS workstream', 'NO_COVERAGE_TOPIC remains visible', 'no invented source, evidence, claim or fallback', 'INSUFFICIENT remains fail-closed']
  }
});

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function expectedIssuesV4(testCase) {
  const expected = structuredClone(testCase.expected);
  const strict = POLICY[testCase.id]?.strictOperations || {};
  for (const issue of expected) if (strict[issue.id]) issue.operation = [...strict[issue.id]];
  return expected;
}

export async function buildV4Contract() {
  const cases = await loadIrasFirstV2TargetedCases();
  assert.deepEqual(cases.map(testCase => testCase.id), CASE_IDS, 'V4_CASE_INVENTORY_CHANGED');
  return {
    schemaVersion: 1,
    profile: PROFILE,
    contractStage: 'PROSPECTIVE_DESIGN_ONLY',
    targetedAcceptanceExecuted: false,
    semanticScorer: { version: 'V2', path: 'tests/evaluation/singapore/multi-authority-issue-scoring-v2.mjs', matching: 'MAXIMUM_ONE_TO_ONE' },
    layers: {
      semanticInterpretationAndOwnership: 'REQUIRED', reviewedLocalCapability: 'SEPARATE_LOCAL_ONLY_OBSERVATION',
      governedRuleEvidence: { mode: FUTURE_EVIDENCE_POLICY.evidenceMode, transportMode: FUTURE_EVIDENCE_POLICY.transportMode },
      applicationStatus: 'SEPARATE_FROM_RULE_VERIFICATION'
    },
    resourcePolicy: RESOURCE_POLICY,
    futureEvidencePolicy: FUTURE_EVIDENCE_POLICY,
    failureStages: FAILURE_STAGES,
    cases: cases.map(testCase => {
      const policy = POLICY[testCase.id];
      assert.ok(policy, `V4_CASE_POLICY_MISSING:${testCase.id}`);
      return {
        caseId: testCase.id,
        question: testCase.question,
        questionSha256: sha256(testCase.question),
        semantic: {
          expectedIssues: expectedIssuesV4(testCase),
          expectedIssueCount: testCase.expected.length,
          expectedRequiresUserSpecificFacts: testCase.expectedRequiresUserSpecificFacts,
          acceptableWorkstreamsAnyOf: policy.canonicalWorkstreamsAnyOf,
          requiredSubjectMarkers: policy.requiredSubjectMarkers,
          independentTopicAccounting: {
            requiredTopicOwners: policy.topicOwners,
            contextualTopicOwners: policy.contextualTopicOwners,
            routingTopicOwners: policy.routingTopicOwners || [],
            noUnrepresentedMaterialResidual: testCase.id !== 'unsupported-sfrsi-6-exploration-evaluation'
          },
          materialRequestedConcepts: policy.materialConcepts,
          negatives: policy.negatives
        },
        factsRequired: policy.factsRequired,
        reviewedLocalCapability: {
          mode: 'localOnly', expectedAuthorityStates: policy.localCapability,
          expectedIssueStates: policy.localIssueCapability,
          expectedTopicStates: policy.localTopicCapability,
          ...(policy.localRejectionExpectation ? { rejectionExpectation: policy.localRejectionExpectation } : {}),
          ...(policy.localRequiredEvidence ? { requiredEvidence: policy.localRequiredEvidence } : {})
        },
        governedProductionEvidence: {
          mode: FUTURE_EVIDENCE_POLICY.evidenceMode,
          required: policy.governed.required,
          expectedRuleEvidenceByIssue: policy.governed.issueRuleEvidence || {},
          ...(policy.governed.expectedNoCoverageTopic ? { expectedNoCoverageTopic: true, expectedNoClaims: true } : {}),
          ...(policy.governed.fallbackForUncoveredTopics ? { fallbackForUncoveredTopics: true } : {}),
          ...(policy.governed.requestedConceptCoverageRequired ? { requestedConceptCoverageRequired: true } : {}),
          ...(policy.partialNonIrasAcceptance ? { acceptablePartialNonIrasBehaviour: policy.partialNonIrasAcceptance } : {})
        },
        application: { expectedByIssue: policy.application, allowedOverallStatuses: policy.allowedOverall },
        forbiddenConditions: policy.negatives
      };
    })
  };
}

export async function readV4Contract() {
  return JSON.parse(await readFile(path.join(ROOT, CONTRACT_PATH), 'utf8'));
}

const normalize = value => String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
const containsTerm = (text, term) => normalize(text).includes(normalize(term));
const hasAllTerms = (text, terms = []) => terms.every(term => containsTerm(text, term));

function hasNonresidentCompany(text) {
  const normalized = normalize(text).replace(/\bnonresident\b/g, 'non resident');
  return /\bnon resident (?:company|corporation|business entity|legal entity|corporate entity|corporate company)\b/.test(normalized);
}

function semanticSubjectGuard(actual, expected, caseContract) {
  const subject = actual?.subject || '';
  const row = caseContract.semantic.requiredSubjectMarkers.find(item => item.issueId === expected.id);
  if (!row) return { passed: true, explicitContradiction: false };
  // V2's terminal foreign/GST matchers already establish bounded direction,
  // income/purchase class and registration. Do not narrow those synonyms here.
  const isCpfRelief = ['personal-cpf-relief', 'personal-cpf-relief-amount', 'individual-cpf-tax-relief'].includes(expected.id);
  const passed = (!isCpfRelief || hasAllTerms(subject, ['tax', 'relief', 'cpf'])) &&
    (!row.nonresidentCompanyRequired || hasNonresidentCompany(subject));
  const n = normalize(subject);
  const explicitContradiction = !passed && (
    caseContract.caseId === 'wht-royalty-general-rule' && (
      /\bresident company\b/.test(n) && !hasNonresidentCompany(n) ||
      /\bnon ?resident (employee|individual|person)\b/.test(n)
    )
  );
  return { passed, explicitContradiction };
}

function relevantInventory(question) {
  const decomposition = defaultQueryTopicResolver.decomposeQuery(question);
  const classification = classifyQuestion(question);
  const ids = [...new Set([...decomposition.topics.map(topic => topic.id), ...classification.topicIds])];
  const topics = defaultQueryTopicResolver.resolveTopicIds(ids).map(topic => ({
    ...topic, routingOnly: getCoverageTopicById(topic.id)?.routingOnly === true
  })).filter(topic => /^(?:ACCOUNTING|IRAS|CPF|MOM|ACRA|MAS)_/.test(topic.domainId));
  return { topicIds: topics.map(topic => topic.id).sort(),
    materialTopicIds: topics.filter(topic => topic.routingOnly !== true).map(topic => topic.id).sort(),
    routingOnlyTopicIds: topics.filter(topic => topic.routingOnly === true).map(topic => topic.id).sort(),
    unresolvedTopicTextCount: decomposition.unresolvedTopics?.length || 0 };
}

export function scoreSemanticV4(caseContract, interpretation, issuePlan) {
  const diagnostic = diagnoseSemanticResponse(JSON.stringify(interpretation), caseContract.question);
  const valid = diagnostic.interpreted === true && Boolean(validateSemanticQuestionInterpretation(interpretation, caseContract.question));
  const expected = caseContract.semantic.expectedIssues;
  const actual = Array.isArray(interpretation?.issues) ? interpretation.issues : [];
  const matching = matchIssuesV2(expected, actual);
  const pairs = [...matching.expectedByActual.entries()].map(([actualIndex, expectedIndex]) => ({
    actualIndex, expectedIndex, expectedIssueId: expected[expectedIndex].id,
    dimensions: scoreIssueDimensionsV2(actual[actualIndex], expected[expectedIndex]),
    subjectGuard: semanticSubjectGuard(actual[actualIndex], expected[expectedIndex], caseContract)
  }));
  const identityPass = pairs.length === expected.length && pairs.length === actual.length &&
    pairs.every(pair => pair.subjectGuard.passed);
  const dimensionsPass = pairs.length === expected.length && pairs.every(pair =>
    Object.values(pair.dimensions).every(Boolean));
  const specificityPass = interpretation?.requiresUserSpecificFacts === caseContract.semantic.expectedRequiresUserSpecificFacts;
  const owner = new Map();
  for (const row of [...caseContract.semantic.independentTopicAccounting.requiredTopicOwners,
    ...caseContract.semantic.independentTopicAccounting.contextualTopicOwners]) {
    owner.set(row.topicId, row.issueId);
  }
  const actualIssues = issuePlan?.issues || [];
  const topicOwnership = [...owner.entries()].map(([topicId, issueId]) => {
    const issue = actualIssues.find(item => item.id === issueId ||
      pairs.some(pair => pair.expectedIssueId === issueId && actual[pair.actualIndex]?.subject === item.subject));
    const contextual = caseContract.semantic.independentTopicAccounting.contextualTopicOwners.some(row =>
      row.topicId === topicId && row.issueId === issueId);
    const owned = contextual ? issue?.contextualTopicIds?.includes(topicId) === true
      : issue?.mappedTopicIds?.includes(topicId) === true;
    return { topicId, issueId, contextual, owned };
  });
  const inventory = relevantInventory(caseContract.question);
  let independentlyReconciledPlan;
  try {
    independentlyReconciledPlan = reconcileQuestionUnderstanding(caseContract.question, classifyQuestion(caseContract.question), {
      mode: 'SEMANTIC_INTERPRETATION', interpretation
    }).issuePlan;
  } catch {
    independentlyReconciledPlan = undefined;
  }
  const routingTopicOwnership = (caseContract.semantic.independentTopicAccounting.routingTopicOwners || []).map(row => {
    const pair = pairs.find(item => item.expectedIssueId === row.issueId);
    const subject = pair ? actual[pair.actualIndex]?.subject : undefined;
    const issue = subject ? actualIssues.find(item => item.subject === subject) : undefined;
    const independentlyMatched = independentlyReconciledPlan
      ? matchIssuesV2(expected, independentlyReconciledPlan.issues).expectedByActual : new Map();
    const trustedPair = [...independentlyMatched.entries()].find(([, expectedIndex]) => expected[expectedIndex]?.id === row.issueId);
    const trustedIssue = trustedPair ? independentlyReconciledPlan.issues[trustedPair[0]] : undefined;
    const trustedRoute = trustedIssue?.routingTopicIds?.includes(row.topicId) === true;
    const suppliedRoute = issue?.routingTopicIds?.includes(row.topicId) === true;
    const scopeKeys = ['subject', 'population', 'domain', 'operation'];
    const scopeAgrees = Boolean(issue && trustedIssue && scopeKeys.every(key => issue[key] === trustedIssue[key]) &&
      JSON.stringify(issue.governingAuthorities || []) === JSON.stringify(trustedIssue.governingAuthorities || []));
    const childrenOwned = row.childTopicIds.every(topicId => inventory.materialTopicIds.includes(topicId) &&
      issue?.mappedTopicIds?.includes(topicId) === true && trustedIssue?.mappedTopicIds?.includes(topicId) === true);
    const routingOnly = inventory.routingOnlyTopicIds.includes(row.topicId);
    const routeSeparated = !issue?.mappedTopicIds?.includes(row.topicId) && !issue?.contextualTopicIds?.includes(row.topicId);
    const owned = trustedRoute && suppliedRoute && scopeAgrees && childrenOwned && routingOnly && routeSeparated &&
      independentlyReconciledPlan?.coverageEstablished === true && independentlyReconciledPlan?.hasUnmappedResidual === false;
    return { ...row, trustedRoute, suppliedRoute, scopeAgrees, childrenOwned, routingOnly, routeSeparated, owned };
  });
  const validatedRoutingTopicIds = routingTopicOwnership.filter(row => row.owned).map(row => row.topicId);
  const represented = new Set([...actualIssues.flatMap(issue => [...(issue.mappedTopicIds || []), ...(issue.contextualTopicIds || [])]),
    ...validatedRoutingTopicIds]);
  const unrepresentedInventory = inventory.topicIds.filter(topicId => !represented.has(topicId));
  const unsupported = caseContract.caseId === 'unsupported-sfrsi-6-exploration-evaluation';
  const residuals = actualIssues.filter(issue => issue.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC');
  const materialResiduals = residuals.filter(issue => (issue.mappedTopicIds || []).length === 0 ||
    (issue.mappedTopicIds || []).some(topicId => !inventory.routingOnlyTopicIds.includes(topicId)));
  const unsupportedIssuePass = unsupported && actualIssues.length === expected.length &&
    actualIssues.every(issue => issue.unresolvedReason === 'NO_COVERAGE_TOPIC' && issue.status === 'UNRESOLVED');
  const independentTopicPass = topicOwnership.every(row => row.owned) && routingTopicOwnership.every(row => row.owned) && (unsupported
    ? unsupportedIssuePass
    : unrepresentedInventory.length === 0 && inventory.unresolvedTopicTextCount === 0 &&
      issuePlan?.coverageEstablished === true && issuePlan?.hasUnmappedResidual === false && materialResiduals.length === 0 &&
      independentlyReconciledPlan?.coverageEstablished === true && independentlyReconciledPlan?.hasUnmappedResidual === false);
  const requiredConcepts = caseContract.semantic.materialRequestedConcepts;
  const productionConcepts = getRequestedQuestionConcepts(caseContract.question, interpretation);
  const conceptOwnership = requiredConcepts.map(concept => {
    const ownerPair = pairs.find(pair => pair.expectedIssueId === concept.issueId);
    const issue = ownerPair ? actualIssues.find(item => item.subject === actual[ownerPair.actualIndex]?.subject) : undefined;
    const subject = ownerPair ? actual[ownerPair.actualIndex]?.subject || '' : '';
    const markerPass = concept.unsupportedVisibleIssue === true || concept.nonresidentCompanyRequired
      ? concept.unsupportedVisibleIssue === true || hasNonresidentCompany(subject)
      : concept.id === 'cpf_relief' ? hasAllTerms(subject, ['tax', 'relief', 'cpf']) : true;
    const topicPass = (concept.topicIds || []).every(topicId => issue?.mappedTopicIds?.includes(topicId) === true ||
      issue?.contextualTopicIds?.includes(topicId) === true);
    const extracted = productionConcepts.find(item => item.id === concept.id ||
      (concept.id === 'nonresident-company-recipient' && hasNonresidentCompany(item.label)));
    const extractionPass = concept.unsupportedVisibleIssue === true ||
      (concept.requireExtractedConcept === true ? Boolean(extracted) : Boolean(extracted) || markerPass);
    return { conceptId: concept.id, issueId: concept.issueId, markerPass, topicPass, extractionPass,
      passed: markerPass && topicPass && extractionPass };
  });
  const stages = {
    SEMANTIC_VALIDATION: valid,
    SEMANTIC_ISSUE_IDENTITY: identityPass,
    SEMANTIC_DIMENSIONS: dimensionsPass && specificityPass,
    TOPIC_OWNERSHIP: independentTopicPass,
    REQUESTED_CONCEPT_OWNERSHIP: conceptOwnership.every(row => row.passed)
  };
  const failedPair = pairs.find(pair => !pair.subjectGuard.passed);
  const unmatchedSubjectContradiction = !failedPair && expected.some((item, expectedIndex) => !matching.ownerByExpected.has(expectedIndex) &&
    actual.some(candidate => caseContract.caseId === 'wht-royalty-general-rule' && /\bresident company\b/.test(normalize(candidate.subject)) &&
      !hasNonresidentCompany(candidate.subject)));
  return {
    stages, validInterpretation: valid, identityPass, dimensionsPass, specificityPass,
    matchedIssueCount: pairs.length, expectedIssueCount: expected.length, actualIssueCount: actual.length,
    pairs, topicOwnership, routingTopicOwnership, validatedRoutingTopicIds, independentInventory: inventory, unrepresentedInventory,
    unassignedResidualCount: residuals.length, conceptOwnership,
    subjectAttribution: failedPair || matching.ownerByExpected.size < expected.length ? {
      attribution: unmatchedSubjectContradiction || failedPair?.subjectGuard.explicitContradiction
        ? 'RETAINED_OUTPUT_PROVES_MATERIAL_MISMATCH' : 'SCORING_UNRESOLVED',
      modelError: unmatchedSubjectContradiction || failedPair?.subjectGuard.explicitContradiction || false,
      expectedIssueId: failedPair?.expectedIssueId
    } : { attribution: 'MATCHED', modelError: false }
  };
}

export function classifyLifecycleFailure({ lifecycle = {}, candidateCount = 0, rejectedCount = 0,
  evidenceQuality = {}, verifiedClaimCount = 0, requestedConceptCoverage = false, providerError = false } = {}) {
  if (providerError || !lifecycle.retrievalAttempted) return { stage: 'GOVERNED_RETRIEVAL', state: 'pipeline_failure' };
  if (!lifecycle.evidenceFound || candidateCount === 0) return { stage: 'GOVERNED_RETRIEVAL', state: 'candidate_missing' };
  if (!lifecycle.admitted || evidenceQuality.eligibleRecords?.length === 0) return {
    stage: 'EVIDENCE_ADMISSION', state: rejectedCount > 0 || (evidenceQuality.rejectedRecords?.length || 0) > 0
      ? 'candidate_rejected' : 'candidate_not_admitted'
  };
  if (!lifecycle.verified || verifiedClaimCount === 0) return { stage: 'CLAIM_VERIFICATION', state: 'claim_verification_failed' };
  if (!lifecycle.covered || !requestedConceptCoverage || (evidenceQuality.uncoveredConcepts?.length || 0) > 0 ||
      (evidenceQuality.uncoveredTopicIds?.length || 0) > 0) {
    return { stage: 'REQUESTED_CONCEPT_COVERAGE', state: 'verified_claims_scope_uncovered' };
  }
  return { stage: undefined, state: 'complete' };
}

export function scoreGovernedEvidenceV4(caseContract, observations = []) {
  const policy = caseContract.governedProductionEvidence;
  if (!policy.required) {
    const observation = observations[0] || {};
    const noCoverage = observation.coverageStatus === 'NO_COVERAGE_TOPIC';
    const noRoute = observation.irAsWorkstreamCount === 0;
    const noEvidence = (observation.candidateCount || 0) === 0 && (observation.claimCount || 0) === 0;
    return { lifecycleDiagnostics: [], stages: {
      GOVERNED_RETRIEVAL: noRoute, EVIDENCE_ADMISSION: noEvidence, CLAIM_VERIFICATION: noEvidence,
      REQUESTED_CONCEPT_COVERAGE: noCoverage
    }, expectedNoCoverageTopic: noCoverage, expectedNoClaims: noEvidence };
  }
  const expectedByIssue = policy.expectedRuleEvidenceByIssue || {};
  const diagnostics = Object.entries(expectedByIssue).map(([issueId, expectedStatus]) => {
    const observation = observations.find(item => item.issueId === issueId);
    if (!observation) return { issueId, expectedStatus, ...classifyLifecycleFailure({ providerError: true }) };
    const lifecycle = observation.lifecycle || {};
    const evidenceQuality = observation.evidenceQuality || {};
    const retrieved = observation.providerError !== true && lifecycle.retrievalAttempted === true &&
      lifecycle.evidenceFound === true && observation.candidateCount > 0;
    const admitted = retrieved && lifecycle.admitted === true && (evidenceQuality.eligibleRecords?.length || 0) > 0;
    const verified = admitted && lifecycle.verified === true && observation.verifiedClaimCount > 0;
    const covered = verified && lifecycle.covered === true && observation.requestedConceptCoverage === true &&
      (evidenceQuality.uncoveredConcepts?.length || 0) === 0 && (evidenceQuality.uncoveredTopicIds?.length || 0) === 0;
    const diagnostic = classifyLifecycleFailure({
      lifecycle, candidateCount: observation.candidateCount,
      rejectedCount: observation.rejectedCount, evidenceQuality: observation.evidenceQuality,
      verifiedClaimCount: observation.verifiedClaimCount,
      requestedConceptCoverage: observation.requestedConceptCoverage,
      providerError: observation.providerError
    });
    const statusPass = observation.ruleEvidenceStatus === expectedStatus;
    return { issueId, expectedStatus, actualStatus: observation.ruleEvidenceStatus, statusPass,
      retrieved, admitted, verified, covered, verifiedClaimCount: observation.verifiedClaimCount, ...diagnostic };
  });
  const verifiedExpectedRows = diagnostics.filter(row => row.expectedStatus === 'VERIFIED');
  const insufficientExpectedRows = diagnostics.filter(row => row.expectedStatus === 'INSUFFICIENT');
  return {
    lifecycleDiagnostics: diagnostics,
    stages: {
      GOVERNED_RETRIEVAL: verifiedExpectedRows.length > 0 &&
        diagnostics.length === Object.keys(expectedByIssue).length && diagnostics.every(row => row.retrieved),
      EVIDENCE_ADMISSION: verifiedExpectedRows.length > 0 &&
        verifiedExpectedRows.every(row => row.admitted),
      CLAIM_VERIFICATION: diagnostics.length > 0 && insufficientExpectedRows.every(row => row.statusPass) &&
        verifiedExpectedRows.every(row => row.verified),
      REQUESTED_CONCEPT_COVERAGE: verifiedExpectedRows.length > 0 && verifiedExpectedRows.every(row => row.statusPass && row.covered) &&
        (!policy.requestedConceptCoverageRequired || verifiedExpectedRows.every(row => row.covered))
    }
  };
}

export function scoreApplicationStatusV4(caseContract, applicationObservation = {}) {
  const expected = caseContract.application.expectedByIssue || {};
  const actual = applicationObservation.byIssue || {};
  const issueStatuses = Object.fromEntries(Object.entries(expected).map(([issueId, expectedStatus]) =>
    [issueId, { expected: expectedStatus, actual: actual[issueId], passed: actual[issueId] === expectedStatus }]));
  const overallAllowed = caseContract.application.allowedOverallStatuses.includes(applicationObservation.overallStatus);
  const applicationStatusesPassed = Object.values(issueStatuses).every(row => row.passed);
  const ruleVerifiedUnresolvedApplicationPreserved = Object.entries(expected).every(([issueId, expectedStatus]) =>
    expectedStatus !== 'UNRESOLVED' || actual[issueId] === 'UNRESOLVED');
  return { issueStatuses, overallStatus: applicationObservation.overallStatus,
    applicationStatusesPassed, overallAllowed, ruleVerifiedUnresolvedApplicationPreserved,
    passed: applicationStatusesPassed && overallAllowed && ruleVerifiedUnresolvedApplicationPreserved };
}

export function evaluateV4Stages({ semantic, routing, local, governed, application, integrityPassed = true } = {}) {
  const governedStages = governed?.stages || {};
  const stages = {
    SEMANTIC_VALIDATION: semantic?.stages?.SEMANTIC_VALIDATION === true,
    SEMANTIC_ISSUE_IDENTITY: semantic?.stages?.SEMANTIC_ISSUE_IDENTITY === true,
    SEMANTIC_DIMENSIONS: semantic?.stages?.SEMANTIC_DIMENSIONS === true,
    TOPIC_OWNERSHIP: semantic?.stages?.TOPIC_OWNERSHIP === true,
    REQUESTED_CONCEPT_OWNERSHIP: semantic?.stages?.REQUESTED_CONCEPT_OWNERSHIP === true,
    WORKSTREAM_ROUTING: routing?.passed === true,
    LOCAL_CAPABILITY: local?.passed === true,
    GOVERNED_RETRIEVAL: governedStages.GOVERNED_RETRIEVAL === true,
    EVIDENCE_ADMISSION: governedStages.EVIDENCE_ADMISSION === true,
    CLAIM_VERIFICATION: governedStages.CLAIM_VERIFICATION === true,
    REQUESTED_CONCEPT_COVERAGE: governedStages.REQUESTED_CONCEPT_COVERAGE === true,
    APPLICATION_STATUS: application?.applicationStatusesPassed === true && application?.ruleVerifiedUnresolvedApplicationPreserved === true,
    OVERALL_STATUS: application?.overallAllowed === true,
    INTEGRITY: integrityPassed === true
  };
  return { stages, earliestFailure: firstFailureV4(stages, integrityPassed) };
}

export function firstFailureV4(stageResults, integrityPassed = true) {
  if (!integrityPassed) return 'INTEGRITY';
  return FAILURE_STAGES.find(stage => stage !== 'INTEGRITY' && stageResults?.[stage] === false);
}

export function scoreWorkstreamRoutingV4(caseContract, issuePlan, runtime) {
  const planned = runtime?.workstreams || [];
  const actualPairs = planned.map(workstream => `${workstream.authority}/${workstream.domain}`).sort();
  const expectedPass = caseContract.semantic.acceptableWorkstreamsAnyOf.some(expected =>
    expected.length === actualPairs.length && [...expected].sort().every((pair, index) => pair === actualPairs[index]));
  const expectedIssues = caseContract.semantic.expectedIssues;
  const actualIssues = issuePlan?.issues || [];
  const matching = matchIssuesV2(expectedIssues, actualIssues);
  const hasIssueOwner = matching.ownerByExpected.size === expectedIssues.length;
  const contextualAuthorities = new Set(caseContract.semantic.expectedIssues.flatMap(issue =>
    issue.contextualAuthoritiesAnyOf.flatMap(list => list)));
  const governedAuthorities = new Set(caseContract.semantic.expectedIssues.flatMap(issue => issue.governingAuthorities));
  const contextualOnly = [...contextualAuthorities].filter(authority => !governedAuthorities.has(authority));
  const contextualWasRouted = planned.some(workstream => contextualOnly.includes(workstream.authority));
  const noIrasForUnsupported = caseContract.governedProductionEvidence.expectedNoCoverageTopic !== true ||
    planned.every(workstream => workstream.authority !== 'IRAS');
  return { actualPairs, expectedPass, hasIssueOwner, contextualWasRouted, noIrasForUnsupported,
    passed: expectedPass && hasIssueOwner && !contextualWasRouted && noIrasForUnsupported };
}

function classifyLocalObservation(observation) {
  if (!observation) return 'PIPELINE_FAILURE';
  if (observation.pipelineFailure === true || observation.localOnly !== true) return 'PIPELINE_FAILURE';
  if (observation.actualRuntime === true) {
    if (observation.governedWorkstreamObserved !== true) return observation.noGoverningWorkstream === true
      ? 'EXPECTED_LOCAL_GAP' : 'PIPELINE_FAILURE';
    if (observation.retrievalCompleted !== true) return 'PIPELINE_FAILURE';
    if (observation.needsReviewCandidate === true && observation.admitted !== true) return 'INVALID_LOCAL_EVIDENCE';
    if (observation.admitted === true && observation.literalVerified === true && observation.topicCovered === true) return 'VERIFIED_LOCAL_RULE';
    if (observation.noEligibleCandidate === true || observation.substantiveScopeIncomplete === true) return 'EXPECTED_LOCAL_GAP';
    return 'PIPELINE_FAILURE';
  }
  if (observation.admitted === true && observation.literalVerified === true && observation.topicCovered === true) return 'VERIFIED_LOCAL_RULE';
  if ((observation.candidateStatus === 'NEEDS_REVIEW' || observation.state === 'INVALID_LOCAL_EVIDENCE') && observation.admitted !== true) return 'INVALID_LOCAL_EVIDENCE';
  if (observation.noSubstantiveCandidate === true || observation.sourceMapPointerOnly === true) return 'EXPECTED_LOCAL_GAP';
  return 'PIPELINE_FAILURE';
}

export function classifyLocalCapabilityV4(caseContract, observations = []) {
  const expectedByTopic = caseContract.reviewedLocalCapability.expectedTopicStates;
  const topicStates = {};
  for (const [topicId, expected] of Object.entries(expectedByTopic)) {
    const observation = observations.find(item => item.topicId === topicId);
    const actual = classifyLocalObservation(observation);
    topicStates[topicId] = { expected, actual, passed: expected === actual };
  }
  const issueTopics = new Map();
  for (const row of [...caseContract.semantic.independentTopicAccounting.requiredTopicOwners,
    ...caseContract.semantic.independentTopicAccounting.contextualTopicOwners]) {
    const list = issueTopics.get(row.issueId) || [];
    if (Object.hasOwn(expectedByTopic, row.topicId)) list.push(row.topicId);
    issueTopics.set(row.issueId, list);
  }
  const issueStates = Object.fromEntries(Object.entries(caseContract.reviewedLocalCapability.expectedIssueStates || {}).map(([issueId, expected]) => {
    const explicit = observations.find(item => item.issueId === issueId && !item.topicId);
    const ownedTopicStates = (issueTopics.get(issueId) || []).map(topicId => topicStates[topicId]?.actual);
    const actual = explicit ? classifyLocalObservation(explicit)
      : ownedTopicStates.includes('PIPELINE_FAILURE') ? 'PIPELINE_FAILURE'
        : ownedTopicStates.includes('INVALID_LOCAL_EVIDENCE') ? 'INVALID_LOCAL_EVIDENCE'
          : ownedTopicStates.length && ownedTopicStates.every(state => state === 'VERIFIED_LOCAL_RULE') ? 'VERIFIED_LOCAL_RULE'
            : ownedTopicStates.length ? 'EXPECTED_LOCAL_GAP' : 'PIPELINE_FAILURE';
    return [issueId, { expected, actual, passed: expected === actual }];
  }));
  const expectedAuthorities = caseContract.reviewedLocalCapability.expectedAuthorityStates;
  const authorityStates = Object.fromEntries(Object.entries(expectedAuthorities).map(([authority, expected]) => {
    const explicit = observations.find(item => item.authority === authority && !item.topicId && !item.issueId);
    const associatedTopics = Object.entries(topicStates).filter(([topicId]) =>
      authority === 'CPF' ? topicId.startsWith('cpf_') : authority === 'IRAS' ? topicId.startsWith('iras-') : false)
      .map(([, row]) => row.actual);
    const associatedIssues = Object.keys(issueStates).filter(issueId => issueId.toLowerCase().includes(authority.toLowerCase()))
      .map(issueId => issueStates[issueId].actual);
    const states = explicit ? [classifyLocalObservation(explicit)] : [...associatedTopics, ...associatedIssues];
    const actual = states.includes('PIPELINE_FAILURE') ? 'PIPELINE_FAILURE'
      : states.includes('INVALID_LOCAL_EVIDENCE') ? 'INVALID_LOCAL_EVIDENCE'
        : states.length && states.every(state => state === 'VERIFIED_LOCAL_RULE') ? 'VERIFIED_LOCAL_RULE'
          : states.length ? 'EXPECTED_LOCAL_GAP' : 'PIPELINE_FAILURE';
    return [authority, { expected, actual, passed: expected === actual }];
  }));
  return { topicStates, issueStates, authorityStates,
    passed: Object.values(topicStates).every(row => row.passed) && Object.values(issueStates).every(row => row.passed) &&
      Object.values(authorityStates).every(row => row.passed) };
}

export function createRequestBudgetGuard({ caseIds = CASE_IDS, minimumStartGapMs = RESOURCE_POLICY.minimumStartGapMs,
  clock = () => performance.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let nextIndex = 0;
  let previousStart;
  let inFlight = false;
  const counts = new Map();
  return {
    counts,
    async invoke(caseId, send) {
      if (inFlight || caseId !== caseIds[nextIndex] || counts.has(caseId)) throw new Error('V4_EXTRA_OR_OUT_OF_ORDER_CALL_BLOCKED');
      if (nextIndex >= RESOURCE_POLICY.expectedCalls) throw new Error('V4_CALL_BUDGET_EXCEEDED');
      inFlight = true;
      counts.set(caseId, 1);
      nextIndex += 1;
      try {
        if (previousStart !== undefined) {
          const remaining = minimumStartGapMs - (clock() - previousStart);
          if (remaining > 0) await sleep(remaining);
        }
        const startedAt = clock();
        if (previousStart !== undefined && startedAt - previousStart < minimumStartGapMs) throw new Error('V4_PACING_GAP_NOT_MET');
        previousStart = startedAt;
        return await send();
      } finally {
        inFlight = false;
      }
    }
  };
}

const REQUIRED_CONSUMPTION_BINDINGS = Object.freeze([
  'preregistrationSha256', 'contractSha256', 'evidenceLockSha256', 'productionFingerprintSha256',
  'sourceFingerprintSha256', 'schemaPromptFingerprintSha256', 'protectedHistorySha256',
  'evaluationFingerprintSha256', 'sharedAllowanceObservation'
]);

const SHA256_RE = /^[a-f0-9]{64}$/i;
const REQUIRED_EVIDENCE_BINDINGS = Object.freeze([
  'preregistrationSha256', 'contractSha256', 'productionFingerprintSha256', 'sourceFingerprintSha256',
  'schemaPromptFingerprintSha256', 'protectedHistorySha256', 'evaluationFingerprintSha256', 'capturePayloadSha256'
]);

async function pathExists(filePath) {
  try { await access(filePath); return true; } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function validateV4LivePreflight({ preregistration, evidenceLock, sharedAllowance, authorizedGeminiCalls,
  preregistrationSha256, namespaceDirectory, now = new Date() } = {}) {
  const failures = [];
  if (!preregistration || preregistration.profile !== PROFILE || preregistration.frozen !== true) failures.push('PREREGISTRATION_NOT_FROZEN');
  if (!SHA256_RE.test(String(preregistrationSha256 || ''))) failures.push('PREREGISTRATION_FINGERPRINT_INVALID');
  for (const key of ['contractSha256', 'productionFingerprintSha256', 'sourceFingerprintSha256', 'schemaPromptFingerprintSha256',
    'protectedHistorySha256', 'evaluationFingerprintSha256']) {
    if (!SHA256_RE.test(String(preregistration?.[key] || ''))) failures.push(`PREREGISTRATION_BINDING_INVALID:${key}`);
  }
  if (!evidenceLock || evidenceLock.mode !== FUTURE_EVIDENCE_POLICY.transportMode || evidenceLock.synthetic === true || evidenceLock.frozen !== true) failures.push('EVIDENCE_LOCK_MISSING_OR_INVALID');
  if (evidenceLock) {
    for (const key of REQUIRED_EVIDENCE_BINDINGS) {
      if (!SHA256_RE.test(String(evidenceLock[key] || ''))) failures.push(`EVIDENCE_LOCK_BINDING_INVALID:${key}`);
      const expected = key === 'preregistrationSha256' ? preregistrationSha256 : preregistration?.[key];
      if (expected && evidenceLock[key] !== expected) failures.push(`EVIDENCE_LOCK_BINDING_MISMATCH:${key}`);
    }
  }
  if (evidenceLock && Number.isFinite(Date.parse(evidenceLock.capturedAt))) {
    const ageMs = now.getTime() - Date.parse(evidenceLock.capturedAt);
    if (ageMs < 0 || ageMs > FUTURE_EVIDENCE_POLICY.maximumCaptureAgeHours * 60 * 60 * 1000) failures.push('EVIDENCE_LOCK_EXPIRED');
  } else failures.push('EVIDENCE_LOCK_CAPTURE_DATE_INVALID');
  if (evidenceLock && Number.isFinite(Date.parse(evidenceLock.capturedAt))) {
    const captureDate = new Date(evidenceLock.capturedAt).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(evidenceLock.sourceReferenceDate || '') || evidenceLock.sourceReferenceDate !== captureDate) {
      failures.push('EVIDENCE_LOCK_DATE_MISMATCH');
    }
  }
  const observedAt = sharedAllowance?.observedAt ? Date.parse(sharedAllowance.observedAt) : NaN;
  if (!sharedAllowance || sharedAllowance.source !== 'codex' || sharedAllowance.readable !== true ||
      !Number.isFinite(observedAt) || now.getTime() - observedAt < 0 || now.getTime() - observedAt > 5 * 60_000) {
    failures.push('SHARED_ALLOWANCE_UNAVAILABLE_OR_STALE');
  } else {
    const finitePct = value => Number.isFinite(value) && value >= 0 && value <= 100;
    const fields = ['fiveHourRemainingPercent', 'weeklyRemainingPercent', 'projectedFiveHourCostPercentagePoints', 'projectedWeeklyCostPercentagePoints'];
    if (!fields.every(field => finitePct(sharedAllowance[field]))) failures.push('SHARED_ALLOWANCE_PROJECTION_INVALID');
    else {
      if (sharedAllowance.fiveHourRemainingPercent - sharedAllowance.projectedFiveHourCostPercentagePoints < 8) failures.push('FIVE_HOUR_RESERVE_NOT_MET');
      if (sharedAllowance.weeklyRemainingPercent - sharedAllowance.projectedWeeklyCostPercentagePoints < 4) failures.push('WEEKLY_RESERVE_NOT_MET');
    }
  }
  if (authorizedGeminiCalls !== RESOURCE_POLICY.expectedCalls) failures.push('NINE_CALL_AUTHORIZATION_REQUIRED');
  if (!namespaceDirectory) failures.push('CONSUMPTION_NAMESPACE_REQUIRED');
  else for (const name of ['consumed-v4.json', 'acceptance-v4.json', 'acceptance-v4.json.tmp']) {
    if (await pathExists(path.join(namespaceDirectory, name))) failures.push(`NAMESPACE_ALREADY_USED:${name}`);
  }
  return { passed: failures.length === 0, failures };
}

/** Permanently freeze preregistration with exclusive creation. Use only after independent review. */
export async function writeFrozenV4Preregistration(filePath, preregistration) {
  assert.equal(preregistration?.profile, PROFILE, 'V4_PREREG_PROFILE_MISMATCH');
  assert.equal(preregistration?.frozen, true, 'V4_PREREG_MUST_BE_FROZEN');
  for (const key of ['contractSha256', 'productionFingerprintSha256', 'sourceFingerprintSha256',
    'schemaPromptFingerprintSha256', 'protectedHistorySha256', 'evaluationFingerprintSha256']) {
    assert.match(String(preregistration[key] || ''), SHA256_RE, `V4_PREREG_BINDING_INVALID:${key}`);
  }
  const document = { ...preregistration, profile: PROFILE, status: 'FROZEN_PREREGISTRATION', targetedAcceptanceExecuted: false };
  const bytes = `${JSON.stringify(document, null, 2)}\n`;
  const handle = await open(filePath, 'wx');
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  return { path: filePath, sha256: sha256(bytes) };
}

/** Parse only the response envelope and return a redacted diagnostic on malformed output. */
export function parseSemanticResponseSafelyV4(raw, question) {
  try {
    if (Buffer.byteLength(String(raw), 'utf8') > RESOURCE_POLICY.maximumSemanticResponseBytes) {
      return { parsed: false, valid: false, responseSha256: sha256(String(raw)), error: 'SEMANTIC_RESPONSE_TOO_LARGE' };
    }
    const value = JSON.parse(raw);
    const valid = Boolean(validateSemanticQuestionInterpretation(value, question));
    return { parsed: true, valid, responseSha256: sha256(raw), ...(valid ? { interpretation: value } : {}) };
  } catch {
    return { parsed: false, valid: false, responseSha256: sha256(String(raw)), error: 'MALFORMED_SEMANTIC_RESPONSE' };
  }
}

export async function buildDesignFingerprints() {
  const contract = await readV4Contract();
  const cases = await loadIrasFirstV2TargetedCases();
  const promptFingerprints = [];
  for (const testCase of cases) {
    let fingerprint;
    await interpretSemanticQuestion(testCase.question, 'v4-api-free-prompt-projection', async (prompt, system, _provider, options) => {
      assert.equal(fingerprint, undefined, 'V4_TEMPLATE_CALL_COUNT_CHANGED');
      fingerprint = { promptSha256: sha256(prompt), systemSha256: sha256(system),
        schemaSha256: sha256(JSON.stringify(options.responseJsonSchema)), promptChars: prompt.length, systemChars: system.length };
      return '{}';
    });
    assert.ok(fingerprint, 'V4_TEMPLATE_PROJECTION_MISSING');
    promptFingerprints.push({ caseId: testCase.id, ...fingerprint });
  }
  assert.equal(SEMANTIC_QUESTION_TIMEOUT_MS, RESOURCE_POLICY.timeoutMs, 'V4_TIMEOUT_DRIFT');
  assert.equal(sha256(JSON.stringify(SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA)), promptFingerprints[0].schemaSha256, 'V4_SCHEMA_FINGERPRINT_DRIFT');
  const fingerprintTree = async (relativeRoot, predicate = () => true) => {
    const rows = [];
    const visit = async relative => {
      for (const entry of await readdir(path.join(ROOT, relative), { withFileTypes: true })) {
        const child = `${relative}/${entry.name}`;
        if (entry.isDirectory()) await visit(child);
        else if (entry.isFile() && predicate(child)) rows.push({ path: child, sha256: sha256(await readFile(path.join(ROOT, child))) });
      }
    };
    await visit(relativeRoot);
    return rows.sort((a, b) => a.path.localeCompare(b.path));
  };
  const sourceFiles = await fingerprintTree('src', file => /\.(?:ts|tsx)$/.test(file));
  const evaluationFiles = await fingerprintTree('tests/evaluation/singapore', file => /\.(?:mjs|json)$/.test(file));
  const regressionFiles = await fingerprintTree('tests/regression', file => /\.(?:mjs|json)$/.test(file));
  const fixedFiles = ['AGENTS.md', 'package.json',
    'docs/evaluation/multi-authority-workstreams/iras-first-targeted-acceptance-2026-10-04-v4/acceptance-design.md',
    'docs/evaluation/multi-authority-workstreams/iras-first-targeted-acceptance-2026-10-04-v4/supervisor-preregistration.md'];
  const fixedFileRows = await Promise.all(fixedFiles.map(async relative => ({ path: relative,
    sha256: sha256(await readFile(path.join(ROOT, relative))) })));
  const protectedHistory = await protectedHistorySnapshot();
  const schemaPromptFingerprintSha256 = sha256(JSON.stringify(promptFingerprints));
  const productionFingerprintSha256 = sha256(JSON.stringify(sourceFiles));
  const sourceFingerprintSha256 = sha256(JSON.stringify(sourceFiles));
  const protectedHistorySha256 = sha256(JSON.stringify(protectedHistory.immutableEvaluationArtifactRows));
  const evaluationFingerprintSha256 = sha256(JSON.stringify([...evaluationFiles, ...regressionFiles, ...fixedFileRows]));
  return { contractSha256: sha256(JSON.stringify(contract)), promptFingerprints,
    sourceFiles, evaluationFiles, regressionFiles, fixedFileRows,
    productionFingerprintSha256, sourceFingerprintSha256, schemaPromptFingerprintSha256,
    protectedHistorySha256, evaluationFingerprintSha256,
    designValidationRuntime: { nodeVersion: process.versions.node, nodeMajor: Number(process.versions.node.split('.')[0]) },
    productionExecutionRequirement: { nodeMajor: RESOURCE_POLICY.executionNodeMajor } };
}

export async function protectedHistorySnapshot() {
  const v9PlanPath = path.join(ROOT, 'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-03-v9/iras-mapped-evidence-plan-v9.json');
  const v9 = JSON.parse(await readFile(v9PlanPath, 'utf8'));
  const rows = [];
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.path === 'string' && typeof value.sha256 === 'string') rows.push(value);
    else for (const child of Object.values(value)) visit(child);
  };
  visit(v9.preregistration.historicalFingerprints);
  assert.equal(rows.length, 389, 'V4_PROTECTED_HISTORY_ROW_COUNT_CHANGED');
  for (const row of rows) assert.equal(sha256(await readFile(path.join(ROOT, row.path))), row.sha256, `V4_PROTECTED_HISTORY_CHANGED:${row.path}`);
  const baseDirectory = 'docs/evaluation/multi-authority-workstreams';
  const artifactRows = [];
  const walk = async relative => {
    for (const entry of await readdir(path.join(ROOT, relative), { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory() && child !== `${baseDirectory}/iras-first-targeted-acceptance-2026-10-04-v4`) await walk(child);
      else if (entry.isFile()) artifactRows.push({ path: child, sha256: sha256(await readFile(path.join(ROOT, child))) });
    }
  };
  await walk(baseDirectory);
  for (const relative of [
    'docs/evaluation/multi-authority-workstreams/iras-first-targeted-acceptance-2026-10-04-v4/acceptance-design.md',
    'docs/evaluation/multi-authority-workstreams/iras-first-targeted-acceptance-2026-10-04-v4/supervisor-preregistration.md'
  ]) artifactRows.push({ path: relative, sha256: sha256(await readFile(path.join(ROOT, relative))) });
  return { frozenV9HistoricalRows: rows.length, immutableEvaluationArtifactRows: artifactRows.sort((a, b) => a.path.localeCompare(b.path)), verified: true };
}

/** Exclusive, write-once guard for an eventual run. API-free tests use only a temporary namespace. */
export async function reserveConsumption(namespaceDirectory, binding, preflight) {
  assert.equal(preflight?.passed, true, 'V4_PREFLIGHT_NOT_PASSED');
  const markerPath = path.join(namespaceDirectory, 'consumed-v4.json');
  assert.ok(binding && REQUIRED_CONSUMPTION_BINDINGS.every(key => binding[key]), 'V4_CONSUMPTION_BINDING_INCOMPLETE');
  for (const key of ['preregistrationSha256', 'contractSha256', 'evidenceLockSha256', 'productionFingerprintSha256',
    'sourceFingerprintSha256', 'schemaPromptFingerprintSha256', 'protectedHistorySha256', 'evaluationFingerprintSha256']) {
    assert.match(String(binding[key] || ''), SHA256_RE, `V4_CONSUMPTION_BINDING_INVALID:${key}`);
  }
  assert.deepEqual(binding.sharedAllowanceObservation?.authorizedGeminiCalls, RESOURCE_POLICY.expectedCalls,
    'V4_NINE_CALL_AUTHORIZATION_REQUIRED');
  for (const name of ['consumed-v4.json', 'acceptance-v4.json', 'acceptance-v4.json.tmp']) {
    assert.equal(await pathExists(path.join(namespaceDirectory, name)), false, `V4_NAMESPACE_ALREADY_USED:${name}`);
  }
  const bytes = `${JSON.stringify({ ...binding, profile: PROFILE, status: 'CONSUMED_NO_RETRY' }, null, 2)}\n`;
  const handle = await open(markerPath, 'wx');
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  return { markerPath, markerSha256: sha256(bytes) };
}

export async function assertV4ContractMatchesFrozenQuestions(contract) {
  contract ||= await readV4Contract();
  const frozen = await loadIrasFirstV2TargetedCases();
  assert.deepEqual(contract.cases.map(row => row.caseId), CASE_IDS, 'V4_CASE_ORDER_CHANGED');
  for (let i = 0; i < frozen.length; i += 1) {
    const row = contract.cases[i];
    assert.equal(row.question, frozen[i].question, `V4_QUESTION_BYTES_CHANGED:${row.caseId}`);
    assert.equal(row.questionSha256, sha256(row.question), `V4_QUESTION_HASH_CHANGED:${row.caseId}`);
    assert.deepEqual(row.semantic.expectedIssues, expectedIssuesV4(frozen[i]), `V4_SEMANTIC_TEMPLATE_CHANGED:${row.caseId}`);
    assert.ok(row.semantic.requiredSubjectMarkers.length > 0, `V4_SUBJECT_MARKER_MISSING:${row.caseId}`);
    assert.ok(row.application.expectedByIssue && row.application.allowedOverallStatuses.length > 0, `V4_APPLICATION_EXPECTATION_MISSING:${row.caseId}`);
  }
  return true;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [command] = process.argv.slice(2);
  assert.equal(command, '--check-design', 'V4_SUPPORTS_DESIGN_CHECK_ONLY');
  const contract = await readV4Contract();
  await assertV4ContractMatchesFrozenQuestions(contract);
  const history = await protectedHistorySnapshot();
  const fingerprints = await buildDesignFingerprints();
  console.log(JSON.stringify({ profile: PROFILE, contractSha256: fingerprints.contractSha256,
    protectedHistoryVerified: history.verified, protectedV9Rows: history.frozenV9HistoricalRows,
    designRuntime: fingerprints.designValidationRuntime }));
}
