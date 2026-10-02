import assert from 'node:assert/strict';
import {
  irasSourceStructureFeatureIdsV6,
  projectIrasSourceStructureFeaturesV6
} from '../evaluation/singapore/iras-source-structure-features-v6.mjs';

const structuralText = [
  'Expenses which are not deductible:\n• Domestic or private expenses are disallowed under the general rule.',
  'Taxability of foreign income:\nForeign-sourced income, including dividends, may be taxable when received in Singapore.',
  'Tax exemption:\nAn exemption may apply when the relevant conditions are met.',
  'Withholding tax on royalties to non-residents:\n| Nature of payment | Applicable rate |\n| Royalties paid to non-residents | Subject to withholding tax |',
  'Conditions for claiming input tax:\n• A GST-registered business may make an input tax claim for business purchases used to make taxable supplies when it holds a tax invoice.',
  'Blocked input tax exceptions:\n• Some input tax is not claimable.'
].join('\n\n');

const projection = projectIrasSourceStructureFeaturesV6(structuralText, 'SELECTED_CLAIM_QUOTE');
assert.equal(projection.schema, 'IRAS_SOURCE_STRUCTURE_FEATURES_V6');
assert.equal(projection.interpretation, 'PRESENCE_ONLY_NOT_ENTAILMENT');
assert.equal(projection.stage, 'SELECTED_CLAIM_QUOTE');
assert.equal(projection.sourceTextProvided, true);
assert.equal(projection.sourceTextTruncated, false);
assert.ok(projection.signalCounts.private_personal_expense_noun > 0);
assert.ok(projection.signalCounts.expense_disallowance_predicate > 0);
assert.ok(projection.signalCounts.disallowed_expense_heading > 0);
assert.ok(projection.signalCounts.foreign_income > 0);
assert.ok(projection.signalCounts.dividend > 0);
assert.ok(projection.signalCounts.singapore_receipt > 0);
assert.ok(projection.signalCounts.taxability_heading > 0);
assert.ok(projection.signalCounts.exemption_heading > 0);
assert.ok(projection.signalCounts.withholding_tax > 0);
assert.ok(projection.signalCounts.royalty > 0);
assert.ok(projection.signalCounts.non_resident > 0);
assert.ok(projection.signalCounts.subject_to > 0);
assert.ok(projection.signalCounts.withhold_verb > 0);
assert.ok(projection.signalCounts.wht_rate_table_shape > 0);
assert.ok(projection.signalCounts.gst_input_tax > 0);
assert.ok(projection.signalCounts.gst_claim_or_recover_verb > 0);
assert.ok(projection.signalCounts.gst_make_claim_verb > 0);
assert.ok(projection.signalCounts.gst_conditions_heading > 0);
assert.ok(projection.signalCounts.requirement_modal > 0);
assert.ok(projection.signalCounts.business_use > 0);
assert.ok(projection.signalCounts.taxable_supplies > 0);
assert.ok(projection.signalCounts.tax_invoice > 0);
assert.ok(projection.signalCounts.blocked_input_tax > 0);
assert.ok(projection.signalCounts.exception > 0);
assert.ok(projection.signalCounts.negation_present > 0);
assert.ok(projection.signalBlocks.some(block => block.shape === 'COLON_HEADING'));
assert.ok(projection.signalBlocks.some(block => block.shape === 'MARKED_LIST_ITEM'));
assert.ok(projection.signalBlocks.some(block => block.shape === 'PIPE_TABLE_ROW'));

const negated = projectIrasSourceStructureFeaturesV6('Input tax was not claimed for this purchase.', 'SYNTHETIC_TEST');
const negatedBlock = negated.signalBlocks[0];
assert.equal(negatedBlock.signals.gst_input_tax, true);
assert.equal(negatedBlock.signals.gst_claim_or_recover_verb, true);
assert.equal(negatedBlock.signals.negation_present, true,
  'Negation is reported as a separate presence flag and is not classified as support.');
assert.equal('supported' in negatedBlock.signals, false);
assert.equal('verified' in negatedBlock.signals, false);
const standardForms = projectIrasSourceStructureFeaturesV6('Foreign income was received in Singapore. Tax was withheld from royalties remitted to Singapore.');
assert.ok(standardForms.signalCounts.singapore_receipt > 0,
  'Common received in Singapore and remitted to Singapore forms are reported as presence.');
assert.ok(standardForms.signalCounts.withhold_verb > 0,
  'The past-tense withheld form is reported as presence.');

const manyBlocks = Array.from({ length: 40 }, (_, index) =>
  `Private expense ${index} is not deductible under this synthetic rule.`).join('\n\n');
const bounded = projectIrasSourceStructureFeaturesV6(manyBlocks, 'DIRECT_PROBE_SOURCE_TEXT');
assert.equal(bounded.signalBearingBlockCount, 40);
assert.equal(bounded.reportedBlockCount, 32);
assert.equal(bounded.signalBlocks.length, 32);
assert.equal(bounded.reportedBlocksTruncated, true);
assert.equal(bounded.signalCounts.private_personal_expense_noun, 40);
assert.ok(bounded.signalBlocks.every(block => Number.isInteger(block.blockIndex) && block.blockIndex >= 0 && block.blockIndex < 40));

const overlong = projectIrasSourceStructureFeaturesV6('Personal expense is not deductible. '.repeat(8_000));
assert.equal(overlong.sourceTextTruncated, true);
assert.equal(overlong.scanTruncated, true);
assert.ok(overlong.scannedBlockCount <= 10_000);
assert.ok(Object.values(overlong.signalCounts).every(count => Number.isInteger(count) && count >= 0 && count <= 10_000));

const canary = 'CANARY_NEVER_EMIT_9f3e6c';
const sensitiveProbe = projectIrasSourceStructureFeaturesV6(
  `Should ${canary} qualify? https://www.iras.gov.sg/private-link foreign-sourced dividends received in Singapore.`,
  'RENDER_CONTEXT_SOURCE_TEXT'
);
const safeJson = JSON.stringify(sensitiveProbe);
assert.equal(safeJson.includes(canary), false);
assert.equal(safeJson.includes('Should'), false);
assert.equal(safeJson.includes('https://'), false);
assert.deepEqual(Object.keys(sensitiveProbe), [
  'schema', 'interpretation', 'stage', 'sourceTextProvided', 'sourceTextTruncated', 'scanTruncated',
  'scannedBlockCount', 'signalBearingBlockCount', 'reportedBlockCount', 'reportedBlocksTruncated',
  'signalCounts', 'signalBlocks'
]);
assert.deepEqual(Object.keys(sensitiveProbe.signalCounts), [...irasSourceStructureFeatureIdsV6]);
for (const block of sensitiveProbe.signalBlocks) {
  assert.deepEqual(Object.keys(block), ['blockIndex', 'shape', 'signals']);
  assert.deepEqual(Object.keys(block.signals), [...irasSourceStructureFeatureIdsV6]);
  assert.ok(Object.values(block.signals).every(value => typeof value === 'boolean'));
}

console.log('IRAS source structure feature projector V6 safety regression passed.');
