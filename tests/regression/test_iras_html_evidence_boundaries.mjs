import assert from 'node:assert/strict';
import { cleanHtmlText } from '../../src/retrieval/sourceAdapters.ts';
import { ExternalSourceValidator } from '../../src/retrieval/externalSourceValidator.ts';
import { buildGroundedReasoningContext, selectRelevantFetchedText } from '../../src/services/groundingContextBuilder.ts';
import { defaultSourceRetriever } from '../../src/retrieval/sourceRetriever.ts';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import { renderIrasEvidenceResponse } from '../../src/services/irasEvidencePolicy.ts';
import { verifyEvidenceClaims } from '../../src/verification/claimEvidenceVerifier.ts';
import { completeVisibleEvidenceListSpan, splitEvidenceTextBlocks, visibleEvidenceListSpan } from '../../src/utils/evidenceTextBoundaries.ts';

const sourceCases = [
  {
    id: 'IRAS_HTML_MOTOR_GST',
    url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/common-scenarios---do-i-claim-gst/purchase-and-sale-of-motor-vehicles',
    html: '<main><h2>Purchase and Sale of Motor Vehicles</h2><div class="content"><p>For GST, input tax for purchase and sale of <strong>motor vehicles</strong> depends on whether the vehicle is a motor car.</p><div class="accordion-content"><p>Motor car purchase and running costs are generally not claimable under Regulation 27; other vehicles may qualify subject to ordinary input-tax conditions.</p></div></div></main>',
    quote: 'Motor car purchase and running costs are generally not claimable under Regulation 27; other vehicles may qualify subject to ordinary input-tax conditions.'
  },
  {
    id: 'IRAS_HTML_IR21',
    url: 'https://www.iras.gov.sg/taxes/individual-income-tax/employers/tax-clearance-for-foreign-spr-employees-(ir21)/tax-clearance-for-employees',
    html: '<main><h1>Tax Clearance for Employees</h1><section class="accordion"><h2>When to file Form IR21</h2><div class="accordion-content"><p>The employer must file <strong>Form IR21</strong> at least one month before the employee ceases work, starts an overseas posting, or leaves Singapore for over three months.</p></div><p>The employer must withhold monies when aware of the impending cessation, and listed scenarios do not require tax clearance.</p></section></main>',
    quote: 'The employer must file Form IR21 at least one month before the employee ceases work, starts an overseas posting, or leaves Singapore for over three months.'
  },
  {
    id: 'IRAS_HTML_BONUS',
    url: 'https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/what-is-taxable-what-is-not/employment-income/salary-bonus-director%27s-fee-commission-and-others',
    html: '<main><h1>Employment Income</h1><div class="accordion"><h2>Taxes on Bonuses</h2><section><p>Taxes on bonuses differ by entitlement timing. A contractual bonus becomes taxable when the employee is entitled, while a non-contractual bonus is generally taxable when paid.</p><ul><li>Bonuses paid in advance subject to future conditions are taxable on payment.</li></ul></section></div></main>',
    quote: 'Taxes on bonuses differ by entitlement timing. A contractual bonus becomes taxable when the employee is entitled, while a non-contractual bonus is generally taxable when paid.'
  }
];

function verifiedLocalRecord(sourceCase, sourceText) {
  return {
    id: sourceCase.id,
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore',
    sourcePublisher: 'Inland Revenue Authority of Singapore',
    legalOrStandardInstrument: 'IRAS Guidance',
    documentTitle: sourceCase.id,
    standardOrActCode: 'IRAS',
    paragraphOrSection: 'Official guidance',
    sourceText,
    principleSummary: 'Official IRAS guidance',
    officialSourceUrl: sourceCase.url,
    canonicalSourceUrl: sourceCase.url,
    domain: 'IRAS',
    jurisdiction: 'Singapore',
    tags: ['IRAS'],
    sourceStatus: 'VERIFIED',
    sourceType: 'OFFICIAL_GUIDANCE',
    evidenceTier: 'OFFICIAL_GUIDANCE',
    isVerbatimText: true,
    verificationMethod: 'STATUTORY_LEGISLATION_AUDIT',
    lastVerifiedDate: '2026-09-26',
    provenance: 'LOCAL_STATIC',
    lifecycleState: 'ACTIVE'
  };
}

const structureExample = cleanHtmlText('<h2>Heading</h2><p>Paragraph with <strong>inline bold</strong> text.</p><div>Next block</div><section>First item</section><ul><li>Second item</li></ul><table><tr><td>A</td><td>B</td></tr></table><p>Line one<br />Line two</p>');
assert.equal(structureExample,
  'Heading\n\nParagraph with inline bold text.\n\nNext block\n\nFirst item\n\nSecond item\n\nA | B\n\nLine one\nLine two',
  'HTML cleanup preserves structural blocks, table cells, and explicit line breaks without adding line breaks for inline tags.');

const nestedListText = new ExternalSourceValidator().validateTopicContent(
  '<html><head><title>Tax Clearance for Employees</title></head><body><main><h1>Tax Clearance for Employees</h1>' +
  '<p>IR21 clearance requires employers to file before the employee leaves Singapore.</p>' +
  '<p>If tax clearance is required, file Form IR21 before:</p><ul><li><section><div><h3>' +
  'The employer must file Form IR21 and withhold all monies when the employee stops work, starts an overseas posting, or plans to leave Singapore for an extended period. This nested detail is not an independent requirement.' +
  '</h3></div><table><tr><td>First table cell contains a separate employee departure detail.</td><td>Second table cell contains another separate departure condition.</td></tr>' +
  '<tr><td>First cell on the next row gives another departure timing.</td><td>Second cell on the next row gives a further timing example.</td></tr></table></section></li></ul></main></body></html>',
  { standardIdentifiers: ['IR21'], expectedTitles: ['Tax Clearance for Employees'], topicTerms: ['Form IR21'] }
).substantiveText || '';
assert.match(nestedListText, /\n\n•\s+The employer must file Form IR21/,
  'A long item nested in div/section/heading retains a separate paragraph boundary and its list marker.');
assert.match(nestedListText, /\|\s*•\s+Second table cell contains another separate departure condition\./,
  'Table cell separators remain intact and each cell carries the active list marker.');
assert.match(nestedListText, /\n\n•\s+\|\s*•\s+First cell on the next row gives another departure timing\./,
  'Table rows retain separate block boundaries with list markers.');

for (const sourceCase of sourceCases) {
  const sourceText = cleanHtmlText(sourceCase.html);
  const record = verifiedLocalRecord(sourceCase, sourceText);
  const result = verifyEvidenceClaims([{
    kind: 'RULE',
    text: sourceCase.quote,
    quote: sourceCase.quote,
    recordId: sourceCase.id
  }], [record], { missingFacts: [] });
  assert.equal(result.accepted.length, 1, sourceCase.id + ': complete paragraph survives HTML cleanup and passes strict evidence verification.');
  assert.equal(result.accepted[0].quote, sourceCase.quote);
}
const unrelatedParagraphs = Array.from({ length: 12 }, (_, index) =>
  '<p>Unrelated filing detail ' + index + ' has no bearing on vehicle eligibility.</p>').join('');
const separatedHtml = '<main><p>Motor vehicle input tax may be restricted.</p>' + unrelatedParagraphs +
  '<p>A qualifying vehicle exception may apply only when its conditions are met.</p></main>';
