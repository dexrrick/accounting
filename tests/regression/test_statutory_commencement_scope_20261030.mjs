import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { createAuthorityEvidencePresentation } from '../../src/utils/authorityEvidencePresentation.ts';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { reconcileQuestionUnderstanding } from '../../src/services/semanticQuestionUnderstanding.ts';
import { TargetDateResolver } from '../../src/retrieval/targetDateResolver.ts';
import { acraOfficerCommencementScope, masSfa04N24CommencementScope } from '../../src/retrieval/statutoryCommencementScope.ts';
import { ACRA_MOM_KNOWLEDGE_RULES_20261027B } from '../../src/retrieval/acraMomKnowledge20261027b.ts';
import { IRAS_MAS_KNOWLEDGE_RULES_20261027B } from '../../src/retrieval/irasMasKnowledge20261027b.ts';
import { loadStatutoryKnowledgeSources } from '../../scripts/load_statutory_knowledge_sources.mjs';
import { OFFICIAL_SOURCE_DISCOVERY_PROVIDERS } from '../../src/retrieval/officialSitemapDiscovery.ts';

const acraRule = ACRA_MOM_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'ACRA_AR_OFFICER_PARTICULARS_20261020');
const masRule = IRAS_MAS_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'MAS_SFA_MISCONDUCT_REPORTING_2027');
assert.ok(acraRule && masRule);
const resolver = new TargetDateResolver();

const boundedAcra = [
  'Our return was filed on 19 October 2026. Did the officer-confirmation change that commenced on 20 October already govern that filing?',
  'We lodged our annual return on 19 October 2026. Was the new question about a person carrying out the chief executive officer role already mandatory for that filing?'
];
for (const query of boundedAcra) {
  assert.ok(acraOfficerCommencementScope(query), 'the identified ACRA change is recognized for a filing-date comparison');
  assert.deepEqual(resolver.resolveAuthorityEvidenceDate(query, '2026-10-30'), {
    confidence: 'LOW', source: 'NONE', isHistorical: false, dateRole: 'DECLARED_COMMENCEMENT'
  }, 'the filing date does not become a legal-version target date');
}
const monthYearAcra = 'We filed our annual return in October 2026. Was the new CEO question already mandatory?';
assert.equal(acraOfficerCommencementScope(monthYearAcra)?.filingDate, undefined,
  'month-year filing context does not determine whether a filing preceded 20 October');
assert.equal(resolver.resolveAuthorityEvidenceDate(monthYearAcra, '2026-10-30').dateRole, 'DECLARED_COMMENCEMENT');
assert.equal(acraOfficerCommencementScope('Our annual return was filed on 18 October 2026. Does the new CEO question apply?')?.filingDate,
  '2026-10-18', 'an earlier filing date remains associated with the annual-return fact');
assert.equal(acraOfficerCommencementScope('Our annual return was filed on 20 October 2026. Does the new CEO question apply?')?.filingDate,
  '2026-10-20', 'a filing on commencement day is distinguished from a pre-commencement filing');
assert.equal(acraOfficerCommencementScope('Our annual return was filed on 21 October 2026. Does the new CEO question apply?')?.filingDate,
  '2026-10-21', 'a filing after commencement is distinguished from a pre-commencement filing');
assert.ok(acraOfficerCommencementScope('ACRA: Our annual return was filed on 18 October 2026. Was the new CEO question already mandatory?'),
  'the helper permits its own authority to be named');
for (const query of [
  'Our annual return was filed on 19 October 2026 and 21 October 2026. Did the new CEO question apply?',
  'Our annual return was filed on 19 October 2026, and the CEO started on 21 October 2026. Did the new CEO question apply?',
  'Our annual return was filed on 31 February 2026. Did the new CEO question apply?',
  'Our annual return was filed on 19 October 2019. What officer rules applied then?',
  'Our annual return was filed on 19 October 2026. Was the new CEO question mandatory, and what is the XBRL filing deadline?'
]) assert.equal(acraOfficerCommencementScope(query), undefined, `unbounded ACRA scope is rejected: ${query}`);

