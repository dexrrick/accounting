import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyQuestion } from '../../../src/classification/questionClassifier.ts';
import {
  interpretSemanticQuestion,
  reconcileQuestionUnderstanding,
  sanitizeSemanticDiagnosticLabel
} from '../../../src/services/semanticQuestionUnderstanding.ts';
import { planAuthorityWorkstreams, buildAuthorityWorkstreams } from '../../../src/services/authorityWorkstreams.ts';
import {
  createAuthorityEvidencePresentation,
  hasCurrentAuthorityEvidencePresentation
} from '../../../src/utils/authorityEvidencePresentation.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixturePath = path.join(root, 'tests/evaluation/singapore/multi-authority-workstreams.json');
const outputDirectory = path.join(root, 'docs/evaluation/multi-authority-workstreams');
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const liveSources = process.argv.includes('--live-sources');
const requestedCase = process.argv.find(argument => argument.startsWith('--case='))?.slice(7);
if (process.argv.includes('--live')) {
  throw new Error('This evaluation measures live source retrieval only; use --live-sources. No model call was made.');
}
if (liveSources && !requestedCase) {
  throw new Error('Live source mode requires --case=A for one bounded synthetic probe.');
}
const selectedCases = fixture.cases.filter(testCase => !requestedCase ||
  testCase.id === requestedCase || testCase.id.startsWith(`${requestedCase}-`));
if (!selectedCases.length) throw new Error(`Unknown evaluation case '${requestedCase}'.`);

const expectedMappedTopicIds = {
  A: [['cpf_contribution_rates'], ['cpf_contribution_rates'], ['iras-individual-cpf-relief']],
  B: [[], [], ['cpf_contribution_rates'], []],
  C: [[], []],
  D: [[], []]
};

function caseLetter(testCase) {
  return testCase.id[0];
}

function sanitized(value) {
  return typeof value === 'string' ? sanitizeSemanticDiagnosticLabel(value) : value;
}

function scopeKey(scope) {
  return `${scope.authority}/${scope.domain}`;
}

function plannedStreams(plan) {
  return Array.isArray(plan) ? plan : (plan?.workstreams || []);
}

function assertExpectedScopes(actualStreams, expectedScopes, caseId, label) {
  const actualKeys = actualStreams.map(scopeKey);
  const expectedKeys = expectedScopes.map(scopeKey);
  for (const expected of expectedKeys) {
    assert.ok(actualKeys.includes(expected), `${caseId}: ${label} is missing expected scope ${expected}.`);
  }
  const extra = actualStreams.filter(stream => !expectedKeys.includes(scopeKey(stream)));
  for (const stream of extra) {
    const issues = stream.issues || [];
    const isUnassignedResidual = stream.authority === 'UNKNOWN' || stream.domain === 'UNKNOWN' ||
      (issues.length > 0 && issues.every(issue => issue.status === 'UNRESOLVED' ||
        issue.unresolvedReason === 'UNASSIGNED_QUERY_TOPIC'));
    assert.ok(isUnassignedResidual,
      `${caseId}: ${label} added non-residual scope ${scopeKey(stream)} outside the expected oracle workstreams.`);
  }
}

function sourceAuthority(source) {
  const authority = source.authority;
  return typeof authority === 'string' ? authority : 'UNKNOWN';
}

function sourcePublisherAuthority(source) {
  const authority = source.sourceAuthority;
  return typeof authority === 'string' ? authority : 'UNSPECIFIED';
}

function sourceBelongsToWorkstream(source, stream) {
  const actual = sourceAuthority(source);
  if (actual === stream.authority) return true;
  // ACRA is the local publisher for SFRS(I) records, while governance belongs
  // to the accounting-standards workstream. This exception is domain-limited.
  return stream.authority === 'ACCOUNTING_STANDARDS' && actual === 'ACRA' &&
    source.domain === 'ACCOUNTING_SFRS';
}

function summarizeSource(source) {
  return {
    id: source.id,
    authority: sourceAuthority(source),
    sourceAuthority: sourcePublisherAuthority(source),
    publisher: sanitized(source.sourcePublisher),
    title: sanitized(source.documentTitle),
    instrument: sanitized(source.legalOrStandardInstrument),
    domain: source.domain,
    url: source.officialSourceUrl,
    recordRole: source.recordRole || 'EVIDENCE',
    provenance: source.provenance
  };
}

