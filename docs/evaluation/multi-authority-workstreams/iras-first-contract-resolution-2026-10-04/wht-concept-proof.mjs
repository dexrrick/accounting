import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { classifyQuestion } from '../../../../src/classification/questionClassifier.ts';
import { defaultAdvancedSourceRetriever } from '../../../../src/retrieval/advancedSourceRetriever.ts';
import { evaluateEvidenceQuality } from '../../../../src/retrieval/evidenceQualityGate.ts';
import { supportGeneralIrasRuleConcept } from '../../../../src/retrieval/irasRuleConceptSupport.ts';
import { IRAS_SOURCE_MAP_DEFINITIONS } from '../../../../src/standards/coverageRegistry.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../../../src/standards/unifiedSourceModel.ts';
import { buildAuthorityWorkstreams } from '../../../../src/services/authorityWorkstreams.ts';
import {
  getRequestedQuestionConcepts,
  reconcileQuestionUnderstanding,
  validateSemanticQuestionInterpretation
} from '../../../../src/services/semanticQuestionUnderstanding.ts';
import { verifyEvidenceClaims } from '../../../../src/verification/claimEvidenceVerifier.ts';
import { irasResolverCases } from '../../../../tests/fixtures/irasResolverCases.mjs';

const here = new URL('.', import.meta.url);
const readJson = async relativePath => JSON.parse(await readFile(new URL(relativePath, here), 'utf8'));
const digest = value => createHash('sha256').update(value).digest('hex');
const compactCounts = counts => Object.fromEntries(Object.entries(counts).filter(([, value]) => value !== 0));

// Keep this audit strictly local. Any accidental provider/network attempt fails the run.
let fetchAttempts = 0;
globalThis.fetch = async () => {
  fetchAttempts += 1;
  throw new Error('WHT concept proof forbids network access');
};

const caseFixture = irasResolverCases.find(item => item.id === 'wht-royalty-general-rule');
assert.ok(caseFixture, 'The frozen WHT fixture exists');
const fixtureIssue = caseFixture.issues[0];
const fixtureTopics = ['iras-withholding-tax', 'iras-withholding-tax-interest-royalties'];
const v3 = await readJson('../iras-first-targeted-acceptance-2026-10-03-v3/acceptance-v3.json');
const v3Case = v3.cases.find(item => item.caseId === caseFixture.id);
assert.ok(v3Case, 'The correct targeted-acceptance V3 WHT row exists');
const v3Diagnostic = v3Case.routing.runtimeIssueScopeDiagnostics[0];
const v3RawConceptLabel = null;

function makeUnderstanding({ query, subject, extraConcept, extraRole = 'PRIMARY' }) {
  const concepts = [{ concept: subject, role: 'PRIMARY' }];
  if (extraConcept) concepts.push({ concept: extraConcept, role: extraRole });
  const interpretation = {
    schemaVersion: 2,
    jurisdiction: ['Singapore'],
    authorityCandidates: ['IRAS'],
    contextualAuthorities: [],
    domain: fixtureIssue.domain,
    population: fixtureIssue.population,
    primarySubject: subject,
    concepts,
    requestedOperation: fixtureIssue.operation,
    factsExplicitlyProvided: [],
    confidence: 0.96,
    issues: [{
      subject,
      population: fixtureIssue.population,
      domain: fixtureIssue.domain,
      governingAuthorities: ['IRAS'],
      contextualAuthorities: [],
      operation: fixtureIssue.operation,
      mappedTopicIds: [],
      evidenceRequirement: 'AUTHORITATIVE_SOURCE',
      confidence: 0.96
    }]
  };
  assert.ok(validateSemanticQuestionInterpretation(interpretation, query), `Validated equivalent mock: ${extraConcept || 'base'}`);
  return { mode: 'SEMANTIC_INTERPRETATION', interpretation };
}

