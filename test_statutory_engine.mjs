import assert from 'assert';
import { parseAccountingQuery } from './src/engine/scenarioParser.ts';
import { processAccountingQuery } from './src/services/geminiService.ts';
import { sanitizeStatutoryLinks, buildSsoUrl } from './src/utils/statutoryLinkResolver.ts';

async function runTests() {
  console.log('=== STARTING SINGAPORE STATUTORY ENGINE VERIFICATION ===\n');

  // TEST 1: ACRA Small Company Audit Exemption Query
  console.log('Test 1: ACRA Small Company Audit Exemption Query');
  const acraRes = await processAccountingQuery(
    'What are the ACRA requirements for small company audit exemption?',
    null,
    'SFRS_I'
  );
  assert(acraRes.scenarioState.queryIntent === 'STATUTORY_ADVISORY', 'Must be classified as STATUTORY_ADVISORY');
  assert(acraRes.messageText.includes('Section 205C'), 'Must cite Section 205C');
  assert(acraRes.messageText.includes('10,000,000') || acraRes.messageText.includes('10M'), 'Must mention 10M threshold');
  assert(acraRes.messageText.includes('50'), 'Must mention 50 employee threshold');
  assert(acraRes.messageText.includes('sso.agc.gov.sg/Act/CA1967'), 'Must link to Companies Act 1967 on SSO');
  console.log('✓ ACRA Audit Exemption verified successfully.\n');

  // TEST 2: CPF 2026 Wage Ceilings Query
  console.log('Test 2: CPF 2026 Wage Ceilings Query');
  const cpfRes = await processAccountingQuery(
    'What is the 2026 CPF Ordinary Wage ceiling and monthly contribution rate?',
    null,
    'SFRS_I'
  );
  assert(cpfRes.messageText.includes('8,000'), 'Must cite 2026 $8,000 OW ceiling');
  assert(cpfRes.messageText.includes('102,000'), 'Must cite AW ceiling formula');
  assert(cpfRes.messageText.includes('Central Provident Fund Act 1953'), 'Must cite CPF Act 1953');
  console.log('✓ CPF 2026 Wage Ceiling verified successfully.\n');

  // TEST 3: Passenger Car (Blocked Input GST & Non-Deductible Depreciation)
  console.log('Test 3: Passenger Motor Car Purchase (Hybrid Query)');
  const carRes = await processAccountingQuery(
    'I bought a company car for SGD 120k with bank. How to record double entries and can I claim 9% GST under IRAS?',
    null,
    'SFRS_I'
  );
  assert(carRes.scenarioState.queryIntent === 'HYBRID', 'Must be classified as HYBRID');
  assert(carRes.messageText.includes('Regulation 26'), 'Must cite GST Regulation 26');
  assert(carRes.messageText.includes('15(1)(k)'), 'Must cite Section 15(1)(k) of the Income Tax Act');
  assert(carRes.scenarioState.directGroups?.length === 1, 'Must have 1 journal group');
  const grp = carRes.scenarioState.directGroups[0];
  assert(grp.isBalanced === true, 'Journal entry must be strictly balanced');
  assert(grp.totalDebit === 120000, 'Debit must be 120,000');
  assert(grp.totalCredit === 120000, 'Credit must be 120,000');
  // Verify GST input tax is NOT claimed in journal
  const gstLine = grp.lines.find(l => l.accountCode === '1190');
  assert(!gstLine, 'Input GST line must NOT exist because it is blocked under Regulation 26');
  console.log('✓ Passenger Car Hybrid Entry verified successfully.\n');

  // TEST 4: Canonical SSO URL Builder
  console.log('Test 4: Canonical SSO URL Builder');
  const itaUrl = buildSsoUrl('ITA', '14(1)');
  assert.strictEqual(itaUrl, 'https://sso.agc.gov.sg/Act/ITA1947#pr14-');
  const caUrl = buildSsoUrl('CA', '205C');
  assert.strictEqual(caUrl, 'https://sso.agc.gov.sg/Act/CA1967#pr205C-');
  const gstUrl = buildSsoUrl('GSTA', '21');
  assert.strictEqual(gstUrl, 'https://sso.agc.gov.sg/Act/GSTA1993#pr21-');
  console.log('✓ Canonical SSO URL Builder verified successfully.\n');

  // TEST 5: Link Sanitizer (Anti-hallucination)
  console.log('Test 5: Link Sanitizer (Anti-hallucination)');
  const textWithFakeLink = 'Refer to [Section 14(1) Income Tax Act](https://example.com/fake-iras-pdf-1234.pdf) for deductibility.';
  const sanitized = sanitizeStatutoryLinks(textWithFakeLink);
  assert(sanitized.includes('https://sso.agc.gov.sg/Act/ITA1947#pr14-'), 'Hallucinated link must be replaced with canonical SSO link');
  console.log('✓ Link Sanitizer verified successfully.\n');

  // TEST 6: Existing Double Entry Journal (Entertainment 3k)
  console.log('Test 6: Existing General Expense Double Entry (Entertainment 3k)');
  const entRes = await processAccountingQuery(
    'i pay for entertainment expenses 3k with bank',
    null,
    'SFRS_I'
  );
  assert(entRes.scenarioState.scenarioType === 'GENERAL_EXPENSE', 'Must match GENERAL_EXPENSE');
  assert(entRes.messageText.includes('IAS 1') || entRes.messageText.includes('SFRS(I) 1-1'), 'Must cite IAS 1 / SFRS(I) 1-1');
  console.log('✓ Existing double entry engine intact.\n');

  console.log('====================================================');
  console.log('ALL TESTS PASSED! Statutory Engine 100% Verified.');
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
