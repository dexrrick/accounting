import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { defaultAdvancedSourceRetriever } from '../../src/retrieval/advancedSourceRetriever.ts';
import { getCoverageTopicsByIds } from '../../src/standards/coverageRegistry.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import {
  reconcileQuestionUnderstanding,
  validateSemanticQuestionInterpretation
} from '../../src/services/semanticQuestionUnderstanding.ts';
import { verifyEvidenceClaims } from '../../src/verification/claimEvidenceVerifier.ts';
import { irasResolverCases } from '../fixtures/irasResolverCases.mjs';

const referenceDate = '2026-10-02';
const privateCase = irasResolverCases.find(candidate => candidate.id === 'private-holiday-expense');
assert.ok(privateCase, 'The frozen private-expense case is available.');
const sourceIssue = privateCase.issues[0];
const fixtureData = JSON.parse(await readFile(new URL(
  '../../docs/evaluation/multi-authority-workstreams/iras-first-local-2026-10-02-v4/local-evidence-fixtures.json', import.meta.url), 'utf8'));
const baseText = fixtureData.cases['private-deductibility-general'].passage;
const quote = baseText;
const attachedQualification = 'However, deductibility depends on the applicable statutory conditions and supporting records.';
const pageHash = 'a'.repeat(64);
const alternatePageHash = 'b'.repeat(64);

const interpretation = {
  schemaVersion: 2,
  jurisdiction: ['Singapore'],
  authorityCandidates: ['IRAS'],
  contextualAuthorities: [],
  domain: sourceIssue.domain,
  population: sourceIssue.population,
  primarySubject: sourceIssue.subject,
  concepts: [{ concept: sourceIssue.subject, role: 'PRIMARY' }],
  requestedOperation: sourceIssue.operation,
  factsExplicitlyProvided: [],
  confidence: 0.96,
  issues: privateCase.issues.map(issue => ({
    subject: issue.subject,
    population: issue.population,
    domain: issue.domain,
    governingAuthorities: [issue.authority],
    contextualAuthorities: [],
    operation: issue.operation,
    mappedTopicIds: [],
    evidenceRequirement: issue.facts ? 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS' : 'AUTHORITATIVE_SOURCE',
    confidence: 0.96
  }))
};
assert.ok(validateSemanticQuestionInterpretation(interpretation, privateCase.query));
const understanding = { mode: 'SEMANTIC_INTERPRETATION', interpretation };
const reconciled = reconcileQuestionUnderstanding(
  privateCase.query,
  classifyQuestion(privateCase.query),
  understanding
);
const frozenIssue = reconciled.issuePlan.issues.find(issue => issue.governingAuthorities.includes('IRAS'));
assert.ok(frozenIssue, 'The frozen private-expense question resolves to an IRAS issue.');
const topicIds = frozenIssue.mappedTopicIds;
const privateTopics = getCoverageTopicsByIds(topicIds).filter(topic =>
  ['iras-cit-deductibility', 'iras-cit-disallowed-expenses'].includes(topic.id));
assert.deepEqual(new Set(privateTopics.map(topic => topic.id)), new Set([
  'iras-cit-deductibility', 'iras-cit-disallowed-expenses'
]));
const pointer = defaultAdvancedSourceRetriever.getSourceById('IRAS_CIT_EXPENSES_SOURCE_MAP');
assert.ok(pointer?.officialSourceUrl, 'The shared expense source-map URL is registered.');

function makeLiveRecord(topic, id, sourceText, options = {}) {
  const officialSourceUrl = options.officialSourceUrl || pointer.officialSourceUrl;
  const domain = options.domain || topic.legacyDomains[0];
  const documentHash = options.documentHash || pageHash;
  const contentHash = options.contentHash || documentHash;
  return {
    id,
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
    sourcePublisher: 'Inland Revenue Authority of Singapore (IRAS)',
    legalOrStandardInstrument: topic.actOrStandard || topic.title,
    documentTitle: topic.title,
    standardOrActCode: topic.actOrStandard || topic.title,
    paragraphOrSection: topic.title,
    sourceText,
    principleSummary: topic.title,
    officialSourceUrl,
    canonicalSourceUrl: options.canonicalSourceUrl || officialSourceUrl,
    domain,
    jurisdiction: 'Singapore',
    tags: [topic.id],
    relatedTopicIds: [],
    sourceMapTopicIds: [],
    sourceStatus: 'NEEDS_REVIEW',
    sourceType: 'OFFICIAL_GUIDANCE',
    evidenceTier: 'OFFICIAL_GUIDANCE',
    isVerbatimText: false,
    lastVerifiedDate: referenceDate,
    provenance: options.provenance || 'LIVE_EXTERNAL',
    sourceAuthority: options.sourceAuthority || 'IRAS',
    retrievedAt: `${referenceDate}T10:00:00.000Z`,
    verificationMethod: 'LIVE_OFFICIAL_TOPIC_VERIFIED',
    documentHash,
    contentHash,
    lifecycleState: 'CANDIDATE',
    recordRole: 'DISCOVERED_EVIDENCE',
    groundingEligible: true,
    urlVerificationStatus: 'VERIFIED',
    urlVerifiedDate: referenceDate
  };
}

