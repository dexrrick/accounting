import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getIrasCpfCoverageEvidence,
  selectIrasCpfCoverageQuotes,
  supportIrasCpfCoverageRule
} from '../../src/retrieval/irasCpfCoverageRules.ts';
import { verifyEvidenceClaims } from '../../src/verification/claimEvidenceVerifier.ts';
import { defaultExternalSourceValidator } from '../../src/retrieval/externalSourceValidator.ts';

const gstInput = (query, sourceText, subject = 'GST filing deadline and extension conditions') => ({
  authority: 'IRAS', topicId: 'iras-gst-filing-deadlines', query, subject, sourceText
});
const cpfDueInput = (query, sourceText, subject = 'CPF contribution legal due date and enforcement cut-off', officialUrl) => ({
  authority: 'CPF', topicId: 'cpf-contribution-due-dates', query, subject, sourceText, officialUrl
});
const cpfRateInput = (query, sourceText, subject = 'CPF contribution rate factors') => ({
  authority: 'CPF', topicId: 'cpf_contribution_rates', query, subject, sourceText
});
const presentedEvidence = ({ authority, domain, query, subject, population, operation, sourceUrl, title, quote, issueId = 'coverage-issue', claims }) => {
  const issue = { id: issueId, subject, population, operation, evidenceStatus: 'VERIFIED', applicationStatus: 'VERIFIED', claims: [], gaps: [] };
  const source = {
    key: 'official-current-page', title, publisher: authority, documentTitle: title, officialUrl: sourceUrl,
    provenance: 'LIVE_EXTERNAL', claims: claims || [{
      text: quote, supportKind: 'EXACT_SOURCE_QUOTE', issueIds: [issueId], provenance: 'LIVE_EXTERNAL',
      fetchedSourceBinding: {
        recordId: 'fixture-record', documentHash: 'a'.repeat(64), canonicalUrl: sourceUrl,
        retrievedAt: '2026-10-25T00:00:00Z'
      }
    }]
  };
  return {
    issue,
    stream: { authority, domain, evidenceStatus: 'VERIFIED', applicationStatus: 'VERIFIED', issues: [issue], sources: [source] },
    query
  };
};
const verifyBoundedQuote = (record, request, quote) => verifyEvidenceClaims([{
  kind: 'RULE', text: quote, quote, recordId: record.id
}], [record], {
  missingFacts: [], referenceDate: '2026-10-25', boundedCoverageRequest: request
});
const liveCoverageRecord = ({ authority, topicId, domain, officialUrl, sourceText, id = 'bounded-coverage-record', ...overrides }) => ({
  id, authority, sourceAuthority: authority, authorityName: authority, sourcePublisher: authority,
  legalOrStandardInstrument: 'Official guidance', documentTitle: 'Official guidance', standardOrActCode: authority,
  paragraphOrSection: topicId, sourceText, principleSummary: 'Current official guidance',
  officialSourceUrl: officialUrl, canonicalSourceUrl: officialUrl, domain, jurisdiction: 'Singapore',
  tags: [topicId], sourceStatus: 'NEEDS_REVIEW', sourceType: 'OFFICIAL_GUIDANCE', evidenceTier: 'OFFICIAL_GUIDANCE',
  isVerbatimText: false, verificationMethod: 'LIVE_OFFICIAL_TOPIC_VERIFIED', lastVerifiedDate: '2026-10-25',
  provenance: 'LIVE_EXTERNAL', lifecycleState: 'CANDIDATE', urlVerificationStatus: 'VERIFIED',
  documentHash: 'c'.repeat(64), retrievedAt: '2026-10-25T00:00:00.000Z', extractionStatus: 'PARTIAL',
  ...overrides
});

