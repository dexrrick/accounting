import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { loadStatutoryKnowledgeSources } from './load_statutory_knowledge_sources.mjs';
import { getCoverageTopicById } from '../src/standards/coverageRegistry.ts';
import { defaultQueryTopicResolver, QueryTopicResolver } from '../src/retrieval/queryTopicResolver.ts';
import { ControlledWebRetriever } from '../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../src/retrieval/sourceCache.ts';
import { OFFICIAL_SOURCE_DISCOVERY_PROVIDERS } from '../src/retrieval/officialSitemapDiscovery.ts';
import { classifyQuestion } from '../src/classification/questionClassifier.ts';
import {
  reconcileQuestionUnderstanding,
  validateSemanticQuestionInterpretation
} from '../src/services/semanticQuestionUnderstanding.ts';
import { buildAuthorityWorkstreams } from '../src/services/authorityWorkstreams.ts';
import { createAuthorityEvidencePresentation } from '../src/utils/authorityEvidencePresentation.ts';
import { renderAuthorityEvidenceResponseText } from '../src/services/authorityEvidenceResponse.ts';
import { STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES } from '../tests/fixtures/statutoryCoverageOfficialPages.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const corpusPath = path.join(root, 'tests/evaluation/statutory_coverage_wave_2026-10-25.json');
const defaultOutputPath = path.resolve(root, '../../artifacts/statutory-coverage-replay.json');
const baselineCommit = '9f5f8a3309cf28b5dcf56eb3a78da6c693801208';
const integrityPaths = Object.freeze({
  corpus: 'tests/evaluation/statutory_coverage_wave_2026-10-25.json',
  fixtureCatalog: 'tests/fixtures/statutoryCoverageOfficialPages.mjs',
  verifiedFixtureCatalog: 'tests/fixtures/statutoryCoverageVerifiedExcerpts.mjs',
  irasGstFilingExcerpt: 'tests/fixtures/statutoryCoverageSources/iras-gst-filing.html',
  cpfDueDateExcerpt: 'tests/fixtures/statutoryCoverageSources/cpf-due-date.txt',
  cpfRateFactorsExcerpt: 'tests/fixtures/statutoryCoverageSources/cpf-rate-factors.txt',
  momFinalSalaryExcerpt: 'tests/fixtures/statutoryCoverageSources/mom-final-salary.html',
  acraAuditExemptionExcerpt: 'tests/fixtures/statutoryCoverageSources/acra-audit-exemption.txt',
  masFundManagementExcerpt: 'tests/fixtures/statutoryCoverageSources/mas-fund-management.html',
  replayRunner: 'scripts/replay_statutory_coverage.mjs',
  coverageRegistry: 'src/standards/coverageRegistry.ts',
  queryTopicResolver: 'src/retrieval/queryTopicResolver.ts',
  semanticQuestionUnderstanding: 'src/services/semanticQuestionUnderstanding.ts',
  cpfMasPracticalRules: 'src/retrieval/cpfMasPracticalRules.ts',
  irasCpfCoverageRules: 'src/retrieval/irasCpfCoverageRules.ts',
  momAcraMasCoverageRules: 'src/retrieval/momAcraMasCoverageRules.ts',
  momSalaryPaymentRule: 'src/retrieval/momSalaryPaymentRule.ts'
});
const localOnlyRetriever = { retrieveSources: async () => [], getSourceById: () => undefined };
const extraSourceFlag = process.argv.find(value => value.startsWith('--source-manifests='));
const addedSources = await loadStatutoryKnowledgeSources(extraSourceFlag?.slice('--source-manifests='.length));
const replayPages = [...STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES.filter(page =>
  !addedSources.some(added => added.sourceUrl === page.sourceUrl)), ...addedSources];
const pagesByAuthority = new Map();
for (const page of replayPages) {
  const pages = pagesByAuthority.get(page.authority) || [];
  pages.push(page);
  pagesByAuthority.set(page.authority, pages);
}

