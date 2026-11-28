import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JournalTable } from '../../src/components/JournalTable.tsx';
import { parseAccountingQuery } from '../../src/engine/scenarioParser.ts';
import { calculateDoubleEntries } from '../../src/engine/accountingEngine.ts';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { updateCommittedJournalScenario } from '../../src/services/committedJournal.ts';
import { getExchangeRate } from '../../src/services/frankfurterService.ts';
import { buildAnalysisConversationHistory } from '../../src/services/conversationBoundary.ts';
import {
  interpretSemanticQuestion,
  SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA
} from '../../src/services/semanticQuestionUnderstanding.ts';

let unexpectedExternalRequests = 0;
const originalPlatformFetch = globalThis.fetch;
globalThis.fetch = async input => {
  const { hostname, pathname } = new URL(typeof input === 'string' ? input : input.url);
  if (pathname === '/robots.txt' && ['www.ifrs.org', 'asc.acra.gov.sg'].includes(hostname)) {
    // An acquisition without an explicit journal request may discover standards evidence.
    return new Response(null, { status: 404 });
  }
  unexpectedExternalRequests += 1;
  throw new Error('Unexpected external request in FX integrity regression.');
};

const missingDisposalRateQuery =
  'A company primary currency is SGD. It acquired USD 1,000 of Apple shares on 13/11/2099 at USD/SGD spot rate of 1.30, then sold 300 shares for USD 1,100 on 15/12/2099. What are the double entries?';
const explicitRatesQuery =
  'A company primary currency is SGD. It acquired USD 1,000 of Apple shares on 13/11/2099 at USD/SGD spot rate of 1.30, then sold 300 shares for USD 1,100 on 15/12/2099 at USD/SGD spot rate of 1.31. What are the double entries?';

