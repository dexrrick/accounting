import assert from 'node:assert';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { defaultSourceRetriever } from '../../src/retrieval/sourceRetriever.ts';
import { defaultCitationVerifier } from '../../src/verification/citationVerifier.ts';
import { parseAccountingQuery } from '../../src/engine/scenarioParser.ts';
import { getSafeOfficialUrl } from '../../src/utils/statutoryLinkResolver.ts';

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

  // 1F. False-Positive Resistance: Numbers in statutory advisory query
  const qAdvisoryWithNumbers = 'I have 45 employees and $8M annual revenue, do we qualify for ACRA small company audit exemption?';
  const cAdvisory = classifyQuestion(qAdvisoryWithNumbers);
  assert.strictEqual(cAdvisory.intent, 'STATUTORY_ADVISORY', 'Advisory with numbers must remain STATUTORY_ADVISORY intent');
  assert.strictEqual(cAdvisory.journalEntryRequired, false, 'Advisory query must NOT require journal entry');
  assert.strictEqual(cAdvisory.calculationRequired, false, 'Audit exemption query must NOT require quantitative journal calculation');
  console.log('✓ 1F. Numbers in statutory advisory query resisted false-positive journal trigger');

  // 1G. False-Positive Resistance: Conceptual depreciation "rate" query
  const qConceptualRate = 'What is the depreciation rate under the straight-line method in SFRS(I) 1-16?';
  const cConceptualRate = classifyQuestion(qConceptualRate);
  assert.strictEqual(cConceptualRate.currentInformationRequired, false, 'The word "rate" in conceptual depreciation must NOT trigger time-sensitive alert');
  console.log('✓ 1G. "rate" in conceptual accounting query resisted false-positive time-sensitivity alert');

  // 1H. False-Positive Resistance: Conceptual lease definition
  const qConceptualLease = 'What is the definition of a lease under SFRS(I) 16?';
  const cConceptualLease = classifyQuestion(qConceptualLease);
  assert.strictEqual(cConceptualLease.missingFacts.length, 0, 'Conceptual lease question must NOT flag missing discount rate');
  console.log('✓ 1H. Conceptual lease question resisted false-positive missing facts');

  // -------------------------------------------------------------
  // 2. RETRIEVAL & PROVENANCE TESTS
  // -------------------------------------------------------------
  console.log('\n[2. SOURCE RETRIEVAL & PROVENANCE]');

  // 2A. Known SFRS(I) Curated Summary Source
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
  assert.strictEqual(sfrsRec.sourceStatus, 'NEEDS_REVIEW', 'Curated summary must be marked NEEDS_REVIEW');
  assert.strictEqual(sfrsRec.sourceType, 'CURATED_SUMMARY', 'Curated standard in code is CURATED_SUMMARY');
  assert.strictEqual(sfrsRec.sourcePublisher, 'Accounting Standards Council (Singapore) / IFRS Foundation', 'Must specify sourcePublisher');
  assert.strictEqual(sfrsRec.isVerbatimText, false, 'Curated summary must have isVerbatimText = false');
  // PROOF 1: Unknown effective date doesn't become a fake date (no generic 2018-01-01 / 2024-01-01)
  assert.strictEqual(sfrsRec.effectiveDate, undefined, 'Unknown effective date must remain undefined, never hardcoded fake date');
  console.log(`✓ 2A. Retrieved SFRS curated summary: ${sfrsRec.documentTitle} [${sfrsRec.sourceStatus} / ${sfrsRec.sourceType}] (EffectiveDate: undefined - no fake date)`);

  // 2B. Known Singapore Primary Statutory Source
  const rTax = await defaultSourceRetriever.retrieveSources({
    query: 'general deduction wholly and exclusively incurred in the production of income',
    domain: 'IRAS_TAX',
    maxResults: 3
  });
  assert.ok(rTax.length > 0, 'Must retrieve tax records');
  const taxRec = rTax.find((r) => r.standardOrActCode === 'ITA1947');
  assert.ok(taxRec, 'Must retrieve Income Tax Act 1947');
  assert.strictEqual(taxRec.paragraphOrSection, 'Section 14(1)', 'Must match Section 14(1)');
  assert.strictEqual(taxRec.sourceStatus, 'VERIFIED', 'Primary verbatim statute with SSO AGC link is VERIFIED');
  assert.strictEqual(taxRec.sourceType, 'AUTHORITATIVE_SOURCE', 'Verbatim provision is AUTHORITATIVE_SOURCE');
  assert.strictEqual(taxRec.sourcePublisher, 'Singapore Statutes Online / AGC', 'SSO AGC publisher recorded');
  assert.strictEqual(taxRec.isVerbatimText, true, 'Verbatim text is explicitly flagged true, not inferred');
  assert.ok(taxRec.officialSourceUrl.includes('sso.agc.gov.sg'), 'URL must be official SSO AGC link');
  console.log(`✓ 2B. Retrieved verified primary statutory source: ${taxRec.documentTitle} (${taxRec.paragraphOrSection})`);

  // 2C. Unknown Source does NOT produce false matches
  const rUnknown = defaultSourceRetriever.findSourcesByStandardOrAct('NonExistentStandard999', '§999');
  assert.strictEqual(rUnknown.length, 0, 'Unknown standard must return 0 records');
  console.log('✓ 2C. Unknown source safely rejected without false matches');

  // 2D. PROOF 2: Official URL alone cannot make text authoritative
  const rAcra = defaultSourceRetriever.getSourceById('ACRA_SEC205C_SMALL_COMPANY_AUDIT_EXEMPTION');
  assert.ok(rAcra, 'Must find ACRA Section 205C record');
  assert.ok(rAcra.officialSourceUrl.startsWith('https://sso.agc.gov.sg'), 'URL is an official AGC SSO portal link');
  assert.strictEqual(rAcra.isVerbatimText, false, 'Curated summary of Act has isVerbatimText = false');
  assert.strictEqual(rAcra.sourceStatus, 'NEEDS_REVIEW', 'Must be marked NEEDS_REVIEW despite having official SSO URL');
  assert.strictEqual(rAcra.sourceType, 'CURATED_SUMMARY', 'Must be CURATED_SUMMARY despite having official SSO URL');
  console.log('✓ 2D. Proved: Official URL alone cannot make text authoritative (remains NEEDS_REVIEW + CURATED_SUMMARY)');

  // -------------------------------------------------------------
  // 3. CITATION VERIFICATION TESTS
  // -------------------------------------------------------------
  console.log('\n[3. CITATION VERIFICATION]');

  // 3A. A generic ACRA framework page cannot be cited as evidence for a
  // paragraph-specific curated SFRS(I) summary, even when the summary itself
  // exists locally and remains NEEDS_REVIEW.
  const summaryCitation = {
    standard: 'SFRS(I) 1-38',
    paragraph: '§57',
    title: 'Intangible Assets - Development Phase',
    text: 'Development costs capitalised when 6 criteria met',
    officialSourceUrl: 'https://www.acra.gov.sg/accountancy/accounting-standards',
    authority: 'ACRA'
  };
  const v1 = defaultCitationVerifier.verifyCitation(summaryCitation, 'ACRA');
  assert.strictEqual(v1.isValid, false, 'A generic framework pointer is not valid for a narrow paragraph citation');
  assert.strictEqual(v1.isStructurallyValid, false, 'Generic ACRA URL must fail structural verification for this specific citation');
  assert.strictEqual(v1.status, 'NON_CANONICAL_URL', 'Generic framework URL is rejected as non-canonical for a specific topic');
  assert.strictEqual(v1.isAuthoritativePrimarySource, false, 'A rejected curated citation cannot be a primary source');
  assert.strictEqual(v1.structuralVerificationOnly, true, 'Must state structural verification only');
  console.log('✓ 3A. Proved: Generic ACRA framework pointer cannot be cited for a specific SFRS(I) paragraph');

  // 3B. Primary Statutory Provision (ITA 1947 Section 14(1))
  const verifiedSection14 = defaultSourceRetriever.findSourcesByStandardOrAct('Income Tax Act 1947')
    .find(record => record.paragraphOrSection === 'Section 14(1)' && record.sourceStatus === 'VERIFIED');
  assert.ok(verifiedSection14, 'The verified Section 14(1) record must be available');
  const primaryCitation = {
    standard: 'Income Tax Act 1947',
    paragraph: 'Section 14(1)',
    title: 'General Deduction',
    text: 'Wholly and exclusively incurred in the production of income',
    officialSourceUrl: verifiedSection14.officialSourceUrl,
    authority: 'IRAS'
  };
  const vPrimary = defaultCitationVerifier.verifyCitation(primaryCitation, 'IRAS');
  assert.ok(vPrimary.matchedRecord, 'Primary citation must still match its statutory source record');
  assert.strictEqual(vPrimary.matchedRecord.sourceStatus, 'VERIFIED', 'Primary statutory content remains verified');
  assert.strictEqual(vPrimary.matchedRecord.isVerbatimText, true, 'Primary statutory content remains verbatim');
  assert.strictEqual(vPrimary.isValid, false, 'A verified source record alone must not authorize its URL');
  assert.strictEqual(vPrimary.status, 'NON_CANONICAL_URL', 'Missing URL-specific provenance must be reported');
  assert.strictEqual(getSafeOfficialUrl(primaryCitation.officialSourceUrl, primaryCitation.standard, primaryCitation.paragraph, primaryCitation.authority), '',
    'The primary citation URL must be withheld by the display gate');
  console.log('✓ 3B. Verbatim statutory content is matched while its unverified URL is withheld');

  // 3C. Invalid Paragraph on Valid Source
  const invalidParaCitation = {
    standard: 'Income Tax Act 1947',
    paragraph: 'Section 9999Z',
    title: 'Fabricated Paragraph',
    text: 'Fabricated text',
    officialSourceUrl: verifiedSection14.officialSourceUrl,
    authority: 'IRAS'
  };
  const v2 = defaultCitationVerifier.verifyCitation(invalidParaCitation);
  assert.strictEqual(v2.isValid, false, 'Invalid paragraph must fail');
  assert.strictEqual(v2.isStructurallyValid, false, 'Invalid paragraph cannot be structurally valid');
  assert.strictEqual(v2.status, 'PARAGRAPH_NOT_FOUND', 'Status must be PARAGRAPH_NOT_FOUND');
  console.log('✓ 3C. Fabricated paragraph correctly rejected (PARAGRAPH_NOT_FOUND)');

  // 3D. Unknown Source
  const unknownSourceCitation = {
    standard: 'FakeTaxAct2099',
    paragraph: 'Section 1',
    title: 'Fake Act',
    text: 'Fake text',
    officialSourceUrl: 'https://sso.agc.gov.sg'
  };
  const v3 = defaultCitationVerifier.verifyCitation(unknownSourceCitation);
  assert.strictEqual(v3.isValid, false, 'Unknown source must fail');
  assert.strictEqual(v3.isStructurallyValid, false, 'Unknown source cannot be structurally valid');
  assert.strictEqual(v3.status, 'SOURCE_NOT_FOUND', 'Status must be SOURCE_NOT_FOUND');
  console.log('✓ 3D. Unknown source correctly rejected (SOURCE_NOT_FOUND)');

  // 3E. Authority Mismatch
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
  assert.strictEqual(v4.isStructurallyValid, false, 'Authority mismatch cannot be structurally valid');
  assert.strictEqual(v4.status, 'AUTHORITY_MISMATCH', 'Status must be AUTHORITY_MISMATCH');
  console.log('✓ 3E. Authority mismatch correctly rejected (AUTHORITY_MISMATCH)');

  // 3F. Non-Canonical External Domain URL
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
  assert.strictEqual(v5.isStructurallyValid, false, 'Non-canonical URL cannot be structurally valid');
  assert.strictEqual(v5.status, 'NON_CANONICAL_URL', 'Status must be NON_CANONICAL_URL');
  console.log('✓ 3F. Non-canonical domain URL correctly rejected (NON_CANONICAL_URL)');

  // 3G. Canonical URL Path Mismatch (e.g. Income Tax Act citing Companies Act URL)
  const mismatchedUrlCitation = {
    standard: 'Income Tax Act 1947',
    paragraph: 'Section 14(1)',
    title: 'General Deduction',
    text: 'Wholly and exclusively',
    officialSourceUrl: 'https://sso.agc.gov.sg/Act/CA1967', // points to CA1967 instead of ITA1947
    authority: 'IRAS'
  };
  const v6 = defaultCitationVerifier.verifyCitation(mismatchedUrlCitation);
  assert.strictEqual(v6.isValid, false, 'Mismatched canonical URL path must fail');
  assert.strictEqual(v6.isStructurallyValid, false, 'Mismatched URL cannot be structurally valid');
  assert.strictEqual(v6.status, 'NON_CANONICAL_URL', 'Status must be NON_CANONICAL_URL');
  console.log('✓ 3G. Mismatched canonical statute URL path correctly rejected');

  // 3H. Exact independently URL-verified official guidance may be cited as
  // SOURCE_NEEDS_REVIEW, but it does not become primary statutory evidence.
  const masSfoRecord = defaultSourceRetriever.getSourceById('MAS_SFO_LICENSING_EXEMPTION_2026');
  assert.ok(masSfoRecord, 'MAS SFO FAQ record must exist');
  assert.strictEqual(masSfoRecord.urlVerificationStatus, 'VERIFIED', 'The cited MAS FAQ URL has separate verification metadata');
  const acraCitation = {
    standard: masSfoRecord.standardOrActCode,
    paragraph: masSfoRecord.paragraphOrSection,
    title: masSfoRecord.documentTitle,
    text: masSfoRecord.principleSummary,
    officialSourceUrl: masSfoRecord.officialSourceUrl,
    authority: masSfoRecord.authority
  };
  const vMas = defaultCitationVerifier.verifyCitation(acraCitation, 'MAS');
  assert.strictEqual(vMas.isStructurallyValid, true, 'Citation with exact independently verified official URL is structurally valid');
  assert.strictEqual(vMas.status, 'SOURCE_NEEDS_REVIEW', 'Official guidance still requires content review');
  assert.strictEqual(vMas.isAuthoritativePrimarySource, false, 'Official guidance is not primary statutory text');
  assert.notStrictEqual(vMas.status, 'VERIFIED_PRIMARY_SOURCE', 'Official guidance cannot be VERIFIED_PRIMARY_SOURCE');
  console.log('✓ 3H. Proved: Exact URL-verified official guidance returns SOURCE_NEEDS_REVIEW, not VERIFIED_PRIMARY_SOURCE');

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