const subjectByFamily = Object.freeze({
  'input-tax': 'GST input tax claim eligibility and supporting documentation',
  'gst-filing': 'GST return filing deadline, nil-return duty, and extension procedure',
  eci: 'Estimated Chargeable Income filing deadline and general waiver conditions',
  'withholding-tax': 'Withholding-tax applicability to specified non-resident payments',
  'additional-wages-definition': 'CPF Additional Wage definition and distinction from Ordinary Wages',
  'cpf-bonus-classification': 'CPF classification of annual bonuses and wage supplements',
  'cpf-due-date': 'CPF contribution legal due date and late-payment enforcement cut-off',
  'cpf-rate-factors': 'Employee and employer CPF contribution rate factors',
  'cpf-aw-ceiling': 'CPF Additional Wage ceiling formula and Ordinary Wage offset',
  'salary-timing': 'Employment Act salary frequency and payment deadlines',
  'final-salary': 'Final salary payment timing by reason employment ended',
  'annual-leave': 'Employment Act annual leave eligibility, entitlement, and proration',
  'salary-deductions': 'Employment Act salary deduction grounds and limits',
  'overtime-eligibility': 'Employment Act Part IV overtime coverage',
  'agm-deadlines': 'Company AGM timing requirements and deadline inputs',
  'annual-returns': 'Company annual return filing duty, deadline, and exceptions',
  'audit-exemption': 'Private-company small-company audit exemption criteria',
  'annual-return-officer-particulars': 'Annual return officer particulars confirmation from 20 October 2026',
  'secretary-appointment': 'Company secretary appointment deadline and eligibility requirements',
  'fund-management-licence': 'SFA-regulated fund management activity and LFMC CMS licensing requirement',
  vcfm: 'Simplified VCFM licensing path and admission eligibility',
  'class-exemptions': 'Conditional class exemptions from fund-management licensing',
  'qdc-reporting': 'QDC reporting scope, return type, and filing frequency',
  'regulatory-notifications': 'Fund-manager regulatory returns and notification duties'
});

const subjectByCaseId = Object.freeze({
  'iras-gst-filing-03': 'GST nil-return filing requirement when a period has no activity',
  'iras-eci-03': 'General ECI filing waiver eligibility conditions',
  'iras-eci-04': 'Whether no accounting profit establishes the ECI filing waiver',
  'iras-withholding-tax-04': 'Effect of a tax treaty on withholding-tax applicability',
  'cpf-cpf-rate-factors-02': 'CPF contribution rate factors for an employee paid during 2024',
  'cpf-cpf-rate-factors-04': 'Facts required to calculate an employee’s CPF contributions',
  'mom-salary-timing-01': 'Employment Act requirement to pay salary at least monthly',
  'mom-salary-timing-02': 'Regular salary deadline after the salary period',
  'mom-salary-timing-03': 'Overtime salary deadline after the salary period',
  'mom-salary-timing-04': 'Monthly payroll frequency and regular salary deadline',
  'mom-final-salary-01': 'Final salary deadline when an employee resigns with required notice',
  'mom-final-salary-02': 'Final salary deadline when an employee resigns without notice',
  'mom-final-salary-03': 'Final salary deadline after dismissal for misconduct',
  'mom-final-salary-04': 'Final salary deadline after employer termination',
  'mom-annual-leave-01': 'Employment Act eligibility start for paid annual leave',
  'mom-annual-leave-03': 'Minimum annual leave entitlement after eight years of service',
  'mom-annual-leave-04': 'Annual leave rule applicable to the 2018 leave year',
  'mom-salary-deductions-03': 'Conditions and cap for a damage-or-loss salary deduction',
  'mom-salary-deductions-04': 'Facts that determine whether a salary deduction is permitted',
  'mom-overtime-eligibility-01': 'Which employee classes are covered by Part IV overtime rules',
  'mom-overtime-eligibility-04': 'Part IV overtime coverage for managers and executives',
  'acra-agm-deadlines-04': 'Company facts needed to identify the next AGM deadline',
  'acra-annual-returns-01': 'Company annual-return filing procedure',
  'acra-annual-returns-02': 'Annual-return filing deadline after financial year end',
  'acra-annual-returns-03': 'Annual-return duty for a dormant private company',
  'acra-annual-returns-04': 'Annual-return deadline by listed and non-listed status',
  'acra-audit-exemption-02': 'Number of size criteria required for the small-company audit exemption',
  'acra-audit-exemption-03': 'Financial-year period over which audit exemption thresholds are tested',
  'acra-secretary-appointment-01': 'Deadline to appoint a company secretary after incorporation',
  'acra-secretary-appointment-02': 'Basic company secretary appointment duties',
  'acra-secretary-appointment-03': 'Whether the sole director can also be company secretary',
  'acra-secretary-appointment-04': 'Singapore residence requirement for a company secretary',
  'mas-vcfm-04': 'Facts that determine admission eligibility for the VCFM regime',
  'mas-class-exemptions-03': 'Whether related-corporation fund management is automatically exempt',
  'mas-qdc-reporting-04': 'QDC filing requirement for a venture capital fund manager'
});

