import assert from 'node:assert/strict';
import { completeIrasCpfCashTopUpLimitQuotes, completeIrasGstMotorCarConnectedPersonExceptionQuote,
  verifyEvidenceClaims } from '../../src/verification/claimEvidenceVerifier.ts';
import { UNIFIED_SOURCE_REGISTRY, buildUnifiedSourceRegistry } from '../../src/standards/unifiedSourceModel.ts';
import { SINGAPORE_STATUTORY_REPOSITORY } from '../../src/standards/singaporeStatutesKnowledge.ts';
import { CitationVerifier } from '../../src/verification/citationVerifier.ts';
import { InMemorySourceRetriever } from '../../src/retrieval/sourceRetriever.ts';
import { selectRelevantFetchedText } from '../../src/services/groundingContextBuilder.ts';
import { supportBoundedStatutoryAdvisory } from '../../src/retrieval/statutoryAdvisorySupport.ts';

const localUrl = 'https://www.iras.gov.sg/taxes/gst/input-tax?topic=claiming';
const liveUrl = 'https://www.iras.gov.sg/taxes/gst/input-tax?topic=claiming&version=2026';

const makeLocalRecord = (overrides = {}) => ({
  id: 'IRAS_LOCAL_VERIFIED',
  authority: 'IRAS',
  authorityName: 'Inland Revenue Authority of Singapore',
  sourcePublisher: 'Inland Revenue Authority of Singapore',
  legalOrStandardInstrument: 'GST Act',
  documentTitle: 'Input tax claims',
  standardOrActCode: 'IRAS',
  paragraphOrSection: 'Input tax',
  sourceText: 'A GST-registered business may claim input tax when the goods or services are used to make taxable supplies.',
  principleSummary: 'Input tax claim conditions',
  officialSourceUrl: localUrl,
  canonicalSourceUrl: localUrl,
  domain: 'IRAS_GST',
  jurisdiction: 'Singapore',
  tags: ['input tax'],
  sourceStatus: 'VERIFIED',
  sourceType: 'OFFICIAL_GUIDANCE',
  evidenceTier: 'OFFICIAL_GUIDANCE',
  isVerbatimText: true,
  verificationMethod: 'STATUTORY_LEGISLATION_AUDIT',
  lastVerifiedDate: '2026-09-01',
  provenance: 'LOCAL_STATIC',
  lifecycleState: 'ACTIVE',
  validFrom: '2023-01-01',
  ...overrides
});

const makeLiveRecord = (overrides = {}) => ({
  ...makeLocalRecord({
    id: 'IRAS_LIVE_CANDIDATE',
    sourceText: 'The current GST rate is 9% for taxable supplies.',
    officialSourceUrl: liveUrl,
    canonicalSourceUrl: liveUrl,
    sourceStatus: 'NEEDS_REVIEW',
    isVerbatimText: false,
    provenance: 'LIVE_EXTERNAL',
    lifecycleState: 'CANDIDATE',
    urlVerificationStatus: 'VERIFIED',
    verificationMethod: 'LIVE_OFFICIAL_TOPIC_VERIFIED',
    documentHash: 'a'.repeat(64),
    retrievedAt: '2026-09-26T08:00:00.000Z'
  }),
  ...overrides
});

const makeBoundedAdvisoryRecord = (profile, sourceText, overrides = {}) => {
  const isCpf = profile === 'CPF';
  const topicId = isCpf ? 'cpf-ordinary-wages' : 'mom-part-iv-overtime';
  const url = isCpf
    ? 'https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions'
    : 'https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days';
  return makeLiveRecord({
    id: `${profile}_BOUNDED_ADVISORY`,
    authority: profile,
    sourceAuthority: profile,
    authorityName: isCpf ? 'Central Provident Fund Board' : 'Ministry of Manpower',
    sourcePublisher: isCpf ? 'Central Provident Fund Board (CPF Board)' : 'Ministry of Manpower (MOM)',
    documentTitle: isCpf ? 'What constitutes wages for CPF contributions' : 'Hours of work, overtime and rest days',
    sourceText,
    officialSourceUrl: url,
    canonicalSourceUrl: url,
    domain: isCpf ? 'CPF_BOARD' : 'MOM_EMPLOYMENT',
    tags: [topicId],
    relatedTopicIds: [topicId],
    extractionStatus: 'PARTIAL',
    isVerbatimText: false,
    ...overrides
  });
};

const makeClaim = (text, recordId, overrides = {}) => ({
  text,
  recordId,
  quote: text,
  kind: 'RULE',
  ...overrides
});

const localQuote = 'A GST-registered business may claim input tax when the goods or services are used to make taxable supplies.';
const validLocal = verifyEvidenceClaims(
  [makeClaim(localQuote, 'IRAS_LOCAL_VERIFIED')],
  [makeLocalRecord()],
  { missingFacts: [] }
);
assert.equal(validLocal.accepted.length, 1, 'An exact, complete verified local source quote is accepted.');
assert.deepEqual(validLocal.accepted[0], {
  text: localQuote,
  recordId: 'IRAS_LOCAL_VERIFIED',
  quote: localQuote,
  supportKind: 'EXACT_SOURCE_QUOTE'
}, 'The local source remains usable as evidence without exposing its unverified URL.');

const verifiedLocalUrl = verifyEvidenceClaims(
  [makeClaim(localQuote, 'IRAS_LOCAL_VERIFIED')],
  [makeLocalRecord({ urlVerificationStatus: 'VERIFIED', urlVerifiedDate: '2026-09-26', urlVerificationMethod: 'TESTED_EXACT_SOURCE_MAP_MATCH' })],
  { missingFacts: [] }
);
assert.equal(verifiedLocalUrl.accepted[0].canonicalUrl, localUrl,
  'An exact URL with separate verified provenance can be rendered as a citation.');
const guessedUrl = verifyEvidenceClaims(
  [makeClaim(localQuote, 'IRAS_LOCAL_VERIFIED', { citationUrl: localUrl })],
  [makeLocalRecord()],
  { missingFacts: [] }
);
assert.equal(guessedUrl.rejected[0].reason, 'CITATION_URL_UNVERIFIED',
  'An approved host and matching canonical URL do not authorize a clickable citation.');

const liveQuote = 'The current GST rate is 9% for taxable supplies.';
const validLive = verifyEvidenceClaims(
  [makeClaim(liveQuote, 'IRAS_LIVE_CANDIDATE', { citationUrl: liveUrl })],
  [makeLiveRecord()],
  { missingFacts: [] }
);
assert.equal(validLive.accepted.length, 1, 'A genuine official live candidate with exact quote and provenance is accepted.');
assert.equal(validLive.accepted[0].supportKind, 'EXACT_SOURCE_QUOTE');

const cpfDefinitionBlocks = [
  'Ordinary wages are wages due or granted wholly and exclusively in respect of employment in that month.',
  'For wages to be classified as Ordinary Wages for the month, they must meet both of the following conditions:',
  '• They are given to an employee for their employment in that month, and',
  '• They are payable by the 14th of the following month.',
  'For example, monthly salary.'
];
const cpfDefinitionSource = cpfDefinitionBlocks.join('\n\n');
const cpfDefinitionQuote = cpfDefinitionBlocks.slice(1, 4).join('\n\n');
const cpfBoundedRecord = makeBoundedAdvisoryRecord('CPF', cpfDefinitionSource);
const cpfCompleteBundle = verifyEvidenceClaims(
  [makeClaim(cpfDefinitionQuote, cpfBoundedRecord.id)], [cpfBoundedRecord], { missingFacts: [] }
);
assert.equal(cpfCompleteBundle.accepted.length, 1,
  'A complete exact CPF definition heading and both native conditions may be cited as one contiguous bundle.');
for (const incompleteCpfQuote of [
  cpfDefinitionBlocks.slice(1, 3).join('\n\n'),
  cpfDefinitionBlocks.slice(2, 4).join('\n\n'),
  `${cpfDefinitionBlocks[1]}\n\n${cpfDefinitionBlocks[3]}\n\n${cpfDefinitionBlocks[2]}`,
  `${cpfDefinitionQuote} A payment on the 20th also qualifies.`,
  cpfDefinitionQuote.replace('the 14th', 'the 15th')
]) {
  const incomplete = verifyEvidenceClaims(
    [makeClaim(incompleteCpfQuote, cpfBoundedRecord.id)], [cpfBoundedRecord], { missingFacts: [] }
  );
  assert.equal(incomplete.accepted.length, 0,
    'An omitted condition, reordered/rephrased condition, or added assertion cannot pass the CPF bundle path.');
}
const cpfWithAttachedQualifier = makeBoundedAdvisoryRecord('CPF',
  `${cpfDefinitionBlocks.slice(1, 4).join('\n\n')}\n\nHowever, the ordinary-wage ceiling is applied separately.`);
