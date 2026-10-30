import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  STATUTORY_WORKFLOW_RULES_20261029,
  getStatutoryWorkflowEvidence,
  selectStatutoryWorkflowQuotes,
  supportStatutoryWorkflowRule
} from '../../src/retrieval/statutoryWorkflows20261029.ts';
import { cleanHtmlText, cleanHtmlTextPreservingTableCells } from '../../src/retrieval/sourceAdapters.ts';
import { extractPdfDocumentText } from '../../src/retrieval/pdfDocumentTextExtractor.ts';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { loadStatutoryKnowledgeSources } from '../../scripts/load_statutory_knowledge_sources.mjs';
import { OFFICIAL_SOURCE_DISCOVERY_PROVIDERS } from '../../src/retrieval/officialSitemapDiscovery.ts';
import { createAuthorityEvidencePresentation } from '../../src/utils/authorityEvidencePresentation.ts';

const expansionRoot = new URL('../fixtures/statutoryKnowledge20261030/', import.meta.url);
const expansionManifest = JSON.parse(await readFile(new URL('expansion-source-manifest.json', expansionRoot), 'utf8'));
const workflowRoot = new URL('../fixtures/statutoryWorkflows20261029/', import.meta.url);
const workflowManifest = JSON.parse(await readFile(new URL('workflows-source-manifest.json', workflowRoot), 'utf8'));
const masRoot = new URL('../fixtures/statutoryExpansionSources/', import.meta.url);
const masManifest = JSON.parse(await readFile(new URL('mom-acra-mas-source-manifest.json', masRoot), 'utf8'));

const htmlSources = new Map([
  ...expansionManifest.sources.map(source => [source.fixture, { ...source, root: expansionRoot, hash: source.sha256, url: source.url }]),
  ...workflowManifest.sources.map(source => [source.fixture, { ...source, root: workflowRoot, hash: source.fixtureSha256, url: source.url }])
]);
const masSource = masManifest.sources.find(source => source.fixture === 'mas-vcfm-toolkit.pdf');
assert.ok(masSource, 'the MAS VCFM native PDF source record is retained');
const masBytes = await readFile(new URL(masSource.fixture, masRoot));
assert.equal(createHash('sha256').update(masBytes).digest('hex'), masSource.documentSha256,
  'the MAS VCFM PDF fixture bytes match the retained source digest');
const masPdf = await pdfjs.getDocument({ data: new Uint8Array(masBytes), disableWorker: true }).promise;
const masPages = [];
for (let pageNumber = 1; pageNumber <= masPdf.numPages; pageNumber += 1) {
  const page = await masPdf.getPage(pageNumber);
  const text = await page.getTextContent();
  masPages.push(text.items.map(item => item.str).join(' '));
}
const cessationText = masPages.find(page => /6\s+To notify MAS where a VCFM:/i.test(page));
const particularsText = masPages.find(page => /11\s+To notify MAS of any change in:/i.test(page));
assert.ok(cessationText, 'the exact Form 7 row is extracted from the retained MAS PDF');
assert.ok(particularsText, 'the exact Form 23A row is extracted from the retained MAS PDF');

async function htmlText(fixture) {
  const source = htmlSources.get(fixture);
  assert.ok(source, `the native source manifest includes ${fixture}`);
  const bytes = await readFile(new URL(fixture, source.root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), source.hash,
    `${fixture} bytes match the immutable source manifest`);
  const raw = bytes.toString('utf8');
  return (/<table\b/i.test(raw) ? cleanHtmlTextPreservingTableCells(raw) : cleanHtmlText(raw))
    .replace(/\r/g, '').replace(/\n{2,}/g, '\n').trim();
}