function semanticSubjectFor(testCase) {
  return subjectByCaseId[testCase.id] || subjectByFamily[testCase.family] ||
    `Singapore ${testCase.authority} rule requested by the question`;
}

function populationFor(testCase, topic) {
  if (testCase.authority === 'CPF') return 'EMPLOYER';
  if (testCase.authority === 'MOM') {
    const question = testCase.question.toLowerCase();
    if (/\b(?:employer|our payroll|our employee|payroll|staff shortage|employer termination)\b/.test(question)) return 'EMPLOYER';
    if (testCase.family === 'final-salary') return 'EMPLOYEE';
    if (/\b(?:employee|employees|worker|workers|managers|executives)\b/.test(question)) return 'EMPLOYEE';
    return 'UNKNOWN';
  }
  if (testCase.authority === 'IRAS' && topic.id === 'iras-individual-cpf-relief') return 'INDIVIDUAL';
  return testCase.authority === 'MAS' && topic.domainId.startsWith('MAS_FAMILY') ? 'FUND' : 'COMPANY';
}

function semanticOracleFor(testCase, topic, primarySubject) {
  const domainByAuthority = {
    IRAS: topic.domainId.startsWith('IRAS_GST') ? 'IRAS_GST' : 'IRAS_INCOME_TAX',
    CPF: 'CPF_PAYROLL',
    MOM: 'MOM_EMPLOYMENT',
    ACRA: 'ACRA_CORPORATE',
    MAS: 'MAS_FUNDS'
  };
  const population = populationFor(testCase, topic);
  const interpretation = {
    jurisdiction: ['Singapore'],
    authorityCandidates: [testCase.authority],
    contextualAuthorities: [],
    domain: domainByAuthority[testCase.authority],
    population,
    primarySubject,
    concepts: [{ concept: primarySubject, role: 'PRIMARY' }],
    requestedOperation: testCase.operation,
    requiresUserSpecificFacts: ['CALCULATE', 'DETERMINE_TREATMENT', 'PREPARE_JOURNAL'].includes(testCase.operation),
    calculationRequested: testCase.operation === 'CALCULATE',
    factsExplicitlyProvided: [],
    confidence: 0.98,
    issues: [{
      subject: primarySubject,
      population,
      domain: domainByAuthority[testCase.authority],
      governingAuthorities: [testCase.authority],
      contextualAuthorities: [],
      operation: testCase.operation,
      mappedTopicIds: [],
      evidenceRequirement: 'AUTHORITATIVE_SOURCE',
      confidence: 0.98
    }]
  };
  return {
    mode: 'SEMANTIC_INTERPRETATION',
    assessmentStatus: 'PASSED',
    interpretation
  };
}

function semanticFixtureSummary(testCase, topic, understanding) {
  return {
    kind: 'EXPLICIT_FIXTURE',
    generatedBy: 'Hand-authored narrow interpretation fixture; not the model or application classifier',
    domain: understanding.interpretation.domain,
    population: understanding.interpretation.population,
    operation: testCase.operation,
    subject: understanding.interpretation.primarySubject,
    registryTopicTitle: topic.title,
    mappedTopicIdsSupplied: [],
    interpretationIndependentlyExercised: false
  };
}

