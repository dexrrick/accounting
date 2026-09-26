import assert from 'node:assert/strict';
import { evaluateIrasApplications } from '../../src/engine/irasApplicationEvaluator.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { renderIrasEvidenceResponse } from '../../src/services/irasEvidencePolicy.ts';
import { defaultTargetDateResolver } from '../../src/retrieval/targetDateResolver.ts';

const formRule = UNIFIED_SOURCE_REGISTRY.IRAS_FORM_CS_LITE_CRITERIA;
const formConclusion = evaluateIrasApplications(
  'Could a Singapore company file Form C-S (Lite) if it claims a foreign tax credit for YA 2026?',
  [formRule], '2026-01-01'
);
assert.equal(formConclusion.length, 1);
assert.equal(formConclusion[0].sourceRecordId, formRule.id);
assert.equal(formConclusion[0].certainty, 'CONDITIONAL');
assert.match(formConclusion[0].text, /cannot use Form C-S or Form C-S \(Lite\)/);
assert.deepEqual(evaluateIrasApplications(
  'Can our company file Form C-S (Lite) if it does not claim a foreign tax credit?',
  [formRule], '2026-01-01'
), [], 'A negated foreign tax credit claim cannot be treated as a disqualifier.');
assert.deepEqual(evaluateIrasApplications(
  'Can the company claim a foreign tax credit?', [formRule], '2026-01-01'
), [], 'The evaluator does not answer foreign tax credit treatment questions.');
assert.deepEqual(evaluateIrasApplications(
  'Could the company file Form C-S Lite for YA 2024 while claiming a foreign tax credit?',
  [formRule], '2024-01-01'
), [], 'The composite YA 2026 reviewed record is not retroactively applied to an unreviewed return period.');

const pre = UNIFIED_SOURCE_REGISTRY.ITA_SEC13W_EQUITY_DISPOSAL_SAFE_HARBOUR;
const post = UNIFIED_SOURCE_REGISTRY.ITA_SEC13W_EQUITY_DISPOSAL_2026;
const historical = evaluateIrasApplications(
  'Can Section 13W apply to a disposal of ordinary shares on 20 December 2025?',
  [pre, post], '2025-12-20'
);
assert.equal(historical[0]?.sourceRecordId, pre.id);
assert.equal(historical[0]?.certainty, 'CONDITIONAL');
const current = evaluateIrasApplications(
  'Could Section 13W cover a disposal of preference shares on 5 February 2026?',
  [pre, post], '2026-02-05'
);
assert.equal(current[0]?.sourceRecordId, post.id);
assert.equal(current[0]?.certainty, 'CONDITIONAL');
assert.deepEqual(evaluateIrasApplications(
  'Can Section 13W apply to a disposal of preference shares on 20 December 2025?',
  [pre], '2025-12-20'
), [], 'The older ordinary-share rule does not support a preference-share conclusion.');
const twoDateQuery = 'We acquired preference shares on 01/05/2022 and disposed of them on 02/03/2026. Can Section 13W apply?';
const disposalDate = defaultTargetDateResolver.resolveTargetDate(twoDateQuery).targetDate;
assert.equal(disposalDate, '2026-03-02', 'Section 13W selects the disposal date rather than the earlier acquisition date.');
assert.equal(evaluateIrasApplications(twoDateQuery, [pre, post], disposalDate)[0]?.sourceRecordId, post.id);
assert.equal(defaultTargetDateResolver.resolveTargetDate(
  'We acquired ordinary shares on 01/05/2022; can Section 13W apply on disposal?'
).targetDate, undefined, 'An acquisition date alone must not select a Section 13W disposal regime.');
const yearOnlyDisposal = 'We acquired ordinary shares in 2025 and sold them in 2026. Can Section 13W apply?';
assert.equal(defaultTargetDateResolver.resolveTargetDate(yearOnlyDisposal).targetDate, '2026-06-30',
  'A year-only Section 13W question uses the stated disposal year, not the acquisition year.');
assert.equal(evaluateIrasApplications(yearOnlyDisposal, [pre, post],
  defaultTargetDateResolver.resolveTargetDate(yearOnlyDisposal).targetDate)[0]?.sourceRecordId, post.id);
assert.equal(defaultTargetDateResolver.resolveTargetDate(
  'We acquired ordinary shares in 2025; can Section 13W apply on disposal?'
).targetDate, undefined, 'An acquisition year alone cannot select the Section 13W regime.');
assert.equal(defaultTargetDateResolver.resolveTargetDate(
  'Can Section 13W apply for YA 2026?'
).targetDate, undefined, 'A year of assessment without a disposal year cannot select the Section 13W regime.');
assert.equal(defaultTargetDateResolver.resolveTargetDate(
  'We sold ordinary shares on 30/12/2025 and sold another parcel on 02/01/2026. Can Section 13W apply?'
).targetDate, undefined, 'Two stated disposal dates require parcel-specific clarification rather than choosing one regime.');

const formQuery = 'Can we use Form C-S Lite for YA 2026 if we are claiming a foreign tax credit?';
const formClassification = classifyQuestion(formQuery);
const formContext = {
  classification: formClassification,
  userFacts: [formQuery], missingFacts: formClassification.missingFacts,
  evidenceQuality: {
    status: 'LIMITED', eligibleRecords: [formRule], rejectedRecords: [],
    coveredTopicIds: ['iras-cit-returns'], uncoveredTopicIds: [],
    missingFacts: formClassification.missingFacts, targetDate: '2026-01-01', targetDateConfidence: 'HIGH'
  }
};
const renderedForm = renderIrasEvidenceResponse({}, formContext, formQuery, null, 'SFRS_I', 'LOCAL');
assert.match(renderedForm.messageText, /cannot use Form C-S or Form C-S \(Lite\)/);
assert.equal(renderedForm.applicationConclusions[0]?.sourceRecordId, formRule.id);
assert.match(renderedForm.messageText, /\[Related IRAS guidance page\]\(/,
  'An exact verified source-map URL relationship permits a clearly labeled related guidance link.');
assert.match(renderedForm.messageText, /Reviewed local editorial summary \(nonverbatim;/,
  'A curated summary must be presented as editorial content rather than an IRAS quote.');
assert.doesNotMatch(renderedForm.messageText, /> A company/,
  'A curated summary must not be rendered in a quotation block.');
const unverifiedFormRule = {
  ...formRule, urlVerificationStatus: undefined, urlVerifiedDate: undefined,
  urlVerificationMethod: undefined, urlVerificationEvidence: undefined,
  urlVerificationSourceMapId: undefined
};
const unverifiedForm = renderIrasEvidenceResponse({}, {
  ...formContext,
  evidenceQuality: { ...formContext.evidenceQuality, eligibleRecords: [unverifiedFormRule] }
}, formQuery, null, 'SFRS_I', 'LOCAL');
assert.match(unverifiedForm.messageText, /cannot use Form C-S or Form C-S \(Lite\)/);
assert.doesNotMatch(unverifiedForm.messageText, /\[Related IRAS guidance page\]\(/,
  'Unverified URL provenance must not create a link or suppress valid local content.');

console.log('IRAS deterministic application regressions passed.');