const cases = [
  {
    id: 'iras-donations', ruleId: 'IRAS_COMPANY_APPROVED_DONATIONS', topic: 'iras-cit-donations',
    authority: 'IRAS', domain: 'IRAS_CORPORATE_TAX', population: 'COMPANY', fixture: 'iras-donations-native.html',
    query: 'For corporate income tax, how does our company adjust donations to approved IPCs and other charities in its tax computation? Explain the enhanced deduction period and what the company must give the IPC.',
    subject: 'IRAS corporate income tax approved donations',
    rendered: /Donations are non-deductible expenses.*1 January 2016.*31 December 2029.*2\.5 times.*UEN.*pre-filled.*preceding-financial-year basis/i
  },
  {
    id: 'cpf-rectifications', ruleId: 'CPF_CONTRIBUTION_RECORD_RECTIFICATIONS', topic: 'cpf-record-rectifications',
    authority: 'CPF', domain: 'CPF_CONTRIBUTIONS', population: 'EMPLOYER', fixture: 'cpf-rectifications-native.html',
    query: 'We declared the wrong CPF wage amount and used an incorrect contribution month. Does changing the record mean we receive a refund? What should payroll do about underpaid contributions?',
    subject: 'CPF contribution rectification, refund or adjustment',
    rendered: /rectify.*immediately.*arrears.*late[- ]payment interest.*inform (?:the )?CPF Board.*refund or adjustment.*chang(?:e|es) the contribution record/i
  },
  {
    id: 'mom-payslips', ruleId: 'MOM_ITEMISED_PAYSLIP_REQUIREMENTS', topic: 'mom-itemised-payslips',
    authority: 'MOM', domain: 'MOM_EMPLOYMENT', population: 'EMPLOYER', fixture: 'mom-payslips.html',
    query: 'For our Employment Act-covered staff, how long must we keep itemised payslips for current employees and employees who have left, and are electronic records allowed?',
    subject: 'MOM itemised payslip content, format and retention requirements',
    rendered: /pay slip must include.*basic salary.*allowances.*overtime.*latest two years.*one year after they leave.*only applicable pay slip items/i
  },
  {
    id: 'acra-registered-office', ruleId: 'ACRA_REGISTERED_OFFICE_REQUIREMENTS', topic: 'acra_registered-office',
    authority: 'ACRA', domain: 'ACRA_CORPORATE', population: 'COMPANY', fixture: 'acra-registered-office-native.html',
    query: 'Our local Singapore company operates its factory in Tuas. May its registered office be in Raffles Place instead, and what public access, business-day opening hours, records and notices requirements apply?',
    subject: 'ACRA local company registered office access and requirements',
    rendered: /official Singapore address.*records and registers.*at least three hours on each business day.*normal business hours.*need not be the place/i
  },
  {
    id: 'mas-vcfm-form23a', ruleId: 'MAS_VCFM_CHANGE_NOTIFICATIONS', topic: 'mas-vcfm-change-notifications',
    authority: 'MAS', domain: 'MAS_REGULATORY_REPORTING', population: 'COMPANY', fixture: 'mas-vcfm-toolkit.pdf',
    query: 'Our VCFM is appointing a director and changing its principal place of business. What Form23A change notification does the current MAS toolkit require, and what is the time limit?',
    subject: 'VCFM Form 23A change notification', sourceText: particularsText, documentHash: masSource.documentSha256,
    sourceUrl: masSource.officialUrl,
    rendered: /A VCFM must notify MAS using Form 23A within 14 days from the date of a change.*CEO, directors or shareholders.*resignations and appointments/i
  },
  {
    id: 'mas-vcfm-form7', ruleId: 'MAS_VCFM_BUSINESS_CESSATION', topic: 'mas-vcfm-business-cessation',
    authority: 'MAS', domain: 'MAS_REGULATORY_REPORTING', population: 'COMPANY', fixture: 'mas-vcfm-toolkit.pdf',
    query: 'Under the current MAS VCFM toolkit, how do the Form7 deadlines differ between ceasing a regulated activity and failing to commence an activity within six months of licence grant? What customer-obligation certification accompanies cessation?',
    subject: 'VCFM Form 7 cessation and noncommencement notification', sourceText: cessationText, documentHash: masSource.documentSha256,
    sourceUrl: masSource.officialUrl,
    rendered: /submit Form 7.*within 14 days after the cessation.*audit certification.*fully discharged all customer obligations.*end of six months/i
  }
];