async function runScenario({
  name,
  originalText = baseText,
  siblingText = baseText,
  originalHash = pageHash,
  siblingDocumentHash = pageHash,
  siblingContentHash = siblingDocumentHash,
  siblingDomain,
  siblingUrl,
  claimQuote = quote
}) {
  const originalTopic = privateTopics.find(topic => topic.id === 'iras-cit-disallowed-expenses');
  const siblingTopic = privateTopics.find(topic => topic.id === 'iras-cit-deductibility');
  const originalId = `synthetic-live-private-original-${name}`;
  const siblingId = `synthetic-live-private-sibling-${name}`;
  const records = [
    makeLiveRecord(originalTopic, originalId, originalText, { documentHash: originalHash }),
    makeLiveRecord(siblingTopic, siblingId, siblingText, {
      documentHash: siblingDocumentHash,
      contentHash: siblingContentHash,
      ...(siblingDomain ? { domain: siblingDomain } : {}),
      ...(siblingUrl ? { officialSourceUrl: siblingUrl, canonicalSourceUrl: siblingUrl } : {})
    })
  ];
  const provider = {
    authority: 'IRAS',
    async retrieve() {
      return {
        candidates: records,
        claims: [{ kind: 'RULE', text: claimQuote, quote: claimQuote, recordId: originalId }],
        evidenceQualityTrace: {
          selectedRecordIds: records.map(record => record.id),
          finalVerifiedUrls: [...new Set(records.map(record => record.canonicalSourceUrl))],
          attempts: records.map(record => ({
            topicId: record.tags[0],
            fetchStatus: 'SUCCESS',
            finalUrl: record.canonicalSourceUrl,
            titleMatched: true,
            contentMatched: true
          }))
        }
      };
    }
  };
  const result = await buildAuthorityWorkstreams(privateCase.query, reconciled.issuePlan, {
    questionUnderstanding: understanding,
    referenceDate,
    localOnly: true,
    providers: { IRAS: provider }
  });
  const issue = result.workstreams.flatMap(workstream => workstream.issues)
    .find(candidate => candidate.issueId === frozenIssue.id);
  assert.ok(issue, `${name} returns the frozen private-expense issue.`);
  return { issue, originalId, siblingId, records };
}

const positive = await runScenario({ name: 'positive' });
assert.equal(positive.issue.evidenceStatus, 'VERIFIED', 'An accepted quote binds to both admitted same-page topic records.');
assert.deepEqual(new Set(positive.issue.verifiedClaims.map(claim => claim.recordId)), new Set([
  positive.originalId, positive.siblingId
]));
assert.equal(new Set(positive.issue.verifiedClaims.map(claim => claim.quote)).size, 1,
  'The sibling binding supports the same exact quotation instead of adding independent text.');
assert.equal(positive.issue.verifiedClaims.every(claim => claim.quote === quote && claim.text === quote), true,
  'Every binding preserves the original verified quote and text unchanged.');
assert.equal(positive.issue.sources.length, 2, 'Only records bound to the accepted quote are returned as sources.');

const rejectedOriginal = await runScenario({
  name: 'rejected-original',
  originalText: `${baseText}\n\n${attachedQualification}`,
  siblingText: baseText
});
assert.equal(verifyEvidenceClaims([{
  kind: 'RULE', text: quote, quote, recordId: rejectedOriginal.originalId
}], rejectedOriginal.records, { missingFacts: [], targetDate: undefined }).accepted.length, 0,
'The supplied original quote omits its attached qualification.');
assert.equal(rejectedOriginal.issue.lifecycle.verified, false,
  'A shorter sibling record cannot rescue an original quotation rejected for an omitted qualification.');
assert.equal(rejectedOriginal.issue.verifiedClaims.length, 0);

const mismatchedHash = await runScenario({ name: 'mismatched-hash', siblingDocumentHash: alternatePageHash });
assert.equal(mismatchedHash.issue.lifecycle.covered, false, 'A sibling with a different document hash is not rebound.');
assert.deepEqual(mismatchedHash.issue.verifiedClaims.map(claim => claim.recordId), [mismatchedHash.originalId]);

const mismatchedDomain = await runScenario({ name: 'mismatched-domain', siblingDomain: 'IRAS_GST' });
assert.equal(mismatchedDomain.issue.lifecycle.covered, false, 'A sibling from another source domain is not rebound.');
assert.deepEqual(mismatchedDomain.issue.verifiedClaims.map(claim => claim.recordId), [mismatchedDomain.originalId]);

const absentSiblingQuote = await runScenario({
  name: 'absent-sibling-quote',
  siblingText: baseText.replace('. The corporate', '. Unrelated guidance follows. The corporate')
});
assert.equal(absentSiblingQuote.issue.lifecycle.covered, false, 'The sibling must independently contain the exact accepted quote.');
assert.deepEqual(absentSiblingQuote.issue.verifiedClaims.map(claim => claim.recordId), [absentSiblingQuote.originalId]);

const attachedSiblingQualification = await runScenario({
  name: 'attached-sibling-qualification',
  siblingText: `${baseText}\n\n${attachedQualification}`
});
assert.equal(attachedSiblingQualification.issue.lifecycle.covered, false,
  'The unchanged verifier rejects a rebound quote that omits a sibling-attached qualification.');
assert.deepEqual(attachedSiblingQualification.issue.verifiedClaims.map(claim => claim.recordId), [attachedSiblingQualification.originalId]);

console.log('IRAS shared-page claim-binding regressions passed.');