const selectedFragments = selectRelevantFetchedText(
  cleanHtmlText(separatedHtml),
  ['motor vehicle input tax', 'qualifying vehicle exception'],
  300,
  'motor vehicle input tax qualifying vehicle exception'
);
assert.match(selectedFragments, /\n\n/, 'Separated HTML passages retain a fragment boundary after excerpt selection.');
const combinedFragment = selectedFragments.replace(/\n\n/g, ' ');
const liveRecord = {
  ...verifiedLocalRecord({
    id: 'IRAS_HTML_LIVE_FRAGMENT',
    url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/common-scenarios---do-i-claim-gst/purchase-and-sale-of-motor-vehicles'
  }, selectedFragments),
  sourceStatus: 'NEEDS_REVIEW',
  provenance: 'LIVE_EXTERNAL',
  lifecycleState: 'CANDIDATE',
  isVerbatimText: false,
  verificationMethod: 'LIVE_OFFICIAL_TOPIC_VERIFIED',
  urlVerificationStatus: 'VERIFIED',
  documentHash: 'a'.repeat(64),
  retrievedAt: '2026-09-26T08:00:00.000Z'
};
const disconnectedQuote = verifyEvidenceClaims([{
  kind: 'RULE',
  text: combinedFragment,
  quote: combinedFragment,
  recordId: liveRecord.id
}], [liveRecord], { missingFacts: [] });
assert.equal(disconnectedQuote.accepted.length, 0,
  'A claim that joins separated HTML excerpts still fails strict source-span verification.');
assert.equal(disconnectedQuote.rejected[0].reason, 'QUOTE_NOT_WHOLE_SENTENCE_OR_PARAGRAPH');

const proseBeforeSingleList = 'The following requirement applies.' +
  '\n\n• A separate restriction applies to the listed category.';
const proseBeforeSingleListRecord = verifiedLocalRecord({
  id: 'IRAS_SINGLE_LIST_AFTER_PROSE',
  url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax'
}, proseBeforeSingleList);
const completeSingleListClaim = {
  kind: 'RULE', text: proseBeforeSingleList, quote: proseBeforeSingleList,
  recordId: proseBeforeSingleListRecord.id
};
const singleListScope = { missingFacts: [], expectedAuthority: 'IRAS', expectedDomain: 'IRAS' };
assert.equal(verifyEvidenceClaims([completeSingleListClaim], [proseBeforeSingleListRecord], singleListScope).accepted.length, 1,
  'The strict verifier accepts a full source span containing one bullet and its introduction.');
const proseBeforeSingleListPage = proseBeforeSingleList + '\n\n' +
  Array.from({ length: 12 }, (_, index) => `Background registration note ${index} contains unrelated information.`).join('\n\n');
assert.ok(selectRelevantFetchedText(
  proseBeforeSingleListPage, ['input tax eligibility', 'separate restriction'], 220, 'input tax eligibility restriction'
).includes(proseBeforeSingleList),
  'The selector retains the full one-bullet source span when a padded page exceeds the excerpt budget.');
const truncatedSingleListQuote = '• A separate restriction applies to the listed category.';
const rejectedSingleListQuote = verifyEvidenceClaims([{
  kind: 'RULE', text: truncatedSingleListQuote, quote: truncatedSingleListQuote,
  recordId: proseBeforeSingleListRecord.id
}], [proseBeforeSingleListRecord], singleListScope);
assert.equal(rejectedSingleListQuote.accepted.length, 0,
  'A single bullet introduced by prose is still protected against item-only quotation.');
assert.equal(rejectedSingleListQuote.rejected[0]?.reason, 'QUOTE_OMITS_ATTACHED_QUALIFICATION');
const independentGstRateParagraph = 'The GST rate applies to taxable supplies made by a GST-registered business.';
const unrelatedGlossaryBullet = '• Glossary note: This term is an unrelated label. ' +
  'Unrelated definition text. '.repeat(80);
const independentParagraphSource = independentGstRateParagraph + '\n\n' + unrelatedGlossaryBullet;
assert.equal(visibleEvidenceListSpan(splitEvidenceTextBlocks(independentParagraphSource), 0), undefined,
  'An independent sentence is not treated as the introduction to a glossary bullet.');
const independentParagraphRecord = verifiedLocalRecord({
  id: 'IRAS_INDEPENDENT_GST_RATE_PARAGRAPH',
  url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax'
}, independentParagraphSource);
assert.equal(verifyEvidenceClaims([{
  kind: 'RULE', text: independentGstRateParagraph, quote: independentGstRateParagraph,
  recordId: independentParagraphRecord.id
}], [independentParagraphRecord], { missingFacts: [] }).accepted.length, 1,
  'The strict verifier accepts the independent GST-rate paragraph from the original source.');
const independentParagraphPage = independentParagraphSource + '\n\n' +
  Array.from({ length: 12 }, (_, index) => `Background registration note ${index} contains unrelated information.`).join('\n\n');
for (const budget of [160, 300, 500]) {
  const selectedIndependentParagraph = selectRelevantFetchedText(
    independentParagraphPage, ['GST rate'], budget, 'GST rate'
  );
  assert.ok(selectedIndependentParagraph.includes(independentGstRateParagraph),
    `The independent GST-rate paragraph remains selectable at a ${budget}-character budget.`);
}
const temporalFollowingText = [
  'The following financial year is the reporting period for this example.',
  '• This glossary item is unrelated.'
].join('\n\n');
assert.equal(visibleEvidenceListSpan(splitEvidenceTextBlocks(temporalFollowingText), 0), undefined,
  'A factual reference to the following financial year is not a list introduction.');
const singleOrderedListWithQualification = [
  'The following qualification applies.',
  '1. You hold the required invoice.',
  'Unless a separate statutory restriction applies.'
].join('\n\n');
const singleOrderedListPage = singleOrderedListWithQualification + '\n\n' +
  Array.from({ length: 12 }, (_, index) => `Background registration note ${index} contains unrelated information.`).join('\n\n');
assert.ok(selectRelevantFetchedText(
  singleOrderedListPage, ['required invoice'], 500, 'required invoice'
).includes(singleOrderedListWithQualification),
  'A single ordered item remains complete with its attached qualification.');
assert.equal(completeVisibleEvidenceListSpan(splitEvidenceTextBlocks([
  'The following condition applies.',
  '2. The condition must be met.'
].join('\n\n')), 0), undefined,
  'A one-item ordered list starting at ordinal two remains incomplete.');