const explicitDirectionQuery =
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2025 at USD/SGD spot rate of 1.30, meaning one USD equals SGD 1.30.';
const rateReply = 'The disposal USD/SGD spot rate is 1.31.';
const acquisitionAnswer = await processAccountingQuery(explicitDirectionQuery, null, 'SFRS_I', undefined);
const conventionalUsdSgdAnswer = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099 at USD/SGD spot rate of 1.30. Prepare the journal entries.',
  null, 'SFRS_I', undefined
);
const conventionalSgdUsdAnswer = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099 at SGD/USD spot rate of 0.80. Prepare the journal entries.',
  null, 'SFRS_I', undefined
);
const unitOnlyAdjacentAnswer = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099. One USD equals SGD 1.30. Prepare the journal entries.',
  null, 'SFRS_I', undefined
);
const inlineUnitOnlyAnswer = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099 at SGD 1.30 per USD. Prepare the journal entries.',
  null, 'SFRS_I', undefined
);
const explicitUnitsOverridePairLabel = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099 at SGD/USD spot rate of 1.30, meaning one USD equals SGD 1.30.',
  null, 'SFRS_I', undefined
);
const explicitUnitsMatchReciprocalPair = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099 at SGD/USD spot rate of 0.7692307692, meaning one USD equals SGD 1.30.',
  null, 'SFRS_I', undefined
);
const explicitUnitsMatchOppositeQuote = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099 at USD/SGD spot rate of 0.80, meaning one SGD equals USD 0.80.',
  null, 'SFRS_I', undefined
);
const explicitUnitsClarifyUnlabelledQuote = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099 at spot rate of 1.30, meaning one USD equals SGD 1.30.',
  null, 'SFRS_I', undefined
);
const eventNamedAdjacentQuote = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099. The acquisition USD/SGD spot rate is 1.30.',
  null, 'SFRS_I', undefined
);
const eventNamedMatchingDateQuote = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2025. The acquisition USD/SGD spot rate is 1.30 on 13/11/2025.',
  null, 'SFRS_I', undefined
);
const parentheticalEventDateAfterQuote = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares at (USD/SGD spot rate of 1.30) on 13/11/2025.',
  null, 'SFRS_I', undefined
);
const parentheticalEventDateWithDatedQuote = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares at (USD/SGD spot rate of 1.30 dated 14/11/2025) on 13/11/2025.',
  null, 'SFRS_I', undefined
);
const ambiguousRateSuffixCases = [
  {
    query: 'We acquired USD 1,000 of Apple shares at USD/SGD spot rate of 1.30 dated 14/11/2025.',
    dateField: 'purchaseDate',
    rateField: 'purchaseFxRate'
  },
  {
    query: 'We acquired USD 1,000 of Apple shares with a USD/SGD spot rate of 1.30 on 14/11/2025.',
    dateField: 'purchaseDate',
    rateField: 'purchaseFxRate'
  },
  {
    query: 'We acquired USD 1,000 of Apple shares at USD/SGD spot rate of 1.30, dated 14/11/2025.',
    dateField: 'purchaseDate',
    rateField: 'purchaseFxRate'
  },
  {
    query: 'We acquired USD 1,000 of Apple shares at USD/SGD spot rate of 1.30 on 14/11/2025.',
    dateField: 'purchaseDate',
    rateField: 'purchaseFxRate'
  },
  {
    query: 'We acquired USD 1,000 of Apple shares at the USD/SGD spot rate on 14/11/2025.',
    dateField: 'purchaseDate',
    rateField: 'purchaseFxRate'
  },
  {
    query: 'We acquired USD 1,000 of Apple shares at the USD/SGD spot rate dated 16/11/2025 of 1.30.',
    dateField: 'purchaseDate',
    rateField: 'purchaseFxRate'
  },
  {
    query: 'Our functional currency is SGD. We acquired USD 1,000 of Apple shares using a conversion rate of 1.30 dated 21/11/2025.',
    dateField: 'purchaseDate',
    rateField: 'purchaseFxRate'
  },
  {
    query: 'Our functional currency is SGD. We acquired USD 1,000 of Apple shares using the quoted rate dated 22/11/2025.',
    dateField: 'purchaseDate',
    rateField: 'purchaseFxRate'
  },
  {
    query: 'Our functional currency is SGD. We acquired USD 1,000 of Apple shares using a rate of 1.30 dated 23/11/2025.',
    dateField: 'purchaseDate',
    rateField: 'purchaseFxRate'
  },
  {
    query: 'Our functional currency is SGD. We acquired USD 1,000 of Apple shares using USD/SGD dated 24/11/2025.',
    dateField: 'purchaseDate',
    rateField: 'purchaseFxRate'
  },
  {
    query: 'We acquired USD 1,000 of Apple shares on 13/11/2025 at USD/SGD spot rate of 1.30. We sold 300 shares for USD 1,100 at USD/SGD spot rate of 1.32 dated 16/12/2025.',
    dateField: 'saleDate',
    rateField: 'saleFxRate'
  },
  {
    query: 'We acquired USD 1,000 of Apple shares on 13/11/2025 at USD/SGD spot rate of 1.30. We sold 300 shares for USD 1,100 at the USD/SGD spot rate dated 16/12/2025 of 1.32.',
    dateField: 'saleDate',
    rateField: 'saleFxRate'
  }
];
const externalRequestsBeforeAmbiguousRateSuffixes = unexpectedExternalRequests;
for (const testCase of ambiguousRateSuffixCases) {
  const answer = await processAccountingQuery(testCase.query, null, 'SFRS_I', undefined);
  assert.equal(answer.scenarioState[testCase.dateField], undefined);
  assert.equal(answer.scenarioState[testCase.rateField], undefined);
  assert.equal(answer.scenarioState.isComplete, false);
  assert.equal(answer.scenarioState.directGroups?.length, 0);
  assert.ok(answer.clarifications?.some(field => field.fieldKey === testCase.dateField));
  assert.ok(answer.scenarioState.missingFields.some(field => field.fieldKey === testCase.dateField));
  assert.equal(updateCommittedJournalScenario(null, answer.scenarioState, 'SFRS_I'), null);
}
assert.equal(unexpectedExternalRequests, externalRequestsBeforeAmbiguousRateSuffixes);
const eventNamedMismatchedDateQuote = await processAccountingQuery(
  'We acquired USD 1,000 of Apple shares on 13/11/2025. The acquisition USD/SGD spot rate is 1.30 on 14/11/2025.',
  null, 'SFRS_I', undefined
);
const lowercaseRateDateWithoutTransactionDate = await processAccountingQuery(
  'We acquired USD 1,000 of Apple shares. the acquisition USD/SGD spot rate is 1.30 on 14/11/2025.',
  null, 'SFRS_I', undefined
);
const leadingTransactionDateMismatchedQuote = await processAccountingQuery(
  'On 13/11/2025, I acquired USD 1,000 of Apple shares at USD/SGD spot rate of 1.30 on 14/11/2025.',
  null, 'SFRS_I', undefined
);
const datedLeadingTransactionMismatch = await processAccountingQuery(
  'Dated 13/11/2025, we acquired USD 1,000 of Apple shares at USD/SGD spot rate of 1.30 on 14/11/2025.',
  null, 'SFRS_I', undefined
);
const disposalNamedMismatchedDateQuote = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2025 at USD/SGD spot rate of 1.30, then sold 300 shares for USD 1,100 on 15/12/2025. The disposal USD/SGD spot rate is 1.32 on 16/12/2025.',
  null, 'SFRS_I', undefined
);
const leadingDisposalDateMismatch = await processAccountingQuery(
  'We acquired USD 1,000 of Apple shares on 13/11/2025 at USD/SGD spot rate of 1.30. On 15/12/2025, we sold 300 shares for USD 1,100 at USD/SGD spot rate of 1.32 on 16/12/2025.',
  null, 'SFRS_I', undefined
);
const leadingDateActorCases = [
  {
    query: 'On 13/11/2025, our company acquired USD 1,000 of Apple shares at USD/SGD spot rate of 1.30 on 14/11/2025.',
    reply: 'The acquisition USD/SGD spot rate is 1.30.',
    dateField: 'purchaseDate',
    rateField: 'purchaseFxRate',
    eventId: 'grp-purchase',
    date: '13/11/2025'
  },
  {
    query: 'We acquired USD 1,000 of Apple shares on 13/11/2025 at USD/SGD spot rate of 1.30. On 15/12/2025, our company sold 300 shares for USD 1,100 at USD/SGD spot rate of 1.32 on 16/12/2025.',
    reply: 'The disposal USD/SGD spot rate is 1.32.',
    dateField: 'saleDate',
    rateField: 'saleFxRate',
    eventId: 'grp-disposal',
    date: '15/12/2025'
  }
];
for (const testCase of leadingDateActorCases) {
  const pending = await processAccountingQuery(testCase.query, null, 'SFRS_I', undefined);
  assert.equal(pending.scenarioState[testCase.dateField], testCase.date);
  assert.equal(pending.scenarioState[testCase.rateField], undefined);
  assert.equal(pending.scenarioState.isComplete, false);
  assert.equal(pending.scenarioState.directGroups?.length, 0);
  const corrected = await parseAccountingQuery(testCase.reply, pending.scenarioState);
  assert.equal(corrected.isComplete, true);
  assert.equal(corrected[testCase.dateField], testCase.date);
  assert.equal(corrected.directGroups?.find(group => group.id === testCase.eventId)?.eventDate, testCase.date);
}
const correctedLeadingAcquisitionRate = await parseAccountingQuery(
  'The acquisition USD/SGD spot rate is 1.30.', leadingTransactionDateMismatchedQuote.scenarioState
);
const correctedLeadingDisposalRate = await parseAccountingQuery(
  'The disposal USD/SGD spot rate is 1.32.', leadingDisposalDateMismatch.scenarioState
);
const rateReplyWithoutTransactionDate = await parseAccountingQuery(
  'The acquisition USD/SGD spot rate is 1.30.', lowercaseRateDateWithoutTransactionDate.scenarioState
);
const eventRateWithArticle = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099 at the USD/SGD spot rate of 1.30.',
  null, 'SFRS_I', undefined
);
const preciseRateAnswer = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099 at SGD 1.3004 per USD.',
  null, 'SFRS_I', undefined
);
const budgetRateInEventSentence = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099 while our budget assumed SGD 1.30 per USD.',
  null, 'SFRS_I', undefined
);
const conflictingUnitQuotes = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2025. One USD equals SGD 1.30 and one USD equals SGD 1.40.',
  null, 'SFRS_I', undefined
);
const conflictingLabelAnswer = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2025 at SGD/USD spot rate of 0.80, meaning one USD equals SGD 1.30.',
  null, 'SFRS_I', undefined
);
const conflictingQuoteAfterDate = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2025 at USD/SGD spot rate of 1.30, meaning one USD equals SGD 1.40.',
  null, 'SFRS_I', undefined
);
const conflictingPairLabels = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2025 at USD/SGD spot rate in EUR/GBP of 1.30.',
  null, 'SFRS_I', undefined
);
const connectedPairRateConflict = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2025 at USD/SGD spot rate of 1.30, and at USD/SGD spot rate of 1.40.',
  null, 'SFRS_I', undefined
);
const connectedUnitRateConflict = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2025 at SGD 1.30 per USD (USD/SGD spot rate of 1.40).',
  null, 'SFRS_I', undefined
);
const acquisitionBudgetPreparedRate = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099, the budget was prepared using SGD 1.30 per USD.',
  null, 'SFRS_I', undefined
);
const acquisitionBudgetAssumedPairRate = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099, and the budget assumed a USD/SGD spot rate of 1.30.',
  null, 'SFRS_I', undefined
);
const retrospectiveBudgetQualifier = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099 at USD/SGD spot rate of 1.30, but that was only the budget rate. Prepare the journal entries.',
  null, 'SFRS_I', undefined
);
const budgetingPurposeQualifier = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099 at USD/SGD spot rate of 1.30 for budgeting purposes. Prepare the journal entries.',
  null, 'SFRS_I', undefined
);
const laterBudgetQualifier = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099 at USD/SGD spot rate of 1.30. That was the figure in the budget.',
  null, 'SFRS_I', undefined
);
const earlierBudgetScope = await processAccountingQuery(
  'Our functional currency is SGD. This is a budget illustration. We acquired USD 1,000 of Apple shares on 13/11/2099 at USD/SGD spot rate of 1.30.',
  null, 'SFRS_I', undefined
);
const conditionalAcquisitionRate = await processAccountingQuery(
  'Our functional currency is SGD. If we acquired USD 1,000 of Apple shares on 13/11/2099 at USD/SGD spot rate of 1.30, what would the journal entries be?',
  null, 'SFRS_I', undefined
);
const disposalBudgetPurpose = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099 at USD/SGD spot rate of 1.30, then sold 300 shares for USD 1,100 on 15/12/2099 at USD/SGD spot rate of 1.32 for budgeting purposes. Prepare the journal entries.',
  null, 'SFRS_I', undefined
);
const acquisitionNegatedRate = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099, not at USD/SGD spot rate of 1.30.',
  null, 'SFRS_I', undefined
);
const acquisitionPlannedRate = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099, we planned using SGD 1.30 per USD.',
  null, 'SFRS_I', undefined
);
const acquisitionCommaRate = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099, at USD/SGD spot rate of 1.30.',
  null, 'SFRS_I', undefined
);
const acquisitionParentheticalRate = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099 (USD/SGD spot rate of 1.30).',
  null, 'SFRS_I', undefined
);
const rateBeforeAcquisitionEvent = await processAccountingQuery(
  'One USD equals SGD 1.30. Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099.',
  null, 'SFRS_I', undefined
);
const repeatedAcquisitionEvents = await processAccountingQuery(
  'A company primary currency is SGD, it acquired USD 1,000 of Apple shares on 13/11/2099. It acquired USD 2,000 of Tesla shares on 14/11/2099 at USD/SGD spot rate of 1.30. Prepare the journal entries.',
  null, 'SFRS_I', undefined
);
const repeatedAcquisitionRateReply = await processAccountingQuery(
  '1.31', repeatedAcquisitionEvents.scenarioState, 'SFRS_I', undefined,
  undefined, [
    { id: 'repeat-acquisition-initial', sender: 'user', text: repeatedAcquisitionEvents.scenarioState.rawQuery, timestamp: '' },
    { id: 'repeat-acquisition-clarification', sender: 'assistant', text: repeatedAcquisitionEvents.messageText, timestamp: '' },
    { id: 'repeat-acquisition-rate', sender: 'user', text: '1.31', timestamp: '' }
  ]
);
const acquisitionCorrectedAfterRejectedRate = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099, not using SGD 1.30 per USD but at USD/SGD spot rate of 1.28.',
  null, 'SFRS_I', undefined
);
const disposalNegatedRate = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099 at USD/SGD spot rate of 1.30, then sold 300 shares for USD 1,100 on 15/12/2099, not actually at USD/SGD spot rate of 1.32.',
  null, 'SFRS_I', undefined
);
const acquisitionInlineBudgetRate = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099 at USD/SGD spot rate of 1.30 for budgeting only.',
  null, 'SFRS_I', undefined
);
const disposalNamedUnusedRate = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099 at USD/SGD spot rate of 1.30, then sold 300 shares for USD 1,100 on 15/12/2099. The disposal USD/SGD spot rate of 1.32 was not used.',
  null, 'SFRS_I', undefined
);
const rejectedRateDescriptions = [
  '. The acquisition USD/SGD spot rate of 1.30 was rejected.',
  '. The acquisition USD/SGD spot rate of 1.30 was not used.',
  '. The acquisition USD/SGD spot rate is 1.30 for budgeting only.',
  ', not actually at USD/SGD spot rate of 1.30.',
  ', at USD/SGD spot rate of 1.30, which was rejected.',
  ', at USD/SGD spot rate of 1.30 (rejected).',
  ', only for the budget using SGD 1.30 per USD.',
  ', the budget was prepared, using SGD 1.30 per USD.',
  ', the budget was prepared, at USD/SGD spot rate of 1.30.',
  ' as opposed to using SGD 1.30 per USD.',
  ' as opposed to using a USD/SGD spot rate of 1.30.',
  ', at USD/SGD spot rate of 1.30 for budget purposes only.'
];
const rejectedRateAnswers = [];
for (const description of rejectedRateDescriptions) {
  rejectedRateAnswers.push(await processAccountingQuery(
    `Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099${description}`,
    null, 'SFRS_I', undefined
  ));
}
const actualRateWithRejectedComparison = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099 at USD/SGD spot rate of 1.28, not at USD/SGD spot rate of 1.30.',
  null, 'SFRS_I', undefined
);
const actualRateWithOpposedComparison = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099 at USD/SGD spot rate of 1.28 as opposed to using SGD 1.30 per USD.',
  null, 'SFRS_I', undefined
);
const unlabelledRateAnswer = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2025 at spot rate of 1.30. Prepare the journal entries.',
  null, 'SFRS_I', undefined
);
const budgetRateAnswer = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099. the budget rate is one USD equals SGD 1.30. Prepare the journal entries.',
  null, 'SFRS_I', undefined
);
const pendingAnswer = await processAccountingQuery(missingDisposalRateQuery, null, 'SFRS_I', undefined);
const resumedAnswer = await processAccountingQuery(rateReply, pendingAnswer.scenarioState, 'SFRS_I', undefined, undefined, [
  { id: 'user-initial', sender: 'user', text: missingDisposalRateQuery, timestamp: '' },
  { id: 'assistant-clarification', sender: 'assistant', text: pendingAnswer.messageText, timestamp: '' },
  { id: 'user-rate', sender: 'user', text: rateReply, timestamp: '' }
]);

