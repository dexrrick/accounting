import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runSingaporeBenchmark } from '../evaluation/singapore/run.mjs';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { answerSfrsi9KnowledgeQuery } from '../../src/services/sfrsi9AnswerService.ts';

const fixture = JSON.parse(await readFile(new URL('../evaluation/singapore/reviewed-knowledge.json', import.meta.url), 'utf8'));
const packCases = fixture.cases.filter(testCase => testCase.id.startsWith('sfrsi9-'));
assert.equal(packCases.length, 7, 'The reviewed SFRS(I) 9 pack must cover seven acceptance cases.');

const report = await runSingaporeBenchmark({ fixturesData: { ...fixture, cases: packCases } });
assert.equal(report.totalCases, 7);
const sourceSelectionFailures = report.results.filter(result => result.dimensions.sourceRetrieval.status === 'FAIL');
assert.ok(sourceSelectionFailures.length <= 1, 'No new source-selection precision failures may be introduced by the pack.');
if (sourceSelectionFailures.length === 1) {
  const knownFailure = sourceSelectionFailures[0];
  assert.equal(knownFailure.id, 'sfrsi9-debt-hold-collect', 'Only the reviewed hold-to-collect precision gap is currently allowed.');
  const precision = knownFailure.dimensions.sourceRetrieval.checks.find(check => check.mode === 'reviewedSelectionPrecision');
  assert.deepEqual(precision?.forbiddenRetrieved, ['ACRA_VCC_STRUCTURE_AND_ONGOING_COMPLIANCE']);
  assert.deepEqual(precision?.outsideAllowed, []);
}
for (const result of report.results) {
  const sourceClaims = result.dimensions.sourceRetrieval.checks.find(check => check.mode === 'claimSources');
  assert.equal(sourceClaims?.status, 'PASS', `${result.id}: each reviewed source record ID should be retrieved`);
  for (const dimension of ['answerCorrectness', 'citationCorrectness']) {
    assert.equal(result.dimensions[dimension].status, 'PASS', `${result.id}: ${dimension} should pass; ${JSON.stringify(result.dimensions[dimension])}`);
  }
}

for (const id of ['sfrsi9-bond-missing-facts', 'sfrsi9-initial-costs', 'sfrsi9-ecl-12-month-no-amount']) {
  assert.equal(report.results.find(result => result.id === id).dimensions.calculationCorrectness.status, 'PASS', `${id}: journal/calculation oracle must be evaluated and pass`);
}
for (const id of ['sfrsi9-bond-missing-facts', 'sfrsi9-ecl-12-month-no-amount']) {
  assert.equal(report.results.find(result => result.id === id).dimensions.missingFactBehaviour.status, 'PASS', `${id}: required missing-fact oracle must be evaluated and pass`);
}
assert.equal(report.results.find(result => result.id === 'sfrsi9-amendment-effective-2025').dimensions.effectiveDateCorrectness.status, 'PASS',
  'The reviewed amendment effective-date oracle must be evaluated and pass.');

const initialCosts = packCases.find(testCase => testCase.id === 'sfrsi9-initial-costs');
const answer = await processAccountingQuery(initialCosts.question, null, 'SFRS_I');
assert.match(answer.messageText, /Initial carrying amount: SGD 102,000/);
assert.equal(answer.scenarioState.directGroups?.length, 0, 'A measurement advisory must not invent journal lines.');

const incompleteBond = packCases.find(testCase => testCase.id === 'sfrsi9-bond-missing-facts');
const abstention = await processAccountingQuery(incompleteBond.question, null, 'SFRS_I');
assert.equal(abstention.scenarioState.isComplete, false);
assert.equal(abstention.scenarioState.missingFields.length, 2, 'Classification must ask for both business model and cash-flow facts.');
assert.equal(abstention.scenarioState.directGroups?.length, 0);

assert.equal(answerSfrsi9KnowledgeQuery('Under SFRS(I) 9, prepare a journal entry for a bond acquisition.', 'SFRS_I'), undefined,
  'The advisory pack must not intercept journal requests.');
assert.equal(answerSfrsi9KnowledgeQuery('Under SFRS(I) 9, classify our lease liability.', 'SFRS_I'), undefined,
  'Uncovered IFRS 9 questions must fall through rather than receive a guessed answer.');
assert.equal(answerSfrsi9KnowledgeQuery('For a period beginning on 1 January 2026, are the 2024 SFRS(I) 9 amendments mandatory?', 'SFRS_I'), undefined,
  'The 2025 effective-date template must not answer a 2026 reporting-period question.');
