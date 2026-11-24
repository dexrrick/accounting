import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { OFFICIAL_SOURCE_DISCOVERY_PROVIDERS } from '../../src/retrieval/officialSitemapDiscovery.ts';
import { getIrasMasKnowledgeEvidence, selectIrasMasKnowledgeQuotes,
  supportIrasMasKnowledgeRule } from '../../src/retrieval/irasMasKnowledge20261027b.ts';
import { loadStatutoryKnowledgeSources } from '../../scripts/load_statutory_knowledge_sources.mjs';
import { STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES } from '../fixtures/statutoryCoverageOfficialPages.mjs';

const masQuery = 'Can a licensed investment manager use the MAS LFMC compliance toolkit as a complete checklist for the funds it manages, including duties outside the Securities and Futures Act?';
const irasQuery = "We paid expenses for a subsidiary's car and recovered only half. Is every dollar of its input GST recoverable?";
const masUrl = 'https://www.mas.gov.sg/-/media/mas-media-library/regulation/guidance/cmi/compliance-toolkits-for-fund-management-companies/sfa-compliance-toolkit-lfmcs29-may-2026-clean.pdf';

const developmentRoot = new URL('../fixtures/statutoryDevelopment20261027/', import.meta.url);
const developmentManifest = JSON.parse(await readFile(new URL('iras-cpf-mas-source-manifest.json', developmentRoot), 'utf8'));
const masManifest = developmentManifest.sources.find(source => source.authority === 'MAS' && source.nativePdfFixture === 'mas-lfmc-toolkit.pdf');
assert.ok(masManifest, 'the retained native MAS LFMC toolkit capture is available');
assert.equal(masManifest.url, masUrl, 'the MAS source pointer identifies the canonical toolkit URL');
const masPdf = await readFile(new URL(masManifest.nativePdfFixture, developmentRoot));
assert.equal(createHash('sha256').update(masPdf).digest('hex'), masManifest.sourceDocumentSha256.toLowerCase(),
  'the MAS PDF bytes match the retained source manifest');
const masExtract = await readFile(new URL('mas-lfmc-native-extract.txt', developmentRoot), 'utf8');
const masInput = { authority: 'MAS', topicId: 'mas-lfmc', query: masQuery,
  subject: 'MAS LFMC toolkit scope and fund-level requirements', sourceText: masExtract, officialUrl: masUrl };
assert.equal(supportIrasMasKnowledgeRule(masInput), true,
  'the native PDF extraction proves all LFMC scope premises');
assert.equal(supportIrasMasKnowledgeRule({ ...masInput, officialUrl: `${masUrl}?revision=other` }), false,
  'a noncanonical MAS URL fails closed');
assert.equal(supportIrasMasKnowledgeRule({ ...masInput,
  sourceText: masExtract.replace('However, it is not exhaustive', 'However, it is exhaustive') }), false,
  'a reversed scope passage cannot prove the MAS conclusion');
assert.equal(supportIrasMasKnowledgeRule({ ...masInput,
  query: 'Can a VCFM use its toolkit as a complete checklist including fund-level duties?' }), undefined,
  'the LFMC rule does not claim VCFM toolkit requirements');

const masQuotes = selectIrasMasKnowledgeQuotes(masInput);
assert.equal(masQuotes.length, 3, 'all native scope premises are selected as full source passages');
const masIssueId = 'mas-toolkit-scope-issue';
const masRevision = {
  recordId: 'mas-lfmc-toolkit-record', documentHash: masManifest.sourceDocumentSha256.toLowerCase(),
  canonicalUrl: masUrl, retrievedAt: '2026-10-30T00:00:00.000Z'
};
const masPresentedIssue = {
  id: masIssueId, subject: 'MAS LFMC toolkit scope and fund-level requirements', population: 'Company',
  operation: 'EXPLAIN_RULE', evidenceStatus: 'VERIFIED', applicationStatus: 'NOT_REQUIRED'
};
const masPresentedSource = {
  key: masRevision.recordId, title: masManifest.title, publisher: 'Monetary Authority of Singapore',
  documentTitle: masManifest.title, officialUrl: masUrl, provenance: 'LIVE_EXTERNAL',
  claims: masQuotes.map(text => ({ text, supportKind: 'EXACT_SOURCE_QUOTE', issueIds: [masIssueId],
    provenance: 'LIVE_EXTERNAL', fetchedSourceBinding: { ...masRevision } }))
};
const masPresentedStream = {
  id: 'MAS:MAS_FUNDS', authority: 'MAS', domain: 'MAS_FUNDS', evidenceStatus: 'VERIFIED',
  issues: [masPresentedIssue], sources: [masPresentedSource]
};
assert.match(getIrasMasKnowledgeEvidence(masQuery, masPresentedStream, masPresentedIssue)?.text || '', /not exhaustive/i,
  'the full issue-bound scope quotes from one fetched PDF revision allow the LFMC rule explanation');
assert.equal(getIrasMasKnowledgeEvidence(masQuery, { ...masPresentedStream,
  sources: [{ ...masPresentedSource, officialUrl: `${masUrl}?revision=other` }] }, masPresentedIssue), undefined,
  'a noncanonical displayed source URL cannot render the LFMC rule');
assert.equal(getIrasMasKnowledgeEvidence(masQuery, { ...masPresentedStream,
  sources: [{ ...masPresentedSource, claims: masPresentedSource.claims.slice(0, 2) }] }, masPresentedIssue), undefined,
  'missing the outside-SFA/fund-level exclusion passage blocks rendering');
