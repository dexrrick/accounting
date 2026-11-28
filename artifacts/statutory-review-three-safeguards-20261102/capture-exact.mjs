import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { loadStatutoryKnowledgeSources } from '../../scripts/load_statutory_knowledge_sources.mjs';
import { OFFICIAL_SOURCE_DISCOVERY_PROVIDERS } from '../../src/retrieval/officialSitemapDiscovery.ts';
import { supportCpfPayrollKnowledgeRule } from '../../src/retrieval/cpfPayrollKnowledge20261027b.ts';
import { defaultTargetDateResolver } from '../../src/retrieval/targetDateResolver.ts';

const sources = new Map();
for (const directory of [
  'tests/fixtures/statutoryKnowledge20261027b',
  'tests/fixtures/statutoryKnowledge20261030',
  'tests/fixtures/statutoryWorkflows20261029',
  'tests/fixtures/statutoryKnowledge20261031',
  'tests/fixtures/statutoryCpf20261101'
]) {
  for (const page of await loadStatutoryKnowledgeSources(directory)) {
    sources.set(page.sourceUrl, { authority: page.authority, body: page.body, type: page.contentType, title: page.title });
  }
}
const wageText = await readFile('tests/fixtures/statutoryExpansionSources/cpf-wage-classification.txt', 'utf8');
const wageUrl = 'https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions';
sources.set(wageUrl, {
  authority: 'CPF',
  title: 'What constitutes wages for CPF contributions',
  body: `<html><head><title>CPF | What constitutes wages for CPF contributions</title></head><body><main><h1>CPF | What constitutes wages for CPF contributions</h1><p>${wageText.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('\n', '<br>')}</p></main></body></html>`,
  type: 'text/html'
});

globalThis.fetch = async input => {
  const url = typeof input?.url === 'string' ? input.url : String(input);
  const page = sources.get(url);
  if (page) return new Response(page.body, { headers: { 'content-type': page.type } });
  const provider = Object.values(OFFICIAL_SOURCE_DISCOVERY_PROVIDERS).find(candidate => candidate.sitemapUrls?.includes(url));
  if (provider) {
    const links = [...sources].filter(([, source]) => source.authority === provider.authority)
      .map(([sourceUrl]) => `<url><loc>${sourceUrl.replaceAll('&', '&amp;')}</loc></url>`).join('');
    return new Response(`<urlset>${links}</urlset>`, { headers: { 'content-type': 'application/xml' } });
  }
  return new Response('Unavailable in frozen fixture set', { status: 404 });
};

const cases = [
  ['employee-name', "Employee Alice became a Singapore PR on 15 March 2026. Employee Bob remains a foreigner. Is CPF due on Bob's March Ordinary Wages?"],
  ['restrictive-reporting', 'Should the annual bonus that was earned in 2025 be reported as employment income, and does CPF apply to this bonus?'],
  ['relative-future-day', 'A foreign employee became a Singapore PR on 15 March 2026. The first contribution year ends on 31 March 2027. His bonus becomes payable the following day. Does the bonus attract CPF?']
];
const outcomes = [];
for (const [id, question] of cases) {
  let workstreams;
  const response = await processAccountingQuery(question, null, 'IFRS', undefined, undefined, [], undefined, {
    onAuthorityWorkstreams: value => { workstreams = value; }
  });
  outcomes.push({ id, question, response, workstreams });
}
const { writeFileSync } = await import('node:fs');
writeFileSync('artifacts/statutory-review-three-safeguards-20261102/exact-application-responses.json', JSON.stringify({ sourceProfile: 'frozen fixtures identical to test_statutory_cpf_expansion_20261101.mjs', externalRequests: 0, modelRequests: 0, outcomes }, null, 2) + '\n');
console.log('Captured ' + outcomes.length + ' exact application responses with fixture-only fetch.');