assert.equal(answerSfrsi9KnowledgeQuery('Under SFRS(I) 9, our bond has had a significant increase in credit risk. Should we use 12-month ECL?', 'SFRS_I'), undefined,
  'The 12-month ECL conclusion requires an explicit no-significant-increase fact.');
assert.equal(answerSfrsi9KnowledgeQuery('Under SFRS(I) 9, a purchased credit-impaired bond has no significant increase in credit risk. What ECL applies?', 'SFRS_I'), undefined,
  'The general non-POCI answer must not apply to a POCI asset.');
assert.equal(answerSfrsi9KnowledgeQuery('Under SFRS(I) 9, we elected FVOCI for an equity investment on initial recognition. Are gains recycled?', 'SFRS_I'), undefined,
  'The equity FVOCI conclusion requires explicit eligibility facts and irrevocable election.');
assert.equal(answerSfrsi9KnowledgeQuery('Under SFRS(I) 9, this equity investment is not held for trading and is not contingent consideration. The irrevocable election was not made at initial recognition. Are gains recycled?', 'SFRS_I'), undefined,
  'A negated irrevocable FVOCI election must not receive the no-recycling conclusion.');
assert.equal(answerSfrsi9KnowledgeQuery('Under SFRS(I) 9, this equity investment is not held for trading but is held for trading, is not contingent consideration, and at initial recognition irrevocably elected to present subsequent fair value changes in OCI. Are gains recycled?', 'SFRS_I'), undefined,
  'A contradictory affirmative held-for-trading fact makes the equity FVOCI election ineligible.');
assert.equal(answerSfrsi9KnowledgeQuery('Under SFRS(I) 9, this equity investment is not held for trading and is contingent consideration but is not contingent consideration. At initial recognition it was irrevocably elected for FVOCI. Are gains recycled?', 'SFRS_I'), undefined,
  'A contradictory affirmative contingent-consideration fact makes the equity FVOCI election ineligible.');
assert.equal(answerSfrsi9KnowledgeQuery('Under SFRS(I) 9, what is the initial carrying amount of a bond with fair value SGD 100,000 and directly attributable transaction costs SGD 2,000?', 'SFRS_I'), undefined,
  'Initial measurement must not assume the FVTPL and trade-receivable scope exclusions.');
assert.equal(answerSfrsi9KnowledgeQuery('Under SFRS(I) 9, a bond is held to collect but its contractual cash flows are not SPPI. How is it classified?', 'SFRS_I'), undefined,
  'A negated SPPI test must not be treated as satisfied for amortised cost.');
const unqualifiedPrincipalInterest = answerSfrsi9KnowledgeQuery('Under SFRS(I) 9, a bond is held to collect and has payments of principal and interest. How is it classified?', 'SFRS_I');
assert.ok(unqualifiedPrincipalInterest, 'The service may ask for clarification when an SPPI conclusion is not established.');
assert.doesNotMatch(unqualifiedPrincipalInterest.messageText, /measured subsequently at \*\*amortised cost\*\*/i,
  'Bare principal-and-interest wording must not stand in for a positive SPPI assessment.');
assert.equal(answerSfrsi9KnowledgeQuery('Under SFRS(I) 9, a bond is held to collect and its cash flows satisfy SPPI, but the business model is not solely to collect and the facts are contradictory. How is it classified?', 'SFRS_I'), undefined,
  'Conflicting business-model wording must not be resolved by keyword priority.');
const solelyCollectAnswer = answerSfrsi9KnowledgeQuery('Under SFRS(I) 9, the business model is solely to collect, not to collect and sell, and the bond cash flows satisfy SPPI. How is it measured?', 'SFRS_I');
assert.match(solelyCollectAnswer?.messageText || '', /measured subsequently at \*\*amortised cost\*\*/i,
  'A negated collect-and-sell phrase must not trigger debt FVOCI.');
assert.equal(answerSfrsi9KnowledgeQuery('Under SFRS(I) 9, an equity investment is solely to collect and its cash flows satisfy SPPI. How is it classified?', 'SFRS_I'), undefined,
  'Debt classification templates must require explicit debt scope and must not classify equity investments.');
assert.equal(answerSfrsi9KnowledgeQuery('Under SFRS(I) 9, a non-POCI equity investment at amortised cost has no significant increase in credit risk. What is its 12-month ECL?', 'SFRS_I'), undefined,
  'The bond ECL template must not apply to an equity investment.');