const gstDue = 'You must file your GST return and pay any tax due by the due date. You must file a “Nil” return even if you had no business activity during the accounting period. Your GST return and payment are due 1 month after the end of your accounting period. If you pay via GIRO, IRAS will deduct payment on the 15th day of the month after the payment due date. If the deduction date falls on a weekend or public holiday, deduction will be made on the next working day.';
const gstExtension = `${gstDue} As one month after the end of your accounting period is a reasonable deadline, extensions are generally not granted. We may grant an extension only if your request arises from one of the acceptable reasons below. Submit your extension request form at least 5 working days before the filing due date, together with all required supporting documents. If your request is not approved before the due date, late filing penalties will apply. You will also be required to file the outstanding GST F5 immediately.`;
const gstExtensionParagraphs = gstExtension.replace(/\. /g, '.\n\n');
const cpfDue = 'The due date for CPF contributions is on the last day of the calendar month. Enforcement action would be taken against employers who fail to pay by the 14th of the following month (or the next working day if the 14th falls on a Saturday, Sunday or Public Holiday). This includes imposing late payment interest charged at 1.5% per month commencing from the first day after the due date.';
const cpfEnforcementUrl = 'https://www.cpf.gov.sg/employer/compliance-and-rectifications/enforcement-and-penalties-for-non-compliance';
const cpfEnforcement = 'The CPF Board takes a serious view on employers who fail to pay CPF contributions correctly and promptly (the due date for CPF contributions is on the last day of the calendar month). Enforcement action will be taken against employers who fail to pay by the 14th of the following month (or the next working day if the 14th falls on a Saturday, Sunday or public holiday).\n\nThe CPF Board charges late payment interest at 1.5% per month, starting from the day after the due date, subject to a minimum amount of $5.';
const cpfRates = 'The following table summarises the current contribution rates for Singaporeans and SPRs from third year onwards, across different age groups. Contribution rates from 1 January 2026. CPF contribution rates vary based on your employee’s citizenship status, age group, and total wages. As an employer, you are required to pay CPF contributions for your employees who are Singapore Citizens and Singapore Permanent Residents earning total wages of more than $50 per month. View all tables for the full set of contribution rate tables covering all citizenship statuses and SPR years. Table 1: Singapore Citizen or Singapore Permanent Resident from the third year of SPR status. Table 2: SPR in the first year of SPR status. Table 3: SPR in the second year of SPR status. Please ensure that your employees inform you the date when they became Singapore Citizens or SPRs, as different CPF contribution rates are applicable. The first year begins on the day of SPR conversion. The second year begins on the first day of the month after the first anniversary. The third year begins on the first day of the month after the second anniversary. You and your employee who are in the first two years of SPR status can jointly apply to contribute CPF at a higher rate. The options are: You and your employee both contribute at full rates. You contribute at full rates while your employee continues to contribute at graduated rates. Step 2: Determine the rates based on age group and wage band. Different rates apply to different age groups. New contribution rates apply from the first day of the month after the employee’s 55th, 60th, 65th or 70th birthday. Wage band. Different rates apply for different wage bands.';

const gstQuery = 'When is a Singapore GST return due after a quarter?';
assert.equal(supportIrasCpfCoverageRule(gstInput(gstQuery, gstDue)), true,
  'IRAS due-date answers require both the period-based deadline and the continuing nil-return duty.');
const gstQuote = selectIrasCpfCoverageQuotes(gstInput(gstQuery, gstDue));
assert.equal(gstQuote.length, 1);
assert.ok(gstDue.includes(gstQuote[0]), 'Selected GST evidence is an exact contiguous source span.');

const compoundGst = 'Must we file a nil GST return, when is it due, and can IRAS extend the deadline?';
assert.equal(supportIrasCpfCoverageRule(gstInput(compoundGst, gstExtension)), true,
  'The compound GST answer preserves the nil-return duty, one-month deadline, narrow extension grounds and advance request conditions.');
const extensionQuote = selectIrasCpfCoverageQuotes(gstInput(compoundGst, gstExtension));
assert.equal(extensionQuote.length, 1);
assert.ok(extensionQuote[0].length <= 3_200);
assert.ok(gstExtension.includes(extensionQuote[0]), 'The extension quote remains source text rather than a stitched paraphrase.');
assert.equal(supportIrasCpfCoverageRule(gstInput(compoundGst, gstDue)), false,
  'A source without the extension limits cannot support the compound question.');
assert.equal(supportIrasCpfCoverageRule(gstInput(compoundGst, gstExtension.replace('not approved before the due date', 'approved automatically'))), false,
  'The rule rejects unsupported or contradictory automatic-approval wording.');
assert.equal(supportIrasCpfCoverageRule(gstInput(compoundGst, gstExtension.replace(', together with all required supporting documents', ''))), false,
  'An extension answer requires the source-stated supporting-document requirement.');