const mandatoryListIntroductions = [
  'The following conditions must all be satisfied.',
  'Applicants must meet all these requirements.',
  'Applicants must satisfy the conditions below.',
  'Eligibility requires satisfying all conditions described here.'
];
for (const [index, introduction] of mandatoryListIntroductions.entries()) {
  const list = [
    introduction,
    '• The applicant must satisfy the first eligibility condition.',
    '• The second condition is a material exclusion. ' + 'Supporting scope text. '.repeat(24).trimEnd(),
    '• The applicant must hold the required invoice.',
    'Unless the separate statutory exception applies.'
  ].join('\n\n');
  const page = list + '\n\n' + Array.from({ length: 20 }, (_, detail) =>
    `Unrelated background detail ${detail} does not describe eligibility.`).join('\n\n');
  const selected = selectRelevantFetchedText(page, ['required invoice'], 220, 'required invoice');
  assert.doesNotMatch(selected,
    /first eligibility condition|material exclusion|required invoice|statutory exception applies/,
    `An oversized marker-rooted list is withheld intact after introduction ${index + 1}.`);
  const withinBudget = selectRelevantFetchedText(page, ['required invoice'], 1_200, 'required invoice');
  assert.ok(withinBudget.includes(list),
    `An under-budget marker-rooted list stays together with its complete introduction and exception ${index + 1}.`);

  const record = verifiedLocalRecord({
    id: `IRAS_GENERIC_INTRO_LIST_${index}`,
    url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax'
  }, list);
  assert.equal(verifyEvidenceClaims([{
    kind: 'RULE', text: list, quote: list, recordId: record.id
  }], [record], { missingFacts: [], expectedAuthority: 'IRAS', expectedDomain: 'IRAS' }).accepted.length, 1,
  `A complete marker-rooted list verifies literally after introduction ${index + 1}.`);
  const partialQuote = '• The applicant must hold the required invoice.';
  const partial = verifyEvidenceClaims([{
    kind: 'RULE', text: partialQuote, quote: partialQuote, recordId: record.id
  }], [record], { missingFacts: [], expectedAuthority: 'IRAS', expectedDomain: 'IRAS' });
  assert.equal(partial.accepted.length, 0,
    `A single condition cannot verify as a complete list after introduction ${index + 1}.`);
  assert.equal(partial.rejected[0]?.reason, 'QUOTE_OMITS_ATTACHED_QUALIFICATION');
  const bareList = list.split('\n\n').slice(1).join('\n\n');
  const missingIntroduction = verifyEvidenceClaims([{
    kind: 'RULE', text: bareList, quote: bareList, recordId: record.id
  }], [record], { missingFacts: [], expectedAuthority: 'IRAS', expectedDomain: 'IRAS' });
  assert.equal(missingIntroduction.accepted.length, 0,
    `The full condition list alone cannot drop its immediately preceding source qualification ${index + 1}.`);
}

const unpunctuatedFactualText = 'The GST rate applies to taxable supplies made by a GST-registered business';
const unpunctuatedFactualPage = unpunctuatedFactualText + '\n\n' + unrelatedGlossaryBullet + '\n\n' +
  Array.from({ length: 12 }, (_, index) => `Unrelated registration note ${index}.`).join('\n\n');
const selectedUnpunctuatedFactual = selectRelevantFetchedText(
  unpunctuatedFactualPage, ['GST rate'], 160, 'GST rate'
);
assert.ok(selectedUnpunctuatedFactual.includes(unpunctuatedFactualText),
  'A standalone factual paragraph without terminal punctuation remains selectable before an unrelated bullet.');
const unpunctuatedFactualRecord = verifiedLocalRecord({
  id: 'IRAS_INDEPENDENT_GST_RATE_WITHOUT_PUNCTUATION',
  url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax'
}, unpunctuatedFactualPage);
assert.equal(verifyEvidenceClaims([{
  kind: 'RULE', text: unpunctuatedFactualText, quote: unpunctuatedFactualText,
  recordId: unpunctuatedFactualRecord.id
}], [unpunctuatedFactualRecord], { missingFacts: [] }).accepted.length, 1,
  'Literal claim verification accepts a standalone factual paragraph without punctuation before a glossary bullet.');
const shortUnpunctuatedFact = 'GST rate applies to taxable supplies';
const shortFactWithNavigation = [
  shortUnpunctuatedFact,
  '• Glossary label: unrelated term.',
  '• Navigation item: see another page.'
].join('\n\n');
assert.ok(selectRelevantFetchedText(shortFactWithNavigation + '\n\n' +
  Array.from({ length: 15 }, (_, index) => `Unrelated page detail ${index}.`).join('\n\n'),
['GST rate'], 100, 'GST rate').includes(shortUnpunctuatedFact),
'A short standalone fact remains independently selectable before multiple unrelated bullets.');

const tableContinuation = [
  'For recipients below age 55 | (a) Top-up to Special Account under the RSTU scheme',
  '* * *',
  '(b) Top-up to MediSave Account under the relevant scheme'
].join('\n\n');
const tableContinuationBlocks = splitEvidenceTextBlocks(tableContinuation);
const completeTableContinuation = completeVisibleEvidenceListSpan(tableContinuationBlocks, 2);
assert.equal(completeTableContinuation?.tableContinuation, true,
  'A lettered table continuation is joined to its preceding same-kind ordinal cell.');
const tableContinuationPage = tableContinuation + '\n\n' +
  Array.from({ length: 20 }, (_, index) => `Unrelated table context ${index}.`).join('\n\n');
assert.ok(selectRelevantFetchedText(tableContinuationPage, ['MediSave'], 500, 'MediSave', [tableContinuation])
  .includes(tableContinuation),
'A complete preferred table passage remains selectable across its lettered row continuation.');
const tableContinuationRecord = verifiedLocalRecord({
  id: 'IRAS_TABLE_ORDERED_CONTINUATION',
  url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax'
}, tableContinuation);
assert.equal(verifyEvidenceClaims([{
  kind: 'RULE', text: tableContinuation, quote: tableContinuation, recordId: tableContinuationRecord.id
}], [tableContinuationRecord], { missingFacts: [], expectedAuthority: 'IRAS', expectedDomain: 'IRAS' }).accepted.length, 1,
'The complete pipe-row and divider continuation verifies literally as one table span.');
assert.equal(verifyEvidenceClaims([{
  kind: 'RULE', text: '(b) Top-up to MediSave Account under the relevant scheme',
  quote: '(b) Top-up to MediSave Account under the relevant scheme', recordId: tableContinuationRecord.id
}], [tableContinuationRecord], { missingFacts: [], expectedAuthority: 'IRAS', expectedDomain: 'IRAS' }).accepted.length, 0,
'A single table continuation cannot verify without its preceding ordered row.');
const tableOnlyContinuation = [
  'Eligibility | (a) You must be registered.',
  '* * *',
  '(b) You hold the required invoice.'
].join('\n\n');
const tableOnlyContinuationRecord = verifiedLocalRecord({
  id: 'IRAS_TABLE_ONLY_CONTINUATION',
  url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax'
}, tableOnlyContinuation);
assert.equal(verifyEvidenceClaims([{
  kind: 'RULE', text: '(b) You hold the required invoice.', quote: '(b) You hold the required invoice.',
  recordId: tableOnlyContinuationRecord.id
}], [tableOnlyContinuationRecord], { missingFacts: [], expectedAuthority: 'IRAS', expectedDomain: 'IRAS' }).accepted.length, 0,
'A single table continuation cannot be verified apart from its ordered table row.');
assert.doesNotMatch(selectRelevantFetchedText(tableOnlyContinuation, ['required invoice'], 60, 'required invoice'),
  /You hold the required invoice/,
'A table continuation whose full ordered row exceeds the budget is withheld.');
const gappedTableContinuation = [
  'Eligibility | (a) You hold a valid business registration.',
  '* * *',
  '(c) You hold the required invoice.'
].join('\n\n');
const gappedTableRecord = verifiedLocalRecord({
  id: 'IRAS_GAPPED_TABLE_CONTINUATION',
  url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax'
}, gappedTableContinuation);
assert.equal(selectRelevantFetchedText(gappedTableContinuation, ['required invoice'], 100, 'required invoice'),
  gappedTableContinuation,
'A short gapped table source stays intact when it fits the excerpt budget.');
for (const fragment of ['Eligibility | (a) You hold a valid business registration.', '(c) You hold the required invoice.']) {
  assert.equal(verifyEvidenceClaims([{
    kind: 'RULE', text: fragment, quote: fragment, recordId: gappedTableRecord.id
  }], [gappedTableRecord], { missingFacts: [], expectedAuthority: 'IRAS', expectedDomain: 'IRAS' }).accepted.length, 0,
  'A fragment from a gapped (a)/(c) table continuation cannot pass literal verification.');
}
const realGappedNumberedListAfterTable = [
  'Definition | 1. Background scope.',
  '* * *',
  '1. The applicant must satisfy the first condition.',
  '3. The applicant must hold the required invoice.'
].join('\n\n');
assert.equal(completeVisibleEvidenceListSpan(splitEvidenceTextBlocks(realGappedNumberedListAfterTable), 2), undefined,
  'A pipe cell beginning with ordinal one cannot mask a gapped ordered list whose first item also starts at one.');
