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

const ordinaryBonusRefundQuestion = 'We accidentally paid our employee’s ordinary bonus twice. This was a payroll duplication, not a conditional payment. Under the employment terms, the employee had to repay the bonus on 15/09/2026. The payment record says PAYMENTS RECEIVED ON 01/10/2025. What is our CPF refund deadline?';
const ordinaryBonusRefundClassification = classifyQuestion(ordinaryBonusRefundQuestion);
assert.equal(ordinaryBonusRefundClassification.intent, 'STATUTORY_ADVISORY',
  'Dates in a CPF refund-timing request do not turn an ordinary payroll duplication into a payroll calculation.');
assert.equal(ordinaryBonusRefundClassification.calculationRequired, false);
assert.equal(ordinaryBonusRefundClassification.journalEntryRequired, false);
const explicitPayrollCalculationClassification = classifyQuestion('Calculate an employee’s monthly salary and CPF contribution on a salary of SGD 5,000.');
assert.equal(explicitPayrollCalculationClassification.intent, 'TRANSACTION');
assert.equal(explicitPayrollCalculationClassification.calculationRequired, true,
  'An explicit salary and CPF amount calculation remains a calculation request.');
assert.equal(explicitPayrollCalculationClassification.journalEntryRequired, true,
  'An explicit salary and CPF amount calculation retains its payroll-entry path.');
const cpfAmountAndRefundClassification = classifyQuestion('How many dollars of CPF do we owe on the employee salary of S$5,000, and when should we request a refund of last month’s overpayment?');
assert.equal(cpfAmountAndRefundClassification.calculationRequired, true,
  'A separate CPF dollar amount request remains a calculation when it shares a question with refund timing.');
assert.equal(cpfAmountAndRefundClassification.journalEntryRequired, false,
  'An amount-only CPF question does not request a journal entry.');
const employerCpfPayableAndRefundClassification = classifyQuestion('What employer CPF contribution is payable on an employee salary of S$5,000, and when should we request a refund of last month’s overpayment?');
assert.equal(employerCpfPayableAndRefundClassification.calculationRequired, true,
  'An employer CPF contribution phrased as payable remains a calculation beside a separate refund request.');
assert.equal(employerCpfPayableAndRefundClassification.intent, 'TRANSACTION');
assert.equal(employerCpfPayableAndRefundClassification.journalEntryRequired, false,
  'A payable CPF amount request remains distinct from an unrequested journal entry.');
for (const fact of [/age/i, /citizenship|permanent.resident|PR contribution year/i, /Ordinary Wages or Additional Wages/i, /contribution period|wage month/i]) {
  assert.ok(employerCpfPayableAndRefundClassification.missingFacts.some(value => fact.test(value)),
    `The mixed CPF calculation asks for missing material facts: ${fact}`);
}
for (const query of [
  'Our employee earns S$400 in the month. Is there an employee CPF share?',
  'An employee received basic pay, overtime, a performance bonus and a reimbursed S$60 stationery purchase supported by a receipt. Which items are generally wages for CPF?',
  "Can we deduct an employee's salary for a S$400 uniform, recruitment costs and a foreign worker levy?",
  'A monthly salary is earned in March but, under our payroll terms, is payable on 20 April. Is it March Ordinary Wages under CPF?',
  'Our payroll vendor says CPF contributions for June are due on 14 July. What is the contribution due date and what is the 14th?'
]) {
  const classification = classifyQuestion(query);
  assert.equal(classification.calculationRequired, false,
    `Amounts in a statutory eligibility, wage classification or salary deduction question do not trigger payroll calculation fallback: ${query}`);
  assert.equal(classification.journalEntryRequired, false,
    'A statutory or wage classification question does not request journal entries.');
}
const employerCpfPayableAndRefundPlan = reconcileQuestionUnderstanding(
  'What employer CPF contribution is payable on an employee salary of S$5,000, and when should we request a refund of last month’s overpayment?',
  employerCpfPayableAndRefundClassification,
  { mode: 'DETERMINISTIC_FALLBACK', failure: 'NO_PROVIDER' }
).issuePlan;
assert.ok(employerCpfPayableAndRefundPlan.issues.some(issue => issue.operation === 'CALCULATE'),
  'The CPF amount request remains a calculation issue beside refund timing.');
assert.ok(employerCpfPayableAndRefundPlan.issues.some(issue => issue.mappedTopicIds.includes('cpf-adjustments-refunds') &&
  issue.operation !== 'CALCULATE'), 'The separate CPF refund request remains present.');
assert.equal(employerCpfPayableAndRefundPlan.coverageEstablished, false,
  'A salary alone does not establish all facts needed to calculate an employer CPF contribution.');
const variedCpfAmountAndRefundClassification = classifyQuestion('What CPF contribution amount is due on an employee salary of S$5,000, and when should we request a refund for last month’s overpayment?');
assert.equal(variedCpfAmountAndRefundClassification.calculationRequired, true,
  'A differently worded contribution-amount question also remains calculable beside refund timing.');
const explicitPayrollJournalClassification = classifyQuestion('Show the journal entry for an employee salary of SGD 5,000 and employer CPF contributions.');
assert.equal(explicitPayrollJournalClassification.journalEntryRequired, true,
  'An explicit salary and CPF journal request retains the payroll-entry path.');

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
  'Our registered office address changed on 1 January 2010. What rules applied then?',
  'Our registered office address changed on 12 October 2026. What was the public holiday pay entitlement then?'
]) {
  assert.equal(resolver.resolveAuthorityEvidenceDate(question, '2026-10-29').source, 'EXPLICIT',
    'Historical wording or a separate unnamed employment request must retain its date scope.');
}

