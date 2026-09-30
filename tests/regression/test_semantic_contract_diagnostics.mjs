import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  diagnoseSemanticContract,
  diagnoseSemanticResponse
} from '../evaluation/singapore/semantic-contract-diagnosis.mjs';
import {
  main,
  runSemanticContractDiagnosis,
  safeRunnerErrorMessage
} from '../evaluation/singapore/semantic-contract-diagnostics.mjs';
import {
  SEMANTIC_QUESTION_SCHEMA_VERSION,
  validateSemanticQuestionInterpretation
} from '../../src/services/semanticQuestionUnderstanding.ts';

const base = {
  jurisdiction: ['Singapore'],
  authorityCandidates: ['ACCOUNTING_STANDARDS'],
  contextualAuthorities: [],
  domain: 'ACCOUNTING',
  population: 'UNKNOWN',
  primarySubject: 'general recognition',
  concepts: [{ concept: 'intangible assets', role: 'PRIMARY' }],
  requestedOperation: 'EXPLAIN_RULE',
  requiresUserSpecificFacts: false,
  calculationRequested: false,
  factsExplicitlyProvided: [],
  confidence: 0.92
};

function verifyRejected(candidate, expectedCode, expectedPath) {
  assert.equal(validateSemanticQuestionInterpretation(candidate), undefined, `${expectedCode} fixture must fail production validation`);
  const result = diagnoseSemanticContract(candidate);
  assert.equal(result.validatorAccepted, false);
  assert.equal(result.interpreted, false);
  assert.equal(result.rejectionCode, expectedCode);
  if (expectedPath) assert.equal(result.rejectionPath, expectedPath);
  return result;
}

const accepted = diagnoseSemanticContract(base);
assert.equal(accepted.validatorAccepted, true);
assert.equal(accepted.interpreted, true);
assert.equal(accepted.rejectionCode, 'NONE');
assert.deepEqual(accepted.safeShape.fields.authorityCandidates.values, ['ACCOUNTING_STANDARDS']);

const { calculationRequested: _legacyCalculationFlag, ...legacyWithoutCalculationFlag } = base;
const versionedBase = {
  schemaVersion: SEMANTIC_QUESTION_SCHEMA_VERSION,
  ...legacyWithoutCalculationFlag,
  issues: [{
    subject: 'general recognition', population: 'UNKNOWN', domain: 'ACCOUNTING',
    governingAuthorities: ['ACCOUNTING_STANDARDS'], contextualAuthorities: [], operation: 'EXPLAIN_RULE',
    mappedTopicIds: [], evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 0.92
  }]
};
const acceptedV2 = diagnoseSemanticContract(versionedBase);
assert.equal(acceptedV2.validatorAccepted, true);
assert.equal(acceptedV2.safeShape.fields.schemaVersion.valid, true);
assert.equal(acceptedV2.safeShape.fields.calculationRequested, 'DERIVED');
assert.equal(acceptedV2.safeShape.missingKeyCount, 0);

const { issues: _v2Issues, ...missingV2Issues } = versionedBase;
const missingV2IssuesDiagnostic = diagnoseSemanticContract(missingV2Issues);
assert.equal(missingV2IssuesDiagnostic.rejectionCode, 'MISSING_KEY');
assert.equal(missingV2IssuesDiagnostic.rejectionPath, 'issues');
assert.equal(diagnoseSemanticContract({ ...versionedBase, issues: [] }).rejectionCode, 'EMPTY_ISSUES');
const v2CalculationContradiction = {
  ...versionedBase,
  requestedOperation: 'CALCULATE',
  requiresUserSpecificFacts: false,
  issues: [{ ...versionedBase.issues[0], operation: 'CALCULATE' }]
};
const v2ContradictionDiagnostic = diagnoseSemanticContract(v2CalculationContradiction);
assert.equal(v2ContradictionDiagnostic.rejectionCode, 'CASE_FLAG_CONTRADICTION');
assert.equal(v2ContradictionDiagnostic.rejectionPath, 'requiresUserSpecificFacts');

