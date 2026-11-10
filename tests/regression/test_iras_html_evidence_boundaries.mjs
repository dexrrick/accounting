import assert from 'node:assert/strict';
import { cleanHtmlText } from '../../src/retrieval/sourceAdapters.ts';
import { ExternalSourceValidator } from '../../src/retrieval/externalSourceValidator.ts';
import { buildGroundedReasoningContext, selectRelevantFetchedText } from '../../src/services/groundingContextBuilder.ts';
import { defaultSourceRetriever } from '../../src/retrieval/sourceRetriever.ts';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import { renderIrasEvidenceResponse } from '../../src/services/irasEvidencePolicy.ts';
import { verifyEvidenceClaims } from '../../src/verification/claimEvidenceVerifier.ts';

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

const completeInputTaxConditions = [
  'Conditions for claiming input tax are:',
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
  'Selection preserves the full multi-sentence condition and its attached qualification as one source unit.');

const nestedInputTaxBlocks = [
  'Conditions for claiming input tax are:',
  '• The business must satisfy ' + 'outer premise '.repeat(35) + '.',
  '• For invoices:',
  '◦ You hold the required invoice.',
  '◦ You retain supporting documentation.',
  '• The goods must support taxable supplies.'
];
const nestedInputTaxList = nestedInputTaxBlocks.join('\n\n');
const nestedInputTaxPage = nestedInputTaxList + '\n\n' +
  Array.from({ length: 100 }, () => 'Unrelated filing detail.').join('\n\n');
const nestedInputTaxTerms = ['required invoice'];
const nestedOverBudget = selectRelevantFetchedText(
  nestedInputTaxPage, nestedInputTaxTerms, 220, 'required invoice'
);
assert.doesNotMatch(nestedOverBudget,
  /For invoices:|You hold the required invoice|supporting documentation|goods must support taxable supplies/,
  'When an enclosing conditions list is over budget, nested invoice fragments and later parent items are withheld too.');

const nestedInnerPreferred = nestedInputTaxBlocks.slice(2).join('\n\n');
const nestedUnderBudget = selectRelevantFetchedText(
  nestedInputTaxPage, nestedInputTaxTerms, 1_200, 'required invoice', [nestedInnerPreferred]
);
assert.ok(nestedUnderBudget.includes(nestedInputTaxList),
  'A nested preferred passage cannot split the enclosing list; when it fits, the complete outer list is retained.');

const preferredPartialList = completeInputTaxConditions.split('\n\n').slice(0, 2).join('\n\n');
const selectedWithPartialPreferred = selectRelevantFetchedText(
  longInputTaxPage,
  ['input tax claim', 'tax invoice', 'invoice or import permit'],
  300,
  'conditions for claiming input tax tax invoice import permit',
  [preferredPartialList]
);
assert.doesNotMatch(selectedWithPartialPreferred, /Conditions for claiming input tax are:/,
  'A preferred passage cannot preserve a partial source list when the complete list exceeds the excerpt budget.');
assert.doesNotMatch(selectedWithPartialPreferred, /• The purchase|• This category|• You hold/,
  'When the complete list does not fit, none of its items leaks into the selected excerpt.');

const conditionHtml = '<html><head><title>Conditions for Claiming Input Tax</title></head><body><main>' +
  '<h1>Conditions for Claiming Input Tax</h1>' +
  '<p>When purchasing from GST-registered suppliers or importing goods into Singapore, a business may incur input tax.</p>' +
  '<p>Conditions for claiming input tax are:</p><ul>' +
  '<li>The purchase is made for a real business purpose and supports the input tax claim.</li>' +
  '<li>This category is expressly barred by the applicable statutory schedule. ' + 'Detailed supporting context '.repeat(1_700) + 'This exclusion applies to the complete class of affected supplies.</li>' +
  '<li>You hold the required invoice or import permit for the goods and services claimed.</li></ul>' +
  '<p>Tax invoice information is relevant to input tax claims for business purchases.</p></main></body></html>';
const inputTaxQuery = 'What are the general Singapore GST rules for claiming input tax on business purchases by a GST-registered company?';
const noLocalInputTaxEvidence = {
  retrieveSources: async () => [],
  getSourceById: id => defaultSourceRetriever.getSourceById(id),
  findSourcesByStandardOrAct: (...args) => defaultSourceRetriever.findSourcesByStandardOrAct(...args)
};
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
assert.doesNotMatch(retrievedInputTaxRecord.sourceText, /• The purchase|• This category|• You hold/,
  'When the full conditions list exceeds the excerpt budget, production retrieval withholds the whole list.');
const renderedInputTaxFallback = renderIrasEvidenceResponse({}, productionContext, inputTaxQuery,
  null, 'SFRS_I', 'PROVIDER_NO_CLAIMS');
assert.doesNotMatch(renderedInputTaxFallback.messageText, /• The purchase|• This category|• You hold/,
  'IRAS no-claim fallback does not present a shortened retrieved list as complete official evidence.');

console.log('PASS: IRAS HTML block boundaries and strict evidence verification');
