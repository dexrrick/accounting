import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { classifyQuestion } from '../../../src/classification/questionClassifier.ts';
import { irasResolverCases } from '../../fixtures/irasResolverCases.mjs';
import { IRAS_SOURCE_MAP_DEFINITIONS, getCoverageTopicsByIds } from '../../../src/standards/coverageRegistry.ts';
import { defaultQueryTopicResolver } from '../../../src/retrieval/queryTopicResolver.ts';
import { buildAuthorityWorkstreams, planAuthorityWorkstreams } from '../../../src/services/authorityWorkstreams.ts';
import { reconcileQuestionUnderstanding, validateSemanticQuestionInterpretation } from '../../../src/services/semanticQuestionUnderstanding.ts';
import { getAllAuthoritativeSources } from '../../../src/standards/unifiedSourceModel.ts';
import { matchesReviewedLocalRegistryRecord } from '../../../src/retrieval/evidenceQualityGate.ts';

const selectedCaseIds = [
  'target-relief-entitlement',
  'target-relief-amount',
  'A-paraphrase-2',
  'private-holiday-expense',
  'foreign-dividend-treatment',
  'company-residency-general',
  'wht-royalty-general-rule',
  'gst-input-tax-general-rule',
  'unsupported-sfrsi-6-exploration-evaluation'
];
const expectedIds = new Set(selectedCaseIds);
const caseById = new Map(irasResolverCases.filter(item => expectedIds.has(item.id)).map(item => [item.id, item]));
const cases = selectedCaseIds.map(id => caseById.get(id));
assert.ok(cases.every(Boolean), 'the no-API audit contains every case in the fixed v2 targeted profile');