const continuedButGappedNumbered = realGappedNumberedListAfterTable.replace('1. The applicant must satisfy the first condition.',
  '2. The applicant must satisfy the first condition.').replace('3. The applicant must hold',
  '4. The applicant must hold');
assert.equal(completeVisibleEvidenceListSpan(splitEvidenceTextBlocks(continuedButGappedNumbered), 2), undefined,
  'A table ordinal followed by a gapped 2./4. tail remains incomplete.');
const continuedButGappedPage = continuedButGappedNumbered + '\n\n' +
  Array.from({ length: 18 }, (_, index) => `Unrelated table explanation ${index}.`).join('\n\n');
assert.doesNotMatch(selectRelevantFetchedText(continuedButGappedPage, ['required invoice'], 300, 'required invoice'),
  /Background scope|first condition|required invoice/,
'A table continuation with a later numbering gap does not expose a matching condition in retrieval.');
const continuedButGappedRecord = verifiedLocalRecord({
  id: 'IRAS_TABLE_GAPPED_CONTINUATION',
  url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax'
}, continuedButGappedNumbered);
assert.equal(verifyEvidenceClaims([{
  kind: 'RULE', text: continuedButGappedNumbered, quote: continuedButGappedNumbered,
  recordId: continuedButGappedRecord.id
}], [continuedButGappedRecord], { missingFacts: [], expectedAuthority: 'IRAS', expectedDomain: 'IRAS' }).accepted.length, 0,
'Literal verification rejects the full table span when its ordered continuation is gapped.');

const materiallyQualifiedIntro = [
  'Only these applicants are excluded.',
  '• Applicants in the first category are excluded.',
  '• Applicants in the second category are also excluded.',
  '• This additional class is excluded under the stated rule.'
].join('\n\n');
const materiallyQualifiedCore = materiallyQualifiedIntro.split('\n\n').slice(1).join('\n\n');
assert.ok(materiallyQualifiedCore.length < 200 && materiallyQualifiedIntro.length > 200,
  'The contextual budget control distinguishes the marker run from its preceding qualifier.');
const qualifiedBudgetPage = materiallyQualifiedIntro + '\n\n' +
  Array.from({ length: 12 }, (_, index) => `Background detail ${index} is unrelated.`).join('\n\n');
assert.doesNotMatch(selectRelevantFetchedText(qualifiedBudgetPage, ['applicants excluded'], 200, 'applicants excluded'),
  /first category|second category|additional class/,
  'A preceding material qualification counts against the budget; the bare list is not selected without it.');

const terminalMarkerSource = 'Only these applicants are excluded.\n\n• Applicants in the excluded category.';
const terminalMarkerRecord = verifiedLocalRecord({
  id: 'IRAS_TERMINAL_MARKER_ROOT_LIST',
  url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax'
}, terminalMarkerSource);
assert.equal(verifyEvidenceClaims([{
  kind: 'RULE', text: '• Applicants in the excluded category.', quote: '• Applicants in the excluded category.',
  recordId: terminalMarkerRecord.id
}], [terminalMarkerRecord], { missingFacts: [], expectedAuthority: 'IRAS', expectedDomain: 'IRAS' }).accepted.length, 0,
'The verifier checks a marker-rooted item even when it is the final source paragraph.');
assert.equal(verifyEvidenceClaims([{
  kind: 'RULE', text: terminalMarkerSource, quote: terminalMarkerSource, recordId: terminalMarkerRecord.id
}], [terminalMarkerRecord], { missingFacts: [], expectedAuthority: 'IRAS', expectedDomain: 'IRAS' }).accepted.length, 1,
'The complete preceding context and terminal marker-rooted item verify together.');

for (const listIntroduction of ['• Applicants with:', '• Applicants with —']) {
  const longApplicantContext = 'Only these applicants are excluded. ' + 'The material scope applies. '.repeat(10);
  const parentListSource = [
    longApplicantContext,
    listIntroduction,
    '◦ The required invoice must be available.',
    '◦ The additional qualifying status must also apply.',
    '• Other excluded applicants.'
  ].join('\n\n');
  const parentListBlocks = splitEvidenceTextBlocks(parentListSource);
  const parentListSpan = completeVisibleEvidenceListSpan(parentListBlocks, 1);
  assert.ok(parentListSpan?.contextQuote?.startsWith(longApplicantContext.trimEnd()),
    `The preceding scope remains attached to a marker-rooted ${listIntroduction.endsWith(':') ? 'colon' : 'dash'} list.`);
  assert.ok(parentListSpan.contextQuote.length > 180,
    'The parent list plus its preceding scope exceeds the excerpt budget.');
  assert.doesNotMatch(selectRelevantFetchedText(parentListSource, ['required invoice'], 180, 'required invoice'),
    /Applicants with|required invoice|qualifying status|Other excluded applicants/,
  'An over-budget parent list with mandatory preceding scope is withheld intact.');
  const parentListRecord = verifiedLocalRecord({
    id: `IRAS_PARENT_ROOT_${listIntroduction.endsWith(':') ? 'COLON' : 'DASH'}`,
    url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax'
  }, parentListSource);
  assert.equal(verifyEvidenceClaims([{
    kind: 'RULE', text: parentListSpan.quote, quote: parentListSpan.quote, recordId: parentListRecord.id
  }], [parentListRecord], { missingFacts: [], expectedAuthority: 'IRAS', expectedDomain: 'IRAS' }).accepted.length, 0,
  'Literal verification rejects a complete parent list that omits preceding source scope.');
  assert.equal(verifyEvidenceClaims([{
    kind: 'RULE', text: parentListSpan.contextQuote, quote: parentListSpan.contextQuote, recordId: parentListRecord.id
  }], [parentListRecord], { missingFacts: [], expectedAuthority: 'IRAS', expectedDomain: 'IRAS' }).accepted.length, 1,
  'Literal verification accepts the complete parent list with its preceding source scope.');
}

const numberedIntroduction = 'Applicants must meet all these requirements.';
const completeGenericNumberedList = [
  numberedIntroduction,
  '1. The applicant must meet the first condition.',
  '2. The applicant must hold the required invoice.',
  '3. The applicant must retain the supporting records.'
].join('\n\n');
const completeGenericNumberedPage = completeGenericNumberedList + '\n\n' +
  Array.from({ length: 18 }, (_, index) => `Unrelated numbered-list context ${index}.`).join('\n\n');
assert.ok(selectRelevantFetchedText(completeGenericNumberedPage, ['required invoice'], 650, 'required invoice')
  .includes(completeGenericNumberedList),
'A complete ordered list stays whole after a prose introduction that was not recognized by phrase pattern.');
const missingMiddleGenericNumberedList = completeGenericNumberedList.replace(
  '2. The applicant must hold the required invoice.\n\n', ''
);
const missingMiddleGenericNumberedPage = missingMiddleGenericNumberedList + '\n\n' +
  Array.from({ length: 18 }, (_, index) => `Unrelated numbered-list context ${index}.`).join('\n\n');