function summarizeStream(stream) {
  const coveredConcepts = stream.issues.filter(issue => issue.lifecycle.covered && issue.lifecycle.verified)
    .map(issue => sanitized(issue.subject));
  const uncoveredConcepts = stream.issues.filter(issue => !(issue.lifecycle.covered && issue.lifecycle.verified))
    .map(issue => sanitized(issue.subject));
  return {
    authority: stream.authority,
    domain: stream.domain,
    sourceSections: stream.sourceSections,
    populations: stream.populations,
    issueIds: stream.issues.map(issue => issue.issueId),
    issueRetrieval: stream.issues.map(issue => ({
      issueId: issue.issueId,
      lifecycle: issue.lifecycle,
      retrievalTrace: issue.retrievalTrace
    })),
    acceptedOfficialSources: stream.sources.map(summarizeSource),
    coveredConcepts,
    uncoveredConcepts,
    evidenceStatus: stream.evidenceStatus,
    applicationStatus: stream.applicationStatus,
    gaps: stream.gaps.map(gap => ({ code: gap.code, reason: sanitized(gap.reason), subject: sanitized(gap.subject) }))
  };
}

function summarizeInterpretation(interpretation) {
  if (!interpretation) return undefined;
  return {
    jurisdiction: interpretation.jurisdiction,
    authorityCandidates: interpretation.authorityCandidates,
    contextualAuthorities: interpretation.contextualAuthorities,
    domain: interpretation.domain,
    population: interpretation.population,
    primarySubject: sanitized(interpretation.primarySubject),
    concepts: interpretation.concepts.map(item => ({ concept: sanitized(item.concept), role: item.role })),
    requestedOperation: interpretation.requestedOperation,
    requiresUserSpecificFacts: interpretation.requiresUserSpecificFacts,
    calculationRequested: interpretation.calculationRequested,
    factsExplicitlyProvided: interpretation.factsExplicitlyProvided.map(sanitized),
    issues: interpretation.issues?.map(issue => ({
      subject: sanitized(issue.subject),
      population: issue.population,
      domain: issue.domain,
      governingAuthorities: issue.governingAuthorities,
      contextualAuthorities: issue.contextualAuthorities,
      operation: issue.operation,
      mappedTopicIds: issue.mappedTopicIds,
      evidenceRequirement: issue.evidenceRequirement
    }))
  };
}

function summarizeIssue(issue) {
  return {
    id: issue.id,
    subject: sanitized(issue.subject),
    population: issue.population,
    domain: issue.domain,
    governingAuthorities: issue.governingAuthorities,
    contextualAuthorities: issue.contextualAuthorities,
    operation: issue.operation,
    mappedTopicIds: issue.mappedTopicIds,
    evidenceRequirement: issue.evidenceRequirement,
    status: issue.status,
    unresolvedReason: issue.unresolvedReason
  };
}

function assertAuthorityIsolation(result) {
  const sourceOwners = new Map();
  for (const stream of result.workstreams) {
    for (const source of stream.sources) {
      assert.notEqual(source.recordRole, 'SOURCE_MAP_POINTER',
        `${stream.authority}/${stream.domain} cannot admit a source-map pointer as evidence.`);
      assert.ok(sourceBelongsToWorkstream(source, stream),
        `${source.id} (${sourceAuthority(source)}/${source.domain}) cannot support ${stream.authority}/${stream.domain}.`);
      const owners = sourceOwners.get(source.id) || new Set();
      owners.add(stream.authority);
      sourceOwners.set(source.id, owners);
    }
    for (const issue of stream.issues) {
      const issueSourceIds = new Set(issue.sources.map(source => source.id));
      for (const claim of issue.verifiedClaims) {
        assert.ok(issueSourceIds.has(claim.recordId),
          `Verified claim for ${issue.issueId} must point to a source admitted to that issue.`);
      }
    }
  }
  for (const [sourceId, authorities] of sourceOwners) {
    assert.equal(authorities.size, 1, `${sourceId} cannot be admitted across governing authorities.`);
  }
}

function oracleUnderstanding(testCase) {
  return { mode: 'SEMANTIC_INTERPRETATION', interpretation: testCase.oracleInterpretation };
}

