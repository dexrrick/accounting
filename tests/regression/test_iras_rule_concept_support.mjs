import assert from 'node:assert/strict';
import { supportGeneralIrasRuleConcept } from '../../src/retrieval/irasRuleConceptSupport.ts';
import { matchesRequestedQuestionConcept } from '../../src/retrieval/evidenceQualityGate.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import { verifyEvidenceClaims } from '../../src/verification/claimEvidenceVerifier.ts';
import { irasResolverCases } from '../fixtures/irasResolverCases.mjs';

const frozen = id => {
  const item = irasResolverCases.find(candidate => candidate.id === id);
  assert.ok(item, `Frozen IRAS case ${id} exists.`);
  return item;
};
const issueOf = item => item.issues[0];
const asConcept = (label, terms, topicIds) => ({ id: 'arbitrary-concept-id', label, terms, topicIds });
const check = ({ sourceText, domainId, topicIds, subject, concepts = [], population = 'COMPANY' }) =>
  supportGeneralIrasRuleConcept({ sourceText, domainId, topicIds, subject, concepts, population });

const foreignCase = frozen('foreign-dividend-treatment');
const foreignSubject = issueOf(foreignCase).subject;
const foreignConcept = asConcept(foreignSubject, ['foreign dividend tax treatment', 'receipt rule'], foreignCase.requiredTopicIds);
const foreignRule = 'Foreign-sourced dividends are taxable when received in Singapore.';
assert.equal(check({
  sourceText: foreignRule,
  domainId: 'IRAS_CORPORATE_TAX',
  topicIds: foreignCase.requiredTopicIds,
  subject: foreignSubject,
  concepts: [foreignConcept]
}), true, 'A source can support the frozen foreign-dividend rule without repeating subsidiary framing.');
assert.equal(matchesRequestedQuestionConcept(foreignRule, foreignConcept, {
  domainId: 'IRAS_CORPORATE_TAX', topicIds: foreignCase.requiredTopicIds, subject: foreignSubject
}), true, 'The evidence-quality matcher invokes the bounded rule helper before its generic concept fallback.');

assert.equal(check({
  sourceText: 'Foreign income is taxable when received in Singapore.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: foreignCase.requiredTopicIds,
  subject: foreignSubject, concepts: [foreignConcept]
}), false, 'Foreign income without dividend wording cannot support the foreign-dividend concept.');
assert.equal(matchesRequestedQuestionConcept('Foreign income is taxable when received in Singapore.', foreignConcept, {
  domainId: 'IRAS_CORPORATE_TAX', topicIds: foreignCase.requiredTopicIds, subject: foreignSubject
}), false, 'Recognized but unsupported dividend scope cannot fall through to a broad generic concept match.');
assert.equal(check({
  sourceText: 'Domestic dividends paid by a foreign company are taxable when received in Singapore.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: foreignCase.requiredTopicIds,
  subject: foreignSubject, concepts: [foreignConcept]
}), false, 'A domestic dividend paid by a foreign company is not foreign-sourced dividend support.');
assert.equal(check({
  sourceText: 'Foreign-sourced dividends are taxable when received in Singapore.',
  domainId: 'IRAS_GST', topicIds: foreignCase.requiredTopicIds,
  subject: foreignSubject, concepts: [foreignConcept]
}), undefined, 'The foreign-dividend path is inactive outside the corporate-income-tax domain.');
assert.equal(check({
  sourceText: 'Foreign-sourced dividends are taxable when received in Singapore.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: foreignCase.requiredTopicIds,
  subject: foreignSubject, concepts: [foreignConcept], population: 'INDIVIDUAL'
}), undefined, 'The company-only helper does not activate for another population.');
assert.equal(check({
  sourceText: 'https://www.iras.gov.sg/taxes/corporate-income-tax/foreign-income',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: foreignCase.requiredTopicIds,
  subject: foreignSubject, concepts: [foreignConcept]
}), false, 'An official URL without substantive source text does not support the rule.');