assert.doesNotMatch(selectRelevantFetchedText(
  missingMiddleGenericNumberedPage, ['required invoice', 'supporting records'], 650,
  'required invoice supporting records'
), /first condition|required invoice|supporting records/,
'A missing middle ordered condition leaves the entire marker run unselected after an unknown prose introduction.');

const shortGappedNumberedSource = [
  independentGstRateParagraph,
  numberedIntroduction,
  '1. The applicant must meet the first condition.',
  '3. The applicant must retain the supporting records.'
].join('\n\n');
const selectedShortGappedSource = selectRelevantFetchedText(
  shortGappedNumberedSource, ['supporting records'], 1_000, 'supporting records'
);
assert.equal(selectedShortGappedSource, shortGappedNumberedSource,
  'A short gapped ordered list remains intact with its visible numbering gap when the whole source fits.');
const selectedShortGappedFact = selectRelevantFetchedText(shortGappedNumberedSource, ['GST rate'], 1_000, 'GST rate');
assert.equal(selectedShortGappedFact, shortGappedNumberedSource,
  'The short-source fast path preserves the complete page, including prose around an incomplete ordered list.');
const shortGappedRecord = verifiedLocalRecord({
  id: 'IRAS_SHORT_GAPPED_NUMBERED_SOURCE',
  url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax'
}, shortGappedNumberedSource);
const shortGappedPartial = verifyEvidenceClaims([{
  kind: 'RULE', text: '3. The applicant must retain the supporting records.',
  quote: '3. The applicant must retain the supporting records.', recordId: shortGappedRecord.id
}], [shortGappedRecord], { missingFacts: [], expectedAuthority: 'IRAS', expectedDomain: 'IRAS' });
assert.equal(shortGappedPartial.accepted.length, 0,
'Literal verification does not certify one item from a gapped short ordered list.');
const shortGappedWhole = verifyEvidenceClaims([{
  kind: 'RULE', text: shortGappedNumberedSource, quote: shortGappedNumberedSource,
  recordId: shortGappedRecord.id
}], [shortGappedRecord], { missingFacts: [], expectedAuthority: 'IRAS', expectedDomain: 'IRAS' });
assert.equal(shortGappedWhole.accepted.length, 0,
'Literal verification does not certify the entire malformed ordered list as a complete list.');

const qualifiedMalformedApplicantsList = [
  'Applicants must meet all these requirements.',
  '1. The applicant satisfies condition A.',
  '3. The applicant satisfies condition C.',
  'Unless the statutory exception applies.'
].join('\n\n');
const qualifiedMalformedApplicantsRecord = verifiedLocalRecord({
  id: 'IRAS_GAPPED_APPLICANTS_LIST_WITH_EXCEPTION',
  url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax'
}, qualifiedMalformedApplicantsList);
const qualifiedMalformedApplicantsScope = { missingFacts: [], expectedAuthority: 'IRAS', expectedDomain: 'IRAS' };
const lastMalformedApplicantItemAndException = [
  '3. The applicant satisfies condition C.',
  'Unless the statutory exception applies.'
].join('\n\n');
assert.equal(verifyEvidenceClaims([{
  kind: 'RULE', text: lastMalformedApplicantItemAndException, quote: lastMalformedApplicantItemAndException,
  recordId: qualifiedMalformedApplicantsRecord.id
}], [qualifiedMalformedApplicantsRecord], qualifiedMalformedApplicantsScope).accepted.length, 0,
  'The last item and its attached exception cannot be quoted from a gapped numbered list.');
assert.equal(verifyEvidenceClaims([{
  kind: 'RULE', text: qualifiedMalformedApplicantsList, quote: qualifiedMalformedApplicantsList,
  recordId: qualifiedMalformedApplicantsRecord.id
}], [qualifiedMalformedApplicantsRecord], qualifiedMalformedApplicantsScope).accepted.length, 0,
  'A malformed full numbered list with its attached exception is not certified as complete.');
assert.equal(verifyEvidenceClaims([{
  kind: 'RULE', text: '3. The applicant satisfies condition C.', quote: '3. The applicant satisfies condition C.',
  recordId: qualifiedMalformedApplicantsRecord.id
}], [qualifiedMalformedApplicantsRecord], qualifiedMalformedApplicantsScope).accepted.length, 0,
  'An isolated item from the malformed numbered list remains rejected.');

const precedingRuleBeforeQualifiedList = [
  'The general statutory rule applies.',
  'Unless the following requirements apply.',
  '1. The applicant satisfies condition A.',
  '2. The applicant satisfies condition B.'
].join('\n\n');
const precedingRuleBeforeQualifiedListRecord = verifiedLocalRecord({
  id: 'IRAS_RULE_BEFORE_ATTACHED_LIST_QUALIFICATION',
  url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax'
}, precedingRuleBeforeQualifiedList);
const precedingRuleWithListIntroduction = [
  'The general statutory rule applies.',
  'Unless the following requirements apply.'
].join('\n\n');
assert.equal(verifyEvidenceClaims([{
  kind: 'RULE', text: precedingRuleWithListIntroduction, quote: precedingRuleWithListIntroduction,
  recordId: precedingRuleBeforeQualifiedListRecord.id
}], [precedingRuleBeforeQualifiedListRecord], qualifiedMalformedApplicantsScope).accepted.length, 0,
  'A generic attached span cannot overlap a protected list introduction and omit its conditions.');

const completeQualifiedApplicantsList = [
  'Applicants must meet all these requirements.',
  '1. The applicant satisfies condition A.',
  '2. The applicant satisfies condition B.',
  '3. The applicant satisfies condition C.',
  'Unless the statutory exception applies.'
].join('\n\n');
const completeQualifiedApplicantsRecord = verifiedLocalRecord({
  id: 'IRAS_COMPLETE_APPLICANTS_LIST_WITH_EXCEPTION',
  url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax'
}, completeQualifiedApplicantsList);
assert.equal(verifyEvidenceClaims([{
  kind: 'RULE', text: completeQualifiedApplicantsList, quote: completeQualifiedApplicantsList,
  recordId: completeQualifiedApplicantsRecord.id
}], [completeQualifiedApplicantsRecord], qualifiedMalformedApplicantsScope).accepted.length, 1,
  'A contiguous complete numbered list and attached exception remains accepted.');

const independentQualifiedProse = [
  'Childcare leave eligibility follows the ordinary service requirement.',
  'Unless the employee falls within the stated exception.'
].join('\n\n');
const independentQualifiedProseRecord = verifiedLocalRecord({
  id: 'IRAS_INDEPENDENT_QUALIFIED_PROSE',
  url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax'
}, independentQualifiedProse);
assert.equal(verifyEvidenceClaims([{
  kind: 'RULE', text: independentQualifiedProse, quote: independentQualifiedProse,
  recordId: independentQualifiedProseRecord.id
}], [independentQualifiedProseRecord], qualifiedMalformedApplicantsScope).accepted.length, 1,
  'An independent prose paragraph with its attached qualification still verifies as a complete source span.');
assert.equal(verifyEvidenceClaims([{
  kind: 'RULE', text: 'Childcare leave eligibility follows the ordinary service requirement.',
  quote: 'Childcare leave eligibility follows the ordinary service requirement.',
  recordId: independentQualifiedProseRecord.id
}], [independentQualifiedProseRecord], qualifiedMalformedApplicantsScope).accepted.length, 0,
  'Independent qualified prose still rejects a quote that omits its qualification.');

const childcareIntroduction = 'This section explains statutory rules. Childcare leave eligibility depends on these criteria.';
const childcareEligibilityList = [
  childcareIntroduction,
  '• The employee has completed three months of service.',
  '• The child is below seven years old.'
].join('\n\n');
const paddedChildcareEligibilityPage = childcareEligibilityList + '\n\n' +
  Array.from({ length: 18 }, (_, index) => `Unrelated background information ${index} concerns other statutory rules.`).join('\n\n');
