import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  getIrasCpfExpansionEvidence,
  hasIrasCpfExpansionContradiction,
  selectIrasCpfExpansionQuotes,
  supportIrasCpfExpansionRule
} from '../../src/retrieval/irasCpfExpansionRules.ts';
import { cleanHtmlText } from '../../src/retrieval/sourceAdapters.ts';

const fixtureRoot = new URL('../fixtures/statutoryExpansionSources/', import.meta.url);
const read = name => readFileSync(new URL(name, fixtureRoot), 'utf8').trim();
const manifest = JSON.parse(read('iras-cpf-source-manifest.json'));
for (const entry of manifest.sources) {
  assert.equal(createHash('sha256').update(readFileSync(new URL(entry.file, fixtureRoot))).digest('hex'), entry.sha256,
    `${entry.file} matches the recorded source-excerpt hash`);
  if (entry.fullPageFile) {
    assert.equal(createHash('sha256').update(readFileSync(new URL(entry.fullPageFile, fixtureRoot))).digest('hex'), entry.sourceHtmlSha256,
      `${entry.fullPageFile} matches the recorded complete-source hash`);
  }
}

const inputTaxHtml = read('iras-gst-input-tax-native.html');
const inputTaxSource = cleanHtmlText(inputTaxHtml);
const inputTaxFullHtml = read('iras-gst-input-tax-page.html');
const eciHtml = read('iras-eci-filing-native.html');
const eciSource = cleanHtmlText(eciHtml);
const eciFullHtml = read('iras-eci-filing-page.html');
const cpfSource = read('cpf-wage-classification.txt');

const inputTax = (query, sourceText = inputTaxSource, overrides = {}) => ({
  authority: 'IRAS', topicId: 'iras-gst-input-tax', query,
  subject: 'General GST input tax claim conditions', sourceText,
  officialUrl: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax',
  ...overrides
});
const eci = (query, sourceText = eciSource, overrides = {}) => ({
  authority: 'IRAS', topicId: 'iras-cit-eci', query,
  subject: 'General ECI filing and waiver requirements', sourceText,
  officialUrl: 'https://www.iras.gov.sg/taxes/corporate-income-tax/estimated-chargeable-income-(eci)-filing',
  ...overrides
});
const cpf = (query, sourceText = cpfSource, overrides = {}) => ({
  authority: 'CPF', topicId: 'cpf-additional-wages', query,
  subject: 'CPF wages, allowances and reimbursement classification', sourceText,
  officialUrl: 'https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions',
  ...overrides
});

function renderFixture(input, { issueId = 'expansion-issue', sourceUrl = input.officialUrl,
  population = input.authority === 'CPF' ? 'Employer' : 'Company',
  domain = input.topicId === 'iras-gst-input-tax' ? 'IRAS_GST'
    : input.topicId === 'iras-cit-eci' ? 'IRAS_CORPORATE_TAX' : 'CPF_PAYROLL',
  issueOverrides = {}, sourceOverrides = {}, streamOverrides = {} } = {}) {
  const quotes = selectIrasCpfExpansionQuotes(input);
  const issue = {
    id: issueId, subject: input.subject, population, operation: 'EXPLAIN_RULE',
    evidenceStatus: 'VERIFIED', applicationStatus: 'NOT_REQUIRED', claims: [], gaps: [],
    ...issueOverrides
  };
  const source = {
    key: 'official-current-page', title: 'Official guidance', publisher: input.authority,
    documentTitle: 'Official guidance', officialUrl: sourceUrl, provenance: 'LIVE_EXTERNAL',
    claims: quotes.map((quote, index) => ({
      text: quote, supportKind: 'EXACT_SOURCE_QUOTE', issueIds: [issueId], provenance: 'LIVE_EXTERNAL',
      fetchedSourceBinding: {
        recordId: 'same-source-revision', documentHash: 'a'.repeat(64), canonicalUrl: sourceUrl,
        retrievedAt: '2026-10-26T00:00:00Z'
      },
      ...(index === 0 ? {} : {})
    })),
    ...sourceOverrides
  };
  const stream = {
    id: 'expansion-stream', authority: input.authority, authorityLabel: input.authority,
    domain, domainLabel: domain, evidenceStatus: 'VERIFIED', applicationStatus: 'NOT_REQUIRED',
    issues: [issue], sources: [source], gaps: [], ...streamOverrides
  };
  return { issue, source, stream, quotes };
}

