import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getIrasCpfExpansionEvidence,
  selectIrasCpfExpansionQuotes,
  supportIrasCpfExpansionRule
} from '../../src/retrieval/irasCpfExpansionRules.ts';
import { supportGeneralIrasRuleConcept } from '../../src/retrieval/irasRuleConceptSupport.ts';
import { cleanHtmlText } from '../../src/retrieval/sourceAdapters.ts';

const fixtureRoot = new URL('../fixtures/statutoryExpansionSources/', import.meta.url);
const read = name => readFileSync(new URL(name, fixtureRoot), 'utf8').trim();
const sourceByTopic = {
  'iras-gst-input-tax': {
    authority: 'IRAS', subject: 'General GST input tax claim eligibility',
    sourceText: cleanHtmlText(read('iras-gst-input-tax-native.html')),
    officialUrl: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax'
  },
  'iras-cit-eci': {
    authority: 'IRAS', subject: 'ECI filing deadlines and general waiver criteria',
    sourceText: cleanHtmlText(read('iras-eci-filing-native.html')),
    officialUrl: 'https://www.iras.gov.sg/taxes/corporate-income-tax/estimated-chargeable-income-(eci)-filing'
  },
  'cpf-additional-wages': {
    authority: 'CPF', subject: 'CPF classification of wages, allowances, reimbursements and bonuses',
    sourceText: read('cpf-wage-classification.txt'),
    officialUrl: 'https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions'
  }
};

const questions = [
  { topicId: 'iras-gst-input-tax', query: 'When can a business recover GST on purchases?', expected: /GST-registered.*used for its business/i },
  { topicId: 'iras-gst-input-tax', query: 'Who can claim input tax?', expected: /all applicable conditions/i },
  { topicId: 'iras-cit-eci', query: 'When is ECI due?', expected: /within three months after its financial year end/i },
  { topicId: 'iras-cit-eci', query: 'How long after FYE do companies have to submit estimated chargeable income?', expected: /within three months after its financial year end/i },
  { topicId: 'iras-cit-eci', query: 'Is ECI due three months after year end?', expected: /within three months after its financial year end/i },
  { topicId: 'iras-cit-eci', query: 'Does no accounting profit mean we can skip ECI?', expected: /annual revenue.*nil ECI/i },
  { topicId: 'cpf-additional-wages', query: 'Is a transport allowance wages for CPF?', expected: /meal and transport allowances/i },
  { topicId: 'cpf-additional-wages', query: 'Is a bonus wages for CPF?', expected: /annual performance bonus is an example/i },
  { topicId: 'cpf-additional-wages', query: 'How are reimbursements and cash bonuses classified for CPF?', expected: /qualifying reimbursement.*official employer expenses.*annual performance bonus/is }
];

function answerQuestion(question, { applicationStatus = 'NOT_REQUIRED', operation = 'EXPLAIN_RULE' } = {}) {
  const source = sourceByTopic[question.topicId];
  const request = { ...source, topicId: question.topicId, query: question.query };
  const quotes = selectIrasCpfExpansionQuotes(request);
  const issueId = 'natural-question';
  const issue = {
    id: issueId, subject: source.subject, population: source.authority === 'CPF' ? 'Employer' : 'Company',
    operation, evidenceStatus: 'VERIFIED', applicationStatus, claims: [], gaps: []
  };
  const claims = quotes.map((text, index) => ({
    text, supportKind: 'EXACT_SOURCE_QUOTE', issueIds: [issueId], provenance: 'LIVE_EXTERNAL',
    fetchedSourceBinding: {
      recordId: 'same-current-document', documentHash: 'a'.repeat(64), canonicalUrl: source.officialUrl,
      retrievedAt: '2026-10-26T00:00:00Z', claimIndex: index
    }
  }));
  const stream = {
    id: 'natural-question-stream', authority: source.authority,
    domain: question.topicId === 'iras-gst-input-tax' ? 'IRAS_GST'
      : question.topicId === 'iras-cit-eci' ? 'IRAS_CORPORATE_TAX' : 'CPF_PAYROLL',
    evidenceStatus: 'VERIFIED', applicationStatus, issues: [issue],
    sources: [{ title: 'Official current guidance', officialUrl: source.officialUrl,
      provenance: 'LIVE_EXTERNAL', claims }]
  };
  return { request, issue, stream, explanation: getIrasCpfExpansionEvidence(question.query, stream, issue) };
}

