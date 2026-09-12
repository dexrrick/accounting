import assert from 'node:assert/strict';
import { hasSemanticRoutingConflict, resolveSemanticScenario } from './src/services/semanticScenarioResolver.ts';

console.log('=== RUNNING SEMANTIC ROUTING PRIORITY SUITE ===\n');

const ownEquityUnderstanding = {
  provenance: { tier: 'AI_REASONING', isFallback: false, engine: 'test', confidenceCapped: false },
  confidence: 0.94,
  ownershipContext: 'own_equity',
  transactionType: 'share_capital_issuance'
};

assert.equal(resolveSemanticScenario(ownEquityUnderstanding), 'SHARE_CAPITAL');
assert.equal(hasSemanticRoutingConflict({ scenarioType: 'PAYROLL_CPF_SALARY' }, ownEquityUnderstanding), true);
assert.equal(hasSemanticRoutingConflict({ scenarioType: 'SHARE_CAPITAL_PAID' }, ownEquityUnderstanding), false);

const fallbackUnderstanding = { ...ownEquityUnderstanding, provenance: { ...ownEquityUnderstanding.provenance, isFallback: true } };
assert.equal(resolveSemanticScenario(fallbackUnderstanding), undefined, 'heuristic fallback must not override an established deterministic route');

console.log('✓ validated AI semantics override conflicting keyword routing; fallback heuristics do not.');