async function runMock({ id, query = caseFixture.query, subject = fixtureIssue.subject, extraConcept, extraRole = 'PRIMARY' }) {
  const understanding = makeUnderstanding({ query, subject, extraConcept, extraRole });
  const reconciliation = reconcileQuestionUnderstanding(query, classifyQuestion(query), understanding);
  const concepts = getRequestedQuestionConcepts(query, understanding);
  const result = await buildAuthorityWorkstreams(query, reconciliation.issuePlan, {
    localOnly: true,
    referenceDate: '2026-10-02',
    questionUnderstanding: understanding
  });
  const issue = result.workstreams.flatMap(workstream => workstream.issues)[0];
  const plannedIssue = reconciliation.issuePlan.issues.find(item => item.subject === subject);
  assert.ok(issue, `The local-only pipeline returns its WHT issue: ${id}`);
  assert.ok(plannedIssue, `The validated interpretation plans the WHT issue: ${id}`);
  const unrouted = result.gaps.filter(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT');
  return {
    id,
    queryOrthography: query.includes('nonresident company') ? 'nonresident' : 'non-resident',
    issueSubjectOrthography: subject.includes('nonresident company') ? 'nonresident' : 'non-resident',
    concepts: concepts.map(concept => ({ id: concept.id, label: concept.label, topicIds: concept.topicIds })),
    issueMappedTopicIds: [...plannedIssue.mappedTopicIds].sort(),
    issueEvidenceStatus: issue.evidenceStatus,
    issueVerifiedClaimCount: issue.verifiedClaims.length,
    issueGapCodes: [...new Set(issue.gaps.map(gap => gap.code))].sort(),
    unroutedConceptCount: unrouted.length,
    unroutedMockLabels: unrouted.map(gap => gap.subject),
    fetchAttempts
  };
}

const subjectHyphenated = fixtureIssue.subject;
const subjectUnhyphenated = subjectHyphenated.replace('non-resident', 'nonresident');
const queryUnhyphenated = caseFixture.query.replace('non-resident', 'nonresident');
const mockResults = [];
mockResults.push(await runMock({ id: 'base-full-subject' }));
mockResults.push(await runMock({
  id: 'topicless-primary-qualifier-hyphen-matches-hyphenated-issue',
  extraConcept: 'non-resident company'
}));
mockResults.push(await runMock({
  id: 'topicless-primary-qualifier-unhyphenated-vs-hyphenated-issue',
  extraConcept: 'nonresident company'
}));
mockResults.push(await runMock({
  id: 'topicless-context-only-qualifier',
  extraConcept: 'nonresident company',
  extraRole: 'CONTEXT_ONLY'
}));
mockResults.push(await runMock({
  id: 'unrelated-primary-material-control',
  extraConcept: 'deferred tax measurement'
}));
mockResults.push(await runMock({
  id: 'unhyphenated-issue-and-concept',
  query: queryUnhyphenated,
  subject: subjectUnhyphenated,
  extraConcept: 'nonresident company'
}));
mockResults.push(await runMock({
  id: 'unhyphenated-issue-hyphenated-concept',
  query: queryUnhyphenated,
  subject: subjectUnhyphenated,
  extraConcept: 'non-resident company'
}));

assert.deepEqual(mockResults[0].issueMappedTopicIds, [...fixtureTopics].sort());
assert.equal(mockResults[1].unroutedConceptCount, 0, 'Hyphenated topicless qualifier binds to the existing IRAS income-tax issue');
assert.equal(mockResults[2].unroutedConceptCount, 1, 'Orthographically equivalent unhyphenated qualifier is not owned by the issue');
assert.equal(mockResults[3].concepts.some(concept => concept.label === 'nonresident company'), false,
  'A CONTEXT_ONLY qualifier is not promoted into requested material concepts');
assert.equal(mockResults[3].unroutedConceptCount, 0);
assert.equal(mockResults[4].unroutedConceptCount, 1, 'An unrelated material concept remains explicitly unrouted');
assert.equal(mockResults[5].unroutedConceptCount, 0, 'Matching unhyphenated spelling on both sides binds');
assert.equal(mockResults[6].unroutedConceptCount, 1, 'Mixed spelling still fails ownership in the reverse direction');

const registryRecordIds = ['ITA_SEC45A_WITHHOLDING_TAX_ROYALTIES', 'ITA_SEC45_WITHHOLDING_TAX'];
const records = registryRecordIds.map(id => {
  const record = defaultAdvancedSourceRetriever.getSourceById(id) || UNIFIED_SOURCE_REGISTRY[id];
  assert.ok(record?.sourceText, `Reviewed local static WHT record is available: ${id}`);
  return record;
});
const baseUnderstanding = makeUnderstanding({ query: caseFixture.query, subject: fixtureIssue.subject });
const baseConcepts = getRequestedQuestionConcepts(caseFixture.query, baseUnderstanding);
const targetDate = '2026-10-02';
const quality = evaluateEvidenceQuality({
  query: caseFixture.query,
  topicIds: fixtureTopics,
  records,
  missingFacts: [],
  targetDate,
  referenceDate: targetDate,
  domain: 'INCOME_TAX',
  authorities: ['IRAS'],
  requestedConcepts: baseConcepts
});
const literalClaims = quality.eligibleRecords.map(record => ({
  kind: 'RULE', text: record.sourceText, quote: record.sourceText, recordId: record.id
}));
const literalVerification = verifyEvidenceClaims(literalClaims, quality.eligibleRecords, { missingFacts: [], targetDate });
const staticRuleResults = quality.eligibleRecords.map(record => ({
  recordId: record.id,
  literalQuoteAccepted: literalVerification.accepted.some(claim => claim.recordId === record.id),
  generalRuleSupport: supportGeneralIrasRuleConcept({
    sourceText: record.sourceText,
    domainId: 'IRAS_CORPORATE_TAX',
    topicIds: fixtureTopics,
    subject: fixtureIssue.subject,
    population: 'COMPANY',
    concepts: baseConcepts
  })
}));
assert.equal(quality.eligibleRecords.length, 2, 'Both reviewed WHT source records are admitted in the API-free local check');
assert.equal(literalVerification.accepted.length, 2, 'Both complete local source-text quotations pass literal verification');
assert.ok(staticRuleResults.every(item => item.generalRuleSupport === false),
  'Neither local source text states the complete requested general royalty rule');

const publicExcerptReport = await readJson('../iras-public-excerpts-2026-10-03-v1/iras-public-rule-excerpts-report-v1.json');
const whtMap = publicExcerptReport.results.find(item => item.mapId === 'IRAS_WHT_OVERVIEW_SOURCE_MAP');
const whtExcerpt = whtMap?.excerpts.find(item => item.blockIndex === 10);
assert.ok(whtExcerpt && !whtExcerpt.truncated, 'Saved public WHT overview rule fixture is complete');
const ruleTopics = IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === 'IRAS_WHT_OVERVIEW_SOURCE_MAP').topicIds;
const supportFor = ({ sourceText, subject = fixtureIssue.subject, label = fixtureIssue.subject }) => supportGeneralIrasRuleConcept({
  sourceText,
  domainId: 'IRAS_CORPORATE_TAX',
  topicIds: ruleTopics,
  subject,
  population: 'COMPANY',
  concepts: [{ label, terms: [label] }]
});
const orthographicRuleSupport = [
  { id: 'hyphenated-subject-and-concept', subject: subjectHyphenated, label: subjectHyphenated },
  { id: 'unhyphenated-subject-and-concept', subject: subjectUnhyphenated, label: subjectUnhyphenated },
  { id: 'hyphenated-subject-unhyphenated-concept', subject: subjectHyphenated, label: 'nonresident company' },
  { id: 'unhyphenated-subject-hyphenated-concept', subject: subjectUnhyphenated, label: 'non-resident company' }
].map(item => ({ ...item, support: supportFor({ sourceText: whtExcerpt.text, ...item }) ?? null }));
assert.equal(orthographicRuleSupport[0].support, true, 'The saved complete rule supports the matching hyphenated request');
assert.notEqual(orthographicRuleSupport[1].support, true,
  'Changing only non-resident spelling prevents a false positive; this is a normalization gap, not missing source evidence');