assert.equal(acquisitionAnswer.scenarioState.purchaseFxRate, 1.30);
const acquisition = acquisitionAnswer.scenarioState.directGroups?.find(group => group.id === 'grp-purchase');
assert.equal(acquisition?.eventDate, '13/11/2025');
assert.deepEqual(acquisition?.lines.map(line => [line.accountCode, line.debit, line.credit]),
  [['1210', 1300, 0], ['1010', 0, 1300]]);
assert.equal(updateCommittedJournalScenario(null, acquisitionAnswer.scenarioState, 'SFRS_I')?.purchaseFxRate, 1.30);
for (const [answer, expectedRate, expectedSgd] of [
  [conventionalUsdSgdAnswer, 1.30, 1300],
  [conventionalSgdUsdAnswer, 1.25, 1250],
  [unitOnlyAdjacentAnswer, 1.30, 1300],
  [inlineUnitOnlyAnswer, 1.30, 1300],
  [explicitUnitsOverridePairLabel, 1.30, 1300],
  [explicitUnitsMatchReciprocalPair, 1.30, 1300],
  [explicitUnitsMatchOppositeQuote, 1.25, 1250],
  [explicitUnitsClarifyUnlabelledQuote, 1.30, 1300],
  [eventNamedAdjacentQuote, 1.30, 1300],
  [eventNamedMatchingDateQuote, 1.30, 1300],
  [eventRateWithArticle, 1.30, 1300],
  [acquisitionCommaRate, 1.30, 1300],
  [acquisitionParentheticalRate, 1.30, 1300],
  [preciseRateAnswer, 1.3004, 1300.4]
]) {
  assert.equal(answer.scenarioState.isComplete, true);
  assert.equal(answer.scenarioState.purchaseFxRate, expectedRate);
  const purchase = answer.scenarioState.directGroups?.find(group => group.id === 'grp-purchase');
  assert.equal(purchase?.totalDebit, expectedSgd);
  assert.equal(purchase?.totalCredit, expectedSgd);
  assert.equal(purchase?.isBalanced, true);
}
assert.match(preciseRateAnswer.scenarioState.directGroups?.[0].summary, /1 USD = SGD 1\.3004/);
assert.match(explicitUnitsMatchReciprocalPair.scenarioState.directGroups?.[0].summary, /1 USD = SGD 1\.30/);
assert.equal(parentheticalEventDateAfterQuote.scenarioState.purchaseDate, '13/11/2025');
assert.equal(parentheticalEventDateAfterQuote.scenarioState.isComplete, false);
assert.equal(parentheticalEventDateAfterQuote.scenarioState.directGroups?.length, 0);
assert.ok(parentheticalEventDateAfterQuote.scenarioState.missingFields.some(field => field.fieldKey === 'purchaseFxRate'));
assert.equal(parentheticalEventDateWithDatedQuote.scenarioState.purchaseDate, '13/11/2025');
assert.equal(parentheticalEventDateWithDatedQuote.scenarioState.isComplete, false);
assert.equal(parentheticalEventDateWithDatedQuote.scenarioState.directGroups?.length, 0);
assert.ok(parentheticalEventDateWithDatedQuote.scenarioState.missingFields.some(field => field.fieldKey === 'purchaseFxRate'));
for (const answer of [
  conflictingUnitQuotes, conflictingLabelAnswer, conflictingQuoteAfterDate, conflictingPairLabels,
  connectedPairRateConflict, connectedUnitRateConflict,
  unlabelledRateAnswer, budgetRateAnswer, budgetRateInEventSentence,
  acquisitionBudgetPreparedRate, acquisitionBudgetAssumedPairRate, acquisitionNegatedRate, acquisitionPlannedRate,
  acquisitionCorrectedAfterRejectedRate, actualRateWithRejectedComparison, actualRateWithOpposedComparison,
  retrospectiveBudgetQualifier, budgetingPurposeQualifier, laterBudgetQualifier, earlierBudgetScope,
  conditionalAcquisitionRate,
  eventNamedMismatchedDateQuote,
  leadingTransactionDateMismatchedQuote,
  datedLeadingTransactionMismatch,
  acquisitionInlineBudgetRate, ...rejectedRateAnswers
]) {
  assert.equal(answer.scenarioState.isComplete, false);
  assert.ok(answer.clarifications?.some(field => field.fieldKey === 'purchaseFxRate'));
  assert.equal(answer.scenarioState.directGroups?.length, 0);
}
assert.ok(eventNamedMismatchedDateQuote.scenarioState.missingFields.some(field =>
  field.fieldKey === 'purchaseFxRate' && /date does not match.*13\/11\/2025/i.test(field.prompt)
));
assert.equal(eventNamedMismatchedDateQuote.scenarioState.purchaseFxRate, undefined);
assert.equal(lowercaseRateDateWithoutTransactionDate.scenarioState.purchaseDate, undefined);
assert.equal(lowercaseRateDateWithoutTransactionDate.scenarioState.purchaseFxRate, undefined);
assert.ok(lowercaseRateDateWithoutTransactionDate.scenarioState.missingFields.some(field => field.fieldKey === 'purchaseDate'));
assert.equal(rateReplyWithoutTransactionDate.isComplete, false);
assert.equal(rateReplyWithoutTransactionDate.directGroups?.length, 0);
assert.ok(rateReplyWithoutTransactionDate.missingFields.some(field => field.fieldKey === 'purchaseDate'));
assert.equal(leadingTransactionDateMismatchedQuote.scenarioState.purchaseDate, '13/11/2025');
assert.equal(leadingTransactionDateMismatchedQuote.scenarioState.purchaseFxRate, undefined);
assert.ok(leadingTransactionDateMismatchedQuote.scenarioState.missingFields.some(field =>
  field.fieldKey === 'purchaseFxRate' && /date does not match.*13\/11\/2025/i.test(field.prompt)
));
assert.equal(datedLeadingTransactionMismatch.scenarioState.purchaseDate, '13/11/2025');
assert.equal(datedLeadingTransactionMismatch.scenarioState.purchaseFxRate, undefined);
assert.equal(correctedLeadingAcquisitionRate.isComplete, true);
assert.equal(correctedLeadingAcquisitionRate.purchaseDate, '13/11/2025');
assert.equal(correctedLeadingAcquisitionRate.purchaseFxRate, 1.30);
assert.equal(correctedLeadingAcquisitionRate.directGroups?.[0].eventDate, '13/11/2025');
assert.ok(disposalNamedMismatchedDateQuote.scenarioState.missingFields.some(field =>
  field.fieldKey === 'saleFxRate' && /date does not match.*15\/12\/2025/i.test(field.prompt)
));
assert.equal(disposalNamedMismatchedDateQuote.scenarioState.saleFxRate, undefined);
assert.equal(disposalNamedMismatchedDateQuote.scenarioState.isComplete, false);
assert.equal(disposalNamedMismatchedDateQuote.scenarioState.directGroups?.length, 0);
assert.equal(leadingDisposalDateMismatch.scenarioState.saleDate, '15/12/2025');
assert.equal(leadingDisposalDateMismatch.scenarioState.saleFxRate, undefined);
assert.ok(leadingDisposalDateMismatch.scenarioState.missingFields.some(field =>
  field.fieldKey === 'saleFxRate' && /date does not match.*15\/12\/2025/i.test(field.prompt)
));
assert.equal(leadingDisposalDateMismatch.scenarioState.isComplete, false);
assert.equal(leadingDisposalDateMismatch.scenarioState.directGroups?.length, 0);
assert.equal(correctedLeadingDisposalRate.isComplete, true);
assert.equal(correctedLeadingDisposalRate.saleDate, '15/12/2025');
assert.equal(correctedLeadingDisposalRate.saleFxRate, 1.32);
assert.equal(correctedLeadingDisposalRate.directGroups?.find(group => group.id === 'grp-disposal')?.eventDate, '15/12/2025');
assert.equal(rateBeforeAcquisitionEvent.scenarioState.isComplete, false,
  'A standalone unit equation preceding the transaction must not be assigned to it.');