const gstExtensionPolarityCases = [
  ['nil-return duty', gstExtension.replace('You must file a “Nil” return', 'It is false that You must file a “Nil” return')],
  ['one-month filing deadline', gstExtension.replace('Your GST return and payment are due', 'It is false that Your GST return and payment are due')],
  ['GIRO timetable', gstExtension.replace('If you pay via GIRO', 'It is false that If you pay via GIRO')],
  ['GIRO weekend adjustment', gstExtension.replace('If the deduction date falls on a weekend or public holiday', 'It is false that If the deduction date falls on a weekend or public holiday')],
  ['general extension refusal', gstExtension.replace('extensions are generally not granted', 'It is false that extensions are generally not granted')],
  ['acceptable extension grounds', gstExtension.replace('We may grant an extension only if', 'It is false that We may grant an extension only if')],
  ['five-day request and supporting documents', gstExtension.replace('Submit your extension request form', 'It is false that Submit your extension request form')],
  ['late-penalty conditional', gstExtension.replace('If your request is not approved before the due date, late filing penalties will apply.', 'It is false that If your request is not approved before the due date, late filing penalties will apply.')],
  ['immediate GST F5 requirement', gstExtension.replace('You will also be required to file the outstanding GST F5 immediately.', 'It is false that You will also be required to file the outstanding GST F5 immediately.')],
  ['automatic approval contradiction', `${gstExtension} Extension requests are automatically approved.`],
  ['approval declared unnecessary', `${gstExtension} No approval is required for extension requests.`],
  ['extension reasons no longer restricted', `${gstExtension} Extensions may be granted regardless of acceptable reasons.`],
  ['documents declared unnecessary', `${gstExtension} No supporting documents are required.`],
  ['five-day lead time declared unnecessary', `${gstExtension} It is not necessary to submit the request at least 5 working days before the filing due date.`],
  ['late penalties expressly denied', `${gstExtension} Late filing penalties will not apply if approval is not obtained by the due date.`],
  ['GST F5 requirement expressly denied', `${gstExtension} You are not required to file the outstanding GST F5 immediately.`]
];
for (const [fact, sourceText] of gstExtensionPolarityCases) {
  const request = gstInput(compoundGst, sourceText);
  assert.equal(supportIrasCpfCoverageRule(request), false,
    `A contextual denial or reversal of the ${fact} premise invalidates the extension answer.`);
  assert.deepEqual(selectIrasCpfCoverageQuotes(request), [],
    `The selector cannot drop a denial of the ${fact} premise and return only positive fragments.`);
}
assert.equal(supportIrasCpfCoverageRule(gstInput(gstQuery, `${gstDue} Nil GST returns are optional. GST returns are due 3 months after the accounting period ends.`)), false,
  'Contradictory nil-return and filing-period statements fail the page proof.');
assert.equal(supportIrasCpfCoverageRule(gstInput(gstQuery,
  `${gstDue} It is false that your GST return and payment are due 1 month after the end of your accounting period.`)), false,
  'A negated GST due-date statement invalidates otherwise positive deadline evidence.');
assert.equal(supportIrasCpfCoverageRule(gstInput(gstQuery,
  `It is false that your GST return and payment are due 1 month after the end of your accounting period. ${gstDue}`)), false,
  'A false assertion is not cured by a separate positive source sentence.');
assert.equal(supportIrasCpfCoverageRule(gstInput(gstQuery, gstDue.replace('IRAS will deduct', 'IRAS will not deduct'))), false,
  'A negated GIRO deduction timetable cannot prove the filing answer.');

assert.equal(supportIrasCpfCoverageRule(gstInput('What was the GST filing rule in 2023?', gstDue)), false,
  'Current IRAS guidance does not establish historical applicability.');
assert.equal(supportIrasCpfCoverageRule({ ...gstInput(gstQuery, gstDue), authority: 'ACRA' }), undefined,
  'An IRAS topic cannot be borrowed for another authority.');
assert.equal(supportIrasCpfCoverageRule({ ...gstInput(gstQuery, 'GST returns are due 3 months after the period and nil returns are optional.'), subject: 'Company secretary deadline' }), false,
  'A recognized topic with an incompatible issue subject fails closed.');

const cpfQuery = 'When must employers pay monthly CPF contributions?';
assert.equal(supportIrasCpfCoverageRule(cpfDueInput(cpfQuery, cpfDue)), true,
  'The due-date answer preserves the legal due date, separate enforcement cut-off, weekend adjustment and interest start.');
const dueQuote = selectIrasCpfCoverageQuotes(cpfDueInput(cpfQuery, cpfDue));
assert.equal(dueQuote.length, 1);
assert.ok(cpfDue.includes(dueQuote[0]));
assert.match(dueQuote[0], /next working day/i);
assert.match(dueQuote[0], /day after the due date/i);
assert.equal(supportIrasCpfCoverageRule(cpfDueInput(cpfQuery,
  'CPF contributions are due on the 14th of the following month. Enforcement uses the last day of the calendar month.')), false,
'A source that swaps the legal due date with the enforcement date cannot verify the answer.');
assert.equal(supportIrasCpfCoverageRule(cpfDueInput(cpfQuery,
  `${cpfDue} The legal due date for CPF contributions is the 14th of the next month.`)), false,
'A conflicting legal due date invalidates an otherwise complete source passage.');
assert.equal(supportIrasCpfCoverageRule(cpfDueInput(cpfQuery,
  `${cpfDue} It is false that the due date for CPF contributions is on the last day of the calendar month.`)), false,
  'A negated CPF legal due-date statement invalidates the full proof.');
