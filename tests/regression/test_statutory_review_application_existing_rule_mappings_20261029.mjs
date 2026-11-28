import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { reconcileQuestionUnderstanding } from '../../src/services/semanticQuestionUnderstanding.ts';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { OFFICIAL_SOURCE_DISCOVERY_PROVIDERS } from '../../src/retrieval/officialSitemapDiscovery.ts';
import { supportIrasMasKnowledgeRule } from '../../src/retrieval/irasMasKnowledge20261027b.ts';
import { loadStatutoryKnowledgeSources } from '../../scripts/load_statutory_knowledge_sources.mjs';
import { STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES } from '../fixtures/statutoryCoverageOfficialPages.mjs';

const cases = [
  ['hold-mas-01', 'Does filing an LFMC\'s quarterly financial returns discharge the reporting obligations of each investment fund it manages?'],
  ['fresh-iras-01', 'For an investment holding company\'s ECI filing waiver, do dividends and interest count as revenue, and does an accounting loss by itself establish nil ECI?'],
  ['fresh-iras-02', 'A non-resident company provides consultancy services partly overseas and partly in Singapore. Is withholding tax charged on every dollar of the fee merely because our payer is in Singapore?']
];
const separateIhcTaxQuestion = 'For an investment holding company, how are dividend and interest income treated for corporate income tax?';
const independentIndividualTaxQuestion = 'A non-resident company provides consultancy services partly overseas and partly in Singapore. Does withholding tax apply only to the Singapore work? Separately, how is an employee\'s overseas employment income taxed?';
const existingMasToolkitQuestion = 'Can a licensed investment manager use the MAS LFMC compliance toolkit as a complete checklist for the funds it manages, including duties outside the Securities and Futures Act?';

function plan(question) {
  const classification = classifyQuestion(question);
  const reconciled = reconcileQuestionUnderstanding(question, classification,
    { mode: 'DETERMINISTIC_FALLBACK', failure: 'NO_PROVIDER' });
  return { classification, ...reconciled };
}

const masPlan = plan(cases[0][1]);
assert.ok(masPlan.classification.topicIds.includes('mas-regulatory-reporting'));
assert.ok(masPlan.issuePlan.issues.some(issue => issue.operation === 'EXPLAIN_RULE' &&
  issue.subject === 'MAS LFMC financial returns and SFA reporting requirements'));
assert.equal(masPlan.issuePlan.coverageEstablished, false, 'mapping an existing MAS rule does not upgrade whole-question coverage');

const ihcEciPlan = plan(cases[1][1]);
assert.ok(ihcEciPlan.classification.topicIds.includes('iras-cit-eci'));
assert.ok(ihcEciPlan.classification.topicIds.includes('iras-investment-holding-company'));
assert.ok(ihcEciPlan.issuePlan.issues.some(issue => issue.operation === 'EXPLAIN_RULE' &&
  issue.mappedTopicIds.includes('iras-cit-eci') && issue.mappedTopicIds.includes('iras-investment-holding-company')),
  'the fully specified IHC ECI waiver question binds both existing topics to the existing ECI rule');
assert.equal(ihcEciPlan.issuePlan.coverageEstablished, false, 'the source rule mapping does not mark the full question covered');

const whtPlan = plan(cases[2][1]);
assert.ok(whtPlan.issuePlan.issues.some(issue => issue.operation === 'EXPLAIN_RULE' &&
  issue.subject === 'Withholding tax on non-resident service payments'));
assert.equal(whtPlan.issuePlan.coverageEstablished, false, 'the WHT rule mapping does not upgrade whole-question coverage');
assert.ok(whtPlan.classification.missingFacts.length > 0, 'recipient and payment facts remain unresolved');

const separateIhcPlan = plan(separateIhcTaxQuestion);
assert.ok(separateIhcPlan.classification.topicIds.includes('iras-investment-holding-company'));
assert.equal(separateIhcPlan.classification.topicIds.includes('iras-cit-eci'), false,
  'a separate IHC tax question does not acquire the ECI waiver topic');
assert.equal(separateIhcPlan.issuePlan.issues.some(issue => issue.mappedTopicIds.includes('iras-cit-eci')), false,
  'the general IHC tax issue stays separate from ECI waiver evidence');