function pagesForTestCase(testCase) {
  const ids = new Set(testCase.requiredTopicIds || []);
  return STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES.filter(page => page.authority === testCase.authority &&
    page.topicIds.some(id => ids.has(id)));
}

function first(source, fallback) {
  return Array.isArray(source) ? source[0] : fallback;
}

function topicCatalog(metadata) {
  return metadata.map(item => ({
    id: item.id,
    name: item.title,
    keywords: item.keywords || [],
    queryPatterns: item.queryPatterns,
    exclusionKeywords: item.exclusionKeywords || [],
    domainId: item.domainId,
    authorities: item.authorities || [],
    coverageStatus: item.status || 'MISSING',
    actOrStandard: item.actOrStandard,
    sectionMatch: item.sectionMatch
  }));
}

async function loadBaselineCatalog() {
  const executable = process.env.TASK_GIT_EXE || 'git';
  const source = execFileSync(executable, ['show', baselineCommit + ':src/standards/coverageRegistry.ts'], {
    cwd: root, encoding: 'utf8'
  });
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText;
  const oldModule = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
  return topicCatalog(oldModule.SINGAPORE_COVERAGE_REGISTRY);
}

async function hashReplayInputs() {
  const entries = await Promise.all(Object.entries(integrityPaths).map(async ([name, relativePath]) => {
    const bytes = await readFile(path.join(root, relativePath));
    return [name, { path: relativePath, sha256: createHash('sha256').update(bytes).digest('hex') }];
  }));
  return Object.fromEntries(entries);
}

function hashesEqual(left, right) {
  return Object.keys(left).length === Object.keys(right).length &&
    Object.entries(left).every(([name, value]) => value.sha256 === right[name]?.sha256);
}