assert.equal(supportIrasCpfCoverageRule(cpfDueInput(cpfQuery,
  cpfDue.replace('This includes imposing', 'This EXCLUDES imposing'))), false,
  'A source exclusion of late-payment interest cannot satisfy the positive interest premise.');
assert.equal(supportIrasCpfCoverageRule(cpfDueInput(cpfQuery,
  `${cpfDue} This EXCLUDES imposing late payment interest.`)), false,
  'A separate contradictory exclusion of interest invalidates the positive source premise.');
assert.equal(supportIrasCpfCoverageRule(cpfDueInput('When were CPF contributions due in 2022?', cpfDue)), false);

const rateQuery = 'What information determines an employee’s CPF contribution rate?';
assert.equal(supportIrasCpfCoverageRule(cpfRateInput(rateQuery, cpfRates)), true,
  'The source supports a qualitative factor explanation, including PR-year options and effective-date awareness.');
const rateQuote = selectIrasCpfCoverageQuotes(cpfRateInput(rateQuery, cpfRates));
assert.equal(rateQuote.length, 1);
assert.ok(cpfRates.includes(rateQuote[0]));
assert.ok(rateQuote[0].length <= 3_200);
assert.match(rateQuote[0], /^CPF contribution rates vary based on/i,
  'The selected factor evidence begins at the official narrative explanation.');
assert.doesNotMatch(rateQuote[0], /contribution rates from 1 january 2026|\d+(?:\.\d+)?\s*%/i,
  'The qualitative quote omits the numeric rate schedule and its table heading.');
assert.equal(supportIrasCpfCoverageRule(cpfRateInput(rateQuery, cpfRates.replace('Contribution rates from 1 January 2026. ', ''))), true,
  'A qualitative factor explanation does not depend on including a numeric table marker in the answer proof.');
assert.equal(supportIrasCpfCoverageRule(cpfRateInput(rateQuery, cpfRates.replace(/citizenship status, age group, and total wages/i, 'age group only'))), false,
  'All three main rate factors must be evidenced.');
assert.equal(supportIrasCpfCoverageRule(cpfRateInput(rateQuery,
  `${cpfRates} It is false that CPF contribution rates vary based on citizenship status, age group, and total wages.`)), false,
  'A negated CPF rate-factor statement invalidates an otherwise complete current source.');
assert.equal(supportIrasCpfCoverageRule(cpfRateInput(rateQuery,
  `It is false that CPF contribution rates vary based on citizenship status, age group, and total wages. ${cpfRates}`)), false,
  'A separately stated false factor assertion cannot be canceled by positive text elsewhere.');
assert.equal(supportIrasCpfCoverageRule(cpfRateInput('Calculate CPF rate factors for our employee on $4,000 wages', cpfRates)), undefined,
  'The general factor answer does not determine personal rates or perform a calculation.');
assert.equal(supportIrasCpfCoverageRule(cpfRateInput('What are the current CPF contribution rates?', cpfRates)), undefined,
  'Questions asking for numeric schedules stay outside the qualitative factor explanation.');
assert.equal(supportIrasCpfCoverageRule({ ...cpfRateInput(rateQuery, cpfRates),
  topicId: 'cpf-contribution-due-dates' }), undefined,
'Qualitative rate-factor wording stays out of the due-date topic.');

