import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TargetDateResolver } from '../../src/retrieval/targetDateResolver.ts';
import { IRAS_MAS_KNOWLEDGE_RULES_20261027B, supportIrasMasKnowledgeRule } from '../../src/retrieval/irasMasKnowledge20261027b.ts';
import { ACRA_MOM_KNOWLEDGE_RULES_20261027B, supportAcraMomKnowledgeRule, selectAcraMomKnowledgeQuotes } from '../../src/retrieval/acraMomKnowledge20261027b.ts';

const resolver = new TargetDateResolver();
const currentDate = '2026-10-28';
const whtRule = IRAS_MAS_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'IRAS_WHT_FILING_DATE');
assert.ok(whtRule);
const whtSource = readFileSync(new URL(`../fixtures/statutoryKnowledge20261027b/${whtRule.fixture}`, import.meta.url), 'utf8');
const whtSubject = 'Withholding tax filing and payment deadline';

for (const [query, date] of [
  ['We paid a non-resident on 1 October 2026. When is WHT filing due?', '2026-10-01'],
  ['If we pay a non-resident on 12 November 2026, when is WHT filing due?', '2026-11-12']
]) {
  assert.equal(resolver.resolveTargetDate(query, currentDate).targetDate, date,
    'The accounting/general date resolver retains its existing date result.');
  assert.equal(resolver.resolveAuthorityEvidenceDate(query, currentDate).source, 'NONE',
    'A transaction date does not select a different WHT legal version.');
  assert.equal(supportIrasMasKnowledgeRule({ authority: 'IRAS', topicId: 'iras-wht-filing-payment-due-date',
    query, subject: whtSubject, sourceText: whtSource, officialUrl: whtRule.officialUrl }), true,
  'The current WHT filing rule supports an ordinary dated payment question.');
}

const mixedWht = 'A contract was signed on 15 March 2025 and we paid a non-resident on 1 October 2026. Which WHT filing deadline applies?';
const transferredPaymentWht = 'We transferred a payment to a non-resident on 14 October 2026. Does that transaction date change the general rule for when WHT must be filed and paid?';
assert.equal(resolver.resolveAuthorityEvidenceDate(transferredPaymentWht, currentDate).source, 'NONE',
  'An ordinary transfer date remains a transaction fact when the user asks when WHT must be filed and paid.');
assert.equal(resolver.resolveTargetDate(transferredPaymentWht, currentDate).targetDate, '2026-10-14');
for (const request of [
  'Back then, when did WHT have to be filed and paid?',
  'At that time, when did WHT have to be filed and paid?',
  'At that date, when did WHT have to be filed and paid?',
  'When did WHT use to be filed and paid under the rule we used to follow?',
  'When must WHT be filed and paid, and what percentage applied?',
  'When must WHT be filed and paid, and what percent applied?'
]) {
  const scoped = `We transferred a payment to a non-resident on 14 October 2026. ${request}`;
  assert.equal(resolver.resolveAuthorityEvidenceDate(scoped, currentDate).targetDate, '2026-10-14',
    'Retrospective wording or a separate percentage question retains the legal date scope.');
}
assert.equal(resolver.resolveAuthorityEvidenceDate(mixedWht, currentDate).targetDate, '2025-03-15',
  'An additional prior-year contract fact retains the original temporal safeguard.');
assert.equal(supportIrasMasKnowledgeRule({ authority: 'IRAS', topicId: 'iras-wht-filing-payment-due-date',
  query: mixedWht, subject: whtSubject, sourceText: whtSource, officialUrl: whtRule.officialUrl }), false);

for (const query of [
  'What WHT filing deadline was in force on 1 January 2026?',
  'Which WHT rate applied to payment on 1 January 2026?'
]) {
  assert.equal(resolver.resolveAuthorityEvidenceDate(query, currentDate).targetDate, '2026-01-01',
    'Legal-version and rate questions retain their explicit target date.');
}
const mixedAuthorityWht = 'We paid a non-resident on 1 October 2026. When are WHT and GST filing deadlines due?';
assert.equal(resolver.resolveAuthorityEvidenceDate(mixedAuthorityWht, currentDate).targetDate, '2026-10-01',
  'A mixed-authority filing question retains the original date resolution.');