const individualTaxPlan = plan(independentIndividualTaxQuestion);
assert.ok(individualTaxPlan.issuePlan.issues.some(issue => issue.mappedTopicIds.includes('iras-withholding-tax')),
  'the company service-location question retains its WHT issue');
assert.ok(individualTaxPlan.issuePlan.issues.some(issue => issue.mappedTopicIds.includes('iras-individual-overseas-employment') ||
  issue.mappedTopicIds.includes('iras-individual-foreign-employment-income')),
  'a separately asked employee income-tax question remains requested');
assert.equal(individualTaxPlan.issuePlan.coverageEstablished, false, 'separate tax issues do not imply whole-question coverage');

const existingMasPlan = plan(existingMasToolkitQuestion);
assert.ok(existingMasPlan.issuePlan.issues.some(issue => issue.subject === 'MAS LFMC toolkit scope and fund-level requirements' &&
  issue.operation === 'EXPLAIN_RULE'), 'the existing LFMC toolkit scope question remains recognized');

const manifestPages = await loadStatutoryKnowledgeSources(
  fileURLToPath(new URL('../fixtures/statutoryKnowledge20261027b', import.meta.url)));
const eciSourcePage = manifestPages.find(page => page.filename === 'iras-mas-eci-native.html');
assert.ok(eciSourcePage, 'the ECI native source fixture is available');
const eciSourceText = Buffer.isBuffer(eciSourcePage.body) ? eciSourcePage.body.toString('utf8') : String(eciSourcePage.body);
const developmentManifestPath = fileURLToPath(new URL('../fixtures/statutoryDevelopment20261027/iras-cpf-mas-source-manifest.json', import.meta.url));
const developmentManifest = JSON.parse(await readFile(developmentManifestPath, 'utf8'));
const masToolkitSource = developmentManifest.sources.find(source => source.authority === 'MAS' && source.nativePdfFixture === 'mas-lfmc-toolkit.pdf');
assert.ok(masToolkitSource, 'the frozen native MAS toolkit manifest entry is available');
const masToolkitPath = fileURLToPath(new URL(`../fixtures/statutoryDevelopment20261027/${masToolkitSource.nativePdfFixture}`, import.meta.url));
const masToolkitBytes = await readFile(masToolkitPath);
assert.equal(masToolkitBytes.byteLength, masToolkitSource.byteLength, 'the native MAS toolkit fixture retains its recorded byte length');
assert.equal(createHash('sha256').update(masToolkitBytes).digest('hex'), masToolkitSource.sourceDocumentSha256.toLowerCase(),
  'the native MAS toolkit fixture matches its recorded source-document digest');
assert.equal(supportIrasMasKnowledgeRule({
  authority: 'IRAS', topicId: 'iras-investment-holding-company', query: cases[1][1],
  subject: 'ECI filing and waiver requirements', sourceText: eciSourceText, officialUrl: eciSourcePage.sourceUrl
}), true, 'the native ECI rule supports the IHC topic when all waiver premises are present');
assert.equal(supportIrasMasKnowledgeRule({
  authority: 'IRAS', topicId: 'iras-investment-holding-company', query: separateIhcTaxQuestion,
  subject: 'Investment Holding Company Tax Topics', sourceText: eciSourceText, officialUrl: eciSourcePage.sourceUrl
}), undefined, 'the native ECI rule is not selected for a separate IHC tax question');

const fixturePages = new Map(STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES.map(page => [page.sourceUrl,
  { authority: page.authority, body: page.html, type: 'text/html' }]));
for (const page of manifestPages) fixturePages.set(page.sourceUrl, {
  authority: page.authority, body: page.body, type: page.contentType
});
fixturePages.set(masToolkitSource.url, { authority: 'MAS', body: masToolkitBytes, type: masToolkitSource.contentType });
const fetchAttempts = [];
const modelEndpointPattern = /(?:generativelanguage\.googleapis\.com|api\.openai\.com|openai\.azure\.com|\/generateContent(?:\?|$)|\/chat\/completions(?:\?|$))/i;
const strictOfflineFetch = async input => {
  const url = input && typeof input === 'object' && typeof input.url === 'string' ? input.url : String(input);
  fetchAttempts.push(url);
  if (modelEndpointPattern.test(url)) throw new Error(`Unexpected provider/model request in offline regression: ${url}`);
  const page = fixturePages.get(url);
  if (page) return new Response(page.body, { headers: { 'content-type': page.type } });
  const provider = Object.values(OFFICIAL_SOURCE_DISCOVERY_PROVIDERS).find(candidate => candidate.sitemapUrls?.includes(url));
  if (provider) {
    const locations = [...fixturePages].filter(([, item]) => item.authority === provider.authority)
      .map(([sourceUrl]) => `<url><loc>${sourceUrl.replaceAll('&', '&amp;')}</loc></url>`).join('');
    return new Response(`<urlset>${locations}</urlset>`, { headers: { 'content-type': 'application/xml' } });
  }
  return new Response('Unavailable in frozen offline source set', { status: 404 });
};

