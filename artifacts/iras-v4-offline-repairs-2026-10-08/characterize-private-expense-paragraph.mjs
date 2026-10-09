import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultExternalSourceValidator } from '../../src/retrieval/externalSourceValidator.ts';
import { supportGeneralIrasRuleConcept } from '../../src/retrieval/irasRuleConceptSupport.ts';
import { getCoverageTopicsByIds } from '../../src/standards/coverageRegistry.ts';
import { getRequestedQuestionConcepts } from '../../src/services/semanticQuestionUnderstanding.ts';
import { selectRelevantFetchedText } from '../../src/services/groundingContextBuilder.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CAPTURE_PATH = path.join(ROOT, 'artifacts/iras-v4-acceptance-repaired-2026-10-06/retry-2026-10-08/official-capture/capture-payload.json');
const CONTRACT_PATH = path.join(ROOT, 'tests/evaluation/singapore/iras-first-targeted-acceptance-v4.json');
const BASELINE_PATH = path.join(ROOT, 'artifacts/iras-v4-offline-repairs-2026-10-08/baseline-replay.json');
const OUTPUT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'private-expense-characterization.json');
const EXPECTED_BODY_SHA256 = 'dbb24a33a40706d6909151b2fe23560d5f0b1f96b8d5175797349981752f5451';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizedWords(value) {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9%]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const [payload, contract, baseline] = await Promise.all([
  readFile(CAPTURE_PATH, 'utf8').then(JSON.parse),
  readFile(CONTRACT_PATH, 'utf8').then(JSON.parse),
  readFile(BASELINE_PATH, 'utf8').then(JSON.parse)
]);
const entry = payload.entries.find(item => item.bodySha256 === EXPECTED_BODY_SHA256);
assert.ok(entry, 'PRIVATE_EXPENSE_CAPTURE_BODY_MISSING');
assert.equal(sha256(Buffer.from(entry.bodyBase64, 'base64')), EXPECTED_BODY_SHA256, 'PRIVATE_EXPENSE_CAPTURE_BODY_HASH_MISMATCH');
const baselineCase = baseline.cases.find(item => item.caseId === 'private-expense-treatment');
assert.ok(baselineCase, 'PRIVATE_EXPENSE_BASELINE_CASE_MISSING');
const contractCase = contract.cases.find(item => item.caseId === 'private-expense-treatment');
assert.ok(contractCase, 'PRIVATE_EXPENSE_CONTRACT_CASE_MISSING');
const issue = baselineCase.issuePlan.issues.find(item => item.governingAuthorities.includes('IRAS'));
assert.ok(issue, 'PRIVATE_EXPENSE_MAPPED_ISSUE_MISSING');
const topics = getCoverageTopicsByIds(issue.mappedTopicIds);
const topic = topics.find(item => item.id === 'iras-cit-deductibility');
assert.ok(topic, 'PRIVATE_EXPENSE_DEDUCTIBILITY_TOPIC_MISSING');
const topicTerms = [...new Set([
  topic.title,
  ...(topic.aliases || []),
  ...topic.keywords,
  ...(topic.requiredContentTerms || []),
  ...(topic.paragraphHints || []),
  ...(topic.sectionHints || [])
].filter(term => term.trim().length > 2))];
const focusedTopicTerms = topicTerms.filter(term => normalizedWords(term).split(' ').filter(Boolean).length >= 2);
const validatorTerms = focusedTopicTerms.length > 0 ? focusedTopicTerms : topicTerms;
const html = Buffer.from(entry.bodyBase64, 'base64').toString('utf8');
const validation = defaultExternalSourceValidator.validateTopicContent(html, {
  standardIdentifiers: ['IRAS'],
  expectedTitles: ['Business Expenses'],
  topicTerms: validatorTerms,
  minimumTopicTermMatches: 1,
  allowIrasTopicTokenEquivalence: true
});
assert.equal(validation.isValid, true, 'PRIVATE_EXPENSE_CAPTURED_BODY_FAILED_EXISTING_VALIDATOR');
const substantiveText = validation.substantiveText || '';
const paragraph = substantiveText.split(/\r?\n[\t ]*\r?\n+/).find(value =>
  /non-deductible business expenses/i.test(value) && /these include personal expenses/i.test(value));
assert.ok(paragraph, 'PRIVATE_EXPENSE_RULE_PARAGRAPH_NOT_PRESERVED_BY_VALIDATOR');
const concepts = getRequestedQuestionConcepts(contractCase.question, baselineCase.interpretation);
assert.ok(concepts.some(item => item.label === 'income-tax deductibility'), 'PRIVATE_EXPENSE_ACTUAL_REQUESTED_CONCEPT_MISSING');
const supportInput = {
  sourceText: paragraph,
  domainId: topic.domainId,
  topicIds: issue.mappedTopicIds,
  subject: issue.subject,
  population: issue.population,
  concepts
};
const directParagraphSupported = supportGeneralIrasRuleConcept(supportInput) === true;
assert.equal(directParagraphSupported, true, 'PRIVATE_EXPENSE_RULE_PARAGRAPH_NOT_SUPPORTED_UNDER_ACTUAL_SCOPE');
const selectedExcerpt = selectRelevantFetchedText(substantiveText, validatorTerms, 5_000, contractCase.question);
const selectedExcerptSupported = supportGeneralIrasRuleConcept({ ...supportInput, sourceText: selectedExcerpt }) === true;
const result = {
  profile: 'IRAS_V4_OFFLINE_PRIVATE_EXPENSE_PARAGRAPH_CHARACTERIZATION',
  acceptanceResult: false,
  liveCallsMade: 0,
  capturesMade: 0,
  caseId: baselineCase.caseId,
  capturedBodySha256: EXPECTED_BODY_SHA256,
  productionFetchValidation: baselineCase.governedEvidence.fetchValidationObservations.find(item => item.contentHash === EXPECTED_BODY_SHA256),
  validator: { isValid: validation.isValid, pageTitle: validation.pageTitle, extractedTextBytes: Buffer.byteLength(substantiveText, 'utf8') },
  issueScope: {
    subject: issue.subject,
    population: issue.population,
    domain: issue.domain,
    governingAuthorities: issue.governingAuthorities,
    mappedTopicIds: issue.mappedTopicIds,
    requestedConcepts: concepts.map(item => ({ id: item.id, label: item.label, topicIds: item.topicIds }))
  },
  directParagraph: { sha256: sha256(paragraph), bytes: Buffer.byteLength(paragraph, 'utf8'), supportedByExistingRuleGate: directParagraphSupported },
  existingSelector: { selectedBytes: Buffer.byteLength(selectedExcerpt, 'utf8'), preservedCompleteParagraph: selectedExcerpt.includes(paragraph), supportedByExistingRuleGate: selectedExcerptSupported }
};
await writeFile(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`, { flag: 'w' });
console.log(JSON.stringify({
  caseId: result.caseId,
  capturedBodySha256: result.capturedBodySha256,
  validatorValid: result.validator.isValid,
  issueScope: result.issueScope,
  directParagraph: result.directParagraph,
  existingSelector: result.existingSelector
}, null, 2));