const omittedCpfQualifier = verifyEvidenceClaims(
  [makeClaim(cpfDefinitionQuote, cpfWithAttachedQualifier.id)], [cpfWithAttachedQualifier], { missingFacts: [] }
);
assert.equal(omittedCpfQualifier.accepted.length, 0,
  'A complete CPF list still cannot omit a directly attached qualification.');

const cpfCashTopUpTopic = 'iras-individual-cpf-cash-top-up-relief';
const cpfCashTopUpUrl = 'https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-reliefs-rebates-and-deductions/tax-reliefs/central-provident-fund-(cpf)-cash-top-up-relief';
const cpfCashTopUpBlocks = [
  'CPF Cash Top-up Relief is given to encourage Singaporeans and Permanent Residents to set aside money for retirement needs either in their own CPF accounts or those of family members.',
  'To qualify for the tax relief for Year of Assessment (YA) 2026, you must:',
  '1. be a Singapore Citizen/Permanent Resident; and',
  '2. have made cash top-ups in 2025 under the CPF Retirement Sum Topping-Up Scheme ("RSTU").',
  'CPF cash top-ups that attract matching grants under the Matched Retirement Savings Scheme (MRSS) will not be eligible for CPF Cash Top-up Relief from YA 2026 (i.e. CPF cash top-ups received from 1 Jan 2025).',
  '^{}^{}CPF cash top-ups to eligible members’ MediSave Accounts that attract the Matched MediSave Scheme (MMSS) matching grant will not qualify for CPF Cash Top-up Relief from YA 2027, for cash top-ups made from 1 Jan 2026.'
];
// Exact current IRAS page extraction, lines 952-957 and 989-1003.
const cpfCashTopUpLimitBlocks = [
  'CPF cash top-ups that attract matching grants under the Matched Retirement Savings Scheme (MRSS) will not be eligible for CPF Cash Top-up Relief from YA 2026 (i.e. CPF cash top-ups received from 1 Jan 2025).',
  '^{}^{}CPF cash top-ups to eligible members’ MediSave Accounts that attract the Matched MediSave Scheme (MMSS) matching grant will not qualify for CPF Cash Top-up Relief from YA 2027, for cash top-ups made from 1 Jan 2026.',
  'Individuals may continue to enjoy tax relief of up to $16,000 (maximum $8,000 for self and maximum $8,000 for family members) a year for eligible CPF cash top-ups that do not attract MRSS and/or MMSS grants.',
  'For each YA, a personal income tax relief cap of $80,000 applies to the total amount of all tax reliefs claimed (including any relief on cash top-ups made).',
  'Limit on cash top-up amount for computing tax relief',
  'Although individuals may enjoy tax relief of up to $16,000 (maximum $8,000 for self and maximum $8,000 for family members) a year for eligible CPF cash top-ups, there is a limit on the amount of cash top-ups to self and your family members that qualifies for tax relief.',
  'Age of recipients | Limit on cash top-up amount for computing tax relief',
  '--- | ---',
  'For recipients below age 55 | (a) Top-up to Special Account (SA) under RSTU scheme:(i) is capped at the current year’s Full Retirement Sum (FRS).(ii) Maximum allowed cash top-up: FRS – SA savings – Amount withdrawn from SA for investments^{*}^{*}Net SA savings withdrawn under CPF Investment Scheme (CPFIS) for investments that have not been completely disposed of',
  '* * *',
  '(b) Top-up to MediSave Account (MA):(i) is capped at the Basic Healthcare Sum (BHS) (if the individual making a top-up is a self-employed person (SEP), he/she must be up-to-date with their MediSave payable)(ii) Maximum allowed cash top-up: BHS - MA balance before the top-up',
  'For recipients aged 55 years and above | (a) Top-up to Retirement Account (RA) under RSTU scheme:(i) is capped at the current year’s Full Retirement Sum (FRS)(ii) Maximum allowed cash top-up: FRS – RA^{**}^{**}RA savings refers to the cash set aside in the RA (excluding amounts such as interest earned, any government grants received) plus amounts withdrawn',
  '* * *',
  '(b) Top-up to MediSave Account (MA):(i) is capped at the Basic Healthcare Sum (BHS) (if the individual making a top-up is a self-employed person (SEP), he/she must be up-to-date with their MediSave payable)(ii) Maximum allowed cash top-up: BHS - MA balance before the top-up',
  "To check your top-up limit you can make to your SA/RA under RSTU scheme, you may use the CPF Board's Retirement Dashboard."
];
const cpfCashTopUpEligibilitySource = cpfCashTopUpBlocks.join('\n\n');
const cpfCashTopUpSource = [...cpfCashTopUpBlocks, ...cpfCashTopUpLimitBlocks.slice(2)].join('\n\n');
const cpfCashTopUpRecord = makeLocalRecord({
  id: 'IRAS_CPF_CASH_TOP_UP_ELIGIBILITY',
  documentTitle: 'IRAS CPF Cash Top-up Relief',
  sourceText: cpfCashTopUpSource,
  officialSourceUrl: cpfCashTopUpUrl,
  canonicalSourceUrl: cpfCashTopUpUrl,
  domain: 'IRAS_TAX',
  tags: [cpfCashTopUpTopic],
  relatedTopicIds: [],
  sourceMapTopicIds: [cpfCashTopUpTopic]
});
const cpfCashTopUpComplete = verifyEvidenceClaims(
  [makeClaim(cpfCashTopUpEligibilitySource, cpfCashTopUpRecord.id)], [cpfCashTopUpRecord], { missingFacts: [] }
);
assert.equal(cpfCashTopUpComplete.accepted.length, 1,
  'The complete IRAS CPF qualification list and both current matching-grant exclusions remain quotable as one exact contiguous source span.');
const cpfCashTopUpOmittedCondition = verifyEvidenceClaims(
  [makeClaim(cpfCashTopUpBlocks.slice(0, 3).concat(cpfCashTopUpBlocks.slice(4)).join('\n\n'), cpfCashTopUpRecord.id)],
  [cpfCashTopUpRecord], { missingFacts: [] }
);
assert.equal(cpfCashTopUpOmittedCondition.accepted.length, 0,
  'Omitting either numbered CPF qualification condition cannot pass the narrow IRAS list verifier.');
const cpfCashTopUpDroppedExclusions = verifyEvidenceClaims(
  [makeClaim(cpfCashTopUpBlocks.slice(0, 4).join('\n\n'), cpfCashTopUpRecord.id)],
  [cpfCashTopUpRecord], { missingFacts: [] }
);
assert.equal(cpfCashTopUpDroppedExclusions.rejected[0].reason, 'QUOTE_OMITS_ATTACHED_QUALIFICATION',
  'The exact qualification list remains incomplete when either current MRSS/MMSS exclusion is dropped.');
const cpfCashTopUpAltered = verifyEvidenceClaims(
  [makeClaim(cpfCashTopUpEligibilitySource.replace('Singapore Citizen/Permanent Resident', 'Singapore citizen or permanent resident'), cpfCashTopUpRecord.id)],
  [cpfCashTopUpRecord], { missingFacts: [] }
);
assert.equal(cpfCashTopUpAltered.accepted.length, 0,
  'A paraphrased CPF qualification list does not pass the exact-source-span path.');

const cpfCashTopUpLimitQuotes = completeIrasCpfCashTopUpLimitQuotes(cpfCashTopUpSource);
assert.equal(cpfCashTopUpLimitQuotes.length, 2,
  'The current IRAS layout yields the complete annual-cap/grant span and the complete own-account FRS table span.');