const boundedMas = [
  'What does MAS Notice SFA 04-N24 require from 1 January 2027 for CMS licence holders?',
  'Can the misconduct notice that takes effect on 1 January 2027 be treated as already governing an October 2026 report?',
  'Under the expressly future Notice SFA 04-N24 effective on 1 January 2027, who files the initial representative-misconduct report and what triggers its 21-calendar-day clock?',
  'Notice SFA 04-N24 says it takes effect on 1 January 2027. Does its 21-day reporting rule already settle what a CMS licence holder had to do for misconduct first suspected in December 2026?'
];
for (const query of boundedMas) {
  assert.ok(masSfa04N24CommencementScope(query), `the named or unique 2027 misconduct notice is recognized: ${query}`);
  assert.deepEqual(resolver.resolveAuthorityEvidenceDate(query, '2026-10-30'), {
    confidence: 'LOW', source: 'NONE', isHistorical: false, dateRole: 'DECLARED_COMMENCEMENT'
  }, 'the notice date is discussed as a source boundary, not selected as an arbitrary target date');
}
const namedMasBoundaryOnly = 'Notice SFA 04-N24 takes effect on 1 January 2027. What commencement date does it state?';
assert.ok(masSfa04N24CommencementScope(namedMasBoundaryOnly),
  'the named notice’s effective date is recognized as a declared boundary even without repeating its subject');
assert.deepEqual(resolver.resolveAuthorityEvidenceDate(namedMasBoundaryOnly, '2026-10-30'), {
  confidence: 'LOW', source: 'NONE', isHistorical: false, dateRole: 'DECLARED_COMMENCEMENT'
});
for (const query of [
  'Does Notice SFA 04-N11 take effect on 1 January 2027 for misconduct reports?',
  'Does Notice FAA-N27 take effect on 1 January 2027 for misconduct reports under SFA 04-N24?',
  'What did SFA 04-N24 require for misconduct first suspected in 2019?',
  'Does SFA 04-N24 govern misconduct reports for December 2026, and how do we renew our CMS licence?',
  'Does SFA 04-N24 govern misconduct reports for 31 February 2026?'
]) assert.equal(masSfa04N24CommencementScope(query), undefined, `competing or unrelated MAS scope is rejected: ${query}`);
assert.equal(acraOfficerCommencementScope('Our annual return and SFA 04-N24 report both changed in 2026. What rules applied?'), undefined,
  'mixed authority scope is rejected');
assert.equal(masSfa04N24CommencementScope('Is the precise QDC form established by the generic LFMC quarterly return table?'), undefined,
  'this source boundary does not claim QDC requirements');

for (const query of [...boundedAcra, ...boundedMas]) {
  const { issuePlan } = reconcileQuestionUnderstanding(query, classifyQuestion(query),
    { mode: 'DETERMINISTIC_FALLBACK', failure: 'NO_PROVIDER' });
  const expectedTopic = boundedAcra.includes(query) ? 'acra-annual-return-officer-particulars'
    : 'mas-regulatory-reporting';
  assert.ok(issuePlan.issues.some(issue => issue.mappedTopicIds.includes(expectedTopic) &&
    issue.operation === 'EXPLAIN_RULE' && issue.subject), `${expectedTopic}: commencement discussion maps to a source rule issue: ${JSON.stringify(issuePlan.issues.map(({ subject, mappedTopicIds, operation }) => ({ subject, mappedTopicIds, operation })))}`);
}

const statutoryPages = await loadStatutoryKnowledgeSources(fileURLToPath(new URL('../fixtures/statutoryKnowledge20261027b', import.meta.url)));
const acraPage = statutoryPages.find(page => page.filename === acraRule.fixtureFile);
assert.ok(acraPage, 'the exact ACRA commencement source fixture is loaded through the existing manifest loader');
const acraManifest = JSON.parse(await readFile(new URL('../fixtures/statutoryKnowledge20261027b/acra-mom-source-manifest.json', import.meta.url), 'utf8'));
const acraCapture = acraManifest.sources.find(source => source.fixture === acraRule.fixtureFile);
assert.ok(acraCapture && acraCapture.url.replace(/\/$/, '') === acraRule.officialUrl.replace(/\/$/, ''));
const acraFixture = await readFile(new URL(`../fixtures/statutoryKnowledge20261027b/${acraCapture.fixture}`, import.meta.url));
assert.equal(createHash('sha256').update(acraFixture).digest('hex'), acraCapture.fixtureSha256,
  'the ACRA visible-text fixture content matches the retained manifest digest');