const inputTaxQuery = 'What are the general conditions for claiming GST input tax?';
const inputTaxRequest = inputTax(inputTaxQuery);
assert.equal(supportIrasCpfExpansionRule(inputTaxRequest), true);
const inputTaxQuotes = selectIrasCpfExpansionQuotes(inputTaxRequest);
assert.equal(inputTaxQuotes.length, 9, 'The complete conditions are selected as separate bounded source passages.');
assert.ok(inputTaxQuotes.every(quote => quote.length <= 4_500));
assert.equal(supportIrasCpfExpansionRule(inputTax(inputTaxQuery, inputTaxQuotes.join('\n\n'))), true,
  'Joined selected passages still prove all eight input-tax conditions.');
assert.ok(inputTaxQuotes[8].includes('reasonable steps to ascertain'));
assert.ok(inputTaxQuotes[8].includes('Missing Trader Fraud arrangement'));
assert.ok(inputTaxQuotes[7].includes('Regulations 26 and 27'));
const inputTaxEvidence = getIrasCpfExpansionEvidence(inputTaxQuery,
  renderFixture(inputTaxRequest).stream, renderFixture(inputTaxRequest).issue);
assert.match(inputTaxEvidence?.text || '', /reasonable steps.*Missing Trader Fraud/i);
assert.match(inputTaxEvidence?.text || '', /all applicable conditions/i);
const nativeInputTaxRequest = inputTax(inputTaxQuery, inputTaxHtml);
assert.equal(supportIrasCpfExpansionRule(nativeInputTaxRequest), true,
  'Current official native HTML proves the general claim rule.');
assert.deepEqual(selectIrasCpfExpansionQuotes(nativeInputTaxRequest), inputTaxQuotes,
  'Native HTML and the application-cleaned text select the same component quotations.');
const nativeInputTaxQuotes = selectIrasCpfExpansionQuotes(nativeInputTaxRequest);
assert.equal(supportIrasCpfExpansionRule(inputTax(inputTaxQuery, nativeInputTaxQuotes.join('\n\n'))), true,
  'Native HTML component quotes remain complete when joined for the verifier.');
assert.equal(supportIrasCpfExpansionRule(inputTax(inputTaxQuery, inputTaxFullHtml)), true,
  'The complete current official GST page proves the general claim conditions.');
assert.deepEqual(selectIrasCpfExpansionQuotes(inputTax(inputTaxQuery, inputTaxFullHtml)), inputTaxQuotes,
  'The complete current official GST page selects the same bounded condition quotations.');

const missingFraudCondition = inputTaxSource.replace(/\n\n8\. You have taken reasonable steps[^\n]*/, '');
assert.equal(supportIrasCpfExpansionRule(inputTax(inputTaxQuery, missingFraudCondition)), false,
  'Seven input-tax requirements cannot prove all eight conditions.');
assert.equal(hasIrasCpfExpansionContradiction(inputTax(inputTaxQuery, missingFraudCondition)), false,
  'An incomplete condition list is not itself a contradiction that should veto another supported rule.');
assert.deepEqual(selectIrasCpfExpansionQuotes(inputTax(inputTaxQuery, missingFraudCondition)), []);
const negatedFraudCondition = inputTax(inputTaxQuery,
  inputTaxSource.replace('You have taken reasonable steps', 'You have not taken reasonable steps'));
assert.equal(supportIrasCpfExpansionRule(negatedFraudCondition), false,
  'A negated Missing Trader Fraud safeguard cannot prove the positive requirement.');
assert.equal(hasIrasCpfExpansionContradiction(negatedFraudCondition), true,
  'An explicit reversal of the Missing Trader Fraud condition is a source contradiction.');
const deniedInputTaxCondition = inputTax(inputTaxQuery,
  inputTaxSource.replace('You are GST-registered;', 'You are GST-registered; this condition is no longer required;'));
assert.equal(supportIrasCpfExpansionRule(deniedInputTaxCondition), false,
  'A later denial of an otherwise positive input-tax condition invalidates the source proof.');
assert.equal(hasIrasCpfExpansionContradiction(deniedInputTaxCondition), true);
assert.deepEqual(selectIrasCpfExpansionQuotes(deniedInputTaxCondition), []);
const deniedInputTaxRendered = renderFixture(deniedInputTaxCondition);
assert.equal(getIrasCpfExpansionEvidence(inputTaxQuery, deniedInputTaxRendered.stream, deniedInputTaxRendered.issue), undefined,
  'A denied input-tax condition cannot render from its earlier positive wording.');