const childcareQuerySelection = selectRelevantFetchedText(
  paddedChildcareEligibilityPage, [], 260, 'Childcare leave eligibility depends on these criteria'
);
assert.ok(childcareQuerySelection.includes(childcareEligibilityList),
  'Query relevance found only in the second introduction sentence keeps the entire list and context together.');
const childcareTopicSelection = selectRelevantFetchedText(
  paddedChildcareEligibilityPage, ['childcare leave eligibility'], 260
);
assert.ok(childcareTopicSelection.includes(childcareEligibilityList),
  'Topic relevance found in a list introduction scores the whole atomic list unit.');

const completeInputTaxConditions = [
  'Input tax requirements',
  '• The purchase is made for a real business purpose and supports the input tax claim.',
  '• This category is expressly barred by the applicable statutory schedule. This multi-sentence middle item is deliberately long and includes context that relevance scoring might otherwise omit while preserving the first and final bullets.',
  '• You hold the required invoice or import permit for the goods and services claimed.',
  'Unless the claim is subject to a separate statutory restriction.'
].join('\n\n');
const longInputTaxPage = completeInputTaxConditions + '\n\n' + Array.from({ length: 12 }, (_, index) =>
  'Unrelated filing information ' + index + ' does not describe the conditions for claiming input tax.').join('\n\n');
const selectedCompleteList = selectRelevantFetchedText(
  longInputTaxPage,
  ['input tax claim', 'tax invoice', 'invoice or import permit'],
  650,
  'conditions for claiming input tax tax invoice import permit'
);
assert.match(selectedCompleteList, /• The purchase/);
assert.match(selectedCompleteList, /• This category is expressly barred/);
assert.match(selectedCompleteList, /• You hold/,
  'Relevance selection keeps an unnumbered middle bullet and its second sentence when it selects a list.');
assert.ok(selectedCompleteList.includes(completeInputTaxConditions),
  'An unpunctuated heading keeps the full multi-sentence condition and attached qualification as one source unit.');
const periodEndedInputTaxConditions = completeInputTaxConditions.replace(
  'Input tax requirements', 'The following conditions must all be satisfied.'
);
const periodEndedInputTaxPage = periodEndedInputTaxConditions + '\n\n' + Array.from({ length: 12 }, (_, index) =>
  `Background registration note ${index} contains unrelated information.`).join('\n\n');
assert.ok(selectRelevantFetchedText(
  periodEndedInputTaxPage, ['input tax claim', 'invoice or import permit'], 650,
  'input tax claim invoice or import permit'
).includes(periodEndedInputTaxConditions),
  'A period-ended introduction retains the full bullet list and attached qualification within budget.');
const prefixedPeriodInputTaxConditions = periodEndedInputTaxConditions.replace(
  'The following conditions must all be satisfied.', 'To qualify, you must satisfy the following conditions.'
);
assert.ok(selectRelevantFetchedText(
  prefixedPeriodInputTaxConditions + '\n\n' + Array.from({ length: 12 }, (_, index) =>
    `Background registration note ${index} contains unrelated information.`).join('\n\n'),
  ['input tax claim', 'invoice or import permit'], 650, 'input tax claim invoice or import permit'
).includes(prefixedPeriodInputTaxConditions),
  'An inline forward reference keeps its period-ended introduction and full list together.');
const lowerCaseInputTaxConditions = completeInputTaxConditions.replace('Input tax requirements', 'input tax requirements');
const lowerCaseInputTaxPage = lowerCaseInputTaxConditions + '\n\n' + Array.from({ length: 12 }, (_, index) =>
  `Background registration note ${index} contains unrelated information.`).join('\n\n');
assert.ok(selectRelevantFetchedText(
  lowerCaseInputTaxPage, ['input tax claim', 'invoice or import permit'], 650,
  'input tax claim invoice or import permit'
).includes(lowerCaseInputTaxConditions),
  'A lowercase ordinary heading retains the full bullet list and its attached qualification within budget.');
const colonHeadingInputTaxConditions = completeInputTaxConditions.replace('Input tax requirements', 'Input tax requirements:');
assert.ok(selectRelevantFetchedText(
  colonHeadingInputTaxConditions + '\n\n' + Array.from({ length: 12 }, (_, index) =>
    `Background registration note ${index} contains unrelated information.`).join('\n\n'),
  ['input tax claim', 'invoice or import permit'], 650,
  'input tax claim invoice or import permit'
).includes(colonHeadingInputTaxConditions),
  'The existing colon-introduced list remains protected.');
const dashHeadingBulletList = [
  'Input tax requirements—',
  '• The purchase supports the business activity.',
  '• You hold the required invoice.'
].join('\n\n');
assert.ok(selectRelevantFetchedText(
  dashHeadingBulletList + '\n\n' + Array.from({ length: 12 }, (_, index) =>
    `Background registration note ${index} contains unrelated information.`).join('\n\n'),
  ['required invoice'], 500, 'required invoice'
).includes(dashHeadingBulletList),
  'An em dash heading preserves its complete bullet list.');

const completeHeadingListRecord = verifiedLocalRecord({
  id: 'IRAS_INPUT_TAX_UNPUNCTUATED_LIST',
  url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax'
}, completeInputTaxConditions);
const completeHeadingListClaim = {
  kind: 'RULE', text: completeInputTaxConditions, quote: completeInputTaxConditions,
  recordId: completeHeadingListRecord.id
};
assert.equal(verifyEvidenceClaims([completeHeadingListClaim], [completeHeadingListRecord], {
  missingFacts: [], expectedAuthority: 'IRAS', expectedDomain: 'IRAS'
}).accepted.length, 1,
  'The strict verifier accepts the complete source list beneath an ordinary heading without punctuation.');
const omittedHeadingListClaim = {
  ...completeHeadingListClaim,
  text: '• The purchase is made for a real business purpose and supports the input tax claim.',
  quote: '• The purchase is made for a real business purpose and supports the input tax claim.'
};
const rejectedOmittedHeadingList = verifyEvidenceClaims([omittedHeadingListClaim], [completeHeadingListRecord], {
  missingFacts: [], expectedAuthority: 'IRAS', expectedDomain: 'IRAS'
});
assert.equal(rejectedOmittedHeadingList.accepted.length, 0,
  'The verifier rejects a single condition quoted from a list under an unpunctuated heading.');
assert.equal(rejectedOmittedHeadingList.rejected[0]?.reason, 'QUOTE_OMITS_ATTACHED_QUALIFICATION');
const periodEndedListRecord = verifiedLocalRecord({
  id: 'IRAS_INPUT_TAX_PERIOD_ENDED_LIST',
  url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax'
}, periodEndedInputTaxConditions);
const periodEndedListClaim = {
  kind: 'RULE', text: periodEndedInputTaxConditions, quote: periodEndedInputTaxConditions,
  recordId: periodEndedListRecord.id
};
const periodEndedListScope = { missingFacts: [], expectedAuthority: 'IRAS', expectedDomain: 'IRAS' };
assert.equal(verifyEvidenceClaims([periodEndedListClaim], [periodEndedListRecord], periodEndedListScope).accepted.length, 1,
  'The strict verifier accepts the complete list after a period-ended introduction.');