const masManifest = JSON.parse(await readFile(new URL('../fixtures/statutoryKnowledge20261027b/iras-mas-source-manifest.json', import.meta.url), 'utf8'));
const masCapture = masManifest.sources.find(source => source.fixture === masRule.fixture);
assert.ok(masCapture && masCapture.url === masRule.officialUrl, 'the MAS metadata binds to the exact official PDF URL');
const masPdf = await readFile(new URL(`../fixtures/statutoryKnowledge20261027b/${masCapture.nativePdfFixture}`, import.meta.url));
assert.equal(createHash('sha256').update(masPdf).digest('hex'), masCapture.sourceResponseSha256,
  'the native MAS PDF response matches the retained source manifest digest');

const pages = new Map();
for (const page of statutoryPages) pages.set(page.sourceUrl, {
  authority: page.authority, body: page.body, type: page.contentType
});
pages.set(masRule.officialUrl, { authority: 'MAS', body: masPdf, type: 'application/pdf' });
const modelEndpoint = /(?:generativelanguage\.googleapis\.com|api\.openai\.com|openai\.azure\.com|\/generateContent(?:\?|$)|\/chat\/completions(?:\?|$))/i;
const canonicalUrl = value => {
  const url = new URL(value);
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}${url.search}`;
};
const fetchAttempts = [];
const offlineFetch = async input => {
  const url = input && typeof input === 'object' && typeof input.url === 'string' ? input.url : String(input);
  fetchAttempts.push(url);
  if (modelEndpoint.test(url)) throw new Error(`Unexpected provider/model request: ${url}`);
  const page = pages.get(url);
  if (page) return new Response(page.body, { headers: { 'content-type': page.type } });
  const provider = Object.values(OFFICIAL_SOURCE_DISCOVERY_PROVIDERS).find(candidate => candidate.sitemapUrls?.includes(url));
  if (provider) {
    const urls = [...pages].filter(([, value]) => value.authority === provider.authority)
      .map(([sourceUrl]) => `<url><loc>${sourceUrl.replaceAll('&', '&amp;')}</loc></url>`).join('');
    return new Response(`<urlset>${urls}</urlset>`, { headers: { 'content-type': 'application/xml' } });
  }
  return new Response('Not present in the retained offline statutory source set', { status: 404 });
};

const cases = [
  { id: 'named-mas-general-requirements', authority: 'MAS', url: masRule.officialUrl,
    query: 'What does MAS Notice SFA 04-N24 require from 1 January 2027 for CMS licence holders?',
    expected: /takes effect on 1 January 2027[\s\S]*CMS licence holders[\s\S]*21 calendar days[\s\S]*first has reasonable grounds/i,
    forbidden: /N24 governs another numbered notice/i },
  { id: 'hold-acra-03', authority: 'ACRA', url: acraRule.officialUrl, query: boundedAcra[0],
    expected: /From 20 October 2026[\s\S]*does not make this new change applicable[\s\S]*does not establish the complete requirements/i,
    forbidden: /new 20 October requirement already governed the 19 October filing/i },
  { id: 'reviewfresh-acra-01', authority: 'ACRA', url: acraRule.officialUrl, query: boundedAcra[1],
    expected: /From 20 October 2026[\s\S]*does not make this new change applicable[\s\S]*does not establish the complete requirements/i,
    forbidden: /no officer particulars or other annual.return duties existed before 20 October/i },
  { id: 'acra-month-year-uncertain', authority: 'ACRA', url: acraRule.officialUrl, query: monthYearAcra,
    expected: /From 20 October 2026[\s\S]*notice states that the new change applies from 20 October 2026[\s\S]*does not establish what requirements governed filings before that date/i,
    forbidden: /does not make this new change applicable to the filing date supplied before 20 October/i },
  { id: 'hold-mas-03', authority: 'MAS', url: masRule.officialUrl, query: boundedMas[1],
    expected: /takes effect on 1 January 2027[\s\S]*not yet in effect for an October or December 2026 matter[\s\S]*does not by itself establish what earlier reporting duty applied or prove that none existed[\s\S]*Paragraph 21[\s\S]*Paragraph 20/i,
    forbidden: /2027 notice automatically governs October 2026 reports/i },
  { id: 'fresh-mas-02', authority: 'MAS', url: masRule.officialUrl, query: boundedMas[2],
    expected: /takes effect on 1 January 2027[\s\S]*CMS licence holders[\s\S]*21 calendar days[\s\S]*first has reasonable grounds[\s\S]*Paragraph 21[\s\S]*Paragraph 20/i,
    forbidden: /clock starts only when investigation (?:is )?finished/i },
  { id: 'reviewfresh-mas-02', authority: 'MAS', url: masRule.officialUrl, query: boundedMas[3],
    expected: /takes effect on 1 January 2027[\s\S]*not yet in effect for an October or December 2026 matter[\s\S]*does not by itself establish what earlier reporting duty applied or prove that none existed[\s\S]*Paragraph 21[\s\S]*Paragraph 20/i,
    forbidden: /new 21.day rule already governs the December 2026 incident/i }
];

const previousFetch = globalThis.fetch;
const results = [];
try {
  globalThis.fetch = offlineFetch;
  for (const sample of cases) {
    let workstreams;
    const response = await processAccountingQuery(sample.query, null, 'SFRS_I', undefined, undefined, [], undefined,
      { onAuthorityWorkstreams: value => { workstreams = value; } });
    assert.deepEqual(response.scenarioState.directGroups || [], [], `${sample.id}: no accounting transaction is created`);
    assert.ok(workstreams, `${sample.id}: the whole application reached authority workstreams`);
    const presentation = createAuthorityEvidencePresentation(workstreams);
    const stream = presentation.workstreams.find(item => item.authority === sample.authority);
    assert.ok(stream, `${sample.id}: the requested authority is represented`);
    assert.ok(stream.issues.some(issue => issue.evidenceStatus === 'VERIFIED' && issue.operation === 'EXPLAIN_RULE'),
      `${sample.id}: the commencement scope is a verified explanatory issue; got ${JSON.stringify(stream.issues.map(({ subject, topicIds, operation, evidenceStatus, gaps }) => ({ subject, topicIds, operation, evidenceStatus, gaps })))}`);
    assert.ok(stream.sources.some(source => source.officialUrl === sample.url && source.claims.some(claim =>
      claim.supportKind === 'EXACT_SOURCE_QUOTE' && Boolean(claim.fetchedSourceBinding?.canonicalUrl) &&
      canonicalUrl(claim.fetchedSourceBinding.canonicalUrl) === canonicalUrl(sample.url) &&
      claim.issueIds.some(id => stream.issues.some(issue => issue.id === id)))),
    `${sample.id}: exact issue-bound quotes from the retained source support the answer`);
    assert.match(response.messageText, new RegExp(`${sample.authority} rule explanation`, 'i'),
      `${sample.id}: processAccountingQuery renders the source-backed answer`);
    assert.match(response.messageText, sample.expected, `${sample.id}: rendered answer gives the bounded commencement conclusion`);
    if (sample.forbidden) assert.doesNotMatch(response.messageText, sample.forbidden, `${sample.id}: no unsupported retroactive claim is made`);
    results.push({ id: sample.id, scenarioType: response.scenarioState.scenarioType,
      queryIntent: response.scenarioState.queryIntent });
  }
  const wrongNoticeQuery = 'Can misconduct Notice SFA 04-N11 effective 1 January 2027 already govern an October 2026 report?';
  let wrongNoticeWorkstreams;
  const wrongNoticeResponse = await processAccountingQuery(wrongNoticeQuery, null, 'SFRS_I', undefined, undefined, [], undefined,
    { onAuthorityWorkstreams: value => { wrongNoticeWorkstreams = value; } });
  assert.deepEqual(wrongNoticeResponse.scenarioState.directGroups || [], [], 'wrong notice identity creates no journal');
  assert.ok(wrongNoticeWorkstreams, 'wrong notice identity still reaches the normal authority review path');
  assert.doesNotMatch(wrongNoticeResponse.messageText,
    /MAS rule explanation:[\s\S]*?(?:SFA 04-N24 takes effect|no later than 21 calendar days after the date it first has reasonable grounds)/i,
    'the N24 commencement answer is not rendered for an explicitly named N11 query');
} finally {
  globalThis.fetch = previousFetch;
}

assert.ok(fetchAttempts.includes(acraRule.officialUrl), 'whole-entry ACRA questions fetch the exact retained commencement source');
assert.ok(fetchAttempts.includes(masRule.officialUrl), 'whole-entry MAS questions fetch the exact retained native PDF');
assert.equal(fetchAttempts.some(url => modelEndpoint.test(url)), false, 'the frozen offline replay invokes no model endpoint');
console.log(`Bounded commencement questions passed full source-backed application regressions: ${JSON.stringify(results)}.`);