const splitRevisionSource = structuredClone(masPresentedSource);
splitRevisionSource.claims[2].fetchedSourceBinding.documentHash = 'a'.repeat(64);
assert.equal(getIrasMasKnowledgeEvidence(masQuery, { ...masPresentedStream, sources: [splitRevisionSource] }, masPresentedIssue), undefined,
  'scope passages split across fetched PDF revisions cannot be combined');
const otherIssueSource = structuredClone(masPresentedSource);
otherIssueSource.claims[2].issueIds = ['another-issue'];
assert.equal(getIrasMasKnowledgeEvidence(masQuery, { ...masPresentedStream, sources: [otherIssueSource] }, masPresentedIssue), undefined,
  'a scope exclusion quote assigned to another issue cannot support this answer');
assert.equal(getIrasMasKnowledgeEvidence('Can a VCFM use its toolkit as a complete checklist including fund-level duties?',
  masPresentedStream, masPresentedIssue), undefined, 'the rendered LFMC scope explanation does not generalize to VCFMs');

const statutoryPages = await loadStatutoryKnowledgeSources(fileURLToPath(new URL('../fixtures/statutoryKnowledge20261027b', import.meta.url)));
const irasPage = statutoryPages.find(page => page.filename === 'iras-mas-input-tax-native.html');
assert.ok(irasPage, 'the IRAS native input-tax page capture is available');
const irasBytes = Buffer.isBuffer(irasPage.body) ? irasPage.body : Buffer.from(String(irasPage.body));
const irasManifest = JSON.parse(await readFile(new URL('../fixtures/statutoryKnowledge20261027b/iras-mas-source-manifest.json', import.meta.url), 'utf8'));
const irasSource = irasManifest.sources.find(source => source.fixture === 'iras-mas-input-tax-native.html');
assert.ok(irasSource, 'the IRAS source digest is retained');
assert.equal(createHash('sha256').update(irasBytes).digest('hex'), irasSource.sha256,
  'the IRAS native response matches its retained digest');

const pages = new Map(STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES.map(page => [page.sourceUrl,
  { authority: page.authority, body: page.html, type: 'text/html' }]));
for (const page of statutoryPages) pages.set(page.sourceUrl, {
  authority: page.authority, body: page.body, type: page.contentType
});
pages.set(masUrl, { authority: 'MAS', body: masPdf, type: 'application/pdf' });
const modelEndpoint = /(?:generativelanguage\.googleapis\.com|api\.openai\.com|openai\.azure\.com|\/generateContent(?:\?|$)|\/chat\/completions(?:\?|$))/i;
const fetchAttempts = [];
const offlineFetch = async input => {
  const url = input && typeof input === 'object' && typeof input.url === 'string' ? input.url : String(input);
  fetchAttempts.push(url);
  if (modelEndpoint.test(url)) throw new Error(`Unexpected provider/model request: ${url}`);
  const page = pages.get(url);
  if (page) return new Response(page.body, { headers: { 'content-type': page.type } });
  const provider = Object.values(OFFICIAL_SOURCE_DISCOVERY_PROVIDERS).find(candidate => candidate.sitemapUrls?.includes(url));
  if (provider) {
    const entries = [...pages].filter(([, item]) => item.authority === provider.authority)
      .map(([sourceUrl]) => `<url><loc>${sourceUrl.replaceAll('&', '&amp;')}</loc></url>`).join('');
    return new Response(`<urlset>${entries}</urlset>`, { headers: { 'content-type': 'application/xml' } });
  }
  return new Response('Unavailable in frozen offline source set', { status: 404 });
};

const previousFetch = globalThis.fetch;
const responses = new Map();
try {
  globalThis.fetch = offlineFetch;
  for (const [id, query] of [['mas-scope', masQuery], ['iras-partial-recovery', irasQuery]]) {
    responses.set(id, await processAccountingQuery(query, null, 'IFRS', undefined, undefined, [], undefined));
  }
} finally {
  globalThis.fetch = previousFetch;
}

assert.equal(fetchAttempts.some(url => modelEndpoint.test(url)), false, 'the offline full application uses no model endpoint');
assert.ok(fetchAttempts.includes(masUrl), 'the full MAS answer retrieves the exact toolkit PDF');
const irasAnswer = responses.get('iras-partial-recovery');
assert.equal(irasAnswer.scenarioState.queryIntent, 'STATUTORY_ADVISORY');
assert.deepEqual(irasAnswer.scenarioState.directGroups || [], [], 'the IRAS question creates no accounting journal');
assert.match(irasAnswer.messageText, /IRAS rule explanation/i);
assert.match(irasAnswer.messageText, /only to the extent of that half|only the recovered portion|portion recovered/i);
assert.match(irasAnswer.messageText, /not (?:be )?ancillary to (?:a primary supply|any primary supply)/i);
assert.match(irasAnswer.messageText, /ordinary claim conditions/i);
assert.match(irasAnswer.messageText, /not.*unrecovered half|not.*all/i);

const masAnswer = responses.get('mas-scope');
assert.equal(masAnswer.scenarioState.queryIntent, 'STATUTORY_ADVISORY');
assert.deepEqual(masAnswer.scenarioState.directGroups || [], [], 'the MAS scope question creates no accounting journal');
assert.match(masAnswer.messageText, /MAS rule explanation/i);
assert.match(masAnswer.messageText, /not exhaustive/i);
assert.match(masAnswer.messageText, /outside the SFA/i);
assert.match(masAnswer.messageText, /fund-level requirements/i);
assert.match(masAnswer.messageText, /not a complete checklist/i);

console.log('Full application MAS toolkit scope and IRAS connected-person partial recovery checks passed.');