assert.equal(supportIrasCpfExpansionRule(inputTax(inputTaxQuery, inputTaxSource,
  { authority: 'CPF' })), undefined, 'A request under another authority is not owned.');
assert.equal(hasIrasCpfExpansionContradiction(inputTax(inputTaxQuery, inputTaxSource,
  { authority: 'CPF' })), false, 'Contradiction checks do not own a request for another authority.');
assert.equal(supportIrasCpfExpansionRule(inputTax(inputTaxQuery, inputTaxSource,
  { officialUrl: 'https://www.iras.gov.sg/other-page' })), false, 'A different IRAS page cannot prove this topic.');
assert.equal(supportIrasCpfExpansionRule({ ...inputTaxRequest, officialUrl: undefined }), true,
  'Text-only semantic support checks can prove complete rule content when the source URL is supplied by an outer source gate.');
assert.deepEqual(selectIrasCpfExpansionQuotes({ ...inputTaxRequest, officialUrl: undefined }), [],
  'Quote selection requires the source URL so its quote can enter the governed verifier path.');
assert.equal(supportIrasCpfExpansionRule(inputTax('Can we claim input tax on this purchase?')), undefined,
  'Specific claim decisions remain outside the general rule handler.');
assert.equal(supportIrasCpfExpansionRule(inputTax('What are the input tax conditions for motor car expenses?')), undefined,
  'The general checklist does not stand in for the detailed motor-car exception rules.');
assert.equal(supportIrasCpfExpansionRule(inputTax('What reasonable steps should a business take for Missing Trader Fraud checks?')), undefined,
  'The general checklist does not claim to explain the specific due-diligence method.');

const eciQuery = 'What are the general ECI filing and waiver rules?';
const eciRequest = eci(eciQuery);
assert.equal(supportIrasCpfExpansionRule(eciRequest), true);
const eciQuotes = selectIrasCpfExpansionQuotes(eciRequest);
assert.ok(eciQuotes.length >= 3);
assert.ok(eciQuotes.every(quote => quote.length <= 4_500));
assert.equal(supportIrasCpfExpansionRule(eci(eciQuery, eciQuotes.join('\n\n'))), true,
  'Joined ECI passages retain the filing duty, waiver tests and their qualifications.');
assert.ok(eciQuotes.some(quote => /Annual revenue\s*1?\s*is \$5 million or below/.test(quote)),
  'The current native HTML footnote marker may appear in the extracted revenue criterion.');
assert.ok(eciQuotes.some(quote => quote.includes('amount before deducting the exempt amount')));
const eciFixture = renderFixture(eciRequest);
const eciEvidence = getIrasCpfExpansionEvidence(eciQuery, eciFixture.stream, eciFixture.issue);
assert.match(eciEvidence?.text || '', /within three months/i);
assert.match(eciEvidence?.text || '', /both annual revenue.*S\$5 million or less.*nil ECI/i);
assert.match(eciEvidence?.text || '', /self-assesses/i);
assert.equal(supportIrasCpfExpansionRule(eci(eciQuery, eciHtml)), true,
  'Current official native HTML with ordered-list markup and a revenue footnote proves the ECI waiver.');
assert.deepEqual(selectIrasCpfExpansionQuotes(eci(eciQuery, eciHtml)), eciQuotes,
  'Native HTML and application-cleaned ECI text select the same component quotations.');
assert.equal(supportIrasCpfExpansionRule(eci(eciQuery, eciFullHtml)), true,
  'The complete current official ECI page proves the filing and waiver rules.');
assert.deepEqual(selectIrasCpfExpansionQuotes(eci(eciQuery, eciFullHtml)), eciQuotes,
  'The complete current official ECI page selects the same bounded rule quotations.');
const missingEciThreshold = eci(eciQuery,
  eciSource.replace(/Annual revenue\s*1?\s*is \$5 million or below for the financial year;/, ''));
assert.equal(supportIrasCpfExpansionRule(missingEciThreshold), false);
assert.equal(hasIrasCpfExpansionContradiction(missingEciThreshold), false,
  'An incomplete waiver premise is not an explicit rule contradiction.');

const excessRevenue = eci(eciQuery,
  eciSource.replace(/Annual revenue\s*1?\s*is \$5 million or below/, 'Annual revenue1 is more than $5 million'));
assert.equal(supportIrasCpfExpansionRule(excessRevenue), false,
  'The waiver does not pass when the revenue threshold is contradicted.');
