import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyQuestion } from '../../../../src/classification/questionClassifier.ts';
import { defaultQueryTopicResolver } from '../../../../src/retrieval/queryTopicResolver.ts';
import { getCoverageTopicsByIds } from '../../../../src/standards/coverageRegistry.ts';
import { validateSemanticQuestionInterpretation, reconcileQuestionUnderstanding } from '../../../../src/services/semanticQuestionUnderstanding.ts';
import { matchIssuesV2, scoreIssueDimensionsV2 } from '../../../../tests/evaluation/singapore/multi-authority-issue-scoring-v2.mjs';
// Read-only diagnostic replay. Synthetic semantic mocks, no provider or retrieval.
const contract = JSON.parse(await readFile(new URL('../../../../tests/evaluation/singapore/iras-first-targeted-acceptance-v4.json', import.meta.url), 'utf8'));
const testCase = contract.cases.find(row => row.caseId === 'A-paraphrase-2');
const rows = [];
for (const subject of ['individual income tax relief for compulsory CPF', 'individual personal tax relief claim for compulsory CPF contributions']) {
  for (const rootMode of ['CPF_FIRST', 'UNKNOWN_MIXED']) {
    const issues = testCase.semantic.expectedIssues.map(expected => ({
      subject: expected.governingAuthorities.includes('IRAS') ? subject : 'employer CPF contribution amount',
      population: expected.population[0], domain: expected.domain[0], governingAuthorities: expected.governingAuthorities,
      contextualAuthorities: expected.contextualAuthoritiesAnyOf[0], operation: expected.governingAuthorities.includes('CPF') ? 'CALCULATE' : 'CHECK_ELIGIBILITY',
      mappedTopicIds: [], evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS', confidence: 0.96
    }));
    const raw = {schemaVersion:2, jurisdiction:['Singapore'],
      authorityCandidates: rootMode === 'UNKNOWN_MIXED' ? ['UNKNOWN'] : ['CPF','IRAS'], contextualAuthorities:[],
      domain: rootMode === 'UNKNOWN_MIXED' ? 'UNKNOWN' : 'CPF_PAYROLL',
      population: rootMode === 'UNKNOWN_MIXED' ? 'UNKNOWN' : 'EMPLOYER',
      primarySubject: 'employer CPF contribution amount and individual personal tax relief for compulsory CPF contributions',
      concepts:[{concept:'employer CPF contribution amount',role:'PRIMARY'},{concept:'personal tax relief on compulsory CPF contributions',role:'RELATED'}],
      requestedOperation: rootMode === 'UNKNOWN_MIXED' ? 'OTHER' : 'CALCULATE', factsExplicitlyProvided:[], confidence:0.96, issues};
    const interpretation = validateSemanticQuestionInterpretation(raw, testCase.question);
    assert.ok(interpretation);
    const matched = matchIssuesV2(testCase.semantic.expectedIssues, interpretation.issues);
    assert.equal(matched.ownerByExpected.size, 2);
    for (const [expectedIndex, actualIndex] of matched.ownerByExpected) {
      assert.ok(Object.values(scoreIssueDimensionsV2(interpretation.issues[actualIndex], testCase.semantic.expectedIssues[expectedIndex])).every(Boolean));
    }
    const classification = classifyQuestion(testCase.question);
    const reconciled = reconcileQuestionUnderstanding(testCase.question, classification, {mode:'SEMANTIC_INTERPRETATION',interpretation});
    rows.push({subject, rootMode, rawMock:raw, validated:true,
      subjectTopics:defaultQueryTopicResolver.decomposeQuery(subject).topics.map(topic=>topic.id),
      independentlyRecognizedTopics:classification.topicIds,
      issuePlan:reconciled.issuePlan});
  }
}
const proof = {provenance:'API-free production validator/classifier/resolver/reconciliation replay; not Gemini or historical reconstruction',
  startingSha:'0d97cf7d15f6da99f2d9c3e4b73cc1f5354b4828',caseId:testCase.caseId,question:testCase.question,
  routingMetadata:getCoverageTopicsByIds(['iras-individual-reliefs']),rows};
assert.deepEqual(proof, JSON.parse(await readFile(new URL('./routing-classification-proof.json', import.meta.url), 'utf8')));
for (const row of rows) {
  const canonical = row.subject === 'individual personal tax relief claim for compulsory CPF contributions';
  assert.equal(row.issuePlan.coverageEstablished, canonical);
  assert.equal(row.issuePlan.hasUnmappedResidual, !canonical);
  assert.equal(row.issuePlan.issues.length, canonical ? 2 : 3);
}
console.log('PASS: four retained production reconciliations replay exactly; all V2 identities/dimensions pass; false mixed-case residual reproduced in both roots.');