assert.equal(cpfCashTopUpLimitQuotes[0], [
  ...cpfCashTopUpBlocks.slice(4), ...cpfCashTopUpLimitBlocks.slice(2, 4)
].join('\n\n'));
assert.equal(cpfCashTopUpLimitQuotes[1], cpfCashTopUpLimitBlocks.slice(4, -1).join('\n\n'),
  'The complete FRS table span retains the heading, all intervening MA rows, and attached SA/RA footnotes.');
const cpfCashTopUpLimitClaims = verifyEvidenceClaims(
  cpfCashTopUpLimitQuotes.map(quote => makeClaim(quote, cpfCashTopUpRecord.id)),
  [cpfCashTopUpRecord], { missingFacts: [] }
);
assert.equal(cpfCashTopUpLimitClaims.accepted.length, 2,
  'Both derived limit spans are accepted only as exact source quotations.');
const collapsedCpfTableText = cpfCashTopUpLimitBlocks.slice(5, -1).join(' ');
const collapsedCpfTopUpSource = [
  ...cpfCashTopUpBlocks, ...cpfCashTopUpLimitBlocks.slice(2, 5), collapsedCpfTableText,
  cpfCashTopUpLimitBlocks.at(-1)
].join('\n\n');
const collapsedCpfLimitQuotes = completeIrasCpfCashTopUpLimitQuotes(collapsedCpfTopUpSource);
assert.equal(collapsedCpfLimitQuotes.length, 2,
  'A single extracted table block still yields the two complete spans when it retains all rows and notes.');
assert.equal(collapsedCpfLimitQuotes[1], [cpfCashTopUpLimitBlocks[4], collapsedCpfTableText].join('\n\n'));
assert.equal(verifyEvidenceClaims(collapsedCpfLimitQuotes.map(quote => makeClaim(quote, cpfCashTopUpRecord.id)),
  [{ ...cpfCashTopUpRecord, sourceText: collapsedCpfTopUpSource }], { missingFacts: [] }).accepted.length, 2,
  'The whole-table-block extraction path remains exactly verifiable.');
const splitCpfOwnAccountRows = [
  'For recipients below age 55',
  '(a) Top-up to Special Account (SA) under RSTU scheme:',
  '(i) is capped at the current year’s Full Retirement Sum (FRS).',
  '(ii) Maximum allowed cash top-up: FRS – SA savings – Amount withdrawn from SA for investments*',
  '*Net SA savings withdrawn under CPF Investment Scheme (CPFIS) for investments that have not been completely disposed of',
  '* * *',
  cpfCashTopUpLimitBlocks[10],
  'For recipients aged 55 years and above',
  '(a) Top-up to Retirement Account (RA) under RSTU scheme:',
  '(i) is capped at the current year’s Full Retirement Sum (FRS)',
  '(ii) Maximum allowed cash top-up: FRS – RA**',
  '**RA savings refers to the cash set aside in the RA (excluding amounts such as interest earned, any government grants received) plus amounts withdrawn',
  '* * *',
  cpfCashTopUpLimitBlocks[13].replace('the Basic Healthcare Sum (BHS)', 'the BHS'),
  cpfCashTopUpLimitBlocks[14]
];
const splitCpfTopUpSource = [
  ...cpfCashTopUpBlocks,
  ...cpfCashTopUpLimitBlocks.slice(2, 8),
  ...splitCpfOwnAccountRows
].join('\n\n');
const splitCpfLimitQuotes = completeIrasCpfCashTopUpLimitQuotes(splitCpfTopUpSource);
assert.equal(splitCpfLimitQuotes.length, 2,
  'Separate visible recipient, condition, calculation and footnote blocks retain the complete split-row table.');
assert.equal(splitCpfLimitQuotes[1], [
  ...cpfCashTopUpLimitBlocks.slice(4, 8), ...splitCpfOwnAccountRows.slice(0, -1)
].join('\n\n'), 'The split-row quote preserves the exact contiguous table span through the SA and RA rows.');
const splitCpfRecord = { ...cpfCashTopUpRecord, sourceText: splitCpfTopUpSource };
assert.equal(verifyEvidenceClaims(splitCpfLimitQuotes.map(quote => makeClaim(quote, splitCpfRecord.id)),
  [splitCpfRecord], { missingFacts: [] }).accepted.length, 2,
  'Both split-row limit spans remain exact-source verifiable.');
const inlineRaFormulaAndQualification = 'Maximum allowed cash top-up: FRS – RA^{**}^{**}RA savings refers to the cash set aside in the RA (excluding amounts such as interest earned, any government grants received) plus amounts withdrawn';
const inlineRaQualificationMisassociatedSource = cpfCashTopUpSource
  .replace(inlineRaFormulaAndQualification, '')
  .replace('For recipients aged 55 years and above', `${inlineRaFormulaAndQualification} For recipients aged 55 years and above`);
assert.deepEqual(completeIrasCpfCashTopUpLimitQuotes(inlineRaQualificationMisassociatedSource), [],
  'The inline-row verifier rejects the RA formula and savings qualification when they are moved into the below-55 row.');
const raFormulaAndQualificationSeparated = [
  '(ii) Maximum allowed cash top-up: FRS – RA**',
  '**RA savings refers to the cash set aside in the RA (excluding amounts such as interest earned, any government grants received) plus amounts withdrawn'
].join('\n\n');
const raQualificationMisassociatedSource = splitCpfTopUpSource
  .replace(`\n\n${raFormulaAndQualificationSeparated}`, '')
  .replace(`\n\nFor recipients aged 55 years and above`, `\n\n${raFormulaAndQualificationSeparated}\n\nFor recipients aged 55 years and above`);
assert.deepEqual(completeIrasCpfCashTopUpLimitQuotes(raQualificationMisassociatedSource), [],
  'The RA formula and savings qualification in the below-55 age row cannot complete the age-55-and-above row.');
const collapsedRaQualificationMisassociatedSource = collapsedCpfTopUpSource
  .replace(inlineRaFormulaAndQualification, '')
  .replace('For recipients aged 55 years and above', `${inlineRaFormulaAndQualification} For recipients aged 55 years and above`);
assert.deepEqual(completeIrasCpfCashTopUpLimitQuotes(collapsedRaQualificationMisassociatedSource), [],
  'A collapsed table cannot use the misplaced RA formula and savings qualification from the below-55 age row.');
const collapsedSaFormulaAndQualification = 'Maximum allowed cash top-up: FRS – SA savings – Amount withdrawn from SA for investments^{*}^{*}Net SA savings withdrawn under CPF Investment Scheme (CPFIS) for investments that have not been completely disposed of';
const collapsedSaQualificationMisassociatedSource = collapsedCpfTopUpSource
  .replace(collapsedSaFormulaAndQualification, '')
  .replace('For recipients aged 55 years and above',
    `For recipients aged 55 years and above ${collapsedSaFormulaAndQualification}`);
assert.deepEqual(completeIrasCpfCashTopUpLimitQuotes(collapsedSaQualificationMisassociatedSource), [],
  'A collapsed table cannot use the SA formula and withdrawal qualification from the age-55-and-above row.');
const collapsedTableWithEmbeddedEndMarker = [...cpfCashTopUpLimitBlocks.slice(4)].join(' ');
const raQualificationAfterEmbeddedEndMarker = collapsedTableWithEmbeddedEndMarker
  .replace(inlineRaFormulaAndQualification, '')
  .replace('To check your top-up limit', `To check your top-up limit ${inlineRaFormulaAndQualification}`);
const cpfQualificationAfterTableEndSource = [
  ...cpfCashTopUpBlocks, ...cpfCashTopUpLimitBlocks.slice(2, 4), raQualificationAfterEmbeddedEndMarker
].join('\n\n');
assert.deepEqual(completeIrasCpfCashTopUpLimitQuotes(cpfQualificationAfterTableEndSource), [],
  'An embedded table-end instruction cannot be followed by RA evidence that completes the table quote.');
const cpfQualificationAfterTableEndRecord = { ...cpfCashTopUpRecord, sourceText: cpfQualificationAfterTableEndSource };
const cpfQualificationAfterTableEndClaim = verifyEvidenceClaims(
  [makeClaim(raQualificationAfterEmbeddedEndMarker, cpfQualificationAfterTableEndRecord.id)],
  [cpfQualificationAfterTableEndRecord], { missingFacts: [] }
);
assert.equal(cpfQualificationAfterTableEndClaim.accepted.length, 0,
  'The shared claim verifier rejects RA table evidence supplied only after the embedded end marker.');