assert.equal(hasIrasCpfExpansionContradiction(excessRevenue), true);
const positiveEci = eci(eciQuery,
  eciSource.replace('ECI is nil for the YA.', 'ECI may be positive for the YA.'));
assert.equal(supportIrasCpfExpansionRule(positiveEci), false,
  'The waiver does not pass when the nil-ECI requirement is contradicted.');
assert.equal(hasIrasCpfExpansionContradiction(positiveEci), true);
const deniedEciThreshold = eci(eciQuery,
  eciSource.replace(/Annual revenue\s*1?\s*is \$5 million or below for the financial year;/,
    'Annual revenue1 is $5 million or below for the financial year; this criterion no longer applies;'));
assert.equal(supportIrasCpfExpansionRule(deniedEciThreshold), false,
  'A later denial of the positive revenue threshold invalidates the waiver proof.');
assert.equal(hasIrasCpfExpansionContradiction(deniedEciThreshold), true);
assert.deepEqual(selectIrasCpfExpansionQuotes(deniedEciThreshold), []);
const deniedEciRendered = renderFixture(deniedEciThreshold);
assert.equal(getIrasCpfExpansionEvidence(eciQuery, deniedEciRendered.stream, deniedEciRendered.issue), undefined,
  'A denied ECI threshold cannot render from its earlier positive wording.');
assert.equal(supportIrasCpfExpansionRule(eci('What were the 2025 ECI filing and waiver rules?')), undefined,
  'Historical rule applicability is left unsupported.');
assert.equal(supportIrasCpfExpansionRule(eci('Does my company qualify for the ECI waiver?')), undefined,
  'Company-specific eligibility remains outside general rule rendering.');
assert.equal(supportIrasCpfExpansionRule(eci('When is ECI due?')), undefined,
  'The existing deadline rule keeps ownership of a deadline-only question.');
assert.equal(supportIrasCpfExpansionRule(eci('What penalties apply for late ECI filing?')), undefined,
  'An ECI waiver explanation does not support penalty or late-filing consequences.');

const cpfQuery = 'How are CPF wage components, allowances, reimbursements and annual bonuses classified as OW or AW?';
const cpfRequest = cpf(cpfQuery);
assert.equal(supportIrasCpfExpansionRule(cpfRequest), true,
  'Compound OW/AW, allowance, reimbursement and annual-bonus classification stays with the expansion handler.');
const cpfQuotes = selectIrasCpfExpansionQuotes(cpfRequest);
assert.equal(cpfQuotes.length, 1);
assert.ok(cpfQuotes[0].includes('payable by the 14th of the following month'));
assert.ok(cpfQuotes[0].includes('reimbursement amount must not exceed'), 'The source quote gives the reimbursement limit.');
const cpfFixture = renderFixture(cpfRequest);
const cpfEvidence = getIrasCpfExpansionEvidence(cpfQuery, cpfFixture.stream, cpfFixture.issue);
assert.match(cpfEvidence?.text || '', /meal and transport allowances/);
assert.match(cpfEvidence?.text || '', /reimbursement.*does not exceed the expense/);
assert.match(cpfEvidence?.text || '', /annual performance bonus is an example/i);
const missingOwTiming = cpf(cpfQuery,
  cpfSource.replace('They are payable by the 14th of the following month.', ''));
assert.equal(supportIrasCpfExpansionRule(missingOwTiming), false);
assert.equal(hasIrasCpfExpansionContradiction(missingOwTiming), false,
  'Missing OW timing evidence alone is not an explicit contradiction.');

for (const query of [
  'What does CPF mean by Additional Wages?',
  'What kind of wage payment is an Additional Wage for CPF?',
  'Can you explain the meaning of Additional Wages under CPF?',
  'What is CPF’s definition of Additional Wages?'
]) {
  const standaloneAw = cpf(query);
  assert.equal(supportIrasCpfExpansionRule(standaloneAw), undefined,
    'Standalone Additional Wage definitions remain available to the existing CPF handler.');
  assert.deepEqual(selectIrasCpfExpansionQuotes(standaloneAw), []);
  const standaloneAwFixture = renderFixture(standaloneAw);
  assert.equal(getIrasCpfExpansionEvidence(query, standaloneAwFixture.stream, standaloneAwFixture.issue), undefined,
    'The new rule renderer does not take ownership of the existing Additional Wage definition cases.');
}

const reversedOwDate = cpf(cpfQuery,
  cpfSource.replace('payable by the 14th of the following month', 'payable after the 14th of the following month'));
