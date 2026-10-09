import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { classifyQuestion } from '../../../src/classification/questionClassifier.ts';
import { executeStructuredLlmCall } from '../../../src/services/aiTransport.ts';
import { buildAuthorityWorkstreams, planAuthorityWorkstreams } from '../../../src/services/authorityWorkstreams.ts';
import {
  canonicalAccountingWorkstreamAuthority,
  SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA,
  interpretSemanticQuestion,
  reconcileQuestionUnderstanding,
  SEMANTIC_QUESTION_TIMEOUT_MS
} from '../../../src/services/semanticQuestionUnderstanding.ts';
import { diagnoseSemanticResponse } from './semantic-contract-diagnosis.mjs';
import { matchIssues, scoreIssueDimensions } from './multi-authority-issue-scoring.mjs';
import irasFirstConfig from './iras-first-evaluation-config-v1.json' with { type: 'json' };
import irasFirstConfigV2 from './iras-first-evaluation-config-v2.json' with { type: 'json' };
import {
  AUTHORITY_COVERAGE_SCOPE,
  IRAS_FIRST_GAP_CODES,
  IRAS_FIRST_PROFILE_VERSION,
  buildPerIssueScopeDiagnostics,
  admittedEvidenceConsistent,
  diagnosticHasCompleteVerifiedSupport,
  explicitUnsupported,
  evaluateIrasFirstCase,
  scopeAwareWorkstreamSetAccuracy,
  summarizeRuntimeIssueAssignments,
  summarizeIrasFirstAcceptance
} from './iras-first-release-contract.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, '../../..');
const REPORT_DIRECTORY = path.join(PROJECT_ROOT, 'docs', 'evaluation', 'multi-authority-workstreams');
const SEMANTIC_WIRE_FORMAT_OUTPUT_DIRECTORY = path.join(REPORT_DIRECTORY, 'semantic-wire-format-live-2026-10-02');
const IRAS_FIRST_OUTPUT_DIRECTORY = path.join(REPORT_DIRECTORY, 'iras-first-live-2026-10-02-v1');
const IRAS_FIRST_V2_OUTPUT_DIRECTORY = path.join(REPORT_DIRECTORY, 'iras-first-live-2026-10-02-v2');
const MODEL = 'gemini-3.5-flash-lite';
const START_GAP_MS = 15_250;
const OUTPUT_PREFIX = 'semantic-contract-followup-v2-live';
const INTENT_BOUNDARY_OUTPUT_PREFIX = 'semantic-intent-targeted-live';
const INTENT_FINAL_OUTPUT_PREFIX = 'semantic-intent-final-live';
const AUTHORITY_RELIEF_TARGETED_OUTPUT_PREFIX = 'authority-relief-targeted-live';
const AUTHORITY_RELIEF_FINAL_OUTPUT_PREFIX = 'authority-relief-final-live';
const SEMANTIC_WIRE_FORMAT_TARGETED_OUTPUT_PREFIX = 'semantic-wire-format-targeted-live';
const SEMANTIC_WIRE_FORMAT_FINAL_OUTPUT_PREFIX = 'semantic-wire-format-final-live';
const IRAS_FIRST_TARGETED_PROFILE = 'iras-first-targeted-v1-live';
const IRAS_FIRST_FINAL_PROFILE = 'iras-first-final-v1-live';
const IRAS_FIRST_TARGETED_V2_PROFILE = 'iras-first-targeted-v2-live';
const IRAS_FIRST_FINAL_V2_PROFILE = 'iras-first-final-v2-live';
const IRAS_FIRST_TARGETED_OUTPUT_PREFIX = irasFirstConfig.targetedOutputPrefix;
const IRAS_FIRST_FINAL_OUTPUT_PREFIX = irasFirstConfig.finalOutputPrefix;
const IRAS_FIRST_CONFIG_FIXTURE = path.join(SCRIPT_DIRECTORY, 'iras-first-evaluation-config-v1.json');
const IRAS_FIRST_V2_CONFIG_FIXTURE = path.join(SCRIPT_DIRECTORY, 'iras-first-evaluation-config-v2.json');
const IRAS_FIRST_HISTORICAL_ARTIFACT_MANIFEST = path.join(IRAS_FIRST_OUTPUT_DIRECTORY, 'historical-artifact-hashes.json');
const IRAS_FIRST_V2_HISTORICAL_ARTIFACT_MANIFEST = path.join(PROJECT_ROOT, irasFirstConfigV2.protectedHistoryManifest);
const PRIMARY_FIXTURE = path.join(SCRIPT_DIRECTORY, 'semantic-contract-followup.json');
const OPERATION_FIXTURE = path.join(SCRIPT_DIRECTORY, 'semantic-operation-followup.json');
const GUIDANCE_FIXTURE = path.join(SCRIPT_DIRECTORY, 'semantic-reliability-post-guidance.json');
const INTENT_BOUNDARY_FIXTURE = path.join(SCRIPT_DIRECTORY, 'semantic-intent-boundaries.json');
const AUTHORITY_RELIEF_TARGETED_FIXTURE = path.join(SCRIPT_DIRECTORY, 'authority-relief-targeted.json');
const AUTHORITY_RELIEF_PROTECTED_HASHES = path.join(REPORT_DIRECTORY, 'authority-relief-protected-hashes.json');
const SEMANTIC_WIRE_FORMAT_PROTECTED_HASHES = path.join(REPORT_DIRECTORY, 'semantic-wire-format-protected-hashes.json');
const COMPARABLE_BASELINE = path.join(REPORT_DIRECTORY, 'contract-followup-comparable-baseline.json');
const EVALUATION_RUNNER_FILE = fileURLToPath(import.meta.url);
const INTENT_CLI_RUNNER_FILE = path.join(SCRIPT_DIRECTORY, 'semantic-intent-followup-evaluation.mjs');
const TIMEOUT_EXPERIMENT_RUNNER_FILE = path.join(SCRIPT_DIRECTORY, 'semantic-structured-timeout-experiment-v2.mjs');
const SOURCE_FILES = Object.freeze({
  semanticInterpretation: path.join(PROJECT_ROOT, 'src', 'services', 'semanticQuestionUnderstanding.ts'),
  transport: path.join(PROJECT_ROOT, 'src', 'services', 'aiTransport.ts'),
  classifier: path.join(PROJECT_ROOT, 'src', 'classification', 'questionClassifier.ts'),
  authorityWorkstreams: path.join(PROJECT_ROOT, 'src', 'services', 'authorityWorkstreams.ts'),
  responseDiagnostics: path.join(SCRIPT_DIRECTORY, 'semantic-contract-diagnosis.mjs'),
  issueScoring: path.join(SCRIPT_DIRECTORY, 'multi-authority-issue-scoring.mjs')
});
const IRAS_FIRST_SCOPE_FILES = Object.freeze({
  releaseContract: path.join(SCRIPT_DIRECTORY, 'iras-first-release-contract.mjs'),
  profileConfig: IRAS_FIRST_CONFIG_FIXTURE,
  historicalArtifactManifest: IRAS_FIRST_HISTORICAL_ARTIFACT_MANIFEST
});
const IRAS_FIRST_V2_SCOPE_FILES = Object.freeze({
  releaseContract: path.join(SCRIPT_DIRECTORY, 'iras-first-release-contract.mjs'),
  profileConfig: IRAS_FIRST_V2_CONFIG_FIXTURE,
  inheritedV1ProfileConfig: IRAS_FIRST_CONFIG_FIXTURE,
  historicalArtifactManifest: IRAS_FIRST_V2_HISTORICAL_ARTIFACT_MANIFEST
});
const AUTHORITY_RELIEF_RESOLVER_FILES = Object.freeze({
  queryTopicResolver: path.join(PROJECT_ROOT, 'src', 'retrieval', 'queryTopicResolver.ts'),
  coverageRegistry: path.join(PROJECT_ROOT, 'src', 'standards', 'coverageRegistry.ts')
});
const FIXTURE_FILES = Object.freeze({
  semanticContractFollowup: PRIMARY_FIXTURE,
  semanticOperationFollowup: OPERATION_FIXTURE,
  semanticReliabilityPostGuidance: GUIDANCE_FIXTURE,
  comparableBaseline: COMPARABLE_BASELINE
});
const REQUIRED_CASE_IDS = Object.freeze([
  'A-paraphrase-2',
  'adversarial-C-employee-benefit',
  'control-general-recognition',
  'control-general-interaction',
  'A-paraphrase-3',
  'dev-conceptual-illustration',
  'dev-training-entitlement',
  'dev-mixed-entry-total',
  'dev-corporate-filing',
  'dev-investment-comparison'
]);
const INTENT_KNOWN_CASE_IDS = Object.freeze([
  'A-paraphrase-2',
  'adversarial-C-employee-benefit',
  'control-general-recognition'
]);
const INTENT_BOUNDARY_CASE_IDS = Object.freeze([
  'employer-cpf-implicit-calculation',
  'wht-payment-amount-calculation',
  'general-employment-benefit-rule',
  'specific-employee-benefit-treatment',
  'withholding-tax-liability-classification'
]);
const AUTHORITY_RELIEF_TARGETED_CASE_IDS = Object.freeze([
  'control-general-recognition', 'A-paraphrase-2',
  'target-sfrsi-general-recognition', 'target-mixed-ifrs-singapore-accounting',
  'target-relief-entitlement', 'target-relief-amount',
  'target-cpf-general-control', 'target-mom-general-control'
]);
const AUTHORITY_RELIEF_TARGETED_CONTROL_IDS = Object.freeze([
  'target-sfrsi-general-recognition', 'target-mixed-ifrs-singapore-accounting',
  'target-relief-entitlement', 'target-relief-amount',
  'target-cpf-general-control', 'target-mom-general-control'
]);
const SEMANTIC_WIRE_FORMAT_CASE_IDS = Object.freeze([
  'target-mixed-ifrs-singapore-accounting',
  'control-general-recognition',
  'A-paraphrase-2',
  'target-relief-entitlement',
  'dev-investment-comparison',
  'target-sfrsi-general-recognition'
]);
const REJECTION_CODES = new Set([
  'NONE', 'WRONG_ROOT_TYPE', 'MISSING_KEY', 'UNEXPECTED_KEY', 'WRONG_TYPE', 'COUNT_LIMIT', 'INVALID_LABEL',
  'INVALID_AUTHORITY', 'INVALID_ENUM', 'INVALID_POPULATION', 'INVALID_DOMAIN', 'INVALID_OPERATION',
  'INVALID_EVIDENCE_REQUIREMENT', 'INVALID_CONCEPT_ROLE', 'INVALID_SCHEMA_VERSION', 'INVALID_TOPIC_ID',
  'DUPLICATE_AUTHORITY', 'CONCEPT_STRUCTURE', 'EMPTY_ISSUES', 'ISSUE_STRUCTURE',
  'ISSUE_AUTHORITY_COUNT', 'AUTHORITY_OVERLAP', 'DOMAIN_AUTHORITY_MISMATCH', 'CALCULATION_FLAG_MISMATCH',
  'CASE_FLAG_CONTRADICTION', 'JOURNAL_DOMAIN_MISMATCH', 'UNKNOWN_AUTHORITY_MIX', 'ISSUE_COUNT_LIMIT',
  'LOW_CONFIDENCE', 'INVALID_CONFIDENCE', 'CONFIDENCE_OUT_OF_RANGE', 'CONTRADICTORY_FIELDS', 'SCHEMA_MISMATCH',
  'MALFORMED_JSON', 'RESPONSE_TOO_LARGE', 'UNCLASSIFIED_REJECTION'
]);
const FAILURE_CODES = new Set([
  'NO_PROVIDER', 'INVALID_RESPONSE', 'LOW_CONFIDENCE', 'TIMEOUT', 'PROVIDER_ERROR', 'RATE_LIMITED', 'QUERY_TOO_LONG'
]);
const FAILURE_REASONS = new Set(['RESPONSE_TOO_LARGE', 'MALFORMED_JSON', 'CONTRADICTORY_FIELDS', 'SCHEMA_MISMATCH']);
const MODES = new Set(['SEMANTIC_INTERPRETATION', 'SEMANTIC_PLUS_RULES', 'DETERMINISTIC_FALLBACK']);
const POPULATIONS = new Set(['INDIVIDUAL', 'EMPLOYEE', 'EMPLOYER', 'COMPANY', 'SHAREHOLDER', 'FUND', 'PROPERTY_OWNER', 'UNKNOWN']);
const DOMAINS = new Set([
  'ACCOUNTING', 'IRAS_INCOME_TAX', 'IRAS_GST', 'IRAS_PROPERTY_TAX', 'IRAS_STAMP_DUTY', 'IRAS_OTHER',
  'CPF_PAYROLL', 'MOM_EMPLOYMENT', 'ACRA_CORPORATE', 'MAS_FUNDS', 'UNKNOWN'
]);
const AUTHORITIES = new Set([
  'IRAS', 'CPF', 'ACRA', 'MOM', 'MAS', 'ACCOUNTING_STANDARDS', 'IFRS_FOUNDATION', 'SSO', 'UNKNOWN'
]);
const OPERATIONS = new Set([
  'EXPLAIN_RULE', 'EXPLAIN_INTERACTION', 'DETERMINE_TREATMENT', 'CHECK_ELIGIBILITY', 'CALCULATE',
  'PREPARE_JOURNAL', 'COMPARE', 'FILING_REQUIREMENT', 'OTHER'
]);
const EVIDENCE_REQUIREMENTS = new Set(['AUTHORITATIVE_SOURCE', 'CASE_FACTS', 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS', 'UNRESOLVED']);
const RUNTIME_STATUSES = new Set(['VERIFIED', 'CONDITIONAL', 'INSUFFICIENT']);
const EVIDENCE_STATUSES = new Set(['VERIFIED', 'INSUFFICIENT']);
const APPLICATION_STATUSES = new Set(['NOT_REQUIRED', 'UNRESOLVED']);
const CASE_SPECIFIC_OPERATIONS = new Set(['CALCULATE', 'PREPARE_JOURNAL', 'CHECK_ELIGIBILITY', 'DETERMINE_TREATMENT']);
const AUTHORITY_RELIEF_ROUTING_GAP_CODES = Object.freeze([
  'NO_COVERAGE_TOPIC', 'UNKNOWN_DOMAIN', 'UNASSIGNED_QUERY_TOPIC', 'CANONICAL_AREA_UNRESOLVED',
  'ISSUE_UNMAPPED', 'NO_GOVERNING_AUTHORITY', 'PROVIDER_UNAVAILABLE', 'PROVIDER_AUTHORITY_MISMATCH',
  'PROVIDER_ERROR', 'ISSUE_PLAN_HAS_UNMAPPED_RESIDUAL', 'ISSUE_PLAN_COVERAGE_UNESTABLISHED',
  'NO_CANDIDATE_EVIDENCE', 'CANDIDATE_REJECTED', 'NO_ADMITTED_EVIDENCE', 'NO_VERIFIED_CLAIM',
  'ISSUE_CONCEPT_UNCOVERED', 'IRAS_SCOPE_NOT_COVERED', 'OTHER_GAP'
]);
const AUTHORITY_RELIEF_BLOCKING_ROUTING_GAP_CODES = Object.freeze([
  'NO_COVERAGE_TOPIC', 'UNKNOWN_DOMAIN', 'UNASSIGNED_QUERY_TOPIC', 'CANONICAL_AREA_UNRESOLVED',
  'ISSUE_UNMAPPED', 'NO_GOVERNING_AUTHORITY', 'PROVIDER_UNAVAILABLE', 'PROVIDER_AUTHORITY_MISMATCH',
  'PROVIDER_ERROR', 'ISSUE_PLAN_HAS_UNMAPPED_RESIDUAL', 'ISSUE_PLAN_COVERAGE_UNESTABLISHED', 'OTHER_GAP'
]);
function requiresApplicationStatus(issue) {
  return issue.evidenceRequirement === 'CASE_FACTS' ||
    issue.evidenceRequirement === 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS' ||
    issue.evidenceRequirement === 'UNRESOLVED' && CASE_SPECIFIC_OPERATIONS.has(issue.operation);
}
const SAFE_RUNNER_ERRORS = new Set([
  'Live capture requires --live.',
  'A semantic contract follow-up output file already exists.',
  'GEMINI_API_KEY is not configured.',
  'A required fixed evaluation case is missing.',
  'Source or fixture hash changed during live capture.',
  'A fixed evaluation case did not make exactly one provider request.',
  'The authority-relief targeted profile has not passed; final live capture is gated.',
  'A protected semantic evaluation artifact has changed.',
  'The semantic wire-format targeted profile has not passed; final live capture is gated.',
  'The IRAS-first V2 targeted profile has not passed; final live capture is gated.',
  'The IRAS-first V2 timeout experiment has not passed its fixed policy; targeted capture is gated.'
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function hashFile(filePath) {
  try {
    return sha256(await readFile(filePath));
  } catch {
    throw new Error('A required fixed evaluation case is missing.');
  }
}

async function hashManifest(files) {
  const entries = await Promise.all(Object.entries(files).map(async ([key, filePath]) => [key, await hashFile(filePath)]));
  return Object.fromEntries(entries);
}

async function assertHistoricalArtifactsUnchanged() {
  const manifest = await readJson(IRAS_FIRST_HISTORICAL_ARTIFACT_MANIFEST);
  if (manifest?.baselineCommit !== 'd194d2bc7121b2c9a1deec562f77eafdfb98cd90' ||
      !Array.isArray(manifest.artifacts) || manifest.artifacts.length !== 110 ||
      new Set(manifest.artifacts.map(item => item?.path)).size !== manifest.artifacts.length) {
    throw new Error('A protected semantic evaluation artifact has changed.');
  }
  const checks = await Promise.all(manifest.artifacts.map(async item => {
    if (typeof item?.path !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)) return false;
    const filePath = path.resolve(PROJECT_ROOT, item.path.replaceAll('\\', '/'));
    const relativePath = path.relative(PROJECT_ROOT, filePath);
    if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) return false;
    try {
      return await hashFile(filePath) === item.sha256;
    } catch {
      return false;
    }
  }));
  if (!checks.every(Boolean)) throw new Error('A protected semantic evaluation artifact has changed.');
  return { artifactCount: checks.length, verified: true };
}

async function assertV2HistoricalArtifactsUnchanged() {
  const manifest = await readJson(IRAS_FIRST_V2_HISTORICAL_ARTIFACT_MANIFEST);
  if (manifest?.baselineCommit !== '4bd3abc9c22619401f22aa8abba73af61b5d6217' ||
      !Array.isArray(manifest.artifacts) || manifest.artifacts.length !== 118 ||
      new Set(manifest.artifacts.map(item => item?.path)).size !== manifest.artifacts.length) {
    throw new Error('A protected semantic evaluation artifact has changed.');
  }
  const checks = await Promise.all(manifest.artifacts.map(async item => {
    if (typeof item?.path !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)) return false;
    const filePath = path.resolve(PROJECT_ROOT, item.path.replaceAll('\\', '/'));
    const relativePath = path.relative(PROJECT_ROOT, filePath);
    if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) return false;
    try {
      return await hashFile(filePath) === item.sha256;
    } catch {
      return false;
    }
  }));
  if (!checks.every(Boolean)) throw new Error('A protected semantic evaluation artifact has changed.');
  return { baselineCommit: manifest.baselineCommit, artifactCount: checks.length, verified: true };
}

export async function assertIrasFirstV2HistoricalArtifactsUnchanged() {
  return assertV2HistoricalArtifactsUnchanged();
}

function sameManifest(left, right) {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => left[key] === right[key]);
}

function ratio(numerator, denominator) {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 10_000 : null;
}

function exactSameSet(actual, expected) {
  return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length &&
    [...actual].sort().every((item, index) => item === [...expected].sort()[index]);
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    throw new Error('A required fixed evaluation case is missing.');
  }
}

