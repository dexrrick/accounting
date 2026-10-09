import assert from 'node:assert/strict';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import {
  getRequestedQuestionConcepts,
  reconcileQuestionUnderstanding,
  validateSemanticQuestionInterpretation
} from '../../src/services/semanticQuestionUnderstanding.ts';

const query = 'What are the general Singapore withholding-tax rules when a company pays royalties to a non-resident company?';
const baseSubject = 'general Singapore withholding-tax rules for company royalty payments to a non-resident company';
const topicIds = ['iras-withholding-tax', 'iras-withholding-tax-interest-royalties'];
let fetchAttempts = 0;
let providerCalls = 0;
globalThis.fetch = async () => {
  fetchAttempts += 1;
  throw new Error('The WHT ownership regression must not make network calls');
};

async function ownershipRun({ id, issueSubject = baseSubject, queryText = query, qualifier, role = 'PRIMARY' }) {
  const concepts = [{ concept: issueSubject, role: 'PRIMARY' }];
  if (qualifier) concepts.push({ concept: qualifier, role });
  const interpretation = {
    schemaVersion: 2,
    jurisdiction: ['Singapore'],
    authorityCandidates: ['IRAS'],
    contextualAuthorities: [],
    domain: 'IRAS_INCOME_TAX',
    population: 'COMPANY',
    primarySubject: issueSubject,
    concepts,
    requestedOperation: 'EXPLAIN_RULE',
    factsExplicitlyProvided: [],
    confidence: 0.96,
    issues: [{
      subject: issueSubject,
      population: 'COMPANY',
      domain: 'IRAS_INCOME_TAX',
      governingAuthorities: ['IRAS'],
      contextualAuthorities: [],
      operation: 'EXPLAIN_RULE',
      mappedTopicIds: [],
      evidenceRequirement: 'AUTHORITATIVE_SOURCE',
      confidence: 0.96
    }]
  };
  assert.ok(validateSemanticQuestionInterpretation(interpretation, queryText), `Validated mock: ${id}`);
  const understanding = { mode: 'SEMANTIC_INTERPRETATION', interpretation };
  const requested = getRequestedQuestionConcepts(queryText, understanding);
  const reconciliation = reconcileQuestionUnderstanding(queryText, classifyQuestion(queryText), understanding);
  const plannedIssue = reconciliation.issuePlan.issues.find(issue => issue.subject === issueSubject);
  assert.ok(plannedIssue, `One WHT issue planned: ${id}`);
  assert.deepEqual([...plannedIssue.mappedTopicIds].sort(), [...topicIds].sort());

  const result = await buildAuthorityWorkstreams(queryText, reconciliation.issuePlan, {
    localOnly: true,
    referenceDate: '2026-10-02',
    questionUnderstanding: understanding,
    providers: {
      IRAS: {
        authority: 'IRAS',
        async retrieve() {
          providerCalls += 1;
          return { candidates: [] };
        }
      }
    }
  });
  return {
    requested,
    unrouted: result.gaps.filter(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT').map(gap => gap.subject)
  };
}

const hyphenatedIssueJoinedConcept = await ownershipRun({
  id: 'hyphenated issue / joined concept', qualifier: 'nonresident company'
});
assert.ok(hyphenatedIssueJoinedConcept.requested.some(item => item.label === 'nonresident company' && item.topicIds.length === 0));
assert.deepEqual(hyphenatedIssueJoinedConcept.unrouted, [],
  'The equivalent joined spelling belongs to the existing hyphenated WHT issue.');

const hyphenatedIssueHyphenatedConcept = await ownershipRun({
  id: 'hyphenated issue / hyphenated concept', qualifier: 'non-resident company'
});
assert.deepEqual(hyphenatedIssueHyphenatedConcept.unrouted, [],
  'The original spelling remains owned by the existing WHT issue.');

const joinedSubject = baseSubject.replace('non-resident', 'nonresident');
const joinedQuery = query.replace('non-resident', 'nonresident');
const joinedBoth = await ownershipRun({
  id: 'joined issue / joined concept', issueSubject: joinedSubject, queryText: joinedQuery, qualifier: 'nonresident company'
});
assert.deepEqual(joinedBoth.unrouted, [], 'Matching joined spelling binds to its WHT issue.');

const joinedIssueHyphenatedConcept = await ownershipRun({
  id: 'joined issue / hyphenated concept', issueSubject: joinedSubject, queryText: joinedQuery, qualifier: 'non-resident company'
});
assert.deepEqual(joinedIssueHyphenatedConcept.unrouted, [],
  'The ownership match is symmetric across the equivalent spellings.');

const unrelatedMaterial = await ownershipRun({ id: 'unrelated material stays fail-closed', qualifier: 'deferred tax measurement' });
assert.deepEqual(unrelatedMaterial.unrouted, ['deferred tax measurement'],
  'An unrelated primary concept remains explicitly unrouted.');

const contextualQualifier = await ownershipRun({
  id: 'context-only does not become a requested concept', qualifier: 'nonresident company', role: 'CONTEXT_ONLY'
});
assert.equal(contextualQualifier.requested.some(item => item.label === 'nonresident company'), false);
assert.deepEqual(contextualQualifier.unrouted, []);

const residentSubject = baseSubject.replace('non-resident company', 'resident company');
const residentQuery = query.replace('non-resident company', 'resident company');
const residentIsNotNonresident = await ownershipRun({
  id: 'resident remains distinct from non-resident',
  issueSubject: residentSubject,
  queryText: residentQuery,
  qualifier: 'nonresident company'
});
assert.deepEqual(residentIsNotNonresident.unrouted, ['nonresident company'],
  'Normalization must not collapse ordinary resident into non-resident.');

assert.equal(providerCalls, 7, 'Every controlled replay uses only the injected in-memory empty provider.');
assert.equal(fetchAttempts, 0, 'No network fetch occurred.');
process.stdout.write('WHT topicless concept ownership regressions passed.\n');