const privateSentinel = 'SECRET_CASE_SENTINEL SGD 91,234.55 AIzaABCDEFGHIJKLMNOPQRSTUV';
const unexpectedKey = verifyRejected({
  ...base,
  primarySubject: privateSentinel,
  unrecognizedPrivateProperty: privateSentinel
}, 'UNEXPECTED_KEY', '$');
const encodedUnexpected = JSON.stringify(unexpectedKey);
assert.equal(encodedUnexpected.includes(privateSentinel), false);
assert.equal(encodedUnexpected.includes('unrecognizedPrivateProperty'), false);
assert.equal(unexpectedKey.safeShape.extraKeyCount, 1);
assert.equal(unexpectedKey.safeShape.fields.primarySubject.valid, false);

const { jurisdiction: omittedJurisdiction, ...missingRequiredField } = base;
void omittedJurisdiction;
verifyRejected(missingRequiredField, 'MISSING_KEY', 'jurisdiction');
verifyRejected({ ...base, population: 4 }, 'WRONG_TYPE', 'population');
verifyRejected({ ...base, primarySubject: 'https://private.example/SECRET_LABEL' }, 'INVALID_LABEL', 'primarySubject');
verifyRejected({ ...base, authorityCandidates: ['UNLISTED_AUTHORITY'] }, 'INVALID_AUTHORITY', 'authorityCandidates[0]');
verifyRejected({ ...base, jurisdiction: Array.from({ length: 7 }, () => 'Singapore') }, 'COUNT_LIMIT', 'jurisdiction');
verifyRejected({ ...base, population: 'CUSTOMER_SECRET' }, 'INVALID_POPULATION', 'population');
verifyRejected({ ...base, authorityCandidates: ['ACCOUNTING_STANDARDS', 'ACCOUNTING_STANDARDS'] }, 'DUPLICATE_AUTHORITY', 'authorityCandidates');
verifyRejected({ ...base, domain: 'CPF_PAYROLL' }, 'DOMAIN_AUTHORITY_MISMATCH', 'authorityCandidates');
verifyRejected({ ...base, requestedOperation: 'CALCULATE' }, 'CALCULATION_FLAG_MISMATCH', 'calculationRequested');
verifyRejected({ ...base, requestedOperation: 'CALCULATE', calculationRequested: true }, 'CASE_FLAG_CONTRADICTION', 'requiresUserSpecificFacts');
verifyRejected({ ...base, domain: 'IRAS_INCOME_TAX', authorityCandidates: ['IRAS'], requestedOperation: 'PREPARE_JOURNAL' }, 'JOURNAL_DOMAIN_MISMATCH', 'domain');
verifyRejected({ ...base, authorityCandidates: ['UNKNOWN', 'IRAS'], domain: 'IRAS_GST' }, 'UNKNOWN_AUTHORITY_MIX', 'authorityCandidates');
verifyRejected({ ...base, confidence: 2 }, 'CONFIDENCE_OUT_OF_RANGE', 'confidence');
verifyRejected({ ...base, concepts: [{ concept: 'safe label', role: 'UNLISTED_ROLE' }] }, 'INVALID_CONCEPT_ROLE', 'concepts[0].role');
verifyRejected({ ...base, concepts: [{ concept: 'safe label', role: 'PRIMARY', privateConceptData: privateSentinel }] }, 'CONCEPT_STRUCTURE', 'concepts[0]');
verifyRejected({ ...base, issues: 'not-an-array' }, 'ISSUE_STRUCTURE', 'issues');

const issueBase = {
  subject: 'accounting recognition',
  population: 'UNKNOWN',
  domain: 'ACCOUNTING',
  governingAuthorities: ['ACCOUNTING_STANDARDS'],
  contextualAuthorities: [],
  operation: 'EXPLAIN_RULE',
  mappedTopicIds: [],
  evidenceRequirement: 'AUTHORITATIVE_SOURCE',
  confidence: 0.91
};
verifyRejected({ ...base, issues: [{ ...issueBase, operation: 'UNLISTED_OPERATION' }] }, 'INVALID_OPERATION', 'issues[0].operation');
verifyRejected({ ...base, issues: [{ ...issueBase, domain: 'UNLISTED_DOMAIN' }] }, 'INVALID_DOMAIN', 'issues[0].domain');
verifyRejected({ ...base, issues: [{ ...issueBase, contextualAuthorities: ['ACCOUNTING_STANDARDS'] }] }, 'AUTHORITY_OVERLAP', 'issues[0].contextualAuthorities');
verifyRejected({ ...base, issues: [{ ...issueBase, domain: 'IRAS_GST' }] }, 'DOMAIN_AUTHORITY_MISMATCH', 'issues[0].governingAuthorities');
verifyRejected({ ...base, issues: [{ ...issueBase, governingAuthorities: ['ACCOUNTING_STANDARDS', 'IFRS_FOUNDATION'] }] }, 'ISSUE_AUTHORITY_COUNT', 'issues[0].governingAuthorities');
verifyRejected({ ...base, issues: [{ ...issueBase, confidence: 0.3 }] }, 'LOW_CONFIDENCE', 'issues[0].confidence');
verifyRejected({ ...base, issues: Array.from({ length: 13 }, () => issueBase) }, 'ISSUE_COUNT_LIMIT', 'issues');

