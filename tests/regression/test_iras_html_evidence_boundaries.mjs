import assert from 'node:assert/strict';
import { cleanHtmlText } from '../../src/retrieval/sourceAdapters.ts';
import { selectRelevantFetchedText } from '../../src/services/groundingContextBuilder.ts';
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

console.log('PASS: IRAS HTML block boundaries and strict evidence verification');