async function evaluateCase(testCase) {
  const query = testCase.question;
  const understanding = oracleUnderstanding(testCase);
  const reconciled = reconcileQuestionUnderstanding(query, classifyQuestion(query), understanding);
  const issuePlan = reconciled.issuePlan;
  const planned = plannedStreams(planAuthorityWorkstreams(issuePlan));
  const localOnly = !liveSources;
  const result = await buildAuthorityWorkstreams(query, issuePlan, { localOnly });
  assert.equal(result.query, query, `${testCase.id}: full original query must be retained for evidence checks.`);
  assertAuthorityIsolation(result);

  assertExpectedScopes(planned, testCase.expectedWorkstreams, testCase.id, 'plan');
  assertExpectedScopes(result.workstreams, testCase.expectedWorkstreams, testCase.id, 'retrieval');

  const letter = caseLetter(testCase);
  const expectedTopics = expectedMappedTopicIds[letter];
  assert.ok(expectedTopics, `No independent topic mapper expectation exists for case ${letter}.`);
  assert.deepEqual(issuePlan.issues.map(issue => issue.mappedTopicIds), expectedTopics,
    `${testCase.id}: retain the independent mapper's real result, including unresolved C/D topics.`);
  for (let index = 0; index < testCase.oracleInterpretation.issues.length; index += 1) {
    const oracleIssue = testCase.oracleInterpretation.issues[index];
    const actualIssue = issuePlan.issues[index];
    assert.equal(actualIssue.population, oracleIssue.population, `${testCase.id}: preserve oracle subject population.`);
    assert.deepEqual(actualIssue.governingAuthorities, oracleIssue.governingAuthorities,
      `${testCase.id}: preserve each issue's governing authority.`);
    assert.deepEqual(actualIssue.contextualAuthorities, oracleIssue.contextualAuthorities,
      `${testCase.id}: preserve contextual authorities without creating ownership.`);
  }

  // These oracle questions include unresolved requested topics or case facts.
  // A verified fragment cannot upgrade the whole question to verified.
  assert.equal(result.status, 'INSUFFICIENT', `${testCase.id}: unresolved material coverage keeps overall status insufficient.`);
  const presentation = createAuthorityEvidencePresentation(result);
  assert.ok(hasCurrentAuthorityEvidencePresentation(presentation, query),
    `${testCase.id}: the freshly projected sections must be bound to the complete raw query.`);

  const noProviderUnderstanding = await interpretSemanticQuestion(query);
  const noProviderReconciled = reconcileQuestionUnderstanding(query, classifyQuestion(query), noProviderUnderstanding);
  const noProviderResult = await buildAuthorityWorkstreams(query, noProviderReconciled.issuePlan, { localOnly: true });

  const workstreamRows = result.workstreams.map(summarizeStream);
  const plannedRows = planned.map(stream => ({ authority: stream.authority, domain: stream.domain,
    issueIds: [...stream.issueIds] }));
  const renderedSections = presentation.workstreams.map(stream => ({
    authority: stream.authority,
    authorityLabel: sanitized(stream.authorityLabel),
    domain: stream.domain,
    domainLabel: sanitized(stream.domainLabel),
    evidenceStatus: stream.evidenceStatus,
    applicationStatus: stream.applicationStatus,
    issues: stream.issues.map(issue => ({
      id: issue.id,
      subject: sanitized(issue.subject),
      population: issue.population,
      evidenceStatus: issue.evidenceStatus,
      applicationStatus: issue.applicationStatus,
      gaps: issue.gaps.map(sanitized)
    })),
    sources: stream.sources.map(source => ({
      title: sanitized(source.title), publisher: sanitized(source.publisher), officialUrl: source.officialUrl,
      claimCount: source.claims.length
    })),
    gaps: stream.gaps.map(sanitized)
  }));
  const liveRecordCount = result.workstreams.flatMap(stream => stream.sources)
    .filter(source => source.provenance === 'LIVE_EXTERNAL' || source.provenance === 'LIVE_PATCH').length;

  return {
    id: testCase.id,
    queryLabel: sanitized(query),
    oracleMode: true,
    modelUnderstandingMeasured: false,
    oracleSemanticInterpretation: summarizeInterpretation(testCase.oracleInterpretation),
    rawQueryRetained: result.query === query,
    materialIssues: issuePlan.issues.map(summarizeIssue),
    mappedIds: issuePlan.issues.map(issue => ({ issueId: issue.id, topicIds: issue.mappedTopicIds })),
    plannedWorkstreams: plannedRows,
    retrievedWorkstreams: workstreamRows,
    workstreamEvidenceStatuses: workstreamRows.map(stream => ({
      authority: stream.authority, domain: stream.domain,
      evidenceStatus: stream.evidenceStatus, applicationStatus: stream.applicationStatus
    })),
    overallEvidenceStatus: result.evidenceStatus,
    overallApplicationStatus: result.applicationStatus,
    overallStatus: result.status,
    renderedSections: {
      queryMatchesRawQuestion: presentation.query === query,
      status: presentation.status,
      sections: renderedSections,
      gaps: presentation.gaps.map(sanitized)
    },
    localNoProviderComparison: {
      interpretationMode: noProviderUnderstanding.mode,
      interpretationFailure: noProviderUnderstanding.failure,
      modelUnderstandingMeasured: false,
      mappedIssueCount: noProviderReconciled.issuePlan.issues.length,
      plannedWorkstreams: plannedStreams(planAuthorityWorkstreams(noProviderReconciled.issuePlan)).map(stream => ({
        authority: stream.authority, domain: stream.domain
      })),
      retrievedWorkstreams: noProviderResult.workstreams.map(stream => ({
        authority: stream.authority, domain: stream.domain,
        evidenceStatus: stream.evidenceStatus, applicationStatus: stream.applicationStatus
      })),
      overallStatus: noProviderResult.status
    },
    sourceAccessMode: liveSources ? 'LIVE_SOURCE_DISCOVERY_REQUESTED' : 'LOCAL_REVIEWED_ONLY',
    liveSourceRetrievalRequested: liveSources,
    liveEvidenceMeasured: liveRecordCount > 0,
    liveAcceptedRecordCount: liveRecordCount
  };
}

