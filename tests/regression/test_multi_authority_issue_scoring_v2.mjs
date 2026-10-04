import assert from 'node:assert/strict';
import { isExpectedIssue as isLegacyExpectedIssue } from '../evaluation/singapore/multi-authority-issue-scoring.mjs';
import {
  isExpectedIssueV2,
  matchIssuesV2,
  scoreIssueDimensionsV2
} from '../evaluation/singapore/multi-authority-issue-scoring-v2.mjs';

const foreignDividend = {
  id: 'any-id-is-ignored',
  subject: 'corporate income-tax treatment of foreign dividend received by company',
  matchAny: [['company', 'foreign', 'dividend', 'tax'], ['corporate', 'dividend', 'receipt']],
  domain: ['IRAS_INCOME_TAX'], population: ['COMPANY'], governingAuthorities: ['IRAS'],
  contextualAuthoritiesAnyOf: [[]], operation: ['DETERMINE_TREATMENT']
};
const gstInputRecovery = {
  subject: 'general GST input-tax recovery rules for business purchases by a GST-registered company',
  matchAny: [['gst', 'input', 'tax', 'business', 'purchases']],
  domain: ['IRAS_GST'], population: ['COMPANY'], governingAuthorities: ['IRAS'],
  contextualAuthoritiesAnyOf: [[]], operation: ['EXPLAIN_RULE']
};

for (const subject of [
  'corporate tax treatment of overseas dividend received by company',
  'Singapore company receives a foreign dividend from its overseas subsidiary for corporate tax treatment',
  'foreign subsidiary pays a dividend to a Singapore company; corporate tax treatment',
  'corporate tax treatment of a foreign dividend receipt by a company',
  'company receives an overseas dividend that is subject to tax',
  'Singapore corporate tax treatment of dividends received from an overseas subsidiary',
  'corporate tax treatment of company dividends received from a foreign subsidiary'
]) {
  assert.equal(isExpectedIssueV2({ subject }, foreignDividend), true, subject);
}
for (const subject of [
  'corporate tax treatment of domestic dividend received by company',
  'company receives a dividend from its local subsidiary',
  'company pays a foreign dividend to its overseas subsidiary',
  'corporate tax treatment of foreign interest received by company',
  'company receives a foreign dividend',
  'corporate tax treatment of foreign dividend exemption eligibility for company',
  'company does not receive foreign dividends',
  'domestic and foreign dividend receipts by company',
  'foreign dividend receipt and company tax residency',
  'corporate tax residency requirement for foreign dividend receipt by company',
  'accounting journal treatment of foreign dividend receipt by company',
  'corporate tax treatment of a Thai subsidiary dividend received by company'
]) {
  assert.equal(isExpectedIssueV2({ subject }, foreignDividend), false, subject);
}
assert.equal(isExpectedIssueV2({ subject: 'company receives a foreign dividend' }, foreignDividend), false,
  'A receipt fact without explicit tax context does not match the tax-treatment scope.');

for (const subject of [
  'GST input tax recovery for business purchases by a registered company',
  'claiming GST input tax on business acquisitions by a GST-registered company',
  'business entity recovery of GST input tax on purchases by a GST-registered business',
  'general Singapore GST input tax recovery rules for business purchases by a GST-registered company'
]) {
  assert.equal(isExpectedIssueV2({ subject }, gstInputRecovery), true, subject);
}
for (const subject of [
  'GST output tax recovery on business purchases by a registered company',
  'GST input and output tax recovery on business purchases by a registered company',
  'GST input tax recovery eligibility for business purchases by a company',
  'GST input tax exemption for business acquisitions by a company',
  'GST input tax recovery for private purchases by a GST-registered company',
  'GST input tax recovery for business purchases by an unregistered company',
  'GST input tax recovery for business purchases by a company not registered for GST',
  'company cannot recover GST input tax on business purchases',
  'GST input tax is nonrecoverable on business purchases by a company',
  'GST input tax recovery on business purchases and foreign dividend treatment',
  'GST input tax recovery on business interest payments',
  'GST input tax recovery for business purchases with company tax residency issues',
  'general Singapore GST input tax recovery rules for business purchases by a GST-registered company in Malaysia'
]) {
  assert.equal(isExpectedIssueV2({ subject }, gstInputRecovery), false, subject);
}

const domesticActual = { subject: 'corporate tax treatment of domestic dividend receipt by company' };
assert.equal(isLegacyExpectedIssue(domesticActual, foreignDividend), true,
  'The legacy anchor matcher demonstrates why specialized V2 rejection must be terminal.');
assert.equal(isExpectedIssueV2(domesticActual, foreignDividend), false);
const interestActual = { subject: 'corporate tax treatment of foreign interest received by company' };
const looseLegacyAnchors = { ...foreignDividend, matchAny: [['company', 'foreign', 'tax']] };
assert.equal(isLegacyExpectedIssue(interestActual, looseLegacyAnchors), true,
  'A shared company/foreign/tax anchor is insufficient for a dividend scope.');