function isStringArray(value) {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function validateIntentBoundaryCase(testCase) {
  const expected = testCase?.expected;
  const workstreamSets = testCase?.expectedWorkstreamsAnyOf;
  if (typeof testCase?.id !== 'string' || typeof testCase?.question !== 'string' ||
      !Array.isArray(expected) || expected.length === 0 ||
      new Set(expected.map(issue => issue?.id)).size !== expected.length ||
      expected.some(issue => typeof issue?.id !== 'string' || typeof issue?.subject !== 'string' ||
        !Array.isArray(issue.matchAny) || issue.matchAny.length === 0 ||
        issue.matchAny.some(tokens => !isStringArray(tokens) || tokens.length === 0) ||
        !isStringArray(issue.population) || !isStringArray(issue.domain) ||
        !isStringArray(issue.governingAuthorities) ||
        !Array.isArray(issue.contextualAuthoritiesAnyOf) ||
        issue.contextualAuthoritiesAnyOf.some(authorities => !isStringArray(authorities)) ||
        !isStringArray(issue.operation)) ||
      !Array.isArray(workstreamSets) || workstreamSets.length === 0 ||
      workstreamSets.some(set => !Array.isArray(set) || set.length === 0 ||
        set.some(item => typeof item !== 'string' || !/^[A-Z_]+\/[A-Z_]+$/.test(item)))) {
    throw new Error('A required fixed evaluation case is missing.');
  }
  return {
    id: testCase.id,
    question: testCase.question,
    group: 'INDEPENDENT_CONTROL',
    expected,
    expectedWorkstreamsAnyOf: workstreamSets
  };
}

/** Fixed intent-targeted selection: three frozen historical cases and five frozen boundary controls. */
export async function loadSemanticIntentTargetedCases() {
  const [historicalCases, boundaryFixture] = await Promise.all([
    loadSemanticContractFollowupCases(),
    readJson(INTENT_BOUNDARY_FIXTURE)
  ]);
  const historicalById = new Map(historicalCases.map(testCase => [testCase.id, testCase]));
  const boundaryRows = boundaryFixture.cases;
  if (!Array.isArray(boundaryRows) || new Set(boundaryRows.map(item => item?.id)).size !== boundaryRows.length) {
    throw new Error('A required fixed evaluation case is missing.');
  }
  const boundaryById = new Map(boundaryRows.map(testCase => [testCase.id, testCase]));
  const known = INTENT_KNOWN_CASE_IDS.map(id => historicalById.get(id));
  const boundary = INTENT_BOUNDARY_CASE_IDS.map(id => boundaryById.get(id)).map(validateIntentBoundaryCase);
  if (known.some(testCase => !testCase) || known.length !== INTENT_KNOWN_CASE_IDS.length ||
      boundary.length !== INTENT_BOUNDARY_CASE_IDS.length ||
      new Set([...known, ...boundary].map(testCase => testCase.id)).size !== known.length + boundary.length) {
    throw new Error('A required fixed evaluation case is missing.');
  }
  return [...known, ...boundary];
}

/** Intent-final deliberately reuses the original, unchanged ten-case selection. */
export async function loadSemanticIntentFinalCases() {
  const cases = await loadSemanticContractFollowupCases();
  if (cases.length !== REQUIRED_CASE_IDS.length ||
      REQUIRED_CASE_IDS.some(id => !cases.some(testCase => testCase.id === id))) {
    throw new Error('A required fixed evaluation case is missing.');
  }
  return cases;
}

function validateAuthorityReliefCase(testCase) {
  const expected = testCase?.expected;
  const workstreamSets = testCase?.expectedWorkstreamsAnyOf;
  const strictOperations = testCase?.strictOperations || [];
  if (typeof testCase?.id !== 'string' || typeof testCase?.question !== 'string' ||
      typeof testCase?.expectedRequiresUserSpecificFacts !== 'boolean' ||
      !Array.isArray(expected) || expected.length === 0 ||
      new Set(expected.map(issue => issue?.id)).size !== expected.length ||
      expected.some(issue => typeof issue?.id !== 'string' || typeof issue?.subject !== 'string' ||
        !Array.isArray(issue.matchAny) || issue.matchAny.length === 0 ||
        issue.matchAny.some(tokens => !isStringArray(tokens) || tokens.length === 0) ||
        !isStringArray(issue.population) || !isStringArray(issue.domain) ||
        !isStringArray(issue.governingAuthorities) ||
        !Array.isArray(issue.contextualAuthoritiesAnyOf) ||
        issue.contextualAuthoritiesAnyOf.some(authorities => !isStringArray(authorities)) ||
        !isStringArray(issue.operation)) ||
      !Array.isArray(workstreamSets) || workstreamSets.length === 0 ||
      workstreamSets.some(set => !Array.isArray(set) || set.length === 0 ||
        set.some(item => typeof item !== 'string' || !/^[A-Z_]+\/[A-Z_]+$/.test(item))) ||
      !Array.isArray(strictOperations) || strictOperations.some(item =>
        !item || typeof item.issueId !== 'string' || !OPERATIONS.has(item.operation))) {
    throw new Error('A required fixed evaluation case is missing.');
  }
  return { ...testCase, group: 'INDEPENDENT_CONTROL' };
}

/** Fixed authority-relief set: two frozen questions and six independent controls. */
export async function loadAuthorityReliefTargetedCases() {
  const [historical, fixture] = await Promise.all([
    loadSemanticContractFollowupCases(),
    readJson(AUTHORITY_RELIEF_TARGETED_FIXTURE)
  ]);
  const historicalById = new Map(historical.map(testCase => [testCase.id, testCase]));
  const recognition = historicalById.get('control-general-recognition');
  const relief = historicalById.get('A-paraphrase-2');
  if (fixture?.schemaVersion !== 1 || fixture?.expectedModel !== MODEL || !Array.isArray(fixture.cases) ||
      fixture.cases.length !== 6 || new Set(fixture.cases.map(testCase => testCase?.id)).size !== 6 ||
      !recognition || !relief ||
      relief.question !== 'For someone earning SGD 6,000 a month, what can they claim for personal tax relief on compulsory CPF, and what does the employer have to pay into CPF?') {
    throw new Error('A required fixed evaluation case is missing.');
  }
  const fixedHistorical = [
    { ...recognition, group: 'PRESELECTED_KNOWN_FAILURE', expectedRequiresUserSpecificFacts: false, strictOperations: [] },
    {
      ...relief,
      group: 'PRESELECTED_KNOWN_FAILURE',
      expectedRequiresUserSpecificFacts: true,
      strictOperations: [
        { issueId: 'employer-cpf-contribution', operation: 'CALCULATE' },
        { issueId: 'individual-cpf-tax-relief', operation: 'CHECK_ELIGIBILITY' }
      ]
    }
  ];
  const controls = fixture.cases.map(validateAuthorityReliefCase);
  const selected = [...fixedHistorical, ...controls];
  if (selected.length !== 8 || new Set(selected.map(testCase => testCase.id)).size !== selected.length ||
      !exactSameSet(controls.map(testCase => testCase.id), AUTHORITY_RELIEF_TARGETED_CONTROL_IDS)) {
    throw new Error('A required fixed evaluation case is missing.');
  }
  return selected;
}

/** Fixed six-case selection for the Gemini V2 wire-format profile, composed from frozen existing expectations. */
export async function loadSemanticWireFormatTargetedCases() {
  const [historical, authorityRelief] = await Promise.all([
    loadSemanticContractFollowupCases(),
    loadAuthorityReliefTargetedCases()
  ]);
  const byId = new Map([...historical, ...authorityRelief].map(testCase => [testCase.id, testCase]));
  const selected = SEMANTIC_WIRE_FORMAT_CASE_IDS.map(id => byId.get(id));
  if (selected.some(testCase => !testCase) || selected.length !== SEMANTIC_WIRE_FORMAT_CASE_IDS.length ||
      new Set(selected.map(testCase => testCase.id)).size !== selected.length) {
    throw new Error('A required fixed evaluation case is missing.');
  }
  return selected;
}

const IRAS_FIRST_SPECIFICITY = Object.freeze({
  'A-paraphrase-2': true,
  'adversarial-C-employee-benefit': true,
  'control-general-recognition': false,
  'control-general-interaction': false,
  'A-paraphrase-3': true,
  'dev-conceptual-illustration': false,
  'dev-training-entitlement': true,
  'dev-mixed-entry-total': true,
  'dev-corporate-filing': false,
  'dev-investment-comparison': false,
  'target-relief-entitlement': true,
  'target-relief-amount': true,
  'private-expense-treatment': true,
  'foreign-dividend-receipt-treatment': true,
  'corporate-residency-general-rule': false,
  'target-mixed-ifrs-singapore-accounting': false,
  'unsupported-sfrsi-6-exploration-evaluation': false
});

function applyIrasFirstVersionedExpectation(testCase, { historicalExpected } = {}) {
  const copied = {
    ...testCase,
    expected: testCase.expected.map(issue => ({ ...issue })),
    expectedWorkstreamsAnyOf: testCase.expectedWorkstreamsAnyOf.map(set => [...set]),
    expectedRequiresUserSpecificFacts: IRAS_FIRST_SPECIFICITY[testCase.id],
    expectationVersion: IRAS_FIRST_PROFILE_VERSION
  };
  if (typeof copied.expectedRequiresUserSpecificFacts !== 'boolean') {
    throw new Error('A required fixed evaluation case is missing.');
  }
  if (historicalExpected) copied.historicalExpected = historicalExpected.map(issue => ({ ...issue }));
  const adjudication = irasFirstConfig.adjudications?.[testCase.id];
  if (testCase.id === 'target-mixed-ifrs-singapore-accounting') {
    if (adjudication?.version !== IRAS_FIRST_PROFILE_VERSION || !Array.isArray(adjudication.contextualAuthoritiesAnyOf)) {
      throw new Error('A required fixed evaluation case is missing.');
    }
    copied.expected = copied.expected.map(issue => ({
      ...issue,
      contextualAuthoritiesAnyOf: adjudication.contextualAuthoritiesAnyOf.map(set => [...set])
    }));
    copied.adjudicationVersion = IRAS_FIRST_PROFILE_VERSION;
  }
  if (testCase.id === 'dev-investment-comparison') {
    if (adjudication?.version !== IRAS_FIRST_PROFILE_VERSION || !Array.isArray(adjudication.populationAnyOf) ||
        adjudication.coverageOutcome !== 'UNSUPPORTED') {
      throw new Error('A required fixed evaluation case is missing.');
    }
    copied.expected = copied.expected.map(issue => ({ ...issue, population: [...adjudication.populationAnyOf] }));
    copied.expectedCoverageOutcome = adjudication.coverageOutcome;
    copied.adjudicationVersion = IRAS_FIRST_PROFILE_VERSION;
  }
  return copied;
}

function validateIrasFirstProfileConfig() {
  const targeted = irasFirstConfig.targetedCaseIds;
  const final = irasFirstConfig.finalCaseIds;
  if (irasFirstConfig.schemaVersion !== 1 || irasFirstConfig.profileVersion !== IRAS_FIRST_PROFILE_VERSION ||
      !Array.isArray(targeted) || targeted.length < 8 || new Set(targeted).size !== targeted.length ||
      !Array.isArray(final) || final.length !== 12 || new Set(final).size !== final.length ||
      !irasFirstConfig.coverageStates || irasFirstConfig.coverageStates.IRAS?.state !== 'RELEASE_REQUIRED' ||
      Object.values(irasFirstConfig.coverageStates).some(item => !['RELEASE_REQUIRED', 'PARTIAL', 'NOT_YET_COVERED'].includes(item?.state)) ||
      irasFirstConfig.unsupportedNonIrasControl?.expectedCoverageOutcome !== 'UNSUPPORTED') {
    throw new Error('A required fixed evaluation case is missing.');
  }
}

/** Fixed IRAS-first targeted set; profile cases cannot be supplied by the caller. */
export async function loadIrasFirstTargetedCases() {
  validateIrasFirstProfileConfig();
  const [historical, authorityCases, boundaryFixture] = await Promise.all([
    loadSemanticContractFollowupCases(), loadAuthorityReliefTargetedCases(), readJson(INTENT_BOUNDARY_FIXTURE)
  ]);
  const boundaryById = new Map((Array.isArray(boundaryFixture?.cases) ? boundaryFixture.cases : []).map(item => [item?.id, item]));
  const historicalById = new Map(historical.map(testCase => [testCase.id, testCase]));
  const authorityById = new Map(authorityCases.map(testCase => [testCase.id, testCase]));
  const boundaryCases = ['private-expense-treatment', 'foreign-dividend-receipt-treatment', 'corporate-residency-general-rule']
    .map(id => {
      const source = boundaryById.get(id);
      if (!source) return undefined;
      const valid = validateIntentBoundaryCase(source);
      return {
        ...valid,
        expectedRequiresUserSpecificFacts: source.mock?.requiresUserSpecificFacts,
        group: 'INDEPENDENT_CONTROL'
      };
    });
  const unsupported = irasFirstConfig.unsupportedNonIrasControl;
  const unsupportedCase = {
    ...unsupported,
    group: 'INDEPENDENT_CONTROL'
  };
  const available = new Map([
    ...historical.map(testCase => [testCase.id, testCase]),
    ...authorityCases.map(testCase => [testCase.id, testCase]),
    ...boundaryCases.filter(Boolean).map(testCase => [testCase.id, testCase]),
    [unsupportedCase.id, unsupportedCase]
  ]);
  const selected = irasFirstConfig.targetedCaseIds.map(id => {
    const testCase = available.get(id);
    if (!testCase) return undefined;
    const original = historicalById.get(id);
    return applyIrasFirstVersionedExpectation(testCase, original ? { historicalExpected: original.expected } : {});
  });
  if (selected.some(item => !item) || selected.length !== 9 ||
      selected.filter(item => item.expected.some(issue => issue.governingAuthorities?.includes('IRAS'))).length < 6 ||
      selected.filter(item => item.expectedCoverageOutcome === 'UNSUPPORTED').length !== 2 ||
      selected.filter(item => item.expected.some(issue => issue.governingAuthorities?.includes('ACCOUNTING_STANDARDS'))).length < 3) {
    throw new Error('A required fixed evaluation case is missing.');
  }
  return selected;
}

/** Fixed final set: original ten historical questions plus the two central IRAS relief cases. */
export async function loadIrasFirstFinalCases() {
  validateIrasFirstProfileConfig();
  const [historical, authorityCases] = await Promise.all([
    loadSemanticContractFollowupCases(), loadAuthorityReliefTargetedCases()
  ]);
  const authorityById = new Map(authorityCases.map(testCase => [testCase.id, testCase]));
  const available = new Map([
    ...historical.map(testCase => [testCase.id, testCase]),
    ...authorityCases.map(testCase => [testCase.id, testCase])
  ]);
  const selected = irasFirstConfig.finalCaseIds.map(id => {
    const testCase = available.get(id);
    if (!testCase) return undefined;
    const original = historical.find(item => item.id === id);
    return applyIrasFirstVersionedExpectation(testCase, original ? { historicalExpected: original.expected } : {});
  });
  if (selected.some(item => !item) || selected.length !== 12 ||
      historical.length !== 10 || historical.some(item => !selected.some(selectedItem => selectedItem.id === item.id)) ||
      !authorityById.has('target-relief-entitlement') || !authorityById.has('target-relief-amount')) {
    throw new Error('A required fixed evaluation case is missing.');
  }
  return selected;
}

function validateIrasFirstV2ProfileConfig() {
  const targeted = irasFirstConfigV2.targetedCaseIds;
  const final = irasFirstConfigV2.finalCaseIds;
  const fixed = irasFirstConfigV2.newTargetedCases;
  const specificity = irasFirstConfigV2.caseSpecificityById;
  const timeout = irasFirstConfigV2.timeoutExperiment;
  const privateExpenseAdjudication = irasFirstConfigV2.adjudications?.['private-expense-treatment'];
  const expectedTargeted = [
    'target-relief-entitlement', 'target-relief-amount', 'A-paraphrase-2', 'private-expense-treatment',
    'foreign-dividend-receipt-treatment', 'corporate-residency-general-rule', 'wht-royalty-general-rule',
    'gst-input-tax-general-rule', 'unsupported-sfrsi-6-exploration-evaluation'
  ];
  const validFixedCases = Array.isArray(fixed) && fixed.length === 2 && fixed.every(testCase => {
    try {
      validateAuthorityReliefCase(testCase);
      return testCase.expectedRequiresUserSpecificFacts === false;
    } catch {
      return false;
    }
  });
  if (irasFirstConfigV2.schemaVersion !== 2 || irasFirstConfigV2.profileVersion !== 'iras-first-v2' ||
      irasFirstConfigV2.inheritsExistingExpectationsFrom !== 'iras-first-evaluation-config-v1.json' ||
      irasFirstConfigV2.protectedHistoryManifest !== 'docs/evaluation/multi-authority-workstreams/iras-first-live-2026-10-02-v2/historical-artifact-hashes.json' ||
      JSON.stringify(targeted) !== JSON.stringify(expectedTargeted) || new Set(targeted).size !== 9 ||
      JSON.stringify(final) !== JSON.stringify(irasFirstConfig.finalCaseIds) || final.length !== 12 ||
      !validFixedCases || new Set(fixed.map(testCase => testCase.id)).size !== 2 ||
      JSON.stringify(fixed.map(testCase => testCase.id)) !== JSON.stringify(['wht-royalty-general-rule', 'gst-input-tax-general-rule']) ||
      targeted.some(id => typeof specificity?.[id] !== 'boolean') || final.some(id => typeof specificity?.[id] !== 'boolean') ||
      Object.values(irasFirstConfigV2.adjudications || {}).some(adjudication => adjudication?.version !== irasFirstConfigV2.profileVersion) ||
      irasFirstConfigV2.baselineProductionTimeoutMs !== 8000 ||
      timeout?.protocolVersion !== 'semantic-structured-timeout-v2' || timeout.model !== MODEL ||
      JSON.stringify(timeout.caseIds) !== JSON.stringify(['corporate-residency-general-rule', 'target-mixed-ifrs-singapore-accounting', 'A-paraphrase-2']) ||
      JSON.stringify(timeout.timeoutArmsMs) !== JSON.stringify([8000, 12000, 15000]) ||
      timeout.observationsPerCaseArm !== 2 || timeout.minimumStartGapMs !== START_GAP_MS ||
      timeout.recommendationPolicy?.defaultTimeoutMs !== irasFirstConfigV2.baselineProductionTimeoutMs ||
      timeout.recommendationPolicy?.minimumTimeoutReductionVsDefault !== 2 ||
      privateExpenseAdjudication?.version !== irasFirstConfigV2.profileVersion ||
      JSON.stringify(privateExpenseAdjudication.contextualAuthoritiesAnyOf) !== JSON.stringify([[], ['ACCOUNTING_STANDARDS']])) {
    throw new Error('A required fixed evaluation case is missing.');
  }
}

function applyIrasFirstV2Expectation(testCase, { historicalExpected } = {}) {
  const copied = {
    ...testCase,
    expected: testCase.expected.map(issue => ({ ...issue })),
    expectedWorkstreamsAnyOf: testCase.expectedWorkstreamsAnyOf.map(set => [...set]),
    expectedRequiresUserSpecificFacts: irasFirstConfigV2.caseSpecificityById[testCase.id],
    expectationVersion: irasFirstConfigV2.profileVersion
  };
  if (typeof copied.expectedRequiresUserSpecificFacts !== 'boolean') throw new Error('A required fixed evaluation case is missing.');
  if (historicalExpected) copied.historicalExpected = historicalExpected.map(issue => ({ ...issue }));
  const adjudication = irasFirstConfigV2.adjudications?.[testCase.id];
  if (testCase.id === 'target-mixed-ifrs-singapore-accounting') {
    if (adjudication?.version !== irasFirstConfigV2.profileVersion || !Array.isArray(adjudication.contextualAuthoritiesAnyOf)) {
      throw new Error('A required fixed evaluation case is missing.');
    }
    copied.expected = copied.expected.map(issue => ({
      ...issue,
      contextualAuthoritiesAnyOf: adjudication.contextualAuthoritiesAnyOf.map(set => [...set])
    }));
    copied.adjudicationVersion = irasFirstConfigV2.profileVersion;
  }
  if (testCase.id === 'private-expense-treatment') {
    if (adjudication?.version !== irasFirstConfigV2.profileVersion || !Array.isArray(adjudication.contextualAuthoritiesAnyOf)) {
      throw new Error('A required fixed evaluation case is missing.');
    }
    copied.expected = copied.expected.map(issue => ({
      ...issue,
      contextualAuthoritiesAnyOf: adjudication.contextualAuthoritiesAnyOf.map(set => [...set])
    }));
    copied.adjudicationVersion = irasFirstConfigV2.profileVersion;
  }
  if (testCase.id === 'dev-investment-comparison') {
    if (adjudication?.version !== irasFirstConfigV2.profileVersion || !Array.isArray(adjudication.populationAnyOf) ||
        adjudication.coverageOutcome !== 'UNSUPPORTED') {
      throw new Error('A required fixed evaluation case is missing.');
    }
    copied.expected = copied.expected.map(issue => ({ ...issue, population: [...adjudication.populationAnyOf] }));
    copied.expectedCoverageOutcome = adjudication.coverageOutcome;
    copied.adjudicationVersion = irasFirstConfigV2.profileVersion;
  }
  return copied;
}

/** Fixed V2 targeted set reuses V1 historical expectations and adds only the frozen general IRAS controls. */
export async function loadIrasFirstV2TargetedCases() {
  validateIrasFirstV2ProfileConfig();
  const v1Cases = await loadIrasFirstTargetedCases();
  const available = new Map(v1Cases.map(testCase => [testCase.id, testCase]));
  for (const fixedCase of irasFirstConfigV2.newTargetedCases) {
    const checked = validateAuthorityReliefCase(fixedCase);
    if (available.has(checked.id)) throw new Error('A required fixed evaluation case is missing.');
    available.set(checked.id, checked);
  }
  const selected = irasFirstConfigV2.targetedCaseIds.map(id => {
    const testCase = available.get(id);
    return testCase ? applyIrasFirstV2Expectation(testCase,
      testCase.historicalExpected ? { historicalExpected: testCase.historicalExpected } : {}) : undefined;
  });
  if (selected.some(testCase => !testCase) || selected.length !== 9 ||
      selected.filter(testCase => testCase.expected.some(issue => issue.governingAuthorities?.includes('IRAS'))).length !== 8 ||
      selected.filter(testCase => testCase.expectedCoverageOutcome === 'UNSUPPORTED').length !== 1 ||
      selected.some(testCase => testCase.expectationVersion !== irasFirstConfigV2.profileVersion)) {
    throw new Error('A required fixed evaluation case is missing.');
  }
  return selected;
}

/** Fixed V2 final set keeps the original ten historical questions and the same two IRAS relief cases. */
export async function loadIrasFirstV2FinalCases() {
  validateIrasFirstV2ProfileConfig();
  const [historical, authorityCases] = await Promise.all([
    loadSemanticContractFollowupCases(), loadAuthorityReliefTargetedCases()
  ]);
  const available = new Map([
    ...historical.map(testCase => [testCase.id, testCase]),
    ...authorityCases.map(testCase => [testCase.id, testCase])
  ]);
  const selected = irasFirstConfigV2.finalCaseIds.map(id => {
    const testCase = available.get(id);
    const original = historical.find(item => item.id === id);
    return testCase ? applyIrasFirstV2Expectation(testCase, original ? { historicalExpected: original.expected } : {}) : undefined;
  });
  if (selected.some(testCase => !testCase) || selected.length !== 12 || historical.length !== 10 ||
      historical.some(testCase => !selected.some(selectedCase => selectedCase.id === testCase.id)) ||
      selected.some(testCase => testCase.expectationVersion !== irasFirstConfigV2.profileVersion)) {
    throw new Error('A required fixed evaluation case is missing.');
  }
  return selected;
}

/** Fixed cases for the isolated timeout pilot, drawn from the frozen V2 final set. */
export async function loadIrasFirstV2TimeoutCases() {
  const [finalCases, targetedCases, authorityCases] = await Promise.all([
    loadIrasFirstV2FinalCases(), loadIrasFirstV2TargetedCases(), loadAuthorityReliefTargetedCases()
  ]);
  const available = new Map([...finalCases, ...targetedCases, ...authorityCases].map(testCase => [testCase.id, testCase]));
  const selected = irasFirstConfigV2.timeoutExperiment.caseIds.map(id => {
    const testCase = available.get(id);
    return testCase ? applyIrasFirstV2Expectation(testCase) : undefined;
  });
  if (selected.some(testCase => !testCase) || selected.length !== 3 ||
      JSON.stringify(selected.map(testCase => testCase.id)) !== JSON.stringify(irasFirstConfigV2.timeoutExperiment.caseIds)) {
    throw new Error('A required fixed evaluation case is missing.');
  }
  return selected;
}

function getExpectedIssues(fixture, testCase) {
  const issueContracts = fixture.issueContracts?.[testCase.contract];
  const requestedIds = testCase.expectedIssueIds || issueContracts?.map(issue => issue.id);
  if (!Array.isArray(requestedIds) || requestedIds.some(id => typeof id !== 'string')) {
    throw new Error('A required fixed evaluation case is missing.');
  }
  const byId = new Map((issueContracts || []).map(issue => [issue.id, issue]));
  const expected = requestedIds.map(id => byId.get(id));
  if (expected.some(issue => !issue) || new Set(requestedIds).size !== requestedIds.length) {
    throw new Error('A required fixed evaluation case is missing.');
  }
  return expected;
}

function expectedWorkstreamSets(testCase, operationFixture, guidanceFixture) {
  const direct = testCase.expectedWorkstreamsAnyOf || (testCase.expectedWorkstreams ? [testCase.expectedWorkstreams] : undefined);
  if (direct) return direct;
  const source = testCase.id === 'A-paraphrase-3' ? guidanceFixture : operationFixture;
  const derived = source.expectedWorkstreams?.[testCase.contract];
  if (!Array.isArray(derived) || derived.some(item => typeof item !== 'string')) {
    throw new Error('A required fixed evaluation case is missing.');
  }
  return [derived];
}

export async function loadSemanticContractFollowupCases() {
  const [fixture, operationFixture, guidanceFixture, comparableBaseline] = await Promise.all([
    readJson(PRIMARY_FIXTURE), readJson(OPERATION_FIXTURE), readJson(GUIDANCE_FIXTURE), readJson(COMPARABLE_BASELINE)
  ]);
  const rows = fixture.cases;
  if (!Array.isArray(rows) || rows.length !== REQUIRED_CASE_IDS.length ||
      REQUIRED_CASE_IDS.some(id => !rows.some(item => item.id === id)) ||
      new Set(rows.map(item => item.id)).size !== rows.length ||
      fixture.expectedModel !== MODEL || comparableBaseline.calls?.length !== 5) {
    throw new Error('A required fixed evaluation case is missing.');
  }
  const knownFailureIds = new Set(comparableBaseline.calls.map(item => item.caseId));
  if (knownFailureIds.size !== 5 || [...knownFailureIds].some(id => !REQUIRED_CASE_IDS.includes(id))) {
    throw new Error('A required fixed evaluation case is missing.');
  }
  return rows.map(testCase => ({
    id: testCase.id,
    question: testCase.question,
    group: knownFailureIds.has(testCase.id) ? 'PRESELECTED_KNOWN_FAILURE' : 'INDEPENDENT_CONTROL',
    expected: getExpectedIssues(fixture, testCase),
    expectedWorkstreamsAnyOf: expectedWorkstreamSets(testCase, operationFixture, guidanceFixture)
  }));
}

async function refuseExistingOutputs(directory, outputPrefix = OUTPUT_PREFIX) {
  for (const name of [`${outputPrefix}.json`, `${outputPrefix}.md`]) {
    try {
      await access(path.join(directory, name));
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw new Error('A semantic contract follow-up output file already exists.');
    }
    throw new Error('A semantic contract follow-up output file already exists.');
  }
}

async function atomicWrite(filePath, contents) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, contents, { encoding: 'utf8', flag: 'wx' });
  await rename(temporaryPath, filePath);
}