const inlineSaFormulaAndQualification = 'Maximum allowed cash top-up: FRS – SA savings – Amount withdrawn from SA for investments^{*}^{*}Net SA savings withdrawn under CPF Investment Scheme (CPFIS) for investments that have not been completely disposed of';
const inlineSaQualificationMisassociatedSource = cpfCashTopUpSource
  .replace(inlineSaFormulaAndQualification, '')
  .replace('For recipients aged 55 years and above', `For recipients aged 55 years and above ${inlineSaFormulaAndQualification}`);
assert.deepEqual(completeIrasCpfCashTopUpLimitQuotes(inlineSaQualificationMisassociatedSource), [],
  'The inline-row verifier rejects the SA formula and withdrawal qualification when they are moved into the age-55-and-above row.');
for (const [label, missingBlock] of [
  ['SA calculation', splitCpfOwnAccountRows[3]],
  ['SA withdrawal footnote', splitCpfOwnAccountRows[4]],
  ['RA calculation', splitCpfOwnAccountRows[10]],
  ['RA withdrawal footnote', splitCpfOwnAccountRows[11]]
]) {
  const incompleteSource = splitCpfTopUpSource.replace(`\n\n${missingBlock}`, '');
  assert.deepEqual(completeIrasCpfCashTopUpLimitQuotes(incompleteSource), [],
    `A split-row table missing its ${label} remains incomplete.`);
}
const splitCpfWithoutBhsDefinition = splitCpfTopUpSource.replace(
  'the Basic Healthcare Sum (BHS)', 'the healthcare amount'
);
assert.deepEqual(completeIrasCpfCashTopUpLimitQuotes(splitCpfWithoutBhsDefinition), [],
  'The abbreviated second MediSave row requires an explicit Basic Healthcare Sum (BHS) definition in the same table.');
const duplicateSplitCpfRow = splitCpfTopUpSource.replace(
  'For recipients aged 55 years and above',
  'For recipients below age 55\n\nFor recipients aged 55 years and above'
);
assert.deepEqual(completeIrasCpfCashTopUpLimitQuotes(duplicateSplitCpfRow), [],
  'Duplicate split-row markers fail closed.');
for (const partialQuote of [cpfCashTopUpLimitBlocks[2], cpfCashTopUpLimitBlocks[8]]) {
  const partial = verifyEvidenceClaims([makeClaim(partialQuote, cpfCashTopUpRecord.id)], [cpfCashTopUpRecord], { missingFacts: [] });
  assert.equal(partial.rejected[0].reason, 'QUOTE_OMITS_ATTACHED_QUALIFICATION',
    'An isolated headline cap or SA-only row cannot bypass complete CPF limit coverage.');
}
const skipped80kQuote = [cpfCashTopUpLimitBlocks[0], cpfCashTopUpLimitBlocks[1], cpfCashTopUpLimitBlocks[2],
  cpfCashTopUpLimitBlocks[4], ...cpfCashTopUpLimitBlocks.slice(5, -1)].join('\n\n');
assert.equal(verifyEvidenceClaims([makeClaim(skipped80kQuote, cpfCashTopUpRecord.id)], [cpfCashTopUpRecord], { missingFacts: [] }).accepted.length, 0,
  'Non-adjacent cap and FRS sections cannot be combined into a manufactured quotation.');
for (const [label, omitted] of [
  ['$80,000 overall cap', cpfCashTopUpLimitBlocks[3]],
  ['under-55 SA row', cpfCashTopUpLimitBlocks[8]],
  ['age-55-and-above RA row', cpfCashTopUpLimitBlocks[11]],
  ['MRSS grant exclusion', cpfCashTopUpBlocks[4]],
  ['MMSS grant exclusion', cpfCashTopUpBlocks[5]]
]) {
  const incompleteSource = cpfCashTopUpSource.replace(`\n\n${omitted}`, '');
  assert.deepEqual(completeIrasCpfCashTopUpLimitQuotes(incompleteSource), [],
    `Missing ${label} prevents a complete derived limits span.`);
}
for (const [label, overrides] of [
  ['wrong authority', { authority: 'CPF' }],
  ['wrong domain', { domain: 'IRAS_GST' }],
  ['wrong topic', { tags: ['iras-gst-blocked-input-tax'], relatedTopicIds: [], sourceMapTopicIds: [] }]
]) {
  const wrongRecord = { ...cpfCashTopUpRecord, ...overrides, id: `IRAS_CPF_CASH_TOP_UP_LIMITS_${label.replace(/\s+/g, '_')}` };
  assert.equal(verifyEvidenceClaims([makeClaim(cpfCashTopUpLimitQuotes[0], wrongRecord.id)], [wrongRecord], { missingFacts: [] }).accepted.length, 0,
    `The exact derived span is not recognized with ${label}.`);
}
const paraphrasedLimit = verifyEvidenceClaims(
  [makeClaim(cpfCashTopUpLimitQuotes[0].replace('MRSS and/or MMSS grants', 'MRSS grants'), cpfCashTopUpRecord.id)],
  [cpfCashTopUpRecord], { missingFacts: [] }
);
assert.equal(paraphrasedLimit.accepted.length, 0, 'A malformed derived limit span is not recognized.');

const gstMotorCarTopic = 'iras-gst-motor-vehicles';
const gstMotorCarUrl = 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax';
const gstConnectedPersonBlocks = [
  'Expenses on motor car used by a connected person | No, from 1 Jan 2023, where you incur expenses on a motor car used by a person connected to you (e.g. your subsidiary), you cannot claim input tax on the cost and running expenses of the motor car, unless you satisfy both of the following conditions (in addition to the conditions for claiming input tax):',
  '1. You recover the motor car expenses from the connected person. Where you recover only a portion of the motor car expenses incurred, you can only claim input tax to the extent of the portion recovered; and.',
  '2. The recovery is not ancillary to any primary supply made by you to the connected person.',
  'To determine whether the recovery is considered as ancillary to a supply made by you, please refer to “GST: Guide on Reimbursement and Disbursement of Expenses”.',
  'In instances where both conditions (1) and (2) are met, the connected person will not be able to claim input tax on the motor car expenses recharged by you. Where the connected person is GST-registered, the input tax claims are disallowed under Regulation 27 of the GST (General) Regulations.'
];
const gstConnectedPersonSource = gstConnectedPersonBlocks.join('\n\n');
const gstConnectedPersonRecord = makeLocalRecord({
  id: 'IRAS_GST_MOTOR_CAR_CONNECTED_PERSON',
  documentTitle: 'IRAS Conditions for Claiming Input Tax',
  sourceText: gstConnectedPersonSource,
  officialSourceUrl: gstMotorCarUrl,
  canonicalSourceUrl: gstMotorCarUrl,
  tags: ['iras-gst-blocked-input-tax', gstMotorCarTopic],
  relatedTopicIds: [],
  sourceMapTopicIds: ['iras-gst-blocked-input-tax', gstMotorCarTopic]
});
const gstConnectedPersonComplete = verifyEvidenceClaims(
  [makeClaim(gstConnectedPersonSource, gstConnectedPersonRecord.id)], [gstConnectedPersonRecord], { missingFacts: [] }
);
assert.equal(gstConnectedPersonComplete.accepted.length, 1,
  'The connected-person provision is quotable only with both numbered conditions, partial-recovery limit, and attached guidance/outcome.');
const gstConnectedPersonOmittedCondition = verifyEvidenceClaims(
  [makeClaim(gstConnectedPersonBlocks.slice(0, 2).join('\n\n'), gstConnectedPersonRecord.id)],
  [gstConnectedPersonRecord], { missingFacts: [] }
);
assert.equal(gstConnectedPersonOmittedCondition.rejected[0].reason, 'QUOTE_OMITS_ATTACHED_QUALIFICATION',
  'The connected-person heading and first condition cannot stand in for the second condition.');
const gstConnectedPersonDroppedPartialRecovery = verifyEvidenceClaims(
  [makeClaim(gstConnectedPersonSource.replace('Where you recover only a portion of the motor car expenses incurred, you can only claim input tax to the extent of the portion recovered; and.', ''), gstConnectedPersonRecord.id)],
  [gstConnectedPersonRecord], { missingFacts: [] }
);
assert.equal(gstConnectedPersonDroppedPartialRecovery.accepted.length, 0,
  'Dropping the partial-recovery qualification invalidates the exact connected-person bundle.');