for (const extra of ['treaty relief', 'foreign tax credit', 'Section 13 exemption conditions', 'tax outcome', 'filing requirement', 'applicable tax rate']) {
  const broaderConcept = asConcept(foreignSubject, [extra], foreignCase.requiredTopicIds);
  assert.equal(check({
    sourceText: foreignRule,
    domainId: 'IRAS_CORPORATE_TAX', topicIds: foreignCase.requiredTopicIds,
    subject: foreignSubject, concepts: [broaderConcept]
  }), undefined, `Specific foreign-income scope stays outside the new equivalence path: ${extra}`);
  assert.equal(matchesRequestedQuestionConcept(foreignRule, broaderConcept, {
    domainId: 'IRAS_CORPORATE_TAX', topicIds: foreignCase.requiredTopicIds, subject: foreignSubject
  }), matchesRequestedQuestionConcept(foreignRule, broaderConcept),
  `Broader foreign-income scope preserves legacy matching: ${extra}`);
}
assert.equal(check({
  sourceText: 'A dividend received from a non-resident payer may be subject to withholding tax.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: ['iras-withholding-tax-interest-royalties'],
  subject: 'withholding tax on dividend from non-resident payer'
}), undefined, 'An unrelated domestic/WHT dividend does not select the foreign-dividend family.');
assert.equal(check({
  sourceText: 'The company charges output tax on standard-rated supplies.',
  domainId: 'IRAS_GST', topicIds: ['iras-gst-standard-rated-supplies'],
  subject: 'general Singapore GST output tax charging rules'
}), undefined, 'GST output tax remains outside the input-tax family.');

const gstCase = frozen('gst-input-tax-general-rule');
const gstSubject = issueOf(gstCase).subject;
const gstConcept = asConcept(gstSubject, ['GST input tax claim and recovery'], gstCase.requiredTopicIds);
const gstRule = 'A GST-registered business may claim input tax on costs used to make taxable supplies, subject to the applicable conditions and a valid tax invoice.';
assert.equal(check({
  sourceText: gstRule, domainId: 'IRAS_GST', topicIds: gstCase.requiredTopicIds,
  subject: gstSubject, concepts: [gstConcept]
}), true, 'General GST rule support does not require source wording to repeat business-purchase framing.');
assert.equal(check({
  sourceText: 'Input tax may be claimed.', domainId: 'IRAS_GST', topicIds: gstCase.requiredTopicIds,
  subject: gstSubject, concepts: [gstConcept]
}), false, 'Input-tax claim wording alone lacks meaningful business, condition, document, or taxable-scope support.');
assert.equal(check({
  sourceText: gstRule, domainId: 'IRAS_GST', topicIds: gstCase.requiredTopicIds,
  subject: gstSubject, concepts: [asConcept(gstSubject, ['blocked motor-vehicle input tax eligibility'], gstCase.requiredTopicIds)]
}), undefined, 'Blocked and specific eligibility scopes stay outside general input-tax equivalence.');

const blockedInputTaxSource = UNIFIED_SOURCE_REGISTRY.GST_REG26_BLOCKED_INPUT_TAX;
assert.ok(blockedInputTaxSource?.sourceText, 'The approved blocked-input-tax source is present in the unified registry.');
assert.equal(check({
  sourceText: blockedInputTaxSource.sourceText, domainId: 'IRAS_GST', topicIds: gstCase.requiredTopicIds,
  subject: gstSubject, concepts: [gstConcept]
}), false, 'An isolated rule restricting specified blocked claims does not establish general input-tax recovery conditions.');