assert.equal(rateBeforeAcquisitionEvent.scenarioState.directGroups?.length, 0);
assert.ok(rateBeforeAcquisitionEvent.scenarioState.missingFields.some(field => field.fieldKey === 'purchaseFxRate'));
assert.equal(repeatedAcquisitionEvents.scenarioState.isComplete, false,
  'A rate attached to the second acquisition must not be assigned to the first.');
assert.equal(repeatedAcquisitionEvents.scenarioState.directGroups?.length, 0);
assert.ok(repeatedAcquisitionEvents.scenarioState.missingFields.some(field => field.fieldKey === 'purchaseEventScope'));
assert.match(repeatedAcquisitionEvents.clarifications[0].prompt, /multiple acquisition events/i);
assert.equal(repeatedAcquisitionRateReply.scenarioState.isComplete, false,
  'A bare rate reply cannot resolve which of multiple acquisitions it belongs to.');
assert.equal(repeatedAcquisitionRateReply.scenarioState.directGroups?.length, 0);
assert.equal(disposalNegatedRate.scenarioState.isComplete, false);
assert.ok(disposalNegatedRate.clarifications?.some(field => field.fieldKey === 'saleFxRate'));
assert.equal(disposalNegatedRate.scenarioState.directGroups?.length, 0);
assert.equal(disposalNamedUnusedRate.scenarioState.isComplete, false);
assert.ok(disposalNamedUnusedRate.clarifications?.some(field => field.fieldKey === 'saleFxRate'));
assert.equal(disposalNamedUnusedRate.scenarioState.directGroups?.length, 0);
assert.equal(disposalBudgetPurpose.scenarioState.isComplete, false);
assert.ok(disposalBudgetPurpose.clarifications?.some(field => field.fieldKey === 'saleFxRate'));
assert.equal(disposalBudgetPurpose.scenarioState.directGroups?.length, 0);
assert.equal(actualRateWithRejectedComparison.scenarioState.isComplete, false);
assert.ok(actualRateWithRejectedComparison.clarifications?.some(field => field.fieldKey === 'purchaseFxRate'));
assert.equal(actualRateWithRejectedComparison.scenarioState.directGroups?.length, 0);

const resumedScenario = resumedAnswer.scenarioState;
assert.equal(resumedScenario.scenarioType, 'EQUITY_INVESTMENT_FX');
assert.equal(resumedScenario.isComplete, true);
assert.equal(resumedScenario.purchaseDate, '13/11/2099');
assert.equal(resumedScenario.purchaseAmountForeign, 1000);
assert.equal(resumedScenario.purchaseFxRate, 1.30);
assert.equal(resumedScenario.saleDate, '15/12/2099');
assert.equal(resumedScenario.saleAmountForeign, 1100);
assert.equal(resumedScenario.saleFxRate, 1.31);
assert.equal(resumedScenario.directGroups?.find(group => group.id === 'grp-disposal')?.lines[0].debit, 1441);
assert.ok(resumedScenario.directGroups?.every(group => group.isBalanced && group.totalDebit === group.totalCredit));
assert.equal(updateCommittedJournalScenario(null, resumedScenario, 'SFRS_I')?.saleFxRate, 1.31);
const rateWithUnits = await parseAccountingQuery('It was 1.31 SGD per USD.', pendingAnswer.scenarioState);
assert.equal(rateWithUnits.isComplete, true);
assert.equal(rateWithUnits.saleFxRate, 1.31);
const ambiguousRate = await parseAccountingQuery('1.31', pendingAnswer.scenarioState);
assert.equal(ambiguousRate.isComplete, false);
assert.equal(ambiguousRate.purchaseAmountForeign, 1000);
assert.match(ambiguousRate.missingFields[0].prompt, /SGD for one USD/);
const euroPending = await parseAccountingQuery(
  'Our functional currency is EUR. We acquired USD 1,000 of Apple shares on 13/11/2099. Prepare the journal entries.'
);
const wrongCurrency = await parseAccountingQuery('One USD equals SGD 1.31.', euroPending);
assert.equal(wrongCurrency.isComplete, false);
assert.equal(wrongCurrency.purchaseAmountForeign, 1000);
assert.match(wrongCurrency.missingFields[0].prompt, /EUR for one USD/);
assert.equal(updateCommittedJournalScenario(null, wrongCurrency, 'SFRS_I'), null);
const euroAnswer = await processAccountingQuery('One USD equals EUR 0.91.', euroPending, 'SFRS_I', undefined);
const euroJournal = euroAnswer.scenarioState.directGroups?.[0];
assert.equal(euroAnswer.scenarioState.functionalCurrency, 'EUR');
assert.equal(euroJournal?.totalDebit, 910);
assert.equal(euroJournal?.totalCredit, 910);
assert.match(euroJournal?.summary, /1 USD = EUR 0\.91/);
assert.match(euroAnswer.scenarioState.keyParameters[0].value, /= EUR 910\.00/);
assert.match(euroAnswer.scenarioState.keyParameters[0].value, /1 USD = EUR 0\.91/);

const conflictingDirection = await processAccountingQuery(
  explicitDirectionQuery.replace('SGD 1.30.', 'SGD 1.40.'), null, 'SFRS_I', undefined
);
assert.equal(conflictingDirection.scenarioState.isComplete, false);
assert.ok(conflictingDirection.clarifications?.some(field => field.fieldKey === 'purchaseFxRate'));
assert.equal(updateCommittedJournalScenario(null, conflictingDirection.scenarioState, 'SFRS_I'), null);
const clarifiedDirection = await parseAccountingQuery('One USD equals SGD 1.30.', conflictingDirection.scenarioState);
assert.equal(clarifiedDirection.isComplete, true);
assert.equal(clarifiedDirection.purchaseFxRate, 1.30);
assert.equal(clarifiedDirection.purchaseAmountForeign, 1000);