assert.equal(STATUTORY_WORKFLOW_RULES_20261029.length, 10, 'The five existing workflows and five approved expansions are registered.');

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
    rendered: /prior MAS approval.*Form 11.*before appointing.*row 17.*separate subsequent notification.*Executive-to-Non-Executive.*as soon as practicable.*14.days.*resignation/i
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

  if (sample.id === 'cpf-refund') {
    const dateApplications = [
      ['CPF refund deadline: The joining bonus must be repaid if the employee leaves early. The employee also owes a supplier deposit. The employee must repay it on 15 September 2026. PAYMENTS RECEIVED ON 1 October 2025.', 'NO_MATCH', /one-year outer limit(?: is)? (?:15\/09\/2027|01\/10\/2026)/i],
      ['CPF refund deadline: The joining bonus must be repaid if the employee leaves early. The employee also owes a supplier deposit. The repayment due date is 15 September 2026 under the employment agreement. PAYMENTS RECEIVED ON 1 October 2025.', 'NO_MATCH', /one-year outer limit(?: is)? (?:15\/09\/2027|01\/10\/2026)/i],
      ['CPF refund deadline: The joining bonus must be repaid if the employee leaves early. The repayment due date for our supplier deposit is 15 September 2026. PAYMENTS RECEIVED ON 1 October 2025. What is the deadline?', 'NO_MATCH', /one-year outer limit(?: is)? (?:15\/09\/2027|01\/10\/2026)/i],
      ['CPF refund deadline: The joining bonus must be repaid if the employee leaves early. The repayment due date is 15 September 2026 for our supplier deposit. PAYMENTS RECEIVED ON 1 October 2025. What is the deadline?', 'NO_MATCH', /one-year outer limit(?: is)? (?:15\/09\/2027|01\/10\/2026)/i],
      ['CPF refund deadline: The joining bonus must be repaid if the employee leaves early, and the repayment due date for our supplier deposit is 15 September 2026. PAYMENTS RECEIVED ON 1 October 2025. What is the deadline?', 'NO_MATCH', /one-year outer limit(?: is)? (?:15\/09\/2027|01\/10\/2026)/i],
      ['CPF refund deadline: The joining bonus must be repaid if the employee leaves early. The bonus repayment due date is 15 September 2026 under the employment agreement. PAYMENTS RECEIVED ON 1 October 2025.', 'MATCH', /one-year outer limit is 15\/09\/2027/i, /one-year outer limit 01\/10\/2026/i],
      ['CPF refund deadline: CPF was paid on a conditional joining bonus in 2024. Under the employment terms, the employee had to repay the bonus on 15/09/2026.', 'MATCH', /one-year outer limit is 15\/09\/2027/i],
      ['CPF refund deadline: CPF was paid on a joining bonus that is repayable if the employee resigns within twelve months. The employee resigned, and the bonus repayment due date was 15 September 2026. The CPF payment record shows 1 October 2025.', 'MATCH', /one-year outer limit is 15\/09\/2027/i, /one-year outer limit 01\/10\/2026/i],
      ['CPF refund deadline: The joining bonus is conditional on completing twelve months of service. The employee must repay it on 15 September 2026 after leaving early.', 'MATCH', /one-year outer limit is 15\/09\/2027/i],
      ['CPF refund deadline: The joining bonus must be returned if the employee leaves early. Repayment due date is 15 September 2026 under the employment agreement.', 'MATCH', /one-year outer limit is 15\/09\/2027/i],
      ['CPF refund deadline: The joining bonus must be returned if the employee leaves early. The repayment due date is 15 September 2026 under the employment agreement.', 'MATCH', /one-year outer limit is 15\/09\/2027/i],
      ['CPF refund deadline: The joining bonus becomes repayable upon resignation. The employee resigned early, and the bonus repayment is due under the employment agreement on 15 September 2026.', 'MATCH', /one-year outer limit is 15\/09\/2027/i],
      ['CPF refund deadline: We paid a joining bonus. It has to be returned if the employee leaves early. The employee must repay it on 15 September 2026. PAYMENTS RECEIVED ON 1 October 2025.', 'MATCH', /one-year outer limit is 15\/09\/2027/i, /one-year outer limit 01\/10\/2026/i],
      ['CPF refund deadline: The joining bonus must be returned if the employee leaves early. Expense reimbursement repayment due date is 15 September 2026. PAYMENTS RECEIVED ON 1 October 2025.', 'NO_MATCH', /one-year outer limit(?: is)? (?:15\/09\/2027|01\/10\/2026)/i],
      ['CPF refund deadline: The joining bonus must be returned if the employee leaves early. Training expenses repayment due date is 15 September 2026. PAYMENTS RECEIVED ON 1 October 2025.', 'NO_MATCH', /one-year outer limit is/i],
      ['CPF refund deadline: The bonus repayment due date was 15 September 2026, or 20 September 2026; the agreement is unclear. PAYMENTS RECEIVED ON 1 October 2025.', 'NO_MATCH', /one-year outer limit(?: is)? (?:15\/09\/2027|20\/09\/2027|01\/10\/2026)/i],
      ['CPF refund deadline: We paid a joining bonus. It may have to be returned if the employee leaves early, but the repayment terms are unclear. PAYMENTS RECEIVED ON 1 October 2025.', 'NO_MATCH', /one-year outer limit is/i],
      ['CPF refund deadline: The joining bonus is repayable if the employee resigns early, and the retention bonus is repayable if the employee leaves before two years. The employee must repay the bonus on 15 September 2026. PAYMENTS RECEIVED ON 1 October 2025.', 'NO_MATCH', /one-year outer limit is/i],
      ['CPF refund deadline: The joining bonus must be returned if the employee leaves early. A loan is also mentioned, but it is unclear which repayment date belongs to the bonus. The employee must repay it on 15 September 2026. PAYMENTS RECEIVED ON 1 October 2025.', 'NO_MATCH', /one-year outer limit is/i],
      ['CPF refund deadline: The joining bonus becomes repayable upon resignation on 15 September 2026 after a minimum service period. The contract does not state a separate repayment due date.', 'NO_MATCH', /one-year outer limit is/i],
      ['CPF refund deadline: The conditional joining bonus must be repaid if the employee leaves early. A separate staff-loan repayment is due on 15 September 2026.', 'NO_MATCH', /one-year outer limit is/i],
      ['CPF refund deadline: The joining bonus is conditional on completing twelve months of service. The employee must repay it on 15 September 2026, but the bonus repayment due date is 20 September 2026.', 'NO_MATCH', /one-year outer limit is/i],
      ['CPF refund deadline: CPF was paid on a conditional bonus. Under the employment terms, the employee had to repay it on 31/02/2026.', 'NO_MATCH', /one-year outer limit is/i],
      ['CPF refund deadline: CPF was paid on a conditional bonus. Under the employment terms, the employee had to repay it on 29/02/2024.', 'NO_MATCH', /one-year outer limit is/i],
      ['CPF refund deadline: CPF was paid on a conditional bonus. Under the employment terms, the employee had to repay it on 15/09/2026; a mutual agreement set the repayment due date as 20/09/2026.', 'NO_MATCH', /one-year outer limit is/i],
      ['We received a mistaken CPF contribution; what is the refund deadline? PAYMENTS RECEIVED ON 6 November 2025.', 'MATCH', /one-year outer limit 06\/11\/2026/i],
      ['We accidentally paid our employee’s ordinary bonus twice. This was a payroll duplication, not a conditional payment. Under the employment terms, the employee had to repay the bonus on 15/09/2026. The payment record says PAYMENTS RECEIVED ON 01/10/2025. What is our CPF refund deadline?', 'MATCH', /one-year outer limit 01\/10\/2026/i, /one-year outer limit is 15\/09\/2027/i],
      ['CPF refund deadline: the bonus was not subject to any service condition. Under the employment terms, the employee had to repay the bonus on 15/09/2026. PAYMENTS RECEIVED ON 01/10/2025.', 'MATCH', /one-year outer limit 01\/10\/2026/i, /one-year outer limit is 15\/09\/2027/i],
      ['CPF was paid on a conditional bonus, but this was an ordinary payroll duplication, not a conditional payment. The employee must repay the bonus on 15/09/2026. PAYMENTS RECEIVED ON 01/10/2025. What is our CPF refund deadline?', 'NO_MATCH', /one-year outer limit is/i],
      ['CPF overpayment refund deadline: the payment record says PAYMENTS RECEIVED ON 01/10/2025; a second record says PAYMENTS RECEIVED ON 01/10/2025. We do not know which record relates to the overpayment.', 'NO_MATCH', /one-year outer limit is/i]
    ];
    for (const [query, outcome, pattern, forbidden] of dateApplications) {
      const dateExplanation = getStatutoryWorkflowEvidence(query, stream, issue);
      assert.ok(dateExplanation, `${query}: a date variant in the same refund family retains a verified general explanation.`);
      if (outcome === 'MATCH') {
        assert.match(dateExplanation.text, pattern, query);
        if (forbidden) assert.doesNotMatch(dateExplanation.text, forbidden,
          'Explicit payroll-duplication facts use the ordinary payment date rather than a bonus repayment date.');
      }
      else assert.doesNotMatch(dateExplanation.text, pattern,
        'Invalid, leap-day, or competing dates do not produce a calculated deadline.');
    }
  }
  if (sample.id === 'iras-record-retention') {
    const ya2025Query = 'Our company has a September year-end. Its accounts for the year ended 30/09/2024 relate to YA 2025, and the tax return has been filed. Can we shred the supporting invoices on 01/10/2029?';
    const application = getStatutoryWorkflowEvidence(ya2025Query, stream, issue);
    assert.ok(application, 'The frozen non-December-FYE question matches the company-record workflow.');
    assert.match(application.text, /For YA 2025, retain the records through at least 31 December 2029\./i);
    assert.match(application.text, /proposed disposal date 01\/10\/2029 is before the end of that period, so do not shred/i);
    assert.match(application.text, /filing the tax return does not end the retention period/i);
  }
  if (sample.id === 'acra-entity-changes') {
    const negatedForeign = 'We are a Singapore company, not a foreign company. Our registered office changed 20 days ago. Are we late?';
    const irrelevantElapsedDays = 'We are an overseas-incorporated company registered in Singapore as a foreign company. Our registered office update is pending, but an employee resigned 20 days ago. What ACRA deadline applies?';
    const overDeadlineElapsedDays = [
      'We are an overseas-incorporated company registered in Singapore as a foreign company. Our registered office changed 35 days ago. Are we late?',
      'We are an overseas-incorporated company registered in Singapore as a foreign company. Our registered office changed thirty-five days ago. Are we late?',
      'We are an overseas-incorporated company registered in Singapore as a foreign company. Our registered office changed thirty five days ago. Are we late?',
      'We are an overseas-incorporated company registered in Singapore as a foreign company. An employee resigned 20 days ago; our registered office changed thirty-five days ago. Are we late?'
    ];
    for (const query of [negatedForeign, irrelevantElapsedDays, ...overDeadlineElapsedDays]) {
      const application = getStatutoryWorkflowEvidence(query, stream, issue);
      assert.ok(application, 'An uncertain or unrelated elapsed period still receives general ACRA guidance.');
      assert.doesNotMatch(application.text, /20 days is within the foreign-company 30-day period/i,
        'A date is applied only to an affirmatively stated foreign-company information change.');
      assert.doesNotMatch(application.text, /not yet late/i,
        'An elapsed period above the stated 30-day limit cannot be described as timely.');
    }
  }

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
const historicalIrasQuestion = 'For our company accounting records for YA 2015, what retention period did the law require?';
assert.notEqual(resolver.resolveAuthorityEvidenceDate(historicalIrasQuestion, '2026-10-29').dateRole, 'CURRENT_WORKFLOW_FACT',
  'Past-tense statutory-duty wording preserves the historical YA scope.');