const cpfRateEvidenceQuote = selectIrasCpfCoverageQuotes(cpfRateInput(rateQuery, cpfRates))[0];
const cpfRatePresentation = presentedEvidence({
  authority: 'CPF', domain: 'CPF_PAYROLL', query: rateQuery, subject: 'Employee and employer CPF contribution rate factors',
  population: 'Employer', operation: 'EXPLAIN_RULE',
  sourceUrl: 'https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay',
  title: 'How Much CPF Contributions to Pay', quote: cpfRateEvidenceQuote
});
const cpfRateAnswer = getIrasCpfCoverageEvidence(rateQuery, cpfRatePresentation.stream, cpfRatePresentation.issue);
assert.ok(cpfRateAnswer, 'A current, issue-bound official quote renders the qualitative CPF factor answer.');
assert.match(cpfRateAnswer.text, /citizenship|permanent-resident status/i);
assert.match(cpfRateAnswer.text, /age group/i);
assert.match(cpfRateAnswer.text, /total wages/i);
assert.match(cpfRateAnswer.text, /first two years/i);
assert.doesNotMatch(cpfRateAnswer.text, /\d+(?:\.\d+)?\s*%/, 'The rendered factor answer never invents numeric rates.');
assert.equal(getIrasCpfCoverageEvidence(rateQuery, {
  ...cpfRatePresentation.stream,
  sources: [{ ...cpfRatePresentation.stream.sources[0], officialUrl: 'https://example.com/not-cpf' }]
}, cpfRatePresentation.issue), undefined, 'A non-CPF source cannot render the answer.');
assert.equal(getIrasCpfCoverageEvidence(rateQuery, cpfRatePresentation.stream, {
  ...cpfRatePresentation.issue, id: 'different-issue'
}), undefined, 'Claims bound to another issue cannot render the answer.');
const splitRevisionClaims = [
  { ...cpfRatePresentation.stream.sources[0].claims[0], text: cpfRateEvidenceQuote.slice(0, 400) },
  {
    ...cpfRatePresentation.stream.sources[0].claims[0], text: cpfRateEvidenceQuote.slice(400),
    fetchedSourceBinding: { ...cpfRatePresentation.stream.sources[0].claims[0].fetchedSourceBinding, documentHash: 'b'.repeat(64) }
  }
];
assert.equal(getIrasCpfCoverageEvidence(rateQuery, {
  ...cpfRatePresentation.stream,
  sources: [{ ...cpfRatePresentation.stream.sources[0], claims: splitRevisionClaims }]
}, cpfRatePresentation.issue), undefined, 'Premises split across document revisions cannot be synthesized into an answer.');

const gstEvidenceQuote = selectIrasCpfCoverageQuotes(gstInput(gstQuery, gstDue))[0];
const gstPresentation = presentedEvidence({
  authority: 'IRAS', domain: 'IRAS_GST', query: gstQuery, subject: 'GST return filing deadline and nil-return duty',
  population: 'Company', operation: 'FILING_REQUIREMENT',
  sourceUrl: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/filing-gst/gst-filing-due-dates-and-requests-for-extension',
  title: 'GST Filing Due Dates', quote: gstEvidenceQuote
});
const gstAnswer = getIrasCpfCoverageEvidence(gstQuery, gstPresentation.stream, gstPresentation.issue);
assert.ok(gstAnswer, 'Verified GST deadline and nil-return premises render as a direct answer.');
assert.match(gstAnswer.text, /one month/i);
assert.match(gstAnswer.text, /nil return/i);
assert.doesNotMatch(gstAnswer.text, /extension/i, 'Ordinary deadline answers do not emit unproved extension requirements.');
const gstExtensionRequest = {
  authority: 'IRAS', topicId: 'iras-gst-filing-deadlines', query: compoundGst,
  subject: 'GST return filing deadline, nil-return duty and extension procedure'
};
const gstCompleteSpan = selectIrasCpfCoverageQuotes({ ...gstExtensionRequest, sourceText: gstExtensionParagraphs })[0];
assert.ok(gstCompleteSpan && gstCompleteSpan.includes('\n\n'), 'The extension selector retains the complete native multi-paragraph span.');
const gstLiveRecord = liveCoverageRecord({
  ...gstExtensionRequest, domain: 'IRAS_GST', officialUrl: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/filing-gst/gst-filing-due-dates-and-requests-for-extension',
  sourceText: gstExtensionParagraphs
});
const gstBoundedVerification = verifyBoundedQuote(gstLiveRecord, gstExtensionRequest, gstCompleteSpan);
assert.equal(gstBoundedVerification.accepted.length, 1,
  'The complete selected IRAS span is accepted across native paragraphs by the scoped verifier path.');
for (const [label, invalidRecord, invalidRequest, invalidQuote] of [
  ['wrong source URL', { ...gstLiveRecord, officialSourceUrl: 'https://example.com/gst', canonicalSourceUrl: 'https://example.com/gst' }, gstExtensionRequest, gstCompleteSpan],
  ['wrong authority', { ...gstLiveRecord, authority: 'CPF', sourceAuthority: 'CPF' }, gstExtensionRequest, gstCompleteSpan],
  ['wrong domain', { ...gstLiveRecord, domain: 'IRAS_TAX' }, gstExtensionRequest, gstCompleteSpan],
  ['wrong topic binding', { ...gstLiveRecord, tags: [] }, gstExtensionRequest, gstCompleteSpan],
  ['omitted supporting-document caveat', { ...gstLiveRecord, sourceText: gstExtensionParagraphs.replace('together with all required supporting documents', '') }, gstExtensionRequest, gstCompleteSpan],
  ['reordered selected span', gstLiveRecord, gstExtensionRequest, gstCompleteSpan.replace('extensions are generally not granted', 'TEMP').replace('We may grant an extension only', 'extensions are generally not granted').replace('TEMP', 'We may grant an extension only')],
  ['trimmed selected span', gstLiveRecord, gstExtensionRequest, gstCompleteSpan.replace(/If your request is not approved[\s\S]*$/, '')],
  ['tacked-on unrelated text', gstLiveRecord, gstExtensionRequest, `${gstCompleteSpan} An unrelated tax rule applies.`]
]) {
  const rejected = verifyBoundedQuote(invalidRecord, invalidRequest, invalidQuote);
  assert.equal(rejected.accepted.length, 0, `Bounded verification rejects ${label}.`);
}