function safeResult(result) {
  const mode = MODES.has(result?.mode) ? result.mode : 'DETERMINISTIC_FALLBACK';
  const failure = FAILURE_CODES.has(result?.failure) ? result.failure : undefined;
  const failureReason = FAILURE_REASONS.has(result?.failureReason) ? result.failureReason : undefined;
  const providerStatus = Number.isInteger(result?.providerStatus) && result.providerStatus >= 100 && result.providerStatus <= 599
    ? result.providerStatus
    : undefined;
  return {
    mode,
    ...(failure ? { failure } : {}),
    ...(failureReason ? { failureReason } : {}),
    ...(providerStatus ? { providerStatus } : {})
  };
}

function safeDiagnostic(diagnostic, { includeMetadataMismatch = false } = {}) {
  if (!diagnostic || typeof diagnostic !== 'object') return undefined;
  const rawShape = diagnostic.safeShape && typeof diagnostic.safeShape === 'object' ? diagnostic.safeShape : {};
  const shapeCount = value => Number.isInteger(value) && value >= 0 ? Math.min(value, 1_000_000) : 0;
  const rootType = new Set(['OBJECT', 'ARRAY', 'STRING', 'NUMBER', 'BOOLEAN', 'NULL', 'UNDEFINED']);
  return {
    validatorAccepted: diagnostic.validatorAccepted === true,
    interpreted: diagnostic.interpreted === true,
    rejectionCode: REJECTION_CODES.has(diagnostic.rejectionCode) ? diagnostic.rejectionCode : 'UNCLASSIFIED_REJECTION',
    violationCodes: Array.isArray(diagnostic.violations)
      ? diagnostic.violations.slice(0, 24).map(item => REJECTION_CODES.has(item?.code) ? item.code : 'UNCLASSIFIED_REJECTION')
      : [],
    ...(includeMetadataMismatch ? {
      caseFlagMismatch: diagnostic.caseFlagMismatch === true,
      nonViolationCodes: Array.isArray(diagnostic.nonViolationCodes)
        ? diagnostic.nonViolationCodes.filter(code => code === 'CASE_FLAG_MISMATCH').slice(0, 4) : []
    } : {}),
    safeShape: {
      rootType: rootType.has(rawShape.rootType) ? rawShape.rootType : 'UNKNOWN',
      responseType: rootType.has(rawShape.responseType) ? rawShape.responseType : 'UNKNOWN',
      keyCount: shapeCount(rawShape.keyCount),
      extraKeyCount: shapeCount(rawShape.extraKeyCount),
      missingKeyCount: shapeCount(rawShape.missingKeyCount),
      issueCount: shapeCount(rawShape.fields?.issues?.count),
      conceptCount: shapeCount(rawShape.fields?.concepts?.count),
      responseChars: shapeCount(rawShape.responseChars),
      exceedsLimit: rawShape.exceedsLimit === true,
      malformed: rawShape.malformed === true
    }
  };
}

function safeEnum(value, allowlist, fallback) {
  return allowlist.has(value) ? value : fallback;
}

function expectedWorkstreamAccuracy(runtimeWorkstreams, expectedSets) {
  const actual = runtimeWorkstreams.map(stream => `${stream.authority}/${stream.domain}`);
  return expectedSets.some(expected => exactSameSet(actual, expected));
}

function authorityReliefRoutingDiagnostics(semanticIssues, reconciledIssues, runtime, runtimeIssues) {
  const requested = reconciledIssues.slice(0, semanticIssues.length);
  const requestedIds = new Set(requested.map(issue => issue.id).filter(id => typeof id === 'string'));
  const runtimeById = new Map(runtimeIssues.filter(issue => requestedIds.has(issue.issueId)).map(issue => [issue.issueId, issue]));
  const mappedIssueCount = requested.filter(issue => issue.status === 'MAPPED').length;
  const lifecycleMappedCount = requested.filter(issue => runtimeById.get(issue.id)?.lifecycle?.mapped === true).length;
  const retrievalAttemptedCount = requested.filter(issue => runtimeById.get(issue.id)?.lifecycle?.retrievalAttempted === true).length;
  const routingGapCounts = Object.fromEntries(AUTHORITY_RELIEF_ROUTING_GAP_CODES.map(code => [code, 0]));
  for (const gap of Array.isArray(runtime.gaps) ? runtime.gaps : []) {
    if (!requestedIds.has(gap?.issueId)) continue;
    const code = typeof gap.code === 'string' && Object.hasOwn(routingGapCounts, gap.code) ? gap.code : 'OTHER_GAP';
    routingGapCounts[code] += 1;
  }
  const blockingRoutingGapCount = AUTHORITY_RELIEF_BLOCKING_ROUTING_GAP_CODES.reduce((sum, code) => sum + routingGapCounts[code], 0);
  const runtimeTimedOut = runtime?.timedOut === true || runtime?.timeout === true || runtime?.status === 'TIMEOUT' ||
    runtime?.failure === 'TIMEOUT' || runtime?.failureCode === 'TIMEOUT';
  const requestedIssueCoverage = {
    requestedIssueCount: semanticIssues.length,
    mappedIssueCount,
    inCanonicalRuntimeCount: runtimeById.size,
    lifecycleMappedCount,
    retrievalAttemptedCount,
    routingGapCounts,
    blockingRoutingGapCount,
    unclassifiedRoutingGapCount: routingGapCounts.OTHER_GAP
  };
  const requestedIssuesMappedAndRetrieved = semanticIssues.length > 0 &&
    requestedIssueCoverage.requestedIssueCount === mappedIssueCount &&
    requestedIssueCoverage.requestedIssueCount === requestedIssueCoverage.inCanonicalRuntimeCount &&
    requestedIssueCoverage.requestedIssueCount === lifecycleMappedCount &&
    requestedIssueCoverage.requestedIssueCount === retrievalAttemptedCount &&
    blockingRoutingGapCount === 0 && !runtimeTimedOut;
  return { requestedIssueCoverage, requestedIssuesMappedAndRetrieved, runtimeTimedOut };
}

