import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { classifyQuestion } from '../../../src/classification/questionClassifier.ts';
import { defaultQueryTopicResolver as resolver } from '../../../src/retrieval/queryTopicResolver.ts';
import { getCoverageTopicsByIds } from '../../../src/standards/coverageRegistry.ts';
import { reconcileQuestionUnderstanding, validateSemanticQuestionInterpretation } from '../../../src/services/semanticQuestionUnderstanding.ts';
import { buildAuthorityWorkstreams, planAuthorityWorkstreams } from '../../../src/services/authorityWorkstreams.ts';
import { loadAuthorityReliefTargetedCases } from './semantic-contract-followup-evaluation.mjs';

// Adjudicated inputs test local reconciliation; they are not observed model output.
const issue = (subject, domain, population, authority, operation = 'EXPLAIN_RULE', contextualAuthorities = []) => ({
  subject, domain, population, governingAuthorities: [authority], contextualAuthorities,
  operation, mappedTopicIds: [], confidence: 0.96,
  evidenceRequirement: ['CALCULATE', 'CHECK_ELIGIBILITY', 'DETERMINE_TREATMENT'].includes(operation)
    ? 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS' : 'AUTHORITATIVE_SOURCE'
});
const individual = subject => issue(subject, 'IRAS_INCOME_TAX', 'INDIVIDUAL', 'IRAS');
const corporate = subject => issue(subject, 'IRAS_INCOME_TAX', 'COMPANY', 'IRAS');
const gst = subject => issue(subject, 'IRAS_GST', 'COMPANY', 'IRAS');
const cpf = subject => issue(subject, 'CPF_PAYROLL', 'EMPLOYER', 'CPF');
const mom = subject => issue(subject, 'MOM_EMPLOYMENT', 'EMPLOYER', 'MOM');
const acra = subject => issue(subject, 'ACRA_CORPORATE', 'COMPANY', 'ACRA');
const mas = subject => issue(subject, 'MAS_FUNDS', 'FUND', 'MAS');
const accounting = subject => issue(subject, 'ACCOUNTING', 'COMPANY', 'ACCOUNTING_STANDARDS');
const row = (id, family, kind, question, issues) => ({ id, family, kind, question, issues });
const auditCases = [
  row('individual-generic', 'IRAS individual', 'generic', 'How does individual income tax work in Singapore?', [individual('individual income tax rules')]),
  row('individual-specific', 'IRAS individual', 'specific', 'Explain personal tax relief for compulsory CPF contributions.', [individual('personal tax relief for compulsory CPF contributions')]),
  row('individual-compound', 'IRAS individual', 'compound', 'Explain personal tax relief for compulsory CPF contributions and employer CPF contribution rates.', [individual('personal tax relief for compulsory CPF contributions'), cpf('employer CPF contribution rates')]),
  row('corporate-generic', 'IRAS corporate', 'generic', 'How does corporate income tax work in Singapore?', [corporate('corporate income tax rules')]),
  row('corporate-specific', 'IRAS corporate', 'specific', 'What is the corporate tax rate in Singapore?', [corporate('corporate tax rate')]),
  row('corporate-compound', 'IRAS corporate', 'compound', 'Explain corporate tax filing deadlines and ACRA annual returns.', [corporate('corporate tax filing deadlines'), acra('ACRA annual returns')]),
  row('gst-generic', 'GST', 'generic', 'How does GST work in Singapore?', [gst('GST rules')]),
  row('gst-specific', 'GST', 'specific', 'Explain GST registration thresholds.', [gst('GST registration thresholds')]),
  row('gst-compound', 'GST', 'compound', 'Explain GST registration thresholds and corporate tax rates.', [gst('GST registration thresholds'), corporate('corporate tax rates')]),
  row('cpf-generic', 'CPF', 'generic', 'What must employers pay into CPF?', [cpf('employer CPF contributions')]),
  row('cpf-specific', 'CPF', 'specific', 'Explain employer CPF contribution rates by age.', [cpf('employer CPF contribution rates by age')]),
  row('cpf-compound', 'CPF', 'compound', 'Explain employer CPF contribution rates and general work-pass requirements.', [cpf('employer CPF contribution rates'), mom('general work-pass requirements')]),
  row('mom-generic', 'MOM', 'generic', 'What are the general work-pass requirements for foreign employees in Singapore?', [mom('general work-pass requirements for foreign employees')]),
  row('mom-specific', 'MOM', 'specific', 'Explain Employment Pass eligibility requirements.', [mom('Employment Pass eligibility requirements')]),
  row('mom-compound', 'MOM', 'compound', 'Explain general work visa requirements and employer CPF contributions.', [mom('general work visa requirements'), cpf('employer CPF contributions')]),
  row('acra-generic', 'ACRA', 'generic', 'What are the general company compliance requirements in Singapore?', [acra('general company compliance requirements')]),
  row('acra-specific', 'ACRA', 'specific', 'Explain ACRA annual returns.', [acra('ACRA annual returns')]),
  row('acra-compound', 'ACRA', 'compound', 'Explain ACRA annual returns and corporate tax filing deadlines.', [acra('ACRA annual returns'), corporate('corporate tax filing deadlines')]),
  row('mas-generic', 'MAS', 'generic', 'What are the general regulatory requirements for fund managers in Singapore?', [mas('general regulatory requirements for fund managers')]),
  row('mas-specific', 'MAS', 'specific', 'Explain capital markets services licence requirements for fund management.', [mas('capital markets services licence requirements')]),
  row('mas-compound', 'MAS', 'compound', 'Explain capital markets services licence requirements and corporate tax rates.', [mas('capital markets services licence requirements'), corporate('corporate tax rates')]),
  row('accounting-generic', 'Accounting/SFRS(I)', 'generic', 'What are the general SFRS(I) accounting requirements?', [accounting('general SFRS(I) accounting requirements')]),
  row('accounting-specific', 'Accounting/SFRS(I)', 'specific', 'Explain recognition of intangible assets under SFRS(I).', [accounting('recognition of intangible assets under SFRS(I)')]),
  row('accounting-compound', 'Accounting/SFRS(I)', 'compound', 'Explain IFRS 16 lease accounting and corporate tax deductibility.', [accounting('IFRS 16 lease accounting'), corporate('corporate tax deductibility')])
];