const lowConfidence = diagnoseSemanticContract({ ...base, confidence: 0.4 });
assert.equal(validateSemanticQuestionInterpretation({ ...base, confidence: 0.4 }) !== undefined, true,
  'the exported shape validator intentionally leaves the threshold to the production interpreter');
assert.equal(lowConfidence.validatorAccepted, true);
assert.equal(lowConfidence.interpreted, false);
assert.equal(lowConfidence.rejectionCode, 'LOW_CONFIDENCE');

const malformed = diagnoseSemanticResponse(`RAW_PROVIDER_SENTINEL ${privateSentinel}`);
assert.equal(malformed.rejectionCode, 'MALFORMED_JSON');
assert.equal(JSON.stringify(malformed).includes('RAW_PROVIDER_SENTINEL'), false);
assert.equal(JSON.stringify(malformed).includes(privateSentinel), false);
const oversized = diagnoseSemanticResponse('x'.repeat(16_001));
assert.equal(oversized.rejectionCode, 'RESPONSE_TOO_LARGE');
assert.equal(oversized.safeShape.exceedsLimit, true);
assert.equal(JSON.stringify(oversized).includes('x'.repeat(100)), false);

const malformedShape = diagnoseSemanticResponse(JSON.stringify({ ...base, domain: 'NOT_A_DOMAIN', primarySubject: privateSentinel }));
assert.equal(malformedShape.rejectionCode, 'INVALID_DOMAIN');
assert.equal(JSON.stringify(malformedShape).includes(privateSentinel), false);
assert.equal(malformedShape.safeShape.fields.domain, 'INVALID');

await assert.rejects(() => main([]), /requires --live/);
assert.equal(safeRunnerErrorMessage(new Error('RAW_FIXTURE_AND_PROVIDER_SECRET')), 'Semantic contract diagnosis runner failed.');
assert.equal(safeRunnerErrorMessage(new Error('A baseline output file already exists.')), 'A baseline output file already exists.');
let disabledRequestCount = 0;
await assert.rejects(() => runSemanticContractDiagnosis({
  live: false,
  execute: async () => { disabledRequestCount += 1; return JSON.stringify(base); }
}), /requires --live/);
assert.equal(disabledRequestCount, 0);

