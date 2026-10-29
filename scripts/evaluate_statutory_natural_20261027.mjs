import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadStatutoryKnowledgeSources } from './load_statutory_knowledge_sources.mjs';

// An independently frozen question set is evaluated without supplying mapped
// topic IDs. The semantic fixture supplies only the independently stated issue.
const runnerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flag = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const appRoot = path.resolve(flag('app-root') || runnerRoot);
const applicationEntry = flag('entry') === 'application';
if (flag('entry') !== undefined && !applicationEntry) throw new Error('--entry supports only application.');
const rulesOnlyUnderstanding = flag('understanding') === 'rules-only';
if (applicationEntry && !rulesOnlyUnderstanding) throw new Error('--entry=application requires --understanding=rules-only.');
const output = path.resolve(flag('out') || path.join(runnerRoot,
  applicationEntry ? 'artifacts/application-natural-answers.json' : 'artifacts/natural-answers.json'));
const load = relative => import(pathToFileURL(path.join(appRoot, relative)).href);
const { classifyQuestion } = await load('src/classification/questionClassifier.ts');
const { reconcileQuestionUnderstanding, validateSemanticQuestionInterpretation } = await load('src/services/semanticQuestionUnderstanding.ts');
const { buildAuthorityWorkstreams } = await load('src/services/authorityWorkstreams.ts');
const { createAuthorityEvidencePresentation } = await load('src/utils/authorityEvidencePresentation.ts');
const { renderAuthorityEvidenceResponseText } = await load('src/services/authorityEvidenceResponse.ts');
const { ControlledWebRetriever } = await load('src/retrieval/controlledWebRetriever.ts');
const { SourceCache } = await load('src/retrieval/sourceCache.ts');
const { OFFICIAL_SOURCE_DISCOVERY_PROVIDERS } = await load('src/retrieval/officialSitemapDiscovery.ts');
const { processAccountingQuery } = applicationEntry ? await load('src/services/geminiService.ts') : {};
const { STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES } = await import('../tests/fixtures/statutoryCoverageOfficialPages.mjs');

const corpusBytes = await readFile(flag('corpus') || path.join(runnerRoot, 'tests/evaluation/statutory_natural_questions_20261027.json'));
const corpus = JSON.parse(corpusBytes);
const sourcePages = new Map(STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES.map(page => [page.sourceUrl,
  { authority: page.authority, title: page.title, body: Buffer.from(page.html), type: 'text/html', kind: page.fixtureKind }]));