function summarizeRuntime(testCase, understanding, buildRuntime, {
  captureAuthorityReliefRouting = false,
  captureIrasFirstScope = false
} = {}) {
  const semanticIssues = understanding.interpretation?.issues || [];
  try {
    const classification = classifyQuestion(testCase.question);
    const reconciled = reconcileQuestionUnderstanding(testCase.question, classification, understanding);
    const issuePlan = reconciled.issuePlan;
    const planned = planAuthorityWorkstreams(issuePlan);
    return buildRuntime(testCase.question, issuePlan, {
      localOnly: true,
      questionUnderstanding: understanding
    }).then(runtime => {
      const runtimeWorkstreams = Array.isArray(runtime.workstreams) ? runtime.workstreams : [];
      const runtimeIssues = runtimeWorkstreams.flatMap(stream => stream.issues || []);
      const reconciledIssues = issuePlan.issues.slice(0, semanticIssues.length);
      const operationsPreserved = semanticIssues.every((issue, index) => reconciledIssues[index]?.operation === issue.operation) &&
        runtimeIssues.every(item => {
          const source = reconciledIssues.find(issue => issue.id === item.issueId);
          return !source || source.operation === item.operation;
        });
      const requiresCaseFacts = semanticIssues.every((issue, index) => issue.domain === 'UNKNOWN' ||
        !CASE_SPECIFIC_OPERATIONS.has(issue.operation) ||
        reconciledIssues[index]?.evidenceRequirement === 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS');
      const incompletePlan = !issuePlan.coverageEstablished || issuePlan.hasUnmappedResidual ||
        issuePlan.issues.some(issue => issue.status === 'UNRESOLVED');
      const incompletePlanNotVerified = !incompletePlan ||
        (runtime.status !== 'VERIFIED' && runtime.evidenceStatus !== 'VERIFIED');
      const governingAuthorities = new Set(semanticIssues.flatMap(issue => issue.governingAuthorities || []));
      const contextualOnlyAuthorities = new Set(semanticIssues.flatMap(issue => issue.contextualAuthorities || [])
        .filter(authority => !governingAuthorities.has(authority)));
      const contextualAuthorityNotRouted = runtimeWorkstreams.every(stream => !contextualOnlyAuthorities.has(stream.authority));
      const residualIssues = issuePlan.issues.filter(issue => issue.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC');
      const residualHasNoWorkstream = residualIssues.every(residual =>
        !runtimeIssues.some(item => item.issueId === residual.id));
      const caseSpecificRuntimeIssues = runtimeIssues.filter(item => CASE_SPECIFIC_OPERATIONS.has(item.operation));
      const caseSpecificApplicationsUnresolved = caseSpecificRuntimeIssues.every(item => item.applicationStatus === 'UNRESOLVED');
      const applicationStatus = safeEnum(runtime.applicationStatus, APPLICATION_STATUSES, 'UNKNOWN');
      const requiredApplicationIssues = issuePlan.issues.filter(requiresApplicationStatus);
      const plannedIssueIds = new Set(planned.flatMap(stream => stream.issueIds));
      const routedApplicationIssues = requiredApplicationIssues.filter(issue => plannedIssueIds.has(issue.id));
      const runtimeIssueById = new Map(runtimeIssues.map(item => [item.issueId, item]));
      const requiredApplicationStatusesUnresolved = routedApplicationIssues.every(issue =>
        runtimeIssueById.get(issue.id)?.applicationStatus === 'UNRESOLVED');
      const requiresUnresolvedApplication = routedApplicationIssues.length > 0;
      const unresolvedApplicationNotVerified = !requiresUnresolvedApplication ||
        (applicationStatus === 'UNRESOLVED' && runtime.status !== 'VERIFIED' && requiredApplicationStatusesUnresolved);
      const applicationStatusCounts = {
        NOT_REQUIRED: runtimeIssues.filter(item => item.applicationStatus === 'NOT_REQUIRED').length,
        UNRESOLVED: runtimeIssues.filter(item => item.applicationStatus === 'UNRESOLVED').length,
        UNKNOWN: runtimeIssues.filter(item => !APPLICATION_STATUSES.has(item.applicationStatus)).length
      };
      applicationStatusCounts.requiredPlanIssues = requiredApplicationIssues.length;
      applicationStatusCounts.routedRequiredIssues = routedApplicationIssues.length;
      const finalWorkstreamSetAccuracy = expectedWorkstreamAccuracy(runtimeWorkstreams, testCase.expectedWorkstreamsAnyOf);
      const authorityReliefRouting = captureAuthorityReliefRouting
        ? authorityReliefRoutingDiagnostics(semanticIssues, reconciledIssues, runtime, runtimeIssues)
        : undefined;
      const runtimeIssueScopeDiagnostics = captureIrasFirstScope
        ? buildPerIssueScopeDiagnostics(semanticIssues, issuePlan, runtime)
        : undefined;
      const runtimeIssueAssignments = captureIrasFirstScope
        ? summarizeRuntimeIssueAssignments(semanticIssues, issuePlan, runtimeWorkstreams, runtime?.gaps || [])
        : undefined;
      return {
        plannedWorkstreamCount: planned.length,
        finalWorkstreamCount: runtimeWorkstreams.length,
        finalWorkstreamSetAccuracy,
        status: safeEnum(runtime.status, RUNTIME_STATUSES, 'UNKNOWN'),
        evidenceStatus: safeEnum(runtime.evidenceStatus, EVIDENCE_STATUSES, 'UNKNOWN'),
        applicationStatus,
        guardChecks: {
          operationsPreserved,
          caseFactsRequired: requiresCaseFacts,
          incompletePlanNotVerified,
          contextualAuthorityNotRouted,
          residualHasNoWorkstream,
          caseSpecificApplicationsUnresolved,
          requiredApplicationStatusesUnresolved,
          unresolvedApplicationNotVerified,
          ...(authorityReliefRouting ? { requestedIssuesMappedAndRetrieved: authorityReliefRouting.requestedIssuesMappedAndRetrieved } : {})
        },
        applicationStatusCounts,
        ...(authorityReliefRouting ? {
          requestedIssueCoverage: authorityReliefRouting.requestedIssueCoverage,
          runtimeTimedOut: authorityReliefRouting.runtimeTimedOut
        } : {}),
        ...(captureIrasFirstScope ? {
          runtimeIssueScopeDiagnostics,
          runtimeAssignmentIntegrity: runtimeIssueAssignments?.runtimeAssignmentIntegrity === true,
          runtimeAssignmentCounts: runtimeIssueAssignments?.runtimeAssignmentCounts,
          runtimeTimedOut: authorityReliefRouting?.runtimeTimedOut === true || runtime?.timedOut === true ||
            runtime?.timeout === true || runtime?.status === 'TIMEOUT'
        } : {})
      };
    });
  } catch {
    return Promise.resolve({
      plannedWorkstreamCount: 0,
      finalWorkstreamCount: 0,
      finalWorkstreamSetAccuracy: false,
      status: 'UNKNOWN',
      evidenceStatus: 'UNKNOWN',
      applicationStatus: 'UNKNOWN',
      category: 'LOCAL_ROUTING_FAILURE',
      guardChecks: {
        operationsPreserved: false,
        caseFactsRequired: false,
        incompletePlanNotVerified: false,
        contextualAuthorityNotRouted: false,
        residualHasNoWorkstream: false,
        caseSpecificApplicationsUnresolved: false,
        unresolvedApplicationNotVerified: false
      },
      applicationStatusCounts: { NOT_REQUIRED: 0, UNRESOLVED: 0, UNKNOWN: 0, requiredPlanIssues: 0, routedRequiredIssues: 0 },
      ...(captureIrasFirstScope ? {
        runtimeAssignmentIntegrity: false,
        runtimeAssignmentCounts: {
          semanticIssueCount: semanticIssues.length,
          plannedIssueCount: 0,
          runtimeIssueCount: 0,
          runtimeIssueIdMismatchCount: 0,
          duplicateRuntimeIssueIdCount: 0,
          unknownGapIssueIdCount: 0,
          emptyWorkstreamCount: 0,
          unresolvedPlanIssueCount: 0,
          unresolvedIrasPlanIssueCount: 0,
          knownUnsupportedNonIrasPlanIssueCount: 0,
          unrepresentedResidualPlanIssueCount: 0,
          issuePlanResidualAccommodation: false
        },
        runtimeIssueScopeDiagnostics: []
      } : {})
    });
  }
}

function scoreValidInterpretation(testCase, interpretation) {
  const actualIssues = interpretation.issues || [];
  const { expectedByActual } = matchIssues(testCase.expected, actualIssues);
  const matched = [...expectedByActual.entries()].map(([actualIndex, expectedIndex]) => ({
    actualIndex,
    expectedIndex,
    dimensions: scoreIssueDimensions(actualIssues[actualIndex], testCase.expected[expectedIndex])
  }));
  const matchedExpectedIssueIds = matched.map(item => testCase.expected[item.expectedIndex].id);
  return {
    expectedIssueCount: testCase.expected.length,
    predictedIssueCount: actualIssues.length,
    matchedIssueCount: matched.length,
    matchedExpectedIssueIds,
    issueRecall: ratio(matched.length, testCase.expected.length),
    issuePrecision: ratio(matched.length, actualIssues.length),
    completeQuestionIssueCoverage: matched.length === testCase.expected.length && matched.length === actualIssues.length,
    operationCorrect: matched.filter(item => item.dimensions.operation).length,
    operationMatched: matched.length,
    dimensionsCorrect: Object.fromEntries(['governingAuthority', 'contextualAuthority', 'domain', 'population', 'operation'].map(key => [
      key, matched.filter(item => item.dimensions[key]).length
    ]))
  };
}

function canonicalAuthorityIssueForScoring(issue, expected = false) {
  const domain = expected
    ? Array.isArray(issue.domain) && issue.domain.includes('ACCOUNTING') ? 'ACCOUNTING' : issue.domain?.[0]
    : issue.domain;
  return {
    ...issue,
    governingAuthorities: (issue.governingAuthorities || []).map(authority =>
      canonicalAccountingWorkstreamAuthority(domain, authority))
  };
}

/** Canonical-contract score for new authority-relief profiles; raw scoring remains unchanged. */
export function scoreAuthorityReliefCanonicalContract(testCase, interpretation) {
  const canonicalTestCase = {
    ...testCase,
    expected: testCase.expected.map(issue => {
      const strictOperation = strictOperationsForAuthorityReliefCase(testCase)
        .find(target => target.issueId === issue.id)?.operation;
      return {
        ...canonicalAuthorityIssueForScoring(issue, true),
        ...(strictOperation ? { operation: [strictOperation] } : {})
      };
    })
  };
  const canonicalInterpretation = {
    ...interpretation,
    issues: (interpretation.issues || []).map(issue => canonicalAuthorityIssueForScoring(issue))
  };
  return scoreValidInterpretation(canonicalTestCase, canonicalInterpretation);
}

function strictOperationsForAuthorityReliefCase(testCase) {
  if (Array.isArray(testCase.strictOperations) && testCase.strictOperations.length > 0) return testCase.strictOperations;
  const checks = [];
  const legacyStrict = STRICT_INTENT_OPERATIONS[testCase.id];
  if (legacyStrict) checks.push(legacyStrict);
  if (testCase.id === 'A-paraphrase-2' && testCase.expected.some(issue => issue.id === 'individual-cpf-tax-relief')) {
    checks.push({ issueId: 'individual-cpf-tax-relief', operation: 'CHECK_ELIGIBILITY' });
  }
  return checks;
}

/** 100% fixed-case acceptance for the new authority-relief profiles only. */
export function authorityReliefCaseAcceptance({
  testCase,
  validInterpretation,
  canonicalScoring,
  routing,
  interpretation,
  productionResult,
  capture,
  requestCount,
  sourceHashesConsistent,
  fixtureHashesConsistent
}) {
  const expectedSpecificity = typeof testCase.expectedRequiresUserSpecificFacts === 'boolean'
    ? testCase.expectedRequiresUserSpecificFacts : EXPECTED_CASE_SPECIFICITY[testCase.id];
  const actualSpecificity = interpretation?.requiresUserSpecificFacts;
  const caseSpecificityCorrect = typeof expectedSpecificity === 'boolean' &&
    typeof actualSpecificity === 'boolean' && actualSpecificity === expectedSpecificity;
  const strictOperationChecks = strictOperationsForAuthorityReliefCase(testCase).map(target => {
    const expectedIndex = testCase.expected.findIndex(issue => issue.id === target.issueId);
    const actualIssues = Array.isArray(interpretation?.issues) ? interpretation.issues : [];
    const { expectedByActual } = matchIssues(testCase.expected, actualIssues);
    const actualIndex = [...expectedByActual.entries()].find(([, index]) => index === expectedIndex)?.[0];
    const actualOperation = actualIndex === undefined ? undefined : actualIssues[actualIndex]?.operation;
    return {
      expectedIssueId: target.issueId,
      expectedOperation: target.operation,
      ...(actualOperation ? { actualOperation } : {}),
      matched: actualIndex !== undefined,
      passed: actualOperation === target.operation
    };
  });
  const issueCoverageCorrect = canonicalScoring?.completeQuestionIssueCoverage === true &&
    canonicalScoring.matchedIssueCount === canonicalScoring.expectedIssueCount &&
    canonicalScoring.predictedIssueCount === canonicalScoring.expectedIssueCount;
  const allDimensionsCorrect = canonicalScoring?.matchedIssueCount > 0 &&
    Object.values(canonicalScoring.dimensionsCorrect || {}).every(correct => correct === canonicalScoring.matchedIssueCount);
  const operationsCorrect = canonicalScoring?.operationMatched > 0 &&
    canonicalScoring.operationCorrect === canonicalScoring.operationMatched &&
    strictOperationChecks.every(check => check.passed);
  const topLevelCalculationFlagCorrect = typeof interpretation?.calculationRequested === 'boolean' &&
    interpretation.calculationRequested === (interpretation.requestedOperation === 'CALCULATE');
  const guardsCorrect = Boolean(routing?.guardChecks) && Object.values(routing.guardChecks).every(Boolean);
  const routingCorrect = routing?.finalWorkstreamSetAccuracy === true;
  const requestedIssueCoverage = routing?.requestedIssueCoverage;
  const expectedRequestedIssueCount = testCase.expected.length;
  const routingGapKeysCorrect = exactSameSet(Object.keys(requestedIssueCoverage?.routingGapCounts || {}), AUTHORITY_RELIEF_ROUTING_GAP_CODES) &&
    Object.values(requestedIssueCoverage?.routingGapCounts || {}).every(count => Number.isInteger(count) && count >= 0);
  const noBlockingRequestedRoutingGaps = routingGapKeysCorrect &&
    AUTHORITY_RELIEF_BLOCKING_ROUTING_GAP_CODES.every(code => requestedIssueCoverage.routingGapCounts[code] === 0) &&
    requestedIssueCoverage.unclassifiedRoutingGapCount === 0 && requestedIssueCoverage.blockingRoutingGapCount === 0;
  const requestedIssueCoverageCorrect = requestedIssueCoverage?.requestedIssueCount === expectedRequestedIssueCount &&
    requestedIssueCoverage.mappedIssueCount === expectedRequestedIssueCount &&
    requestedIssueCoverage.inCanonicalRuntimeCount === expectedRequestedIssueCount &&
    requestedIssueCoverage.lifecycleMappedCount === expectedRequestedIssueCount &&
    requestedIssueCoverage.retrievalAttemptedCount === expectedRequestedIssueCount &&
    noBlockingRequestedRoutingGaps && routing?.runtimeTimedOut === false &&
    routing?.guardChecks?.requestedIssuesMappedAndRetrieved === true;
  const runtimeTimedOut = routing?.runtimeTimedOut !== false;
  const singleProviderCallPassed = requestCount === 1 && validInterpretation && !productionResult?.failure &&
    capture?.responseReceived === true && !capture?.transportCategory;
  const fingerprintsStable = sourceHashesConsistent === true && fixtureHashesConsistent === true;
  const passed = validInterpretation && issueCoverageCorrect && allDimensionsCorrect && operationsCorrect &&
    caseSpecificityCorrect && topLevelCalculationFlagCorrect && routingCorrect && guardsCorrect &&
    requestedIssueCoverageCorrect && !runtimeTimedOut && singleProviderCallPassed && fingerprintsStable;
  return {
    passed,
    validInterpretation,
    issueCoverageCorrect,
    allDimensionsCorrect,
    operationsCorrect,
    caseSpecificity: { expected: expectedSpecificity, actual: actualSpecificity },
    caseSpecificityCorrect,
    topLevelCalculationFlagCorrect,
    routingCorrect,
    guardsCorrect,
    requestedIssueCoverageCorrect,
    runtimeTimedOut,
    singleProviderCallPassed,
    fingerprintsStable,
    strictOperationChecks
  };
}

function summarizeAuthorityReliefAcceptance(document, expectedCaseCount) {
  const rows = document.cases.filter(item => item.authorityReliefAcceptance);
  const issueTotal = rows.reduce((sum, item) => sum + (item.canonicalScoring?.expectedIssueCount || 0), 0);
  const matchedTotal = rows.reduce((sum, item) => sum + (item.canonicalScoring?.matchedIssueCount || 0), 0);
  const predictedTotal = rows.reduce((sum, item) => sum + (item.canonicalScoring?.predictedIssueCount || 0), 0);
  const matchedOperationTotal = rows.reduce((sum, item) => sum + (item.canonicalScoring?.operationMatched || 0), 0);
  const correctOperationTotal = rows.reduce((sum, item) => sum + (item.canonicalScoring?.operationCorrect || 0), 0);
  const dimensions = Object.fromEntries(['governingAuthority', 'contextualAuthority', 'domain', 'population', 'operation'].map(key => {
    const correct = rows.reduce((sum, item) => sum + (item.canonicalScoring?.dimensionsCorrect?.[key] || 0), 0);
    return [key, { correct, matched: matchedTotal, rate: ratio(correct, matchedTotal) }];
  }));
  const failedCases = rows.filter(item => !item.authorityReliefAcceptance.passed).map(item => item.caseId);
  const startPacingPassed = expectedCaseCount <= 1 ||
    Number.isFinite(document.minimumObservedStartGapMs) && document.minimumObservedStartGapMs >= START_GAP_MS;
  const completeCaseCount = rows.length === expectedCaseCount && document.requestCount === expectedCaseCount;
  const fingerprintsStable = document.sourceHashesConsistent === true && document.fixtureHashesConsistent === true &&
    rows.every(item => item.sourceHashesConsistent === true && item.fixtureHashesConsistent === true);
  const invalidResponses = rows.filter(item => !item.validInterpretation ||
    ['INVALID_RESPONSE', 'LOW_CONFIDENCE', 'NO_PROVIDER', 'QUERY_TOO_LONG'].includes(item.production?.failure)).length;
  const timeouts = rows.filter(item => item.production?.failure === 'TIMEOUT' || item.capture?.transportCategory === 'TIMEOUT').length;
  const providerFailures = rows.filter(item => ['PROVIDER_ERROR', 'RATE_LIMITED'].includes(item.production?.failure) ||
    ['PROVIDER_ERROR', 'RATE_LIMITED'].includes(item.capture?.transportCategory)).length;
  const zeroInvalidTimeoutProviderFailures = completeCaseCount && invalidResponses === 0 && timeouts === 0 && providerFailures === 0 &&
    rows.every(item => item.capture?.responseReceived === true && !item.capture?.transportCategory);
  const passed = completeCaseCount && failedCases.length === 0 &&
    matchedTotal === issueTotal && predictedTotal === issueTotal && correctOperationTotal === matchedOperationTotal &&
    Object.values(dimensions).every(item => item.rate === 1) && startPacingPassed && fingerprintsStable;
  return {
    passed,
    completedCases: rows.length,
    passedCases: rows.length - failedCases.length,
    expectedCases: expectedCaseCount,
    failedCases,
    canonicalContractScoring: {
      issueRecall: { correct: matchedTotal, total: issueTotal, rate: ratio(matchedTotal, issueTotal) },
      issuePrecision: { correct: matchedTotal, total: predictedTotal, rate: ratio(matchedTotal, predictedTotal) },
      dimensions,
      operationAccuracy: { correct: correctOperationTotal, total: matchedOperationTotal, rate: ratio(correctOperationTotal, matchedOperationTotal) },
      canonicalWorkstreamRoutingAccuracy: {
        correct: rows.filter(item => item.authorityReliefAcceptance.routingCorrect).length,
        total: rows.length,
        rate: ratio(rows.filter(item => item.authorityReliefAcceptance.routingCorrect).length, rows.length)
      }
    },
    invalidResponses,
    timeouts,
    providerFailures,
    zeroInvalidTimeoutProviderFailures,
    pacingPolicyPassed: startPacingPassed,
    fingerprintsStable
  };
}

function caseSummary(cases, group) {
  const selected = group === 'COMBINED' ? cases : cases.filter(item => item.group === group);
  const valid = selected.filter(item => item.validInterpretation);
  const nonValidCount = selected.length - valid.length;
  const expectedAll = selected.reduce((total, item) => total + item.scoring.expectedIssueCount, 0);
  const expectedValid = valid.reduce((total, item) => total + item.scoring.expectedIssueCount, 0);
  const matchedValid = valid.reduce((total, item) => total + item.scoring.matchedIssueCount, 0);
  const matchedAll = valid.reduce((total, item) => total + item.scoring.matchedIssueCount, 0);
  const predictedValid = valid.reduce((total, item) => total + item.scoring.predictedIssueCount, 0);
  const operationCorrect = valid.reduce((total, item) => total + item.scoring.operationCorrect, 0);
  const operationMatched = valid.reduce((total, item) => total + item.scoring.operationMatched, 0);
  const complete = valid.filter(item => item.scoring.completeQuestionIssueCoverage).length;
  const routesCorrect = valid.filter(item => item.routing?.finalWorkstreamSetAccuracy === true).length;
  const failureCount = code => selected.filter(item => item.production.failure === code).length;
  const dimensions = Object.fromEntries(['governingAuthority', 'contextualAuthority', 'domain', 'population', 'operation'].map(key => {
    const correct = valid.reduce((total, item) => total + item.scoring.dimensionsCorrect[key], 0);
    const matched = valid.reduce((total, item) => total + item.scoring.matchedIssueCount, 0);
    return [key, { correct, matched, rate: ratio(correct, matched) }];
  }));
  return {
    group,
    cases: selected.length,
    validInterpretations: { count: valid.length, total: selected.length, rate: ratio(valid.length, selected.length) },
    issueRecallValidInterpretations: { matched: matchedValid, expected: expectedValid, rate: ratio(matchedValid, expectedValid) },
    issueRecallAllCases: { matched: matchedAll, expected: expectedAll, rate: ratio(matchedAll, expectedAll) },
    issuePrecisionValidInterpretations: { matched: matchedValid, predicted: predictedValid, rate: ratio(matchedValid, predictedValid) },
    operationAccuracy: { correct: operationCorrect, matched: operationMatched, rate: ratio(operationCorrect, operationMatched) },
    completeQuestionCoverage: { complete, allCases: selected.length, rate: ratio(complete, selected.length) },
    routingWorkstreamCorrectness: {
      correct: routesCorrect,
      validCases: valid.length,
      allCases: selected.length,
      rateAmongValid: ratio(routesCorrect, valid.length),
      rateAllCases: ratio(routesCorrect, selected.length)
    },
    matchedDimensionAccuracy: dimensions,
    invalidResponses: {
      count: failureCount('INVALID_RESPONSE'),
      calls: selected.length,
      rate: ratio(failureCount('INVALID_RESPONSE'), selected.length),
      lowConfidence: { count: failureCount('LOW_CONFIDENCE'), calls: selected.length, rate: ratio(failureCount('LOW_CONFIDENCE'), selected.length) },
      timeout: { count: failureCount('TIMEOUT'), calls: selected.length, rate: ratio(failureCount('TIMEOUT'), selected.length) },
      providerFailure: { count: failureCount('PROVIDER_ERROR'), calls: selected.length, rate: ratio(failureCount('PROVIDER_ERROR'), selected.length) },
      rateLimited: { count: failureCount('RATE_LIMITED'), calls: selected.length, rate: ratio(failureCount('RATE_LIMITED'), selected.length) }
    },
    nonValidOutcomes: { count: nonValidCount, calls: selected.length, rate: ratio(nonValidCount, selected.length) }
  };
}

function renderMarkdown(document) {
  const intentProfile = document.evaluationProfile === 'intent-targeted' || document.evaluationProfile === 'intent-final';
  const irasFirstProfile = document.evaluationProfile === IRAS_FIRST_TARGETED_PROFILE || document.evaluationProfile === IRAS_FIRST_FINAL_PROFILE;
  const strictSemanticProfile = document.evaluationProfile === 'authority-relief-targeted-live' ||
    document.evaluationProfile === 'authority-relief-final-live' ||
    document.evaluationProfile === 'semantic-wire-format-targeted-live' ||
    document.evaluationProfile === 'semantic-wire-format-final-live';
  const heading = document.evaluationProfile === IRAS_FIRST_TARGETED_PROFILE ? '# IRAS-first v1 targeted evaluation'
    : document.evaluationProfile === IRAS_FIRST_FINAL_PROFILE ? '# IRAS-first v1 final evaluation'
    : document.evaluationProfile === IRAS_FIRST_TARGETED_V2_PROFILE ? '# IRAS-first v2 targeted evaluation'
      : document.evaluationProfile === IRAS_FIRST_FINAL_V2_PROFILE ? '# IRAS-first v2 final evaluation'
    : document.evaluationProfile === 'semantic-wire-format-targeted-live' ? '# Semantic wire-format targeted live evaluation'
    : document.evaluationProfile === 'semantic-wire-format-final-live' ? '# Semantic wire-format final live evaluation'
    : document.evaluationProfile === 'authority-relief-targeted-live' ? '# Authority and relief targeted live evaluation'
    : document.evaluationProfile === 'authority-relief-final-live' ? '# Authority and relief final live evaluation'
      : document.evaluationProfile === 'intent-targeted' ? '# Semantic intent targeted live evaluation'
    : document.evaluationProfile === 'intent-final' ? '# Semantic intent final live evaluation'
      : '# Semantic contract follow-up v2 live evaluation';
  const lines = [
    heading,
    '',
    `- Model: ${document.model}`,
    `- Timeout: ${document.timeoutMs} ms`,
    `- Minimum provider request start gap: ${document.minimumStartGapMs} ms`,
    `- Calls attempted: ${document.requestCount}`,
    `- Minimum observed start gap: ${document.minimumObservedStartGapMs ?? '—'} ms`,
    '',
    '| Case | Group | Valid | Matched / expected | Predicted | Operation correct / matched | Routing correct | Failure |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |'
  ];
  for (const item of document.cases) {
    lines.push(`| ${item.caseId} | ${item.group} | ${item.validInterpretation} | ${item.scoring.matchedIssueCount} / ${item.scoring.expectedIssueCount} | ${item.scoring.predictedIssueCount} | ${item.scoring.operationCorrect} / ${item.scoring.operationMatched} | ${item.routing?.finalWorkstreamSetAccuracy ?? false} | ${item.production.failure || '—'} |`);
  }
  if (strictSemanticProfile) {
    const acceptance = document.authorityReliefAcceptance;
    const canonical = acceptance?.canonicalContractScoring;
    lines.push(
      '',
      '## Canonical contract scoring',
      '',
      'Raw scoring above remains unchanged. The supplemental score canonicalizes only ACCOUNTING governing IFRS Foundation authority to ACCOUNTING_STANDARDS; contextual authorities remain unchanged. Fixed strict operation requirements are included.',
      '',
      `Strict acceptance passed: ${acceptance?.passed ?? false} (${acceptance?.passedCases ?? 0} / ${acceptance?.expectedCases ?? document.cases.length} cases).`,
      '',
      '| Issue recall | Issue precision | Governing authority | Contextual authority | Domain | Population | Operation | Canonical workstream routing | Invalid responses | Timeouts | Provider failures | Pacing | Fingerprints | Zero failures |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |',
      `| ${canonical?.issueRecall?.correct ?? 0} / ${canonical?.issueRecall?.total ?? 0} (${canonical?.issueRecall?.rate ?? 0}) | ${canonical?.issuePrecision?.correct ?? 0} / ${canonical?.issuePrecision?.total ?? 0} (${canonical?.issuePrecision?.rate ?? 0}) | ${canonical?.dimensions?.governingAuthority?.correct ?? 0} / ${canonical?.dimensions?.governingAuthority?.matched ?? 0} (${canonical?.dimensions?.governingAuthority?.rate ?? 0}) | ${canonical?.dimensions?.contextualAuthority?.correct ?? 0} / ${canonical?.dimensions?.contextualAuthority?.matched ?? 0} (${canonical?.dimensions?.contextualAuthority?.rate ?? 0}) | ${canonical?.dimensions?.domain?.correct ?? 0} / ${canonical?.dimensions?.domain?.matched ?? 0} (${canonical?.dimensions?.domain?.rate ?? 0}) | ${canonical?.dimensions?.population?.correct ?? 0} / ${canonical?.dimensions?.population?.matched ?? 0} (${canonical?.dimensions?.population?.rate ?? 0}) | ${canonical?.dimensions?.operation?.correct ?? 0} / ${canonical?.dimensions?.operation?.matched ?? 0} (${canonical?.dimensions?.operation?.rate ?? 0}) | ${canonical?.canonicalWorkstreamRoutingAccuracy?.correct ?? 0} / ${canonical?.canonicalWorkstreamRoutingAccuracy?.total ?? 0} (${canonical?.canonicalWorkstreamRoutingAccuracy?.rate ?? 0}) | ${acceptance?.invalidResponses ?? 0} | ${acceptance?.timeouts ?? 0} | ${acceptance?.providerFailures ?? 0} | ${acceptance?.pacingPolicyPassed ?? false} | ${acceptance?.fingerprintsStable ?? false} | ${acceptance?.zeroInvalidTimeoutProviderFailures ?? false} |`,
      '',
      'Per-case canonical contract acceptance:',
      '',
      '| Case | Canonical matched / expected | Dimensions | Operation | Specificity | Workstream set | Requested mapped / runtime / retrieval | Guards | Strict case acceptance |',
      '| --- | ---: | --- | --- | --- | --- | --- | --- | --- |'
    );
    for (const item of document.cases) {
      const score = item.canonicalScoring;
      const accepted = item.authorityReliefAcceptance;
      const requestedRouting = item.routing?.requestedIssueCoverage;
      const allDimensions = score && Object.values(score.dimensionsCorrect || {}).every(value => value === score.matchedIssueCount);
      const requestedRoutingText = requestedRouting
        ? `${requestedRouting.mappedIssueCount} / ${requestedRouting.requestedIssueCount} / ${requestedRouting.inCanonicalRuntimeCount} / ${requestedRouting.retrievalAttemptedCount}`
        : '—';
      lines.push(`| ${item.caseId} | ${score?.matchedIssueCount ?? 0} / ${score?.expectedIssueCount ?? 0} | ${allDimensions ?? false} | ${score?.operationCorrect ?? 0} / ${score?.operationMatched ?? 0} | ${accepted?.caseSpecificityCorrect ?? false} | ${accepted?.routingCorrect ?? false} | ${requestedRoutingText} | ${accepted?.guardsCorrect ?? false} | ${accepted?.passed ?? false} |`);
    }
  }
  if (irasFirstProfile) {
    const acceptance = document.irasFirstAcceptance;
    const quality = acceptance?.semanticQuality;
    const coverage = acceptance?.releaseRequiredCoverage;
    lines.push(
      '',
      '## IRAS-first release contract',
      '',
      `- Profile: ${document.releaseContractVersion}`,
      `- Acceptance passed: ${acceptance?.passed ?? false}`,
      '- Topic and record counts describe current registry inventory only; they do not assert completeness or source admission.',
      '- Runtime evidence uses the localOnly retrieval path and guardrails; it does not establish current live authority-page retrieval or substantive answer completion.',
      '',
      '| Authority | Scope state | Topics | Records | Note |',
      '| --- | --- | ---: | ---: | --- |'
    );
    for (const [authority, scope] of Object.entries(document.authorityCoverageScope || {})) {
      lines.push(`| ${authority} | ${scope.state} | ${scope.topics ?? '—'} | ${scope.records ?? '—'} | ${scope.aliasOf ? `alias of ${scope.aliasOf}` : scope.providerSupported ? 'provider available' : 'no supported provider'} |`);
    }
    lines.push(
      '',
      'Semantic quality across all authorities:',
      '',
      '| Valid responses | Issue recall | Issue precision | Case-specific facts | Governing authority | Contextual authority | Domain | Population | Operation |',
      '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
      `| ${quality?.validInterpretations?.count ?? 0} / ${quality?.validInterpretations?.total ?? 0} | ${quality?.issueRecall?.matched ?? 0} / ${quality?.issueRecall?.expected ?? 0} | ${quality?.issuePrecision?.matched ?? 0} / ${quality?.issuePrecision?.predicted ?? 0} | ${quality?.caseSpecificityCorrect?.correct ?? 0} / ${quality?.caseSpecificityCorrect?.total ?? 0} | ${quality?.dimensions?.governingAuthority?.correct ?? 0} / ${quality?.dimensions?.governingAuthority?.matched ?? 0} | ${quality?.dimensions?.contextualAuthority?.correct ?? 0} / ${quality?.dimensions?.contextualAuthority?.matched ?? 0} | ${quality?.dimensions?.domain?.correct ?? 0} / ${quality?.dimensions?.domain?.matched ?? 0} | ${quality?.dimensions?.population?.correct ?? 0} / ${quality?.dimensions?.population?.matched ?? 0} | ${quality?.dimensions?.operation?.correct ?? 0} / ${quality?.dimensions?.operation?.matched ?? 0} |`,
      '',
      'Release-required coverage (IRAS only):',
      '',
      '| Issues | Topic mapped | Canonical workstream | Provider path reached | Retrieval attempted | Evidence supported | Blocking gaps | Blocking cases |',
      '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
      `| ${coverage?.irasIssues ?? 0} | ${coverage?.topicMapped ?? 0} | ${coverage?.canonicalProviderPathReached ?? 0} | ${coverage?.providerPathReached ?? 0} | ${coverage?.retrievalAttempted ?? 0} | ${coverage?.evidenceSupported ?? 0} | ${coverage?.blockingGapCount ?? 0} | ${coverage?.blockingCases ?? 0} |`,
      '',
      'Non-IRAS semantic checks:',
      '',
      `- Correctly recognized and routed or explicitly unsupported: ${acceptance?.nonIrasSemantic?.recognizedAndRoutedOrExplicitlyUnsupported ?? 0} / ${acceptance?.nonIrasSemantic?.issues ?? 0}.`,
      '- Non-IRAS coverage gaps by authority are recorded below; explicit insufficient outcomes remain visible.',
      '',
      '| Authority | Issues | Explicit unsupported | Gap-code counts |',
      '| --- | ---: | ---: | --- |'
    );
    for (const [authority, metrics] of Object.entries(acceptance?.nonIrasCoverageGaps || {})) {
      lines.push(`| ${authority} | ${metrics.issueCount} | ${metrics.explicitUnsupportedCount} | ${JSON.stringify(metrics.gapCounts)} |`);
    }
    lines.push('', '| Case | Versioned expectation | IRAS issues passed / total | Non-IRAS passed / total | Semantic quality | Case accepted |', '| --- | --- | ---: | ---: | --- | --- |');
    for (const item of document.cases) {
      const result = item.irasFirstAcceptance;
      lines.push(`| ${item.caseId} | ${item.expectationVersion}${item.adjudicationVersion ? ` / ${item.adjudicationVersion}` : ''} | ${result?.irasIssuesPassed ?? 0} / ${result?.irasIssueCount ?? 0} | ${result?.nonIrasIssuesSemanticallyRoutedOrExplicitlyUnsupported ?? 0} / ${result?.nonIrasIssueCount ?? 0} | ${result?.semanticQualityPassed ?? false} | ${result?.passed ?? false} |`);
    }
    if (document.historicalAllAuthorityMetric) {
      const historical = document.historicalAllAuthorityMetric;
      lines.push(
        '',
        'All-authority recognition against unchanged historical expectations:',
        '',
        `- Scope: ${historical.scope === 'original-ten-final' ? 'original-ten final profile' : 'targeted-profile historical overlap'} (${historical.cases} / ${historical.expectedCases} historical cases).`,
        '- This recognition metric is not the original strict-gate acceptance result.',
        `- Cases scored: ${historical.cases} / ${historical.expectedCases}.`,
        `- Issue recall: ${historical.originalIssueRecall.matched} / ${historical.originalIssueRecall.expected} (${historical.originalIssueRecall.rate}).`,
        `- Issue precision: ${historical.originalIssuePrecision.matched} / ${historical.originalIssuePrecision.predicted} (${historical.originalIssuePrecision.rate}).`,
        `- All five dimensions correct: ${historical.allDimensionCases.correct} / ${historical.allDimensionCases.total} (${historical.allDimensionCases.rate}).`,
        `- Original strict-gate acceptance: ${historical.originalStrictGateAcceptance}.`,
        '| Historical dimension | Correct / matched / expected | Rate on expected |',
        '| --- | ---: | ---: |',
        ...Object.entries(historical.dimensions).map(([dimension, metrics]) =>
          `| ${dimension} | ${metrics.correct} / ${metrics.matched} / ${metrics.expected} | ${metrics.rate} |`),
        `- Complete cases: ${historical.originalExpectationCaseCoverage.complete} / ${historical.originalExpectationCaseCoverage.total} (${historical.originalExpectationCaseCoverage.rate}).`
      );
    }
  }
  lines.push('', '| Group | Valid / cases | Valid recall | All-case recall | Valid precision | Operation accuracy | Complete coverage | Routing / valid | Routing / all | Invalid / calls | Timeout | Provider failure |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const summary of document.summaries) {
    lines.push(`| ${summary.group} | ${summary.validInterpretations.count} / ${summary.cases} | ${summary.issueRecallValidInterpretations.matched} / ${summary.issueRecallValidInterpretations.expected} | ${summary.issueRecallAllCases.matched} / ${summary.issueRecallAllCases.expected} | ${summary.issuePrecisionValidInterpretations.matched} / ${summary.issuePrecisionValidInterpretations.predicted} | ${summary.operationAccuracy.correct} / ${summary.operationAccuracy.matched} | ${summary.completeQuestionCoverage.complete} / ${summary.completeQuestionCoverage.allCases} | ${summary.routingWorkstreamCorrectness.correct} / ${summary.routingWorkstreamCorrectness.validCases} | ${summary.routingWorkstreamCorrectness.correct} / ${summary.routingWorkstreamCorrectness.allCases} | ${summary.invalidResponses.count} / ${summary.invalidResponses.calls} | ${summary.invalidResponses.timeout.count} | ${summary.invalidResponses.providerFailure.count} |`);
  }
  if (intentProfile) {
    lines.push('', '| Case | Intent acceptance | Case-specific facts expected / actual | Strict operation checks |', '| --- | --- | --- | --- |');
    for (const item of document.cases) {
      const strictChecks = item.intentAcceptance?.strictOperationChecks || [];
      const specificity = item.intentAcceptance?.caseSpecificity;
      const specificityText = typeof specificity?.expected === 'boolean' && typeof specificity?.actual === 'boolean'
        ? `${specificity.expected} / ${specificity.actual} (${item.intentAcceptance.caseSpecificityCorrect})`
        : 'UNKNOWN';
      lines.push(`| ${item.caseId} | ${item.intentAcceptance?.passed ?? '—'} | ${specificityText} | ${strictChecks.map(check => `${check.expectedIssueId}: ${check.actualOperation || 'UNMATCHED'} → ${check.expectedOperation} (${check.passed})`).join('; ') || '—'} |`);
    }
  }
  lines.push('', `Source fingerprints stable during capture: ${document.sourceHashesConsistent}`, `Fixture fingerprints stable during capture: ${document.fixtureHashesConsistent}`, '');
  return lines.join('\n');
}

async function writeProgress(directory, document, outputPrefix = OUTPUT_PREFIX) {
  await atomicWrite(path.join(directory, `${outputPrefix}.json`), `${JSON.stringify(document, null, 2)}\n`);
  await atomicWrite(path.join(directory, `${outputPrefix}.md`), renderMarkdown(document));
}

export function profileConfiguration(evaluationProfile) {
  if (evaluationProfile === undefined) {
    return {
      evaluationProfile: undefined,
      outputPrefix: OUTPUT_PREFIX,
      sourceFiles: SOURCE_FILES,
      fixtureFiles: FIXTURE_FILES,
      purpose: 'Once-only focused semantic-contract follow-up using the fixed ten-case evaluation fixture.'
    };
  }
  if (evaluationProfile === 'intent-targeted') {
    return {
      evaluationProfile,
      outputPrefix: INTENT_BOUNDARY_OUTPUT_PREFIX,
      sourceFiles: {
        ...SOURCE_FILES,
        semanticIntentEvaluationRunner: EVALUATION_RUNNER_FILE,
        semanticIntentCliRunner: INTENT_CLI_RUNNER_FILE
      },
      fixtureFiles: { ...FIXTURE_FILES, semanticIntentBoundaries: INTENT_BOUNDARY_FIXTURE },
      purpose: 'Once-only targeted semantic-intent evaluation using three fixed historical cases and five fixed independent boundary controls.'
    };
  }
  if (evaluationProfile === 'intent-final') {
    return {
      evaluationProfile,
      outputPrefix: INTENT_FINAL_OUTPUT_PREFIX,
      sourceFiles: {
        ...SOURCE_FILES,
        semanticIntentEvaluationRunner: EVALUATION_RUNNER_FILE,
        semanticIntentCliRunner: INTENT_CLI_RUNNER_FILE
      },
      fixtureFiles: FIXTURE_FILES,
      purpose: 'Once-only final semantic-intent evaluation using the original unchanged ten-case fixture.'
    };
  }
  if (evaluationProfile === 'authority-relief-targeted-live') {
    return {
      evaluationProfile,
      outputPrefix: AUTHORITY_RELIEF_TARGETED_OUTPUT_PREFIX,
      sourceFiles: {
        ...SOURCE_FILES,
        ...AUTHORITY_RELIEF_RESOLVER_FILES,
        semanticContractEvaluationRunner: EVALUATION_RUNNER_FILE,
        authorityReliefCliRunner: INTENT_CLI_RUNNER_FILE
      },
      fixtureFiles: {
        ...FIXTURE_FILES,
        authorityReliefTargeted: AUTHORITY_RELIEF_TARGETED_FIXTURE,
        protectedAuditHashes: AUTHORITY_RELIEF_PROTECTED_HASHES
      },
      purpose: 'Once-only strict authority and tax-relief evaluation using two frozen historical questions and six fixed independent controls.'
    };
  }
  if (evaluationProfile === 'authority-relief-final-live') {
    return {
      evaluationProfile,
      outputPrefix: AUTHORITY_RELIEF_FINAL_OUTPUT_PREFIX,
      sourceFiles: {
        ...SOURCE_FILES,
        ...AUTHORITY_RELIEF_RESOLVER_FILES,
        semanticContractEvaluationRunner: EVALUATION_RUNNER_FILE,
        authorityReliefCliRunner: INTENT_CLI_RUNNER_FILE
      },
      fixtureFiles: {
        ...FIXTURE_FILES,
        authorityReliefTargeted: AUTHORITY_RELIEF_TARGETED_FIXTURE,
        protectedAuditHashes: AUTHORITY_RELIEF_PROTECTED_HASHES
      },
      purpose: 'Conditional once-only authority and tax-relief evaluation using the original unchanged ten-case selection and expectations.'
    };
  }
  if (evaluationProfile === 'semantic-wire-format-targeted-live') {
    return {
      evaluationProfile,
      outputPrefix: SEMANTIC_WIRE_FORMAT_TARGETED_OUTPUT_PREFIX,
      defaultOutputDirectory: SEMANTIC_WIRE_FORMAT_OUTPUT_DIRECTORY,
      sourceFiles: {
        ...SOURCE_FILES,
        ...AUTHORITY_RELIEF_RESOLVER_FILES,
        semanticContractEvaluationRunner: EVALUATION_RUNNER_FILE,
        semanticWireFormatCliRunner: INTENT_CLI_RUNNER_FILE
      },
      fixtureFiles: {
        ...FIXTURE_FILES,
        authorityReliefTargeted: AUTHORITY_RELIEF_TARGETED_FIXTURE,
        protectedWireFormatHashes: SEMANTIC_WIRE_FORMAT_PROTECTED_HASHES
      },
      purpose: 'Once-only strict Gemini V2 wire-format evaluation using six fixed cases selected from unchanged fixtures.'
    };
  }
  if (evaluationProfile === 'semantic-wire-format-final-live') {
    return {
      evaluationProfile,
      outputPrefix: SEMANTIC_WIRE_FORMAT_FINAL_OUTPUT_PREFIX,
      defaultOutputDirectory: SEMANTIC_WIRE_FORMAT_OUTPUT_DIRECTORY,
      sourceFiles: {
        ...SOURCE_FILES,
        ...AUTHORITY_RELIEF_RESOLVER_FILES,
        semanticContractEvaluationRunner: EVALUATION_RUNNER_FILE,
        semanticWireFormatCliRunner: INTENT_CLI_RUNNER_FILE
      },
      fixtureFiles: {
        ...FIXTURE_FILES,
        authorityReliefTargeted: AUTHORITY_RELIEF_TARGETED_FIXTURE,
        protectedWireFormatHashes: SEMANTIC_WIRE_FORMAT_PROTECTED_HASHES
      },
      purpose: 'Conditional strict Gemini V2 wire-format evaluation using the original unchanged ten-case selection and expectations.'
    };
  }
  if (evaluationProfile === IRAS_FIRST_TARGETED_PROFILE || evaluationProfile === IRAS_FIRST_FINAL_PROFILE) {
    const targeted = evaluationProfile === IRAS_FIRST_TARGETED_PROFILE;
    return {
      evaluationProfile,
      outputPrefix: targeted ? IRAS_FIRST_TARGETED_OUTPUT_PREFIX : IRAS_FIRST_FINAL_OUTPUT_PREFIX,
      defaultOutputDirectory: IRAS_FIRST_OUTPUT_DIRECTORY,
      sourceFiles: {
        ...SOURCE_FILES,
        ...AUTHORITY_RELIEF_RESOLVER_FILES,
        ...IRAS_FIRST_SCOPE_FILES,
        semanticContractEvaluationRunner: EVALUATION_RUNNER_FILE,
        semanticIntentCliRunner: INTENT_CLI_RUNNER_FILE
      },
      fixtureFiles: {
        ...FIXTURE_FILES,
        authorityReliefTargeted: AUTHORITY_RELIEF_TARGETED_FIXTURE,
        semanticIntentBoundaries: INTENT_BOUNDARY_FIXTURE,
        irasFirstProfile: IRAS_FIRST_CONFIG_FIXTURE
      },
      purpose: targeted
        ? 'IRAS-first v1 fixed targeted semantic and release-contract evaluation; nine versioned cases, including explicit unsupported controls.'
        : 'IRAS-first v1 fixed final semantic and release-contract evaluation; the unchanged historical ten plus two central IRAS relief cases.'
    };
  }
  if (evaluationProfile === IRAS_FIRST_TARGETED_V2_PROFILE || evaluationProfile === IRAS_FIRST_FINAL_V2_PROFILE) {
    const targeted = evaluationProfile === IRAS_FIRST_TARGETED_V2_PROFILE;
    return {
      evaluationProfile,
      outputPrefix: targeted ? irasFirstConfigV2.targetedOutputPrefix : irasFirstConfigV2.finalOutputPrefix,
      defaultOutputDirectory: IRAS_FIRST_V2_OUTPUT_DIRECTORY,
      sourceFiles: {
        ...SOURCE_FILES,
        ...AUTHORITY_RELIEF_RESOLVER_FILES,
        ...IRAS_FIRST_V2_SCOPE_FILES,
        semanticContractEvaluationRunner: EVALUATION_RUNNER_FILE,
        semanticIntentCliRunner: INTENT_CLI_RUNNER_FILE,
        timeoutExperimentRunner: TIMEOUT_EXPERIMENT_RUNNER_FILE
      },
      fixtureFiles: {
        ...FIXTURE_FILES,
        authorityReliefTargeted: AUTHORITY_RELIEF_TARGETED_FIXTURE,
        semanticIntentBoundaries: INTENT_BOUNDARY_FIXTURE,
        irasFirstV1Profile: IRAS_FIRST_CONFIG_FIXTURE,
        irasFirstV2Profile: IRAS_FIRST_V2_CONFIG_FIXTURE
      },
      purpose: targeted
        ? 'IRAS-first V2 fixed targeted semantic and release-contract evaluation; six IRAS questions, two general controls, and one unsupported non-IRAS control.'
        : 'IRAS-first V2 fixed final semantic and release-contract evaluation; the unchanged historical ten plus two central IRAS relief cases.'
    };
  }
  throw new Error('A supported fixed evaluation profile is required.');
}

function strictOperationExpectations(testCase) {
  return strictOperationsForAuthorityReliefCase(testCase);
}

function strictTargetRowPassed(row, testCase, index) {
  const score = row?.canonicalScoring;
  const acceptance = row?.authorityReliefAcceptance;
  const expectedCount = testCase.expected.length;
  const strictChecks = strictOperationExpectations(testCase);
  const allDimensionsCorrect = score && Object.keys(score.dimensionsCorrect || {}).length === 5 &&
    Object.values(score.dimensionsCorrect).every(value => value === expectedCount);
  const strictChecksCorrect = Array.isArray(acceptance?.strictOperationChecks) &&
    acceptance.strictOperationChecks.length === strictChecks.length &&
    strictChecks.every((expected, strictIndex) => {
      const actual = acceptance.strictOperationChecks[strictIndex];
      return actual?.expectedIssueId === expected.issueId && actual.expectedOperation === expected.operation &&
        actual.actualOperation === expected.operation && actual.matched === true && actual.passed === true;
    });
  const capture = row?.capture;
  const capturePassed = capture?.requestCount === 1 && capture?.model === MODEL &&
    capture?.timeoutMs === SEMANTIC_QUESTION_TIMEOUT_MS && capture?.temperature === 0 &&
    capture?.jsonMode === true && capture?.responseReceived === true && !capture?.transportCategory &&
    Number.isFinite(capture?.promptChars) && capture.promptChars > 0 && capture.promptChars < 9_000 &&
    (index === 0 ? capture.startGapMs === null : Number.isFinite(capture.startGapMs) && capture.startGapMs >= START_GAP_MS);
  const routingPassed = row?.routing?.finalWorkstreamSetAccuracy === true &&
    Object.keys(row.routing.guardChecks || {}).length >= 7 &&
    Object.values(row.routing.guardChecks || {}).every(value => value === true);
  const requestedRouting = row?.routing?.requestedIssueCoverage;
  const requestedRoutingPassed = exactSameSet(Object.keys(requestedRouting?.routingGapCounts || {}), AUTHORITY_RELIEF_ROUTING_GAP_CODES) &&
    Object.values(requestedRouting?.routingGapCounts || {}).every(value => Number.isInteger(value) && value >= 0) &&
    requestedRouting.requestedIssueCount === expectedCount && requestedRouting.mappedIssueCount === expectedCount &&
    requestedRouting.inCanonicalRuntimeCount === expectedCount && requestedRouting.lifecycleMappedCount === expectedCount &&
    requestedRouting.retrievalAttemptedCount === expectedCount && requestedRouting.blockingRoutingGapCount === 0 &&
    requestedRouting.unclassifiedRoutingGapCount === 0 &&
    AUTHORITY_RELIEF_BLOCKING_ROUTING_GAP_CODES.every(code => requestedRouting.routingGapCounts[code] === 0) &&
    row.routing.runtimeTimedOut === false && row.routing.guardChecks?.requestedIssuesMappedAndRetrieved === true;
  const expectedSpecificity = typeof testCase.expectedRequiresUserSpecificFacts === 'boolean'
    ? testCase.expectedRequiresUserSpecificFacts : EXPECTED_CASE_SPECIFICITY[testCase.id];
  const specificityPassed = acceptance?.caseSpecificityCorrect === true &&
    acceptance.caseSpecificity?.expected === expectedSpecificity &&
    acceptance.caseSpecificity?.actual === expectedSpecificity;
  const rawShapePassed = row?.caseId === testCase.id &&
    exactSameSet(row.expectedIssueIds, testCase.expected.map(issue => issue.id)) &&
    row.expectedWorkstreamSetCount === testCase.expectedWorkstreamsAnyOf.length &&
    row.validInterpretation === true && row.production?.mode === 'SEMANTIC_INTERPRETATION' &&
    row.production?.failure === undefined;
  const canonicalScorePassed = score?.completeQuestionIssueCoverage === true &&
    score.expectedIssueCount === expectedCount && score.predictedIssueCount === expectedCount &&
    score.matchedIssueCount === expectedCount && score.operationMatched === expectedCount &&
    score.operationCorrect === expectedCount && allDimensionsCorrect;
  return rawShapePassed && canonicalScorePassed && strictChecksCorrect && capturePassed && routingPassed &&
    specificityPassed && acceptance?.validInterpretation === true && acceptance.issueCoverageCorrect === true &&
    acceptance.allDimensionsCorrect === true && acceptance.operationsCorrect === true &&
    acceptance.topLevelCalculationFlagCorrect === true && acceptance.routingCorrect === true &&
    acceptance.guardsCorrect === true && acceptance.requestedIssueCoverageCorrect === true &&
    acceptance.runtimeTimedOut === false && requestedRoutingPassed && acceptance.singleProviderCallPassed === true &&
    acceptance.fingerprintsStable === true && acceptance.passed === true &&
    row.sourceHashesConsistent === true && row.fixtureHashesConsistent === true;
}

const IRAS_FIRST_ROW_KEYS = new Set([
  'caseId', 'group', 'expectationVersion', 'adjudicationVersion', 'expectedCoverageOutcome', 'expectedIssueIds',
  'expectedWorkstreamSetCount', 'validInterpretation', 'production', 'capture',
  'responseDiagnostic', 'scoring', 'canonicalScoring', 'irasFirstAcceptance', 'historicalScoring', 'routing',
  'sourceHashesConsistent', 'fixtureHashesConsistent', 'elapsedMs'
]);
const IRAS_FIRST_CAPTURE_KEYS = new Set([
  'promptSha256', 'promptChars', 'systemSha256', 'systemChars', 'model', 'timeoutMs', 'temperature', 'jsonMode',
  'requestCount', 'startGapMs', 'responseReceived', 'responseChars', 'responseUtf8Bytes', 'latencyMs', 'transportCategory'
]);
const IRAS_FIRST_SCOPE_DIAGNOSTIC_KEYS = new Set([
  'issueIndex', 'presentInIssuePlan', 'governingAuthorities', 'contextualAuthorities', 'domain', 'population', 'operation',
  'evidenceRequirement', 'runtimeMetadataConsistent', 'runtimeMetadataMatchCount', 'runtimeMetadataMismatchCount',
  'runtimeMetadataCounts', 'planStatus', 'unresolvedReason', 'mappedTopicCount', 'canonicalWorkstreams', 'runtimeIssueCount',
  'lifecycleCounts', 'evidenceStatusCounts', 'applicationStatusCounts', 'evidenceFoundCount', 'admittedRecordCount',
  'verifiedClaimCount', 'gapCounts'
]);

function hasNoPrivatePayloadKeys(value, depth = 0) {
  if (depth > 12) return false;
  if (Array.isArray(value)) return value.every(item => hasNoPrivatePayloadKeys(item, depth + 1));
  if (!value || typeof value !== 'object') return true;
  const forbidden = new Set([
    'question', 'questionText', 'facts', 'factsExplicitlyProvided', 'rawResponse', 'responseText', 'prompt',
    'systemInstruction', 'apiKey', 'credential', 'credentials', 'authorization', 'url', 'candidateUrl', 'finalUrl',
    'sourceText', 'sourceTitle', 'quote', 'subject', 'primarySubject', 'concept', 'labels', 'issueLabel'
  ]);
  return Object.entries(value).every(([key, child]) => !forbidden.has(key) && hasNoPrivatePayloadKeys(child, depth + 1));
}

const IRAS_FIRST_REQUIRED_GUARDS = [
  'operationsPreserved', 'incompletePlanNotVerified', 'contextualAuthorityNotRouted', 'residualHasNoWorkstream',
  'requiredApplicationStatusesUnresolved', 'unresolvedApplicationNotVerified'
];

function canonicalIrasFirstAuthority(domain, authority) {
  return domain === 'ACCOUNTING' && authority === 'IFRS_FOUNDATION' ? 'ACCOUNTING_STANDARDS' : authority;
}

function enumCountsMatch(counts, expectedValues, total) {
  if (!counts || !Number.isInteger(total) || total <= 0 || Object.values(counts).some(value => !Number.isInteger(value) || value < 0)) return false;
  const activeValues = Object.entries(counts).filter(([, count]) => count > 0);
  return Object.values(counts).reduce((sum, count) => sum + count, 0) === total && activeValues.length > 0 &&
    activeValues.every(([value]) => expectedValues.includes(value));
}

/** Recognition-only score against unchanged historical expectations, including invalid rows. */
export function summarizeHistoricalAllAuthorityMetric(rows, expectedCases = 10, scope = 'original-ten-final') {
  const historicalRows = rows.filter(row => row?.historicalScoring);
  const expectedIssueCount = historicalRows.reduce((sum, row) => sum + row.historicalScoring.expectedIssueCount, 0);
  const matchedIssueCount = historicalRows.reduce((sum, row) => sum + row.historicalScoring.matchedIssueCount, 0);
  const predictedIssueCount = historicalRows.reduce((sum, row) => sum + row.historicalScoring.predictedIssueCount, 0);
  const dimensionKeys = ['governingAuthority', 'contextualAuthority', 'domain', 'population', 'operation'];
  const dimensions = Object.fromEntries(dimensionKeys.map(key => {
    const correct = historicalRows.reduce((sum, row) => sum + (row.historicalScoring.dimensionsCorrect?.[key] || 0), 0);
    return [key, { correct, matched: matchedIssueCount, expected: expectedIssueCount, rate: ratio(correct, expectedIssueCount) }];
  }));
  const allDimensionCases = historicalRows.filter(row => row.historicalScoring.completeQuestionIssueCoverage &&
    dimensionKeys.every(key => row.historicalScoring.dimensionsCorrect?.[key] === row.historicalScoring.matchedIssueCount)).length;
  return {
    scope,
    cases: historicalRows.length,
    expectedCases,
    originalTenCaseFinalRun: scope === 'original-ten-final' && historicalRows.length === 10,
    originalStrictGateAcceptance: 'NOT_REEVALUATED',
    recognitionMetricOnly: true,
    originalIssueRecall: { matched: matchedIssueCount, expected: expectedIssueCount, rate: ratio(matchedIssueCount, expectedIssueCount) },
    originalIssuePrecision: { matched: matchedIssueCount, predicted: predictedIssueCount, rate: ratio(matchedIssueCount, predictedIssueCount) },
    dimensions,
    allDimensionCases: { correct: allDimensionCases, total: historicalRows.length, rate: ratio(allDimensionCases, historicalRows.length) },
    originalExpectationCaseCoverage: {
      complete: historicalRows.filter(row => row.historicalScoring.completeQuestionIssueCoverage).length,
      total: historicalRows.length,
      rate: ratio(historicalRows.filter(row => row.historicalScoring.completeQuestionIssueCoverage).length, historicalRows.length)
    }
  };
}

function irasFirstDiagnosticMatchesExpectation(diagnostic, expected, testCase) {
  if (!diagnostic || !expected || diagnostic.presentInIssuePlan !== true || diagnostic.runtimeMetadataConsistent !== true) return false;
  const expectedAuthorities = expected.governingAuthorities.map(authority => canonicalIrasFirstAuthority(expected.domain[0], authority));
  const actualAuthorities = diagnostic.governingAuthorities.map(authority => canonicalIrasFirstAuthority(diagnostic.domain, authority));
  const metadataCounts = diagnostic.runtimeMetadataCounts;
  const runtimeCount = diagnostic.runtimeIssueCount;
  const semanticMatches = JSON.stringify([...actualAuthorities].sort()) === JSON.stringify([...expectedAuthorities].sort()) &&
    expected.domain.includes(diagnostic.domain) && expected.operation.includes(diagnostic.operation) &&
    expected.population.includes(diagnostic.population) &&
    expected.contextualAuthoritiesAnyOf.some(values => JSON.stringify([...diagnostic.contextualAuthorities].sort()) === JSON.stringify([...values].sort()));
  const acceptedWorkstreams = testCase.expectedWorkstreamsAnyOf;
  if (runtimeCount === 0) {
    const zeroCounts = counts => counts && Object.values(counts).every(value => value === 0);
    return testCase.expectedCoverageOutcome === 'UNSUPPORTED' && semanticMatches &&
      !expectedAuthorities.includes('IRAS') && diagnostic.planStatus === 'UNRESOLVED' &&
      diagnostic.unresolvedReason === 'NO_COVERAGE_TOPIC' && diagnostic.mappedTopicCount === 0 &&
      diagnostic.canonicalWorkstreams.length === 0 && diagnostic.gapCounts.NO_COVERAGE_TOPIC > 0 &&
      zeroCounts(metadataCounts?.domain) && zeroCounts(metadataCounts?.population) && zeroCounts(metadataCounts?.operation) &&
      zeroCounts(metadataCounts?.governingAuthority) && zeroCounts(metadataCounts?.evidenceRequirement) &&
      zeroCounts(diagnostic.lifecycleCounts) && zeroCounts(diagnostic.evidenceStatusCounts) &&
      zeroCounts(diagnostic.applicationStatusCounts) && diagnostic.admittedRecordCount === 0 && diagnostic.verifiedClaimCount === 0;
  }
  const metadataMatches = enumCountsMatch(metadataCounts?.domain, [diagnostic.domain], runtimeCount) &&
    enumCountsMatch(metadataCounts?.population, [diagnostic.population], runtimeCount) &&
    enumCountsMatch(metadataCounts?.operation, [diagnostic.operation], runtimeCount) &&
    enumCountsMatch(metadataCounts?.governingAuthority, diagnostic.governingAuthorities, runtimeCount) &&
    enumCountsMatch(metadataCounts?.evidenceRequirement, [diagnostic.evidenceRequirement], runtimeCount);
  if (!metadataMatches || !semanticMatches) return false;
  const expectedPairs = acceptedWorkstreams.flatMap(set => set.map(value => {
    const separator = value.indexOf('/');
    return separator < 0 ? undefined : { authority: value.slice(0, separator), domain: value.slice(separator + 1) };
  }).filter(Boolean)).filter(pair => expectedAuthorities.includes(pair.authority));
  return expectedPairs.length > 0 && diagnostic.canonicalWorkstreams.length > 0 &&
    diagnostic.canonicalWorkstreams.every(actual => expectedPairs.some(expectedPair =>
      expectedPair.authority === actual.authority && expectedPair.domain === actual.domain));
}

function strictIrasFirstTargetRowPassed(row, testCase, index, profileVersion = IRAS_FIRST_PROFILE_VERSION) {
  const acceptance = row?.irasFirstAcceptance;
  const expectedCount = testCase.expected.length;
  const score = row?.canonicalScoring;
  const dimensionsPassed = score && Object.keys(score.dimensionsCorrect || {}).length === 5 &&
    Object.values(score.dimensionsCorrect).every(count => count === expectedCount);
  const specific = acceptance?.caseSpecificityCorrect === true &&
    acceptance.caseSpecificity?.expected === testCase.expectedRequiresUserSpecificFacts &&
    acceptance.caseSpecificity?.actual === testCase.expectedRequiresUserSpecificFacts;
  const capture = row?.capture;
  const capturePassed = capture && Object.keys(capture).every(key => IRAS_FIRST_CAPTURE_KEYS.has(key)) &&
    capture.requestCount === 1 && capture.model === MODEL && capture.timeoutMs === SEMANTIC_QUESTION_TIMEOUT_MS &&
    capture.temperature === 0 && capture.jsonMode === true && capture.responseReceived === true && !capture.transportCategory &&
    typeof capture.promptSha256 === 'string' && /^[a-f0-9]{64}$/.test(capture.promptSha256) &&
    typeof capture.systemSha256 === 'string' && /^[a-f0-9]{64}$/.test(capture.systemSha256) &&
    Number.isInteger(capture.promptChars) && capture.promptChars > 0 && capture.promptChars < 9_000 &&
    Number.isInteger(capture.systemChars) && capture.systemChars > 0 && capture.systemChars < 9_000 &&
    Number.isInteger(capture.responseChars) && capture.responseChars > 0 && capture.responseChars < 16_000 &&
    Number.isInteger(capture.responseUtf8Bytes) && capture.responseUtf8Bytes > 0 &&
    Number.isFinite(capture.latencyMs) && (index === 0 ? capture.startGapMs === null :
      Number.isFinite(capture.startGapMs) && capture.startGapMs >= START_GAP_MS);
  const dimensionsAllCorrect = score?.completeQuestionIssueCoverage === true && score.expectedIssueCount === expectedCount &&
    score.predictedIssueCount === expectedCount && score.matchedIssueCount === expectedCount &&
    score.operationMatched === expectedCount && score.operationCorrect === expectedCount && dimensionsPassed;
  const perIssue = acceptance?.perIssueResults;
  const perIssuePassed = Array.isArray(perIssue) && perIssue.length === expectedCount && perIssue.every((item, issueIndex) => {
    const expectedAuthorities = testCase.expected[issueIndex]?.governingAuthorities || [];
    const releaseRequired = expectedAuthorities.includes('IRAS');
    const safeShape = item && Object.keys(item).every(key => new Set([
      'expectedAuthority', 'releaseRequired', 'semanticIssueMatched', 'semanticDimensionsCorrect', 'authorityCorrect',
      'noFalseIrasRoute', 'issuePlanPresent', 'irasEvidenceComplete', 'mappedTopicCount', 'canonicalProviderPathReached',
      'providerPathReached', 'retrievalAttemptedCount', 'blockingGapCount', 'issueApplicationStatusCorrect', 'evidenceSafeguardsPassed',
      'explicitUnsupportedState', 'expectedUnsupportedState', 'canonicalRoute', 'canonicalWorkstreamCorrect',
      'canonicalWorkstreamCount', 'runtimeMetadataConsistent', 'authorityScopeKnown', 'nonIrasCoverageAcceptable', 'passed'
    ]).has(key)) && hasNoPrivatePayloadKeys(item);
    if (!safeShape || item.releaseRequired !== releaseRequired || item.passed !== true || item.semanticIssueMatched !== true ||
        item.authorityCorrect !== true || item.issuePlanPresent !== true || item.issueApplicationStatusCorrect !== true ||
        item.evidenceSafeguardsPassed !== true || item.authorityScopeKnown !== true || item.runtimeMetadataConsistent !== true) return false;
    const diagnosticIndex = row?.canonicalScoring?.matchedExpectedIssueIds?.findIndex(id => id === testCase.expected[issueIndex]?.id);
    const diagnostic = diagnosticIndex >= 0 ? row.routing.runtimeIssueScopeDiagnostics[diagnosticIndex] : undefined;
    if (!diagnostic) return false;
    if (!admittedEvidenceConsistent({ runtimeIssueScopeDiagnostics: [diagnostic] })) return false;
    if (releaseRequired) return diagnostic.planStatus === 'MAPPED' && diagnostic.mappedTopicCount > 0 &&
      item.canonicalProviderPathReached === true && item.providerPathReached === true &&
      item.canonicalWorkstreamCorrect === true && item.runtimeMetadataConsistent === true &&
      item.retrievalAttemptedCount > 0 && item.blockingGapCount === 0 && diagnosticHasCompleteVerifiedSupport(diagnostic);
    if (!item.noFalseIrasRoute || !item.nonIrasCoverageAcceptable ||
        !(item.canonicalWorkstreamCorrect || item.explicitUnsupportedState && item.canonicalWorkstreamCount === 0)) return false;
    if (item.explicitUnsupportedState !== explicitUnsupported(diagnostic)) return false;
    return testCase.expectedCoverageOutcome !== 'UNSUPPORTED' ||
      item.expectedUnsupportedState === true && item.explicitUnsupportedState === true;
  });
  const routingDiagnosticsSafe = Array.isArray(row?.routing?.runtimeIssueScopeDiagnostics) &&
    row.routing.runtimeIssueScopeDiagnostics.length === expectedCount &&
    row.routing.runtimeIssueScopeDiagnostics.every(item => Object.keys(item).every(key => IRAS_FIRST_SCOPE_DIAGNOSTIC_KEYS.has(key)) &&
      hasNoPrivatePayloadKeys(item) && Array.isArray(item.canonicalWorkstreams) &&
      item.canonicalWorkstreams.every(stream => Object.keys(stream).every(key => key === 'authority' || key === 'domain')) &&
      item.runtimeMetadataConsistent === true && item.runtimeMetadataMismatchCount === 0 &&
      item.runtimeMetadataMatchCount === item.runtimeIssueCount &&
      Object.keys(item.gapCounts || {}).length === IRAS_FIRST_GAP_CODES.length &&
      IRAS_FIRST_GAP_CODES.every(code => Number.isInteger(item.gapCounts?.[code]) && item.gapCounts[code] >= 0));
  const matchedExpectedIds = row?.canonicalScoring?.matchedExpectedIssueIds;
  const perDiagnosticExpectationsPassed = routingDiagnosticsSafe && Array.isArray(matchedExpectedIds) &&
    matchedExpectedIds.length === expectedCount && row.routing.runtimeIssueScopeDiagnostics.every((diagnostic, diagnosticIndex) => {
      const expectedIndex = testCase.expected.findIndex(issue => issue.id === matchedExpectedIds[diagnosticIndex]);
      return diagnostic.issueIndex === diagnosticIndex && expectedIndex >= 0 &&
        irasFirstDiagnosticMatchesExpectation(diagnostic, testCase.expected[expectedIndex], testCase);
    });
  const diagnosticSafe = row?.responseDiagnostic?.validatorAccepted === true && row.responseDiagnostic.interpreted === true &&
    hasNoPrivatePayloadKeys(row.responseDiagnostic);
  const v2MetadataMismatchSafe = profileVersion !== irasFirstConfigV2.profileVersion ||
    typeof row?.responseDiagnostic?.caseFlagMismatch === 'boolean' &&
    Array.isArray(row.responseDiagnostic.nonViolationCodes) &&
    Array.isArray(row.responseDiagnostic.violationCodes) &&
    exactSameSet(row.responseDiagnostic.nonViolationCodes,
      row.responseDiagnostic.caseFlagMismatch ? ['CASE_FLAG_MISMATCH'] : []) &&
    !row.responseDiagnostic.violationCodes.includes('CASE_FLAG_MISMATCH');
  const requiredGuardsPassed = Boolean(row?.routing?.guardChecks) &&
    IRAS_FIRST_REQUIRED_GUARDS.every(name => row.routing.guardChecks[name] === true);
  const assignmentCounts = row?.routing?.runtimeAssignmentCounts;
  const assignmentCountKeys = [
    'semanticIssueCount', 'plannedIssueCount', 'runtimeIssueCount', 'runtimeIssueIdMismatchCount',
    'duplicateRuntimeIssueIdCount', 'unknownGapIssueIdCount', 'emptyWorkstreamCount', 'unresolvedPlanIssueCount',
    'unresolvedIrasPlanIssueCount', 'knownUnsupportedNonIrasPlanIssueCount', 'unrepresentedResidualPlanIssueCount',
    'issuePlanResidualAccommodation'
  ];
  const runtimeAssignmentsPassed = assignmentCounts && Object.keys(assignmentCounts).length === assignmentCountKeys.length &&
    assignmentCountKeys.every(key => Object.hasOwn(assignmentCounts, key)) &&
    assignmentCountKeys.filter(key => key !== 'issuePlanResidualAccommodation')
      .every(key => Number.isInteger(assignmentCounts[key]) && assignmentCounts[key] >= 0) &&
    typeof assignmentCounts.issuePlanResidualAccommodation === 'boolean' &&
    row?.routing?.runtimeAssignmentIntegrity === true &&
    assignmentCounts?.semanticIssueCount === expectedCount && assignmentCounts?.plannedIssueCount === expectedCount &&
    assignmentCounts?.runtimeIssueCount === (row.routing.runtimeIssueScopeDiagnostics || []).reduce((sum, item) => sum + item.runtimeIssueCount, 0) &&
    assignmentCounts?.runtimeIssueIdMismatchCount === 0 && assignmentCounts?.duplicateRuntimeIssueIdCount === 0 &&
    assignmentCounts?.unknownGapIssueIdCount === 0 && assignmentCounts?.emptyWorkstreamCount === 0 &&
    assignmentCounts?.unrepresentedResidualPlanIssueCount === 0 && assignmentCounts?.unresolvedIrasPlanIssueCount === 0 &&
    assignmentCounts?.unresolvedPlanIssueCount === assignmentCounts?.knownUnsupportedNonIrasPlanIssueCount &&
    assignmentCounts?.issuePlanResidualAccommodation === (assignmentCounts.unresolvedPlanIssueCount > 0);
  const aggregateVerifiedIsSupported = admittedEvidenceConsistent(row?.routing);
  return row?.caseId === testCase.id && JSON.stringify(row.expectedIssueIds) === JSON.stringify(testCase.expected.map(issue => issue.id)) &&
    row.expectationVersion === profileVersion &&
    row.adjudicationVersion === testCase.adjudicationVersion &&
    row.expectedCoverageOutcome === testCase.expectedCoverageOutcome &&
    row.expectedWorkstreamSetCount === testCase.expectedWorkstreamsAnyOf.length && row.validInterpretation === true &&
    row.production?.mode === 'SEMANTIC_INTERPRETATION' && row.production?.failure === undefined &&
    row.sourceHashesConsistent === true && row.fixtureHashesConsistent === true &&
    Object.keys(row).every(key => IRAS_FIRST_ROW_KEYS.has(key)) && hasNoPrivatePayloadKeys(row) && capturePassed &&
    diagnosticSafe && dimensionsAllCorrect && specific && acceptance?.semanticQualityPassed === true &&
    v2MetadataMismatchSafe &&
    acceptance.releaseCoveragePassed === true && acceptance.runtimeIntegrity === true && acceptance.passed === true &&
    scopeAwareWorkstreamSetAccuracy(testCase, row.routing.runtimeIssueScopeDiagnostics, matchedExpectedIds) === true &&
    runtimeAssignmentsPassed && aggregateVerifiedIsSupported &&
    perIssuePassed && perDiagnosticExpectationsPassed && requiredGuardsPassed;
}

async function currentIrasV2TimeoutPromptFingerprints() {
  const cases = await loadIrasFirstV2TimeoutCases();
  const fingerprints = {};
  for (const testCase of cases) {
    let observed;
    await interpretSemanticQuestion(testCase.question, 'local-no-network-profile-probe-key', async (prompt, system, _provider, options) => {
      if (observed) throw new Error('A fixed evaluation case made more than one profile probe.');
      const schemaJson = JSON.stringify(options?.responseJsonSchema);
      observed = {
        promptSha256: sha256(prompt),
        promptChars: prompt.length,
        systemSha256: sha256(system),
        systemChars: system.length,
        schemaSha256: sha256(schemaJson),
        schemaBytes: Buffer.byteLength(schemaJson, 'utf8'),
        jsonMode: options?.jsonMode === true,
        temperature: options?.temperature,
        timeoutMs: options?.timeoutMs
      };
      throw new Error('Local profile probe stops before provider transport.');
    });
    if (!observed || !observed.jsonMode || observed.temperature !== 0 ||
        observed.timeoutMs !== SEMANTIC_QUESTION_TIMEOUT_MS ||
        observed.schemaSha256 !== sha256(JSON.stringify(SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA))) {
      throw new Error('The IRAS-first V2 timeout experiment has not passed its fixed policy; targeted capture is gated.');
    }
    const { jsonMode: _jsonMode, temperature: _temperature, timeoutMs: _timeoutMs, ...safeFingerprint } = observed;
    fingerprints[testCase.id] = safeFingerprint;
  }
  return fingerprints;
}

async function normalizedSemanticInterpretationFingerprint() {
  const source = await readFile(SOURCE_FILES.semanticInterpretation, 'utf8');
  const pattern = /^export const SEMANTIC_QUESTION_TIMEOUT_MS = [0-9_]+;$/gm;
  const matches = source.match(pattern) || [];
  if (matches.length !== 1) {
    throw new Error('The IRAS-first V2 timeout experiment has not passed its fixed policy; targeted capture is gated.');
  }
  return sha256(source.replace(pattern, 'export const SEMANTIC_QUESTION_TIMEOUT_MS = <approved-timeout>;'));
}

export function buildIrasV2TimeoutSchedule() {
  const caseIds = irasFirstConfigV2.timeoutExperiment.caseIds;
  const arms = irasFirstConfigV2.timeoutExperiment.timeoutArmsMs;
  const schedule = [];
  for (const replicate of [1, 2]) {
    const caseOrder = replicate === 1 ? [0, 1, 2] : [2, 1, 0];
    for (const caseIndex of caseOrder) {
      const rotation = caseIndex % arms.length;
      const rotated = [...arms.slice(rotation), ...arms.slice(0, rotation)];
      const orderedArms = replicate === 1 ? rotated : [...rotated].reverse();
      for (const timeoutMs of orderedArms) schedule.push({ caseId: caseIds[caseIndex], timeoutMs, replicate });
    }
  }
  return schedule;
}

export function exactTimeoutObservationCells(observations) {
  const expectedCases = irasFirstConfigV2.timeoutExperiment.caseIds;
  const expectedArms = irasFirstConfigV2.timeoutExperiment.timeoutArmsMs;
  const observationKeys = new Set([
    'caseId', 'timeoutMs', 'replicate', 'requestStartGapMs', 'outcome', 'responseReceived',
    'validInterpretation', 'semanticCorrect', 'failureCode', 'providerStatus', 'promptChars', 'systemChars',
    'schemaChars', 'issueCount', 'outputBytes', 'completionLatencyMs', 'timeoutCensoredDurationMs',
    'providerFailureDurationMs', 'responseChars', 'firstRequest'
  ]);
  if (!Array.isArray(observations) || observations.length !== 18) return false;
  const counts = new Map();
  for (const observation of observations) {
    if (!observation || Object.keys(observation).some(key => !observationKeys.has(key)) ||
        !expectedCases.includes(observation.caseId) || !expectedArms.includes(observation.timeoutMs) ||
        !Number.isInteger(observation.replicate) || ![1, 2].includes(observation.replicate) ||
        !['RESPONSE_RECEIVED', 'TIMEOUT', 'PROVIDER_ERROR', 'RATE_LIMITED'].includes(observation.outcome) ||
        typeof observation.responseReceived !== 'boolean' ||
        typeof observation.validInterpretation !== 'boolean' || typeof observation.semanticCorrect !== 'boolean' ||
        !Number.isInteger(observation.promptChars) || observation.promptChars <= 0 ||
        !Number.isInteger(observation.systemChars) || observation.systemChars <= 0 ||
        !Number.isInteger(observation.schemaChars) || observation.schemaChars <= 0 ||
        observation.failureCode !== undefined && !FAILURE_CODES.has(observation.failureCode) ||
        observation.providerStatus !== undefined && (!Number.isInteger(observation.providerStatus) ||
          observation.providerStatus < 100 || observation.providerStatus > 599) ||
        observation.semanticCorrect && !observation.validInterpretation ||
        observation.validInterpretation && (!observation.responseReceived || observation.outcome !== 'RESPONSE_RECEIVED' ||
          observation.failureCode !== undefined || !Number.isInteger(observation.issueCount) || observation.issueCount <= 0) ||
        !observation.responseReceived && (observation.issueCount !== undefined || observation.outputBytes !== undefined ||
          observation.responseChars !== undefined) ||
        observation.responseChars !== undefined && (!Number.isInteger(observation.responseChars) || observation.responseChars <= 0) ||
        observation.responseChars !== undefined && (!Number.isInteger(observation.outputBytes) || observation.outputBytes <= 0) ||
        Number.isInteger(observation.responseChars) !== Number.isInteger(observation.outputBytes) ||
        observation.responseReceived !== (observation.outcome === 'RESPONSE_RECEIVED') ||
        (observation.firstRequest !== undefined && observation.firstRequest !== true) ||
        observation.responseReceived && (!Number.isFinite(observation.completionLatencyMs) || observation.completionLatencyMs < 0 ||
          observation.timeoutCensoredDurationMs !== undefined || observation.providerFailureDurationMs !== undefined ||
          ['TIMEOUT', 'PROVIDER_ERROR', 'RATE_LIMITED'].includes(observation.failureCode)) ||
        observation.outcome === 'TIMEOUT' && (observation.failureCode !== 'TIMEOUT' ||
          !Number.isFinite(observation.timeoutCensoredDurationMs) || observation.timeoutCensoredDurationMs < 0 ||
          observation.completionLatencyMs !== undefined || observation.providerFailureDurationMs !== undefined) ||
        ['PROVIDER_ERROR', 'RATE_LIMITED'].includes(observation.outcome) &&
          (observation.failureCode !== observation.outcome || !Number.isFinite(observation.providerFailureDurationMs) ||
            observation.providerFailureDurationMs < 0 || observation.completionLatencyMs !== undefined ||
            observation.timeoutCensoredDurationMs !== undefined) ||
        observation.outputBytes !== undefined && (!Number.isInteger(observation.outputBytes) || observation.outputBytes <= 0) ||
        observation.issueCount !== undefined && (!Number.isInteger(observation.issueCount) || observation.issueCount <= 0)) return false;
    const key = `${observation.caseId}:${observation.timeoutMs}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const expectedSchedule = buildIrasV2TimeoutSchedule();
  return expectedCases.every(caseId => expectedArms.every(arm => counts.get(`${caseId}:${arm}`) === 2)) &&
    observations.every((item, index) => item.caseId === expectedSchedule[index].caseId &&
      item.timeoutMs === expectedSchedule[index].timeoutMs && item.replicate === expectedSchedule[index].replicate &&
      (index === 0 ? item.firstRequest === true && item.requestStartGapMs === null
        : item.firstRequest === undefined && Number.isFinite(item.requestStartGapMs) &&
        item.requestStartGapMs >= START_GAP_MS));
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(fraction * ordered.length) - 1)];
}

function timeoutArmCounts(observations, timeoutMs) {
  const rows = observations.filter(row => row.timeoutMs === timeoutMs);
  return {
    timeoutMs,
    scheduledCount: rows.length,
    responseReceivedCount: rows.filter(row => row.responseReceived).length,
    validInterpretationCount: rows.filter(row => row.validInterpretation).length,
    semanticCorrectCount: rows.filter(row => row.semanticCorrect).length,
    timeoutCount: rows.filter(row => row.outcome === 'TIMEOUT').length,
    providerFailureCount: rows.filter(row => ['PROVIDER_ERROR', 'RATE_LIMITED'].includes(row.outcome)).length
  };
}

/** Recomputes the preregistered arm decision from the fixed observation rows. */
export function computeIrasV2TimeoutRecommendation(observations, protocolGuardsPassed) {
  const arms = irasFirstConfigV2.timeoutExperiment.timeoutArmsMs;
  const defaultArm = irasFirstConfigV2.timeoutExperiment.recommendationPolicy.defaultTimeoutMs;
  const baseline = timeoutArmCounts(observations, defaultArm);
  const criteriaByArm = arms.filter(arm => arm > defaultArm).map(arm => {
    const counts = timeoutArmCounts(observations, arm);
    const validCompletionsAboveDefault = observations.filter(row => row.timeoutMs === arm &&
      row.responseReceived && row.validInterpretation && row.completionLatencyMs > defaultArm);
    const distinctCasesAboveDefault = new Set(validCompletionsAboveDefault.map(row => row.caseId)).size;
    const timeoutReduction = baseline.timeoutCount - counts.timeoutCount;
    const validityComparable = counts.validInterpretationCount >= baseline.validInterpretationCount;
    const enoughLongValidCompletions = validCompletionsAboveDefault.length >=
      irasFirstConfigV2.timeoutExperiment.recommendationPolicy.requireValidCompletionsAboveDefaultAcrossCases &&
      distinctCasesAboveDefault >= irasFirstConfigV2.timeoutExperiment.recommendationPolicy.minimumDistinctCasesAboveDefault;
    const enoughTimeoutReduction = timeoutReduction >=
      irasFirstConfigV2.timeoutExperiment.recommendationPolicy.minimumTimeoutReductionVsDefault;
    return {
      ...counts,
      validCompletionsAboveDefault: validCompletionsAboveDefault.length,
      distinctCasesAboveDefault,
      timeoutReductionVsDefault: timeoutReduction,
      validityComparable,
      enoughLongValidCompletions,
      enoughTimeoutReduction,
      meetsPolicy: protocolGuardsPassed === true && validityComparable && enoughLongValidCompletions && enoughTimeoutReduction
    };
  });
  const selected = criteriaByArm.find(row => row.meetsPolicy)?.timeoutMs || defaultArm;
  return {
    selectedTimeoutMs: selected,
    decision: selected === defaultArm ? 'RETAIN_8000' : `SELECT_${selected}`,
    protocolGuardsPassed: protocolGuardsPassed === true,
    armCounts: arms.map(arm => timeoutArmCounts(observations, arm)),
    criteriaByArm
  };
}

function summarizeTimeoutArmMeasurements(observations, timeoutMs) {
  const rows = observations.filter(row => row.timeoutMs === timeoutMs);
  const received = rows.filter(row => row.responseReceived);
  const valid = rows.filter(row => row.validInterpretation);
  const sizes = received.map(row => row.outputBytes).filter(Number.isInteger);
  const issueCounts = valid.map(row => row.issueCount).filter(Number.isInteger);
  const completionLatencies = received.map(row => row.completionLatencyMs).filter(Number.isFinite);
  const censoredTimeouts = rows.filter(row => row.outcome === 'TIMEOUT').map(row => row.timeoutCensoredDurationMs).filter(Number.isFinite);
  const providerFailureDurations = rows.filter(row => row.providerFailureDurationMs !== undefined)
    .map(row => row.providerFailureDurationMs).filter(Number.isFinite);
  const distribution = values => values.length ? {
    count: values.length,
    min: Math.min(...values),
    median: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: Math.max(...values)
  } : { count: 0, min: null, median: null, p95: null, max: null };
  return {
    ...timeoutArmCounts(observations, timeoutMs),
    completionLatencyMs: distribution(completionLatencies),
    timeoutCensoredDurationMs: distribution(censoredTimeouts),
    providerFailureDurationMs: distribution(providerFailureDurations),
    descriptiveInputsAmongReceivedResponses: {
      promptChars: distribution(received.map(row => row.promptChars)),
      issueCountAmongValidInterpretations: distribution(issueCounts),
      outputBytesForNonemptyResponses: distribution(sizes),
      receivedResponseDescriptors: received.map(row => ({
        caseId: row.caseId,
        promptChars: row.promptChars,
        ...(Number.isInteger(row.issueCount) ? { issueCount: row.issueCount } : {}),
        ...(Number.isInteger(row.outputBytes) ? { outputBytes: row.outputBytes } : {}),
        completionLatencyMs: row.completionLatencyMs
      }))
    }
  };
}

async function assertApprovedIrasV2TimeoutExperiment() {
  const errorMessage = 'The IRAS-first V2 timeout experiment has not passed its fixed policy; targeted capture is gated.';
  let experiment;
  try {
    const experimentPath = path.join(IRAS_FIRST_V2_OUTPUT_DIRECTORY, `${irasFirstConfigV2.timeoutExperiment.outputPrefix}.json`);
    experiment = JSON.parse(await readFile(experimentPath, 'utf8'));
  } catch {
    throw new Error(errorMessage);
  }
  let history;
  let profile;
  let currentSources;
  let currentFixtures;
  let prompts;
  let normalizedSourceHash;
  try {
    [history, profile, normalizedSourceHash, prompts] = await Promise.all([
      assertV2HistoricalArtifactsUnchanged(),
      Promise.resolve(profileConfiguration(IRAS_FIRST_TARGETED_V2_PROFILE)),
      normalizedSemanticInterpretationFingerprint(),
      currentIrasV2TimeoutPromptFingerprints()
    ]);
    [currentSources, currentFixtures] = await Promise.all([
      hashManifest(profile.sourceFiles), hashManifest(profile.fixtureFiles)
    ]);
  } catch {
    throw new Error(errorMessage);
  }
  const sourcesWithoutTimeoutFile = Object.fromEntries(Object.entries(currentSources)
    .filter(([key]) => key !== 'semanticInterpretation'));
  const experimentSourcesWithoutTimeoutFile = Object.fromEntries(Object.entries(experiment.sourceFingerprints || {})
    .filter(([key]) => key !== 'semanticInterpretation'));
  const historyPassed = experiment.protectedHistoricalArtifacts?.baselineCommit === history.baselineCommit &&
    experiment.protectedHistoricalArtifacts?.artifactCount === history.artifactCount &&
    experiment.protectedHistoricalArtifacts?.verifiedBefore === true &&
    experiment.protectedHistoricalArtifacts?.verifiedAfter === true;
  const timeoutProtocol = irasFirstConfigV2.timeoutExperiment;
  const expectedCells = timeoutProtocol.caseIds.length * timeoutProtocol.timeoutArmsMs.length * timeoutProtocol.observationsPerCaseArm;
  const schemaJson = JSON.stringify(SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA);
  const observedStartGaps = (experiment.observations || []).slice(1).map(row => row.requestStartGapMs);
  const recomputedMinimumGap = observedStartGaps.length ? Math.min(...observedStartGaps) : null;
  const recomputedArmSummaries = Object.fromEntries(timeoutProtocol.timeoutArmsMs.map(arm =>
    [arm, summarizeTimeoutArmMeasurements(experiment.observations || [], arm)]));
  const promptFingerprintRows = experiment.promptSchemaFingerprints || {};
  const promptFingerprintKeys = Object.keys(promptFingerprintRows);
  const promptFingerprintShapePassed = exactSameSet(promptFingerprintKeys, timeoutProtocol.caseIds) &&
    timeoutProtocol.caseIds.every(caseId => {
      const item = promptFingerprintRows[caseId];
      return item && Object.keys(item).every(key => [
        'promptSha256', 'promptChars', 'systemSha256', 'systemChars', 'schemaSha256', 'schemaBytes', 'schemaChars'
      ].includes(key)) &&
        /^[a-f0-9]{64}$/.test(item.promptSha256) && /^[a-f0-9]{64}$/.test(item.systemSha256) &&
        item.schemaSha256 === sha256(schemaJson) && item.schemaBytes === Buffer.byteLength(schemaJson, 'utf8') &&
        item.schemaChars === schemaJson.length && Number.isInteger(item.promptChars) && item.promptChars > 0 &&
        Number.isInteger(item.systemChars) && item.systemChars > 0;
    });
  const observationInputsMatchFingerprints = promptFingerprintShapePassed && experiment.observations.every(row => {
    const fingerprint = promptFingerprintRows[row.caseId];
    return fingerprint && row.promptChars === fingerprint.promptChars && row.systemChars === fingerprint.systemChars &&
      row.schemaChars === fingerprint.schemaChars;
  });
  const schedulePassed = experiment.protocolVersion === timeoutProtocol.protocolVersion &&
    experiment.model === timeoutProtocol.model &&
    JSON.stringify(experiment.caseIds) === JSON.stringify(timeoutProtocol.caseIds) &&
    JSON.stringify(experiment.timeoutArmsMs) === JSON.stringify(timeoutProtocol.timeoutArmsMs) &&
    experiment.observationsPerCaseArm === timeoutProtocol.observationsPerCaseArm &&
    experiment.scheduledCallCount === expectedCells && experiment.requestCount === expectedCells &&
    exactTimeoutObservationCells(experiment.observations) &&
    experiment.minimumStartGapMs === timeoutProtocol.minimumStartGapMs &&
    Number.isFinite(experiment.minimumObservedStartGapMs) &&
    experiment.minimumObservedStartGapMs >= timeoutProtocol.minimumStartGapMs &&
    experiment.minimumObservedStartGapMs === recomputedMinimumGap &&
    experiment.transportOverride === 'timeoutMs-only' &&
    experiment.sourceHashesConsistent === true && experiment.fixtureHashesConsistent === true && historyPassed &&
    experiment.productionTimeoutAtMeasurementMs === timeoutProtocol.recommendationPolicy.defaultTimeoutMs &&
    JSON.stringify(experiment.recommendationPolicy) === JSON.stringify(timeoutProtocol.recommendationPolicy) &&
    sameManifest(experimentSourcesWithoutTimeoutFile, sourcesWithoutTimeoutFile) &&
    sameManifest(experiment.fixtureFingerprints || {}, currentFixtures) &&
    experiment.semanticInterpretationHashWithoutTimeout === normalizedSourceHash &&
    JSON.stringify(experiment.promptSchemaFingerprints) === JSON.stringify(prompts) &&
    observationInputsMatchFingerprints &&
    JSON.stringify(experiment.armSummaries) === JSON.stringify(recomputedArmSummaries) &&
    experiment.schemaComplexity?.sha256 === sha256(schemaJson) && experiment.schemaComplexity?.chars === schemaJson.length &&
    experiment.schemaComplexity?.uniqueSchemas === 1 &&
    experiment.schemaComplexity?.relationshipToLatency === 'Not identifiable in this experiment because schema complexity is held constant.' &&
    experiment.protocolGuardsPassed === true;
  const recomputedRecommendation = computeIrasV2TimeoutRecommendation(experiment.observations, schedulePassed);
  const timeoutChoice = recomputedRecommendation.selectedTimeoutMs;
  const valid = hasNoPrivatePayloadKeys(experiment) && schedulePassed &&
    experiment.protocolVersion === timeoutProtocol.protocolVersion && experiment.model === timeoutProtocol.model &&
    JSON.stringify(experiment.timeoutRecommendation) === JSON.stringify(recomputedRecommendation) &&
    [8000, 12000, 15000].includes(timeoutChoice) && timeoutChoice === SEMANTIC_QUESTION_TIMEOUT_MS;
  if (!valid) throw new Error(errorMessage);
  return {
    selectedTimeoutMs: timeoutChoice,
    recommendation: experiment.timeoutRecommendation?.decision,
    sourceHashesConsistent: true,
    promptSchemaFingerprintsStable: true,
    protectedHistoricalArtifactCount: history.artifactCount
  };
}

/** Rederive target eligibility from the fixed profile, row-level scores, routing evidence, and fingerprints. */
async function requirePassingIrasFirstProfileTarget(outputDirectory, {
  targetedProfile,
  outputPrefix,
  profileVersion,
  profileConfig,
  loadTargetedCases,
  assertProtectedHistory,
  protectedBaselineCommit,
  errorMessage
}) {
  let targeted;
  try {
    targeted = JSON.parse(await readFile(path.join(outputDirectory, `${outputPrefix}.json`), 'utf8'));
  } catch {
    throw new Error(errorMessage);
  }
  let expectedCases;
  let protectedHistory;
  try {
    [expectedCases, protectedHistory] = await Promise.all([loadTargetedCases(), assertProtectedHistory()]);
  } catch {
    throw new Error(errorMessage);
  }
  const profile = profileConfiguration(targetedProfile);
  const [currentSources, currentFixtures] = await Promise.all([
    hashManifest(profile.sourceFiles), hashManifest(profile.fixtureFiles)
  ]);
  const exactRows = Array.isArray(targeted.cases) && targeted.cases.length === expectedCases.length &&
    expectedCases.every((testCase, index) => strictIrasFirstTargetRowPassed(targeted.cases[index], testCase, index, profileVersion));
  const currentSummary = summarizeIrasFirstAcceptance(targeted, expectedCases.length);
  const noPrivatePayload = hasNoPrivatePayloadKeys(targeted);
  const completeRun = targeted.evaluationProfile === targetedProfile &&
    targeted.releaseContractVersion === profileVersion && targeted.outputPrefix === outputPrefix &&
    targeted.completedAt !== undefined && targeted.model === MODEL && targeted.timeoutMs === SEMANTIC_QUESTION_TIMEOUT_MS &&
    targeted.minimumStartGapMs === START_GAP_MS && targeted.minimumObservedStartGapMs >= START_GAP_MS &&
    targeted.pacingPolicy === 'Wait the full minimum gap after each completed checkpoint; actual provider-request start gaps are measured monotonically.' &&
    targeted.requestCount === expectedCases.length &&
    JSON.stringify(targeted.cases?.map(row => row.caseId)) === JSON.stringify(profileConfig.targetedCaseIds) &&
    targeted.coverageCountsAreCompletenessAssertions === false &&
    targeted.runtimeEvidenceScope === 'LOCAL_ONLY_PATH_AND_GUARDRAILS_NOT_LIVE_AUTHORITY_PAGES_OR_SUBSTANTIVE_ANSWER_COMPLETION' &&
    JSON.stringify(targeted.authorityCoverageScope) === JSON.stringify(AUTHORITY_COVERAGE_SCOPE) &&
    targeted.protectedHistoricalArtifacts?.baselineCommit === protectedBaselineCommit &&
    targeted.protectedHistoricalArtifacts?.artifactCount === protectedHistory.artifactCount &&
    targeted.protectedHistoricalArtifacts?.verifiedBefore === true &&
    targeted.protectedHistoricalArtifacts?.verifiedDuringCapture === true &&
    targeted.protectedHistoricalArtifacts?.verifiedAfterCapture === true;
  const fingerprintMatch = sameManifest(targeted.sourceFingerprints || {}, currentSources) &&
    sameManifest(targeted.fixtureFingerprints || {}, currentFixtures) &&
    targeted.sourceHashesConsistent === true && targeted.fixtureHashesConsistent === true;
  if (!exactRows || !completeRun || !noPrivatePayload || !fingerprintMatch || currentSummary.passed !== true ||
      targeted.irasFirstAcceptance?.passed !== true || targeted.irasFirstAcceptance?.completedCases !== expectedCases.length ||
      targeted.irasFirstAcceptance?.semanticQuality?.validInterpretations?.count !== expectedCases.length ||
      targeted.irasFirstAcceptance?.releaseRequiredCoverage?.blockingCases !== 0) {
    throw new Error(errorMessage);
  }
}

/** V1 target gate remains tied to its historical fixed profile and manifest. */
export async function requirePassingIrasFirstTarget(outputDirectory) {
  return requirePassingIrasFirstProfileTarget(outputDirectory, {
    targetedProfile: IRAS_FIRST_TARGETED_PROFILE,
    outputPrefix: IRAS_FIRST_TARGETED_OUTPUT_PREFIX,
    profileVersion: IRAS_FIRST_PROFILE_VERSION,
    profileConfig: irasFirstConfig,
    loadTargetedCases: loadIrasFirstTargetedCases,
    assertProtectedHistory: assertHistoricalArtifactsUnchanged,
    protectedBaselineCommit: 'd194d2bc7121b2c9a1deec562f77eafdfb98cd90',
    errorMessage: 'The IRAS-first targeted profile has not passed; final live capture is gated.'
  });
}

/** V2 target gate rechecks the timeout experiment, fixed cases, source path, and protected history. */
export async function requirePassingIrasFirstV2Target(outputDirectory) {
  await assertApprovedIrasV2TimeoutExperiment();
  return requirePassingIrasFirstProfileTarget(outputDirectory, {
    targetedProfile: IRAS_FIRST_TARGETED_V2_PROFILE,
    outputPrefix: irasFirstConfigV2.targetedOutputPrefix,
    profileVersion: irasFirstConfigV2.profileVersion,
    profileConfig: irasFirstConfigV2,
    loadTargetedCases: loadIrasFirstV2TargetedCases,
    assertProtectedHistory: assertV2HistoricalArtifactsUnchanged,
    protectedBaselineCommit: '4bd3abc9c22619401f22aa8abba73af61b5d6217',
    errorMessage: 'The IRAS-first V2 targeted profile has not passed; final live capture is gated.'
  });
}

async function requirePassingAuthorityReliefTarget(outputDirectory) {
  let targeted;
  try {
    targeted = JSON.parse(await readFile(path.join(outputDirectory, `${AUTHORITY_RELIEF_TARGETED_OUTPUT_PREFIX}.json`), 'utf8'));
  } catch {
    throw new Error('The authority-relief targeted profile has not passed; final live capture is gated.');
  }
  const acceptance = targeted.authorityReliefAcceptance;
  const currentProfile = profileConfiguration('authority-relief-targeted-live');
  const [currentSourceManifest, currentFixtureManifest, expectedCases, protectedHashes] = await Promise.all([
    hashManifest(currentProfile.sourceFiles), hashManifest(currentProfile.fixtureFiles),
    loadAuthorityReliefTargetedCases(), readJson(AUTHORITY_RELIEF_PROTECTED_HASHES)
  ]);
  const protectedFilesPassed = Array.isArray(protectedHashes) && protectedHashes.length === 29 &&
    (await Promise.all(protectedHashes.map(async item => {
      if (typeof item?.path !== 'string' || typeof item.sha256 !== 'string') return false;
      const filePath = path.resolve(PROJECT_ROOT, item.path.replaceAll('\\', '/'));
      return await hashFile(filePath) === item.sha256;
    }))).every(Boolean);
  const rowAcceptancePassed = Array.isArray(targeted.cases) && targeted.cases.length === expectedCases.length &&
    expectedCases.every((testCase, index) => strictTargetRowPassed(targeted.cases[index], testCase, index));
  const aggregateIssueCount = expectedCases.reduce((sum, testCase) => sum + testCase.expected.length, 0);
  const aggregateCanonical = acceptance?.canonicalContractScoring;
  const aggregatePassed = rowAcceptancePassed && targeted.requestCount === expectedCases.length &&
    acceptance?.completedCases === expectedCases.length && acceptance.passedCases === expectedCases.length &&
    Array.isArray(acceptance.failedCases) && acceptance.failedCases.length === 0 &&
    aggregateCanonical?.issueRecall?.correct === aggregateIssueCount && aggregateCanonical.issueRecall.total === aggregateIssueCount &&
    aggregateCanonical.issuePrecision?.correct === aggregateIssueCount && aggregateCanonical.issuePrecision.total === aggregateIssueCount &&
    Object.values(aggregateCanonical.dimensions || {}).every(item => item.correct === aggregateIssueCount &&
      item.matched === aggregateIssueCount && item.rate === 1) &&
    aggregateCanonical.operationAccuracy?.correct === aggregateIssueCount &&
    aggregateCanonical.operationAccuracy.total === aggregateIssueCount &&
    aggregateCanonical.canonicalWorkstreamRoutingAccuracy?.correct === expectedCases.length &&
    aggregateCanonical.canonicalWorkstreamRoutingAccuracy.total === expectedCases.length &&
    aggregateCanonical.canonicalWorkstreamRoutingAccuracy.rate === 1;
  const profileAndPacingPassed = targeted.evaluationProfile === 'authority-relief-targeted-live' &&
    targeted.outputPrefix === AUTHORITY_RELIEF_TARGETED_OUTPUT_PREFIX && targeted.completedAt !== undefined &&
    targeted.model === MODEL && targeted.timeoutMs === SEMANTIC_QUESTION_TIMEOUT_MS &&
    targeted.minimumStartGapMs === START_GAP_MS && targeted.minimumObservedStartGapMs >= START_GAP_MS &&
    targeted.pacingPolicy === 'Wait the full minimum gap after each completed checkpoint; actual provider-request start gaps are measured monotonically.' &&
    exactSameSet(targeted.cases?.map(item => item.caseId), AUTHORITY_RELIEF_TARGETED_CASE_IDS);
  const manifestsPassed = sameManifest(targeted.sourceFingerprints || {}, currentSourceManifest) &&
    sameManifest(targeted.fixtureFingerprints || {}, currentFixtureManifest) &&
    targeted.sourceHashesConsistent === true && targeted.fixtureHashesConsistent === true && protectedFilesPassed;
  if (!profileAndPacingPassed || !aggregatePassed || !manifestsPassed || acceptance?.passed !== true ||
      acceptance.zeroInvalidTimeoutProviderFailures !== true || acceptance.pacingPolicyPassed !== true ||
      acceptance.fingerprintsStable !== true) {
    throw new Error('The authority-relief targeted profile has not passed; final live capture is gated.');
  }
}

async function assertProtectedSemanticWireFormatArtifacts() {
  let protectedHashes;
  try {
    protectedHashes = await readJson(SEMANTIC_WIRE_FORMAT_PROTECTED_HASHES);
  } catch {
    throw new Error('A protected semantic evaluation artifact has changed.');
  }
  if (!Array.isArray(protectedHashes) || protectedHashes.length !== 32 ||
      new Set(protectedHashes.map(item => item?.path)).size !== protectedHashes.length ||
      !(await Promise.all(protectedHashes.map(async item => {
        if (typeof item?.path !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)) return false;
        const filePath = path.resolve(PROJECT_ROOT, item.path.replaceAll('\\', '/'));
        const relativePath = path.relative(PROJECT_ROOT, filePath);
        if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) return false;
        try {
          return await hashFile(filePath) === item.sha256;
        } catch {
          return false;
        }
      }))).every(Boolean)) {
    throw new Error('A protected semantic evaluation artifact has changed.');
  }
  return protectedHashes;
}

async function requirePassingSemanticWireFormatTarget(outputDirectory) {
  let targeted;
  try {
    targeted = JSON.parse(await readFile(path.join(outputDirectory, `${SEMANTIC_WIRE_FORMAT_TARGETED_OUTPUT_PREFIX}.json`), 'utf8'));
  } catch {
    throw new Error('The semantic wire-format targeted profile has not passed; final live capture is gated.');
  }
  const currentProfile = profileConfiguration('semantic-wire-format-targeted-live');
  let expectedCases;
  let protectedArtifactsPassed = false;
  try {
    [expectedCases] = await Promise.all([
      loadSemanticWireFormatTargetedCases(), assertProtectedSemanticWireFormatArtifacts()
    ]);
    protectedArtifactsPassed = true;
  } catch {
    throw new Error('The semantic wire-format targeted profile has not passed; final live capture is gated.');
  }
  const [currentSourceManifest, currentFixtureManifest] = await Promise.all([
    hashManifest(currentProfile.sourceFiles), hashManifest(currentProfile.fixtureFiles)
  ]);
  const acceptance = targeted.authorityReliefAcceptance;
  const expectedIds = SEMANTIC_WIRE_FORMAT_CASE_IDS;
  const rowsPassed = Array.isArray(targeted.cases) && targeted.cases.length === expectedCases.length &&
    expectedCases.every((testCase, index) => strictTargetRowPassed(targeted.cases[index], testCase, index));
  const aggregateIssueCount = expectedCases.reduce((sum, testCase) => sum + testCase.expected.length, 0);
  const canonical = acceptance?.canonicalContractScoring;
  const aggregatePassed = rowsPassed && targeted.requestCount === expectedCases.length &&
    acceptance?.completedCases === expectedCases.length && acceptance.passedCases === expectedCases.length &&
    Array.isArray(acceptance.failedCases) && acceptance.failedCases.length === 0 &&
    canonical?.issueRecall?.correct === aggregateIssueCount && canonical.issueRecall.total === aggregateIssueCount &&
    canonical?.issuePrecision?.correct === aggregateIssueCount && canonical.issuePrecision.total === aggregateIssueCount &&
    Object.values(canonical.dimensions || {}).length === 5 &&
    Object.values(canonical.dimensions || {}).every(item => item.correct === aggregateIssueCount &&
      item.matched === aggregateIssueCount && item.rate === 1) &&
    canonical.operationAccuracy?.correct === aggregateIssueCount && canonical.operationAccuracy.total === aggregateIssueCount &&
    canonical.canonicalWorkstreamRoutingAccuracy?.correct === expectedCases.length &&
    canonical.canonicalWorkstreamRoutingAccuracy.total === expectedCases.length &&
    canonical.canonicalWorkstreamRoutingAccuracy.rate === 1;
  const profileAndPacingPassed = targeted.evaluationProfile === 'semantic-wire-format-targeted-live' &&
    targeted.outputPrefix === SEMANTIC_WIRE_FORMAT_TARGETED_OUTPUT_PREFIX && targeted.completedAt !== undefined &&
    targeted.model === MODEL && targeted.timeoutMs === SEMANTIC_QUESTION_TIMEOUT_MS &&
    targeted.minimumStartGapMs === START_GAP_MS && targeted.minimumObservedStartGapMs >= START_GAP_MS &&
    targeted.pacingPolicy === 'Wait the full minimum gap after each completed checkpoint; actual provider-request start gaps are measured monotonically.' &&
    JSON.stringify(targeted.cases?.map(item => item.caseId)) === JSON.stringify(expectedIds);
  const manifestsPassed = sameManifest(targeted.sourceFingerprints || {}, currentSourceManifest) &&
    sameManifest(targeted.fixtureFingerprints || {}, currentFixtureManifest) &&
    targeted.sourceHashesConsistent === true && targeted.fixtureHashesConsistent === true && protectedArtifactsPassed;
  if (!profileAndPacingPassed || !aggregatePassed || !manifestsPassed || acceptance?.passed !== true ||
      acceptance.zeroInvalidTimeoutProviderFailures !== true || acceptance.pacingPolicyPassed !== true ||
      acceptance.fingerprintsStable !== true) {
    throw new Error('The semantic wire-format targeted profile has not passed; final live capture is gated.');
  }
}

const STRICT_INTENT_OPERATIONS = Object.freeze({
  'A-paraphrase-2': Object.freeze({ issueId: 'employer-cpf-contribution', operation: 'CALCULATE' }),
  'adversarial-C-employee-benefit': Object.freeze({ issueId: 'employee-accommodation-benefit-tax', operation: 'DETERMINE_TREATMENT' })
});
const EXPECTED_CASE_SPECIFICITY = Object.freeze({
  'A-paraphrase-2': true,
  'adversarial-C-employee-benefit': true,
  'control-general-recognition': false,
  'control-general-interaction': false,
  'A-paraphrase-3': true,
  'dev-conceptual-illustration': false,
  'dev-training-entitlement': true,
  'dev-mixed-entry-total': true,
  'dev-corporate-filing': false,
  'dev-investment-comparison': false,
  'employer-cpf-implicit-calculation': true,
  'wht-payment-amount-calculation': true,
  'general-employment-benefit-rule': false,
  'specific-employee-benefit-treatment': true,
  'withholding-tax-liability-classification': true
});

function intentAcceptance(testCase, validInterpretation, scoring, routing, interpretation) {
  const expectedRequiresUserSpecificFacts = EXPECTED_CASE_SPECIFICITY[testCase.id];
  const actualRequiresUserSpecificFacts = interpretation?.requiresUserSpecificFacts;
  const caseSpecificityCorrect = typeof expectedRequiresUserSpecificFacts === 'boolean' &&
    typeof actualRequiresUserSpecificFacts === 'boolean' &&
    actualRequiresUserSpecificFacts === expectedRequiresUserSpecificFacts;
  const caseSpecificity = {
    ...(typeof expectedRequiresUserSpecificFacts === 'boolean' ? { expected: expectedRequiresUserSpecificFacts } : {}),
    ...(typeof actualRequiresUserSpecificFacts === 'boolean' ? { actual: actualRequiresUserSpecificFacts } : {})
  };
  const strictTarget = STRICT_INTENT_OPERATIONS[testCase.id];
  const strictOperationChecks = strictTarget ? (() => {
    const expectedIndex = testCase.expected.findIndex(issue => issue.id === strictTarget.issueId);
    const actualIssues = Array.isArray(interpretation?.issues) ? interpretation.issues : [];
    const { expectedByActual } = matchIssues(testCase.expected, actualIssues);
    const actualIndex = [...expectedByActual.entries()].find(([, index]) => index === expectedIndex)?.[0];
    const actualOperation = actualIndex === undefined
      ? undefined
      : safeEnum(actualIssues[actualIndex]?.operation, OPERATIONS, 'UNKNOWN');
    return [{
      expectedIssueId: strictTarget.issueId,
      expectedOperation: strictTarget.operation,
      ...(actualOperation ? { actualOperation } : {}),
      matched: actualIndex !== undefined,
      passed: actualOperation === strictTarget.operation
    }];
  })() : [];
  const completeExpectedIssueCoverage = scoring.completeQuestionIssueCoverage === true &&
    scoring.matchedIssueCount === scoring.expectedIssueCount &&
    scoring.predictedIssueCount === scoring.expectedIssueCount;
  const matchedDimensionsCorrect = scoring.matchedIssueCount > 0 &&
    Object.values(scoring.dimensionsCorrect).every(correct => correct === scoring.matchedIssueCount);
  const allMatchedOperationsCorrect = scoring.operationMatched > 0 &&
    scoring.operationCorrect === scoring.operationMatched;
  const strictOperationsCorrect = strictOperationChecks.every(check => check.passed);
  const correctRouting = routing?.finalWorkstreamSetAccuracy === true;
  const allRuntimeGuardsPassed = Boolean(routing?.guardChecks) &&
    Object.values(routing.guardChecks).every(passed => passed === true);
  const passed = validInterpretation && completeExpectedIssueCoverage && matchedDimensionsCorrect &&
    allMatchedOperationsCorrect && strictOperationsCorrect && caseSpecificityCorrect &&
    correctRouting && allRuntimeGuardsPassed;
  return {
    passed,
    validInterpretation,
    completeExpectedIssueCoverage,
    matchedDimensionsCorrect,
    allMatchedOperationsCorrect,
    strictOperationsCorrect,
    caseSpecificity,
    caseSpecificityCorrect,
    correctRouting,
    allRuntimeGuardsPassed,
    strictOperationChecks
  };
}

/** Live-gated, once-per-case follow-up; only fixed diagnostics and score data are persisted. */
export async function runSemanticContractFollowupEvaluation({
  live = false,
  apiKey = process.env.GEMINI_API_KEY,
  outputDirectory: requestedOutputDirectory,
  execute = executeStructuredLlmCall,
  interpret = interpretSemanticQuestion,
  buildRuntime = buildAuthorityWorkstreams,
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  now = () => new Date(),
  monotonicNow = () => performance.now(),
  cases: suppliedCases,
  evaluationProfile
} = {}) {
  if (!live) throw new Error('Live capture requires --live.');
  const profile = profileConfiguration(evaluationProfile);
  const outputDirectory = requestedOutputDirectory ?? profile.defaultOutputDirectory ?? REPORT_DIRECTORY;
  if (evaluationProfile !== undefined && suppliedCases !== undefined) {
    throw new Error('A required fixed evaluation case is missing.');
  }
  if (evaluationProfile === 'authority-relief-final-live') await requirePassingAuthorityReliefTarget(outputDirectory);
  if (evaluationProfile === 'semantic-wire-format-final-live') await requirePassingSemanticWireFormatTarget(outputDirectory);
  const isIrasFirstV2Profile = evaluationProfile === IRAS_FIRST_TARGETED_V2_PROFILE || evaluationProfile === IRAS_FIRST_FINAL_V2_PROFILE;
  const isIrasFirstProfile = evaluationProfile === IRAS_FIRST_TARGETED_PROFILE || evaluationProfile === IRAS_FIRST_FINAL_PROFILE || isIrasFirstV2Profile;
  const irasFirstProfileConfig = isIrasFirstV2Profile ? irasFirstConfigV2 : irasFirstConfig;
  const assertProtectedHistory = isIrasFirstV2Profile ? assertV2HistoricalArtifactsUnchanged : assertHistoricalArtifactsUnchanged;
  let timeoutPolicyVerification;
  if (isIrasFirstV2Profile) timeoutPolicyVerification = await assertApprovedIrasV2TimeoutExperiment();
  if (evaluationProfile === IRAS_FIRST_FINAL_PROFILE) await requirePassingIrasFirstTarget(outputDirectory);
  if (evaluationProfile === IRAS_FIRST_FINAL_V2_PROFILE) await requirePassingIrasFirstV2Target(outputDirectory);
  const isWireFormatProfile = evaluationProfile === 'semantic-wire-format-targeted-live' ||
    evaluationProfile === 'semantic-wire-format-final-live';
  if (isWireFormatProfile) await assertProtectedSemanticWireFormatArtifacts();
  const protectedHistoryBefore = isIrasFirstProfile ? await assertProtectedHistory() : undefined;
  await mkdir(outputDirectory, { recursive: true });
  await refuseExistingOutputs(outputDirectory, profile.outputPrefix);
  if (typeof apiKey !== 'string' || apiKey.trim().length <= 10) throw new Error('GEMINI_API_KEY is not configured.');

  const isLegacyStrictSemanticProfile = evaluationProfile === 'authority-relief-targeted-live' ||
    evaluationProfile === 'authority-relief-final-live' || isWireFormatProfile;
  const isStrictSemanticProfile = isLegacyStrictSemanticProfile || isIrasFirstProfile;
  const selectedCases = evaluationProfile === 'intent-targeted'
    ? await loadSemanticIntentTargetedCases()
    : evaluationProfile === 'intent-final' || evaluationProfile === 'authority-relief-final-live' ||
      evaluationProfile === 'semantic-wire-format-final-live'
      ? await loadSemanticIntentFinalCases()
      : evaluationProfile === IRAS_FIRST_TARGETED_PROFILE
        ? await loadIrasFirstTargetedCases()
        : evaluationProfile === IRAS_FIRST_FINAL_PROFILE
          ? await loadIrasFirstFinalCases()
        : evaluationProfile === IRAS_FIRST_TARGETED_V2_PROFILE
          ? await loadIrasFirstV2TargetedCases()
          : evaluationProfile === IRAS_FIRST_FINAL_V2_PROFILE
            ? await loadIrasFirstV2FinalCases()
      : evaluationProfile === 'authority-relief-targeted-live'
        ? await loadAuthorityReliefTargetedCases()
        : evaluationProfile === 'semantic-wire-format-targeted-live'
          ? await loadSemanticWireFormatTargetedCases()
        : suppliedCases || await loadSemanticContractFollowupCases();
  const requiredIds = evaluationProfile === 'intent-targeted'
    ? [...INTENT_KNOWN_CASE_IDS, ...INTENT_BOUNDARY_CASE_IDS]
    : evaluationProfile === 'authority-relief-targeted-live'
      ? AUTHORITY_RELIEF_TARGETED_CASE_IDS
      : evaluationProfile === 'semantic-wire-format-targeted-live'
        ? SEMANTIC_WIRE_FORMAT_CASE_IDS
      : evaluationProfile === IRAS_FIRST_TARGETED_PROFILE
        ? irasFirstConfig.targetedCaseIds
        : evaluationProfile === IRAS_FIRST_FINAL_PROFILE
          ? irasFirstConfig.finalCaseIds
      : evaluationProfile === IRAS_FIRST_TARGETED_V2_PROFILE
        ? irasFirstConfigV2.targetedCaseIds
        : evaluationProfile === IRAS_FIRST_FINAL_V2_PROFILE
          ? irasFirstConfigV2.finalCaseIds
      : REQUIRED_CASE_IDS;
  if (!Array.isArray(selectedCases) || selectedCases.length !== requiredIds.length ||
      requiredIds.some((id, index) => selectedCases[index]?.id !== id) ||
      new Set(selectedCases.map(item => item.id)).size !== selectedCases.length) {
    throw new Error('A required fixed evaluation case is missing.');
  }
  const sourceHashes = await hashManifest(profile.sourceFiles);
  const fixtureHashes = await hashManifest(profile.fixtureFiles);
  const initialMonotonic = monotonicNow();
  const document = {
    schemaVersion: 1,
    ...(profile.evaluationProfile ? { evaluationProfile: profile.evaluationProfile } : {}),
    purpose: profile.purpose,
    ...(profile.evaluationProfile ? { outputPrefix: profile.outputPrefix } : {}),
    model: MODEL,
    timeoutMs: SEMANTIC_QUESTION_TIMEOUT_MS,
    ...(isIrasFirstProfile ? {
      releaseContractVersion: irasFirstProfileConfig.profileVersion,
      authorityCoverageScope: AUTHORITY_COVERAGE_SCOPE,
      benchmarkAdjudications: irasFirstProfileConfig.adjudications || {},
      coverageCountsAreCompletenessAssertions: false,
      runtimeEvidenceScope: 'LOCAL_ONLY_PATH_AND_GUARDRAILS_NOT_LIVE_AUTHORITY_PAGES_OR_SUBSTANTIVE_ANSWER_COMPLETION',
      protectedHistoricalArtifacts: {
        baselineCommit: protectedHistoryBefore?.baselineCommit || 'd194d2bc7121b2c9a1deec562f77eafdfb98cd90',
        artifactCount: protectedHistoryBefore?.artifactCount || 110,
        verifiedBefore: protectedHistoryBefore?.verified === true
      },
      ...(isIrasFirstV2Profile ? { timeoutPolicyVerification } : {})
    } : {}),
    minimumStartGapMs: START_GAP_MS,
    pacingPolicy: 'Wait the full minimum gap after each completed checkpoint; actual provider-request start gaps are measured monotonically.',
    sourceFingerprints: sourceHashes,
    fixtureFingerprints: fixtureHashes,
    sourceHashesConsistent: true,
    fixtureHashesConsistent: true,
    startedAt: now().toISOString(),
    requestCount: 0,
    minimumObservedStartGapMs: null,
    cases: [],
    summaries: []
  };
  let previousRequestStart;

  for (let index = 0; index < selectedCases.length; index += 1) {
    const testCase = selectedCases[index];
    if (index > 0) await sleep(START_GAP_MS);
    const sourceBefore = await hashManifest(profile.sourceFiles);
    const fixturesBefore = await hashManifest(profile.fixtureFiles);
    if (!sameManifest(sourceHashes, sourceBefore) || !sameManifest(fixtureHashes, fixturesBefore)) {
      document.sourceHashesConsistent = sameManifest(sourceHashes, sourceBefore);
      document.fixtureHashesConsistent = sameManifest(fixtureHashes, fixturesBefore);
      if (document.cases.length) await writeProgress(outputDirectory, document, profile.outputPrefix);
      throw new Error('Source or fixture hash changed during live capture.');
    }
    if (isIrasFirstProfile) await assertProtectedHistory();
    let rawResponse;
    let capture;
    let responseDiagnostic;
    let requestStartMonotonic;
    let callCount = 0;
    const captureCall = async (prompt, systemInstruction, _provider, options = {}) => {
      if (callCount > 0) throw new Error('Only one provider request is allowed per case.');
      callCount += 1;
      requestStartMonotonic = monotonicNow();
      const startGapMs = previousRequestStart === undefined ? null : Math.round(requestStartMonotonic - previousRequestStart);
      if (startGapMs !== null) {
        document.minimumObservedStartGapMs = document.minimumObservedStartGapMs === null
          ? startGapMs : Math.min(document.minimumObservedStartGapMs, startGapMs);
      }
      previousRequestStart = requestStartMonotonic;
      capture = {
        promptSha256: sha256(prompt),
        promptChars: prompt.length,
        systemSha256: sha256(systemInstruction),
        systemChars: systemInstruction.length,
        model: MODEL,
        timeoutMs: SEMANTIC_QUESTION_TIMEOUT_MS,
        temperature: 0,
        jsonMode: true,
        requestCount: 1,
        startGapMs
      };
      const requestStartedAt = monotonicNow();
      try {
        rawResponse = await execute(prompt, systemInstruction, {
          activeProvider: 'gemini',
          azure: { endpoint: '', apiKey: '', deploymentName: 'gpt-4o', apiVersion: '2024-08-01-preview' },
          gemini: { apiKey: apiKey.trim(), model: MODEL },
          openai: { apiKey: '', model: 'gpt-4o', baseUrl: '' }
        }, {
          ...options,
          model: MODEL,
          timeoutMs: SEMANTIC_QUESTION_TIMEOUT_MS,
          temperature: 0,
          jsonMode: true
        });
        capture.responseReceived = typeof rawResponse === 'string';
        capture.responseChars = typeof rawResponse === 'string' ? rawResponse.length : 0;
        capture.responseUtf8Bytes = typeof rawResponse === 'string' ? Buffer.byteLength(rawResponse, 'utf8') : 0;
        return rawResponse;
      } catch (error) {
        capture.responseReceived = false;
        capture.responseChars = 0;
        capture.responseUtf8Bytes = 0;
        const message = error instanceof Error ? error.message : '';
        capture.transportCategory = /HTTP\s+429/i.test(message) ? 'RATE_LIMITED'
          : /abort|timed\s*out|timeout/i.test(message) ? 'TIMEOUT' : 'PROVIDER_ERROR';
        throw error;
      } finally {
        capture.latencyMs = Math.round((monotonicNow() - requestStartedAt) * 100) / 100;
      }
    };

    let productionResult;
    try {
      productionResult = await interpret(testCase.question, {
        activeProvider: 'gemini',
        azure: { endpoint: '', apiKey: '', deploymentName: 'gpt-4o', apiVersion: '2024-08-01-preview' },
        gemini: { apiKey: apiKey.trim(), model: MODEL },
        openai: { apiKey: '', model: 'gpt-4o', baseUrl: '' }
      }, captureCall);
    } catch {
      productionResult = { mode: 'DETERMINISTIC_FALLBACK', failure: 'PROVIDER_ERROR' };
    }
    if (callCount !== 1) throw new Error('A fixed evaluation case did not make exactly one provider request.');
    document.requestCount += callCount;
    responseDiagnostic = typeof rawResponse === 'string'
      ? safeDiagnostic(diagnoseSemanticResponse(rawResponse, isIrasFirstProfile ? testCase.question : undefined), {
        includeMetadataMismatch: isIrasFirstV2Profile
      })
      : undefined;
    rawResponse = undefined;
    const validInterpretation = productionResult?.mode === 'SEMANTIC_INTERPRETATION' &&
      productionResult.failure === undefined && Boolean(productionResult.interpretation) && responseDiagnostic?.interpreted === true;
    const scoring = validInterpretation
      ? scoreValidInterpretation(testCase, productionResult.interpretation)
      : {
        expectedIssueCount: testCase.expected.length,
        predictedIssueCount: 0,
        matchedIssueCount: 0,
        matchedExpectedIssueIds: [],
        issueRecall: null,
        issuePrecision: null,
        completeQuestionIssueCoverage: false,
        operationCorrect: 0,
        operationMatched: 0,
        dimensionsCorrect: Object.fromEntries(['governingAuthority', 'contextualAuthority', 'domain', 'population', 'operation'].map(key => [key, 0]))
      };
    let routing;
    if (validInterpretation) {
      try {
        routing = await summarizeRuntime(testCase, productionResult, buildRuntime, {
          captureAuthorityReliefRouting: isLegacyStrictSemanticProfile,
          captureIrasFirstScope: isIrasFirstProfile
        });
      } catch {
        routing = {
          plannedWorkstreamCount: 0,
          finalWorkstreamCount: 0,
          finalWorkstreamSetAccuracy: false,
          status: 'UNKNOWN',
          evidenceStatus: 'UNKNOWN',
          applicationStatus: 'UNKNOWN',
          category: 'LOCAL_ROUTING_FAILURE',
          guardChecks: {
            operationsPreserved: false,
            caseFactsRequired: false,
            incompletePlanNotVerified: false,
            contextualAuthorityNotRouted: false,
            residualHasNoWorkstream: false,
            caseSpecificApplicationsUnresolved: false,
            unresolvedApplicationNotVerified: false
          },
          applicationStatusCounts: { NOT_REQUIRED: 0, UNRESOLVED: 0, UNKNOWN: 0, requiredPlanIssues: 0, routedRequiredIssues: 0 }
        };
      }
    }
    const sourceAfter = await hashManifest(profile.sourceFiles);
    const fixturesAfter = await hashManifest(profile.fixtureFiles);
    const sourceHashesConsistent = sameManifest(sourceBefore, sourceAfter) && sameManifest(sourceHashes, sourceAfter);
    const fixtureHashesConsistent = sameManifest(fixturesBefore, fixturesAfter) && sameManifest(fixtureHashes, fixturesAfter);
    document.sourceHashesConsistent = document.sourceHashesConsistent && sourceHashesConsistent;
    document.fixtureHashesConsistent = document.fixtureHashesConsistent && fixtureHashesConsistent;
    const canonicalScoring = isStrictSemanticProfile && validInterpretation
      ? scoreAuthorityReliefCanonicalContract(testCase, productionResult.interpretation)
      : undefined;
    const authorityReliefAcceptance = isLegacyStrictSemanticProfile
      ? authorityReliefCaseAcceptance({
        testCase,
        validInterpretation,
        canonicalScoring: canonicalScoring || scoring,
        routing,
        interpretation: productionResult?.interpretation,
        productionResult,
        capture,
        requestCount: callCount,
        sourceHashesConsistent,
        fixtureHashesConsistent
      })
      : undefined;
    const irasFirstAcceptance = isIrasFirstProfile
      ? evaluateIrasFirstCase({
        testCase,
        validInterpretation,
        scoring: canonicalScoring || scoring,
        interpretation: productionResult?.interpretation,
        routing,
        production: productionResult,
        capture,
        requestCount: callCount,
        sourceHashesConsistent,
        fixtureHashesConsistent
      })
      : undefined;
    const historicalScoring = isIrasFirstProfile && testCase.historicalExpected
      ? scoreValidInterpretation({ ...testCase, expected: testCase.historicalExpected },
        validInterpretation ? productionResult.interpretation : { issues: [] })
      : undefined;
    document.cases.push({
      caseId: testCase.id,
      group: testCase.group,
      ...(isIrasFirstProfile ? {
        expectationVersion: testCase.expectationVersion,
        ...(testCase.adjudicationVersion ? { adjudicationVersion: testCase.adjudicationVersion } : {}),
        ...(testCase.expectedCoverageOutcome ? { expectedCoverageOutcome: testCase.expectedCoverageOutcome } : {})
      } : {}),
      expectedIssueIds: testCase.expected.map(issue => issue.id),
      expectedWorkstreamSetCount: testCase.expectedWorkstreamsAnyOf.length,
      validInterpretation,
      production: safeResult(productionResult),
      ...(capture ? { capture } : {}),
      ...(responseDiagnostic ? { responseDiagnostic } : {}),
      scoring,
      ...(canonicalScoring ? { canonicalScoring } : {}),
      ...(authorityReliefAcceptance ? { authorityReliefAcceptance } : {}),
      ...(irasFirstAcceptance ? { irasFirstAcceptance } : {}),
      ...(historicalScoring ? { historicalScoring } : {}),
      ...(profile.evaluationProfile === 'intent-targeted' || profile.evaluationProfile === 'intent-final'
        ? { intentAcceptance: intentAcceptance(testCase, validInterpretation, scoring, routing, productionResult?.interpretation) }
        : {}),
      ...(routing ? { routing } : {}),
      sourceHashesConsistent,
      fixtureHashesConsistent,
      elapsedMs: Math.round((monotonicNow() - initialMonotonic) * 100) / 100
    });
    if (isLegacyStrictSemanticProfile) {
      document.authorityReliefAcceptance = summarizeAuthorityReliefAcceptance(document, selectedCases.length);
    }
    if (isIrasFirstProfile) document.irasFirstAcceptance = summarizeIrasFirstAcceptance(document, selectedCases.length);
    document.summaries = [
      caseSummary(document.cases, 'PRESELECTED_KNOWN_FAILURE'),
      caseSummary(document.cases, 'INDEPENDENT_CONTROL'),
      caseSummary(document.cases, 'COMBINED')
    ];
    if (isIrasFirstProfile) document.protectedHistoricalArtifacts.verifiedDuringCapture = (await assertProtectedHistory()).verified;
    await writeProgress(outputDirectory, document, profile.outputPrefix);
    if (!sourceHashesConsistent || !fixtureHashesConsistent) {
      throw new Error('Source or fixture hash changed during live capture.');
    }
    productionResult = undefined;
  }

  document.completedAt = now().toISOString();
  if (isLegacyStrictSemanticProfile) {
    document.authorityReliefAcceptance = summarizeAuthorityReliefAcceptance(document, selectedCases.length);
  }
  if (isIrasFirstProfile) {
    document.protectedHistoricalArtifacts.verifiedAfterCapture = (await assertProtectedHistory()).verified;
    document.irasFirstAcceptance = summarizeIrasFirstAcceptance(document, selectedCases.length);
    document.historicalAllAuthorityMetric = summarizeHistoricalAllAuthorityMetric(document.cases, 10,
      evaluationProfile === IRAS_FIRST_FINAL_PROFILE || evaluationProfile === IRAS_FIRST_FINAL_V2_PROFILE
        ? 'original-ten-final' : 'targeted-profile-overlap');
  }
  await writeProgress(outputDirectory, document, profile.outputPrefix);
  return document;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== '--live') throw new Error('Live capture requires --live.');
  const result = await runSemanticContractFollowupEvaluation({ live: true });
  process.stdout.write(`${JSON.stringify({
    outputPrefix: OUTPUT_PREFIX,
    requestCount: result.requestCount,
    summaries: result.summaries
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    const message = SAFE_RUNNER_ERRORS.has(error?.message) ? error.message : 'Semantic contract follow-up runner failed.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