assert.equal(answerSfrsi9KnowledgeQuery('Under SFRS(I) 9, this non-POCI equity investment and a bond are measured at amortised cost and have no significant increase in credit risk. What ECL applies?', 'SFRS_I'), undefined,
  'Contradictory equity and debt scope must not pass the debt ECL template based on a bond token alone.');
assert.equal(answerSfrsi9KnowledgeQuery('Under SFRS(I) 9, a not non-POCI bond measured at amortised cost has no significant increase in credit risk. What ECL applies?', 'SFRS_I'), undefined,
  'A negated non-POCI assertion must not satisfy the ECL stage guard.');
assert.equal(answerSfrsi9KnowledgeQuery('Under SFRS(I) 9, a bond measured at amortised cost is not purchased or originated credit-impaired but is POCI. It has not had a significant increase in credit risk. What ECL applies?', 'SFRS_I'), undefined,
  'Contradictory POCI and non-POCI facts must cause abstention.');
assert.equal(answerSfrsi9KnowledgeQuery('Under SFRS(I) 9, a non-POCI bond measured at amortised cost has not had a significant increase in credit risk, but a significant increase in credit risk has occurred. What ECL applies?', 'SFRS_I'), undefined,
  'Contradictory SICR facts must cause abstention.');
const loanEcl = answerSfrsi9KnowledgeQuery('Under SFRS(I) 9, a non-POCI loan measured at amortised cost has not had a significant increase in credit risk since initial recognition. What ECL applies?', 'SFRS_I');
assert.match(loanEcl?.messageText || '', /this non-POCI financial asset/i,
  'The ECL response should use asset-neutral wording when the in-scope instrument is a loan.');
assert.doesNotMatch(loanEcl?.messageText || '', /the bond/i,
  'The ECL response must not relabel an in-scope loan as a bond.');
assert.equal(answerSfrsi9KnowledgeQuery('Under SFRS(I) 9, a non-POCI bond is measured at FVTPL, not amortised cost, and has no significant increase in credit risk. What ECL applies?', 'SFRS_I'), undefined,
  'A FVTPL asset expressly stated not to be at amortised cost must not receive the amortised-cost ECL template.');
assert.equal(answerSfrsi9KnowledgeQuery('Under SFRS(I) 9, a bond is held to collect, its cash flows are payments of principal and interest, and it also has a share-price-linked return. How is it classified?', 'SFRS_I'), undefined,
  'Unqualified principal-and-interest wording or extra non-basic features must not trigger amortised cost.');
assert.equal(answerSfrsi9KnowledgeQuery('Under SFRS(I) 9, a bond not measured at FVTPL but is covered by the trade-receivable exception has fair value SGD 100,000 and directly attributable transaction costs SGD 2,000. What is initial amount?', 'SFRS_I'), undefined,
  'An asset covered by the trade-receivable exception must not receive the general transaction-cost answer.');
assert.equal(answerSfrsi9KnowledgeQuery('Under SFRS(I) 9, a bond not measured at FVTPL or covered by the trade-receivable exception has fair value SGD 100,000 and transaction costs SGD 2,000. What is initial amount?', 'SFRS_I'), undefined,
  'Unspecified transaction-cost attribution must not be assumed.');
assert.equal(answerSfrsi9KnowledgeQuery('Under SFRS(I) 9, what is the initial carrying amount of a bond investment not measured at FVTPL or covered by the trade-receivable exception, if its fair value is SGD 100,000 and transaction costs are SGD 2,000, which are not directly attributable?', 'SFRS_I'), undefined,
  'Transaction costs explicitly stated not to be directly attributable must not be added to initial measurement.');
assert.equal(answerSfrsi9KnowledgeQuery('Under SFRS(I) 9, what is the initial carrying amount of a bond investment not measured at FVTPL or covered by the trade-receivable exception, if its fair value is SGD 10,00 and directly attributable transaction costs are SGD 2,00?', 'SFRS_I'), undefined,
  'Malformed thousands grouping must not be silently normalized into valid monetary inputs.');
assert.equal(answerSfrsi9KnowledgeQuery('Under SFRS(I) 9, a bond not measured at FVTPL or covered by the trade-receivable exception has fair value SGD 100.005 and directly attributable transaction costs SGD 2,000. What is initial amount?', 'SFRS_I'), undefined,
  'Amounts with unsupported fractional precision must not be silently truncated to cents.');

console.log(sourceSelectionFailures.length
  ? 'SFRS(I) 9 answer-path checks passed; the reviewed hold-to-collect retrieval-precision gate remains open.'
  : 'SFRS(I) 9 answer-path and reviewed retrieval-precision checks passed.');