const mixedDomainWht = 'We paid a non-resident on 1 October 2026. When are WHT and income tax filing deadlines due?';
assert.equal(resolver.resolveAuthorityEvidenceDate(mixedDomainWht, currentDate).targetDate, '2026-10-01',
  'A mixed IRAS-domain filing question retains the original date resolution.');
const ambiguousSameYearWht = 'A contract was signed on 15 March 2026 and we paid a non-resident on 1 October 2026. When is WHT filing due?';
assert.equal(resolver.resolveAuthorityEvidenceDate(ambiguousSameYearWht, currentDate).targetDate, '2026-03-15',
  'Multiple same-year dates remain ambiguous and retain the original date resolution.');

const prQuestion = 'A worker became a permanent resident on 18 May 2025. When does the second PR contribution year begin?';
assert.equal(resolver.resolveTargetDate(prQuestion, currentDate).targetDate, '2025-05-18');
assert.equal(resolver.resolveAuthorityEvidenceDate(prQuestion, currentDate).source, 'NONE',
  'A PR conversion date is a status fact for a contribution-year question.');
const prObtainedQuestion = 'A worker obtained SPR status on 18 May 2025. When does the second contribution year start?';
assert.equal(resolver.resolveAuthorityEvidenceDate(prObtainedQuestion, currentDate).source, 'NONE',
  'Obtained-SPR-status paraphrase treats the single conversion date as a status fact.');
const mixedPrQuestion = 'A worker obtained SPR status on 18 May 2025 and received a new rate table on 1 January 2026. When does the second contribution year start?';
assert.equal(resolver.resolveAuthorityEvidenceDate(mixedPrQuestion, currentDate).targetDate, '2025-05-18',
  'Multiple dates in a PR query retain the original date resolution.');
const prRateQuestion = 'A worker became a permanent resident on 18 May 2025. What CPF contribution rates applied to wages in 2025?';
assert.equal(resolver.resolveAuthorityEvidenceDate(prRateQuestion, currentDate).targetDate, '2025-05-18',
  'A historical rate request keeps its original target-date treatment.');

const acraRule = ACRA_MOM_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'ACRA_AR_OFFICER_PARTICULARS_20261020');
assert.ok(acraRule);
const acraSource = readFileSync(new URL(`../fixtures/statutoryKnowledge20261027b/${acraRule.fixtureFile}`, import.meta.url), 'utf8');
const acraQuestion = 'Does the October 2026 annual-return change ask whether somebody actually performs the CEO role?';
const acraInput = { authority: 'ACRA', topicId: 'acra-annual-return-officer-particulars', query: acraQuestion,
  subject: 'Annual returns officer particulars and CEO confirmation', sourceText: acraSource, officialUrl: acraRule.officialUrl };
assert.equal(resolver.resolveAuthorityEvidenceDate(acraQuestion, currentDate).source, 'NONE');
assert.equal(supportAcraMomKnowledgeRule(acraInput), true,
  'The source-backed general October 2026 officer-change question is answerable.');
assert.ok(selectAcraMomKnowledgeQuotes(acraInput).length > 0);

const preCommencement = 'Our return was filed on 19 October 2026. Did the officer-confirmation change that commenced on 20 October already govern that filing?';
assert.deepEqual(resolver.resolveAuthorityEvidenceDate(preCommencement, currentDate),
  { confidence: 'LOW', source: 'NONE', isHistorical: false, dateRole: 'DECLARED_COMMENCEMENT' },
  'The declared commencement is discussed without treating the filing date as the law-version target.');
assert.equal(supportAcraMomKnowledgeRule({ ...acraInput, query: preCommencement }), true,
  'The exact commencement source supports the new change not governing the specific pre-commencement filing.');
assert.notEqual(resolver.resolveAuthorityEvidenceDate('What historical officer particulars applied to annual returns in 2024?', currentDate).source, 'NONE');
const specificAcraFiling = 'Our return was filed on 19 October 2026. Did the officer-confirmation change already govern that filing?';
assert.deepEqual(resolver.resolveAuthorityEvidenceDate(specificAcraFiling, currentDate),
  { confidence: 'LOW', source: 'NONE', isHistorical: false, dateRole: 'DECLARED_COMMENCEMENT' },
  'A filing-date comparison uses the declared commencement boundary rather than targeting the event date.');
assert.equal(resolver.resolveAuthorityEvidenceDate('What MAS reporting duties take effect on 1 January 2027?', currentDate).targetDate, '2027-01-01');

console.log('Statutory evidence date-role regressions passed.');