assert.equal(supportIrasCpfExpansionRule(reversedOwDate), false,
  'A reversed OW timing condition cannot pass proof.');
assert.equal(hasIrasCpfExpansionContradiction(reversedOwDate), true);
const ordinaryWageBonus = cpf(cpfQuery,
  cpfSource.replace('For example, annual performance bonus.', 'Annual performance bonus is Ordinary Wages.'));
assert.equal(supportIrasCpfExpansionRule(ordinaryWageBonus), false,
  'A contradictory bonus classification cannot pass proof.');
assert.equal(hasIrasCpfExpansionContradiction(ordinaryWageBonus), true);
const deniedCpfOwCondition = cpf(cpfQuery,
  cpfSource.replace('They are payable by the 14th of the following month.',
    'They are payable by the 14th of the following month, but this condition is no longer required.'));
assert.equal(supportIrasCpfExpansionRule(deniedCpfOwCondition), false,
  'A later denial of an otherwise positive OW payment condition invalidates source proof.');
assert.equal(hasIrasCpfExpansionContradiction(deniedCpfOwCondition), true);
assert.deepEqual(selectIrasCpfExpansionQuotes(deniedCpfOwCondition), []);
const deniedCpfRendered = renderFixture(deniedCpfOwCondition);
assert.equal(getIrasCpfExpansionEvidence(cpfQuery, deniedCpfRendered.stream, deniedCpfRendered.issue), undefined,
  'A denied OW payment condition cannot render from its earlier positive wording.');
assert.equal(supportIrasCpfExpansionRule(cpf('How are my employee’s wages classified?')), undefined,
  'Employee-specific advice remains outside this general handler.');
assert.equal(supportIrasCpfExpansionRule(cpf('What is the current CPF ordinary wage ceiling?')), undefined,
  'The wage classification rule does not answer current numerical ceiling questions.');
assert.equal(supportIrasCpfExpansionRule(cpf('What CPF contribution rates apply to ordinary wages?')), undefined,
  'The wage classification rule does not answer rate questions.');

for (const [input, positive] of [[inputTaxRequest, /Missing Trader Fraud/], [eciRequest, /S\$5 million/], [cpfRequest, /Additional Wages/]]) {
  const { issue, source, stream } = renderFixture(input);
  assert.match(getIrasCpfExpansionEvidence(input.query, stream, issue)?.text || '', positive);
  if (source.claims.length > 1) {
    for (let index = 0; index < source.claims.length; index++) {
      if (input.topicId === 'iras-cit-eci' &&
          !/^(?:Annual revenue|ECI is nil|The ECI should)/i.test(source.claims[index].text)) continue;
      assert.equal(getIrasCpfExpansionEvidence(input.query, {
        ...stream, sources: [{ ...source, claims: source.claims.filter((_, position) => position !== index) }]
      }, issue), undefined, 'A complete general rule cannot render if any selected premise is missing.');
    }
  }
  const wrongRevision = structuredClone(stream);
  wrongRevision.sources[0].claims[0].fetchedSourceBinding.documentHash = 'b'.repeat(64);
  const remaining = wrongRevision.sources[0].claims.slice(1);
  wrongRevision.sources[0].claims = remaining.map(claim => ({
    ...claim,
    fetchedSourceBinding: { ...claim.fetchedSourceBinding, documentHash: 'c'.repeat(64) }
  }));
  if (source.claims.length > 1) {
    assert.equal(getIrasCpfExpansionEvidence(input.query, wrongRevision, wrongRevision.issues[0]), undefined,
      'Evidence split across document revisions cannot combine into a rule.');
  }
  assert.equal(getIrasCpfExpansionEvidence(input.query, {
    ...stream, sources: [{ ...source, claims: source.claims.map(claim => ({ ...claim, issueIds: ['another-issue'] })) }]
  }, issue), undefined, 'Claims bound to another issue cannot support the answer.');
  assert.equal(getIrasCpfExpansionEvidence(input.query, {
    ...stream, sources: [{ ...source, officialUrl: 'https://www.iras.gov.sg/other-page' }]
  }, issue), undefined, 'A noncanonical source page cannot render the rule.');
  assert.equal(getIrasCpfExpansionEvidence(input.query, stream, { ...issue, applicationStatus: 'VERIFIED' }), undefined,
    'A general rule renderer does not decide a specific application.');
}

console.log('IRAS/CPF statutory expansion rules: passed');