const gstConnectedPersonAltered = verifyEvidenceClaims(
  [makeClaim(gstConnectedPersonSource.replace('The recovery is not ancillary', 'The recovery is ancillary'), gstConnectedPersonRecord.id)],
  [gstConnectedPersonRecord], { missingFacts: [] }
);
assert.equal(gstConnectedPersonAltered.accepted.length, 0,
  'Changing the substantive connected-person condition cannot pass the narrow source-span verifier.');

const currentConnectedPersonBlocks = [
  'Motor car used by a connected person',
  'From 1 Jan 2023, where a motor car is used by a connected person (e.g. a subsidiary), GST incurred on the motor car expenses is generally not claimable. An exception applies only if you satisfy both of the following conditions, in addition to the conditions for claiming input tax:',
  '• You recover the motor car expenses from the connected person. Where you recover only a portion of the motor car expenses incurred, you can only claim input tax to the extent of the portion recovered; and',
  '• The recovery is not ancillary to any primary supply you make to them. To determine whether the recovery is considered as ancillary to a supply, refer to “GST: Guide on Reimbursement and Disbursement of Expenses” (PDF, 584KB).',
  'Where the connected person is GST-registered, the input tax claim on the motor car expenses recovered by you is disallowed under Regulation 27.'
];
const currentConnectedPersonSource = currentConnectedPersonBlocks.join('\n\n');
assert.equal(completeIrasGstMotorCarConnectedPersonExceptionQuote(currentConnectedPersonSource), currentConnectedPersonSource,
  'The current IRAS heading and exception wording yield one exact span including the GST-registered recipient restriction.');
const currentConnectedPersonRecord = makeLocalRecord({
  id: 'IRAS_GST_MOTOR_CAR_CURRENT_CONNECTED_PERSON',
  domain: 'IRAS_GST',
  documentTitle: 'IRAS Motor Vehicles Expenses',
  sourceText: currentConnectedPersonSource,
  officialSourceUrl: gstMotorCarUrl,
  canonicalSourceUrl: gstMotorCarUrl,
  tags: ['iras-gst-blocked-input-tax', gstMotorCarTopic],
  relatedTopicIds: [], sourceMapTopicIds: ['iras-gst-blocked-input-tax', gstMotorCarTopic]
});
const currentConnectedPersonVerified = verifyEvidenceClaims(
  [makeClaim(currentConnectedPersonSource, currentConnectedPersonRecord.id)],
  [currentConnectedPersonRecord], { missingFacts: [] }
);
assert.equal(currentConnectedPersonVerified.accepted.length, 1,
  'The current connected-person source span passes the existing exact-source verifier.');
for (const omission of [
  '• You recover the motor car expenses from the connected person. Where you recover only a portion of the motor car expenses incurred, you can only claim input tax to the extent of the portion recovered; and',
  '• The recovery is not ancillary to any primary supply you make to them. To determine whether the recovery is considered as ancillary to a supply, refer to “GST: Guide on Reimbursement and Disbursement of Expenses” (PDF, 584KB).',
  'Where the connected person is GST-registered, the input tax claim on the motor car expenses recovered by you is disallowed under Regulation 27.'
]) {
  assert.equal(completeIrasGstMotorCarConnectedPersonExceptionQuote(currentConnectedPersonSource.replace(`\n\n${omission}`, '')),
    undefined, 'Removing a recovery condition or attached recipient restriction keeps the current source exception incomplete.');
}

const momCoverageBlocks = [
  'If you are covered under Part 4 of the Employment Act, your hours of work are regulated and you are entitled to breaks, overtime pay and rest day.',
  'The hours of work guidelines apply only to those covered under Part 4 of the Employment Act.',
  'Note: Part 4 of the Employment Act does not cover managers and executives.',
  'If you are not covered under Part 4 of the Employment Act, your terms and conditions of employment will be according to your employment contract.',
  'Use this self-assessment tool to assess your coverage under Part 4 of the Employment Act.',
  'Overtime work is all work in excess of the normal hours of work (excluding breaks).',
  'You can claim overtime if you are:',
  '• A non-workman earning a monthly basic salary of $2,600 or less.',
  '• A workman earning a monthly basic salary of $4,500 or less.'
];
const momCoverageSource = momCoverageBlocks.join('\n\n');
const momBoundedRecord = makeBoundedAdvisoryRecord('MOM', momCoverageSource);
const momCompleteBundle = verifyEvidenceClaims(
  [makeClaim(momCoverageSource, momBoundedRecord.id)], [momBoundedRecord], { missingFacts: [] }
);
assert.equal(momCompleteBundle.accepted.length, 1,
  'A complete exact MOM Part 4 anchor, eligibility lead-in, both employee categories and exclusion may be cited together.');
for (const incompleteMomQuote of [
  momCoverageBlocks.slice(0, 7).concat(momCoverageBlocks[8]).join('\n\n'),
  momCoverageBlocks.slice(0, 8).join('\n\n'),
  [momCoverageBlocks[0], momCoverageBlocks[1], momCoverageBlocks[3], ...momCoverageBlocks.slice(4)].join('\n\n'),
  momCoverageSource.replace(momCoverageBlocks[6], ''),
  `${momCoverageBlocks.slice(0, 7).join('\n\n')}\n\n${momCoverageBlocks[8]}\n\n${momCoverageBlocks[7]}`
]) {
  const incomplete = verifyEvidenceClaims(
    [makeClaim(incompleteMomQuote, momBoundedRecord.id)], [momBoundedRecord], { missingFacts: [] }
  );
  assert.equal(incomplete.accepted.length, 0,
    'An omitted Part IV anchor, category, lead-in, or managers/executives exclusion cannot pass the MOM bundle path.');
}
const momCoverageWithoutListHeader = [
  'Part 4 of the Employment Act governs hours of work and overtime.',
  'Non-workmen eligible for Part 4 overtime earn a monthly basic salary of $2,600 or less.',
  'Workmen eligible for Part 4 overtime earn a monthly basic salary of $4,500 or less.',
  'Note: Part 4 of the Employment Act does not cover managers and executives.'
].join('\n\n');
const momHeaderlessRecord = makeBoundedAdvisoryRecord('MOM', momCoverageWithoutListHeader);
assert.equal(supportBoundedStatutoryAdvisory({
  authority: 'MOM',
  topicId: 'mom-part-iv-overtime',
  subject: 'Part IV overtime eligibility',
  sourceText: momCoverageWithoutListHeader
}), true, 'The substantive helper recognizes the full MOM category bundle independently of its list heading.');
const momHeaderlessResult = verifyEvidenceClaims(
  [makeClaim(momCoverageWithoutListHeader, momHeaderlessRecord.id)], [momHeaderlessRecord], { missingFacts: [] }
);
assert.equal(momHeaderlessResult.accepted.length, 0,
  'A substantively complete but headerless MOM category passage is not a complete native-list quotation.');

const unrelatedMomSource = [
  'Employers should keep payroll information in their records.',
  'Working schedules may be arranged according to operational needs.'
].join('\n\n');
const unrelatedMomRecord = makeBoundedAdvisoryRecord('MOM', unrelatedMomSource);
const unrelatedMomQuote = verifyEvidenceClaims(
  [makeClaim(unrelatedMomSource, unrelatedMomRecord.id)], [unrelatedMomRecord], { missingFacts: [] }
);
assert.equal(unrelatedMomQuote.accepted.length, 0,
  'An exact but unrelated contiguous MOM passage cannot use the bounded coverage verifier path.');