const cases = [];
for (const testCase of selectedCases) cases.push(await evaluateCase(testCase));
const report = {
  summary: {
    suite: fixture.suite,
    mode: liveSources ? 'ORACLE_ROUTING_WITH_LIVE_SOURCE_RETRIEVAL' : 'ORACLE_ROUTING_WITH_LOCAL_REVIEWED_SOURCES',
    oracleMode: true,
    modelUnderstandingMeasured: false,
    sourceAccessMode: liveSources ? 'LIVE_SOURCE_DISCOVERY_REQUESTED' : 'LOCAL_REVIEWED_ONLY',
    liveSourceRetrievalRequested: liveSources,
    liveEvidenceMeasured: cases.some(item => item.liveEvidenceMeasured),
    cases: cases.length,
    expectedScopeCasesPassed: cases.length,
    overallStatusCounts: Object.fromEntries(['VERIFIED', 'CONDITIONAL', 'INSUFFICIENT'].map(status =>
      [status, cases.filter(item => item.overallStatus === status).length])),
    limitations: [
      'Oracle issue plans measure deterministic reconciliation and retrieval, not live-model understanding.',
      liveSources
        ? 'Only IRAS live discovery is implemented; the other authority adapters use reviewed local evidence. No live model call was made.'
        : 'The local run uses reviewed local records and disables source discovery; it does not measure live-source availability.',
      'A topic intentionally left unmapped by the independent taxonomy remains uncovered even when its oracle meaning is clear.'
    ]
  },
  cases
};

await mkdir(outputDirectory, { recursive: true });
const suffix = liveSources ? 'live-sources' : 'oracle';
const jsonPath = path.join(outputDirectory, `${suffix}-evaluation.json`);
const markdownPath = path.join(outputDirectory, `${suffix}-evaluation.md`);
await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
const lines = [
  `# ${fixture.suite}`,
  '',
  `Mode: ${report.summary.mode}. Model understanding measured: no.`,
  `Cases: ${cases.length}. Overall statuses: ${Object.entries(report.summary.overallStatusCounts).map(([key, value]) => `${key} ${value}`).join(', ')}.`,
  '',
  ...cases.flatMap(item => [
    `## ${item.id}`,
    '',
    `Question: ${item.queryLabel}`,
    `Status: ${item.overallStatus} (${item.overallEvidenceStatus}; application ${item.overallApplicationStatus}).`,
    `Planned: ${item.plannedWorkstreams.map(stream => `${stream.authority}/${stream.domain}`).join(', ') || 'none'}.`,
    `Retrieved: ${item.retrievedWorkstreams.map(stream => `${stream.authority}/${stream.domain} ${stream.evidenceStatus}`).join(', ') || 'none'}.`,
    `Rendered sections: ${item.renderedSections.sections.map(stream => `${stream.authorityLabel} — ${stream.domainLabel}`).join('; ') || 'none'}.`,
    `Raw query retained: ${item.rawQueryRetained}. Live evidence measured: ${item.liveEvidenceMeasured}.`,
    ''
  ]),
  '## Limits',
  '',
  ...report.summary.limitations.map(item => `- ${item}`),
  ''
];
await writeFile(markdownPath, `${lines.map(line => line.trimEnd()).join('\n').trimEnd()}\n`, 'utf8');
console.log(JSON.stringify(report.summary, null, 2));
console.log(`Wrote ${path.relative(root, jsonPath)} and ${path.relative(root, markdownPath)}`);
