import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { supportStatutoryKnowledgeRule, STATUTORY_KNOWLEDGE_RULES_20261027B,
  selectStatutoryKnowledgeQuotes } from '../../src/retrieval/statutoryKnowledge20261027b.ts';
import { defaultSourceCache } from '../../src/retrieval/sourceCache.ts';
import { OFFICIAL_SOURCE_DISCOVERY_PROVIDERS } from '../../src/retrieval/officialSitemapDiscovery.ts';
import { STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES } from '../fixtures/statutoryCoverageOfficialPages.mjs';

const medicalQuery = 'Is GST on an employee medical examination for renewing a work permit recoverable simply because the employer had to arrange it?';
const treatyQuery = 'If a treaty reduces withholding tax to zero, can we omit the WHT filing?';
const transferredPaymentWht = 'We transferred a payment to a non-resident on 14 October 2026. Does that transaction date change the general rule for when WHT must be filed and paid?';
const datedWhtQueries = [
  'We paid a non-resident on 1 October 2026. When is withholding tax filing due?',
  'We will pay a non-resident on 12 November 2026. When is WHT filing due?'
];
const medicalRule = STATUTORY_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'IRAS_GST_STAFF_MEDICAL_INPUT_TAX');
const whtRule = STATUTORY_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'IRAS_WHT_FILING_DATE');
assert.ok(medicalRule && whtRule, 'the reviewed native IRAS rule fixtures are registered');

const basePages = new Map(STATUTORY_COVERAGE_OFFICIAL_PAGE_FIXTURES.map(page => [page.sourceUrl, {
  authority: page.authority, body: Buffer.from(page.html), type: 'text/html'
}]));
for (const rule of [medicalRule, whtRule]) {
  const body = readFileSync(new URL(`../fixtures/statutoryKnowledge20261027b/${rule.fixture}`, import.meta.url));
  basePages.set(rule.officialUrl, { authority: 'IRAS', body,
    type: rule.fixture.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'text/html' });
}
const medicalText = basePages.get(medicalRule.officialUrl).body.toString('utf8');
const medicalNativeQuotes = selectStatutoryKnowledgeQuotes({ authority: 'IRAS', topicId: medicalRule.topicIds[0],
  query: medicalQuery, subject: 'GST input tax on staff medical expenses', sourceText: medicalText, officialUrl: medicalRule.officialUrl });

