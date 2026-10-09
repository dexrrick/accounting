import assert from 'node:assert/strict';
import { loadIrasFirstV2TargetedCases } from '../../../../tests/evaluation/singapore/semantic-contract-followup-evaluation.mjs';
import { isExpectedIssue } from '../../../../tests/evaluation/singapore/multi-authority-issue-scoring.mjs';
const cases = await loadIrasFirstV2TargetedCases();
const examples = [
 ['foreign-dividend-receipt-treatment', 'Singapore corporate tax treatment of dividends received from an overseas subsidiary', false, 'equivalent wording'],
 ['foreign-dividend-receipt-treatment', 'corporate tax treatment of the receipt of domestic dividends', true, 'materially different domestic receipt'],
 ['foreign-dividend-receipt-treatment', 'company foreign interest income tax treatment', false, 'different income type'],
 ['gst-input-tax-general-rule', 'claiming input tax on business acquisitions by a GST registered company', false, 'equivalent wording'],
 ['gst-input-tax-general-rule', 'general GST output tax on sales by a registered company', false, 'different tax direction'],
 ['gst-input-tax-general-rule', 'general GST input tax recovery rules for business purchases by a GST registered company', true, 'literal control'],
];
for (const [id, subject, expectedObservedMatch, meaning] of examples) {
 const expected = cases.find(c=>c.id===id).expected[0];
 const matched = isExpectedIssue({subject}, expected);
 assert.equal(matched,expectedObservedMatch);
 console.log(JSON.stringify({id,subject,meaning,matched}));
}
console.log('Frozen matcher behavior reproduced; historical subjects absent, so no V3 rescore is possible.');
