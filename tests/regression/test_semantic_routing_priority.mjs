import assert from 'node:assert/strict';
import { hasSemanticRoutingConflict, resolveSemanticScenario } from '../../src/services/semanticScenarioResolver.ts';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { buildSsoUrl, getSafeOfficialUrl } from '../../src/utils/statutoryLinkResolver.ts';

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
assert.equal(buildSsoUrl('unrecognised instrument'), '', 'unknown legislation must not receive a generic or invented official citation');
assert.equal(getSafeOfficialUrl('https://sso.agc.gov.sg', 'Income Tax Act 1947', 'Section 14(1)', 'IRAS'), '');
assert.equal(getSafeOfficialUrl('', 'Central Provident Fund Act 1953', 'Section 7', 'CPF'), '');
assert.equal(getSafeOfficialUrl('', 'Central Provident Fund Act 1953', 'Contribution rates', 'CPF'), '', 'unspecific provision labels must not receive a generic Act URL');
assert.equal(getSafeOfficialUrl('', 'Employment Act 1968', 'Section 88A annual leave', 'MOM'), '');
assert.equal(getSafeOfficialUrl('', 'Goods and Services Tax Act 1993', 'GST registration threshold', 'IRAS'), '', 'unmatched GST provision labels must not receive a generic Act URL');
assert.equal(getSafeOfficialUrl('', 'SFRS(I) 1-1 Presentation of Financial Statements', 'Paragraph 41', 'ASC'), '', 'a collection page does not verify a specific paragraph');
assert.equal(getSafeOfficialUrl('https://www.iras.gov.sg', 'Singapore Statutory Directives', 'General', 'IRAS'), '', 'generic agency pages must not be passed off as a source');

console.log('✓ validated AI semantics override conflicting keyword routing; reporting reclassification routes to accounting; unknown legislation does not become tax law.');