const expansionDir = path.join(runnerRoot, 'tests/fixtures/statutoryExpansionSources');
const expansionPages = [
  ['IRAS', 'Conditions for Claiming Input Tax', 'iras-gst-input-tax-page.html', 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax'],
  ['IRAS', 'Estimated Chargeable Income (ECI) Filing', 'iras-eci-filing-page.html', 'https://www.iras.gov.sg/taxes/corporate-income-tax/estimated-chargeable-income-(eci)-filing'],
  ['CPF', 'What constitutes wages for CPF contributions', 'cpf-wage-classification.txt', 'https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions'],
  ['MAS', 'Compliance Toolkit for Venture Capital Fund Managers', 'mas-vcfm-toolkit.pdf', 'https://www.mas.gov.sg/-/media/mas-media-library/regulation/guidance/cmi/compliance-toolkits-for-fund-management-companies/sfa-compliance-toolkit--vcfms29-may-2026-clean.pdf']
];
function htmlEnvelope(authority, title, content) {
  const escapedTitle = `${authority} | ${title}`.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  return `<html><head><title>${escapedTitle}</title></head><body><main><h1>${escapedTitle}</h1>${content}</main></body></html>`;
}
for (const [authority, title, filename, url] of expansionPages) {
  const bytes = await readFile(path.join(expansionDir, filename));
  const pdf = filename.endsWith('.pdf');
  const content = filename.endsWith('.txt') ? `<p>${bytes.toString('utf8').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('\n', '<br>')}</p>` : bytes.toString('utf8');
  const nativeHtml = /<html\b/i.test(content);
  sourcePages.set(url, { authority, title, body: pdf || nativeHtml ? bytes : Buffer.from(htmlEnvelope(authority, title, content)), type: pdf ? 'application/pdf' : 'text/html', kind: pdf || nativeHtml ? 'RETAINED_NATIVE_OFFICIAL_RESPONSE' : 'RETAINED_OFFICIAL_SOURCE_WITH_IDENTITY_ENVELOPE' });
}
const developmentDir = path.join(runnerRoot, 'tests/fixtures/statutoryDevelopment20261027');
for (const manifestName of (await readdir(developmentDir)).filter(name => name.endsWith('source-manifest.json'))) {
  const manifest = JSON.parse(await readFile(path.join(developmentDir, manifestName), 'utf8'));
  for (const source of manifest.sources) {
    const filename = source.nativePdfFixture || source.fixture || source.file;
    const url = source.url || source.officialUrl;
    const bytes = await readFile(path.join(developmentDir, filename));
    const pdf = filename.endsWith('.pdf');
    const title = source.pageTitle || source.title;
    const content = filename.endsWith('.txt') ? `<p>${bytes.toString('utf8').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('\n', '<br>')}</p>` : bytes.toString('utf8');
    const nativeHtml = /<html\b/i.test(content);
    sourcePages.set(url, { authority: source.authority, title, body: pdf || nativeHtml ? bytes : Buffer.from(htmlEnvelope(source.authority, title, content)), type: pdf ? 'application/pdf' : 'text/html', kind: source.fixtureKind || source.kind || manifest.method || manifest.captureMethod });
  }
}

const localOnly = { retrieveSources: async () => [], getSourceById: () => undefined };
const addedSources = await loadStatutoryKnowledgeSources(flag('source-manifests'));
for (const page of addedSources) sourcePages.set(page.sourceUrl, {
  authority: page.authority, title: page.title, body: page.body, type: page.contentType, kind: page.fixtureKind
});
const outcomes = [];
for (const testCase of corpus.cases) {
  const classification = applicationEntry ? undefined : classifyQuestion(testCase.question);
  const authority = applicationEntry ? undefined : rulesOnlyUnderstanding ? classification.authorities[0] : testCase.authority;
  const domain = applicationEntry ? undefined : testCase.domain || ({ CPF: 'CPF_PAYROLL', MOM: 'MOM_EMPLOYMENT', ACRA: 'ACRA_CORPORATE', MAS: 'MAS_FUNDS' })[authority];
  const population = applicationEntry ? undefined : testCase.population || (authority === 'CPF' ? 'EMPLOYER' : authority === 'MOM' ? 'EMPLOYEE' : 'COMPANY');
  let understanding;
  if (applicationEntry) {
    understanding = undefined;
  } else if (rulesOnlyUnderstanding) {
    // Exercise the normal deterministic fallback without giving the question
    // an intended authority, domain, population, subject, or topic.
    understanding = { mode: 'DETERMINISTIC_FALLBACK', failure: 'NO_PROVIDER' };
  } else {
    const interpretation = validateSemanticQuestionInterpretation({
      jurisdiction: ['Singapore'], authorityCandidates: [authority], contextualAuthorities: [], domain, population,
      primarySubject: testCase.subject, concepts: [{ concept: testCase.subject, role: 'PRIMARY' }],
      requestedOperation: testCase.operation || 'EXPLAIN_RULE', requiresUserSpecificFacts: testCase.expectedScope === 'GENERAL_WITH_MISSING_FACTS' || testCase.operation === 'CALCULATE',
      calculationRequested: testCase.operation === 'CALCULATE', factsExplicitlyProvided: testCase.facts || [], confidence: 0.98,
      issues: [{ subject: testCase.subject, population, domain, governingAuthorities: [authority], contextualAuthorities: [],
        operation: testCase.operation || 'EXPLAIN_RULE', mappedTopicIds: [],
        evidenceRequirement: testCase.expectedScope === 'GENERAL_WITH_MISSING_FACTS'
          ? 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS' : 'AUTHORITATIVE_SOURCE', confidence: 0.98 }]
    }, testCase.question);
    if (!interpretation) throw new Error(`Semantic fixture rejected: ${testCase.id}`);
    understanding = { mode: 'SEMANTIC_INTERPRETATION', assessmentStatus: 'PASSED', interpretation };
  }
  const fetches = [];
  const blockedModelEndpoints = [];
  const isModelEndpoint = url => /(?:generativelanguage\.googleapis\.com|api\.openai\.com|openai\.azure\.com|\/generateContent(?:\?|$)|\/chat\/completions(?:\?|$))/i.test(url);
  const customFetch = async input => {
    const url = input && typeof input === 'object' && typeof input.url === 'string' ? input.url : String(input);
    fetches.push(url);
    if (isModelEndpoint(url)) blockedModelEndpoints.push(url);
    const page = sourcePages.get(url);
    if (page) return new Response(page.body, { headers: { 'content-type': page.type } });
    const eligibleProviders = rulesOnlyUnderstanding ? Object.values(OFFICIAL_SOURCE_DISCOVERY_PROVIDERS)
      : [OFFICIAL_SOURCE_DISCOVERY_PROVIDERS[authority]].filter(Boolean);
    const sitemapProvider = eligibleProviders.find(provider => provider.sitemapUrls?.includes(url));
    if (sitemapProvider) return new Response('<urlset>' + [...sourcePages].filter(([,item]) => item.authority === sitemapProvider.authority)
      .map(([sourceUrl]) => `<url><loc>${sourceUrl.replaceAll('&', '&amp;')}</loc></url>`).join('') + '</urlset>', { headers: { 'content-type': 'application/xml' } });
    return new Response('Unavailable in frozen offline source set', { status: 404 });
  };
  if (applicationEntry) {
    let authorityWorkstreams;
    const previousFetch = globalThis.fetch;
    let response;
    globalThis.fetch = customFetch;
    try {
      response = await processAccountingQuery(testCase.question, null, 'IFRS', undefined, undefined, [], undefined, {
        onAuthorityWorkstreams: result => { authorityWorkstreams = result; }
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
    const presentation = response.scenarioState?.authorityEvidencePresentation;
    outcomes.push({ id: testCase.id, question: testCase.question, entryRoute: 'processAccountingQuery',
      answer: response.messageText ?? '', evidenceStatuses: presentation ? presentation.workstreams.map(stream => ({ authority: stream.authority,
        evidenceStatus: stream.evidenceStatus, applicationStatus: stream.applicationStatus,
        issues: stream.issues.map(issue => ({ subject: issue.subject, evidenceStatus: issue.evidenceStatus, applicationStatus: issue.applicationStatus })) })) : [],
      authorityWorkstreams, authorityEvidencePresentation: presentation, fetches, blockedModelEndpoints });
    continue;
  }
  const { issuePlan } = reconcileQuestionUnderstanding(testCase.question, classification, understanding);
  const result = await buildAuthorityWorkstreams(testCase.question, issuePlan, {
    retriever: localOnly, referenceDate: '2026-10-27', questionUnderstanding: understanding,
    groundingOptions: { webRetriever: new ControlledWebRetriever(undefined, new SourceCache()), fetchOptions: { customFetch, useCache: false, timeoutMs: 3000 } }
  });
  const presentation = createAuthorityEvidencePresentation(result);
  const answer = renderAuthorityEvidenceResponseText(presentation, false);
  outcomes.push({ ...(rulesOnlyUnderstanding ? { id: testCase.id, question: testCase.question } : testCase),
    semanticFixture: rulesOnlyUnderstanding ? undefined : { domain, population, mappedTopicIds: [] },
    issuePlan, answer, evidenceStatuses: presentation.workstreams.map(stream => ({ authority: stream.authority,
      evidenceStatus: stream.evidenceStatus, applicationStatus: stream.applicationStatus,
      issues: stream.issues.map(issue => ({ subject: issue.subject, evidenceStatus: issue.evidenceStatus, applicationStatus: issue.applicationStatus })) })),
    fetches, presentation, result });
}
const blockedModelEndpoints = outcomes.flatMap(row => row.blockedModelEndpoints || []);
const report = { scope: applicationEntry ? 'APPLICATION_ENTRY_NATURAL_QUESTIONS_OFFLINE_NO_PROVIDER' : rulesOnlyUnderstanding ? 'RULES_ONLY_NATURAL_QUESTIONS_OFFLINE_DETERMINISTIC_FALLBACK' : 'INDEPENDENT_NATURAL_QUESTIONS_OFFLINE_EXPLICIT_SEMANTIC_FIXTURES', appRoot,
  corpusSha256: createHash('sha256').update(corpusBytes).digest('hex'), networkRequests: 0,
  ...(applicationEntry ? { entryRoute: 'processAccountingQuery(question, null, IFRS, undefined)', modelRequests: blockedModelEndpoints.length, blockedModelEndpoints } : { modelRequests: 0 }),
  addedSourceFixtures: addedSources.map(({ body: _body, html: _html, ...page }) => page),
  limitation: applicationEntry
    ? 'The normal processAccountingQuery entry point receives only each question with a null current scenario, IFRS, and no provider. Its default classification, deterministic fallback, retrieval and returned answer are measured. Frozen official source fixtures are served through a strict fetch override; every other URL, including any model endpoint, is blocked with HTTP 404. This is offline application-path evidence, not live semantic-model or browser acceptance. An absent authority evidence presentation and its empty status list remain as returned.'
    : rulesOnlyUnderstanding
    ? 'No authority, domain, population, subject, operation, or mapped-topic hint is supplied from the corpus. This offline deterministic classification and reconciliation run does not evaluate live semantic-model interpretation. Source response envelopes are adapted where stated, and answer correctness requires independent adjudication.'
    : 'Semantic issue fixtures are supplied; source response envelopes are layout-adapted where stated. Answer correctness requires independent adjudication.',
  sources: [...sourcePages].map(([url, page]) => ({ url, title: page.title, authority: page.authority, kind: page.kind,
    sha256: createHash('sha256').update(page.body).digest('hex') })), outcomes };
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
if (applicationEntry && blockedModelEndpoints.length > 0) {
  throw new Error(`No-provider application entry attempted ${blockedModelEndpoints.length} model request(s); attempts were blocked and recorded in ${output}.`);
}
console.log(JSON.stringify({ output, cases: outcomes.length,
  verifiedByAuthority: Object.fromEntries(['IRAS','CPF','MOM','ACRA','MAS'].map(authority => [authority,
    outcomes.filter(row => applicationEntry
      ? row.evidenceStatuses.some(stream => stream.authority === authority && stream.evidenceStatus === 'VERIFIED')
      : row.authority === authority && row.evidenceStatuses.some(stream => stream.evidenceStatus === 'VERIFIED')).length])),
  explanationCases: outcomes.filter(row => /rule explanation/.test(row.answer)).length }, null, 2));