const fxProviderSettings = {
  activeProvider: 'gemini',
  gemini: { apiKey: 'offline-test-provider-key', model: 'gemini-3.5-flash-lite' },
  azure: {},
  openai: {}
};
const accountingSemanticInterpretation = {
  schemaVersion: 2,
  jurisdiction: ['Singapore'],
  authorityCandidates: ['ACCOUNTING_STANDARDS'],
  contextualAuthorities: [],
  domain: 'ACCOUNTING',
  population: 'COMPANY',
  primarySubject: 'foreign equity investment journal',
  concepts: [{ concept: 'foreign equity journal entries', role: 'PRIMARY' }],
  requestedOperation: 'PREPARE_JOURNAL',
  factsExplicitlyProvided: [],
  confidence: 0.95,
  issues: [{
    subject: 'foreign equity investment journal',
    population: 'COMPANY',
    domain: 'ACCOUNTING',
    governingAuthorities: ['ACCOUNTING_STANDARDS'],
    contextualAuthorities: [],
    operation: 'PREPARE_JOURNAL',
    mappedTopicIds: [],
    evidenceRequirement: 'CASE_FACTS',
    confidence: 0.95
  }]
};
const fxEvidenceFor = (query, evidenceText, { status = 'AFFIRMED', eventText = query, disposalEvidence } = {}) => ({
  acquisition: { status, eventText, evidenceText },
  disposal: disposalEvidence || { status: 'MISSING', eventText: '', evidenceText: '' }
});
const fxWireQuery = 'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099 at USD/SGD spot rate of 1.30.';
let fxWireOptions;
const fxWireUnderstanding = await interpretSemanticQuestion(
  fxWireQuery,
  fxProviderSettings,
  async (_prompt, _system, _provider, options) => {
    fxWireOptions = options;
    return JSON.stringify({
      ...accountingSemanticInterpretation,
      fxTransactionEvidence: fxEvidenceFor(fxWireQuery, 'We acquired USD 1,000 of Apple shares on 13/11/2099 at USD/SGD spot rate of 1.30.')
    });
  }
);
assert.equal(fxWireUnderstanding.assessmentStatus, 'PASSED');
assert.equal(fxWireOptions.responseJsonSchema.required.at(-1), 'fxTransactionEvidence');
assert.ok(fxWireOptions.responseJsonSchema.properties.fxTransactionEvidence);
assert.equal(fxWireUnderstanding.fxTransactionEvidence.acquisition.evidenceText,
  'We acquired USD 1,000 of Apple shares on 13/11/2099 at USD/SGD spot rate of 1.30.');
let unrelatedWireOptions;
await interpretSemanticQuestion('How should an ordinary office expense be recorded?', fxProviderSettings,
  async (_prompt, _system, _provider, options) => { unrelatedWireOptions = options; return '{malformed'; });
assert.equal(unrelatedWireOptions.responseJsonSchema, SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA,
  'Unrelated semantic calls retain the exact standard schema object.');