for (const { record: mismatchedRecord, quote } of [
  { record: makeBoundedAdvisoryRecord('CPF', cpfDefinitionSource, { authority: 'MOM', sourceAuthority: 'MOM' }), quote: cpfDefinitionQuote },
  { record: makeBoundedAdvisoryRecord('CPF', cpfDefinitionSource, { domain: 'MOM_EMPLOYMENT' }), quote: cpfDefinitionQuote },
  { record: makeBoundedAdvisoryRecord('CPF', cpfDefinitionSource, {
    relatedTopicIds: ['cpf-contributions'], sourceMapTopicIds: [], tags: ['cpf-contributions']
  }), quote: cpfDefinitionQuote },
  { record: makeBoundedAdvisoryRecord('MOM', momCoverageSource, { authority: 'CPF', sourceAuthority: 'CPF' }), quote: momCoverageSource },
  { record: makeBoundedAdvisoryRecord('MOM', momCoverageSource, { domain: 'CPF_BOARD' }), quote: momCoverageSource },
  { record: makeBoundedAdvisoryRecord('MOM', momCoverageSource, {
    relatedTopicIds: ['mom-employment'], sourceMapTopicIds: [], tags: ['mom-employment']
  }), quote: momCoverageSource },
  { record: makeBoundedAdvisoryRecord('CPF', cpfDefinitionSource, { provenance: 'LOCAL_STATIC' }), quote: cpfDefinitionQuote },
  { record: makeBoundedAdvisoryRecord('CPF', cpfDefinitionSource, { lifecycleState: 'ACTIVE' }), quote: cpfDefinitionQuote },
  { record: makeBoundedAdvisoryRecord('CPF', cpfDefinitionSource, {
    officialSourceUrl: 'https://www.cpf.gov.sg/employer/other-page'
  }), quote: cpfDefinitionQuote }
]) {
  const mismatched = verifyEvidenceClaims(
    [makeClaim(quote, mismatchedRecord.id)], [mismatchedRecord], { missingFacts: [] }
  );
  assert.equal(mismatched.accepted.length, 0,
    'The complete-bundle path is bound to the record authority, canonical domain and exact topic id.');
}

const remoteText = [
  'Motor vehicle input tax is generally restricted.',
  ...Array.from({ length: 12 }, (_, index) => `Unrelated filing detail ${index} has no bearing on vehicle eligibility.`),
  'A qualifying vehicle exception may apply only when its conditions are met.'
].join(' ');
const selectedFragments = selectRelevantFetchedText(remoteText,
  ['motor vehicle input tax', 'qualifying vehicle exception'], 300,
  'motor vehicle input tax qualifying vehicle exception');
assert.match(selectedFragments, /\n\n/, 'Noncontiguous fetched sentence windows retain a visible fragment boundary.');
const combinedFragmentClaim = selectedFragments.replace(/\n\n/g, ' ');
const crossWindowQuote = verifyEvidenceClaims(
  [makeClaim(combinedFragmentClaim, 'IRAS_LIVE_CANDIDATE', { citationUrl: liveUrl })],
  [makeLiveRecord({ sourceText: selectedFragments })],
  { missingFacts: [] }
);
assert.equal(crossWindowQuote.accepted.length, 0,
  'A quote joining noncontiguous live-page fragments is not a verbatim source span.');
assert.equal(crossWindowQuote.rejected[0].reason, 'QUOTE_NOT_WHOLE_SENTENCE_OR_PARAGRAPH');

const changedPolarity = 'Input tax is not claimable for qualifying taxable business purchases.';
const polarityResult = verifyEvidenceClaims(
  [makeClaim(changedPolarity, 'IRAS_LOCAL_VERIFIED')],
  [makeLocalRecord({ sourceText: 'Input tax is claimable for qualifying taxable business purchases.' })],
  { missingFacts: [] }
);
assert.equal(polarityResult.accepted.length, 0, 'Same-vocabulary polarity reversal is not supported.');

for (const changedText of [
  'The current GST rate is 8% for taxable supplies.',
  'An application must be filed within 21 days after notice.',
  'The restriction does not apply to any motor vehicle.'
]) {
  const sourceText = changedText.startsWith('The current GST rate')
    ? liveQuote
    : changedText.startsWith('An application')
      ? 'An application must be filed within 30 days after notice.'
      : 'The restriction does not apply to motor vehicles used solely for prescribed commercial purposes.';
  const verifierResult = verifyEvidenceClaims(
    [makeClaim(changedText, 'IRAS_LIVE_CANDIDATE')],
    [makeLiveRecord({ sourceText })],
    { missingFacts: [] }
  );
  assert.equal(verifierResult.accepted.length, 0, `Changed rate, deadline, or exemption is rejected: ${changedText}`);
}

const inventedSource = verifyEvidenceClaims(
  [makeClaim(localQuote, 'IRAS_MODEL_INVENTED_ID')],
  [makeLocalRecord()],
  { missingFacts: [] }
);
assert.equal(inventedSource.rejected[0].reason, 'SOURCE_RECORD_NOT_FOUND');

const wrongUrl = verifyEvidenceClaims(
  [makeClaim(liveQuote, 'IRAS_LIVE_CANDIDATE', { citationUrl: 'https://www.iras.gov.sg/taxes/gst/input-tax?topic=claiming&version=2025' })],
  [makeLiveRecord()],
  { missingFacts: [] }
);
assert.equal(wrongUrl.rejected[0].reason, 'CITATION_URL_MISMATCH', 'Query string identity is preserved when checking citation URLs.');

const crossRecordUrl = verifyEvidenceClaims(
  [makeClaim(localQuote, 'IRAS_LOCAL_VERIFIED', { citationUrl: liveUrl })],
  [makeLocalRecord(), makeLiveRecord()],
  { missingFacts: [] }
);
assert.equal(crossRecordUrl.rejected[0].reason, 'CITATION_URL_MISMATCH', 'An approved URL from another record cannot be borrowed.');

const undatedHistorical = makeLocalRecord({
  id: 'IRAS_HISTORICAL',
  sourceStatus: 'HISTORICAL',
  validFrom: '2022-12-01',
  validTo: '2023-01-02'
});
const noHistoricalDate = verifyEvidenceClaims(
  [makeClaim(localQuote, 'IRAS_HISTORICAL')],
  [undatedHistorical],
  { missingFacts: [] }
);
assert.equal(noHistoricalDate.rejected[0].reason, 'HISTORICAL_TARGET_DATE_REQUIRED');
const historicalDateAccepted = verifyEvidenceClaims(
  [makeClaim(localQuote, 'IRAS_HISTORICAL')],
  [undatedHistorical],
  { missingFacts: [], targetDate: '2023-01-01' }
);
assert.equal(historicalDateAccepted.accepted.length, 1, 'A historical quote is accepted within its explicit effective period.');
const outOfPeriod = verifyEvidenceClaims(
  [makeClaim(localQuote, 'IRAS_HISTORICAL')],
  [undatedHistorical],
  { missingFacts: [], targetDate: '2023-01-03' }
);
assert.equal(outOfPeriod.rejected[0].reason, 'SOURCE_NOT_IN_EFFECT_ON_TARGET_DATE');
const unboundedHistoricalQuestion = verifyEvidenceClaims(
  [makeClaim(localQuote, 'IRAS_LOCAL_VERIFIED')],
  [makeLocalRecord({ validFrom: undefined })],
  { missingFacts: [], targetDate: '2025-01-01' }
);
assert.equal(unboundedHistoricalQuestion.rejected[0].reason, 'TARGET_DATE_UNBOUNDED');

const nonReviewedLocal = verifyEvidenceClaims(
  [makeClaim(localQuote, 'IRAS_LOCAL_VERIFIED')],
  [makeLocalRecord({ sourceStatus: 'NEEDS_REVIEW' })],
  { missingFacts: [] }
);
assert.equal(nonReviewedLocal.rejected[0].reason, 'LOCAL_SOURCE_NOT_VERIFIED');
const reviewedHistoricalSummaryText = 'For disposals before 1 January 2026, the Section 13W safe harbour may apply to qualifying gains on ordinary shares, subject to the applicable ownership, holding-period and statutory exclusion conditions.';
const reviewedHistoricalSummary = makeLocalRecord({
  id: 'IRAS_HISTORICAL_CURATED_SUMMARY',
  sourceText: reviewedHistoricalSummaryText,
  sourceStatus: 'HISTORICAL',
  sourceType: 'CURATED_SUMMARY',
  evidenceTier: 'OFFICIAL_GUIDANCE',
  isVerbatimText: false,
  verificationMethod: 'CURATED_EDITORIAL_REVIEW',
  validFrom: '2012-06-01',
  validTo: '2025-12-31'
});
const reviewedSummaryClaim = verifyEvidenceClaims(
  [makeClaim(reviewedHistoricalSummaryText, 'IRAS_HISTORICAL_CURATED_SUMMARY')],
  [reviewedHistoricalSummary],
  { missingFacts: [], targetDate: '2025-12-30' }
);
assert.equal(reviewedSummaryClaim.accepted.length, 1,
  'An explicitly reviewed, date-bounded historical local summary may be quoted exactly even when it is not verbatim statute text.');