for (const sample of cases) {
  const rule = STATUTORY_WORKFLOW_RULES_20261029.find(candidate => candidate.id === sample.ruleId);
  assert.ok(rule, `${sample.id}: its bounded workflow rule is registered`);
  assert.ok(rule.topicIds.includes(sample.topic), `${sample.id}: the workflow owns the expected topic`);
  assert.equal(rule.fixtureFile, sample.fixture, `${sample.id}: metadata points to its retained native fixture`);
  const sourceText = sample.sourceText || await htmlText(sample.fixture);
  const proofText = sourceText.replace(/\r/g, '').replace(/[\t ]+/g, ' ').replace(/ +\n/g, '\n').trim();
  const source = htmlSources.get(sample.fixture);
  const officialUrl = sample.sourceUrl || source?.url;
  const documentHash = sample.documentHash || source?.hash;
  assert.equal(rule.officialUrl, officialUrl, `${sample.id}: the rule pointer matches its immutable source manifest`);

  const input = { authority: sample.authority, topicId: sample.topic, query: sample.query,
    subject: sample.subject, sourceText, officialUrl };
  assert.equal(supportStatutoryWorkflowRule(input), true,
    `${sample.id}: the retained official source proves the rule; missing=${rule.requiredSourceTerms.filter(term => !sourceText.toLowerCase().replace(/\s+/g, ' ').includes(term.toLowerCase().replace(/\s+/g, ' '))).join('|')}; quotes=${rule.quoteMatchers.map(pattern => pattern.test(sourceText))};`);
  const quotes = selectStatutoryWorkflowQuotes(input);
  assert.ok(quotes.length > 0, `${sample.id}: source proof selects bounded passages`);
  assert.equal(supportStatutoryWorkflowRule({ ...input, sourceText: '' }), false,
    `${sample.id}: missing evidence fails closed`);
  assert.equal(supportStatutoryWorkflowRule({ ...input, officialUrl: 'https://example.com/wrong-source' }), false,
    `${sample.id}: a noncanonical source URL fails closed`);
  assert.equal(supportStatutoryWorkflowRule({ ...input, topicId: 'unrelated-topic' }), undefined,
    `${sample.id}: the rule does not claim an unrelated topic`);

  const issueId = `p3-workflow-${sample.id}`;
  const issue = { id: issueId, subject: sample.subject, population: sample.population, operation: 'EXPLAIN_RULE',
    evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', claims: [], gaps: [] };
  const binding = { recordId: `source-${sample.id}`, documentHash, canonicalUrl: officialUrl,
    retrievedAt: '2026-10-30T00:00:00.000Z' };
  const claim = { text: sourceText, supportKind: 'EXACT_SOURCE_QUOTE', issueIds: [issueId], provenance: 'LIVE_EXTERNAL',
    fetchedSourceBinding: binding };
  const stream = { id: `stream-${sample.id}`, authority: sample.authority, domain: sample.domain,
    authorityLabel: sample.authority, domainLabel: 'Statutory guidance', evidenceStatus: 'VERIFIED',
    applicationStatus: 'UNRESOLVED', issues: [issue], sources: [{ key: binding.recordId, title: rule.title,
      publisher: sample.authority, documentTitle: rule.title, officialUrl, provenance: 'LIVE_EXTERNAL', claims: [claim] }], gaps: [] };
  const evidence = getStatutoryWorkflowEvidence(sample.query, stream, issue);
  assert.ok(evidence, `${sample.id}: exact-URL, issue-bound claims permit a general explanation`);
  assert.equal(evidence.officialUrl, officialUrl);
  assert.match(evidence.text, sample.rendered, `${sample.id}: explanation contains the source-backed workflow`);
  assert.equal(getStatutoryWorkflowEvidence(sample.query, { ...stream, domain: 'UNRELATED_DOMAIN' }, issue), undefined,
    `${sample.id}: a workstream from another domain cannot render the rule`);
  assert.equal(getStatutoryWorkflowEvidence(sample.query, { ...stream,
    sources: [{ ...stream.sources[0], officialUrl: 'https://example.com/wrong-source' }] }, issue), undefined,
  `${sample.id}: displayed evidence from another URL cannot render the rule`);
  assert.equal(getStatutoryWorkflowEvidence(sample.query, { ...stream,
    sources: [{ ...stream.sources[0], claims: [{ ...claim, issueIds: ['another-issue'] }] }] }, issue), undefined,
  `${sample.id}: quotes attached to a different issue cannot render the rule`);

  const firstMatcher = rule.quoteMatchers[0];
  const firstMatch = firstMatcher.exec(proofText);
  assert.ok(firstMatch, `${sample.id}: proof contract matches text extracted from the native source`);
  const splitAt = firstMatch.index + Math.floor(firstMatch[0].length / 2);
  const splitClaims = [
    { ...claim, text: proofText.slice(0, splitAt), fetchedSourceBinding: { ...binding, recordId: `${binding.recordId}-a` } },
    { ...claim, text: proofText.slice(splitAt), fetchedSourceBinding: { ...binding, recordId: `${binding.recordId}-b`, documentHash: 'a'.repeat(64) } }
  ];
  assert.equal(getStatutoryWorkflowEvidence(sample.query, { ...stream,
    sources: [{ ...stream.sources[0], claims: splitClaims }] }, issue), undefined,
  `${sample.id}: premises split across different source revisions cannot be combined`);

  assert.equal(supportStatutoryWorkflowRule({ ...input, query: `Under the 2024 rules, ${sample.query}` }), false,
    `${sample.id}: current captured guidance does not prove a historical version`);
}

const donationRule = STATUTORY_WORKFLOW_RULES_20261029.find(rule => rule.id === 'IRAS_COMPANY_APPROVED_DONATIONS');
assert.equal(donationRule.officialUrl,
  'https://www.iras.gov.sg/taxes/corporate-income-tax/income-deductions-for-companies/business-expenses/tax-treatment-of-business-expenses-(a-f)',
  'donation guidance, including the UEN premise, is bound to the A-F page only');
const donationSource = htmlSources.get('iras-donations-native.html');
const naturalDonationQuery = 'We gave S$2,000 to an approved Singapore IPC in December 2026 and supplied our UEN. What corporate tax deduction is generally available, and until when does the enhanced deduction run under current guidance?';
const naturalDonationText = await htmlText('iras-donations-native.html');
const naturalDonationInput = { authority: 'IRAS', topicId: 'iras-cit-donations', query: naturalDonationQuery,
  subject: 'IRAS corporate income tax approved donations', sourceText: naturalDonationText, officialUrl: donationRule.officialUrl };
assert.equal(supportStatutoryWorkflowRule(naturalDonationInput), true,
  'Natural “gave S$2,000 to an approved Singapore IPC” wording is owned by the A-F donation rule.');
assert.ok(selectStatutoryWorkflowQuotes(naturalDonationInput).length > 0,
  'The natural donation query selects proof only from the retained A-F page.');
const overlappingDonationSubject = 'Corporate income tax company record retention and approved donation deduction';
const overlappingDonationIssue = { id: 'donation-source-owned-issue', subject: overlappingDonationSubject,
  population: 'COMPANY', operation: 'EXPLAIN_RULE', evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', claims: [], gaps: [] };
const overlappingDonationClaim = { text: naturalDonationText, supportKind: 'EXACT_SOURCE_QUOTE',
  issueIds: [overlappingDonationIssue.id], provenance: 'LIVE_EXTERNAL', fetchedSourceBinding: {
    recordId: 'donation-source-owned-record', documentHash: donationSource.hash,
    canonicalUrl: donationRule.officialUrl, retrievedAt: '2026-10-30T00:00:00.000Z' } };
const overlappingDonationStream = { id: 'donation-source-owned-stream', authority: 'IRAS', domain: 'IRAS_CORPORATE_TAX',
  evidenceStatus: 'VERIFIED', issues: [overlappingDonationIssue], sources: [{ key: 'donation-source-owned-record',
    title: donationRule.title, publisher: 'IRAS', documentTitle: donationRule.title, officialUrl: donationRule.officialUrl,
    provenance: 'LIVE_EXTERNAL', claims: [overlappingDonationClaim] }] };
assert.equal(getStatutoryWorkflowEvidence(naturalDonationQuery, overlappingDonationStream, overlappingDonationIssue)?.officialUrl,
  donationRule.officialUrl,
  'An earlier generic IRAS record rule cannot steal a donation issue when only the later donation source proves it.');
const separateDonationBytes = await readFile(new URL('iras-donations-conditions-native.html', expansionRoot));
const separateDonationText = cleanHtmlText(separateDonationBytes.toString('utf8'));
const donationQuery = 'For our company, what corporate income tax treatment applies to donations to an approved IPC?';
const donationSubject = 'IRAS corporate income tax approved donations';
const donationIssueId = 'donation-single-document-proof';
const splitA = donationSource.hash;
const splitB = createHash('sha256').update(separateDonationBytes).digest('hex');
const donationRuleInput = { authority: 'IRAS', topicId: 'iras-cit-donations', query: donationQuery,
  subject: donationSubject, officialUrl: donationRule.officialUrl };
const splitDonationStream = {
  id: 'donation-split-source-stream', authority: 'IRAS', domain: 'IRAS_CORPORATE_TAX', evidenceStatus: 'VERIFIED',
  issues: [{ id: donationIssueId, subject: donationSubject, population: 'COMPANY', operation: 'EXPLAIN_RULE',
    evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', claims: [], gaps: [] }],
  sources: [
    { key: 'donation-a-f-partial', title: 'A-F', publisher: 'IRAS', documentTitle: 'A-F',
      officialUrl: donationRule.officialUrl, provenance: 'LIVE_EXTERNAL', claims: [{ text: 'Donations are non-deductible expenses',
        supportKind: 'EXACT_SOURCE_QUOTE', issueIds: [donationIssueId], provenance: 'LIVE_EXTERNAL', fetchedSourceBinding: {
          recordId: 'donation-a-f', documentHash: splitA, canonicalUrl: donationRule.officialUrl, retrievedAt: '2026-10-30T00:00:00.000Z' } }] },
    { key: 'donation-other-partial', title: 'Donations and Tax Deductions', publisher: 'IRAS', documentTitle: 'Donations and Tax Deductions',
      officialUrl: 'https://www.iras.gov.sg/taxes/other-taxes/charities/donations-tax-deductions', provenance: 'LIVE_EXTERNAL',
      claims: [{ text: separateDonationText, supportKind: 'EXACT_SOURCE_QUOTE', issueIds: [donationIssueId], provenance: 'LIVE_EXTERNAL',
        fetchedSourceBinding: { recordId: 'donation-conditions', documentHash: splitB,
          canonicalUrl: 'https://www.iras.gov.sg/taxes/other-taxes/charities/donations-tax-deductions', retrievedAt: '2026-10-30T00:00:00.000Z' } }] }
  ]
};
assert.equal(getStatutoryWorkflowEvidence(donationQuery, splitDonationStream, splitDonationStream.issues[0]), undefined,
  'IRAS donation premises cannot be assembled from the A-F and separate donations page');
assert.equal(supportStatutoryWorkflowRule({ ...donationRuleInput, officialUrl: 'https://www.iras.gov.sg/taxes/other-taxes/charities/donations-tax-deductions',
  sourceText: separateDonationText }), false,
'the separate IRAS donations page cannot substitute for the captured A-F source contract');

const structuredVcfm = await extractPdfDocumentText(new Uint8Array(masBytes));
for (const sample of cases.filter(sample => sample.authority === 'MAS')) {
  const rule = STATUTORY_WORKFLOW_RULES_20261029.find(rule => rule.id === sample.ruleId);
  const request = { authority: 'MAS', topicId: sample.topic, query: sample.query, subject: sample.subject,
    officialUrl: rule.officialUrl, sourceText: structuredVcfm.text };
  assert.equal(supportStatutoryWorkflowRule(request), true, 'the maintained structured PDF extractor proves the actual row');
  const row = selectStatutoryWorkflowQuotes(request)[0];
  const neighbor = sample.ruleId === 'MAS_VCFM_CHANGE_NOTIFICATIONS'
    ? '12 To notify MAS on suspension Within 14 days from the date of change'
    : '7 To notify MAS of any matter Within 14 days after the cessation';
  assert.equal(supportStatutoryWorkflowRule({ ...request,
    sourceText: row.replace(/14 days/i, '13 days') + '\n' + neighbor }), false,
  'a correct deadline in a neighboring row cannot repair the owned row');
}

const pages = new Map();
for (const directory of ['tests/fixtures/statutoryWorkflows20261029', 'tests/fixtures/statutoryKnowledge20261027b',
  'tests/fixtures/statutoryKnowledge20261030']) {
  for (const page of await loadStatutoryKnowledgeSources(directory)) pages.set(page.sourceUrl,
    { authority: page.authority, body: page.body, type: page.contentType });
}
const vcfmUrl = STATUTORY_WORKFLOW_RULES_20261029.find(rule => rule.id === 'MAS_VCFM_BUSINESS_CESSATION').officialUrl;
pages.set(vcfmUrl, { authority: 'MAS', body: masBytes, type: 'application/pdf' });
const modelRequests = [];
const savedFetch = globalThis.fetch;
globalThis.fetch = async input => {
  const url = typeof input?.url === 'string' ? input.url : String(input);
  if (/generativelanguage|api\.openai|generateContent|chat\/completions/i.test(url)) modelRequests.push(url);
  const page = pages.get(url);
  if (page) return new Response(page.body, { headers: { 'content-type': page.type } });
  const provider = Object.values(OFFICIAL_SOURCE_DISCOVERY_PROVIDERS).find(provider => provider.sitemapUrls?.includes(url));
  if (provider) return new Response('<urlset>' + [...pages].filter(([,page]) => page.authority === provider.authority)
    .map(([url]) => `<url><loc>${url.replaceAll('&', '&amp;')}</loc></url>`).join('') + '</urlset>',
  { headers: { 'content-type': 'application/xml' } });
  return new Response('Unavailable in frozen fixture set', { status: 404 });
};
try {
  const acceptance = JSON.parse(await readFile(new URL('../../artifacts/statutory-knowledge-expansion-20261030/expansion-acceptance.json', import.meta.url), 'utf8'));
  const substantive = [
    /2\.5 times[\s\S]*31 December 2029[\s\S]*UEN/i,
    /rectify[\s\S]*immediately[\s\S]*inform CPF Board[\s\S]*adjustment/i,
    /latest two years[\s\S]*last two years[\s\S]*one year/i,
    /Singapore address[\s\S]*three hours[\s\S]*business day/i,
    /Form 23A[\s\S]*14 days[\s\S]*date of[\s\S]*change/i,
    /Form 7[\s\S]*14 days[\s\S]*audit certification[\s\S]*six.month/i
  ];
  for (const [index, sample] of acceptance.cases.entries()) {
    let workstreams;
    const response = await processAccountingQuery(sample.question, null, 'IFRS', undefined, undefined, [], undefined,
      { onAuthorityWorkstreams: value => { workstreams = value; } });
    assert.ok(workstreams, `${sample.id}: full application reaches governed evidence`);
    assert.deepEqual(response.scenarioState.directGroups || [], [], `${sample.id}: no unrequested journal`);
    assert.match(response.messageText, substantive[index], `${sample.id}: substantive workflow answer`);
    const presentation = createAuthorityEvidencePresentation(workstreams);
    assert.ok(presentation.workstreams.some(stream => stream.authority === sample.authority && stream.sources.some(source =>
      source.claims.some(claim => claim.supportKind === 'EXACT_SOURCE_QUOTE' && claim.fetchedSourceBinding?.documentHash))),
    `${sample.id}: exact fetched-revision evidence is present`);
  }
  const combined = 'Our venture capital fund manager has not confirmed its financial year-end. Can we use the calendar-year nil-misconduct return deadline for Form 25A and assume that filing Form 25A also completes every reporting obligation of the funds we manage?';
  for (const combinedQuestion of [combined, 'Our VCFM has not confirmed its financial year-end. Can we use the nil-misconduct date to set Form 25A and treat it as satisfying all fund returns?']) {
  let masWorkstreams;
  const masAnswer = await processAccountingQuery(combinedQuestion, null, 'IFRS', undefined, undefined, [], undefined,
    { onAuthorityWorkstreams: value => { masWorkstreams = value; } });
  assert.match(masAnswer.messageText, /within one month after[\s\S]*financial year end/i);
  assert.match(masAnswer.messageText, /not required[\s\S]*2026[\s\S]*1 January 2027/i);
  assert.match(masAnswer.messageText, /not exhaustive[\s\S]*fund.level/i);
  const masPresentation = createAuthorityEvidencePresentation(masWorkstreams);
  for (const stream of masPresentation.workstreams) for (const issue of stream.issues.filter(issue => /MAS VCFM/.test(issue.subject))) {
    assert.equal(stream.sources.some(source => /toolkit-lfmcs/.test(source.officialUrl) &&
      source.claims.some(claim => claim.issueIds.includes(issue.id))), false,
    'VCFM annual, nil and scope issues cannot borrow LFMC quotations');
  }
  }
} finally { globalThis.fetch = savedFetch; }
assert.equal(modelRequests.length, 0, 'full workflow regressions make no model requests');
console.log('Source-backed statutory workflow expansion, full applications and provenance checks passed.');