async function replayCase(testCase) {
  const expectedTopicId = first(testCase.requiredTopicIds, '');
  const topic = getCoverageTopicById(expectedTopicId);
  const resolvedFromQuestion = defaultQueryTopicResolver.decomposeQuery(testCase.question).topics.map(item => item.id);
  const attachedPages = pagesForTestCase(testCase);
  if (!topic) {
    return {
      id: testCase.id,
      authority: testCase.authority,
      family: testCase.family,
      question: testCase.question,
      resolverTopicIds: resolvedFromQuestion,
      expectedTopicId,
      expectedTopicIdResolved: false,
      pipelineStatus: 'NO_REGISTERED_TOPIC',
      explanation: '',
      citations: [],
      verifiedClaims: [],
      fetches: [],
      fixtureIds: attachedPages.map(page => page.id),
      error: 'Corpus topic id is absent from the active coverage registry.'
    };
  }

  const semanticSubject = semanticSubjectFor(testCase);
  const understanding = semanticOracleFor(testCase, topic, semanticSubject);
  const semanticFixture = semanticFixtureSummary(testCase, topic, understanding);
  const semanticContractPassed = Boolean(validateSemanticQuestionInterpretation(
    understanding.interpretation, testCase.question));
  if (!semanticContractPassed) {
    return {
      id: testCase.id, authority: testCase.authority, family: testCase.family,
      question: testCase.question, resolverTopicIds: resolvedFromQuestion,
      expectedTopicId, semanticOracle: semanticFixture,
      expectedTopicIdResolved: false,
      pipelineStatus: 'SEMANTIC_ORACLE_REJECTED', explanation: '', citations: [], verifiedClaims: [],
      fetches: [], fixtureIds: attachedPages.map(page => page.id),
      error: 'Explicit offline semantic fixture did not satisfy the production semantic contract.'
    };
  }

  const fetches = [];
  const authorityPages = pagesByAuthority.get(testCase.authority) || [];
  const provider = OFFICIAL_SOURCE_DISCOVERY_PROVIDERS[testCase.authority];
  const sitemap = '<urlset>' + authorityPages.map(page =>
    '<url><loc>' + page.sourceUrl + '</loc></url>').join('') + '</urlset>';
  const customFetch = async urlValue => {
    const url = String(urlValue);
    fetches.push(url);
    if (provider?.sitemapUrls?.includes(url)) {
      return new Response(sitemap, { status: 200, headers: { 'content-type': 'application/xml' } });
    }
    const fixture = replayPages.find(page => page.sourceUrl === url);
    if (fixture) return new Response(fixture.body || fixture.html, { status: 200,
      headers: { 'content-type': fixture.contentType || 'text/html; charset=utf-8' } });
    if (url.endsWith('/robots.txt')) return new Response('not found', { status: 404 });
    if (url.startsWith('https://html.duckduckgo.com/') || url.startsWith('https://r.jina.ai/')) {
      return new Response('not found', { status: 404 });
    }
    throw new Error('Unexpected URL in offline replay: ' + url);
  };

  let expectedTopicIdResolved = false;
  let issueMappedTopicIds = [];
  try {
    const classification = classifyQuestion(testCase.question);
    const reconciled = reconcileQuestionUnderstanding(testCase.question, classification, understanding);
    const plannedIssue = reconciled.issuePlan.issues.find(issue =>
      issue.governingAuthorities.includes(testCase.authority));
    if (!plannedIssue) {
      return {
        id: testCase.id, authority: testCase.authority, family: testCase.family,
        question: testCase.question, resolverTopicIds: resolvedFromQuestion, expectedTopicId,
        semanticOracle: semanticFixture,
        expectedTopicIdResolved: false,
        issueMappedTopicIds: [],
        semanticContractPassed, pipelineStatus: 'NO_AUTHORITY_ISSUE',
        issuePlan: reconciled.issuePlan.issues.map(issue => ({
          subject: issue.subject, population: issue.population, authority: issue.governingAuthorities, domain: issue.domain,
          operation: issue.operation, status: issue.status, mappedTopicIds: issue.mappedTopicIds
        })),
        explanation: '', citations: [], verifiedClaims: [], fetches,
        fixtureIds: attachedPages.map(page => page.id)
      };
    }
    issueMappedTopicIds = [...(plannedIssue.mappedTopicIds || [])];
    expectedTopicIdResolved = issueMappedTopicIds.includes(expectedTopicId);

    const result = await buildAuthorityWorkstreams(testCase.question, reconciled.issuePlan, {
      retriever: localOnlyRetriever,
      referenceDate: '2026-10-25',
      questionUnderstanding: understanding,
      groundingOptions: {
        webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
        fetchOptions: { customFetch, timeoutMs: 350, useCache: false }
      }
    });
    const presentation = createAuthorityEvidencePresentation(result);
    const answer = renderAuthorityEvidenceResponseText(presentation, false);
    const pipelineStream = result.workstreams.find(item => item.authority === testCase.authority);
    const pipelineIssue = pipelineStream?.issues.find(item => item.issueId === plannedIssue.id);
    const stream = presentation.workstreams.find(item => item.authority === testCase.authority);
    const issue = stream?.issues.find(item => item.id === plannedIssue.id);
    const claims = (issue?.claims || []).map(claim => ({
      text: claim.text,
      ...(claim.supportKind === 'EXACT_SOURCE_QUOTE' ? { quote: claim.text } : {}),
      supportKind: claim.supportKind,
      provenance: claim.provenance,
      sourceBinding: claim.sourceBinding,
      fetchedSourceBinding: claim.fetchedSourceBinding,
      issueIds: claim.issueIds
    }));
    const citations = (stream?.sources || []).filter(source => source.officialUrl).map(source => ({
      title: source.title,
      url: source.officialUrl,
      provenance: source.provenance,
      ...(source.validFrom ? { validFrom: source.validFrom } : {}),
      ...(source.validTo ? { validTo: source.validTo } : {}),
      claims: source.claims.filter(claim => claim.issueIds.includes(issue?.id || '')).map(claim => ({
        text: claim.text,
        ...(claim.supportKind === 'EXACT_SOURCE_QUOTE' ? { quote: claim.text } : {}),
        supportKind: claim.supportKind,
        sourceBinding: claim.sourceBinding,
        fetchedSourceBinding: claim.fetchedSourceBinding
      }))
    }));
    const expectedOfficialSourceUrls = testCase.officialSources || [];
    const citedSourceUrls = citations.map(source => source.url);
    const unapprovedCitationUrls = [...new Set(citedSourceUrls.filter(url => !expectedOfficialSourceUrls.includes(url)))];
    const attempts = (pipelineIssue?.retrievalTrace?.attempts || []).map(attempt => ({
      topicId: attempt.topicId,
      status: attempt.fetchStatus,
      sourceUrl: attempt.sourceUrl,
      error: attempt.error
    }));
    const evidenceTrace = pipelineIssue?.admissionDiagnostics?.retrievalEvidenceQualityTrace;
    const detailedAttempts = (evidenceTrace?.attempts || attempts).map(attempt => ({
      topicId: attempt.topicId,
      status: attempt.fetchStatus,
      ...(attempt.sourceMapId ? { sourceMapId: attempt.sourceMapId } : {}),
      ...(attempt.candidateUrl ? { candidateUrl: attempt.candidateUrl } : {}),
      ...(attempt.finalUrl ? { finalUrl: attempt.finalUrl } : {}),
      ...(attempt.pageTitle ? { pageTitle: attempt.pageTitle } : {}),
      ...(typeof attempt.titleMatched === 'boolean' ? { titleMatched: attempt.titleMatched } : {}),
      ...(typeof attempt.contentMatched === 'boolean' ? { contentMatched: attempt.contentMatched } : {}),
      ...(attempt.discoveryStage ? { discoveryStage: attempt.discoveryStage } : {}),
      ...(attempt.searchQueryVariant ? { searchQueryVariant: attempt.searchQueryVariant } : {}),
      ...(attempt.error ? { error: attempt.error } : {})
    }));
    const retrievalTrace = evidenceTrace ? {
      path: evidenceTrace.path,
      sourceMapIds: evidenceTrace.sourceMapIds || [],
      selectedRecordIds: evidenceTrace.selectedRecordIds || [],
      finalVerifiedUrls: evidenceTrace.finalVerifiedUrls || [],
      candidateOnly: evidenceTrace.candidateOnly,
      discoveryFetchAttempts: evidenceTrace.discoveryFetchAttempts || [],
      stages: evidenceTrace.stages || [],
      attempts: detailedAttempts,
      coverageDecisions: evidenceTrace.coverageDecisions || []
    } : { attempts: detailedAttempts };
    return {
      id: testCase.id,
      authority: testCase.authority,
      family: testCase.family,
      question: testCase.question,
      resolverTopicIds: resolvedFromQuestion,
      expectedTopicId,
      expectedTopicIdResolved,
      issueMappedTopicIds,
      semanticOracle: semanticFixture,
      semanticContractPassed,
      issuePlan: reconciled.issuePlan.issues.map(issue => ({
        subject: issue.subject, population: issue.population, authority: issue.governingAuthorities, domain: issue.domain,
        operation: issue.operation, status: issue.status, mappedTopicIds: issue.mappedTopicIds
      })),
      pipelineStatus: issue?.evidenceStatus || 'NO_PRESENTED_ISSUE',
      applicationStatus: issue?.applicationStatus || 'UNRESOLVED',
      responseStatus: presentation.status,
      response: answer,
      explanation: answer,
      citations,
      verifiedClaims: claims,
      citationScopeAudit: {
        expectedOfficialSourceUrls,
        citedSourceUrls,
        unapprovedCitationUrls
      },
      fetches,
      retrievalAttempts: detailedAttempts,
      retrievalTrace,
      fixtureIds: attachedPages.map(page => page.id)
    };
  } catch (error) {
    return {
      id: testCase.id,
      authority: testCase.authority,
      family: testCase.family,
      question: testCase.question,
      resolverTopicIds: resolvedFromQuestion,
      expectedTopicId,
      expectedTopicIdResolved,
      issueMappedTopicIds,
      semanticOracle: semanticFixture,
      semanticContractPassed,
      pipelineStatus: 'PIPELINE_ERROR',
      explanation: '',
      citations: [],
      verifiedClaims: [],
      fetches,
      fixtureIds: attachedPages.map(page => page.id),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function replayStatutoryCoverageCase(testCase) {
  return replayCase(testCase);
}

function summaryBy(rows, label) {
  const authorities = ['IRAS', 'CPF', 'MOM', 'ACRA', 'MAS'];
  const keys = authorities.flatMap(authority => [...new Set(rows.filter(item => item.authority === authority).map(item => item[label]))]
    .map(value => ({ authority, value })));
  return Object.fromEntries(keys.map(({ authority, value }) => [
    authority + '/' + value,
    rows.filter(item => item.authority === authority && item[label] === value).length
  ]));
}

function summaryByFamily(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = row.authority + '/' + row.family;
    const counts = grouped.get(key) || {};
    counts[row.pipelineStatus] = (counts[row.pipelineStatus] || 0) + 1;
    grouped.set(key, counts);
  }
  return Object.fromEntries(grouped);
}

export async function runStatutoryCoverageOfflineReplay(corpus) {
  const startedAtUTC = new Date().toISOString();
  const inputHashesBefore = await hashReplayInputs();
  const baselineCatalog = await loadBaselineCatalog();
  const activeCatalog = QueryTopicResolver.CANONICAL_TOPICS;
  let baseline;
  try {
    QueryTopicResolver.CANONICAL_TOPICS = baselineCatalog;
    baseline = [];
    for (const testCase of corpus.cases) baseline.push(await replayCase(testCase));
  } finally {
    QueryTopicResolver.CANONICAL_TOPICS = activeCatalog;
  }
  const output = [];
  for (const testCase of corpus.cases) output.push(await replayCase(testCase));
  const byId = new Map(baseline.map(row => [row.id, row]));
  const caseById = new Map(corpus.cases.map(testCase => [testCase.id, testCase]));
  const evidenceGains = output.filter(row => row.pipelineStatus === 'VERIFIED' && row.expectedTopicIdResolved === true &&
    row.citations.some(source => STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES.some(page => page.sourceUrl === source.url) &&
      (caseById.get(row.id)?.officialSources || []).includes(source.url) &&
      source.claims.some(claim => claim.supportKind === 'EXACT_SOURCE_QUOTE')) &&
    byId.get(row.id)?.pipelineStatus !== 'VERIFIED' && byId.get(row.id)?.expectedTopicIdResolved !== true);
  const statuses = [...new Set([...output, ...baseline].map(row => row.pipelineStatus))];
  const inputHashesAfter = await hashReplayInputs();
  const completedAtUTC = new Date().toISOString();
  return {
    replayKind: 'OFFLINE_PRODUCTION_PIPELINE_WITH_PURPOSE_WRITTEN_AUTHORITY_PAGE_FIXTURES',
    referenceDate: '2026-10-25',
    startedAtUTC,
    completedAtUTC,
    generatedAtUTC: completedAtUTC,
    integrity: {
      stableDuringReplay: hashesEqual(inputHashesBefore, inputHashesAfter),
      before: inputHashesBefore,
      after: inputHashesAfter
    },
    networkRequests: 0,
    modelRequests: 0,
    liveAcceptance: 'NOT_RUN',
    baseline: {
      commit: baselineCommit,
      comparisonScope: 'Previous resolver wording metadata vs current resolver wording metadata, with the current application pipeline, source fixtures and authority support code in both runs. It does not reconstruct the previous full application.',
      outcomes: baseline
    },
    offlineEvidenceGainCandidates: evidenceGains.map(row => ({
      id: row.id, authority: row.authority, family: row.family,
      question: row.question,
      verifiedFixtureBoundQuotes: row.verifiedClaims.filter(claim => claim.supportKind === 'EXACT_SOURCE_QUOTE').length,
      fixtureUrls: row.citations.filter(source => STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES.some(page => page.sourceUrl === source.url))
        .map(source => source.url)
    })),
    offlineEvidenceGainCaveat: 'Fixture-pipeline status and exact synthetic-page quotes measure evidence-path behaviour only. They are not live source acceptance, complete-question coverage or independently adjudicated statutory-answer correctness.',
    corpusSize: corpus.cases.length,
    semanticInterpretation: 'A hand-authored narrow offline fixture supplies domain, population, operation, authority and a question-scoped subject for each row. It supplies no mapped topic IDs; the production resolver and reconciliation pipeline run on the original question. Model interpretation and independent answer review are not exercised.',
    addedSourceFixtures: addedSources.map(({ body: _body, html: _html, ...page }) => page),
    fixturePages: STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES.map(page => ({
      id: page.id,
      authority: page.authority,
      title: page.title,
      fixtureHtmlTitle: page.fixtureHtmlTitle,
      authorityPublisher: page.authorityPublisher,
      officialUrl: page.sourceUrl,
      topicIds: page.topicIds,
      fixtureKind: page.fixtureKind,
      researched: page.researched,
      provenanceNote: page.provenanceNote,
      wordCount: page.html.replace(/<[^>]*>/g, ' ').trim().split(/\s+/).length
    })),
    countsByAuthority: Object.fromEntries(['IRAS', 'CPF', 'MOM', 'ACRA', 'MAS'].map(authority => [
      authority,
      Object.fromEntries(statuses.map(status => [status,
        output.filter(row => row.authority === authority && row.pipelineStatus === status).length]))
    ])),
    countsByStatus: summaryBy(output, 'pipelineStatus'),
    countsByFamily: summaryByFamily(output),
    baselineCountsByFamily: summaryByFamily(baseline),
    routedByAuthority: Object.fromEntries(['IRAS', 'CPF', 'MOM', 'ACRA', 'MAS'].map(authority => [authority,
      { total: output.filter(row => row.authority === authority).length,
        routedOnOriginalQuestion: output.filter(row => row.authority === authority &&
          caseById.get(row.id).requiredTopicIds.every(id => row.resolverTopicIds.includes(id))).length,
        baselineRoutedOnOriginalQuestion: baseline.filter(row => row.authority === authority &&
          caseById.get(row.id).requiredTopicIds.every(id => row.resolverTopicIds.includes(id))).length }])),
    missingFixtureFamilies: [...new Set(output.filter(row => row.fixtureIds?.length === 0)
      .map(row => row.authority + '/' + row.family))].sort(),
    fixturePresentButNotVerifiedFamilies: [...new Set(output.filter(row => row.fixtureIds?.length && row.pipelineStatus !== 'VERIFIED')
      .map(row => row.authority + '/' + row.family))].sort(),
    unapprovedCitationCases: output.filter(row => row.citationScopeAudit?.unapprovedCitationUrls?.length).map(row => ({
      id: row.id, authority: row.authority, family: row.family,
      citedUrls: row.citationScopeAudit.unapprovedCitationUrls,
      expectedOfficialSourceUrls: row.citationScopeAudit.expectedOfficialSourceUrls
    })),
    outcomes: output
  };
}

async function main() {
  const args = process.argv.slice(2);
  const outFlag = args.find(value => value.startsWith('--out='));
  const corpusFlag = args.find(value => value.startsWith('--corpus='));
  const corpus = JSON.parse(await readFile(corpusFlag ? path.resolve(process.cwd(), corpusFlag.slice(9)) : corpusPath, 'utf8'));
  const report = await runStatutoryCoverageOfflineReplay(corpus);
  const outputPath = path.resolve(process.cwd(), outFlag ? outFlag.slice(6) : defaultOutputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    outputPath,
    corpusSize: report.corpusSize,
    routedByAuthority: Object.fromEntries(Object.entries(report.routedByAuthority)
      .map(([authority, counts]) => [authority, counts.routedOnOriginalQuestion + '/' + counts.total])),
    verifiedByAuthority: Object.fromEntries(Object.entries(report.countsByAuthority)
      .map(([authority, counts]) => [authority, counts.VERIFIED])),
    networkRequests: report.networkRequests,
    modelRequests: report.modelRequests,
    liveAcceptance: report.liveAcceptance
  }, null, 2));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