const periodEndedPartialQuote = '• The purchase is made for a real business purpose and supports the input tax claim.';
const rejectedPeriodEndedPartialList = verifyEvidenceClaims([{
  ...periodEndedListClaim, text: periodEndedPartialQuote, quote: periodEndedPartialQuote
}], [periodEndedListRecord], periodEndedListScope);
assert.equal(rejectedPeriodEndedPartialList.accepted.length, 0,
  'The strict verifier rejects a single condition from the list after a period-ended introduction.');
assert.equal(rejectedPeriodEndedPartialList.rejected[0]?.reason, 'QUOTE_OMITS_ATTACHED_QUALIFICATION');

const completeNumberedHeadingList = [
  'input tax requirements',
  '1. The purchase must support a genuine business activity.',
  '2. The statutory exclusion applies to the relevant class of supplies.',
  '3. You must hold the required invoice or import permit.'
].join('\n\n');
const numberedHeadingPage = completeNumberedHeadingList + '\n\n' +
  Array.from({ length: 12 }, (_, index) => `Background registration note ${index} contains unrelated information.`).join('\n\n');
const selectedNumberedHeadingList = selectRelevantFetchedText(
  numberedHeadingPage, ['invoice or import permit'], 500, 'input tax invoice or import permit'
);
assert.ok(selectedNumberedHeadingList.includes(completeNumberedHeadingList),
  'An unpunctuated heading keeps a complete, consecutive numbered list together.');
const malformedNumberedHeadingList = [
  'input tax requirements',
  '1. The purchase must support a genuine business activity.',
  '3. You must hold the required invoice or import permit.'
].join('\n\n');
const malformedNumberedHeadingPage = malformedNumberedHeadingList + '\n\n' +
  Array.from({ length: 12 }, (_, index) => `Background registration note ${index} contains unrelated information.`).join('\n\n');
const selectedMalformedNumberedHeadingList = selectRelevantFetchedText(
  malformedNumberedHeadingPage, ['invoice or import permit'], 500, 'input tax invoice or import permit'
);
assert.doesNotMatch(selectedMalformedNumberedHeadingList, /The purchase must support|You must hold/,
  'An unpunctuated heading does not make an incomplete numbered list safe to select.');
const periodEndedNumberedList = completeNumberedHeadingList.replace(
  'input tax requirements', 'The following conditions must all be satisfied.'
);
const periodEndedNumberedPage = periodEndedNumberedList + '\n\n' +
  Array.from({ length: 12 }, (_, index) => `Background registration note ${index} contains unrelated information.`).join('\n\n');
assert.ok(selectRelevantFetchedText(
  periodEndedNumberedPage, ['invoice or import permit'], 500, 'input tax invoice or import permit'
).includes(periodEndedNumberedList),
  'A period-ended introduction retains a complete ordered list.');
const periodEndedMalformedNumberedList = malformedNumberedHeadingList.replace(
  'input tax requirements', 'The following conditions must all be satisfied.'
);
const periodEndedMalformedNumberedPage = periodEndedMalformedNumberedList + '\n\n' +
  Array.from({ length: 12 }, (_, index) => `Background registration note ${index} contains unrelated information.`).join('\n\n');
assert.doesNotMatch(selectRelevantFetchedText(
  periodEndedMalformedNumberedPage, ['invoice or import permit'], 500, 'input tax invoice or import permit'
), /The purchase must support|You must hold/,
  'A period-ended introduction does not make a gapped ordered list complete.');
const listMarkerRoot = splitEvidenceTextBlocks([
  '• Parent requirement without punctuation',
  '• First nested condition',
  '• Second nested condition'
].join('\n\n'));
assert.equal(completeVisibleEvidenceListSpan(listMarkerRoot, 0)?.itemCount, 3,
  'A marker-rooted list is kept whole without treating its first item as an introduction.');
const scaffoldedListBlocks = splitEvidenceTextBlocks([
  'Applicants must meet all these requirements.',
  '•',
  '• The applicant must satisfy the first condition.',
  '• The applicant must hold the required invoice.',
  'Unless the statutory exception applies.'
].join('\n\n'));
const scaffoldedCompleteList = completeVisibleEvidenceListSpan(scaffoldedListBlocks, 2);
assert.ok(scaffoldedCompleteList?.contextQuote?.includes('Applicants must meet all these requirements.'),
  'List marker-only extraction scaffolding does not discard the actual preceding introduction.');
const scaffoldedListRecord = verifiedLocalRecord({
  id: 'IRAS_SCAFFOLDED_LIST_CONTEXT',
  url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax'
}, scaffoldedListBlocks.join('\n\n'));
assert.equal(verifyEvidenceClaims([{
  kind: 'RULE', text: scaffoldedCompleteList.contextQuote, quote: scaffoldedCompleteList.contextQuote,
  recordId: scaffoldedListRecord.id
}], [scaffoldedListRecord], { missingFacts: [], expectedAuthority: 'IRAS', expectedDomain: 'IRAS' }).accepted.length, 1,
'Literal verification agrees with the shared boundary after omitting marker-only scaffolding.');
assert.equal(verifyEvidenceClaims([{
  kind: 'RULE', text: scaffoldedCompleteList.quote, quote: scaffoldedCompleteList.quote,
  recordId: scaffoldedListRecord.id
}], [scaffoldedListRecord], { missingFacts: [], expectedAuthority: 'IRAS', expectedDomain: 'IRAS' }).accepted.length, 0,
'The marker-rooted list cannot verify while omitting its source introduction.');
const colonItemIntroducedNestedList = [
  '• For invoices:',
  '◦ You hold the required invoice or import permit.',
  '◦ You retain the supporting records.'
].join('\n\n');
const colonItemIntroducedNestedPage = colonItemIntroducedNestedList + '\n\n' +
  Array.from({ length: 12 }, (_, index) => `Background registration note ${index} contains unrelated information.`).join('\n\n');
assert.ok(selectRelevantFetchedText(
  colonItemIntroducedNestedPage, ['required invoice'], 500, 'required invoice'
).includes(colonItemIntroducedNestedList),
  'A colon-ended list item still introduces and preserves its complete nested list.');
const oversizedColonItemIntroducedList = [
  '• For invoices:',
  '◦ You hold ' + 'the required invoice and supporting details '.repeat(24) + '.',
  '◦ You retain the supporting records.'
].join('\n\n');
const oversizedColonItemIntroducedPage = oversizedColonItemIntroducedList + '\n\n' +
  Array.from({ length: 12 }, (_, index) => `Background registration note ${index} contains unrelated information.`).join('\n\n');
assert.doesNotMatch(selectRelevantFetchedText(
  oversizedColonItemIntroducedPage, ['required invoice'], 220, 'required invoice'
), /For invoices:|You hold|supporting records/,
  'An oversized nested list introduced by a colon-ended list item is withheld as a whole.');

const nestedInputTaxBlocks = [
  'input tax requirements',
  '• The business must satisfy ' + 'outer premise '.repeat(35) + '.',
  '• For invoices:',
  '◦ You hold the required invoice.',
  '◦ You retain supporting documentation.',
  '• The goods must support taxable supplies.',
  'Unless a separate statutory restriction applies.'
];
const nestedInputTaxList = nestedInputTaxBlocks.join('\n\n');
const nestedInputTaxPage = nestedInputTaxList + '\n\n' +
  Array.from({ length: 100 }, () => 'Unrelated filing detail.').join('\n\n');
const nestedInputTaxTerms = ['required invoice'];
const nestedOverBudget = selectRelevantFetchedText(
  nestedInputTaxPage, nestedInputTaxTerms, 220, 'required invoice'
);
assert.doesNotMatch(nestedOverBudget,
  /For invoices:|You hold the required invoice|supporting documentation|goods must support taxable supplies|Unless a separate statutory restriction applies/,
  'When an enclosing lowercase-heading list is over budget, nested invoice fragments, later conditions and the attached qualification are withheld too.');
