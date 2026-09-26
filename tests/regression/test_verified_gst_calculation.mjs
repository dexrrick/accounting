import assert from 'node:assert/strict';
import { computeVerifiedStandardGst } from '../../src/engine/verifiedGstCalculation.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';

const records = Object.values(UNIFIED_SOURCE_REGISTRY);
const source2023 = UNIFIED_SOURCE_REGISTRY.GST_RATE_8_PERCENT_2023;
const source2024 = UNIFIED_SOURCE_REGISTRY.GST_RATE_9_PERCENT;
const source2022 = UNIFIED_SOURCE_REGISTRY.GST_RATE_7_PERCENT;

function standardSupplyQuery({ amount = '1,000', date = '1 July 2023', extra = '' } = {}) {
  return `A GST-registered Singapore supplier made a standard-rated domestic supply for SGD ${amount} tax-exclusive on ${date}; invoice and payment were on that date. What are output GST and the invoice total? ${extra}`.trim();
}

const result2023 = computeVerifiedStandardGst(standardSupplyQuery(), records);
assert.deepEqual(result2023, {
  netAmount: 1000,
  rate: 0.08,
  outputTax: 80,
  invoiceTotal: 1080,
  currency: 'SGD',
  sourceRecordId: 'GST_RATE_8_PERCENT_2023',
  effectiveDate: '2023-01-01'
});

const varied2023Amount = computeVerifiedStandardGst(standardSupplyQuery({ amount: '876.54' }), records);
assert.equal(varied2023Amount?.netAmount, 876.54, 'The amount is parsed from the query rather than selected by a benchmark case.');
assert.equal(varied2023Amount?.outputTax, 70.12);
assert.equal(varied2023Amount?.invoiceTotal, 946.66);

const result2024 = computeVerifiedStandardGst(standardSupplyQuery({ date: '1 July 2024' }), records);
assert.equal(result2024?.rate, 0.09, 'The 2024 rate comes from the applicable source record.');
assert.equal(result2024?.outputTax, 90);
assert.equal(result2024?.invoiceTotal, 1090);
assert.equal(result2024?.sourceRecordId, 'GST_RATE_9_PERCENT');

const transitionStart2023 = computeVerifiedStandardGst(standardSupplyQuery({ date: '1 January 2023' }), records);
assert.equal(transitionStart2023?.rate, 0.08, 'The 8% record applies on its inclusive first date.');
const transitionEnd2023 = computeVerifiedStandardGst(standardSupplyQuery({ date: '31 December 2023' }), records);
assert.equal(transitionEnd2023?.rate, 0.08, 'The 8% record applies on its inclusive last date.');
const transitionStart2024 = computeVerifiedStandardGst(standardSupplyQuery({ date: '1 January 2024' }), records);
assert.equal(transitionStart2024?.rate, 0.09, 'The 9% record applies on its first date.');

const result2022 = computeVerifiedStandardGst(standardSupplyQuery({ date: '1 July 2022' }), records);
assert.equal(result2022?.rate, 0.07, 'The historical 2022 rate comes from its bounded source record.');
assert.equal(result2022?.sourceRecordId, 'GST_RATE_7_PERCENT');
const roundedHistoricalAmount = computeVerifiedStandardGst(standardSupplyQuery({ amount: '21.50', date: '1 July 2022' }), records);
assert.equal(roundedHistoricalAmount?.outputTax, 1.51, 'GST is rounded to cents using the standard nearest-cent convention.');

