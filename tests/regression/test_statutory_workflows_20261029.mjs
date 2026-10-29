import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  STATUTORY_WORKFLOW_RULES_20261029,
  getStatutoryWorkflowEvidence,
  hasStatutoryWorkflowContradiction,
  selectStatutoryWorkflowQuotes,
  supportStatutoryWorkflowRule
} from '../../src/retrieval/statutoryWorkflows20261029.ts';
import { cleanHtmlText, cleanHtmlTextPreservingTableCells } from '../../src/retrieval/sourceAdapters.ts';
import { TargetDateResolver } from '../../src/retrieval/targetDateResolver.ts';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { createAuthorityEvidencePresentation } from '../../src/utils/authorityEvidencePresentation.ts';
import { OFFICIAL_SOURCE_DISCOVERY_PROVIDERS } from '../../src/retrieval/officialSitemapDiscovery.ts';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { reconcileQuestionUnderstanding } from '../../src/services/semanticQuestionUnderstanding.ts';

const fixtureRoot = new URL('../fixtures/statutoryWorkflows20261029/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('workflows-source-manifest.json', fixtureRoot), 'utf8'));
const priorManifestRoot = new URL('../fixtures/statutoryDevelopment20261027/', import.meta.url);
const priorManifest = JSON.parse(readFileSync(new URL('iras-cpf-mas-source-manifest.json', priorManifestRoot), 'utf8'));
const resolver = new TargetDateResolver();

for (const [question, topic] of [
  ['When must an employer issue an itemised payslip, and when must salary be paid?', 'mom-salary-payment'],
  ['What is the CPF employer refund deadline, and when are monthly CPF contributions payable?', 'cpf-contribution-due-dates'],
  ['Our LFMC plans to appoint a director. Does Form 11 require prior MAS approval? Also, do we need a fund management licence?', 'mas-lfmc'],
  ['Our registered office address changed. Can we wait until the annual return, and when must we file the annual return?', 'acra_annual-returns'],
  ['What is the deadline for a CPF refund request, and when must the employer pay CPF contributions?', 'cpf-contribution-due-dates']
]) {
  const { issuePlan } = reconcileQuestionUnderstanding(question, classifyQuestion(question),
    { mode: 'DETERMINISTIC_FALLBACK', failure: 'NO_PROVIDER' });
  assert.ok(issuePlan.issues.some(issue => issue.mappedTopicIds.includes(topic)),
    `A separate material request remains requested: ${topic}`);
  assert.equal(issuePlan.coverageEstablished, false, 'Routing refinements do not establish whole-question completeness.');
}

for (const question of [
  'Our registered office address changed on 1 January 2010. What deadline did we have back then?',
  'Our registered office address changed on 1 January 2010. What deadline did we have at that time?',
  'Our registered office address changed on 12 October 2026. What was the public holiday pay entitlement then?'
]) {
  assert.equal(resolver.resolveAuthorityEvidenceDate(question, '2026-10-29').source, 'EXPLICIT',
    'Historical wording or a separate unnamed employment request must retain its date scope.');
}

assert.equal(STATUTORY_WORKFLOW_RULES_20261029.length, 5, 'Exactly the five approved new workflow families are registered.');

const cases = [
  {
    id: 'acra-entity-changes', authority: 'ACRA', topic: 'acra-entity-information-changes',
    query: 'Our registered office address and entity email changed on 12 October 2026. When should we notify ACRA, and can we wait until the annual return?',
    subject: 'ACRA entity information changes and notification deadline', fixture: 'acra-entity-updates.html',
    dateRoleQuery: 'Our registered office address changed on 12 October 2026. When must we notify ACRA?',
    rendered: /14 days.*30 days.*email address.*registered office address/i
  },
  {
    id: 'iras-record-retention', authority: 'IRAS', topic: 'iras-company-record-retention',
    query: 'For YA 2023, how long must our company keep source documents, accounting records and schedules, and bank statements? What changes after dissolution?',
    subject: 'Corporate income tax company record retention and dissolution', fixture: 'iras-company-records.html',
    rendered: /at least five years from the relevant Year of Assessment.*YA 2019.*31 December 2023.*YA 2023.*31 December 2027.*struck off.*liquidator/i
  },
  {
    id: 'cpf-refund', authority: 'CPF', topic: 'cpf-adjustments-refunds',
    query: 'When should an employer apply for refund of wrongly paid CPF contributions, including conditional wages, and must the employee share be returned first?',
    subject: 'Employer CPF contribution refund categories, deadlines and application conditions', fixture: 'cpf-refunds.html',
    dateRoleQuery: 'We paid wrongly submitted CPF contributions on 1 October 2026. What is the refund deadline?',
    rendered: /immediately and no later than one year.*PAYMENTS RECEIVED ON.*conditional wages.*employee share.*funds available.*Additional Wage ceiling.*Annual Limit.*automatically/i
  },
  {
    id: 'mom-payslip', authority: 'MOM', topic: 'mom-itemised-payslips',
    query: 'Must we give an itemised payslip with salary payment or within three working days if we cannot? What about dismissal with outstanding salary, and can the copy be soft?',
    subject: 'MOM itemised payslip timing, dismissal and format requirements', fixture: 'mom-payslips.html',
    dateRoleQuery: 'We paid salary on 1 October 2026. When must the itemised payslip be delivered?',
    rendered: /covered by the Employment Act.*together with payment.*three working days.*termination or dismissal.*outstanding salary.*soft or hard copy/i
  },
  {
    id: 'mas-lfmc-appointment', authority: 'MAS', topic: 'mas-lfmc-key-appointments',
    query: 'For our LFMC, is MAS prior approval on Form 11 needed before appointing a CEO or director, and how is this different from row 17 notifications?',
    subject: 'LFMC CEO and director appointment prior approval under Form 11', fixture: 'mas-lfmc-toolkit.pdf',
    rendered: /prior MAS approval.*Form 11.*before appointing.*row 17.*separate subsequent notification.*Executive-to-Non-Executive/i
  }
];

function manifestEntry(rule) {
  if (rule.fixtureKind === 'RETAINED_NATIVE_OFFICIAL_PDF') {
    return manifest.sources.find(source => source.fixture === rule.fixtureFile);
  }
  return manifest.sources.find(source => source.fixture === rule.fixtureFile);
}

function rawFixture(rule) {
  if (rule.id === 'MAS_LFMC_KEY_APPOINTMENTS') {
    return readFileSync(new URL('../fixtures/statutoryDevelopment20261027/mas-lfmc-native-extract.txt', import.meta.url), 'utf8');
  }
  return readFileSync(new URL(rule.fixtureFile, fixtureRoot), 'utf8');
}

function cleanFixture(rule, value) {
  if (!/<(?:!doctype|html|head|body|main|article|section|div|p|table|tr|td|li|h[1-6])\b/i.test(value)) return value;
  return (/<table\b/i.test(value) ? cleanHtmlTextPreservingTableCells(value) : cleanHtmlText(value)).replace(/\n{2,}/g, '\n');
}

function authorityDomain(authority) {
  return ({ ACRA: 'ACRA_CORPORATE', IRAS: 'IRAS_CORPORATE_TAX', CPF: 'CPF_PAYROLL', MOM: 'MOM_EMPLOYMENT', MAS: 'MAS_FUNDS' })[authority];
}

function population(authority) {
  return authority === 'MOM' ? 'Employer' : authority === 'CPF' ? 'Employer' : authority === 'MAS' ? 'Company' : 'Company';
}

for (const sample of cases) {
  const rule = STATUTORY_WORKFLOW_RULES_20261029.find(item => item.authority === sample.authority && item.topicIds.includes(sample.topic));
  assert.ok(rule, `${sample.id}: the source rule is exposed to the mapped topic.`);
  assert.equal(rule.fixtureFile, sample.fixture, `${sample.id}: the rule points at its retained official fixture.`);
  const source = manifestEntry(rule);
  assert.ok(source, `${sample.id}: native source capture is listed in the source manifest.`);
  assert.equal(source.url, rule.officialUrl, `${sample.id}: metadata is bound to the exact official URL.`);

  let sourceText = rawFixture(rule);
  if (rule.id === 'MAS_LFMC_KEY_APPOINTMENTS') {
    const pdfBytes = readFileSync(new URL(rule.fixtureFile, fixtureRoot));
    assert.equal(createHash('sha256').update(pdfBytes).digest('hex'), source.fixtureSha256,
      'MAS original PDF bytes match the native source capture manifest.');
    const extracted = priorManifest.sources.find(item => item.fixture === 'mas-lfmc-native-extract.txt');
    assert.ok(extracted, 'The page-3 version and row-3/row-17 native extraction record is retained.');
    assert.equal(createHash('sha256').update(sourceText).digest('hex'), extracted.fixtureSha256,
      'MAS row proof uses the retained native extraction from the original PDF.');
    assert.equal(extracted.sourceDocumentSha256, source.fixtureSha256,
      'The extracted MAS rows are bound to the original PDF byte digest.');
  } else {
    const bytes = readFileSync(new URL(rule.fixtureFile, fixtureRoot));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), source.fixtureSha256,
      `${sample.id}: exact captured native HTML bytes match the source manifest.`);
  }

  const input = { authority: sample.authority, topicId: sample.topic, query: sample.query,
    subject: sample.subject, sourceText, officialUrl: rule.officialUrl };
  if (rule.id === 'MAS_LFMC_KEY_APPOINTMENTS') {
    const missingAppointmentDirection = sourceText.replace(/\(CEO\) or Director;[\s\S]*?(?=4 For an acquirer)/i,
      '(CEO) appointment only.\n');
    assert.notEqual(missingAppointmentDirection, sourceText);
    assert.equal(supportStatutoryWorkflowRule({ ...input, sourceText: missingAppointmentDirection }), false,
      'Row 17 direction words cannot prove missing director and Non-Executive-to-Executive prior approval in row 3.');
    assert.deepEqual(selectStatutoryWorkflowQuotes({ ...input, sourceText: missingAppointmentDirection }), []);
  }
  const clean = cleanFixture(rule, sourceText).replace(/\s*\|\s*/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  const missingTerms = rule.requiredSourceTerms.filter(term => !clean.includes(term.replace(/\s*\|\s*/g, ' ').replace(/\s+/g, ' ').toLowerCase()));
  const tableStart = cleanFixture(rule, sourceText).toLowerCase().indexOf('filing deadlines');
  assert.equal(supportStatutoryWorkflowRule(input), true,
    `${sample.id}: complete native source proves every selected premise. Missing: ${missingTerms.join('; ')}; quoteMatches=${rule.quoteMatchers.map(pattern => pattern.test(cleanFixture(rule, sourceText)))}; table=${cleanFixture(rule, sourceText).slice(Math.max(0, tableStart), Math.max(0, tableStart) + 600)}; contradiction=${hasStatutoryWorkflowContradiction(input)}; date=${JSON.stringify(resolver.resolveAuthorityEvidenceDate(sample.query, '2026-10-29'))}`);
  assert.equal(hasStatutoryWorkflowContradiction(input), false, `${sample.id}: the correct source does not trigger a contradiction veto.`);
  const quotes = selectStatutoryWorkflowQuotes(input);
  assert.ok(quotes.length >= 2, `${sample.id}: bounded matched passages are selected from the source.`);
  assert.ok(quotes.every(quote => quote.length <= 5_000), `${sample.id}: selected passages are bounded.`);
  assert.equal(supportStatutoryWorkflowRule({ ...input, sourceText: quotes.join('\n') }), true,
    `${sample.id}: selected exact source passages alone preserve full-family proof.`);
  assert.equal(supportStatutoryWorkflowRule({ ...input, sourceText: '' }), false,
    `${sample.id}: missing source material fails closed.`);
  assert.equal(supportStatutoryWorkflowRule({ ...input, officialUrl: 'https://example.com/not-the-authority' }), false,
    `${sample.id}: a noncanonical source URL fails closed.`);
  assert.deepEqual(selectStatutoryWorkflowQuotes({ ...input, officialUrl: undefined }), [],
    `${sample.id}: source quotations are not displayable without exact URL identity.`);
  assert.equal(supportStatutoryWorkflowRule({ ...input, topicId: 'unrelated-topic' }), undefined,
    `${sample.id}: the module makes no claim for a different topic.`);

  const claimId = `workflow-${sample.id}`;
  const bindingHash = createHash('sha256').update(rule.id === 'MAS_LFMC_KEY_APPOINTMENTS'
    ? readFileSync(new URL(rule.fixtureFile, fixtureRoot)) : readFileSync(new URL(rule.fixtureFile, fixtureRoot))).digest('hex');
  const claim = { text: sourceText, supportKind: 'EXACT_SOURCE_QUOTE', issueIds: [claimId], provenance: 'LIVE_EXTERNAL',
    fetchedSourceBinding: { recordId: `record-${sample.id}`, documentHash: bindingHash,
      canonicalUrl: rule.officialUrl, retrievedAt: '2026-10-29T00:00:00Z' } };
  const issue = { id: claimId, subject: sample.subject, population: population(sample.authority), operation: 'EXPLAIN_RULE',
    evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', claims: [claim], gaps: [] };
  const stream = { id: `stream-${sample.id}`, authority: sample.authority, domain: authorityDomain(sample.authority),
    authorityLabel: sample.authority, domainLabel: 'Statutory guidance', evidenceStatus: 'VERIFIED',
    applicationStatus: 'UNRESOLVED', issues: [issue], sources: [{ key: `source-${sample.id}`, title: source.pageTitle,
      publisher: sample.authority, documentTitle: source.pageTitle, officialUrl: rule.officialUrl,
      provenance: 'LIVE_EXTERNAL', claims: [claim] }], gaps: [] };
  const explanation = getStatutoryWorkflowEvidence(sample.query, stream, issue);
  assert.ok(explanation, `${sample.id}: issue-bound verified quote group permits a general explanation.`);
  assert.equal(explanation.officialUrl, rule.officialUrl, `${sample.id}: rendered explanation cites the bound official source.`);
  assert.match(explanation.text, new RegExp(sample.rendered.source, 'i'),
    `${sample.id}: substantive source-backed rule content is returned.`);

  if (sample.dateRoleQuery) {
    const date = resolver.resolveAuthorityEvidenceDate(sample.dateRoleQuery, '2026-10-29');
    assert.equal(date.source, 'NONE', `${sample.id}: fact date does not select a different legal version.`);
  }
}

const acra = cases[0];
const iras = cases[1];
const cpf = cases[2];
const mom = cases[3];
const mas = cases[4];
const sourceOf = sample => {
  const rule = STATUTORY_WORKFLOW_RULES_20261029.find(item => item.topicIds.includes(sample.topic));
  const text = cleanFixture(rule, rawFixture(rule));
  return { rule, text, input: { authority: sample.authority, topicId: sample.topic, query: sample.query,
    subject: sample.subject, sourceText: text, officialUrl: rule.officialUrl } };
};

for (const [sample, before, after] of [
  [mom, 'unless an item is not applicable', 'even when an item is not applicable'],
  [iras, 'source documents, accounting records and schedules, bank statements', 'bank statements only'],
  [cpf, 'field in your record of payment to determine the date of payment', 'field in your record of payment to determine the date of discovery']
]) {
  const { input } = sourceOf(sample);
  assert.ok(input.sourceText.includes(before), 'The mutation changes a real native premise.');
  const changed = { ...input, sourceText: input.sourceText.replace(before, after) };
  assert.equal(supportStatutoryWorkflowRule(changed), false, 'Every rendered substantive premise needs native proof.');
  assert.deepEqual(selectStatutoryWorkflowQuotes(changed), [], 'Incomplete or reversed premises cannot supply a complete explanation.');
}
for (const question of [
  'What was the 2010 CPF contribution refund deadline?',
  'What was the CPF contribution refund deadline back then?',
  'For 2010, what is the CPF contribution refund deadline?'
]) {
  assert.equal(supportStatutoryWorkflowRule({ ...sourceOf(cpf).input, query: question }), false,
    'Unresolved bare years and retrospective wording cannot be proved by current guidance.');
}
assert.equal(resolver.resolveAuthorityEvidenceDate(
  'We paid CPF contributions on 1 October 2026. What is the refund deadline and what CPF contribution rate applies?',
  '2026-10-29').source, 'EXPLICIT', 'A separate rate request keeps its period even within the same authority.');

for (const [sample, original, incorrect] of [
  [acra, 'Within 14 days from the date of the change', 'Within 15 days from the date of the change'],
  [iras, 'Your company must retain its records for at least 5 years from the relevant YA.', 'Your company must retain its records for at least 6 years from the relevant YA.'],
  [cpf, 'no later than one year from the date of payment', 'no later than two years from the date of payment'],
  [mom, 'within three working days of payment', 'within three calendar days of payment'],
  [mas, 'Prior | to | the', 'After | the']
]) {
  const { input } = sourceOf(sample);
  const mutation = input.sourceText.replace(original, incorrect);
  assert.notEqual(mutation, input.sourceText, `${sample.id}: the source-fact mutation changes the retained rule premise.`);
  const mutated = { ...input, sourceText: mutation };
  assert.equal(supportStatutoryWorkflowRule(mutated), false, `${sample.id}: changed numeric/approval premise fails complete proof.`);
  assert.deepEqual(selectStatutoryWorkflowQuotes(mutated), [], `${sample.id}: a changed premise cannot supply displayable quotes.`);
  assert.equal(hasStatutoryWorkflowContradiction(mutated), true, `${sample.id}: the explicit changed premise is exposed to fallback veto.`);
}

for (const [query, expectedDate] of [
  [acra.dateRoleQuery, '2026-10-12'],
  [cpf.dateRoleQuery, '2026-10-01']
]) {
  assert.equal(resolver.resolveTargetDate(query, '2026-10-29').targetDate, expectedDate,
    'The general date resolver preserves the user-supplied fact date.');
}
assert.equal(resolver.resolveAuthorityEvidenceDate(iras.query, '2026-10-29').source, 'NONE',
  'An explicitly supplied YA can be applied to the current company-record guidance.');
assert.equal(resolver.resolveAuthorityEvidenceDate('What rules were in force for company record retention in YA 2023?', '2026-10-29').targetDate,
  '2023-01-01', 'An explicit historical legal-version request keeps its prior target date.');
assert.equal(resolver.resolveAuthorityEvidenceDate('What was the ACRA rule in force when our address changed on 12 October 2025?', '2026-10-29').targetDate,
  '2025-10-12', 'A fact date does not erase an explicit historical rule-version request.');
assert.equal(resolver.resolveAuthorityEvidenceDate('We paid wrongly submitted CPF contributions on 1 October 2026. What is the refund deadline, and what GST rate applies to the same supply?', '2026-10-29').targetDate,
  '2026-10-01', 'A recognized CPF payment fact does not erase a separate GST rate question.');
assert.equal(resolver.resolveAuthorityEvidenceDate('Our registered office address changed on 12 October 2026. Which law governed the update at that date?', '2026-10-29').targetDate,
  '2026-10-12', 'A recognized ACRA change fact does not erase an explicit governed-at-date version request.');

for (const sample of cases) {
  const { rule, text, input } = sourceOf(sample);
  const historic = { ...input, query: `What historical rule applied for ${sample.authority} ${sample.subject} in 2024?` };
  assert.equal(supportStatutoryWorkflowRule(historic), false,
    `${sample.id}: current guidance does not establish a historical legal version.`);
  assert.equal(supportStatutoryWorkflowRule({ ...input, sourceText: text.slice(0, Math.floor(text.length / 5)) }), false,
    `${sample.id}: an abbreviated page excerpt without all premises is rejected.`);
  assert.ok(rule.limitations.length > 0 && rule.effectiveDateEvidence,
    `${sample.id}: applicability and source-boundary limitations remain explicit.`);
}

// No semantic fixture, mapped-topic injection, live source call or model call:
// the ordinary application entry must route and render each natural question.
const appCases = [
  { authority: 'ACRA', topic: 'acra-entity-information-changes', url: manifest.sources.find(item => item.fixture === 'acra-entity-updates.html').url,
    query: 'Our company changed its registered office address on 12 October 2026. By when must we notify ACRA?',
    expected: /14 days from the date of change|14 days from the date of the change/i },
  { authority: 'IRAS', topic: 'iras-company-record-retention', url: manifest.sources.find(item => item.fixture === 'iras-company-records.html').url,
    query: 'For YA 2023, how long must a company keep its corporate income tax accounting records and bank statements?',
    expected: /five years from the relevant Year of Assessment.*31 December 2027/i },
  { authority: 'CPF', topic: 'cpf-adjustments-refunds', url: manifest.sources.find(item => item.fixture === 'cpf-refunds.html').url,
    query: 'We paid wrongly submitted CPF contributions on 1 October 2026. When is the refund request due?',
    expected: /immediately and no later than one year.*PAYMENTS RECEIVED ON/i },
  { authority: 'MOM', topic: 'mom-itemised-payslips', url: manifest.sources.find(item => item.fixture === 'mom-payslips.html').url,
    query: 'When must an employer covered by the Employment Act issue an itemised payslip, and is a soft copy allowed?',
    expected: /together with payment.*three working days.*soft or hard copy/i },
  { authority: 'MAS', topic: 'mas-lfmc-key-appointments', url: manifest.sources.find(item => item.fixture === 'mas-lfmc-toolkit.pdf').url,
    query: 'Our LFMC plans to appoint a director. Does Form 11 require prior MAS approval?',
    expected: /prior MAS approval.*Form 11.*before appointing.*row 17.*separate subsequent notification/i }
];
const appFixtureBodies = new Map(manifest.sources.map(item => [item.url,
  readFileSync(new URL(item.fixture, fixtureRoot))]));
const modelEndpoint = /(?:generativelanguage\.googleapis\.com|api\.openai\.com|openai\.azure\.com|\/generateContent(?:\?|$)|\/chat\/completions(?:\?|$))/i;
const appFetches = [];
const strictOfflineFetch = async input => {
  const url = input && typeof input === 'object' && typeof input.url === 'string' ? input.url : String(input);
  appFetches.push(url);
  const body = appFixtureBodies.get(url);
  if (body) {
    const isPdf = url === appCases.find(item => item.authority === 'MAS').url;
    return new Response(body, { headers: { 'content-type': isPdf ? 'application/pdf' : 'text/html; charset=utf-8' } });
  }
  const provider = Object.values(OFFICIAL_SOURCE_DISCOVERY_PROVIDERS).find(candidate => candidate.sitemapUrls?.includes(url));
  if (provider) {
    const locations = manifest.sources.filter(item => item.authority === provider.authority)
      .map(item => `<url><loc>${item.url.replaceAll('&', '&amp;')}</loc></url>`).join('');
    return new Response(`<urlset>${locations}</urlset>`, { headers: { 'content-type': 'application/xml' } });
  }
  return new Response('Not present in the exact offline native source set', { status: 404 });
};
const previousFetch = globalThis.fetch;
const appResults = [];
try {
  globalThis.fetch = strictOfflineFetch;
  for (const sample of appCases) {
    let workstreams;
    let stream;
    try {
      const response = await processAccountingQuery(sample.query, null, 'SFRS_I', undefined, undefined, [], undefined,
        { onAuthorityWorkstreams: result => { workstreams = result; } });
      assert.ok(workstreams, `${sample.authority}: processAccountingQuery reached authority workstreams.`);
      assert.equal(response.scenarioState.scenarioType, 'AUTHORITY_ADVISORY', `${sample.authority}: the normal entry kept statutory advice on the advisory path.`);
      const presentation = createAuthorityEvidencePresentation(workstreams);
      stream = presentation.workstreams.find(item => item.authority === sample.authority);
      assert.ok(stream, `${sample.authority}: the normal query resolved an authority workstream.`);
      assert.ok(stream.issues.some(issue => issue.evidenceStatus === 'VERIFIED' &&
        issue.operation !== 'UNSUPPORTED'), `${sample.authority}: the question has a verified mapped issue.`);
      assert.ok(stream.sources.some(source => source.officialUrl === sample.url && source.claims.some(claim =>
        claim.supportKind === 'EXACT_SOURCE_QUOTE' && claim.fetchedSourceBinding?.canonicalUrl === sample.url &&
        claim.issueIds.some(id => stream.issues.some(issue => issue.id === id)))),
      `${sample.authority}: the normal application path rendered exact source-bound claims from the retained native page.`);
      assert.match(response.messageText, new RegExp(`${sample.authority} rule explanation`, 'i'),
        `${sample.authority}: processAccountingQuery rendered the source-backed workflow explanation.`);
      assert.match(response.messageText, new RegExp(sample.expected.source, 'i'),
        `${sample.authority}: the rendered answer includes the substantive workflow rule.`);
      appResults.push({ authority: sample.authority, topic: sample.topic, ok: true,
        evidenceStatus: stream.evidenceStatus, officialUrl: sample.url });
    } catch (error) {
      appResults.push({ authority: sample.authority, topic: sample.topic, ok: false,
        failure: String(error?.message || error).slice(0, 240),
        issues: (stream?.issues || []).map(issue => ({
          subject: issue.subject, topicIds: issue.topicIds, operation: issue.operation,
          status: issue.evidenceStatus,
          gaps: Array.isArray(issue.gaps) ? issue.gaps.map(gap => typeof gap === 'string' ? gap : gap?.code || gap?.reason).filter(Boolean).slice(0, 8) : []
        })) });
    }
  }
} finally {
  globalThis.fetch = previousFetch;
}
assert.ok(appFetches.length > 0, 'The standard application route used the strict offline fixture fetcher.');
assert.equal(appFetches.some(url => modelEndpoint.test(url)), false, 'The source-backed path made no model request.');
const sourceFetchMisses = appCases.filter(sample => !appFetches.includes(sample.url)).map(sample => sample.authority);
assert.deepEqual(sourceFetchMisses, [],
  `Exact source fetch misses: ${JSON.stringify({ sourceFetchMisses, appResults })}`);
assert.deepEqual(appResults.filter(result => !result.ok), [],
  `Actual processAccountingQuery source-proof results: ${JSON.stringify(appResults)}`);

console.log('Five-family statutory workflow source, quote, contradiction, date-role and source-bound rendering regressions passed.');