assert.equal(isExpectedIssueV2(interestActual, looseLegacyAnchors), false,
  'A specialized rejection is terminal even when a permissive anchor would match.');
const looseGstExpected = { ...gstInputRecovery, matchAny: [['gst', 'input', 'tax']] };
const narrowGstActual = { subject: 'GST input tax recovery eligibility for business purchases by a company' };
assert.equal(isLegacyExpectedIssue(narrowGstActual, looseGstExpected), true,
  'A loose GST anchor would ignore an eligibility-specific narrowed subject.');
assert.equal(isExpectedIssueV2(narrowGstActual, looseGstExpected), false,
  'The GST specialized rejection is also terminal.');
const unrelatedForeign = {
  subject: 'football prediction plus corporate tax treatment of foreign dividend receipt by company'
};
assert.equal(isLegacyExpectedIssue(unrelatedForeign, foreignDividend), true,
  'A permissive legacy anchor sees the expected foreign-dividend terms inside unrelated material.');
assert.equal(isExpectedIssueV2(unrelatedForeign, foreignDividend), false,
  'The bounded foreign-dividend vocabulary rejects an unrelated appended subject.');
const unrelatedGst = {
  subject: 'audit scheduling plus GST input tax recovery for business purchases by a registered company'
};
assert.equal(isLegacyExpectedIssue(unrelatedGst, gstInputRecovery), true,
  'A permissive legacy anchor sees the expected GST terms inside unrelated material.');
assert.equal(isExpectedIssueV2(unrelatedGst, gstInputRecovery), false,
  'The bounded GST vocabulary rejects an unrelated appended subject.');

const expectedRejectAny = { ...foreignDividend, rejectAny: ['overseas'] };
assert.equal(isExpectedIssueV2({ subject: 'corporate tax treatment of overseas dividend received by company' }, expectedRejectAny), false,
  'Specialized matching honors the same expected.rejectAny veto as the legacy predicate.');
const foreignExemptionExpected = {
  ...foreignDividend,
  subject: 'corporate tax treatment of foreign dividend exemption eligibility for company'
};
assert.equal(isExpectedIssueV2({ subject: foreignExemptionExpected.subject }, foreignExemptionExpected), true,
  'A narrowed expected exemption scope is not dispatched to the general receipt matcher.');
const gstEligibilityExpected = {
  ...gstInputRecovery,
  subject: 'GST input tax recovery eligibility for business purchases by a GST-registered company'
};
assert.equal(isExpectedIssueV2({ subject: gstEligibilityExpected.subject }, gstEligibilityExpected), true,
  'A narrowed expected eligibility scope is not dispatched to the general recovery matcher.');

const wrongDimensions = {
  subject: 'corporate tax treatment of overseas dividend received by company',
  domain: 'ACCOUNTING', population: 'UNKNOWN', governingAuthorities: ['ACCOUNTING_STANDARDS'],
  contextualAuthorities: ['IRAS'], operation: 'EXPLAIN_RULE'
};
assert.equal(isExpectedIssueV2(wrongDimensions, foreignDividend), true,
  'V2 subject matching does not depend on authority, domain, population or operation.');
assert.deepEqual(scoreIssueDimensionsV2(wrongDimensions, foreignDividend), {
  governingAuthority: false, contextualAuthority: false, domain: false, population: false, operation: false
});
const rightDimensionsExceptDomain = { ...wrongDimensions, governingAuthorities: ['IRAS'], contextualAuthorities: [],
  population: 'COMPANY', operation: 'DETERMINE_TREATMENT' };
assert.deepEqual(scoreIssueDimensionsV2(rightDimensionsExceptDomain, foreignDividend), {
  governingAuthority: true, contextualAuthority: true, domain: false, population: true, operation: true
}, 'Dimension mismatches remain independently visible.');

const oneActual = { subject: 'corporate tax treatment of overseas dividend received by company' };
const duplicateExpected = matchIssuesV2([foreignDividend, { ...foreignDividend, id: 'duplicate-scope' }], [oneActual]);
assert.equal(duplicateExpected.expectedByActual.size, 1,
  'Maximum one-to-one matching prevents one issue receiving duplicate expected credits.');
const mergedIssue = {
  subject: 'corporate tax treatment of foreign dividend receipt and GST input tax recovery for business purchases by company'
};
assert.equal(matchIssuesV2([foreignDividend, gstInputRecovery], [mergedIssue]).expectedByActual.size, 0,
  'One merged subject cannot receive credit for unrelated foreign-dividend and GST scopes.');

const ordinaryExpected = { subject: 'expense accounting', matchAny: [['expense', 'accounting']] };
assert.equal(isExpectedIssueV2({ subject: 'accounting for an expense' }, ordinaryExpected), true,
  'Non-specialized contracts preserve the legacy subject-matching behavior.');

process.stdout.write('Prospective multi-authority issue-scoring V2 regressions passed.\n');