for (const extra of ['treaty', 'foreign tax credit', 'exemption conditions', 'tax outcome', 'filing', 'tax rates', 'blocked claim', 'specific eligibility']) {
  const broaderConcept = asConcept(gstSubject, [extra], gstCase.requiredTopicIds);
  assert.equal(check({
    sourceText: gstRule, domainId: 'IRAS_GST', topicIds: gstCase.requiredTopicIds,
    subject: gstSubject, concepts: [broaderConcept]
  }), undefined, `Specific GST scope stays outside the new equivalence path: ${extra}`);
  assert.equal(matchesRequestedQuestionConcept(gstRule, broaderConcept, {
    domainId: 'IRAS_GST', topicIds: gstCase.requiredTopicIds, subject: gstSubject
  }), matchesRequestedQuestionConcept(gstRule, broaderConcept),
  `Broader GST scope preserves legacy matching: ${extra}`);
}
const invoiceConcept = asConcept(gstSubject, ['input tax invoice and document requirements'], gstCase.requiredTopicIds);
assert.equal(check({ sourceText: gstRule, domainId: 'IRAS_GST', topicIds: gstCase.requiredTopicIds, subject: gstSubject, concepts: [invoiceConcept] }), undefined,
  'Explicit invoice/document requirements are outside the general GST equivalence path.');
assert.equal(matchesRequestedQuestionConcept(gstRule, invoiceConcept, {
  domainId: 'IRAS_GST', topicIds: gstCase.requiredTopicIds, subject: gstSubject
}), matchesRequestedQuestionConcept(gstRule, invoiceConcept), 'Invoice-specific GST scope preserves legacy matching.');

const privateCase = frozen('private-holiday-expense');
const privateSubject = issueOf(privateCase).subject;
const privateConcept = asConcept(privateSubject, ['private expense tax deductibility'], privateCase.requiredTopicIds);
assert.equal(check({
  sourceText: 'Domestic or private expenses are disallowed under the general income-tax rule.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: privateCase.requiredTopicIds,
  subject: privateSubject, concepts: [privateConcept]
}), true, 'Plural private expenses with explicit disallowance support the bounded deductibility rule.');
assert.equal(check({
  sourceText: 'Expenses wholly and exclusively incurred in producing income are deductible.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: privateCase.requiredTopicIds,
  subject: privateSubject, concepts: [privateConcept]
}), false, 'General business-cost wording without explicit private-expense disallowance is insufficient.');
for (const extra of ['Section 15 motor-car exception', 'tax rate', 'filing outcome', 'eligibility determination']) {
  assert.equal(check({
    sourceText: 'Domestic or private expenses are disallowed under the general income-tax rule.',
    domainId: 'IRAS_CORPORATE_TAX', topicIds: privateCase.requiredTopicIds,
    subject: privateSubject, concepts: [asConcept(privateSubject, [extra], privateCase.requiredTopicIds)]
  }), undefined, `Specific expense or outcome scope stays outside the new equivalence path: ${extra}`);
}
for (const qualifier of ['not private expense', 'non-deductible private expenses']) {
  assert.equal(check({
    sourceText: 'Domestic or private expenses are disallowed under the general income-tax rule.',
    domainId: 'IRAS_CORPORATE_TAX', topicIds: privateCase.requiredTopicIds,
    subject: privateSubject, concepts: [asConcept(privateSubject, [qualifier], privateCase.requiredTopicIds)]
  }), undefined, `A negated or materially qualified private-expense concept is outside the bounded general scope: ${qualifier}`);
}
assert.equal(check({
  sourceText: 'Domestic or private expenses are disallowed under the general income-tax rule.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: privateCase.requiredTopicIds,
  subject: privateSubject, concepts: [asConcept(privateSubject, ['not a private expense'], privateCase.requiredTopicIds)]
}), undefined, 'A negated private-expense semantic concept cannot enter the positive private-expense rule family.');