const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'semantic-contract-runner-'));
const pacedStarts = [];
let requestCount = 0;
let dateTick = 0;
const rawResponseSentinel = `RAW_PROVIDER_SENTINEL ${privateSentinel}`;
const firstMockResponse = JSON.stringify({ ...base, primarySubject: rawResponseSentinel });
const finalMockResponse = JSON.stringify(base);
try {
  const result = await runSemanticContractDiagnosis({
    live: true,
    apiKey: 'mock-only-test-key-12345',
    outputDirectory,
    sleep: async milliseconds => { pacedStarts.push(milliseconds); },
    now: () => new Date(Date.UTC(2026, 8, 30, 0, 0, dateTick++)),
    execute: async (prompt, systemInstruction, provider, options) => {
      requestCount += 1;
      assert.ok(prompt.length > 0);
      assert.ok(systemInstruction.length > 0);
      assert.equal(provider.activeProvider, 'gemini');
      assert.equal(provider.gemini.model, 'gemini-3.5-flash-lite');
      assert.equal(provider.gemini.apiKey, 'mock-only-test-key-12345');
      assert.equal(options.timeoutMs, 8_000);
      assert.equal(options.jsonMode, true);
      assert.equal(options.temperature, 0);
      if (requestCount === 2) {
        const checkpoint = JSON.parse(await readFile(path.join(outputDirectory, 'semantic-contract-diagnosis-baseline.json'), 'utf8'));
        assert.equal(checkpoint.cases.length, 1, 'progress is atomically checkpointed after each response');
        assert.equal(JSON.stringify(checkpoint).includes('RAW_PROVIDER_SENTINEL'), false);
        throw new Error('Gemini API request failed with HTTP 429. RAW_ERROR_SENTINEL');
      }
      return requestCount === 1 ? firstMockResponse : finalMockResponse;
    }
  });
  assert.equal(requestCount, 3, 'the runner makes exactly one request per selected case and does not retry a 429');
  assert.deepEqual(pacedStarts, [15_250, 15_250]);
  assert.equal(result.document.cases.length, 3);
  assert.equal(result.document.sourceHashConsistent, true);
  assert.deepEqual(result.document.cases.map(item => item.caseId), [
    'control-general-recognition', 'control-general-interaction', 'A-paraphrase-3'
  ]);
  assert.equal(result.document.cases[0].diagnostic.rejectionCode, 'INVALID_LABEL');
  assert.equal(result.document.cases[1].production.failure, 'RATE_LIMITED');
  assert.equal(result.document.cases[1].production.providerStatus, 429);
  assert.equal(result.document.cases[2].production.mode, 'SEMANTIC_INTERPRETATION');
  for (const item of result.document.cases) {
    assert.equal(item.fixtureHashConsistent, true);
    assert.equal(item.productionSourceHashConsistent, true);
    assert.equal(item.capture.requestCount, 1);
    assert.equal(item.capture.model, 'gemini-3.5-flash-lite');
    assert.equal(item.capture.timeoutMs, 8_000);
    assert.equal(typeof item.capture.latencyMs, 'number');
    assert.match(item.capture.promptSha256, /^[a-f0-9]{64}$/);
    assert.match(item.capture.systemSha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(result.document.cases[0].capture.responseChars, firstMockResponse.length);
  assert.equal(result.document.cases[0].capture.responseUtf8Bytes, Buffer.byteLength(firstMockResponse, 'utf8'));
  assert.equal(result.document.cases[0].capture.responseReceived, true);
  assert.equal(result.document.cases[1].capture.responseReceived, false);
  assert.equal(result.document.cases[1].capture.responseChars, 0);
  assert.equal(result.document.cases[2].capture.responseChars, finalMockResponse.length);
  assert.equal(result.document.cases[2].capture.responseUtf8Bytes, Buffer.byteLength(finalMockResponse, 'utf8'));
  const outputText = await readFile(result.outputJson, 'utf8') + await readFile(result.outputMarkdown, 'utf8');
  assert.equal(outputText.includes(rawResponseSentinel), false);
  assert.equal(outputText.includes('RAW_PROVIDER_SENTINEL'), false);
  assert.equal(outputText.includes('RAW_ERROR_SENTINEL'), false);
  assert.equal(outputText.includes('mock-only-test-key-12345'), false);
  assert.equal(outputText.includes('SGD 6,000'), false);
  assert.equal(outputText.includes('Interpret this question:'), false);
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}

const refusalDirectory = await mkdtemp(path.join(os.tmpdir(), 'semantic-contract-refusal-'));
let refusedRequestCount = 0;
try {
  await writeFile(path.join(refusalDirectory, 'semantic-contract-diagnosis-baseline.md'), 'preserve existing output');
  await assert.rejects(() => runSemanticContractDiagnosis({
    live: true,
    apiKey: 'mock-only-test-key-12345',
    outputDirectory: refusalDirectory,
    execute: async () => { refusedRequestCount += 1; return JSON.stringify(base); }
  }), /already exists/);
  assert.equal(refusedRequestCount, 0, 'existing output files prevent requests');
  assert.equal(await readFile(path.join(refusalDirectory, 'semantic-contract-diagnosis-baseline.md'), 'utf8'), 'preserve existing output');
} finally {
  await rm(refusalDirectory, { recursive: true, force: true });
}

console.log('Semantic contract diagnostic/privacy regressions passed.');
