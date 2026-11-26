import assert from 'node:assert/strict';
import { parseAccountingQuery } from '../../src/engine/scenarioParser.ts';
import { calculateDoubleEntries } from '../../src/engine/accountingEngine.ts';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { updateCommittedJournalScenario } from '../../src/services/committedJournal.ts';
import { getExchangeRate } from '../../src/services/frankfurterService.ts';

let unexpectedExternalRequests = 0;
const originalPlatformFetch = globalThis.fetch;
globalThis.fetch = async () => {
  unexpectedExternalRequests += 1;
  throw new Error('Unexpected external request in FX integrity regression.');
};

const missingDisposalRateQuery =
  'A company primary currency is SGD. It acquired USD 1,000 of Apple shares at SGD/USD spot rate of 1.30 on 13/11/2099, then sold 300 shares for USD 1,100 on 15/12/2099. What are the double entries?';
const explicitRatesQuery =
  'A company primary currency is SGD. It acquired USD 1,000 of Apple shares at SGD/USD spot rate of 1.30 on 13/11/2099, then sold 300 shares for USD 1,100 at SGD/USD spot rate of 1.31 on 15/12/2099. What are the double entries?';

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
  'A company primary currency is SGD. It acquired USD 1,000 of Apple shares at SGD/USD spot rate of 1.30.'
);
assert.equal(missingAcquisitionDate.isComplete, false);
assert.ok(missingAcquisitionDate.missingFields.some(field => field.fieldKey === 'purchaseDate'));

const missingSaleAmount = await parseAccountingQuery(
  'A company primary currency is SGD. It acquired USD 1,000 of Apple shares at SGD/USD spot rate of 1.30 on 13/11/2099, then sold at 1.30 on 15/12/2099.'
);
assert.equal(missingSaleAmount.isComplete, false);
assert.equal(missingSaleAmount.saleAmountForeign, undefined);
assert.ok(missingSaleAmount.missingFields.some(field => field.fieldKey === 'saleAmountForeign'));
assert.ok(missingSaleAmount.missingFields.some(field => field.fieldKey === 'saleFxRate'));

const invalidDate = await parseAccountingQuery(
  'A company primary currency is SGD. It acquired USD 1,000 of Apple shares at SGD/USD spot rate of 1.30 on 31/02/2099.'
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
    'A company primary currency is SGD. It acquired USD 1,000 of Apple shares on 13/11/2025 at SGD/USD spot rate of 1.30. Then it sold 300 shares for USD 1,100 on 15/12/2025, with an interest rate of 1.32%. What are the double entries?';
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
    'Its reporting date is 31/12/2025. It acquired USD 1,000 of Apple shares at SGD/USD spot rate of 1.30.',
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