assert.equal(supportStatutoryWorkflowRule({ ...sourceOf(iras).input, query: historicalIrasQuestion }), false,
  'Current IRAS guidance cannot answer what the law required for the earlier YA.');
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

const { input: masInput } = sourceOf(mas);
for (const [before, incorrect] of [
  ['As soon as practicable', 'At a later date'],
  ['14 days from the date of', '30 days from the date of']
]) {
  assert.ok(masInput.sourceText.includes(before), `MAS row 17 timing premise exists: ${before}`);
  const changed = { ...masInput, sourceText: masInput.sourceText.replace(before, incorrect) };
  assert.equal(supportStatutoryWorkflowRule(changed), false,
    'MAS row 17 must prove the practical deadline and the resignation-only 14-day period.');
  assert.deepEqual(selectStatutoryWorkflowQuotes(changed), [],
    'A changed row 17 time limit cannot be displayed as source-backed guidance.');
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
for (const query of [
  'Our company has a September year-end. Its accounts for the year ended 30/09/2024 relate to YA 2025, and the tax return has been filed. Can we shred the supporting invoices on 01/10/2029?',
  'A company was struck off and dissolved on 15/08/2026. Its former director thinks the old YA retention periods have expired, so nobody needs to keep its books now. Is that right, and would responsibility differ if it had been wound up?',
  'We found an ordinary CPF overpayment on 01/10/2026. The payment record says PAYMENTS RECEIVED ON 06/11/2025. Do we have a year from discovering the mistake to request our money back?',
  'CPF was paid on a conditional joining bonus in 2024. Under the employment terms, the employee had to repay the bonus on 15/09/2026. We are applying in October 2026. Is the claim too old, and can we wait for CPF Board’s refund before returning the employee’s contribution share?',
  'An employee obtained SPR status on 7 August 2025. Is the move into the second CPF contribution year on 7 August 2026, or at the start of September?'
]) {
  assert.equal(resolver.resolveAuthorityEvidenceDate(query, '2026-10-29').dateRole, 'CURRENT_WORKFLOW_FACT',
    'Multiple dated facts remain current-rule inputs when their workflow roles are identified.');
}
for (const query of [
  'What deadline did we have under the ACRA rule for a change on 12 October 2010?',
  'Which rules did ACRA apply to an address change on 12 October 2010?',
  'What were the company record-retention requirements in YA 2010?'
]) {
  assert.notEqual(resolver.resolveAuthorityEvidenceDate(query, '2026-10-29').dateRole, 'CURRENT_WORKFLOW_FACT',
    'Past-law and historical applicability wording cannot be treated as a current-workflow fact date.');
}
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
  { authority: 'CPF', topic: 'cpf-adjustments-refunds', url: manifest.sources.find(item => item.fixture === 'cpf-refunds.html').url,
    query: 'The joining bonus must be repaid if the employee leaves early. The employee also owes a supplier deposit. The employee must repay it on 15 September 2026. PAYMENTS RECEIVED ON 1 October 2025. What is the CPF refund deadline?',
    expected: /conditional-wage refunds use the repayment due date/i,
    forbidden: /one-year outer limit(?: is)? (?:15\/09\/2027|01\/10\/2026)/i },
  { authority: 'CPF', topic: 'cpf-adjustments-refunds', url: manifest.sources.find(item => item.fixture === 'cpf-refunds.html').url,
    query: 'The joining bonus must be repaid if the employee leaves early. The employee also owes a supplier deposit. The repayment due date is 15 September 2026 under the employment agreement. PAYMENTS RECEIVED ON 1 October 2025. What is the CPF refund deadline?',
    expected: /conditional-wage refunds use the repayment due date/i,
    forbidden: /one-year outer limit(?: is)? (?:15\/09\/2027|01\/10\/2026)/i },
  { authority: 'ACRA', topic: 'acra-entity-information-changes', url: manifest.sources.find(item => item.fixture === 'acra-entity-updates.html').url,
    query: 'We are an overseas-incorporated company registered in Singapore as a foreign company. We changed our registered office twenty days ago. A colleague says every ACRA entity has only fourteen days. Are we already late?',
    expected: /foreign companies have 30 days.*20 days is within the foreign-company 30-day period.*not yet late/i },
  { authority: 'IRAS', topic: 'iras-company-record-retention', url: manifest.sources.find(item => item.fixture === 'iras-company-records.html').url,
    query: 'Our company has a September year-end. Its accounts for the year ended 30/09/2024 relate to YA 2025, and the tax return has been filed. Can we shred the supporting invoices on 01/10/2029?',
    expected: /YA 2025.*31 December 2029.*01\/10\/2029.*before the end of that period, so do not shred.*filing the tax return does not end the retention period/i },
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
    expected: /prior MAS approval.*Form 11.*before appointing.*row 17.*separate subsequent notification/i },
  { authority: 'IRAS', topic: 'iras-company-record-retention', url: manifest.sources.find(item => item.fixture === 'iras-company-records.html').url,
    query: 'A company was struck off and dissolved on 15/08/2026. Its former director thinks the old YA retention periods have expired, so nobody needs to keep its books now. Is that right, and would responsibility differ if it had been wound up?',
    expected: /officer immediately before dissolution.*five years after dissolution.*liquidator/i },
  { authority: 'CPF', topic: 'cpf-adjustments-refunds', url: manifest.sources.find(item => item.fixture === 'cpf-refunds.html').url,
    query: 'We found an ordinary CPF overpayment on 01/10/2026. The payment record says PAYMENTS RECEIVED ON 06/11/2025. Do we have a year from discovering the mistake to request our money back?',
    expected: /06\/11\/2026.*discovery of the error does not restart/i },
  { authority: 'CPF', topic: 'cpf-adjustments-refunds', url: manifest.sources.find(item => item.fixture === 'cpf-refunds.html').url,
    query: 'CPF was paid on a conditional joining bonus in 2024. Under the employment terms, the employee had to repay the bonus on 15/09/2026. We are applying in October 2026. Is the claim too old, and can we wait for CPF Board’s refund before returning the employee’s contribution share?',
    expected: /^(?=[\s\S]*15\/09\/2027)(?=[\s\S]*before applying, the employer must return the employee share directly to the employee)[\s\S]*$/i },
  { authority: 'CPF', topic: 'cpf-adjustments-refunds', url: manifest.sources.find(item => item.fixture === 'cpf-refunds.html').url,
    query: 'The joining bonus must be repaid if the employee leaves early. The repayment due date for our supplier deposit is 15 September 2026. PAYMENTS RECEIVED ON 1 October 2025. What is the CPF refund deadline?',
    expected: /conditional-wage refunds use the repayment due date/i,
    forbidden: /one-year outer limit(?: is)? (?:15\/09\/2027|01\/10\/2026)/i },
  { authority: 'CPF', topic: 'cpf-adjustments-refunds', url: manifest.sources.find(item => item.fixture === 'cpf-refunds.html').url,
    query: 'CPF was paid on a joining bonus that is repayable if the employee resigns within twelve months. The employee resigned, and the bonus repayment due date was 15 September 2026. The CPF payment record shows 1 October 2025. What is our CPF refund deadline?',
    expected: /one-year outer limit is 15\/09\/2027/i, forbidden: /one-year outer limit 01\/10\/2026/i },
  { authority: 'CPF', topic: 'cpf-adjustments-refunds', url: manifest.sources.find(item => item.fixture === 'cpf-refunds.html').url,
    query: 'CPF was paid on a joining bonus. It has to be returned if the employee leaves early. The employee must repay it on 15 September 2026. PAYMENTS RECEIVED ON 1 October 2025. What is the refund deadline?',
    expected: /one-year outer limit is 15\/09\/2027/i, forbidden: /one-year outer limit 01\/10\/2026/i },
  { authority: 'CPF', topic: 'cpf-adjustments-refunds', url: manifest.sources.find(item => item.fixture === 'cpf-refunds.html').url,
    query: 'CPF refund deadline: The joining bonus must be returned if the employee leaves early. The repayment due date is 15 September 2026 under the employment agreement. PAYMENTS RECEIVED ON 1 October 2025. What is the deadline?',
    expected: /one-year outer limit is 15\/09\/2027/i, forbidden: /one-year outer limit 01\/10\/2026/i },
  { authority: 'CPF', topic: 'cpf-adjustments-refunds', url: manifest.sources.find(item => item.fixture === 'cpf-refunds.html').url,
    query: 'CPF refund deadline: The joining bonus must be returned if the employee leaves early. Expense reimbursement repayment due date is 15 September 2026. PAYMENTS RECEIVED ON 1 October 2025. What is the refund deadline?',
    expected: /conditional-wage refunds use the repayment due date/i, forbidden: /one-year outer limit(?: is)? (?:15\/09\/2027|01\/10\/2026)/i },
  { authority: 'CPF', topic: 'cpf-adjustments-refunds', url: manifest.sources.find(item => item.fixture === 'cpf-refunds.html').url,
    query: 'The joining bonus must be returned if the employee leaves early. Training expenses repayment due date is 15 September 2026. PAYMENTS RECEIVED ON 1 October 2025. What is the CPF refund deadline?',
    expected: /conditional-wage refunds use the repayment due date/i, forbidden: /one-year outer limit(?: is)? (?:15\/09\/2027|01\/10\/2026)/i },
  { authority: 'CPF', topic: 'cpf-adjustments-refunds', url: manifest.sources.find(item => item.fixture === 'cpf-refunds.html').url,
    query: 'The bonus repayment due date was 15 September 2026, or 20 September 2026; the agreement is unclear. PAYMENTS RECEIVED ON 1 October 2025. What is the CPF refund deadline?',
    expected: /conditional-wage refunds use the repayment due date/i, forbidden: /one-year outer limit(?: is)? (?:15\/09\/2027|20\/09\/2027|01\/10\/2026)/i },
  { authority: 'MAS', topic: 'mas-lfmc-key-appointments', url: manifest.sources.find(item => item.fixture === 'mas-lfmc-toolkit.pdf').url,
    query: 'At our LFMC, an existing non-executive director will take an executive role. Since he is already on the board, can we simply notify MAS afterwards? Would moving an executive director into a non-executive role follow the same process?',
    expected: /prior MAS approval using Form 11.*Non-Executive to Executive.*already being on the board does not remove approval.*Executive-to-Non-Executive.*as soon as practicable.*14.days.*specifically attached to the resignation/i },
  { authority: 'CPF', topic: 'cpf-adjustments-refunds', url: manifest.sources.find(item => item.fixture === 'cpf-refunds.html').url,
    query: 'We paid wrongly submitted CPF contributions on 6 November 2025. The payment record says PAYMENTS RECEIVED ON 6 November 2025. When is the refund request due?',
    expected: /PAYMENTS RECEIVED ON.*06\/11\/2025.*one-year outer limit 06\/11\/2026/i },
  { authority: 'ACRA', topic: 'acra-entity-information-changes', url: manifest.sources.find(item => item.fixture === 'acra-entity-updates.html').url,
    query: 'We are an overseas-incorporated company registered in Singapore as a foreign company. Our registered office changed 20 days ago, and our entity email changed forty days ago. Are we late with both updates?',
    expected: /within 30 days/i, forbidden: /20 days is within the foreign-company 30-day period.*not yet late/i },
  { authority: 'IRAS', topic: 'iras-company-record-retention', url: manifest.sources.find(item => item.fixture === 'iras-company-records.html').url,
    query: 'Our company has YA 2025 records and was dissolved on 01/01/2026. Can we shred the records on 01/10/2030?',
    expected: /YA-based period for YA 2025 ends on 31 December 2029.*five-year post-dissolution period from 01\/01\/2026 ends on 01\/01\/2031.*retain the records through at least 01\/01\/2031.*do not shred the records then/i },
  { authority: 'IRAS', topic: 'iras-company-record-retention', url: manifest.sources.find(item => item.fixture === 'iras-company-records.html').url,
    query: 'Our company has YA 2025 records, was wound up on 01/01/2025 and dissolved on 01/01/2026. Can we shred the records on 01/01/2031?',
    expected: /post-dissolution period from 01\/01\/2026.*retain the records through at least 01\/01\/2031.*do not shred the records then/i },
  { authority: 'IRAS', topic: 'iras-company-record-retention', url: manifest.sources.find(item => item.fixture === 'iras-company-records.html').url,
    query: 'Our company has YA 2025 records and was dissolved, and plans to shred records on 01/10/2030. Is that safe?',
    expected: /dissolution date is not reliably stated.*do not treat the YA-based period as sufficient for destruction/i,
    forbidden: /2035|safe to shred|may destroy the records/i },
  { authority: 'ACRA', topic: 'acra-entity-information-changes', url: manifest.sources.find(item => item.fixture === 'acra-entity-updates.html').url,
    query: 'We are an overseas-incorporated company registered in Singapore as a foreign company. Our registered office changed 20 days ago. The company email was updated 40 days ago. Are both changes still within the notification period?',
    expected: /within 30 days/i, forbidden: /20 days is within the foreign-company 30-day period.*not yet late/i },
  { authority: 'ACRA', topic: 'acra-entity-information-changes', url: manifest.sources.find(item => item.fixture === 'acra-entity-updates.html').url,
    query: 'We are an overseas-incorporated company registered in Singapore as a foreign company. Our registered office changed 20 days ago. Our entity email was also updated, but I do not know when. Are both updates late?',
    expected: /within 30 days/i, forbidden: /20 days is within the foreign-company 30-day period.*not yet late/i },
  { authority: 'CPF', topic: 'cpf-adjustments-refunds', url: manifest.sources.find(item => item.fixture === 'cpf-refunds.html').url,
    query: 'We overpaid CPF on an unconditional joining bonus. The payment record says PAYMENTS RECEIVED ON 01/10/2025, and a separate staff-loan repayment is due on 15/09/2026. What is the refund deadline?',
    expected: /one-year outer limit 01\/10\/2026/i, forbidden: /one-year outer limit is 15\/09\/2027/i },
  { authority: 'CPF', topic: 'cpf-adjustments-refunds', url: manifest.sources.find(item => item.fixture === 'cpf-refunds.html').url,
    query: 'We overpaid CPF. One payment record says PAYMENTS RECEIVED ON 01/10/2025, another says PAYMENTS RECEIVED ON 15/09/2026. We do not know which record relates to this overpayment. What is our refund deadline?',
    expected: /immediately and no later than one year.*PAYMENTS RECEIVED ON/i,
    forbidden: /one-year outer limit(?: is)? (?:01\/10\/2026|15\/09\/2027)/i },
  { authority: 'CPF', topic: 'cpf-adjustments-refunds', url: manifest.sources.find(item => item.fixture === 'cpf-refunds.html').url,
    query: ordinaryBonusRefundQuestion,
    expected: /one-year outer limit 01\/10\/2026/i, forbidden: /one-year outer limit is 15\/09\/2027/i },
  { authority: 'CPF', topic: 'cpf-adjustments-refunds', url: manifest.sources.find(item => item.fixture === 'cpf-refunds.html').url,
    query: 'We overpaid CPF on an ordinary wage payment. It was not subject to any service condition. Under the employment terms, the employee had to repay that wage on 15/09/2026. The payment record says PAYMENTS RECEIVED ON 01/10/2025. What is the refund deadline?',
    expected: /one-year outer limit 01\/10\/2026/i, forbidden: /one-year outer limit is 15\/09\/2027/i },
  { authority: 'CPF', topic: 'cpf-adjustments-refunds', url: manifest.sources.find(item => item.fixture === 'cpf-refunds.html').url,
    query: 'CPF was paid on a conditional joining bonus. Under the employment terms, the employee had to repay a staff loan rather than the bonus on 15/09/2026. What is the employer refund deadline?',
    expected: /conditional-wage refunds use the repayment due date/i, forbidden: /one-year outer limit is 15\/09\/2027/i },
  { authority: 'CPF', topic: 'cpf-adjustments-refunds', url: manifest.sources.find(item => item.fixture === 'cpf-refunds.html').url,
    query: 'CPF was paid on a conditional joining bonus in 2024. Under the employment terms, the employee had to repay the bonus on 15/09/2026, but a mutual agreement sets the bonus repayment due date as 20/09/2026. We are applying for a refund. Which date is used?',
    expected: /conditional-wage refunds use the repayment due date/i, forbidden: /one-year outer limit is 15\/09\/2027|one-year outer limit is 20\/09\/2027/i },
  { authority: 'CPF', topic: 'cpf-adjustments-refunds', url: manifest.sources.find(item => item.fixture === 'cpf-refunds.html').url,
    query: 'We found an ordinary CPF overpayment on 01/10/2026. The payment record says PAYMENTS RECEIVED ON 06/11/2025, then later we discovered the mistake. Do we have a year to request our money back?',
    expected: /06\/11\/2026.*discovery of the error does not restart/i },
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
  const mixedCpfQuery = 'What employer CPF contribution is payable on an employee salary of S$5,000, and when should we request a refund of last month’s overpayment?';
  let mixedCpfWorkstreams;
  const mixedCpfResponse = await processAccountingQuery(mixedCpfQuery, null, 'SFRS_I', undefined, undefined, [], undefined,
    { onAuthorityWorkstreams: result => { mixedCpfWorkstreams = result; } });
  assert.deepEqual(mixedCpfResponse.scenarioState.directGroups || [], [],
    `An amount-only CPF question does not generate an unrequested salary journal: ${JSON.stringify(mixedCpfResponse.scenarioState.directGroups || [])}`);
  assert.doesNotMatch(mixedCpfResponse.messageText,
    /(?:employer|employee)(?:'s)? CPF (?:contribution|share)\s*(?:is|of|:)?\s*(?:S\$|SGD\s*\$?|\$)\s*\d/i,
    'The normal application path does not invent a CPF amount from salary alone.');
  assert.ok(mixedCpfWorkstreams, 'The exact mixed CPF request reaches the normal authority-workstream path.');
  const mixedCpfPlanIssues = mixedCpfWorkstreams.issuePlan.issues;
  assert.ok(mixedCpfPlanIssues.some(issue => issue.operation === 'CALCULATE'),
    'The normal application plan retains the CPF contribution amount request as a calculation issue.');
  assert.ok(mixedCpfPlanIssues.some(issue => issue.mappedTopicIds.includes('cpf-adjustments-refunds') &&
    issue.operation !== 'CALCULATE'),
  'The normal application plan keeps the independent CPF refund advice issue.');
  assert.equal(mixedCpfWorkstreams.issuePlan.coverageEstablished, false,
    'The salary alone does not establish enough facts to complete the mixed question.');
  const mixedCpfPresentation = createAuthorityEvidencePresentation(mixedCpfWorkstreams);
  const mixedCpfStream = mixedCpfPresentation.workstreams.find(item => item.authority === 'CPF');
  const mixedRefundIssue = mixedCpfStream?.issues.find(issue => /CPF employer refund timing/i.test(issue.subject) &&
    issue.operation === 'EXPLAIN_RULE' && issue.evidenceStatus === 'VERIFIED');
  assert.ok(mixedRefundIssue,
  'The presented CPF refund issue has verified source-backed rule evidence.');
  assert.ok(getStatutoryWorkflowEvidence(mixedCpfQuery, mixedCpfStream, mixedRefundIssue),
    'The exact mixed request can render the employer refund process beside the unresolved amount calculation.');
  assert.match(mixedCpfResponse.messageText,
    /CPF rule explanation:[\s\S]{0,700}Refund requests for CPF contributions generally must be made immediately and no later than one year from payment/i,
    'The normal application response renders refund timing guidance while leaving the salary-based CPF amount unresolved.');
  assert.ok(mixedCpfStream?.sources.some(source => source.officialUrl === manifest.sources.find(item => item.fixture === 'cpf-refunds.html').url &&
    source.claims.some(claim => claim.supportKind === 'EXACT_SOURCE_QUOTE' &&
      claim.fetchedSourceBinding?.canonicalUrl === source.officialUrl &&
      claim.issueIds.some(id => mixedCpfStream.issues.some(issue => issue.id === id)))),
  'The exact CPF refund procedure source is bound to the rendered mixed-query issue.');

  for (const sample of appCases) {
    let workstreams;
    let stream;
    let answerText = '';
    try {
      const response = await processAccountingQuery(sample.query, null, 'SFRS_I', undefined, undefined, [], undefined,
        { onAuthorityWorkstreams: result => { workstreams = result; } });
      answerText = response.messageText;
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
      if (sample.forbidden) assert.doesNotMatch(response.messageText, new RegExp(sample.forbidden.source, 'i'),
        `${sample.authority}: the rendered answer withholds an unsupported case-specific deadline conclusion.`);
      appResults.push({ authority: sample.authority, topic: sample.topic, ok: true,
        evidenceStatus: stream.evidenceStatus, officialUrl: sample.url });
    } catch (error) {
      appResults.push({ authority: sample.authority, topic: sample.topic, query: sample.query, ok: false,
        failure: String(error?.message || error).slice(0, 240),
        answer: (() => {
          const marker = `${sample.authority} rule explanation:`;
          const start = answerText.toLowerCase().indexOf(marker.toLowerCase());
          if (start < 0) return answerText.slice(-1_200);
          const end = answerText.indexOf('\n\n**Source:', start);
          return answerText.slice(start, end >= 0 ? end : start + 4_000);
        })(),
        issues: (stream?.issues || []).map(issue => ({
          subject: issue.subject, topicIds: issue.topicIds, operation: issue.operation,
          status: issue.evidenceStatus,
          gaps: Array.isArray(issue.gaps) ? issue.gaps.map(gap => typeof gap === 'string' ? gap : gap?.code || gap?.reason).filter(Boolean).slice(0, 8) : []
        })) });
    }
  }
  for (const query of [
    'Our employee earns S$400 in the month. Is there an employee CPF share?',
    'An employee received basic pay, overtime, a performance bonus and a reimbursed S$60 stationery purchase supported by a receipt. Which items are generally wages for CPF?',
    "Can we deduct an employee's salary for a S$400 uniform, recruitment costs and a foreign worker levy?",
    'A monthly salary is earned in March but, under our payroll terms, is payable on 20 April. Is it March Ordinary Wages under CPF?',
    'Our payroll vendor says CPF contributions for June are due on 14 July. What is the contribution due date and what is the 14th?'
  ]) {
    const response = await processAccountingQuery(query, null, 'SFRS_I', undefined, undefined, [], undefined, {});
    assert.doesNotMatch(response.messageText, /\b(?:journal entry|debit|credit)\b|\b(?:Dr|Cr)\s+/i,
      'A CPF share or wage-classification question does not produce an unrequested journal entry.');
    assert.doesNotMatch(response.messageText,
      /(?:employee|employer)(?:'s)? CPF (?:contribution|share)\s*(?:is|of|:)?\s*(?:S\$|SGD\s*\$?|\$)\s*\d/i,
      'A general CPF question does not invent a contribution amount from incidental monetary facts.');
    if (/Ordinary Wages under CPF|what is the contribution due date/i.test(query)) {
      assert.doesNotMatch(response.messageText, /\b(?:17|20)\s*%\b/i,
        'A wage-date or contribution-deadline question does not introduce an unrequested unqualified rate summary.');
    }
  }
  const employeeVoicedCpfQueries = [
    'I have to repay my joining bonus to my employer. Can I request a CPF refund?',
    'My employer made mistaken CPF contributions on my joining bonus; can I request money back?',
    'My employer paid CPF on my joining bonus. The payment record says PAYMENTS RECEIVED ON 1 October 2025. Can I request a CPF refund?'
  ];
  for (const query of employeeVoicedCpfQueries) {
    const { issuePlan } = reconcileQuestionUnderstanding(query, classifyQuestion(query),
      { mode: 'DETERMINISTIC_FALLBACK', failure: 'NO_PROVIDER' });
    assert.ok(!issuePlan.issues.some(issue => issue.population === 'EMPLOYER' &&
      /CPF employer refund timing/i.test(issue.subject)),
    'An employee asking about their own bonus cannot be interpreted as the employer applicant.');
    const response = await processAccountingQuery(query, null, 'SFRS_I', undefined, undefined, [], undefined, {});
    assert.doesNotMatch(response.messageText, /CPF rule explanation:/i,
      'Employee-voiced refund requests do not invent employer-only employee-share duties.');
  }
  const historicalResponse = await processAccountingQuery(historicalIrasQuestion, null, 'SFRS_I', undefined, undefined, [], undefined, {});
  assert.doesNotMatch(historicalResponse.messageText, /IRAS rule explanation:[\s\S]{0,500}at least five years from the relevant Year of Assessment/i,
    'The full application does not answer a historical legal-duty question with current guidance.');
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