const irasOfficialUrl = 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/filing-gst/gst-filing-due-dates-and-requests-for-extension';
const irasNativeHtml = readFileSync(new URL('../fixtures/statutoryCoverageSources/iras-gst-filing.html', import.meta.url), 'utf8');
const irasNativeText = defaultExternalSourceValidator.validateTopicContent(irasNativeHtml, {
  standardIdentifiers: [], expectedTitles: [], topicTerms: [], preferMainContent: false, requireSubstantiveBody: false
}).substantiveText || '';
const irasNativeRequest = { ...gstExtensionRequest, sourceText: irasNativeText, officialUrl: irasOfficialUrl };
assert.equal(supportIrasCpfCoverageRule(irasNativeRequest), true,
  'The official IRAS page proves the exact filing, extension-ground, 5-working-day, document, penalty and F5 premises.');
const irasNativeQuote = selectIrasCpfCoverageQuotes(irasNativeRequest);
assert.equal(irasNativeQuote.length, 1);
assert.ok(irasNativeQuote[0].length <= 3_200);
assert.ok(irasNativeText.includes(irasNativeQuote[0]), 'The native IRAS quote is a contiguous span from production-extracted source text.');
assert.match(irasNativeQuote[0], /at least 5 working days/i);
assert.match(irasNativeQuote[0], /supporting documents/i);
assert.match(irasNativeQuote[0], /late filing penalties will apply/i);
assert.match(irasNativeQuote[0], /outstanding GST F5 immediately/i);
const irasNativePresentation = presentedEvidence({
  authority: 'IRAS', domain: 'IRAS_GST', query: compoundGst, subject: gstExtensionRequest.subject,
  population: 'Company', operation: 'FILING_REQUIREMENT', sourceUrl: irasOfficialUrl,
  title: 'GST Filing Due Dates and Requests for Extension', quote: irasNativeQuote[0]
});
const irasNativeAnswer = getIrasCpfCoverageEvidence(compoundGst,
  irasNativePresentation.stream, irasNativePresentation.issue);
assert.ok(irasNativeAnswer, 'The native extension passage renders through the actual scoped answer builder.');
assert.match(irasNativeAnswer.text, /extensions are generally not granted/i);
assert.match(irasNativeAnswer.text, /at least five working days/i);
assert.match(irasNativeAnswer.text, /supporting documents/i);
assert.match(irasNativeAnswer.text, /late filing penalties apply/i);
assert.match(irasNativeAnswer.text, /outstanding GST F5 must be filed immediately/i);
const irasNativeRecord = liveCoverageRecord({
  ...gstExtensionRequest, domain: 'IRAS_GST', officialUrl: irasOfficialUrl, sourceText: irasNativeText
});
assert.equal(verifyBoundedQuote(irasNativeRecord, irasNativeRequest, irasNativeQuote[0]).accepted.length, 1,
  'The complete native IRAS passage passes only the scoped exact-span verifier path.');

const cpfDueQuote = selectIrasCpfCoverageQuotes(cpfDueInput(cpfQuery, cpfDue))[0];
const cpfDuePresentation = presentedEvidence({
  authority: 'CPF', domain: 'CPF_PAYROLL', query: cpfQuery, subject: 'CPF contribution legal due date and enforcement cut-off',
  population: 'Employer', operation: 'FILING_REQUIREMENT',
  sourceUrl: 'https://www.cpf.gov.sg/service/article/when-is-the-due-date-for-cpf-contributions',
  title: 'When Is the Due Date for CPF Contributions?', quote: cpfDueQuote
});
const cpfOtherPartialIssue = {
  ...cpfDuePresentation.issue, id: 'other-topic-issue', subject: 'CPF additional wage ceiling',
  evidenceStatus: 'INSUFFICIENT', applicationStatus: 'UNRESOLVED', claims: [], gaps: ['Another topic remains unsupported.']
};
const cpfDueAnswer = getIrasCpfCoverageEvidence(cpfQuery, {
  ...cpfDuePresentation.stream, evidenceStatus: 'INSUFFICIENT', issues: [cpfDuePresentation.issue, cpfOtherPartialIssue]
}, cpfDuePresentation.issue);
assert.ok(cpfDueAnswer, 'A verified due-date issue can render a scoped answer while another mapped topic remains unresolved.');
assert.match(cpfDueAnswer.text, /last day of the calendar month/i);
assert.match(cpfDueAnswer.text, /14th of the following month/i);
assert.doesNotMatch(cpfDueAnswer.text, /interest|1\.5%/i,
  'The FAQ due-date answer does not add interest terms that were not requested.');