const royaltyCase = frozen('wht-royalty-general-rule');
const royaltySubject = issueOf(royaltyCase).subject;
const royaltyConcept = asConcept(royaltySubject, ['royalty withholding tax for non-resident company'], royaltyCase.requiredTopicIds);
assert.equal(check({
  sourceText: 'Withholding tax applies to royalty payments to a non-resident company.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: royaltyCase.requiredTopicIds,
  subject: royaltySubject, concepts: [royaltyConcept]
}), true, 'The WHT rule requires royalty, withholding tax, and the requested non-resident recipient scope.');
assert.equal(check({
  sourceText: 'Withholding tax applies to royalty payments to a foreign recipient.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: royaltyCase.requiredTopicIds,
  subject: royaltySubject, concepts: [royaltyConcept]
}), false, 'A foreign recipient reference does not replace explicit non-resident recipient scope.');
assert.equal(check({
  sourceText: 'Withholding tax applies to interest payments to non-resident companies.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: royaltyCase.requiredTopicIds,
  subject: royaltySubject, concepts: [royaltyConcept]
}), false, 'Interest-only support cannot cover a requested royalty rule.');
assert.equal(check({
  sourceText: 'Withholding tax applies to service fees paid to non-resident companies.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: royaltyCase.requiredTopicIds,
  subject: royaltySubject, concepts: [royaltyConcept]
}), false, 'Service-fee-only support cannot cover a requested royalty rule.');
for (const extra of ['treaty rate', 'withholding tax filing', 'tax calculation', 'eligibility outcome']) {
  assert.equal(check({
    sourceText: 'Withholding tax applies to royalty payments to a non-resident company.',
    domainId: 'IRAS_CORPORATE_TAX', topicIds: royaltyCase.requiredTopicIds,
    subject: royaltySubject, concepts: [asConcept(royaltySubject, [extra], royaltyCase.requiredTopicIds)]
  }), undefined, `Specific WHT scope stays outside the new equivalence path: ${extra}`);
}
assert.equal(check({
  sourceText: 'Withholding tax applies to royalty payments to a non-resident company.',
  domainId: 'IRAS_CORPORATE_TAX', topicIds: royaltyCase.requiredTopicIds,
  subject: royaltySubject, concepts: [asConcept(royaltySubject, ['royalty payments to a resident company'], royaltyCase.requiredTopicIds)]
}), undefined, 'An explicitly resident recipient cannot be treated as a requested non-resident recipient.');

// An attached heading/list rule remains one complete bounded source unit. The
// quote verifier remains literal and must accept the whole quoted unit before
// the general-rule helper can support it.
const foreignListRule = 'Tax on Foreign-Sourced Income Received in Singapore:\n• Foreign-sourced dividends received in Singapore are taxable upon receipt, subject to the applicable exemption conditions.';
const mapRecord = UNIFIED_SOURCE_REGISTRY.IRAS_CIT_FOREIGN_INCOME_SOURCE_MAP;
const literalRecord = {
  ...UNIFIED_SOURCE_REGISTRY.ITA_SEC14_GENERAL_DEDUCTION,
  sourceText: foreignListRule
};
const wholeListQuote = verifyEvidenceClaims([{
  kind: 'RULE', text: foreignListRule, quote: foreignListRule, recordId: literalRecord.id
}], [literalRecord], { targetDate: '2026-10-02' });
assert.equal(wholeListQuote.accepted.length, 1, 'The literal verifier accepts the complete headed/list source span.');
assert.equal(check({
  sourceText: wholeListQuote.accepted[0].quote, domainId: 'IRAS_CORPORATE_TAX',
  topicIds: foreignCase.requiredTopicIds, subject: foreignSubject, concepts: [foreignConcept]
}), true, 'A complete headed/list qualification supports the bounded foreign-dividend rule.');
const orphanDividendLabel = 'Foreign-sourced dividends.';
const orphanQuote = verifyEvidenceClaims([{
  kind: 'RULE', text: orphanDividendLabel, quote: orphanDividendLabel, recordId: literalRecord.id
}], [{ ...literalRecord, sourceText: orphanDividendLabel }], { targetDate: '2026-10-02' });
assert.equal(orphanQuote.accepted.length, 1, 'The verifier confirms the orphan phrase is literally present.');
assert.equal(check({
  sourceText: orphanQuote.accepted[0].quote, domainId: 'IRAS_CORPORATE_TAX',
  topicIds: foreignCase.requiredTopicIds, subject: foreignSubject, concepts: [foreignConcept]
}), false, 'A verified orphan dividend label does not establish the rule.');