function interpretationFor(testCase) {
  const issues = testCase.issues;
  const unique = key => [...new Set(issues.map(item => item[key]))];
  const operation = unique('operation').length === 1 ? issues[0].operation : 'OTHER';
  return validateSemanticQuestionInterpretation({
    schemaVersion: 2, jurisdiction: ['Singapore'],
    authorityCandidates: issues.length === 1 ? issues[0].governingAuthorities : ['UNKNOWN'],
    contextualAuthorities: [], domain: unique('domain').length === 1 ? issues[0].domain : 'UNKNOWN',
    population: unique('population').length === 1 ? issues[0].population : 'UNKNOWN',
    primarySubject: issues[0].subject, concepts: [{ concept: issues[0].subject, role: 'PRIMARY' }],
    requestedOperation: operation,
    requiresUserSpecificFacts: testCase.expectedRequiresUserSpecificFacts ?? issues.some(item => item.evidenceRequirement === 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'),
    factsExplicitlyProvided: [], confidence: 0.96, issues
  });
}

let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error('NETWORK_DISABLED_IN_LOCAL_AUDIT'); };
async function diagnose(testCase) {
  const interpretation = interpretationFor(testCase);
  assert.ok(interpretation, `valid adjudicated issue contract: ${testCase.id}`);
  const understanding = { mode: 'SEMANTIC_INTERPRETATION', interpretation };
  const plan = reconcileQuestionUnderstanding(testCase.question, classifyQuestion(testCase.question), understanding).issuePlan;
  const requested = plan.issues.slice(0, interpretation.issues.length);
  const planned = planAuthorityWorkstreams(plan);
  const retrievalRequests = [];
  const retriever = {
    retrieveSources: async request => { retrievalRequests.push(request); return []; },
    getSourceById: () => undefined,
    findSourcesByStandardOrAct: () => []
  };
  const runtime = await buildAuthorityWorkstreams(testCase.question, plan, {
    localOnly: true, retriever, referenceDate: '2026-10-01', questionUnderstanding: understanding
  });
  const runtimeIssues = runtime.workstreams.flatMap(stream => stream.issues);
  const queryTopicIds = resolver.decomposeQuery(testCase.question).topics.map(topic => topic.id);
  const guards = {
    expectedCanonicalRouting: !testCase.expectedWorkstreamsAnyOf || testCase.expectedWorkstreamsAnyOf.some(expected =>
      JSON.stringify([...expected].sort()) === JSON.stringify(runtime.workstreams.map(stream => `${stream.authority}/${stream.domain}`).sort())),
    independentQueryIntersection: requested.every(item => item.mappedTopicIds.every(id => queryTopicIds.includes(id))),
    subjectIntersection: requested.every(item => item.mappedTopicIds.every(id => resolver.decomposeQuery(item.subject).topics.some(topic => topic.id === id))),
    governorIsolation: requested.every(item => getCoverageTopicsByIds(item.mappedTopicIds).every(topic => topic.authorities.includes(item.governingAuthorities[0]) || item.domain === 'ACCOUNTING' && topic.authorities.includes('ACRA'))),
    operationsPreserved: requested.every((item, index) => item.operation === interpretation.issues[index].operation),
    noExtraWorkstream: runtime.workstreams.every(stream => requested.some(item => item.governingAuthorities.includes(stream.authority))),
    residualNotRouted: plan.issues.slice(requested.length).every(item => !runtimeIssues.some(runtimeIssue => runtimeIssue.issueId === item.id)),
    mappedProviderPathsReached: requested.filter(item => item.status === 'MAPPED').every(item => runtimeIssues.some(runtimeIssue => runtimeIssue.issueId === item.id && runtimeIssue.lifecycle.retrievalAttempted)),
    unsupportedProviderRouteAbsent: !runtime.gaps.some(gap => ['PROVIDER_UNAVAILABLE', 'PROVIDER_AUTHORITY_MISMATCH', 'PROVIDER_ERROR'].includes(gap.code)),
    emptyEvidenceNotVerified: runtime.evidenceStatus !== 'VERIFIED' && runtimeIssues.every(item => item.evidenceStatus !== 'VERIFIED')
  };
  return {
    caseId: testCase.id, family: testCase.family, kind: testCase.kind, question: testCase.question,
    queryTopicIds, requestedIssueCount: requested.length,
    mappedRequestedIssueCount: requested.filter(item => item.status === 'MAPPED').length,
    fullyMapped: requested.every(item => item.status === 'MAPPED'),
    requested: requested.map(item => ({ subject: item.subject, domain: item.domain, population: item.population,
      governingAuthorities: item.governingAuthorities, operation: item.operation, status: item.status,
      mappedTopicIds: item.mappedTopicIds, ...(item.unresolvedReason ? { unresolvedReason: item.unresolvedReason } : {}) })),
    plannedWorkstreams: planned.map(stream => `${stream.authority}/${stream.domain}`),
    providerPathsReached: runtimeIssues.filter(item => item.lifecycle.retrievalAttempted).length,
    localRetrieverCalls: retrievalRequests.length,
    runtimeEvidenceStatus: runtime.evidenceStatus, guards
  };
}

