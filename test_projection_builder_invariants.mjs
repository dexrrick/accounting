import assert from 'node:assert/strict';
import {
  buildAccountingMeasurementProjection,
  validateJournalBalance
} from './src/engine/projectionBuilder.ts';

console.log('=== RUNNING PROJECTION BUILDER INVARIANT SUITE ===\n');

function context(transaction, outstandingBalances = []) {
  return {
    underlyingTransaction: transaction,
    events: [],
    actualEvents: [],
    outstandingBalances,
    recognizedEquityTotal: 0,
    priorJournals: []
  };
}

const investment = {
  transactionId: 'tx-investment-verified-1',
  type: 'equity_investment_acquisition',
  subject: 'Apple ordinary shares',
  assetName: 'Apple ordinary shares',
  ownershipContext: 'external_investment',
  instrument: 'financial_asset_equity',
  totalAmount: 300000,
  disposalAmount: 400000,
  currency: 'USD',
  functionalCurrency: 'SGD',
  acquisitionFxRate: 1.3004,
  disposalFxRate: 1.2889,
  transactionDate: '2025-11-13',
  disposalDate: '2025-12-15'
};

// A supported projection derives every displayed balance field from its lines.
{
  const result = buildAccountingMeasurementProjection({
    committedContext: context(investment),
    requestedBasis: 'FVOCI'
  });
  assert.equal(result.success, true);
  assert.equal(result.projectedEvents.length, result.projectedGroups.length);
  for (const group of result.projectedGroups) {
    assert.equal(group.transactionId, investment.transactionId, 'projection group must retain authoritative transactionId');
    assert.equal(group.targetTransactionId, investment.transactionId);
    assert.equal(group.isBalanced, true);
    const check = validateJournalBalance(group);
    assert.equal(check.isBalanced, true, 'line totals, declared totals and flag must agree');
  }
  for (const event of result.projectedEvents) {
    assert.equal(event.transactionId, investment.transactionId, 'projected event must retain authoritative transactionId');
  }
  console.log('✓ supported FVOCI projection is balanced and retains authoritative IDs');
}

// No accounting facts are fabricated when the committed record is incomplete.
for (const missingFact of ['transactionId', 'currency', 'functionalCurrency', 'acquisitionFxRate', 'totalAmount', 'disposalFxRate']) {
  const incomplete = { ...investment };
  delete incomplete[missingFact];
  const result = buildAccountingMeasurementProjection({
    committedContext: context(incomplete),
    requestedBasis: 'FVOCI'
  });
  assert.equal(result.success, false, `${missingFact} must not be defaulted`);
  assert.match(result.diagnosticNotice || '', new RegExp(missingFact));
  assert.equal(result.projectedGroups.length, 0);
}
console.log('✓ missing identifiers, currencies, rates and amounts return controlled diagnostics');

// The builder deliberately has a narrow measurement-projection contract. These
// supported transaction lifecycles must not be mis-projected as FVOCI/FVTPL.
const unsupportedCases = [
  ['lease payment variation', 'lease_contract', 'right_of_use_asset', 'not_applicable'],
  ['receivable partial settlement', 'customer_invoice', 'accounts_receivable', 'not_applicable'],
  ['payable settlement', 'inventory_purchase', 'accounts_payable', 'not_applicable'],
  ['debt repayment', 'debt_settlement', 'debt_instrument', 'not_applicable'],
  ['own-equity hypothetical settlement', 'share_capital_issuance', 'own_equity', 'own_equity']
];
for (const [name, type, instrument, ownershipContext] of unsupportedCases) {
  const result = buildAccountingMeasurementProjection({
    committedContext: context({
      transactionId: `tx-${type}`,
      type,
      subject: name,
      ownershipContext,
      instrument,
      totalAmount: 10000,
      currency: 'SGD',
      functionalCurrency: 'SGD',
      acquisitionFxRate: 1
    }),
    requestedBasis: 'FVOCI'
  });
  assert.equal(result.success, false, `${name} must not receive an investment measurement projection`);
  assert.equal(result.projectedGroups.length, 0);
  assert.ok(result.diagnosticNotice || result.explanation);
}
console.log('✓ lease, settlement, debt and own-equity requests receive controlled out-of-contract diagnostics');

// A tampered declaration cannot pass the invariant merely because its lines balance.
const validGroup = buildAccountingMeasurementProjection({
  committedContext: context(investment),
  requestedBasis: 'FVTPL'
}).projectedGroups[0];
const tampered = { ...validGroup, totalDebit: validGroup.totalDebit + 1 };
assert.equal(validateJournalBalance(tampered).isBalanced, false);
console.log('✓ mismatched declared journal totals cannot be marked balanced');

console.log('\nProjection builder invariant suite passed.');
