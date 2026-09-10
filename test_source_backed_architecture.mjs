import assert from 'node:assert';
import { classifyQuestion } from './src/classification/questionClassifier.ts';
import { defaultSourceRetriever } from './src/retrieval/sourceRetriever.ts';
import { defaultCitationVerifier } from './src/verification/citationVerifier.ts';
import { parseAccountingQuery } from './src/engine/scenarioParser.ts';

async function runPhase1Tests() {
  console.log('=== RUNNING PHASE 1: EVIDENCE FOUNDATION BEHAVIORAL TESTS ===\n');

  // -------------------------------------------------------------
  // 1. CLASSIFICATION TESTS
  // -------------------------------------------------------------
  console.log('[1. CLASSIFICATION]');

  // 1A. Accounting Question
  const qAccounting = 'How should I amortise this intangible asset under SFRS(I)?';
  const cAccounting = classifyQuestion(qAccounting);
  assert.strictEqual(cAccounting.primaryDomain, 'ACCOUNTING', 'Must classify as ACCOUNTING');
  assert.strictEqual(cAccounting.accountingAnalysisRequired, true, 'Accounting analysis required');
  assert.strictEqual(cAccounting.taxAnalysisRequired, false, 'Tax analysis NOT required');
  assert.ok(cAccounting.authorities.includes('ACRA'), 'Must identify ACRA authority');
  console.log('✓ 1A. Pure Accounting question correctly classified');

  // 1B. Tax Question
  const qTax = 'Is company entertainment expense tax deductible under Section 14?';
  const cTax = classifyQuestion(qTax);
  assert.strictEqual(cTax.primaryDomain, 'TAX', 'Must classify as TAX');
  assert.strictEqual(cTax.taxAnalysisRequired, true, 'Tax analysis required');
  assert.strictEqual(cTax.accountingAnalysisRequired, false, 'Accounting analysis NOT required');
  assert.ok(cTax.authorities.includes('IRAS'), 'Must identify IRAS authority');
  console.log('✓ 1B. Pure Corporate Tax question correctly classified');

  // 1C. GST Question
  const qGst = 'Must our company register for GST when annual taxable turnover exceeds $1 million?';
  const cGst = classifyQuestion(qGst);
  assert.strictEqual(cGst.primaryDomain, 'GST', 'Must classify as GST');
  assert.strictEqual(cGst.currentInformationRequired, true, 'GST threshold requires current info');
  assert.ok(cGst.authorities.includes('IRAS'), 'Must identify IRAS authority');
  console.log('✓ 1C. Pure GST question correctly classified');

  // 1D. Corporate Regulatory Question
  const qCorp = 'What are ACRA Section 205C requirements for small company audit exemption?';
  const cCorp = classifyQuestion(qCorp);
  assert.strictEqual(cCorp.primaryDomain, 'CORPORATE_REGULATORY', 'Must classify as CORPORATE_REGULATORY');
  assert.strictEqual(cCorp.regulatoryAnalysisRequired, true, 'Regulatory analysis required');
  assert.ok(cCorp.authorities.includes('ACRA'), 'Must identify ACRA authority');
  console.log('✓ 1D. Corporate Regulatory question correctly classified');

  // 1E. Mixed Accounting + Tax Question
  const qMixed = 'Can I capitalise this development cost and what is the tax treatment?';
  const cMixed = classifyQuestion(qMixed);
  assert.strictEqual(cMixed.primaryDomain, 'MIXED', 'Must classify as MIXED');
  assert.strictEqual(cMixed.multiAuthority, true, 'Must flag multiAuthority = true');
  assert.strictEqual(cMixed.accountingAnalysisRequired, true, 'Accounting analysis required');
  assert.strictEqual(cMixed.taxAnalysisRequired, true, 'Tax analysis required');
  assert.ok(cMixed.authorities.includes('ACRA'), 'Must include ACRA');
  assert.ok(cMixed.authorities.includes('IRAS'), 'Must include IRAS');
  console.log('✓ 1E. Mixed Accounting + Tax question correctly classified');

  // -------------------------------------------------------------
  // 2. RETRIEVAL TESTS
  // -------------------------------------------------------------
  console.log('\n[2. SOURCE RETRIEVAL]');

  // 2A. Known SFRS(I) Source
  const rSfrs = await defaultSourceRetriever.retrieveSources({
    query: 'capitalisation of software development costs criteria',
    domain: 'ACCOUNTING_SFRS',
    maxResults: 3
  });
  assert.ok(rSfrs.length > 0, 'Must retrieve at least 1 record');
  const sfrsRec = rSfrs.find((r) => r.standardOrActCode.includes('SFRS') || r.documentTitle.includes('Intangible'));
  assert.ok(sfrsRec, 'Must retrieve SFRS(I) 1-38 Intangible Assets');
  assert.strictEqual(sfrsRec.jurisdiction, 'Singapore', 'Must specify Singapore jurisdiction');
  assert.strictEqual(sfrsRec.authority, 'ACRA', 'Governed by ACRA');
  console.log(`✓ 2A. Retrieved SFRS source: ${sfrsRec.documentTitle} (${sfrsRec.paragraphOrSection})`);

  // 2B. Known Singapore Statutory / Tax Source
  const rTax = await defaultSourceRetriever.retrieveSources({
    query: 'general deduction wholly and exclusively incurred in the production of income',
    domain: 'IRAS_TAX',
    maxResults: 3
  });
  assert.ok(rTax.length > 0, 'Must retrieve tax records');
  const taxRec = rTax.find((r) => r.standardOrActCode === 'ITA1947');
  assert.ok(taxRec, 'Must retrieve Income Tax Act 1947');
  assert.strictEqual(taxRec.paragraphOrSection, 'Section 14(1)', 'Must match Section 14(1)');
  assert.strictEqual(taxRec.sourceStatus, 'VERIFIED', 'Statute with canonical SSO is VERIFIED');
  assert.strictEqual(taxRec.sourceType, 'AUTHORITATIVE_SOURCE', 'Verbatim provision is AUTHORITATIVE_SOURCE');
  assert.ok(taxRec.officialSourceUrl.includes('sso.agc.gov.sg'), 'URL must be official SSO AGC link');
  console.log(`✓ 2B. Retrieved verified statutory source: ${taxRec.documentTitle} (${taxRec.paragraphOrSection})`);

  // 2C. Unknown Source does NOT produce false matches
  const rUnknown = defaultSourceRetriever.findSourcesByStandardOrAct('NonExistentStandard999', '§999');
  assert.strictEqual(rUnknown.length, 0, 'Unknown standard must return 0 records');
  console.log('✓ 2C. Unknown source safely rejected without false matches');

  // -------------------------------------------------------------
  // 3. CITATION VERIFICATION TESTS
  // -------------------------------------------------------------
  console.log('\n[3. CITATION VERIFICATION]');

  // 3A. Valid Source + Paragraph
  const validCitation = {
    standard: 'SFRS(I) 1-38',
    paragraph: '§57',
    title: 'Intangible Assets - Development Phase',
    text: 'Development costs capitalised when 6 criteria met',
    officialSourceUrl: 'https://www.acra.gov.sg/accountancy/accounting-standards',
    authority: 'ACRA'
  };
  const v1 = defaultCitationVerifier.verifyCitation(validCitation, 'ACRA');
  assert.strictEqual(v1.isValid, true, 'Valid citation must pass');
  assert.strictEqual(v1.status, 'VERIFIED', 'Status must be VERIFIED');
  assert.strictEqual(v1.structuralVerificationOnly, true, 'Must state structural verification only');
  console.log('✓ 3A. Valid citation verified successfully');

  // 3B. Invalid Paragraph on Valid Source
  const invalidParaCitation = {
    standard: 'SFRS(I) 1-38',
    paragraph: '§9999',
    title: 'Fabricated Paragraph',
    text: 'Fabricated text',
    officialSourceUrl: 'https://www.acra.gov.sg/accountancy/accounting-standards',
    authority: 'ACRA'
  };
  const v2 = defaultCitationVerifier.verifyCitation(invalidParaCitation);
  assert.strictEqual(v2.isValid, false, 'Invalid paragraph must fail');
  assert.strictEqual(v2.status, 'PARAGRAPH_NOT_FOUND', 'Status must be PARAGRAPH_NOT_FOUND');
  console.log('✓ 3B. Fabricated paragraph correctly rejected (PARAGRAPH_NOT_FOUND)');

  // 3C. Unknown Source
  const unknownSourceCitation = {
    standard: 'FakeTaxAct2099',
    paragraph: 'Section 1',
    title: 'Fake Act',
    text: 'Fake text',
    officialSourceUrl: 'https://sso.agc.gov.sg'
  };
  const v3 = defaultCitationVerifier.verifyCitation(unknownSourceCitation);
  assert.strictEqual(v3.isValid, false, 'Unknown source must fail');
  assert.strictEqual(v3.status, 'SOURCE_NOT_FOUND', 'Status must be SOURCE_NOT_FOUND');
  console.log('✓ 3C. Unknown source correctly rejected (SOURCE_NOT_FOUND)');

  // 3D. Authority Mismatch
  const mismatchedAuthorityCitation = {
    standard: 'Income Tax Act 1947',
    paragraph: 'Section 14(1)',
    title: 'General Deduction',
    text: 'Wholly and exclusively',
    officialSourceUrl: 'https://sso.agc.gov.sg/Act/ITA1947#pr14-',
    authority: 'MOM' // ITA belongs to IRAS, not MOM
  };
  const v4 = defaultCitationVerifier.verifyCitation(mismatchedAuthorityCitation);
  assert.strictEqual(v4.isValid, false, 'Authority mismatch must fail');
  assert.strictEqual(v4.status, 'AUTHORITY_MISMATCH', 'Status must be AUTHORITY_MISMATCH');
  console.log('✓ 3D. Authority mismatch correctly rejected (AUTHORITY_MISMATCH)');

  // 3E. Non-Canonical URL
  const nonCanonicalUrlCitation = {
    standard: 'Income Tax Act 1947',
    paragraph: 'Section 14(1)',
    title: 'General Deduction',
    text: 'Wholly and exclusively',
    officialSourceUrl: 'https://randomblog.com/singapore-tax-guide.pdf',
    authority: 'IRAS'
  };
  const v5 = defaultCitationVerifier.verifyCitation(nonCanonicalUrlCitation);
  assert.strictEqual(v5.isValid, false, 'Non-canonical URL must fail');
  assert.strictEqual(v5.status, 'NON_CANONICAL_URL', 'Status must be NON_CANONICAL_URL');
  console.log('✓ 3E. Non-canonical URL correctly rejected (NON_CANONICAL_URL)');

  // -------------------------------------------------------------
  // 4. CAPITALISATION & ASSUMPTION TESTS
  // -------------------------------------------------------------
  console.log('\n[4. CAPITALISATION & ASSUMPTION BEHAVIOR]');

  // 4A. Query asking whether expenditure can be capitalised without amount or confirmed criteria
  const capQuery = 'Can I capitalise this development cost?';
  const capParsed = await parseAccountingQuery(capQuery, null);

  // Must NOT treat missing facts as established facts
  assert.strictEqual(capParsed.isComplete, false, 'Query without facts/amount must NOT be marked complete');
  assert.ok(capParsed.missingFields.length >= 2, 'Must identify missing fields (stage distinction, criteria satisfaction)');
  
  // Must explicitly represent assumptions
  assert.ok(capParsed.assumptions && capParsed.assumptions.length > 0, 'Must populate explicit assumptions');
  const criteriaAssump = capParsed.assumptions.find((a) => a.field === 'recognitionCriteriaEstablished');
  assert.ok(criteriaAssump, 'Must have explicit assumption on criteria satisfaction');
  assert.strictEqual(criteriaAssump.materiality, 'HIGH', 'Criteria assumption must be HIGH materiality');

  // Journal entry must be explicitly labeled as conditional/illustrative
  const journalGroup = capParsed.directGroups?.[0];
  assert.ok(journalGroup, 'Must produce conditional journal group');
  assert.ok(journalGroup.title.toLowerCase().includes('conditional') || journalGroup.title.toLowerCase().includes('illustrative'), 'Title must declare entry as conditional/illustrative');
  assert.ok(journalGroup.rationalePoints.some((r) => r.includes('Provisional') || r.includes('conditional')), 'Rationale must declare entry as conditional');
  console.log('✓ 4A. Capitalisation missing facts detected, assumptions represented, and entry marked conditional');

  // 4B. Lease Scenario: Default discount rate explicitly flagged as assumption
  const leaseQuery = 'i have a rental agreement for 3 years, paying 1 month sgd3,000';
  const leaseParsed = await parseAccountingQuery(leaseQuery, null);
  assert.ok(leaseParsed.assumptions && leaseParsed.assumptions.length > 0, 'Lease without IBR must have assumptions');
  const ibrAssump = leaseParsed.assumptions.find((a) => a.field === 'leaseDiscountRateAnnual');
  assert.ok(ibrAssump, 'Must have assumption for lease discount rate');
  assert.strictEqual(ibrAssump.assumedValue, '5.0% p.a.', 'Assumed value is 5.0% p.a.');
  assert.strictEqual(ibrAssump.materiality, 'HIGH', 'IBR materiality is HIGH');
  console.log('✓ 4B. Implicit 5% lease discount rate explicitly labeled as an assumption');

  // -------------------------------------------------------------
  // 5. MULTI-AUTHORITY SEPARATION TESTS
  // -------------------------------------------------------------
  console.log('\n[5. MULTI-AUTHORITY SEPARATION]');

  const mixedQuery = 'Can I capitalise software development costs and what is the tax treatment in Singapore?';
  const mixedParsed = await parseAccountingQuery(mixedQuery, null);

  // Accounting and Tax treatments must be strictly distinct
  assert.ok(mixedParsed.accountingTreatmentSummary, 'Must populate accounting treatment summary');
  assert.ok(mixedParsed.singaporeTaxTreatmentSummary, 'Must populate tax treatment summary');
  assert.notStrictEqual(mixedParsed.accountingTreatmentSummary, mixedParsed.singaporeTaxTreatmentSummary, 'Accounting and Tax treatments must NOT be identical');
  
  // Accounting section cites SFRS(I) 1-38
  assert.ok(mixedParsed.accountingTreatmentSummary.includes('SFRS(I) 1-38'), 'Accounting cites SFRS(I) 1-38');
  assert.ok(mixedParsed.accountingTreatmentSummary.includes('§54'), 'Accounting cites §54 research expense');
  assert.ok(mixedParsed.accountingTreatmentSummary.includes('§57'), 'Accounting cites §57 development criteria');

  // Tax section cites Section 14(1) and Section 14C / EIS
  assert.ok(mixedParsed.singaporeTaxTreatmentSummary.includes('Section 14'), 'Tax cites Section 14');
  assert.ok(mixedParsed.singaporeTaxTreatmentSummary.includes('Section 15'), 'Tax cites Section 15 add-back');
  assert.ok(mixedParsed.singaporeTaxTreatmentSummary.includes('Enterprise Innovation Scheme') || mixedParsed.singaporeTaxTreatmentSummary.includes('14C'), 'Tax cites EIS / Section 14C');

  console.log('✓ 5A. Accounting (SFRS(I) 1-38) and Tax (Income Tax Act / EIS) strictly separated');

  console.log('\n=============================================================');
  console.log('ALL PHASE 1 BEHAVIORAL TESTS PASSED SUCCESSFULLY! (100% GREEN)');
  console.log('=============================================================\n');
}

runPhase1Tests().catch((err) => {
  console.error('Test failure:', err);
  process.exit(1);
});