const targetedFixture = await loadAuthorityReliefTargetedCases();
const targetedCases = targetedFixture.map(testCase => ({
  ...testCase,
  issues: testCase.expected.map(expected => {
    const personal = testCase.id === 'A-paraphrase-2' && expected.id === 'individual-cpf-tax-relief';
    const subject = testCase.id === 'control-general-recognition' ? 'general principles for recognizing intangible assets under IFRS'
      : testCase.id === 'target-mixed-ifrs-singapore-accounting' ? 'general recognition of a lease liability under IFRS 16 and Singapore SFRS(I)'
      : personal ? 'individual personal tax relief for compulsory CPF contributions' : expected.subject;
    return issue(subject, expected.domain[0], expected.population[0],
      testCase.id === 'control-general-recognition' ? 'IFRS_FOUNDATION' : expected.governingAuthorities[0],
      personal ? 'CHECK_ELIGIBILITY' : expected.operation[0], expected.contextualAuthoritiesAnyOf[0]);
  })
}));
const targeted = [];
const broader = [];
for (const testCase of targetedCases) targeted.push(await diagnose(testCase));
for (const testCase of auditCases) broader.push(await diagnose(testCase));
const fingerprints = {};
for (const file of ['src/retrieval/queryTopicResolver.ts', 'src/standards/coverageRegistry.ts', 'src/services/semanticQuestionUnderstanding.ts', 'src/services/authorityWorkstreams.ts', 'tests/evaluation/singapore/authority-relief-targeted.json', 'tests/evaluation/singapore/semantic-contract-followup.json', 'tests/evaluation/singapore/resolver-coverage-diagnosis.mjs']) {
  fingerprints[file] = createHash('sha256').update(await readFile(file)).digest('hex');
}
const protectedManifest = JSON.parse(await readFile('docs/evaluation/multi-authority-workstreams/authority-relief-protected-hashes.json', 'utf8'));
const protectedMismatches = [];
for (const entry of protectedManifest) {
  if (createHash('sha256').update(await readFile(entry.path)).digest('hex') !== entry.sha256) protectedMismatches.push(entry.path);
}
const summary = {
  targetedCases: targeted.length, fullyMappedTargetedCases: targeted.filter(item => item.fullyMapped).length,
  requestedIssues: targeted.reduce((sum, item) => sum + item.requestedIssueCount, 0),
  mappedRequestedIssues: targeted.reduce((sum, item) => sum + item.mappedRequestedIssueCount, 0),
  requestedProviderPathsReached: targeted.reduce((sum, item) => sum + item.providerPathsReached, 0),
  guardsPassed: [...targeted, ...broader].every(item => Object.values(item.guards).every(Boolean)),
  broaderCases: broader.length, broaderFullyMappedCases: broader.filter(item => item.fullyMapped).length,
  broaderUnresolvedIssues: broader.flatMap(item => item.requested.filter(requested => requested.status !== 'MAPPED')).length,
  networkAttempts, modelRequests: 0, protectedFileCount: protectedManifest.length, protectedMismatches
};
const report = { schemaVersion: 1, purpose: 'No-API resolver/coverage diagnostic with adjudicated synthetic semantic issues and actual default provider paths using empty local retrieval. Not model accuracy, live semantic metrics, or a knowledge-completeness claim.', sourceFingerprints: fingerprints, summary, targeted, broader };
if (process.argv[2]) await writeFile(process.argv[2], `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify(summary, null, 2));
assert.equal(summary.fullyMappedTargetedCases, 8);
assert.equal(summary.mappedRequestedIssues, 9);
assert.equal(summary.requestedProviderPathsReached, 9);
assert.equal(summary.guardsPassed, true);
assert.equal(networkAttempts, 0);
assert.deepEqual(protectedMismatches, []);