assert.equal(reviewedSummaryClaim.accepted[0].supportKind, 'REVIEWED_EDITORIAL_SUMMARY');

const reviewedCurrentSummary = makeLocalRecord({
  id: 'IRAS_VERIFIED_CURATED_SUMMARY',
  sourceText: 'The current filing process follows the applicable IRAS reporting instructions.',
  sourceStatus: 'VERIFIED',
  sourceType: 'CURATED_SUMMARY',
  evidenceTier: 'OFFICIAL_GUIDANCE',
  isVerbatimText: false,
  verificationMethod: 'CURATED_EDITORIAL_REVIEW'
});
const reviewedCurrentClaim = verifyEvidenceClaims(
  [makeClaim(reviewedCurrentSummary.sourceText, 'IRAS_VERIFIED_CURATED_SUMMARY')],
  [reviewedCurrentSummary],
  { missingFacts: [] }
);
assert.equal(reviewedCurrentClaim.accepted.length, 1,
  'An explicitly reviewed current local summary can be quoted exactly without being represented as verbatim statute text.');
assert.equal(reviewedCurrentClaim.accepted[0].supportKind, 'REVIEWED_EDITORIAL_SUMMARY');

const unifiedReviewedSummary = UNIFIED_SOURCE_REGISTRY.IRAS_FORM_CS_LITE_CRITERIA;
assert.equal(unifiedReviewedSummary.sourceStatus, 'VERIFIED',
  'A curated rule with review metadata retains its content review status in the unified registry.');
assert.equal(unifiedReviewedSummary.sourceType, 'CURATED_SUMMARY');
assert.equal(unifiedReviewedSummary.evidenceTier, 'OFFICIAL_GUIDANCE');
assert.equal(unifiedReviewedSummary.isVerbatimText, false);
assert.equal(unifiedReviewedSummary.verificationMethod, 'CURATED_EDITORIAL_REVIEW');
assert.equal(unifiedReviewedSummary.urlVerificationStatus, 'VERIFIED');
assert.equal(unifiedReviewedSummary.urlVerificationSourceMapId, 'IRAS_CIT_RETURNS_SOURCE_MAP',
  'A source-map URL match is recorded separately from the curated content-review status.');
assert.equal(UNIFIED_SOURCE_REGISTRY.MAS_SFO_13O_13U_MATERIAL_CHANGES.sourceStatus, 'NEEDS_REVIEW',
  'The IRAS curated-summary status correction does not promote MAS content.');
const reviewedSummaryCitation = new CitationVerifier(new InMemorySourceRetriever([unifiedReviewedSummary])).verifyCitation({
  standard: unifiedReviewedSummary.standardOrActCode,
  paragraph: unifiedReviewedSummary.paragraphOrSection,
  title: unifiedReviewedSummary.documentTitle,
  text: unifiedReviewedSummary.sourceText,
  officialSourceUrl: unifiedReviewedSummary.officialSourceUrl,
  authority: 'IRAS'
}, 'IRAS');
assert.equal(reviewedSummaryCitation.isValid, true);
assert.equal(reviewedSummaryCitation.status, 'STRUCTURALLY_VERIFIED_SUMMARY',
  'A reviewed curated summary is not mislabeled as content needing review by citation diagnostics.');
const originalUnreviewedFixture = SINGAPORE_STATUTORY_REPOSITORY.TEST_UNREVIEWED_CURATED_SUMMARY;
const originalMissingReviewFixture = SINGAPORE_STATUTORY_REPOSITORY.TEST_VERIFIED_SUMMARY_WITHOUT_REVIEW_PROVENANCE;
const summaryFixture = {
  id: 'TEST_CURATED_SUMMARY', authority: 'IRAS', authorityName: 'IRAS', actTitle: 'Income Tax Act 1947',
  actCode: 'ITA1947', sectionOrSchedule: 'Section 999', ruleTitle: 'Test summary', category: 'TAX_INCOME',
  principle: 'A reviewed summary fixture for source registry provenance behavior.', application: '', practicalRules: [],
  canonicalUrl: localUrl, tags: ['test summary'], sourceType: 'CURATED_SUMMARY', evidenceTier: 'CURATED_SUMMARY',
  isVerbatimText: false, lastVerifiedDate: '2026-09-26', reviewAuditCycleDays: 90
};
try {
  SINGAPORE_STATUTORY_REPOSITORY.TEST_UNREVIEWED_CURATED_SUMMARY = {
    ...summaryFixture, id: 'TEST_UNREVIEWED_CURATED_SUMMARY', sourceStatus: 'NEEDS_REVIEW'
  };
  SINGAPORE_STATUTORY_REPOSITORY.TEST_VERIFIED_SUMMARY_WITHOUT_REVIEW_PROVENANCE = {
    ...summaryFixture, id: 'TEST_VERIFIED_SUMMARY_WITHOUT_REVIEW_PROVENANCE', sourceStatus: 'VERIFIED', lastVerifiedDate: undefined
  };
  buildUnifiedSourceRegistry('2026-09-26');
  assert.equal(UNIFIED_SOURCE_REGISTRY.TEST_UNREVIEWED_CURATED_SUMMARY.sourceStatus, 'NEEDS_REVIEW',
    'A curated summary explicitly marked unreviewed remains NEEDS_REVIEW.');
  assert.equal(UNIFIED_SOURCE_REGISTRY.TEST_VERIFIED_SUMMARY_WITHOUT_REVIEW_PROVENANCE.sourceStatus, 'NEEDS_REVIEW',
    'A VERIFIED label without dated editorial review provenance is not enough to keep a curated summary VERIFIED.');
  assert.equal(UNIFIED_SOURCE_REGISTRY.TEST_UNREVIEWED_CURATED_SUMMARY.sourceType, 'CURATED_SUMMARY');
} finally {
  if (originalUnreviewedFixture) SINGAPORE_STATUTORY_REPOSITORY.TEST_UNREVIEWED_CURATED_SUMMARY = originalUnreviewedFixture;
  else delete SINGAPORE_STATUTORY_REPOSITORY.TEST_UNREVIEWED_CURATED_SUMMARY;
  if (originalMissingReviewFixture) SINGAPORE_STATUTORY_REPOSITORY.TEST_VERIFIED_SUMMARY_WITHOUT_REVIEW_PROVENANCE = originalMissingReviewFixture;
  else delete SINGAPORE_STATUTORY_REPOSITORY.TEST_VERIFIED_SUMMARY_WITHOUT_REVIEW_PROVENANCE;
  buildUnifiedSourceRegistry('2026-09-26');
}

const localWithoutReviewProvenance = verifyEvidenceClaims(
  [makeClaim(localQuote, 'IRAS_LOCAL_VERIFIED')],
  [makeLocalRecord({ isVerbatimText: false, verificationMethod: undefined })],
  { missingFacts: [] }
);
assert.equal(localWithoutReviewProvenance.rejected[0].reason, 'LOCAL_SOURCE_REVIEW_PROVENANCE_MISSING');

const applicationClaim = verifyEvidenceClaims(
  [{ ...makeClaim(localQuote, 'IRAS_LOCAL_VERIFIED'), kind: 'APPLICATION' }],
  [makeLocalRecord()],
  { missingFacts: ['Supplier GST registration status is unknown.'] }
);
assert.equal(applicationClaim.accepted.length, 0, 'Application conclusions are never accepted from source quotation checks.');
assert.equal(applicationClaim.rejected[0].reason, 'APPLICATION_REQUIRES_FACTS_AND_DETERMINISTIC_ENGINE');

const partialConditionRecord = makeLocalRecord({
  sourceText: 'Input tax on customer entertainment may be claimed if the meal has a business purpose and a valid tax invoice is held.'
});
const partialConditionQuote = 'Input tax on customer entertainment may be claimed';
const incompleteCondition = verifyEvidenceClaims(
  [makeClaim(partialConditionQuote, 'IRAS_LOCAL_VERIFIED')],
  [partialConditionRecord],
  { missingFacts: [] }
);
assert.equal(incompleteCondition.rejected[0].reason, 'QUOTE_NOT_WHOLE_SENTENCE_OR_PARAGRAPH');

