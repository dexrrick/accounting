import assert from 'node:assert/strict';
import { parseAccountingQuery } from '../../src/engine/scenarioParser.ts';
import { calculateDoubleEntries } from '../../src/engine/accountingEngine.ts';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { updateCommittedJournalScenario } from '../../src/services/committedJournal.ts';
import { getExchangeRate } from '../../src/services/frankfurterService.ts';

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
  'A company primary currency is SGD. It acquired USD 1,000 of Apple shares at USD/SGD spot rate of 1.30 on 13/11/2099, then sold 300 shares for USD 1,100 on 15/12/2099. What are the double entries?';
const explicitRatesQuery =
  'A company primary currency is SGD. It acquired USD 1,000 of Apple shares at USD/SGD spot rate of 1.30 on 13/11/2099, then sold 300 shares for USD 1,100 at USD/SGD spot rate of 1.31 on 15/12/2099. What are the double entries?';

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
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares at USD/SGD spot rate of 1.30 on 13/11/2025, meaning one USD equals SGD 1.40.',
  null, 'SFRS_I', undefined
);
const conflictingPairLabels = await processAccountingQuery(
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares on 13/11/2025 at USD/SGD spot rate in EUR/GBP of 1.30.',
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
  [eventNamedAdjacentQuote, 1.30, 1300]
]) {
  assert.equal(answer.scenarioState.isComplete, true);
  assert.equal(answer.scenarioState.purchaseFxRate, expectedRate);
  const purchase = answer.scenarioState.directGroups?.find(group => group.id === 'grp-purchase');
  assert.equal(purchase?.totalDebit, expectedSgd);
  assert.equal(purchase?.totalCredit, expectedSgd);
  assert.equal(purchase?.isBalanced, true);
}
for (const answer of [
  conflictingUnitQuotes, conflictingLabelAnswer, conflictingQuoteAfterDate, conflictingPairLabels,
  unlabelledRateAnswer, budgetRateAnswer, budgetRateInEventSentence
]) {
  assert.equal(answer.scenarioState.isComplete, false);
  assert.ok(answer.clarifications?.some(field => field.fieldKey === 'purchaseFxRate'));
  assert.equal(answer.scenarioState.directGroups?.length, 0);
}

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
assert.match(euroJournal?.summary, /0\.91 EUR\/USD/);
assert.match(euroAnswer.scenarioState.keyParameters[0].value, /= EUR 910\.00/);

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
  'Our functional currency is SGD. We acquired USD 1,000 of Apple shares at USD/SGD spot rate of 1.30 on 13/11/2025, meaning one USD equals SGD 1.30.',
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
  'A company primary currency is SGD. It acquired USD 1,000 of Apple shares at USD/SGD spot rate of 1.30 on 13/11/2099, then sold at 1.30 on 15/12/2099.'
);
assert.equal(missingSaleAmount.isComplete, false);
assert.equal(missingSaleAmount.saleAmountForeign, undefined);
assert.ok(missingSaleAmount.missingFields.some(field => field.fieldKey === 'saleAmountForeign'));
assert.ok(missingSaleAmount.missingFields.some(field => field.fieldKey === 'saleFxRate'));

const invalidDate = await parseAccountingQuery(
  'A company primary currency is SGD. It acquired USD 1,000 of Apple shares at USD/SGD spot rate of 1.30 on 31/02/2099.'
);
assert.equal(invalidDate.isComplete, false);
assert.ok(invalidDate.missingFields.some(field => field.fieldKey === 'purchaseDate'));

const equalRatesQuery = explicitRatesQuery.replace('1.31 on 15/12/2099', '1.30 on 15/12/2099');
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