const periodEndedNestedInputTaxBlocks = [...nestedInputTaxBlocks];
periodEndedNestedInputTaxBlocks[0] = 'The following conditions must all be satisfied.';
const periodEndedNestedInputTaxList = periodEndedNestedInputTaxBlocks.join('\n\n');
const periodEndedNestedInputTaxPage = periodEndedNestedInputTaxList + '\n\n' +
  Array.from({ length: 100 }, () => 'Unrelated filing detail.').join('\n\n');
const periodEndedNestedOverBudget = selectRelevantFetchedText(
  periodEndedNestedInputTaxPage, nestedInputTaxTerms, 220, 'required invoice'
);
assert.doesNotMatch(periodEndedNestedOverBudget,
  /For invoices:|You hold the required invoice|supporting documentation|goods must support taxable supplies|Unless a separate statutory restriction applies/,
  'An over-budget list after a period-ended introduction is withheld with its qualification.');
const periodEndedPartialPreferred = selectRelevantFetchedText(
  periodEndedNestedInputTaxPage, nestedInputTaxTerms, 220, 'required invoice',
  [periodEndedNestedInputTaxBlocks[0]]
);
assert.doesNotMatch(periodEndedPartialPreferred,
  /The following conditions|For invoices:|You hold the required invoice|Unless a separate statutory restriction applies/,
  'A preferred introduction cannot split an over-budget period-ended list.');

const nestedInnerPreferred = nestedInputTaxBlocks.slice(2).join('\n\n');
const nestedUnderBudget = selectRelevantFetchedText(
  nestedInputTaxPage, nestedInputTaxTerms, 1_200, 'required invoice', [nestedInnerPreferred]
);
assert.ok(nestedUnderBudget.includes(nestedInputTaxList),
  'A nested preferred passage cannot split the enclosing lowercase-heading list or detach its qualification.');

const preferredPartialList = completeInputTaxConditions.split('\n\n').slice(0, 2).join('\n\n');
const selectedWithPartialPreferred = selectRelevantFetchedText(
  longInputTaxPage,
  ['input tax claim', 'tax invoice', 'invoice or import permit'],
  300,
  'conditions for claiming input tax tax invoice import permit',
  [preferredPartialList]
);
assert.doesNotMatch(selectedWithPartialPreferred, /• The purchase|• This category|• You hold/,
  'When the complete list does not fit, none of its items leaks into the selected excerpt.');
const lowerCasePartialPreferredList = lowerCaseInputTaxConditions.split('\n\n').slice(0, 2).join('\n\n');
const selectedWithLowerCasePartialPreferred = selectRelevantFetchedText(
  lowerCaseInputTaxPage,
  ['input tax claim', 'invoice or import permit'],
  300,
  'input tax claim invoice or import permit',
  [lowerCasePartialPreferredList]
);
assert.doesNotMatch(selectedWithLowerCasePartialPreferred, /• The purchase|• This category|• You hold/,
  'A lowercase heading remains independently usable while its over-budget condition list is withheld.');

const inputTaxQuery = 'What are the general Singapore GST rules for claiming input tax on business purchases by a GST-registered company?';
const noLocalInputTaxEvidence = {
  retrieveSources: async () => [],
  getSourceById: id => defaultSourceRetriever.getSourceById(id),
  findSourcesByStandardOrAct: (...args) => defaultSourceRetriever.findSourcesByStandardOrAct(...args)
};
for (const heading of [
  'Input tax requirements', 'input tax requirements', 'The following conditions must all be satisfied.',
  'Conditions for claiming input tax are:',
  'Applicants must meet all these requirements.',
  'Applicants must satisfy the conditions below.',
  'Eligibility requires satisfying all conditions described here.'
]) {
  const conditionHtml = '<html><head><title>Conditions for Claiming Input Tax</title></head><body><main>' +
    '<h1>Conditions for Claiming Input Tax</h1>' +
    '<p>When purchasing from GST-registered suppliers or importing goods into Singapore, a business may incur input tax.</p>' +
    (heading === 'Input tax requirements'
      ? `<p>${independentGstRateParagraph}</p><ul><li>${unrelatedGlossaryBullet.slice(2)} ${'Unrelated definition text. '.repeat(220)}</li></ul>`
      : '') +
    `<p>${heading}</p><ul>` +
    '<li>The purchase is made for a real business purpose and supports the input tax claim.</li>' +
    '<li>This category is expressly barred by the applicable statutory schedule. ' + 'Detailed supporting context '.repeat(1_700) + 'This exclusion applies to the complete class of affected supplies.</li>' +
    '<li>You hold the required invoice or import permit for the goods and services claimed.</li></ul>' +
    '<p>Unless a separate statutory restriction applies.</p>' +
    '<p>Tax invoice information is relevant to input tax claims for business purchases.</p></main></body></html>';
  const productionContext = await buildGroundedReasoningContext(
    inputTaxQuery,
    null,
    noLocalInputTaxEvidence,
    undefined,
    {
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      discoveryAdapter: { discoverOfficialSourceCandidates: async () => [] },
      fetchOptions: {
        useCache: false,
        customFetch: async url => {
          assert.match(String(url), /conditions-for-claiming-input-tax/,
            'The mocked production retrieval requests the registered IRAS input-tax source URL.');
          return new Response(conditionHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
        }
      }
    }
  );
  assert.equal(productionContext.evidenceQuality.status, 'RETRIEVED_SUFFICIENT',
    'Mocked registered-source retrieval reaches the production evidence-quality admission gate.');
  const retrievedInputTaxRecord = productionContext.evidenceQuality.eligibleRecords.find(record =>
    record.provenance === 'LIVE_EXTERNAL' && record.officialSourceUrl?.includes('conditions-for-claiming-input-tax'));
  assert.ok(retrievedInputTaxRecord, 'The mapped IRAS document is admitted through production retrieval.');
  if (heading === 'Input tax requirements') {
    assert.ok(retrievedInputTaxRecord.sourceText.includes(independentGstRateParagraph),
      'Production retrieval retains the independent GST-rate paragraph before an unrelated glossary bullet.');
  }
  assert.doesNotMatch(retrievedInputTaxRecord.sourceText, /• The purchase|• This category|• You hold/,
    'When the full conditions list exceeds the excerpt budget, production retrieval withholds the whole list.');
  assert.doesNotMatch(retrievedInputTaxRecord.sourceText, /Unless a separate statutory restriction applies/,
    'Production retrieval also withholds the qualification attached to the over-budget list.');
  const renderedInputTaxFallback = renderIrasEvidenceResponse({}, productionContext, inputTaxQuery,
    null, 'SFRS_I', 'PROVIDER_NO_CLAIMS');
  if (heading === 'Input tax requirements') {
    assert.ok(renderedInputTaxFallback.messageText.includes(independentGstRateParagraph),
      'The IRAS no-claim fallback retains the independently retrieved GST-rate paragraph.');
  }
  assert.doesNotMatch(renderedInputTaxFallback.messageText, /• The purchase|• This category|• You hold/,
    'IRAS no-claim fallback does not present a shortened retrieved list as complete official evidence.');
  assert.doesNotMatch(renderedInputTaxFallback.messageText, /Unless a separate statutory restriction applies/,
    'IRAS no-claim fallback does not detach an attached qualification from an omitted over-budget list.');
}

console.log('PASS: IRAS HTML block boundaries and strict evidence verification');
