import assert from 'assert';
import { parseAccountingQuery } from '../../src/engine/scenarioParser.ts';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { sanitizeStatutoryLinks, buildSsoUrl } from '../../src/utils/statutoryLinkResolver.ts';

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
  assert(!acraRes.messageText.includes('sso.agc.gov.sg/Act/CoA1967'), 'An unverified statutory URL must not be emitted as a link');
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
    'The company bought an S-plate passenger car for own use by employees for SGD 120k with bank. How to record double entries and can I claim 9% GST under IRAS?',
    null,
    'SFRS_I'
  );
  assert(carRes.scenarioState.queryIntent === 'HYBRID', 'Must be classified as HYBRID');
  assert(carRes.messageText.includes('Regulation 27'), 'Must cite GST Regulation 27 for a passenger car.');
  assert(carRes.messageText.includes('15(1)(k)'), 'Must cite Section 15(1)(k) of the Income Tax Act');
  assert.match(carRes.messageText, /assumes an ordinary Singapore-registered S-plate private passenger car.*with no applicable exception/i);
  assert.match(carRes.messageText, /qualifying private-hire or instructional vehicles.*different income-tax treatment/i);
  assert.match(carRes.messageText, /Taxi running expenses are a separate exception.*12 November 2018.*authorised purpose under Section 14ZA\(8\)/i);
  assert.match(carRes.messageText, /That taxi rule does not itself extend to private-hire cars/i);
  assert.match(carRes.messageText, /GST input-tax recovery must be assessed separately/i);
  assert.doesNotMatch(carRes.messageText, /no tax deduction or Section 19\/19A Capital Allowances are granted on passenger motor cars/i);
  assert.doesNotMatch(carRes.messageText, /Petrol, parking, road tax, and maintenance expenses.*also non-deductible/i);
  assert(carRes.scenarioState.directGroups?.length === 1, 'Must have 1 journal group');
  const grp = carRes.scenarioState.directGroups[0];
  assert(grp.isBalanced === true, 'Journal entry must be strictly balanced');
  assert(grp.totalDebit === 120000, 'Debit must be 120,000');
  assert(grp.totalCredit === 120000, 'Credit must be 120,000');
  // Verify GST input tax is NOT claimed in journal
  const gstLine = grp.lines.find(l => l.accountCode === '1190');
  assert(!gstLine, 'Input GST line must NOT exist because it is blocked under Regulation 27');
  const blockedCarAdvisory = carRes.scenarioState.statutoryAdvisory.find(advisory => advisory.sectionOrSchedule === 'Regulation 26 & 27');
  assert.equal(blockedCarAdvisory?.isGstClaimable, false, 'An explicit company passenger-car fast path retains its own-use GST block.');
  console.log('✓ Passenger Car Hybrid Entry verified successfully.\n');

  const thirdPartyReplacementCar = await parseAccountingQuery(
    'Can we claim input GST? The company bought an S-plate passenger car as a replacement vehicle for an insurance policyholder. Please check Regulation 27.'
  );
  assert.notEqual(thirdPartyReplacementCar?.scenarioType, 'CAR_PURCHASE_STATUTORY', 'A policyholder replacement car is not assumed to be the company’s own passenger car.');
  const thirdPartyGstAdvisory = thirdPartyReplacementCar?.statutoryAdvisory?.find(advisory => advisory.sectionOrSchedule === 'Regulation 26 & 27');
  assert.ok(thirdPartyGstAdvisory, 'The third-party scenario retains general IRAS blocked-input-tax guidance.');
  assert.equal(thirdPartyGstAdvisory.isGstClaimable, undefined, 'Recipient and use facts are required before deciding third-party motor-car input-tax recovery.');
  console.log('✓ Third-party replacement car remains conditional on IRAS use and recipient facts.\n');

  const contractorUseCar = await parseAccountingQuery(
    "Can we claim input GST? The company bought an S-plate passenger company car for an unrelated contractor to use. Please check Regulation 27."
  );
  assert.notEqual(contractorUseCar?.scenarioType, 'CAR_PURCHASE_STATUTORY', 'The words “company car” alone do not establish company or employee own-use when an unrelated contractor uses it.');
  const contractorGstAdvisory = contractorUseCar?.statutoryAdvisory?.find(advisory => advisory.sectionOrSchedule === 'Regulation 26 & 27');
  assert.equal(contractorGstAdvisory?.isGstClaimable, undefined, 'Third-party contractor use remains conditional instead of receiving an unconditional GST block.');
  console.log('✓ A company car used by an unrelated contractor remains outside the own-use fast path.\n');

  const consultantUseCar = await parseAccountingQuery(
    "Can we claim input GST? The company bought its own S-plate passenger company car exclusively for an unrelated consultant's use."
  );
  assert.notEqual(consultantUseCar?.scenarioType, 'CAR_PURCHASE_STATUTORY', 'Company ownership alone does not establish own-use when an unrelated consultant exclusively uses the car.');
  const consultantGstAdvisory = consultantUseCar?.statutoryAdvisory?.find(advisory => advisory.sectionOrSchedule === 'Regulation 26 & 27');
  assert.equal(consultantGstAdvisory?.isGstClaimable, undefined, 'An unrelated consultant-use case does not receive an unconditional GST block.');
  console.log('✓ Company ownership alone does not trigger the car GST block for consultant-only use.\n');

  // TEST 4: Canonical SSO URL Builder
  console.log('Test 4: Canonical SSO URL Builder');
  const itaUrl = buildSsoUrl('ITA', '14(1)');
  assert.strictEqual(itaUrl, '');
  const caUrl = buildSsoUrl('CA', '205C');
  assert.strictEqual(caUrl, '');
  const gstUrl = buildSsoUrl('GSTA', '21');
  assert.strictEqual(gstUrl, '');
  console.log('✓ Canonical SSO URL Builder verified successfully.\n');

  // TEST 5: Link Sanitizer (Anti-hallucination)
  console.log('Test 5: Link Sanitizer (Anti-hallucination)');
  const textWithFakeLink = 'Refer to [Section 14(1) Income Tax Act](https://example.com/fake-iras-pdf-1234.pdf) for deductibility.';
  const sanitized = sanitizeStatutoryLinks(textWithFakeLink);
  assert.strictEqual(sanitized, 'Refer to Section 14(1) Income Tax Act for deductibility.', 'Unverified registry URLs are not substituted into model text.');
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

  // TEST 7: Capitalisation of Software Development Expenditure (SFRS(I) 1-38 §57 vs IRAS S14 / EIS)
  console.log('Test 7: Software Development Capitalisation (SFRS(I) 1-38 vs S14/EIS)');
  const capRes = await processAccountingQuery(
    'Can software development expenditure be capitalised under SFRS(I) 1-38, and how does IRAS treat it for tax deduction?',
    null,
    'SFRS_I'
  );
  assert(capRes.scenarioState.scenarioType === 'CAPITALISATION_SFRS138', 'Must match CAPITALISATION_SFRS138 scenario');
  assert(capRes.scenarioState.primaryDomain === 'ACCOUNTING_SFRS', 'Must be primaryDomain ACCOUNTING_SFRS');
  assert(capRes.messageText.includes('SFRS(I) 1-38'), 'Must cite SFRS(I) 1-38');
  assert(capRes.messageText.includes('54'), 'Must mention §54 research phase expensing');
  assert(capRes.messageText.includes('57'), 'Must mention §57 6 capitalisation criteria');
  assert(capRes.messageText.includes('Enterprise Innovation Scheme') || capRes.messageText.includes('EIS'), 'Must mention EIS or Section 14C');
  assert(capRes.scenarioState.accountingTreatmentSummary, 'accountingTreatmentSummary must be populated');
  assert(capRes.scenarioState.singaporeTaxTreatmentSummary, 'singaporeTaxTreatmentSummary must be populated');
  console.log('✓ Software Development Capitalisation query verified.\n');

  // TEST 8: GST Compulsory Registration Threshold
  console.log('Test 8: GST Compulsory Registration Threshold ($1M Turnover)');
  const gstRes = await processAccountingQuery(
    'Does our company need to register for GST if annual taxable turnover reaches SGD 1.2 million?',
    null,
    'SFRS_I'
  );
  assert(gstRes.scenarioState.queryIntent === 'STATUTORY_ADVISORY', 'Must be STATUTORY_ADVISORY');
  assert(gstRes.messageText.includes('1,000,000') || gstRes.messageText.includes('1 million'), 'Must cite $1M threshold');
  assert(gstRes.messageText.includes('Retrospective') || gstRes.messageText.includes('Prospective'), 'Must cite registration tests');
  console.log('✓ GST Compulsory Registration query verified.\n');

  // TEST 9: MOM Statutory Leave Entitlements
  console.log('Test 9: MOM Annual and Outpatient Sick Leave Entitlements');
  const momRes = await processAccountingQuery(
    'What are MOM statutory annual leave and outpatient sick leave entitlements, and overtime calculation rules?',
    null,
    'SFRS_I'
  );
  assert(momRes.scenarioState.queryIntent === 'STATUTORY_ADVISORY', 'Must be STATUTORY_ADVISORY');
  assert(momRes.messageText.includes('Employment Act 1968'), 'Must cite Employment Act 1968');
  assert(momRes.messageText.includes('14 days') || momRes.messageText.includes('89'), 'Must cite Section 89 or 14 days sick leave');
  console.log('✓ MOM Statutory Leave query verified.\n');

  // TEST 10: CPF Tiered Rates by Age & $8,000 Ceiling
  console.log('Test 10: CPF Tiered Contribution Rates by Age');
  const cpfAgeRes = await processAccountingQuery(
    'What is the 2026 CPF Ordinary Wage ceiling and monthly contribution rates by employee age?',
    null,
    'SFRS_I'
  );
  assert(cpfAgeRes.scenarioState.queryIntent === 'STATUTORY_ADVISORY', 'Must be STATUTORY_ADVISORY');
  assert(cpfAgeRes.messageText.includes('8,000'), 'Must cite $8,000 OW ceiling');
  assert(cpfAgeRes.messageText.includes('55'), 'Must cite age tiers');
  console.log('✓ CPF Tiered Rates by Age verified.\n');

  console.log('====================================================');
  console.log('ALL 10 TESTS PASSED! Statutory Engine 100% Verified.');
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
