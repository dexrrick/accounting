import assert from 'node:assert/strict';
import { hasSemanticRoutingConflict, resolveSemanticScenario } from './src/services/semanticScenarioResolver.ts';
import { classifyQuestion } from './src/classification/questionClassifier.ts';
import { buildSsoUrl } from './src/utils/statutoryLinkResolver.ts';

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

const reportingQuestion = classifyQuestion('Is restatement needed for financial statements if I reclass other gains to revenue, while final figures remain the same?');
assert.equal(reportingQuestion.primaryDomain, 'ACCOUNTING');
assert.equal(reportingQuestion.taxAnalysisRequired, false);
assert.ok(reportingQuestion.authorities.includes('ACRA'));
assert.equal(buildSsoUrl('unrecognised instrument'), 'https://sso.agc.gov.sg', 'unknown legislation must not default to the Income Tax Act');

console.log('✓ validated AI semantics override conflicting keyword routing; reporting reclassification routes to accounting; unknown legislation does not become tax law.');