for (const question of questions) {
  const request = { ...sourceByTopic[question.topicId], topicId: question.topicId, query: question.query };
  assert.equal(supportIrasCpfExpansionRule(request), true, `${question.query}: the official complete rule supports this question`);
  assert.ok(selectIrasCpfExpansionQuotes(request).length > 0, `${question.query}: the complete rule passages are retained`);
  const { explanation } = answerQuestion(question);
  assert.match(explanation?.text || '', question.expected, `${question.query}: the answer states the material rule`);
  assert.equal(explanation?.officialUrl, request.officialUrl, `${question.query}: the official citation remains bound to the rule`);
}

const specificPurchase = {
  topicId: 'iras-gst-input-tax', query: 'Can we claim input tax on this purchase?'
};
const unresolved = answerQuestion(specificPurchase, { applicationStatus: 'UNRESOLVED', operation: 'CHECK_ELIGIBILITY' });
assert.match(unresolved.explanation?.text || '', /general rule only/i);
assert.match(unresolved.explanation?.text || '', /what was acquired and its business use.*supporting documents.*blocked-input-tax exception/i);
assert.equal(unresolved.issue.applicationStatus, 'UNRESOLVED',
  'Verifying the general rule does not change the unanswered claim application to verified.');

const specificEci = answerQuestion({ topicId: 'iras-cit-eci', query: 'Does my company qualify for the ECI waiver?' },
  { applicationStatus: 'UNRESOLVED' });
assert.match(specificEci.explanation?.text || '', /annual revenue.*nil ECI/i);
assert.match(specificEci.explanation?.text || '', /applicable year of assessment, annual revenue and pre-exemption ECI must be known/i);
assert.equal(specificEci.issue.applicationStatus, 'UNRESOLVED');

const specificCpf = answerQuestion({ topicId: 'cpf-additional-wages', query: 'Is a transport allowance wages for CPF?' },
  { applicationStatus: 'UNRESOLVED' });
assert.match(specificCpf.explanation?.text || '', /what it was for.*employment month.*payment timing/i);
assert.equal(specificCpf.issue.applicationStatus, 'UNRESOLVED');

const unresolvedNoProfit = answerQuestion({ topicId: 'iras-cit-eci', query: 'Does no accounting profit mean we can skip ECI?' },
  { applicationStatus: 'UNRESOLVED', operation: 'CHECK_ELIGIBILITY' });
assert.match(unresolvedNoProfit.explanation?.text || '', /accounting profit or book loss alone does not establish nil ECI/i);
assert.equal(unresolvedNoProfit.issue.applicationStatus, 'UNRESOLVED',
  'A general ECI waiver explanation does not decide the company-specific waiver application.');

const generalInputSource = sourceByTopic['iras-gst-input-tax'].sourceText;
for (const specificConcept of [
  'employee medical expenses',
  'private passenger car expenses',
  'golf club subscriptions',
  'specific medical insurance'
]) {
  assert.equal(supportGeneralIrasRuleConcept({
    sourceText: generalInputSource,
    domainId: 'IRAS_GST',
    topicIds: ['iras-gst-input-tax'],
    subject: 'general GST input tax claim conditions',
    population: 'COMPANY',
    concepts: [{ id: 'gst_input_tax_general_rule', label: specificConcept, terms: [specificConcept] }]
  }), undefined, `A complete general checklist does not prove the specific ${specificConcept} rule.`);
}

assert.equal(supportGeneralIrasRuleConcept({
  sourceText: sourceByTopic['iras-cit-eci'].sourceText,
  domainId: 'IRAS_CORPORATE_TAX',
  topicIds: ['iras-cit-eci'],
  subject: 'Whether no accounting profit establishes the ECI filing waiver',
  population: 'COMPANY',
  concepts: [{ id: 'eci_general_waiver', label: 'ECI filing waiver and nil ECI condition', terms: [] }]
}), true, 'A natural no-accounting-profit question can receive the full general ECI rule without a case conclusion.');
assert.notEqual(supportGeneralIrasRuleConcept({
  sourceText: sourceByTopic['iras-cit-eci'].sourceText,
  domainId: 'IRAS_CORPORATE_TAX',
  topicIds: ['iras-cit-eci'],
  subject: 'Investment holding company ECI waiver eligibility',
  population: 'COMPANY',
  concepts: [{ id: 'eci_investment_holding_eligibility', label: 'investment holding company ECI waiver', terms: [] }]
}), true, 'The general ECI adapter cannot establish a special-entity waiver application.');

assert.equal(supportIrasCpfExpansionRule({
  ...sourceByTopic['iras-gst-input-tax'], topicId: 'iras-gst-input-tax', query: 'When can a business recover GST on purchases?',
  officialUrl: 'https://www.iras.gov.sg/other-page'
}), false, 'A neighboring IRAS page cannot support the conditions for claiming input tax.');

console.log(`Statutory natural-question answerability regressions passed (${questions.length} general phrasings and ${3} unresolved applications).`);