const qualificationText = 'Input tax may be claimed for qualifying business entertainment. However, special exclusions apply to specified costs.';
const qualificationRecord = makeLocalRecord({ sourceText: qualificationText });
const omittedContinuation = verifyEvidenceClaims(
  [makeClaim('Input tax may be claimed for qualifying business entertainment.', 'IRAS_LOCAL_VERIFIED')],
  [qualificationRecord],
  { missingFacts: [] }
);
assert.equal(omittedContinuation.rejected[0].reason, 'QUOTE_OMITS_ATTACHED_QUALIFICATION');
const completeQualification = verifyEvidenceClaims(
  [makeClaim(qualificationText, 'IRAS_LOCAL_VERIFIED')],
  [qualificationRecord],
  { missingFacts: [] }
);
assert.equal(completeQualification.accepted.length, 1, 'The complete paragraph with its attached exception remains quotable.');

const attachedMultiParagraphText = [
  'Input tax may be claimed for qualifying business entertainment.',
  'However, special exclusions apply to specified costs.',
  'In contrast, ordinary office supplies may be claimed when all normal conditions are met.'
].join('\n\n');
const attachedMultiParagraphRecord = makeLocalRecord({ sourceText: attachedMultiParagraphText });
const incompleteAttachedSpan = verifyEvidenceClaims(
  [makeClaim(attachedMultiParagraphText.split('\n\n').slice(0, 2).join(' '), 'IRAS_LOCAL_VERIFIED')],
  [attachedMultiParagraphRecord],
  { missingFacts: [] }
);
assert.equal(incompleteAttachedSpan.rejected[0].reason, 'QUOTE_OMITS_ATTACHED_QUALIFICATION',
  'A contiguous quote cannot stop before a further recognized attached qualification.');
const completeAttachedSpan = verifyEvidenceClaims(
  [makeClaim(attachedMultiParagraphText.replace(/\n\n/g, ' '), 'IRAS_LOCAL_VERIFIED')],
  [attachedMultiParagraphRecord],
  { missingFacts: [] }
);
assert.equal(completeAttachedSpan.accepted.length, 1,
  'An exact contiguous span including recognized attached paragraphs remains verifiable.');

const overseasServicesRule = 'Services performed completely outside Singapore may only be zero-rated if it falls within the list of services described in section 21(3)(i). Consultancy services do not fall within the list of services.';
const firstOverseasException = '• If your services are directly in connection with land or building located outside Singapore, you may zero-rate your services under section 21(3)(e).';
const secondOverseasException = '• If your services are directly in connection with goods located outside Singapore at the time services are performed, you may zero-rate your services under section 21(3)(f).';
const overseasExceptionRecord = makeLocalRecord({
  sourceText: [overseasServicesRule, 'Exceptions:', firstOverseasException, secondOverseasException].join('\n\n')
});
const overseasRuleWithoutExceptions = verifyEvidenceClaims(
  [makeClaim(overseasServicesRule, 'IRAS_LOCAL_VERIFIED')],
  [overseasExceptionRecord],
  { missingFacts: [] }
);
assert.equal(overseasRuleWithoutExceptions.rejected[0].reason, 'QUOTE_OMITS_ATTACHED_QUALIFICATION',
  'A zero-rating paragraph cannot be quoted without its following Exceptions block.');

const bareExceptionsLabel = verifyEvidenceClaims(
  [makeClaim('Exceptions:', 'IRAS_LOCAL_VERIFIED')],
  [makeLocalRecord({ sourceText: 'Exceptions:' })],
  { missingFacts: [] }
);
assert.equal(bareExceptionsLabel.rejected[0].reason, 'QUOTE_OMITS_ATTACHED_QUALIFICATION',
  'A colon-ended Exceptions label is not independently quotable.');

const ruleWithUnsupportedExceptionsLabel = verifyEvidenceClaims(
  [makeClaim(`${overseasServicesRule} Exceptions:`, 'IRAS_LOCAL_VERIFIED')],
  [makeLocalRecord({ sourceText: `${overseasServicesRule}\n\nExceptions:` })],
  { missingFacts: [] }
);
assert.equal(ruleWithUnsupportedExceptionsLabel.rejected[0].reason, 'QUOTE_OMITS_ATTACHED_QUALIFICATION',
  'A rule plus an Exceptions label without its supporting list remains incomplete.');

const unrelatedIfRule = 'A complete standalone rule requires a valid invoice for each claim.';
const unrelatedIfParagraph = 'If the company requests a separate review, the application checks that request independently.';
const unrelatedIfRecord = makeLocalRecord({ sourceText: `${unrelatedIfRule}\n\n${unrelatedIfParagraph}` });
const unrelatedIfRuleOnly = verifyEvidenceClaims(
  [makeClaim(unrelatedIfRule, 'IRAS_LOCAL_VERIFIED')],
  [unrelatedIfRecord],
  { missingFacts: [] }
);
assert.equal(unrelatedIfRuleOnly.accepted.length, 1,
  'An otherwise complete rule remains standalone when an unrelated later paragraph happens to begin with If.');
const unrelatedIfMerged = verifyEvidenceClaims(
  [makeClaim(`${unrelatedIfRule} ${unrelatedIfParagraph}`, 'IRAS_LOCAL_VERIFIED')],
  [unrelatedIfRecord],
  { missingFacts: [] }
);
assert.equal(unrelatedIfMerged.rejected[0].reason, 'QUOTE_NOT_WHOLE_SENTENCE_OR_PARAGRAPH',
  'A following If paragraph is not merged into an unrelated source rule.');
const unrelatedIfStandalone = verifyEvidenceClaims(
  [makeClaim(unrelatedIfParagraph, 'IRAS_LOCAL_VERIFIED')],
  [unrelatedIfRecord],
  { missingFacts: [] }
);
assert.equal(unrelatedIfStandalone.accepted.length, 1,
  'The following If paragraph remains independently quotable when complete.');

const ellipsisQuote = verifyEvidenceClaims(
  [makeClaim('A GST-registered business may claim input tax... taxable supplies.', 'IRAS_LOCAL_VERIFIED')],
  [makeLocalRecord()],
  { missingFacts: [] }
);
assert.equal(ellipsisQuote.rejected[0].reason, 'ELLIPSIS_NOT_ALLOWED');

const unsafeUrlRecord = makeLocalRecord({
  officialSourceUrl: 'http://www.iras.gov.sg/taxes/gst/input-tax?topic=claiming'
});
const unsafeUrl = verifyEvidenceClaims(
  [makeClaim(localQuote, 'IRAS_LOCAL_VERIFIED')],
  [unsafeUrlRecord],
  { missingFacts: [] }
);
assert.equal(unsafeUrl.rejected[0].reason, 'SOURCE_URL_NOT_APPROVED_OR_CANONICAL');

const incompleteLiveCandidate = verifyEvidenceClaims(
  [makeClaim(liveQuote, 'IRAS_LIVE_CANDIDATE')],
  [makeLiveRecord({ documentHash: undefined })],
  { missingFacts: [] }
);
assert.equal(incompleteLiveCandidate.rejected[0].reason, 'LIVE_SOURCE_CANDIDATE_INCOMPLETE');

const applicationSource = verifyEvidenceClaims(
  [makeClaim(localQuote, 'IRAS_LOCAL_VERIFIED')],
  [makeLocalRecord({ sourceType: 'APPLICATION_RULE', evidenceTier: 'APPLICATION_RULE' })],
  { missingFacts: [] }
);
assert.equal(applicationSource.rejected[0].reason, 'APPLICATION_SOURCE_NOT_ALLOWED');

const sourceMapPointer = verifyEvidenceClaims(
  [makeClaim(localQuote, 'IRAS_LOCAL_VERIFIED')],
  [makeLocalRecord({ recordRole: 'SOURCE_MAP_POINTER', groundingEligible: false })],
  { missingFacts: [] }
);
assert.equal(sourceMapPointer.rejected[0].reason, 'SOURCE_RECORD_NOT_GROUNDING_ELIGIBLE');

console.log('PASS | Exact source quote claim evidence verification');