async function runMockFxSemanticQuery(query, evidenceText, options = {}) {
  const semanticReply = {
    ...(options.semanticReply || accountingSemanticInterpretation),
    fxTransactionEvidence: fxEvidenceFor(query, evidenceText, options)
  };
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  let semanticCalls = 0;
  let eventExtractionCalls = 0;
  let requestBody;
  const authorityWorkstreams = [];
  const groundedContexts = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.hostname === 'generativelanguage.googleapis.com') {
      providerCalls += 1;
      const body = JSON.parse(init.body);
      const prompt = body.contents?.[0]?.parts?.[0]?.text || '';
      if (/Extract chronological accounting EVENT FACTS/.test(prompt)) {
        eventExtractionCalls += 1;
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"events":[]}' }] } }] }), { status: 200 });
      }
      semanticCalls += 1;
      requestBody = body;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(semanticReply) }] } }]
      }), { status: 200 });
    }
    if (url.pathname === '/robots.txt' && ['www.ifrs.org', 'asc.acra.gov.sg'].includes(url.hostname)) {
      return new Response(null, { status: 404 });
    }
    if (url.hostname === 'iras.gov.sg' || url.hostname.endsWith('.iras.gov.sg') ||
        url.hostname === 'mas.gov.sg' || url.hostname.endsWith('.mas.gov.sg')) {
      return new Response(null, { status: 404 });
    }
    throw new Error(`Unexpected request in mocked FX semantic regression: ${url.hostname}`);
  };
  try {
    const response = await processAccountingQuery(
      query,
      options.currentScenario || null,
      'SFRS_I',
      fxProviderSettings,
      undefined,
      options.chatHistory || [],
      options.outputPreference,
      {
        onAuthorityWorkstreams: result => { authorityWorkstreams.push(result); },
        onGroundedContext: context => { groundedContexts.push(context); }
      }
    );
    return { response, providerCalls, semanticCalls, eventExtractionCalls, requestBody, authorityWorkstreams, groundedContexts };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const capturedFxAcquisitionQuery =
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2025 at USD/SGD spot rate of 1.30. Prepare the journal entries.';
const capturedFxAcquisitionHistory = buildAnalysisConversationHistory([
  { id: 'captured-fx-acquisition', sender: 'user', text: capturedFxAcquisitionQuery, timestamp: '2026-11-27T06:32:00.000Z' }
], 'captured-fx-acquisition');
const capturedFxAcquisition = await runMockFxSemanticQuery(capturedFxAcquisitionQuery, '', {
  eventText: capturedFxAcquisitionQuery,
  chatHistory: capturedFxAcquisitionHistory,
  outputPreference: { journal: true, statutory: false }
});
assert.equal(capturedFxAcquisition.semanticCalls, 1);
assert.equal(capturedFxAcquisition.eventExtractionCalls, 1);
assert.notEqual(capturedFxAcquisition.response.providerStatus, 'FAILED',
  'the app must not treat the valid deterministic journal response as a provider failure');
assert.equal(capturedFxAcquisition.response.advisoryFailureStatus, undefined,
  'a journal-only FX acquisition with successful provider responses must not fail statutory synthesis');
assert.notEqual(capturedFxAcquisition.response.answerPath, 'AI_GROUNDED_SYNTHESIS_FALLBACK');
assert.equal(capturedFxAcquisition.authorityWorkstreams.some(result =>
  result.workstreams.some(workstream => !['ACCOUNTING_STANDARDS', 'IFRS_FOUNDATION'].includes(workstream.authority))), false,
  'a journal-only acquisition does not start Singapore statutory evidence workstreams');
assert.equal(capturedFxAcquisition.response.scenarioState.scenarioType, 'EQUITY_INVESTMENT_FX');
assert.equal(capturedFxAcquisition.response.scenarioState.isComplete, true);
assert.equal(capturedFxAcquisition.response.scenarioState.functionalCurrency, 'SGD');
assert.equal(capturedFxAcquisition.response.scenarioState.purchaseDate, '13/11/2025');
assert.equal(capturedFxAcquisition.response.scenarioState.purchaseFxRate, 1.30);
assert.equal(capturedFxAcquisition.response.scenarioState.fxSource, 'Acquisition rate provided by user',
  'the scenario preserves user-provided transaction-date rate provenance');
assert.equal(capturedFxAcquisition.response.scenarioState.effectiveDateOrTiming,
  capturedFxAcquisition.response.scenarioState.fxSource);
assert.doesNotMatch(capturedFxAcquisition.response.scenarioState.effectiveDateOrTiming, /17%|headline CIT/i);
assert.equal(capturedFxAcquisition.response.scenarioState.singaporeTaxTreatmentSummary, undefined);
assert.equal(capturedFxAcquisition.response.scenarioState.regulatoryMandatesSummary, undefined);
assert.doesNotMatch(capturedFxAcquisition.response.messageText, /capital gains tax|corporate income tax|exchange control|headline CIT|MAS Act/i);
const capturedFxAcquisitionGroups = capturedFxAcquisition.response.scenarioState.directGroups;
assert.deepEqual(capturedFxAcquisitionGroups?.[0].lines.map(line => [line.accountCode, line.debit, line.credit]),
  [['1210', 1300, 0], ['1010', 0, 1300]]);
assert.equal(capturedFxAcquisitionGroups?.[0].eventDate, '13/11/2025');
assert.equal(capturedFxAcquisitionGroups?.[0].totalDebit, 1300);
assert.equal(capturedFxAcquisitionGroups?.[0].totalCredit, 1300);
const capturedFxAcquisitionCommit = updateCommittedJournalScenario(
  null, capturedFxAcquisition.response.scenarioState, 'SFRS_I'
);
assert.deepEqual(capturedFxAcquisitionCommit?.committedDirectGroups?.[0].lines.map(line =>
  [line.accountCode, line.debit, line.credit]), [['1210', 1300, 0], ['1010', 0, 1300]]);

// The live capture retained the rendered answer and request facts, but not the
// raw semantic model reply. Reconstruct its confirmed failure shape: one
// accounting journal issue plus an unassigned taxonomy residual.
const capturedMissingDisposalDateQuery =
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2025 at USD/SGD spot rate of 1.30. We sold all 300 shares for USD 1,100 at a USD/SGD spot rate of 1.31 dated 16/12/2025. Prepare the journal entries.';
const capturedMissingDisposalDate = await runMockFxSemanticQuery(capturedMissingDisposalDateQuery, '', {
  eventText: capturedMissingDisposalDateQuery,
  currentScenario: capturedFxAcquisitionCommit,
  chatHistory: buildAnalysisConversationHistory([
    { id: 'captured-fx-acquisition', sender: 'user', text: capturedFxAcquisitionQuery, timestamp: '2026-11-27T06:32:00.000Z' },
    { id: 'captured-fx-disposal-clarification', sender: 'user', text: capturedMissingDisposalDateQuery, timestamp: '2026-11-27T07:36:17.000Z' }
  ], 'captured-fx-disposal-clarification'),
  outputPreference: { journal: true, statutory: false }
});
assert.equal(capturedMissingDisposalDate.semanticCalls, 1);
assert.equal(capturedMissingDisposalDate.eventExtractionCalls, 1);
assert.equal(capturedMissingDisposalDate.response.providerStatus, undefined,
  'the reconstructed semantic and event provider responses both succeed');
assert.equal(capturedMissingDisposalDate.authorityWorkstreams.length, 0,
  'a journal clarification with only an unassigned taxonomy residual must not launch statutory evidence workstreams');
assert.equal(capturedMissingDisposalDate.response.scenarioState.directGroups?.length || 0, 0);
assert.equal(capturedMissingDisposalDate.response.scenarioState.missingFields?.some(field => field.fieldKey === 'saleDate'), true);
assert.match(capturedMissingDisposalDate.response.messageText,
  /^### Clarification Required for Double Entry\r?\n\r?\nWhat was the disposal date \(DD\/MM\/YYYY\)\?/);
assert.equal(capturedMissingDisposalDate.response.scenarioState.saleDate, undefined);
assert.equal(capturedMissingDisposalDate.response.scenarioState.saleFxRate, undefined);
assert.equal(capturedMissingDisposalDate.response.scenarioState.authorityEvidencePresentation, undefined);
const retainedFxAcquisition = updateCommittedJournalScenario(
  capturedFxAcquisitionCommit, capturedMissingDisposalDate.response.scenarioState, 'SFRS_I'
);
assert.deepEqual(retainedFxAcquisition?.committedDirectGroups?.[0].lines.map(line =>
  [line.accountCode, line.debit, line.credit]), [['1210', 1300, 0], ['1010', 0, 1300]]);

const explicitShareTaxQuery =
  'What Singapore corporate income tax treatment applies to gains when a Singapore company sells foreign shares?';
const explicitShareTaxSubject = 'Singapore corporate income tax treatment of foreign share sale gains';
const explicitShareTaxAdvice = await runMockFxSemanticQuery(explicitShareTaxQuery, '', {
  semanticReply: {
    ...accountingSemanticInterpretation,
    domain: 'TAX',
    authorityCandidates: ['IRAS'],
    primarySubject: explicitShareTaxSubject,
    concepts: [{ concept: 'Singapore corporate income tax treatment of foreign share sale gains', role: 'PRIMARY' }],
    requestedOperation: 'EXPLAIN_RULE',
    issues: [{ subject: explicitShareTaxSubject, population: 'COMPANY', domain: 'IRAS_INCOME_TAX',
      governingAuthorities: ['IRAS'], contextualAuthorities: [], operation: 'EXPLAIN_RULE', mappedTopicIds: [],
      evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS', confidence: 0.95 }]
  },
  outputPreference: { journal: false, statutory: true }
});
assert.ok(explicitShareTaxAdvice.groundedContexts.some(context => context.classification.taxAnalysisRequired &&
  context.classification.authorities.includes('IRAS') && context.evidenceQuality),
  'an explicit share-tax question uses IRAS evidence and the existing grounded advisory workflow');
assert.equal(explicitShareTaxAdvice.response.scenarioState.directGroups?.length, 0);
assert.doesNotMatch(explicitShareTaxAdvice.response.messageText, /no capital gains tax|17% corporate income tax/,
  'unavailable mocked IRAS evidence does not yield an unsupported tax assertion');

const mixedFxAndTaxQuery =
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2025 at USD/SGD spot rate of 1.30. Prepare the journal entries. Separately, what Singapore corporate income tax treatment applies to a gain if the company later sells those foreign shares?';
const mixedFxAndTaxAdvice = await runMockFxSemanticQuery(mixedFxAndTaxQuery, '', {
  semanticReply: {
    ...accountingSemanticInterpretation,
    domain: 'ACCOUNTING',
    authorityCandidates: ['ACCOUNTING_STANDARDS', 'IRAS'],
    primarySubject: 'foreign equity investment journal and Singapore corporate income tax treatment of foreign share sale gains',
    concepts: [
      { concept: 'foreign equity journal entries', role: 'PRIMARY' },
      { concept: 'Singapore corporate income tax treatment of foreign share sale gains', role: 'PRIMARY' }
    ],
    issues: [
      accountingSemanticInterpretation.issues[0],
      { subject: 'Singapore corporate income tax treatment of foreign share sale gains', population: 'COMPANY',
        domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'], contextualAuthorities: [], operation: 'EXPLAIN_RULE',
        mappedTopicIds: [], evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS', confidence: 0.95 }
    ]
  },
  outputPreference: { journal: true, statutory: true }
});
assert.ok(mixedFxAndTaxAdvice.authorityWorkstreams.some(result =>
  result.workstreams.some(workstream => workstream.authority === 'IRAS')),
  'an independently requested tax issue in a mixed journal question still reaches IRAS evidence routing');
assert.ok(mixedFxAndTaxAdvice.response.scenarioState.authorityEvidencePresentation,
  'mixed requests retain the evidence presentation for their explicitly requested statutory issue');
assert.doesNotMatch(mixedFxAndTaxAdvice.response.messageText, /no capital gains tax|17% corporate income tax/,
  'mixed requests do not synthesize unsupported tax conclusions when evidence is unavailable');

const cleanLocalProofQuery = 'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099 at USD/SGD spot rate of 1.30. Prepare the journal entries.';
const ambiguousAssessmentOnCleanProof = await runMockFxSemanticQuery(cleanLocalProofQuery, '', {
  status: 'AMBIGUOUS', eventText: ''
});
assert.equal(ambiguousAssessmentOnCleanProof.response.scenarioState.isComplete, true,
  'A failed or ambiguous assessment cannot block a complete local affirmative proof.');
assert.equal(ambiguousAssessmentOnCleanProof.response.scenarioState.purchaseFxRate, 1.30);
assert.equal(ambiguousAssessmentOnCleanProof.response.scenarioState.directGroups?.[0].totalDebit, 1300);
assert.equal(ambiguousAssessmentOnCleanProof.response.scenarioState.directGroups?.[0].totalCredit, 1300);

const budgetScopeQuery = 'Our functional currency is SGD. This is a budget illustration. We acquired USD 1,000 of Apple shares on 13/11/2099. The acquisition USD/SGD spot rate is 1.28. Prepare the journal entries.';
const closingEvidence = 'The acquisition USD/SGD spot rate is 1.28.';
const aiGuidedConfirmation = await runMockFxSemanticQuery(budgetScopeQuery, closingEvidence);
assert.equal(aiGuidedConfirmation.semanticCalls, 1, 'FX ownership uses the existing semantic interpretation call once.');
assert.equal(aiGuidedConfirmation.eventExtractionCalls, 1, 'The existing journal event extractor remains a separate unchanged call.');
assert.ok(aiGuidedConfirmation.requestBody.generationConfig.responseFormat.text.schema.required.includes('fxTransactionEvidence'));
assert.match(aiGuidedConfirmation.requestBody.contents[0].parts[0].text, /FX event ownership/i);
assert.equal(aiGuidedConfirmation.response.scenarioState.isComplete, false,
  'An affirmative model assessment cannot upgrade a rate from a budget-framed event scope.');
assert.equal(aiGuidedConfirmation.response.scenarioState.directGroups?.length, 0);
assert.match(aiGuidedConfirmation.response.clarifications[0].prompt, /The acquisition USD\/SGD spot rate is 1\.28/);
assert.doesNotMatch(aiGuidedConfirmation.response.clarifications[0].prompt, /;/);
const confirmedAcquisitionRate = 'The acquisition USD/SGD spot rate is 1.28.';
const aiGuidedJournal = await processAccountingQuery(confirmedAcquisitionRate,
  aiGuidedConfirmation.response.scenarioState, 'SFRS_I', undefined, undefined, [
    { id: 'fx-user-initial', sender: 'user', text: budgetScopeQuery, timestamp: '' },
    { id: 'fx-assistant-clarification', sender: 'assistant', text: aiGuidedConfirmation.response.messageText, timestamp: '' },
    { id: 'fx-user-confirmation', sender: 'user', text: confirmedAcquisitionRate, timestamp: '' }
  ]);
assert.equal(aiGuidedJournal.scenarioState.isComplete, true);
assert.equal(aiGuidedJournal.scenarioState.purchaseFxRate, 1.28);
assert.equal(aiGuidedJournal.scenarioState.directGroups?.[0].totalDebit, 1280);
assert.equal(aiGuidedJournal.scenarioState.directGroups?.[0].totalCredit, 1280);
assert.equal(updateCommittedJournalScenario(null, aiGuidedJournal.scenarioState, 'SFRS_I')?.purchaseFxRate, 1.28);

const budgetOnlyProviderQuery = 'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099 at USD/SGD spot rate of 1.30, but that was only the budget rate. Prepare the journal entries.';
const budgetOnlyProviderEvidence = await runMockFxSemanticQuery(budgetOnlyProviderQuery, 'USD/SGD spot rate of 1.30');
assert.equal(budgetOnlyProviderEvidence.response.scenarioState.isComplete, false,
  'A provider copying the exact budget-only numeric snippet cannot authorize it.');
assert.equal(budgetOnlyProviderEvidence.response.scenarioState.directGroups?.length, 0);

const laterQualifiedProviderQuery = 'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099 at USD/SGD spot rate of 1.30. That was the figure in the budget. Prepare the journal entries.';
const earlierSentence = 'We acquired USD 1,000 of Apple shares on 13/11/2099 at USD/SGD spot rate of 1.30.';
const laterQualifiedProviderEvidence = await runMockFxSemanticQuery(laterQualifiedProviderQuery, earlierSentence);
assert.equal(laterQualifiedProviderEvidence.response.scenarioState.isComplete, false,
  'A complete earlier sentence quote cannot omit a later event-scope qualification.');
assert.equal(laterQualifiedProviderEvidence.response.scenarioState.directGroups?.length, 0);

const invalidContextProviderEvidence = await runMockFxSemanticQuery(laterQualifiedProviderQuery, earlierSentence, {
  eventText: 'This exact context is not present in the current question.'
});
assert.equal(invalidContextProviderEvidence.response.scenarioState.isComplete, false,
  'An unverifiable provider quote remains unresolved.');
assert.equal(invalidContextProviderEvidence.response.scenarioState.directGroups?.length, 0);

const wrongEventProviderQuery = 'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2099, subsequently the company sold 300 shares for USD 1,100 on 15/12/2099 at USD/SGD spot rate of 1.31. Prepare the journal entries.';
const wrongEventProviderEvidence = await runMockFxSemanticQuery(wrongEventProviderQuery,
  'USD/SGD spot rate of 1.31.');
assert.equal(wrongEventProviderEvidence.response.scenarioState.isComplete, false,
  'Disposal-scoped evidence cannot fill the acquisition rate.');
assert.ok(wrongEventProviderEvidence.response.scenarioState.missingFields.some(field => field.fieldKey === 'purchaseFxRate'));
assert.equal(wrongEventProviderEvidence.response.scenarioState.directGroups?.length, 0);

const inverseDirection = await parseAccountingQuery(explicitDirectionQuery.replace(
  'USD/SGD spot rate of 1.30, meaning one USD equals SGD 1.30.', 'SGD/USD spot rate of 0.80, meaning one SGD equals USD 0.80.'
));
assert.equal(inverseDirection.purchaseFxRate, 1.25);

const directionPrefix = explicitDirectionQuery.split(', meaning')[0];
for (const direction of [' (SGD 1.30 per USD).', ', where each USD equals SGD 1.30.', ', meaning 1 USD = S$1.30.']) {
  const scenario = await parseAccountingQuery(directionPrefix + direction);
  assert.equal(scenario.purchaseFxRate, 1.30, direction);
}
const contradictoryDirections = await parseAccountingQuery(
  `${directionPrefix}, meaning one USD equals SGD 1.30 and one USD equals SGD 1.40.`
);
assert.equal(contradictoryDirections.isComplete, false);
assert.ok(contradictoryDirections.missingFields.some(field => field.fieldKey === 'purchaseFxRate'));
for (const query of [
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2025 at USD/SGD spot rate of 1.30, meaning one USD equals SGD 1.30.',
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2025 at SGD 1.30 per USD (USD/SGD spot rate of 1.30).'
]) {
  const scenario = await parseAccountingQuery(query);
  assert.equal(scenario.purchaseFxRate, 1.30, query);
  assert.equal(scenario.directGroups?.[0].totalDebit, 1300);
}

const missingDisposalRate = await parseAccountingQuery(missingDisposalRateQuery);
assert.equal(missingDisposalRate.isComplete, false);
assert.equal(missingDisposalRate.directGroups?.length, 0);
assert.ok(missingDisposalRate.missingFields.some(field => field.fieldKey === 'saleFxRate'));
assert.equal(missingDisposalRate.saleFxRate, undefined);

const missingAcquisitionRate = await parseAccountingQuery(
  'A company primary currency is SGD. It acquired USD 1,000 of Apple shares on 13/11/2099.'
);
assert.equal(missingAcquisitionRate.isComplete, false);
assert.ok(missingAcquisitionRate.missingFields.some(field => field.fieldKey === 'purchaseFxRate'));

const missingAcquisitionDate = await parseAccountingQuery(
  'A company primary currency is SGD. It acquired USD 1,000 of Apple shares at USD/SGD spot rate of 1.30.'
);
assert.equal(missingAcquisitionDate.isComplete, false);
assert.ok(missingAcquisitionDate.missingFields.some(field => field.fieldKey === 'purchaseDate'));

const missingSaleAmount = await parseAccountingQuery(
  'A company primary currency is SGD. It acquired USD 1,000 of Apple shares on 13/11/2099 at USD/SGD spot rate of 1.30, then sold at 1.30 on 15/12/2099.'
);
assert.equal(missingSaleAmount.isComplete, false);
assert.equal(missingSaleAmount.saleAmountForeign, undefined);
assert.ok(missingSaleAmount.missingFields.some(field => field.fieldKey === 'saleAmountForeign'));
assert.ok(missingSaleAmount.missingFields.some(field => field.fieldKey === 'saleFxRate'));

const invalidDate = await parseAccountingQuery(
  'A company primary currency is SGD. It acquired USD 1,000 of Apple shares on 31/02/2099 at USD/SGD spot rate of 1.30.'
);
assert.equal(invalidDate.isComplete, false);
assert.ok(invalidDate.missingFields.some(field => field.fieldKey === 'purchaseDate'));

const equalRatesQuery = explicitRatesQuery.replace('spot rate of 1.31.', 'spot rate of 1.30.');
const equalRates = await parseAccountingQuery(equalRatesQuery);
assert.equal(equalRates.isComplete, true);
assert.equal(equalRates.purchaseFxRate, 1.30);
assert.equal(equalRates.saleFxRate, 1.30);
assert.equal(equalRates.fxSource.includes('demonstration'), false);
const equalSale = equalRates.directGroups?.find(group => group.id === 'grp-disposal');
assert.equal(equalSale?.lines.find(line => line.accountCode === '4600')?.credit, 0);

const explicitlyRated = await parseAccountingQuery(explicitRatesQuery);
assert.equal(explicitlyRated.isComplete, true);
assert.equal(explicitlyRated.purchaseDate, '13/11/2099');
assert.equal(explicitlyRated.saleDate, '15/12/2099');
assert.equal(explicitlyRated.purchaseFxRate, 1.30);
assert.equal(explicitlyRated.saleFxRate, 1.31);
assert.equal(explicitlyRated.directGroups?.[0].lines[0].debit, 1300);
const disposal = explicitlyRated.directGroups?.find(group => group.id === 'grp-disposal');
assert.equal(disposal?.lines.find(line => line.accountCode === '4600')?.credit, 10);
assert.equal(disposal?.isBalanced, true);
assert.match(explicitlyRated.directGroups?.[0].summary, /1 USD = SGD 1\.30/);
assert.match(disposal?.summary, /1 USD = SGD 1\.31/);
assert.ok(explicitlyRated.directGroups?.flatMap(group => group.lines)
  .every(line => !line.lineExplanation?.match(/\b(?:SGD|EUR|GBP)\/USD\b/)));
const journalMarkup = renderToStaticMarkup(React.createElement(JournalTable, {
  groups: explicitlyRated.directGroups ?? [],
  standard: 'SFRS_I',
  functionalCurrency: explicitlyRated.functionalCurrency,
  scenarioType: explicitlyRated.scenarioType
}));
assert.match(journalMarkup, /FX: USD 1,000 \(1 USD = SGD 1\.30\)/);
assert.match(journalMarkup, /FX: USD 1,100 \(1 USD = SGD 1\.31\)/);
const fallbackJournal = calculateDoubleEntries({
  ...explicitlyRated,
  directGroups: []
}, 'SFRS_I');
assert.match(fallbackJournal.groups.find(group => group.id === 'grp-purchase')?.summary, /1 USD = SGD 1\.30/);
assert.match(fallbackJournal.groups.find(group => group.id === 'grp-sale')?.summary, /1 USD = SGD 1\.31/);

const blockedEngineFallback = calculateDoubleEntries({
  ...missingDisposalRate,
  isComplete: true,
  missingFields: [],
  directGroups: []
}, 'SFRS_I');
assert.equal(blockedEngineFallback.groups.length, 0);

const eventOwnedFxRequests = [];
const originalEventOwnedFetch = globalThis.fetch;
globalThis.fetch = async input => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.hostname === 'api.frankfurter.dev') {
    const date = url.pathname.split('/').at(-1);
    eventOwnedFxRequests.push(date);
    return new Response(JSON.stringify({
      base: 'USD',
      date,
      rates: { SGD: 1.29 }
    }), { headers: { 'content-type': 'application/json' } });
  }
  if (url.hostname === 'generativelanguage.googleapis.com') {
    return new Response(JSON.stringify({ error: { message: 'Offline test stub' } }), { status: 503 });
  }
  throw new Error(`Unexpected request in FX event-ownership regression: ${url.hostname}`);
};
try {
  const providerSettings = {
    activeProvider: 'gemini',
    gemini: { apiKey: 'offline-test-provider-key', model: 'gemini-3.5-flash-lite' },
    azure: {},
    openai: {}
  };
  const interestRateQuery =
    'A company primary currency is SGD. It acquired USD 1,000 of Apple shares on 13/11/2025 at USD/SGD spot rate of 1.30. Then it sold 300 shares for USD 1,100 on 15/12/2025, with an interest rate of 1.32%. What are the double entries?';
  const interestRateResponse = await processAccountingQuery(
    interestRateQuery, null, 'SFRS_I', providerSettings
  );
  assert.equal(interestRateResponse.scenarioState.isComplete, true);
  assert.equal(interestRateResponse.scenarioState.purchaseDate, '13/11/2025');
  assert.equal(interestRateResponse.scenarioState.saleDate, '15/12/2025');
  assert.equal(interestRateResponse.scenarioState.purchaseFxRate, 1.30);
  assert.equal(interestRateResponse.scenarioState.saleFxRate, 1.29);
  assert.deepEqual(eventOwnedFxRequests, ['2025-12-15']);

  const reportingDateResponse = await processAccountingQuery(
    'Its reporting date is 31/12/2025. It acquired USD 1,000 of Apple shares at USD/SGD spot rate of 1.30.',
    null,
    'SFRS_I',
    providerSettings
  );
  assert.equal(reportingDateResponse.scenarioState.isComplete, false);
  assert.equal(reportingDateResponse.scenarioState.purchaseDate, undefined);
  assert.ok(reportingDateResponse.scenarioState.missingFields.some(field => field.fieldKey === 'purchaseDate'));
  assert.deepEqual(eventOwnedFxRequests, ['2025-12-15']);
} finally {
  globalThis.fetch = originalEventOwnedFetch;
}

const committed = updateCommittedJournalScenario(null, explicitlyRated, 'SFRS_I');
assert.ok(committed?.committedDirectGroups?.length);
const retainedAfterRejectedAcquisitionRate = updateCommittedJournalScenario(
  committed, acquisitionNegatedRate.scenarioState, 'SFRS_I'
);
assert.equal(retainedAfterRejectedAcquisitionRate, committed);
for (const answer of rejectedRateAnswers) {
  assert.equal(updateCommittedJournalScenario(committed, answer.scenarioState, 'SFRS_I'), committed);
}
assert.equal(updateCommittedJournalScenario(committed, disposalNegatedRate.scenarioState, 'SFRS_I'), committed);
assert.equal(updateCommittedJournalScenario(committed, disposalNamedUnusedRate.scenarioState, 'SFRS_I'), committed);
assert.equal(updateCommittedJournalScenario(committed, acquisitionInlineBudgetRate.scenarioState, 'SFRS_I'), committed);
const retained = updateCommittedJournalScenario(committed, missingDisposalRate, 'SFRS_I');
assert.equal(retained, committed);

const originalFetch = globalThis.fetch;
globalThis.fetch = async input => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.hostname === 'generativelanguage.googleapis.com') {
    return new Response(JSON.stringify({ error: { message: 'Offline test stub' } }), { status: 503 });
  }
  throw new Error('Unexpected external request in FX integrity regression.');
};
try {
  const providerSettings = {
    activeProvider: 'gemini',
    gemini: { apiKey: 'offline-test-provider-key', model: 'gemini-3.5-flash-lite' },
    azure: {},
    openai: {}
  };
  const serviceResponse = await processAccountingQuery(
    missingDisposalRateQuery, null, 'SFRS_I', providerSettings
  );
  assert.equal(serviceResponse.scenarioState.isComplete, false);
  assert.equal(serviceResponse.scenarioState.directGroups?.length, 0);
  assert.ok(serviceResponse.scenarioState.missingFields.some(field => field.fieldKey === 'saleFxRate'));
} finally {
  globalThis.fetch = originalFetch;
}

let requestedUrl;
let forwardedSignal;
const historicalRequests = [];
const originalFxFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  requestedUrl = new URL(typeof input === 'string' ? input : input.url);
  forwardedSignal = init?.signal;
  const date = requestedUrl.pathname.split('/').at(-1);
  historicalRequests.push(date);
  return new Response(JSON.stringify({
    base: 'USD',
    date,
    rates: { SGD: 1.3004 }
  }), { headers: { 'content-type': 'application/json' } });
};
try {
  const controller = new AbortController();
  const historicalRate = await getExchangeRate('USD', 'SGD', '2025-11-13', controller.signal);
  assert.equal(requestedUrl.pathname, '/v1/2025-11-13');
  assert.equal(requestedUrl.searchParams.get('base'), 'USD');
  assert.equal(requestedUrl.searchParams.get('symbols'), 'SGD');
  assert.equal(forwardedSignal, controller.signal);
  assert.equal(historicalRate.rate, 1.3004);
  assert.equal(historicalRate.date, '2025-11-13');
  assert.match(historicalRate.source, /2025-11-13/);
  const historicalScenario = await parseAccountingQuery(
    'A company primary currency is SGD. It acquired USD 1,000 of Apple shares on 14/11/2025.'
  );
  assert.equal(historicalScenario.isComplete, true);
  assert.equal(historicalScenario.purchaseFxRate, 1.3004);
  assert.match(historicalScenario.fxSource, /2025-11-14/);
  assert.deepEqual(historicalRequests, ['2025-11-13', '2025-11-14']);
} finally {
  globalThis.fetch = originalFxFetch;
}

const originalMismatchFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({
  base: 'USD',
  date: '2025-11-12',
  rates: { SGD: 1.3004 }
}), { headers: { 'content-type': 'application/json' } });
try {
  await assert.rejects(
    () => getExchangeRate('USD', 'SGD', '2025-11-15'),
    /verified USD\/SGD rate/
  );
} finally {
  globalThis.fetch = originalMismatchFetch;
}

assert.equal(unexpectedExternalRequests, 0);
globalThis.fetch = originalPlatformFetch;
console.log('FX missing-fact integrity regression passed.');