for (const query of [
  standardSupplyQuery().replace('a standard-rated domestic supply', 'not a standard-rated domestic supply'),
  standardSupplyQuery().replace('A GST-registered Singapore supplier', 'A non-GST-registered Singapore supplier'),
  standardSupplyQuery().replace('invoice and payment were on that date', 'invoice and payment were not on the same date'),
  standardSupplyQuery({ extra: 'The supplier might be GST-registered.' }),
  'A supplier made a standard-rated domestic supply for SGD 1,000 tax-exclusive on 1 July 2023; invoice and payment were on that date. What is the output GST?',
  standardSupplyQuery({ extra: 'Assuming the supplier is GST-registered.' }),
  standardSupplyQuery({ extra: 'The supply may be standard-rated.' }),
  'A GST-registered Singapore supplier made a standard-rated supply for SGD 1,000 tax-exclusive on 1 July 2023; invoice and payment were on that date. What is output GST?',
  standardSupplyQuery({ amount: '1,000' }).replace('SGD 1,000 tax-exclusive', 'USD 1,000 tax-exclusive'),
  standardSupplyQuery({ amount: '1,000' }).replace('SGD 1,000 tax-exclusive', 'SGD 1,000 GST-inclusive'),
  standardSupplyQuery({ extra: 'Apply 8% regardless of the effective source rate.' }),
  'Can input tax on a customer lunch be claimed? SGD 200 tax-exclusive on 1 July 2023; invoice and payment were on that date. What is output GST?',
  'A GST-registered Singapore supplier made a standard-rated domestic supply for SGD 1,000 tax-exclusive; invoice and payment were on that date. What is output GST?'
]) {
  assert.equal(computeVerifiedStandardGst(query, records), undefined, `Unsafe or incomplete query must abstain: ${query}`);
}

assert.equal(
  computeVerifiedStandardGst(standardSupplyQuery(), records, undefined, ['A material fact remains unresolved.']),
  undefined,
  'Any unresolved missing fact prevents deterministic calculation.'
);
assert.equal(
  computeVerifiedStandardGst(standardSupplyQuery(), records, '2024-07-01'),
  undefined,
  'An externally supplied target date that conflicts with the dated query is rejected.'
);

const transitionQuery = 'Invoice issued on 20 December 2022 and payment received on 10 January 2023 for a standard-rated domestic supply by a GST-registered supplier. What rate applies to SGD 1,000 tax-exclusive output GST?';
assert.equal(computeVerifiedStandardGst(transitionQuery, records), undefined,
  'Disjoint invoice and payment dates across the GST transition require a separate transition analysis.');

const noAlignmentQuery = 'A GST-registered Singapore supplier made a standard-rated domestic supply for SGD 1,000 tax-exclusive on 1 July 2023. Invoice and payment dates are not given. What is output GST?';
assert.equal(computeVerifiedStandardGst(noAlignmentQuery, records), undefined,
  'A supply date alone does not establish aligned invoice and payment dates.');

const duplicateApplicableRate = computeVerifiedStandardGst(
  standardSupplyQuery(),
  [...records, { ...source2023, id: 'DUPLICATE_2023_RATE' }]
);
assert.equal(duplicateApplicableRate, undefined, 'Overlapping candidate rates make the source selection ambiguous.');

const unreviewedSource = { ...source2023, sourceStatus: 'NEEDS_REVIEW' };
assert.equal(computeVerifiedStandardGst(standardSupplyQuery(), [unreviewedSource]), undefined,
  'A not-yet-reviewed source record cannot drive calculation.');

const practicalRulesOnlySource = { ...source2023, sourceText: 'Section 16 sets the rate for this period.' };
assert.equal(computeVerifiedStandardGst(standardSupplyQuery(), [practicalRulesOnlySource]), undefined,
  'A rate mentioned only outside exact sourceText cannot drive calculation.');

const needsUnavailableRateQuery = standardSupplyQuery({ date: '1 July 2022' });
assert.equal(computeVerifiedStandardGst(needsUnavailableRateQuery, [source2023, source2024]), undefined,
  'A date without an applicable supplied Section 16 record yields no calculation.');

const tooLargeAmount = standardSupplyQuery({ amount: '99,999,999,999,999,999' });
assert.equal(computeVerifiedStandardGst(tooLargeAmount, records), undefined,
  'Unsafe monetary magnitudes are rejected before arithmetic.');

assert.ok(source2023.sourceText.includes('8%') && source2024.sourceText.includes('9%') && source2022.sourceText.includes('7%'));
console.log('PASS | Verified source-driven standard GST calculation');