assert.ok(mapRecord, 'The approved foreign-income source-map fixture is present.');

const endToEndCases = [
  { id: 'foreign-dividend-treatment', mapId: 'IRAS_CIT_FOREIGN_INCOME_SOURCE_MAP', topicIds: ['iras-foreign-sourced-income'],
    body: 'Foreign-sourced dividends received in Singapore are taxable upon receipt, subject to the applicable exemption conditions.',
    semanticDomain: 'IRAS_INCOME_TAX', operation: 'DETERMINE_TREATMENT', application: 'UNRESOLVED', label: issueOf(foreignCase).subject },
  { id: 'gst-input-tax-general-rule', mapId: 'IRAS_GST_INPUT_TAX_SOURCE_MAP', topicIds: ['iras-gst-input-tax'],
    body: 'A GST-registered business may claim input tax on costs used to make taxable supplies, subject to the applicable conditions and a valid tax invoice.',
    semanticDomain: 'IRAS_GST', operation: 'EXPLAIN_RULE', application: 'NOT_REQUIRED',
    label: issueOf(gstCase).subject },
  { id: 'private-holiday-expense', mapId: 'IRAS_CIT_EXPENSES_SOURCE_MAP', topicIds: ['iras-cit-deductibility'],
    body: 'Domestic or private expenses are not deductible for corporate income tax.',
    semanticDomain: 'IRAS_INCOME_TAX', operation: 'DETERMINE_TREATMENT', application: 'UNRESOLVED',
    label: 'private travel expense tax treatment', topiclessConcept: true },
  { id: 'wht-royalty-general-rule', mapId: 'IRAS_WHT_RATES_SOURCE_MAP', topicIds: ['iras-withholding-tax-interest-royalties'],
    body: 'Withholding tax applies to royalty payments made by a company to a non-resident company.',
    semanticDomain: 'IRAS_INCOME_TAX', operation: 'EXPLAIN_RULE', application: 'NOT_REQUIRED',
    label: issueOf(royaltyCase).subject }
];

