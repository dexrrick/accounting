import assert from 'assert';
import { defaultSourceFreshnessManager, SourceFreshnessManager } from '../../src/standards/sourceFreshnessManager.ts';
import { defaultTargetDateResolver, TargetDateResolver } from '../../src/retrieval/targetDateResolver.ts';
import { UNIFIED_SOURCE_REGISTRY, getAllAuthoritativeSources, buildUnifiedSourceRegistry } from '../../src/standards/unifiedSourceModel.ts';
import { defaultSourceRetriever } from '../../src/retrieval/sourceRetriever.ts';
import { defaultCitationVerifier } from '../../src/verification/citationVerifier.ts';
import { evaluateFastPathEligibility } from '../../src/services/geminiService.ts';

async function runPhase3Tests() {
  console.log('=== RUNNING PHASE 3: BETTER EVIDENCE COVERAGE & TEMPORAL TESTS ===\n');
  let passed = 0;

  // TEST 1: SOURCE FRESHNESS MANAGER STATUS EVALUATION
  console.log('[1. SOURCE FRESHNESS MANAGER STATUS EVALUATION]');
  const refDate = '2026-09-11';

  // 1A: Active Current
  const activeRecord = {
    id: 'TEST_ACTIVE',
    authority: 'IRAS',
    validFrom: '2024-01-01',
    validTo: undefined,
    lastVerifiedDate: '2026-08-01',
    reviewAuditCycleDays: 365,
    sourceStatus: 'VERIFIED'
  };
  assert.strictEqual(
    defaultSourceFreshnessManager.evaluateSourceFreshness(activeRecord, refDate),
    'ACTIVE_CURRENT',
    'Current valid provision with recent audit must be ACTIVE_CURRENT'
  );
  console.log('✓ 1A. Proved: In-force provision with fresh audit evaluates to ACTIVE_CURRENT');
  passed++;

  // 1B: Historical Superseded (validTo < referenceDate)
  const historicalRecord = {
    id: 'TEST_HISTORICAL',
    authority: 'IRAS',
    validFrom: '2023-01-01',
    validTo: '2023-12-31',
    lastVerifiedDate: '2026-08-01',
    reviewAuditCycleDays: 365,
    sourceStatus: 'HISTORICAL'
  };
  assert.strictEqual(
    defaultSourceFreshnessManager.evaluateSourceFreshness(historicalRecord, refDate),
    'HISTORICAL_SUPERSEDED',
    'Provision with validTo prior to referenceDate must evaluate to HISTORICAL_SUPERSEDED'
  );
  console.log('✓ 1B. Proved: Provision with elapsed validTo evaluates to HISTORICAL_SUPERSEDED');
  passed++;

  // 1C: Pending Effective (validFrom > referenceDate)
  const pendingRecord = {
    id: 'TEST_PENDING',
    authority: 'ACRA',
    validFrom: '2027-01-01',
    validTo: undefined,
    lastVerifiedDate: '2026-08-01',
    reviewAuditCycleDays: 365,
    sourceStatus: 'VERIFIED'
  };
  assert.strictEqual(
    defaultSourceFreshnessManager.evaluateSourceFreshness(pendingRecord, refDate),
    'PENDING_EFFECTIVE',
    'Provision with future validFrom must evaluate to PENDING_EFFECTIVE'
  );
  console.log('✓ 1C. Proved: Provision with future validFrom evaluates to PENDING_EFFECTIVE');
  passed++;

  // 1D: Audit Overdue (referenceDate > lastVerifiedDate + auditCycle)
  const overdueRecord = {
    id: 'TEST_OVERDUE',
    authority: 'MOM',
    validFrom: '2019-01-01',
    validTo: undefined,
    lastVerifiedDate: '2024-01-01', // > 365 days before 2026-09-11
    reviewAuditCycleDays: 365,
    sourceStatus: 'VERIFIED'
  };
  assert.strictEqual(
    defaultSourceFreshnessManager.evaluateSourceFreshness(overdueRecord, refDate),
    'AUDIT_OVERDUE',
    'In-force provision with expired audit interval must evaluate to AUDIT_OVERDUE'
  );
  console.log('✓ 1D. Proved: In-force provision with expired verification window evaluates to AUDIT_OVERDUE');
  passed++;

  // 1E: Boundary Date Precision
  const boundaryRecord = {
    id: 'TEST_BOUNDARY',
    authority: 'CPF',
    validFrom: '2026-09-11',
    validTo: '2026-09-11',
    lastVerifiedDate: '2026-09-11',
    reviewAuditCycleDays: 1,
    sourceStatus: 'VERIFIED'
  };
  assert.strictEqual(
    defaultSourceFreshnessManager.evaluateSourceFreshness(boundaryRecord, '2026-09-11'),
    'ACTIVE_CURRENT',
    'Exact boundary matching referenceDate must be ACTIVE_CURRENT'
  );
  assert.strictEqual(
    defaultSourceFreshnessManager.evaluateSourceFreshness(boundaryRecord, '2026-09-12'),
    'HISTORICAL_SUPERSEDED',
    'Day after validTo must be HISTORICAL_SUPERSEDED'
  );
  console.log('✓ 1E. Proved: Exact boundary dates evaluate correctly across transitions');
  passed++;

  // TEST 2: TARGET DATE RESOLVER CAPABILITIES
  console.log('\n[2. TARGET DATE RESOLVER]');
  // 2A: Explicit DD/MM/YYYY
  const res2A = defaultTargetDateResolver.resolveTargetDate('Purchase happened on 15/03/2023 with GST');
  assert.strictEqual(res2A.targetDate, '2023-03-15');
  assert.strictEqual(res2A.confidence, 'HIGH');
  assert.strictEqual(res2A.source, 'EXPLICIT');
  assert.strictEqual(res2A.isHistorical, true);
  console.log('✓ 2A. Proved: Explicit DD/MM/YYYY parsed to 2023-03-15 with HIGH confidence and isHistorical === true');
  passed++;

  // 2B: Explicit Named Date
  const res2B = defaultTargetDateResolver.resolveTargetDate('Agreement dated 1 April 2026 for office lease');
  assert.strictEqual(res2B.targetDate, '2026-04-01');
  assert.strictEqual(res2B.confidence, 'HIGH');
  assert.strictEqual(res2B.source, 'EXPLICIT');
  console.log('✓ 2B. Proved: Named date "1 April 2026" parsed to 2026-04-01 with HIGH confidence');
  passed++;

  // 2C: Tax Year of Assessment
  const res2C = defaultTargetDateResolver.resolveTargetDate('Can I claim this deduction for YA 2024?');
  assert.strictEqual(res2C.targetDate, '2024-01-01');
  assert.strictEqual(res2C.confidence, 'MEDIUM');
  assert.strictEqual(res2C.source, 'INFERRED');
  assert.strictEqual(res2C.isHistorical, true);
  console.log('✓ 2C. Proved: "for YA 2024" resolved to 2024-01-01 with MEDIUM confidence');
  passed++;

  // 2D: Undated Query does NOT invent historical date
  const res2D = defaultTargetDateResolver.resolveTargetDate('What is the current GST registration threshold?');
  assert.strictEqual(res2D.targetDate, undefined);
  assert.strictEqual(res2D.confidence, 'LOW');
  assert.strictEqual(res2D.source, 'NONE');
  console.log('✓ 2D. Proved: Undated query does NOT invent a historical date (targetDate === undefined)');
  passed++;

  // TEST 3: SFRS(I) KNOWLEDGE EXPANSION
  console.log('\n[3. SFRS(I) KNOWLEDGE EXPANSION]');
  const expectedSfrs = [
    'SFRS_I_1_36_IMPAIRMENT',
    'SFRS_I_1_20_GOVERNMENT_GRANTS',
    'SFRS_I_1_23_BORROWING_COSTS',
    'SFRS_I_1_10_EVENTS_AFTER_REPORTING',
    'SFRS_I_1_8_POLICIES_ESTIMATES_ERRORS'
  ];
  for (const key of expectedSfrs) {
    const rec = UNIFIED_SOURCE_REGISTRY[key];
    assert(rec, `SFRS standard ${key} must exist in registry`);
    assert.strictEqual(rec.domain, 'ACCOUNTING_SFRS');
    assert.strictEqual(rec.sourceStatus, 'NEEDS_REVIEW'); // Curated summary discipline
    assert.strictEqual(rec.evidenceTier, 'CURATED_SUMMARY');
    assert(rec.paragraphOrSection.length > 0, `Paragraph must exist for ${key}`);
  }
  console.log('✓ 3. Proved: All 5 SFRS(I) standards (1-36, 1-20, 1-23, 1-10, 1-8) registered with paragraph citations and curated summary discipline');
  passed++;

  // TEST 4: IRAS / INCOME TAX ACT EXPANSION
  console.log('\n[4. IRAS / INCOME TAX ACT EXPANSION]');
  const expectedIras = [
    { key: 'ITA_SEC37_LOSS_CARRY_FORWARD', section: 'Section 37', textCheck: 'loss incurred by that person' },
    { key: 'ITA_SEC37E_LOSS_CARRY_BACK', section: 'Section 37E', textCheck: '$100,000' },
    { key: 'ITA_SEC13W_EQUITY_DISPOSAL_SAFE_HARBOUR', section: 'Section 13W', textCheck: '20%' },
    { key: 'ITA_SEC45_WITHHOLDING_TAX', section: 'Section 45', textCheck: 'deduct tax therefrom' },
    { key: 'ITA_SEC45A_WITHHOLDING_TAX_ROYALTIES', section: 'Section 45A', textCheck: 'royalties' },
    { key: 'ITA_SEC14Q_RENOVATION_REFURBISHMENT', section: 'Section 14Q', textCheck: '$300,000' }
  ];
  for (const item of expectedIras) {
    const rec = UNIFIED_SOURCE_REGISTRY[item.key];
    assert(rec, `IRAS rule ${item.key} must exist`);
    assert.strictEqual(rec.authority, 'IRAS');
    assert.strictEqual(rec.sourceStatus, 'VERIFIED');
    assert.strictEqual(rec.evidenceTier, 'PRIMARY_SOURCE');
    assert.strictEqual(rec.isVerbatimText, true);
    assert(rec.sourceText.includes(item.textCheck), `Verbatim text for ${item.key} must contain '${item.textCheck}'`);
    assert(rec.officialSourceUrl.includes('sso.agc.gov.sg/Act/ITA1947'), `Canonical SSO URL for ${item.key} must be valid`);
  }
  console.log('✓ 4. Proved: All 6 IRAS corporate tax statutory provisions registered with authentic SSO verbatim text and PRIMARY_SOURCE tier');
  passed++;

  // TEST 5: GST EXPANSION & HISTORICAL RATES
  console.log('\n[5. GST EXPANSION & HISTORICAL RATES]');
  const expectedGst = [
    { key: 'GST_REG28_DE_MINIMIS_RULE', tier: 'PRIMARY_SOURCE', status: 'VERIFIED', isVerbatim: true },
    { key: 'GST_SEC14_REVERSE_CHARGE', tier: 'PRIMARY_SOURCE', status: 'VERIFIED', isVerbatim: true },
    { key: 'GST_REG82_90_BAD_DEBT_RELIEF', tier: 'PRIMARY_SOURCE', status: 'VERIFIED', isVerbatim: true },
    { key: 'GST_SEC11_TIME_OF_SUPPLY', tier: 'PRIMARY_SOURCE', status: 'VERIFIED', isVerbatim: true },
    { key: 'GST_RATE_7_PERCENT', tier: 'PRIMARY_SOURCE', status: 'HISTORICAL', isVerbatim: true, validTo: '2022-12-31' },
    { key: 'GST_RATE_8_PERCENT_2023', tier: 'PRIMARY_SOURCE', status: 'HISTORICAL', isVerbatim: true, validTo: '2023-12-31' },
    { key: 'GST_RATE_9_PERCENT', tier: 'PRIMARY_SOURCE', status: 'VERIFIED', isVerbatim: true, validFrom: '2024-01-01' }
  ];
  for (const item of expectedGst) {
    const rec = UNIFIED_SOURCE_REGISTRY[item.key];
    assert(rec, `GST rule ${item.key} must exist`);
    assert.strictEqual(rec.evidenceTier, item.tier);
    assert.strictEqual(rec.sourceStatus, item.status);
    assert.strictEqual(rec.isVerbatimText, item.isVerbatim);
    if (item.validTo) assert.strictEqual(rec.validTo, item.validTo);
    if (item.validFrom) assert.strictEqual(rec.validFrom, item.validFrom);
  }
  console.log('✓ 5. Proved: GST Reg 28, Sec 14, Regs 82-90, Sec 11, and historical/current GST rates (7%, 8%, 9%) registered cleanly');
  passed++;

  // TEST 6: ACRA / COMPANIES ACT EXPANSION
  console.log('\n[6. ACRA / COMPANIES ACT EXPANSION]');
  const expectedAcra = [
    { key: 'ACRA_SEC156_DIRECTOR_INTEREST_DISCLOSURE', section: 'Section 156' },
    { key: 'ACRA_SEC171_COMPANY_SECRETARY', section: 'Section 171' },
    { key: 'ACRA_SEC142_143_RORC', section: 'Sections 142, 143 & Part 11A' },
    { key: 'ACRA_SEC68_NO_PAR_VALUE_SHARES', section: 'Section 68' },
    { key: 'ACRA_SEC78B_CAPITAL_REDUCTION', section: 'Section 78B & Section 78C' }
  ];
  for (const item of expectedAcra) {
    const rec = UNIFIED_SOURCE_REGISTRY[item.key];
    assert(rec, `ACRA rule ${item.key} must exist`);
    assert.strictEqual(rec.authority, 'ACRA');
    assert.strictEqual(rec.sourceStatus, 'VERIFIED');
    assert.strictEqual(rec.evidenceTier, 'PRIMARY_SOURCE');
    assert.strictEqual(rec.isVerbatimText, true);
    assert.strictEqual(rec.paragraphOrSection, item.section);
    assert(rec.officialSourceUrl.includes('sso.agc.gov.sg/Act/CoA1967'), `Canonical SSO URL for ${item.key} must be valid`);
  }
  console.log('✓ 6. Proved: All 5 Companies Act provisions (§§ 156, 171, 142/143/Part 11A, 68, 78B) registered with authentic SSO verbatim text');
  passed++;

  // TEST 7: CPF & MOM EXPANSION
  console.log('\n[7. CPF & MOM EXPANSION]');
  const expectedCpfMom = [
    { key: 'CPF_ACCOUNT_ALLOCATION_RATES', authority: 'CPF', status: 'VERIFIED' },
    { key: 'CPF_WAGE_CEILING_2024', authority: 'CPF', status: 'HISTORICAL', validTo: '2024-12-31' },
    { key: 'CPF_WAGE_CEILING_2025', authority: 'CPF', status: 'HISTORICAL', validTo: '2025-12-31' },
    { key: 'CPF_WAGE_CEILINGS_2026', authority: 'CPF', status: 'VERIFIED', validFrom: '2026-01-01' },
    { key: 'MOM_SEC36_37_REST_DAY_PAY', authority: 'MOM', status: 'VERIFIED' },
    { key: 'MOM_MANDATORY_RETRENCHMENT_NOTIFICATION', authority: 'MOM', status: 'VERIFIED' },
    { key: 'MOM_CDCA_PARENTAL_LEAVES', authority: 'MOM', status: 'VERIFIED' }
  ];
  for (const item of expectedCpfMom) {
    const rec = UNIFIED_SOURCE_REGISTRY[item.key];
    assert(rec, `CPF/MOM rule ${item.key} must exist`);
    assert.strictEqual(rec.authority, item.authority);
    assert.strictEqual(rec.sourceStatus, item.status);
    assert.strictEqual(rec.evidenceTier, 'PRIMARY_SOURCE');
    assert.strictEqual(rec.isVerbatimText, true);
    if (item.validTo) assert.strictEqual(rec.validTo, item.validTo);
    if (item.validFrom) assert.strictEqual(rec.validFrom, item.validFrom);
  }
  console.log('✓ 7. Proved: CPF allocation, historical ceilings (2024, 2025, 2026), MOM rest day pay, MRN, and CDCA parental leaves registered cleanly');
  passed++;

  // TEST 8: TEMPORAL AMBIGUITY & RETRIEVAL RESOLUTION
  console.log('\n[8. TEMPORAL AMBIGUITY & RETRIEVAL RESOLUTION]');
  
  // 8A: 2023 Invoice -> 8% GST
  const res8A = await defaultSourceRetriever.retrieveSources({
    query: 'What was the GST rate for invoice dated 15/03/2023?',
    domain: 'IRAS_GST',
    maxResults: 3
  });
  assert(res8A.length > 0, 'Must retrieve GST sources');
  assert.strictEqual(res8A[0].id, 'GST_RATE_8_PERCENT_2023', 'Top source for 15/03/2023 must be 8% historical rate');
  console.log('✓ 8A. Proved: 15/03/2023 dated query resolves GST_RATE_8_PERCENT_2023 as top result');
  passed++;

  // 8B: 2022 Invoice -> 7% GST
  const res8B = await defaultSourceRetriever.retrieveSources({
    query: 'What was the GST rate for invoice dated 01/05/2022?',
    domain: 'IRAS_GST',
    maxResults: 3
  });
  assert(res8B.length > 0, 'Must retrieve GST sources');
  assert.strictEqual(res8B[0].id, 'GST_RATE_7_PERCENT', 'Top source for 01/05/2022 must be 7% historical rate');
  console.log('✓ 8B. Proved: 01/05/2022 dated query resolves GST_RATE_7_PERCENT as top result');
  passed++;

  // 8C: Undated Query -> 9% GST (Current In Force)
  const res8C = await defaultSourceRetriever.retrieveSources({
    query: 'What is the standard rate of GST in Singapore?',
    domain: 'IRAS_GST',
    maxResults: 3
  });
  assert(res8C.length > 0, 'Must retrieve GST sources');
  assert.strictEqual(res8C[0].id, 'GST_RATE_9_PERCENT', 'Top source for undated query must be current 9% rate');
  console.log('✓ 8C. Proved: Undated query prioritizes active current 9% GST rate over historical 7% and 8%');
  passed++;

  // 8D: 2024 CPF Ceiling -> CPF_WAGE_CEILING_2024 ($6,800)
  const res8D = await defaultSourceRetriever.retrieveSources({
    query: 'What was the CPF monthly ordinary wage ceiling in 2024?',
    domain: 'CPF_BOARD',
    maxResults: 3
  });
  assert(res8D.length > 0, 'Must retrieve CPF sources');
  assert.strictEqual(res8D[0].id, 'CPF_WAGE_CEILING_2024', 'Top source for 2024 CPF query must be 2024 ceiling ($6,800)');
  console.log('✓ 8D. Proved: 2024 CPF query resolves CPF_WAGE_CEILING_2024 as top result');
  passed++;

  // 8E: Undated CPF Ceiling -> CPF_WAGE_CEILINGS_2026 ($8,000)
  const res8E = await defaultSourceRetriever.retrieveSources({
    query: 'What is the current CPF monthly ordinary wage ceiling?',
    domain: 'CPF_BOARD',
    maxResults: 3
  });
  assert(res8E.length > 0, 'Must retrieve CPF sources');
  assert.strictEqual(res8E[0].id, 'CPF_WAGE_CEILINGS_2026', 'Top source for current CPF query must be 2026 ceiling ($8,000)');
  console.log('✓ 8E. Proved: Current CPF query resolves CPF_WAGE_CEILINGS_2026 as top result');
  passed++;

  // TEST 9: FAST-PATH DETERMINISTIC SAFETY & AUDIT INVARIANTS
  console.log('\n[9. FAST-PATH DETERMINISTIC SAFETY & AUDIT INVARIANTS]');

  // 9A: Audit Overdue source MUST NOT qualify for deterministic fast path
  const mockOverdueEvidence = {
    id: 'MOCK_AUDIT_OVERDUE',
    documentTitle: 'Employment Act 1968',
    paragraphOrSection: 'Section 88A',
    sourceStatus: 'VERIFIED',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    effectiveDate: '2019-04-01',
    freshnessStatus: 'AUDIT_OVERDUE'
  };
  const mockScenarioState = {
    isComplete: true,
    scenarioType: 'STATUTORY_BENCHMARK',
    missingFields: [],
    missingFacts: [],
    directGroups: [{
      citations: [{
        standard: 'Employment Act',
        paragraph: 'Section 88A',
        officialSourceUrl: 'https://sso.agc.gov.sg/Act/EA1968#pr88A-'
      }]
    }]
  };
  const mockGroundedContext = {
    classification: {
      accountingAnalysisRequired: false,
      journalEntryRequired: false,
      intent: 'STATUTORY_BENCHMARK'
    },
    missingFacts: [],
    primaryEvidence: [mockOverdueEvidence],
    officialGuidance: [],
    curatedSummaries: []
  };

  const fastPathAuditCheck = evaluateFastPathEligibility(
    'What is the statutory annual leave under Section 88A?',
    mockScenarioState,
    mockGroundedContext
  );
  assert.strictEqual(fastPathAuditCheck.canBypass, false, 'Audit overdue evidence must reject fast path bypass');
  assert(fastPathAuditCheck.reason.includes('overdue for audit verification'), 'Rejection reason must mention audit verification');
  console.log('✓ 9A. Proved: Invariant enforced — AUDIT_OVERDUE sources are denied fast-path zero-LLM bypass');
  passed++;

  // 9B: Claim Completeness for new Phase 3 Statutory Claims
  const mockContextWithout156 = {
    classification: {
      accountingAnalysisRequired: false,
      journalEntryRequired: false,
      intent: 'STATUTORY_BENCHMARK'
    },
    missingFacts: [],
    primaryEvidence: [], // Missing Section 156
    officialGuidance: [],
    curatedSummaries: []
  };
  const fastPathClaimCheck = evaluateFastPathEligibility(
    'Does a director need to disclose a conflict of interest in a transaction under Section 156?',
    mockScenarioState,
    mockContextWithout156
  );
  assert.strictEqual(fastPathClaimCheck.canBypass, false, 'Missing section 156 evidence must reject fast path bypass');
  assert(fastPathClaimCheck.reason.includes('lacks section-level evidence'), 'Rejection reason must mention section-level evidence');
  console.log('✓ 9B. Proved: Claim completeness requirement enforced for Phase 3 statutory claims (Section 156)');
  passed++;

  // TEST 10: CITATION VERIFICATION & DISCIPLINE FOR NEW PROVISIONS
  console.log('\n[10. CITATION VERIFICATION & DISCIPLINE FOR NEW PROVISIONS]');

  // 10A: Section 13W Safe Harbour Verified Primary Source
  const cite13W = {
    standard: 'Income Tax Act 1947',
    paragraph: 'Section 13W',
    officialSourceUrl: 'https://sso.agc.gov.sg/Act/ITA1947#pr13W-',
    authority: 'IRAS',
    title: 'Exemption of Gains from Disposal of Ordinary Shares',
    text: 'verbatim statute excerpt'
  };
  const ver13W = defaultCitationVerifier.verifyCitation(cite13W);
  assert.strictEqual(ver13W.status, 'VERIFIED_PRIMARY_SOURCE');
  assert.strictEqual(ver13W.isValid, true);
  assert.strictEqual(ver13W.isAuthoritativePrimarySource, true);
  assert(ver13W.matchedRecord, 'Matched record must exist');
  assert.strictEqual(ver13W.matchedRecord.freshnessStatus, 'ACTIVE_CURRENT');
  console.log('✓ 10A. Proved: Section 13W citation verified as ACTIVE_CURRENT VERIFIED_PRIMARY_SOURCE');
  passed++;

  // 10B: Historical 8% GST Rate Citation
  const citeGst8 = {
    standard: 'Goods and Services Tax Act 1993',
    paragraph: 'Section 16',
    officialSourceUrl: 'https://sso.agc.gov.sg/Act/GSTA1993#pr16-',
    authority: 'IRAS',
    title: 'Rate of Tax (Historical 8% for 2023)',
    text: 'historical statute excerpt'
  };
  const verGst8 = defaultCitationVerifier.verifyCitation(citeGst8);
  assert(verGst8.matchedRecord, 'Matched record must exist');
  assert.strictEqual(verGst8.matchedRecord.freshnessStatus, 'HISTORICAL_SUPERSEDED');
  assert.strictEqual(verGst8.matchedRecord.validTo, '2023-12-31');
  console.log('✓ 10B. Proved: Historical 8% GST citation matches HISTORICAL_SUPERSEDED with validTo: 2023-12-31');
  passed++;

  // 10C: SFRS(I) 1-36 Impairment Curated Summary Discipline
  const citeSfrs36 = {
    standard: 'SFRS(I) 1-36',
    paragraph: 'Paragraph 9',
    officialSourceUrl: 'https://www.acra.gov.sg/accountancy/accounting-standards',
    authority: 'ACRA',
    title: 'Impairment of Assets - Identifying an Asset that may be Impaired',
    text: 'An entity shall assess at the end of each reporting period whether there is any indication that an asset may be impaired.'
  };
  const verSfrs36 = defaultCitationVerifier.verifyCitation(citeSfrs36);
  assert.strictEqual(verSfrs36.status, 'SOURCE_NEEDS_REVIEW');
  assert.strictEqual(verSfrs36.isAuthoritativePrimarySource, false);
  console.log('✓ 10C. Proved: SFRS(I) 1-36 citation enforces SOURCE_NEEDS_REVIEW curated summary discipline');
  passed++;

  console.log(`\n=============================================================`);
  console.log(`ALL PHASE 3 COVERAGE & TEMPORAL TESTS PASSED! (${passed}/${passed} GREEN)`);
  console.log(`=============================================================\n`);
}

runPhase3Tests().catch((err) => {
  console.error('Phase 3 test failed:', err);
  process.exit(1);
});