const previousFetch = globalThis.fetch;
const applicationResults = new Map();
try {
  globalThis.fetch = strictOfflineFetch;
for (const [id, question] of [...cases, ['separate-ihc-tax', separateIhcTaxQuestion]]) {
    const response = await processAccountingQuery(question, null, 'IFRS', undefined, undefined, [], undefined);
    applicationResults.set(id, response);
  }
} finally {
  globalThis.fetch = previousFetch;
}

assert.ok(fetchAttempts.length > 0, 'the normal application entry used the frozen official-source fetch');
assert.equal(fetchAttempts.some(url => modelEndpointPattern.test(url)), false, 'no provider/model endpoint was requested');
assert.ok(fetchAttempts.includes(eciSourcePage.sourceUrl), 'the exact ECI answer retrieved its native official source');
assert.ok(fetchAttempts.includes(masToolkitSource.url), 'the MAS answer retrieved its native official toolkit PDF');

for (const [id] of cases) {
  const response = applicationResults.get(id);
  assert.equal(response.scenarioState.queryIntent, 'STATUTORY_ADVISORY', `${id} is handled as statutory guidance`);
  assert.deepEqual(response.scenarioState.directGroups || [], [], `${id} does not create accounting journals`);
  assert.match(response.messageText, /Verified general guidance is available/i,
    `${id} identifies verified general rule evidence`);
  assert.equal(response.scenarioState.authorityEvidencePresentation.status, 'INSUFFICIENT',
    `${id} does not upgrade whole-question verification when only mapped guidance is supported`);
  assert.match(response.messageText, /full request coverage unconfirmed|Evidence is incomplete for one or more material issues/i,
    `${id} preserves the distinction between verified rule evidence and whole-question coverage`);
}

const masAnswer = applicationResults.get('hold-mas-01').messageText;
assert.match(masAnswer, /quarterly Forms 1 and 2/i, 'the MAS answer identifies the existing LFMC quarterly return rule');
assert.match(masAnswer, /fund-level requirements/i, 'the MAS answer preserves the toolkit exclusion');
assert.match(masAnswer, /One quarterly financial return does not establish that all MAS duties are discharged/i,
  'the MAS answer does not treat one manager filing as discharging each fund\'s obligations');

const ihcEciAnswer = applicationResults.get('fresh-iras-01').messageText;
assert.match(ihcEciAnswer, /S\$5 million|\$5 million/i, 'the ECI answer states the existing revenue threshold');
assert.match(ihcEciAnswer, /investment income/i, 'the ECI answer identifies holding-company investment income as revenue');
assert.match(ihcEciAnswer, /before partial or start-up exemption/i, 'the ECI answer preserves the pre-exemption nil-ECI condition');
assert.match(ihcEciAnswer, /book loss alone does not qualify/i, 'the ECI answer rejects an accounting loss as a standalone waiver test');

const whtAnswer = applicationResults.get('fresh-iras-02').messageText;
assert.match(whtAnswer, /only the payment attributable to the services rendered in Singapore is subject to withholding tax/i,
  'the WHT answer apportions a mixed-location service fee');
assert.match(whtAnswer, /17%/i, 'the WHT answer states the existing prevailing rate for Singapore-work fees');
assert.match(whtAnswer, /DTA/i, 'the WHT answer preserves treaty qualifications');


assert.doesNotMatch(applicationResults.get('separate-ihc-tax').messageText, /ECI filing waiver|nil ECI|\$5 million/i,
  'a separate IHC tax question does not receive the ECI waiver answer');

console.log('Existing MAS and IRAS rule mappings passed actual-entry and scope-control regressions.');