assert.equal(supportFor({
  sourceText: whtExcerpt.text.replace('to a non-resident company or individual', 'to a company or individual')
}), false, 'Removing the source non-resident qualification still fails the strict rule control');

const V3_COUNTS = {
  admittedRecordCount: v3Diagnostic.admittedRecordCount,
  verifiedClaimCount: v3Diagnostic.verifiedClaimCount,
  lifecycleCoveredCount: v3Diagnostic.lifecycleCounts.covered,
  issueConceptUncovered: v3Diagnostic.gapCounts.ISSUE_CONCEPT_UNCOVERED,
  unroutedMaterialConcept: v3Diagnostic.gapCounts.UNROUTED_MATERIAL_CONCEPT
};
assert.deepEqual(V3_COUNTS, {
  admittedRecordCount: 2,
  verifiedClaimCount: 2,
  lifecycleCoveredCount: 0,
  issueConceptUncovered: 1,
  unroutedMaterialConcept: 1
});

const proof = {
  schemaVersion: 1,
  generatedAt: '2026-10-04',
  profile: 'wht-requested-concept-ownership-api-free-proof',
  execution: {
    localOnly: true,
    networkFetchAttempts: fetchAttempts,
    providerCalls: 0,
    mutatedFrozenArtifacts: false,
    productionFilesChanged: false
  },
  frozenTargetV3: {
    artifact: 'iras-first-targeted-acceptance-2026-10-03-v3/acceptance-v3.json',
    artifactSha256: digest(await readFile(new URL('../iras-first-targeted-acceptance-2026-10-03-v3/acceptance-v3.json', here))),
    caseId: caseFixture.id,
    semanticInterpretationValid: v3Case.validInterpretation,
    matchedIssueCount: v3Case.scoring.matchedIssueCount,
    mappedTopicIds: fixtureTopics,
    counts: V3_COUNTS,
    issueUncoveredGapSubtypeRecoverable: false,
    exactCapturedConceptLabelRecoverable: false,
    exactCapturedConceptLabel: v3RawConceptLabel,
    limitation: 'The frozen artifact retains bounded counts and not the raw semantic subject/concept labels or response text. No historical label is inferred.'
  },
  mockRequestedConcepts: mockResults,
  localOnlyStaticWhtEvidence: {
    candidateIds: registryRecordIds,
    admittedIds: quality.eligibleRecords.map(record => record.id),
    uncoveredConceptCount: quality.uncoveredConcepts?.length ?? null,
    literalAcceptedClaimCount: literalVerification.accepted.length,
    ruleSupport: staticRuleResults,
    centralProductionPathVerifiedClaimCount: mockResults[0].issueVerifiedClaimCount,
    sourceTextDiagnosis: [
      'ITA_SEC45_WITHHOLDING_TAX is about interest, loan charges and indebtedness; it does not state a royalty withholding rule.',
      'ITA_SEC45A_WITHHOLDING_TAX_ROYALTIES says treatment depends on rights/services, service location, residence, treaty position and payment date; it does not directly state the complete requested royalty-to-nonresident withholding obligation.',
      'The bounded rule gate requires one statement to link royalties, the non-resident payee and an affirmative withholding-tax rule (or an explicit payer/payment/example/payee/obligation chain).'
    ],
    inference: 'Literal quotation validity does not establish the complete requested royalty rule. The two local texts do not state the scoped general rule, so the production post-filter and issue coverage correctly stay insufficient.'
  },
  completeRuleSufficiencyControl: {
    fixture: 'saved public IRAS_WHT_OVERVIEW_SOURCE_MAP block 10; same complete-rule assertion exercised by test_iras_public_rule_forms.mjs',
    excerptSha256: digest(whtExcerpt.text),
    blockTruncated: whtExcerpt.truncated,
    hyphenatedRequestSupport: orthographicRuleSupport[0].support,
    orthographicVariants: orthographicRuleSupport,
    sourceQualifierRemovalSupport: supportFor({
      sourceText: whtExcerpt.text.replace('to a non-resident company or individual', 'to a company or individual')
    }),
    v9HistoricalReference: {
      profile: 'iras-first-live-2026-10-03-v9',
      whtVerifiedClaimCount: 2,
      usedAsTextReplay: false,
      note: 'V9 counts are retained observations; this proof does not reconstruct or replay captured V9 quotes.'
    }
  },
  classification: {
    exactHistoricalV3UnroutedLabel: 'UNRECOVERABLE_FROM_FROZEN_ARTIFACT',
    reproducibleEquivalentMockUncoveredConcept: 'nonresident company',
    demonstratedOwnershipDefect: 'The owning helper tokenizes non-resident as [non, resident] but nonresident as [nonresident], so mixed orthographies do not intersect. Matching orthography binds; unrelated primary material stays explicitly unrouted; CONTEXT_ONLY is not requested material.',
    proposedOwningLayer: 'Normalize nonresident and non-resident to a shared token form in semantic concept ownership and bounded IRAS rule concept matching. Retain the source-text rule gate: it must still require explicit non-resident recipient evidence and the same bounded royalty/payment/withholding relation.',
    implementationStatus: 'DIAGNOSTIC_ONLY_NO_PRODUCTION_CHANGE'
  }
};

assert.equal(fetchAttempts, 0, 'No network fetch occurred');
const outputPath = fileURLToPath(new URL('./wht-concept-proof-data.json', here));
// The retained pre-fix observation is immutable: a second execution must fail rather than replace it.
await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
process.stdout.write(`${JSON.stringify({ outputPath, mockCount: mockResults.length, fetchAttempts, v3Counts: V3_COUNTS })}\n`);