const cpfInsufficientOwnIssue = { ...cpfDuePresentation.issue, evidenceStatus: 'INSUFFICIENT' };
assert.equal(getIrasCpfCoverageEvidence(cpfQuery, {
  ...cpfDuePresentation.stream, issues: [cpfInsufficientOwnIssue]
}, cpfInsufficientOwnIssue), undefined,
'A complete-looking quote cannot render the new summary when its own issue is not verified.');
assert.equal(getIrasCpfCoverageEvidence(cpfQuery, {
  ...cpfDuePresentation.stream, issues: [cpfInsufficientOwnIssue]
}, cpfDuePresentation.issue), undefined,
'A verified-looking argument cannot override the same issue remaining insufficient in its workstream.');

const cpfEnforcementRequest = cpfDueInput(cpfQuery, cpfEnforcement,
  'CPF contribution due date, enforcement cut-off and interest', cpfEnforcementUrl);
assert.equal(supportIrasCpfCoverageRule(cpfEnforcementRequest), true,
  'The official enforcement page proves the legal due date, 14th-day enforcement rule, working-day adjustment and qualified interest.');
const cpfEnforcementQuote = selectIrasCpfCoverageQuotes(cpfEnforcementRequest);
assert.equal(cpfEnforcementQuote.length, 1);
assert.ok(cpfEnforcement.includes(cpfEnforcementQuote[0]));
assert.match(cpfEnforcementQuote[0], /subject to a minimum amount of \$5/i,
  'The enforcement-page quote retains the $5 minimum attached to interest.');
const cpfEnforcementPresentation = presentedEvidence({
  authority: 'CPF', domain: 'CPF_PAYROLL', query: cpfQuery, subject: 'CPF contribution due date and enforcement',
  population: 'Employer', operation: 'FILING_REQUIREMENT', sourceUrl: cpfEnforcementUrl,
  title: 'Enforcement and Penalties for Non-Compliance', quote: cpfEnforcementQuote[0]
});
const cpfEnforcementAnswer = getIrasCpfCoverageEvidence(cpfQuery,
  cpfEnforcementPresentation.stream, cpfEnforcementPresentation.issue);
assert.ok(cpfEnforcementAnswer);
assert.match(cpfEnforcementAnswer.text, /1\.5% per month/i);
assert.match(cpfEnforcementAnswer.text, /subject to a minimum amount of \$5/i);
for (const [claim, sourceText] of [
  ['interest charge', `${cpfEnforcement}\n\nThe CPF Board does not charge late payment interest at 1.5% per month.`],
  ['interest payable', `${cpfEnforcement}\n\nLate payment interest is not payable.`],
  ['interest statement', `${cpfEnforcement}\n\nIt is false that the CPF Board charges late payment interest at 1.5% per month.`],
  ['$5 minimum qualification', `${cpfEnforcement}\n\nLate payment interest is not subject to a minimum amount of $5.`],
  ['$5 minimum assertion', `${cpfEnforcement}\n\nIt is false that late payment interest is subject to a minimum amount of $5.`]
]) {
  const request = cpfDueInput(cpfQuery, sourceText,
    'CPF contribution due date, enforcement cut-off and interest', cpfEnforcementUrl);
  assert.equal(supportIrasCpfCoverageRule(request), false,
    `A contextual denial or reversal of the ${claim} premise invalidates the enforcement answer.`);
  assert.deepEqual(selectIrasCpfCoverageQuotes(request), [],
    `The enforcement selector cannot omit a denial of the ${claim} premise.`);
}
for (const [claim, sourceText] of [
  ['legal last-day due date', cpfEnforcement.replace('the due date for CPF contributions is on the last day of the calendar month', 'It is false that the due date for CPF contributions is on the last day of the calendar month')],
  ['14th-day enforcement deadline', cpfEnforcement.replace('Enforcement action will be taken', 'It is false that enforcement action will be taken')],
  ['next-working-day adjustment', cpfEnforcement.replace('the next working day if the 14th falls', 'it is false that the next working day if the 14th falls')],
  ['interest rate and start date', cpfEnforcement.replace('The CPF Board charges late payment interest at 1.5% per month', 'It is false that the CPF Board charges late payment interest at 1.5% per month')]
]) {
  const request = cpfDueInput(cpfQuery, sourceText,
    'CPF contribution due date, enforcement cut-off and interest', cpfEnforcementUrl);
  assert.equal(supportIrasCpfCoverageRule(request), false,
    `A false-framed ${claim} invalidates the enforcement answer despite the remaining positive premises.`);
  assert.deepEqual(selectIrasCpfCoverageQuotes(request), [],
    `The enforcement selector rejects a quote after denial of the ${claim} premise.`);
}
const cpfMissingMinimum = cpfEnforcement.replace(', subject to a minimum amount of $5', '');
const cpfMissingMinimumRequest = cpfDueInput(cpfQuery, cpfMissingMinimum,
  'CPF contribution due date, enforcement cut-off and interest', cpfEnforcementUrl);