const allowedMappedUrls = new Set(endToEndCases.map(item => UNIFIED_SOURCE_REGISTRY[item.mapId].officialSourceUrl));
// The test web adapter returns fixed synthetic official-page markup for known
// mapped pointers. No ambient fetch, model, discovery, or search provider is
// reachable from these cases.
const syntheticPageFetches = [];
const syntheticWebRetriever = {
  async fetchOfficialSource(url, options = {}) {
    assert.ok(allowedMappedUrls.has(url) || /\/withholding-tax\//i.test(url), `Only a reviewed mapped IRAS URL is fetched: ${url}`);
    syntheticPageFetches.push(url);
    const body = url === UNIFIED_SOURCE_REGISTRY.IRAS_CIT_FOREIGN_INCOME_SOURCE_MAP.officialSourceUrl ? endToEndCases[0].body
      : url === UNIFIED_SOURCE_REGISTRY.IRAS_GST_INPUT_TAX_SOURCE_MAP.officialSourceUrl ? endToEndCases[1].body
        : url === UNIFIED_SOURCE_REGISTRY.IRAS_CIT_EXPENSES_SOURCE_MAP.officialSourceUrl ? endToEndCases[2].body
          : endToEndCases[3].body;
    const title = options.topicValidation?.expectedTitles?.[0] || 'Synthetic IRAS mapped page';
    const escapeHtml = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const content = `<html><head><title>${escapeHtml(title)}</title></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></main></body></html>`;
    return {
      status: 'SUCCESS', httpStatus: 200, content, contentHash: 'b'.repeat(64),
      retrievedAt: '2026-10-02T00:00:00Z', sourceUrl: url, finalUrl: url,
      pageTitle: title, topicMatched: true, titleMatched: true, contentMatched: true,
      substantiveText: body, discoveredLinks: []
    };
  }
};
const emptyRetriever = {
  async retrieveSources() { return []; },
  getSourceById(id) { return UNIFIED_SOURCE_REGISTRY[id]; },
  findSourcesByStandardOrAct() { return []; }
};
const noDiscovery = { async discoverOfficialSourceCandidates() { return []; } };
const noSearch = { async searchOfficialDomainCandidates() { return []; } };
const centralResults = [];
for (const item of endToEndCases) {
  const sourceCase = frozen(item.id);
  const sourceIssue = issueOf(sourceCase);
  const label = item.label;
  const understanding = {
    mode: 'SEMANTIC_INTERPRETATION',
    interpretation: {
      jurisdiction: ['Singapore'], authorityCandidates: ['IRAS'], contextualAuthorities: [],
      domain: item.id === 'private-holiday-expense' && item.topiclessConcept ? 'IRAS_OTHER' : item.semanticDomain,
      population: 'COMPANY', primarySubject: sourceIssue.subject,
      concepts: [{ concept: label, role: 'PRIMARY' }],
      requestedOperation: item.operation, requiresUserSpecificFacts: item.application === 'UNRESOLVED',
      calculationRequested: false, factsExplicitlyProvided: [], confidence: 0.96
    }
  };
  const issueResult = {
    id: `e2e-${item.id}`, subject: sourceIssue.subject, population: 'COMPANY', domain: item.semanticDomain,
    governingAuthorities: ['IRAS'], contextualAuthorities: [], operation: item.operation,
    mappedTopicIds: item.topicIds,
    evidenceRequirement: item.application === 'UNRESOLVED' ? 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS' : 'AUTHORITATIVE_SOURCE',
    confidence: 0.96, status: 'MAPPED'
  };
  const result = await buildAuthorityWorkstreams(sourceCase.query, {
    source: 'SEMANTIC_ISSUES', issues: [issueResult], coverageEstablished: true, hasUnmappedResidual: false
  }, {
    retriever: emptyRetriever,
    questionUnderstanding: understanding,
    referenceDate: '2026-10-02',
    groundingOptions: {
      webRetriever: syntheticWebRetriever,
      discoveryAdapter: noDiscovery,
      officialDomainSearchAdapter: noSearch,
      authorityLevelDiscovery: false
    }
  });
  centralResults.push({ id: item.id, result, issue: result.workstreams[0].issues[0] });
}
for (const { id, result, issue } of centralResults) {
  assert.equal(issue.evidenceStatus, 'VERIFIED', `${id} reaches VERIFIED through mapped grounding, LOCAL rendering, literal verification, and central coverage. Gaps: ${JSON.stringify(issue.gaps)} Trace: ${JSON.stringify(issue.retrievalTrace)}`);
  assert.equal(issue.applicationStatus, endToEndCases.find(item => item.id === id).application,
    `${id} retains its independently derived application status.`);
  assert.ok(issue.sources.length > 0, `${id} has a source admitted by the real evidence-quality gate.`);
  assert.equal(issue.gaps.some(gap => gap.code === 'IRAS_SCOPE_NOT_COVERED' || gap.code === 'ISSUE_CONCEPT_UNCOVERED'), false,
    `${id} has no requested topic or semantic-concept coverage gap.`);
  assert.equal(result.gaps.length, 0, `${id} has no top-level issue-plan or evidence gaps.`);
}
assert.equal(syntheticPageFetches.length >= endToEndCases.length, true, 'All four cases exercised the injected mapped-page retrieval path.');

console.log('IRAS general-rule concept-support regressions passed.');