function interpretationFor(testCase) {
  const single = testCase.issues.length === 1;
  const first = testCase.issues[0];
  const subjects = testCase.issues.map(issue => issue.subject);
  return {
    schemaVersion: 2,
    jurisdiction: ['Singapore'],
    authorityCandidates: single ? [first.authority] : ['UNKNOWN'],
    contextualAuthorities: [],
    domain: single ? first.domain : 'UNKNOWN',
    population: single ? first.population : 'UNKNOWN',
    primarySubject: subjects.join('; '),
    concepts: subjects.map((concept, index) => ({ concept, role: index === 0 ? 'PRIMARY' : 'RELATED' })),
    requestedOperation: single ? first.operation : 'OTHER',
    factsExplicitlyProvided: [],
    confidence: 0.96,
    issues: testCase.issues.map(issue => ({
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
}

const allRecords = getAllAuthoritativeSources();
const recordsById = new Map(allRecords.map(record => [record.id, record]));
const topicMaps = new Map();
for (const definition of IRAS_SOURCE_MAP_DEFINITIONS) {
  for (const topicId of definition.topicIds) {
    topicMaps.set(topicId, [...(topicMaps.get(topicId) || []), definition]);
  }
}

function sourceMapMetadata(topicId) {
  const definitions = topicMaps.get(topicId) || [];
  const pointers = definitions.map(definition => recordsById.get(definition.id)).filter(Boolean);
  const topic = getCoverageTopicsByIds([topicId])[0];
  const localRecords = allRecords.filter(record =>
    record.recordRole !== 'SOURCE_MAP_POINTER' && record.groundingEligible !== false &&
    record.provenance === 'LOCAL_STATIC' && record.sourceText?.trim() &&
    Boolean(topic && (topic.sourceRecordIds.includes(record.id) ||
      (record.tags || []).includes(topicId) || (record.relatedTopicIds || []).includes(topicId) ||
      (record.sourceMapTopicIds || []).includes(topicId) || (record.retrievalHints || []).includes(topicId))) &&
    matchesReviewedLocalRegistryRecord(record));
  return {
    sourceMapIds: definitions.map(item => item.id).sort(),
    sourceMapPointerCount: pointers.length,
    sourceMapPointersAreRoutingOnly: pointers.length > 0 && pointers.every(item =>
      item.recordRole === 'SOURCE_MAP_POINTER' && item.groundingEligible === false),
    sourceMapPointersBindTopic: pointers.length > 0 && pointers.every(item =>
      (item.sourceMapTopicIds || []).includes(topicId)),
    reviewedLocalEvidenceRecordCount: localRecords.length
  };
}

let networkAttempts = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  networkAttempts += 1;
  throw new Error('NETWORK_DISABLED_IN_IRAS_LOCAL_AUDIT');
};

const caseRows = [];
const irasIssueRows = [];
for (const testCase of cases) {
  const interpretation = interpretationFor(testCase);
  assert.ok(validateSemanticQuestionInterpretation(interpretation, testCase.query),
    `${testCase.id}: frozen synthetic issue contract validates`);
  const understanding = { mode: 'SEMANTIC_INTERPRETATION', interpretation };
  const classification = classifyQuestion(testCase.query);
  const reconciled = reconcileQuestionUnderstanding(testCase.query, classification, understanding);
  assert.equal(reconciled.issuePlan.source, 'SEMANTIC_ISSUES', `${testCase.id}: semantic issue plan is used`);
  const plannedWorkstreams = planAuthorityWorkstreams(reconciled.issuePlan);
  const queryCandidateIds = [...new Set(defaultQueryTopicResolver.decomposeQuery(testCase.query).topics.map(topic => topic.id))].sort();
  const runtime = await buildAuthorityWorkstreams(testCase.query, reconciled.issuePlan, {
    localOnly: true,
    questionUnderstanding: understanding,
    referenceDate: '2026-10-02'
  });
  const runtimeByIssueId = new Map(runtime.workstreams.flatMap(stream => stream.issues.map(issue => [issue.issueId, { issue, stream }])));
  const issueRows = [];

  for (let index = 0; index < testCase.issues.length; index += 1) {
    const expectedIssue = testCase.issues[index];
    const reconciledIssue = reconciled.issuePlan.issues[index];
    const isIras = expectedIssue.authority === 'IRAS';
    const subjectCandidateIds = [...new Set(defaultQueryTopicResolver.decomposeQuery(expectedIssue.subject).topics.map(topic => topic.id))].sort();
    const mappedTopicIds = reconciledIssue.mappedTopicIds.slice().sort();
    const topics = getCoverageTopicsByIds(mappedTopicIds);
    const expectedIrasTopics = topics.filter(topic => topic.domainId.startsWith('IRAS_') && !topic.routingOnly).map(topic => topic.id);
    const mappedSourcePaths = expectedIrasTopics.map(topicId => ({ topicId, ...sourceMapMetadata(topicId) }));
    const runtimeRow = runtimeByIssueId.get(reconciledIssue.id);

    if (isIras) {
      assert.equal(reconciledIssue.status, 'MAPPED', `${testCase.id}: IRAS issue maps to an existing topic`);
      assert.ok(mappedSourcePaths.length > 0, `${testCase.id}: mapped IRAS topic has a registered source map`);
      assert.ok(mappedSourcePaths.every(path => path.sourceMapIds.length > 0 && path.sourceMapPointersAreRoutingOnly && path.sourceMapPointersBindTopic),
        `${testCase.id}: IRAS source-map pointers exist and remain routing-only`);
      assert.ok(plannedWorkstreams.some(stream => stream.authority === 'IRAS'), `${testCase.id}: IRAS provider route is planned`);
      assert.ok(runtimeRow, `${testCase.id}: an IRAS runtime issue is present`);
      assert.equal(runtimeRow.stream.authority, 'IRAS');
      assert.equal(runtimeRow.issue.lifecycle.retrievalAttempted, true,
        `${testCase.id}: the local IRAS provider path was reached`);
      irasIssueRows.push({
        caseId: testCase.id,
        issueIndex: index,
        semanticInput: 'SYNTHETIC_REPRESENTATIVE_FROM_FROZEN_CASE_CONTRACT',
        domain: expectedIssue.domain,
        population: expectedIssue.population,
        operation: expectedIssue.operation,
        queryCandidateTopicIds: queryCandidateIds,
        subjectCandidateTopicIds: subjectCandidateIds,
        filteredIntersectionTopicIds: mappedTopicIds,
        mappedSourcePaths,
        providerPath: {
          routePresent: true,
          retrievalAttempted: runtimeRow.issue.lifecycle.retrievalAttempted,
          candidateFound: runtimeRow.issue.lifecycle.evidenceFound,
          admittedAny: runtimeRow.issue.lifecycle.admitted,
          verified: runtimeRow.issue.lifecycle.verified,
          covered: runtimeRow.issue.lifecycle.covered,
          evidenceStatus: runtimeRow.issue.evidenceStatus,
          verifiedRuleClaimCount: runtimeRow.issue.verifiedClaims.length,
          verifiedSourceCount: runtimeRow.issue.sources.length,
          applicationStatus: runtimeRow.issue.applicationStatus,
          retrievalStages: (runtimeRow.issue.retrievalTrace?.stages || []).map(stage => ({ stage: stage.stage, status: stage.status })),
          gapCodes: [...new Set(runtimeRow.issue.gaps.map(gap => gap.code))].sort()
        }
      });
    } else {
      assert.ok(!mappedTopicIds.some(topicId => topicId.startsWith('iras-')),
        `${testCase.id}: non-IRAS issue has no IRAS topic`);
      if (!testCase.issues.some(issue => issue.authority === 'IRAS')) {
        assert.ok(!plannedWorkstreams.some(stream => stream.authority === 'IRAS'),
          `${testCase.id}: non-IRAS-only case has no IRAS provider route`);
      }
    }

    issueRows.push({
      issueIndex: index,
      authority: expectedIssue.authority,
      domain: expectedIssue.domain,
      population: expectedIssue.population,
      operation: expectedIssue.operation,
      mappedTopicIds,
      sourceMappedTopicCount: topics.filter(topic => topic.domainId.startsWith('IRAS_') && !topic.routingOnly &&
        (topicMaps.get(topic.id) || []).length > 0).length
    });
  }
  caseRows.push({ caseId: testCase.id, issueCount: issueRows.length, issues: issueRows });
}

globalThis.fetch = originalFetch;

const summary = {
  selectedCaseCount: cases.length,
  selectedIrasIssueCount: irasIssueRows.length,
  mappedIrasIssueCount: irasIssueRows.filter(row => row.filteredIntersectionTopicIds.some(id => id.startsWith('iras-'))).length,
  sourceMappedTopicCount: irasIssueRows.reduce((count, row) => count + row.mappedSourcePaths.length, 0),
  sourceMappedIrasIssueCount: irasIssueRows.filter(row => row.mappedSourcePaths.length > 0).length,
  localProviderAttempts: irasIssueRows.filter(row => row.providerPath.retrievalAttempted).length,
  candidateFoundIssues: irasIssueRows.filter(row => row.providerPath.candidateFound).length,
  issuesWithAnyAdmission: irasIssueRows.filter(row => row.providerPath.admittedAny).length,
  issuesWithVerifiedRule: irasIssueRows.filter(row => row.providerPath.verifiedRuleClaimCount > 0).length,
  unresolvedApplications: irasIssueRows.filter(row => row.providerPath.applicationStatus === 'UNRESOLVED').length,
  networkAttempts,
  modelRequests: 0,
  auditScope: 'LOCAL_ONLY_NO_API_NO_OFFICIAL_PAGE_FETCH'
};
const report = {
  schemaVersion: 1,
  purpose: 'No-API source-path diagnostic. Semantic subjects are synthetic representative inputs from frozen case contracts; historical live artifacts did not retain raw model issue subjects. Source-map pointers route retrieval and are never answer evidence.',
  summary,
  cases: caseRows,
  irasIssues: irasIssueRows
};

if (process.argv[2]) await writeFile(process.argv[2], `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
assert.equal(summary.selectedCaseCount, selectedCaseIds.length);
assert.equal(summary.localProviderAttempts, summary.selectedIrasIssueCount);
assert.equal(summary.sourceMappedIrasIssueCount, summary.selectedIrasIssueCount);
assert.equal(summary.networkAttempts, 0);
assert.equal(summary.modelRequests, 0);