const modelEndpointPattern = /(?:generativelanguage\.googleapis\.com|api\.openai\.com|openai\.azure\.com|\/generateContent(?:\?|$)|\/chat\/completions(?:\?|$))/i;
async function runApplication(query, { unavailableUrl, appendedHtml = '' } = {}) {
  const pages = new Map(basePages);
  if (appendedHtml) {
    const page = pages.get(medicalRule.officialUrl);
    const html = page.body.toString('utf8').replace(/<\/main\s*>/i, `${appendedHtml}</main>`);
    pages.set(medicalRule.officialUrl, { ...page, body: Buffer.from(html) });
  }
  const fetchAttempts = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = input && typeof input === 'object' && typeof input.url === 'string' ? input.url : String(input);
    fetchAttempts.push(url);
    if (url === unavailableUrl) return new Response('Unavailable in frozen offline source set', { status: 404 });
    const page = pages.get(url);
    if (page) return new Response(page.body, { headers: { 'content-type': page.type } });
    const provider = Object.values(OFFICIAL_SOURCE_DISCOVERY_PROVIDERS).find(candidate => candidate.sitemapUrls?.includes(url));
    if (provider) {
      const locations = [...pages].filter(([, candidate]) => candidate.authority === provider.authority)
        .map(([sourceUrl]) => `<url><loc>${sourceUrl.replaceAll('&', '&amp;')}</loc></url>`).join('');
      return new Response(`<urlset>${locations}</urlset>`, { headers: { 'content-type': 'application/xml' } });
    }
    return new Response('Unavailable in frozen offline source set', { status: 404 });
  };
  let workstreams;
  try {
    const response = await processAccountingQuery(query, null, 'IFRS', undefined, undefined, [], undefined, {
      onAuthorityWorkstreams: result => { workstreams = result; }
    });
    assert.equal(fetchAttempts.some(url => modelEndpointPattern.test(url)), false, 'the no-provider process path makes no model request');
    return { response, workstreams, fetchAttempts };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function irasIssue(result) {
  assert.equal(result.response.scenarioState?.scenarioType, 'AUTHORITY_ADVISORY', 'a mapped IRAS rule uses the authority-evidence route');
  assert.ok(result.workstreams, 'the normal processAccountingQuery path built authority workstreams');
  const stream = result.workstreams.workstreams.find(item => item.authority === 'IRAS');
  assert.ok(stream, 'the IRAS workstream is present');
  const issue = stream.issues[0];
  assert.ok(issue, 'the mapped IRAS issue is present');
  return { stream, issue };
}

function assertNativeCompleteRule(result, { query, rule, expectedAnswer, expectedQuote }) {
  const { stream, issue } = irasIssue(result);
  const source = issue.sources.find(item => item.provenance === 'LIVE_EXTERNAL' &&
    item.officialSourceUrl === rule.officialUrl && item.canonicalSourceUrl === rule.officialUrl);
  assert.ok(source, `the verified issue cites the exact native page for ${rule.id}`);
  assert.equal(issue.evidenceStatus, 'VERIFIED', 'the complete native rule passes both scoped evidence gates');
  assert.match(result.response.messageText, expectedAnswer, 'the complete rule is rendered by the actual application route');
  assert.match(result.response.messageText, expectedQuote, 'a complete native source passage remains visible');
  assert.ok(stream.verifiedClaims.length > 0, 'the workstream has verified exact-source claims');
  const sourceClaims = issue.verifiedClaims.filter(claim => claim.recordId === source.id && claim.supportKind === 'EXACT_SOURCE_QUOTE');
  assert.ok(sourceClaims.length > 0, 'rule claims are bound to the exact native record');
  const selected = selectStatutoryKnowledgeQuotes({ authority: 'IRAS', topicId: rule.topicIds[0], query,
    subject: issue.subject, sourceText: source.sourceText, officialUrl: rule.officialUrl });
  assert.ok(selected.length > 0, 'the same native record proves the requested complete rule family');
  assert.ok(selected.every(quote => sourceClaims.some(claim => claim.quote === quote)),
    'all required rule components are exact claims from the same fetched record revision');
  return { stream, issue, source };
}

const unavailable = await runApplication(medicalQuery, { unavailableUrl: medicalRule.officialUrl });
const unavailableIssue = irasIssue(unavailable).issue;
assert.equal(unavailableIssue.evidenceStatus, 'INSUFFICIENT', 'a narrower local summary cannot establish the complete requested medical rule');
assert.ok(unavailableIssue.sources.some(source => source.provenance === 'LOCAL_STATIC'),
  'the reviewed local summary remains available without marking the complete rule verified');
assert.ok(unavailableIssue.sources.every(source => source.provenance === 'LOCAL_STATIC'),
  'a failed native fetch cannot introduce a live full-rule source');
assert.equal(unavailableIssue.verifiedClaims.some(claim => claim.quote.includes('medical examinations incurred for the purpose of renewing my employees')),
  false, 'the unavailable page cannot contribute its permit-specific native quote');
assert.match(unavailable.response.messageText, /\*\*Whole-question status:\*\* Evidence is incomplete for one or more material issues/i,
  'the missing full rule remains visible in the whole-question status');

const medical = await runApplication(medicalQuery);
assertNativeCompleteRule(medical, {
  query: medicalQuery, rule: medicalRule,
  expectedAnswer: /IRAS rule explanation:[\s\S]*medical input tax is generally disallowed under regulation 26/i,
  expectedQuote: /medical examinations incurred for the purpose of renewing my employees[’'] work permits/i
});

const treaty = await runApplication(treatyQuery);
assertNativeCompleteRule(treaty, {
  query: treatyQuery, rule: whtRule,
  expectedAnswer: /IRAS rule explanation:[\s\S]*WHT still must be filed when a DTA or ARI makes the rate zero/i,
  expectedQuote: /WHT must be filed even if the payment to a non-resident is exempted under the Avoidance of Double Taxation Agreement/i
});

for (const query of [...datedWhtQueries, transferredPaymentWht]) {
  defaultSourceCache.invalidate(whtRule.officialUrl);
  const dated = await runApplication(query);
  assertNativeCompleteRule(dated, {
    query, rule: whtRule,
    expectedAnswer: /15th of the second month after its defined date of payment/i,
    expectedQuote: /The date of payment is defined as the earliest of the following dates/i
  });
  assert.doesNotMatch(dated.response.messageText, /your exact WHT due date is/i,
    'a general source passage does not calculate a deadline without all legally relevant dates');
}

defaultSourceCache.invalidate(medicalRule.officialUrl);
const contradictory = await runApplication(medicalQuery, {
  appendedHtml: '<p>Staff medical expenses are always claimable.</p>'
});
const contradictoryIssue = irasIssue(contradictory).issue;
assert.ok(contradictoryIssue.sources.every(source => source.provenance === 'LOCAL_STATIC'),
  'contradictory text cannot be admitted as a live full-rule source');
assert.equal(contradictoryIssue.verifiedClaims.some(claim => medicalNativeQuotes.includes(claim.quote)), false,
  'the contradiction veto prevents native full-rule component claims');
assert.doesNotMatch(contradictory.response.messageText, /Staff medical expenses are always claimable/i,
  'the contradictory passage is not rendered as authority evidence');
assert.match(contradictory.response.messageText, /\*\*Whole-question status:\*\* Evidence is incomplete for one or more material issues/i,
  'the query remains visibly incomplete without a contradiction-free full page');

assert.equal(supportStatutoryKnowledgeRule({ authority: 'IRAS', topicId: 'iras-gst-blocked-input-tax',
  query: medicalQuery, subject: 'GST input tax on staff medical expenses', sourceText: medicalText,
  officialUrl: 'https://not-iras.example/taxes/conditions-for-claiming-input-tax' }), false,
'the exact native text cannot prove the rule when the source URL is foreign');

assert.equal(supportStatutoryKnowledgeRule({ authority: 'IRAS', topicId: 'iras-withholding-tax',
  query: 'What WHT filing deadline and rate applied for payments in 2023 and 2026?',
  subject: 'Withholding tax filing and payment deadline',
  sourceText: basePages.get(whtRule.officialUrl).body.toString('utf8'), officialUrl: whtRule.officialUrl }), false,
'current WHT source text cannot prove a mixed-year historical rate question');

const calculation = await runApplication('Calculate the GST on a S$100 taxable sale.');
assert.notEqual(calculation.response.scenarioState?.scenarioType, 'AUTHORITY_ADVISORY',
  'a numeric GST calculation stays outside the general-rule workstream route');
const journalQuery = 'Record a purchase of office supplies for SGD 200 paid in cash.';
const journal = await runApplication(journalQuery);
assert.notEqual(journal.response.scenarioState?.scenarioType, 'AUTHORITY_ADVISORY',
  'an ordinary journal request stays outside the standalone IRAS rule route');

console.log('IRAS general-rule normal application path, exact-source controls and existing calculation/journal boundaries passed.');