assert.equal(supportIrasCpfCoverageRule(cpfMissingMinimumRequest), false,
  'The enforcement-page proof fails closed if the attached $5 minimum is omitted.');
assert.equal(selectIrasCpfCoverageQuotes(cpfMissingMinimumRequest).length, 0);
const cpfDetachedMinimum = `${cpfMissingMinimum}\n\nA separate administrative fee is subject to a minimum amount of $5.`;
const cpfDetachedMinimumRequest = cpfDueInput(cpfQuery, cpfDetachedMinimum,
  'CPF contribution due date, enforcement cut-off and interest', cpfEnforcementUrl);
assert.equal(supportIrasCpfCoverageRule(cpfDetachedMinimumRequest), false,
  'An unrelated $5 minimum cannot qualify the separate interest statement.');
const cpfMissingMinimumRecord = liveCoverageRecord({
  ...cpfMissingMinimumRequest, domain: 'CPF_BOARD', officialUrl: cpfEnforcementUrl,
  sourceText: cpfMissingMinimum
});
assert.equal(verifyBoundedQuote(cpfMissingMinimumRecord, cpfMissingMinimumRequest, cpfEnforcementQuote[0]).accepted.length, 0,
  'The bounded verifier rejects an enforcement quote if its record omits the $5 qualification.');
const cpfMissingMinimumPresentation = presentedEvidence({
  authority: 'CPF', domain: 'CPF_PAYROLL', query: cpfQuery, subject: 'CPF contribution due date and enforcement',
  population: 'Employer', operation: 'FILING_REQUIREMENT', sourceUrl: cpfEnforcementUrl,
  title: 'Enforcement and Penalties for Non-Compliance', quote: cpfEnforcementQuote[0].replace(', subject to a minimum amount of $5', '')
});
assert.equal(getIrasCpfCoverageEvidence(cpfQuery,
  cpfMissingMinimumPresentation.stream, cpfMissingMinimumPresentation.issue), undefined,
  'The answer renderer cannot synthesize enforcement-page interest after dropping the minimum amount.' );

const differentRateQuery = 'Why do two employees with different ages or PR status have different CPF rates?';
const differentRateInput = cpfRateInput(differentRateQuery, cpfRates);
assert.equal(supportIrasCpfCoverageRule(differentRateInput), true,
  'Natural different-rate wording stays within the qualitative factors family.');
const differentRateQuote = selectIrasCpfCoverageQuotes(differentRateInput)[0];
const differentRatePresentation = presentedEvidence({
  authority: 'CPF', domain: 'CPF_PAYROLL', query: differentRateQuery,
  subject: 'Qualitative CPF rate factors for employees', population: 'Employer', operation: 'EXPLAIN_RULE',
  sourceUrl: 'https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay',
  title: 'How Much CPF Contributions to Pay', quote: differentRateQuote
});
const differentRateAnswer = getIrasCpfCoverageEvidence(differentRateQuery,
  differentRatePresentation.stream, differentRatePresentation.issue);
assert.ok(differentRateAnswer, 'The direct answer renderer handles natural different-rate wording.');
assert.match(differentRateAnswer.text, /citizenship|permanent-resident status/i);
assert.match(differentRateAnswer.text, /age group/i);
assert.match(differentRateAnswer.text, /total wages/i);
assert.doesNotMatch(differentRateAnswer.text, /\d+(?:\.\d+)?\s*%/,
  'The natural qualitative wording never emits numeric contribution rates.');

console.log('IRAS GST filing and CPF due-date/rate-factor practical-rule regressions passed.');
