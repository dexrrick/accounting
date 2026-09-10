import assert from 'assert';
import {
  buildGroundedReasoningContext,
  formatGroundedSystemPrompt,
  postProcessAIResponse,
  extractUserFacts,
  formulateApplicationRules
} from './src/services/groundingContextBuilder.ts';
import { buildAccountingMessages, parseAccountingAIResponse } from './src/services/azureOpenAiService.ts';
import { defaultCitationVerifier } from './src/verification/citationVerifier.ts';
import { classifyQuestion } from './src/classification/questionClassifier.ts';

console.log('=== RUNNING PHASE 2: GROUNDED GEMINI REASONING PIPELINE TESTS ===\n');

async function runTests() {
  let passed = 0;

  // =========================================================================
  // TEST 1: EVIDENCE HIERARCHY STRUCTURE & PROVENANCE
  // =========================================================================
  console.log('[1. EVIDENCE HIERARCHY & FOUR-TIER SEPARATION]');

  const taxContext = await buildGroundedReasoningContext('is business entertainment deductible under section 14(1) of income tax act?');

  // 1A. Primary Evidence only holds verified verbatim primary law
  assert(taxContext.primaryEvidence.length > 0, 'Should retrieve primary evidence for Section 14(1)');
  for (const p of taxContext.primaryEvidence) {
    assert.strictEqual(p.sourceStatus, 'VERIFIED', 'Primary evidence must have sourceStatus === VERIFIED');
    assert.strictEqual(p.sourceType, 'AUTHORITATIVE_SOURCE', 'Primary evidence must have sourceType === AUTHORITATIVE_SOURCE');
    assert.strictEqual(p.isVerbatimText, true, 'Primary evidence must have isVerbatimText === true');
  }
  console.log('✓ 1A. Primary evidence tier strictly populated with verified verbatim provisions');
  passed++;

  // 1B. Curated summaries (SFRS) are strictly separated from primary evidence
  const sfrsContext = await buildGroundedReasoningContext('can we capitalize development costs under sfrs 1-38?');
  assert(sfrsContext.curatedSummaries.length > 0, 'Should retrieve curated summary for SFRS(I) 1-38');
  for (const c of sfrsContext.curatedSummaries) {
    assert(c.isVerbatimText === false, 'Curated summary must have isVerbatimText === false');
    assert(c.sourceStatus === 'NEEDS_REVIEW' || c.sourceType === 'CURATED_SUMMARY', 'Curated summary must be marked NEEDS_REVIEW / CURATED_SUMMARY');
  }
  assert.strictEqual(sfrsContext.primaryEvidence.length, 0, 'SFRS(I) curated summary must NOT leak into primaryEvidence tier');
  console.log('✓ 1B. Curated summaries (SFRS) isolated from primary evidence (no tier leakage)');
  passed++;

  // 1C. System prompt formatting contains all 4 tiers in distinct sections
  const prompt = formatGroundedSystemPrompt(sfrsContext, 'SFRS_I');
  assert(prompt.includes('[1. USER-PROVIDED FACTS]'), 'Prompt must contain section 1');
  assert(prompt.includes('[2. MISSING FACTS (FACTS REQUIRED BEFORE REACHING FINAL CONCLUSION)]'), 'Prompt must contain section 2');
  assert(prompt.includes('[3. EXPLICIT ASSUMPTIONS (ILLUSTRATIVE SCENARIO USE ONLY)]'), 'Prompt must contain section 3');
  assert(prompt.includes('[4. AUTHORITATIVE PRIMARY SOURCE EVIDENCE (VERBATIM STATUTES)]'), 'Prompt must contain section 4');
  assert(prompt.includes('[5. OFFICIAL / CURATED GUIDANCE]'), 'Prompt must contain section 5');
  assert(prompt.includes('[6. CURATED SUMMARIES (SFRS(I) STANDARDS & ACT SUMMARIES - NEEDS REVIEW)]'), 'Prompt must contain section 6');
  assert(prompt.includes('[7. APPLICATION & CALCULATION RULES (DETERMINISTIC LOGIC)]'), 'Prompt must contain section 7');
  assert(prompt.includes('SFRS(I) 1-38'), 'Prompt must include retrieved standard in Section 6');
  assert(!prompt.includes('### Primary Source: Intangible Assets'), 'Curated summary must NOT be labeled as ### Primary Source');
  console.log('✓ 1C. System prompt cleanly formats all 4 evidence tiers with strict labeling');
  passed++;

  // =========================================================================
  // TEST 2: FACTS, MISSING FACTS & ASSUMPTIONS SEPARATION
  // =========================================================================
  console.log('\n[2. FACTS, MISSING FACTS & ASSUMPTIONS SEPARATION]');

  // 2A. Fact extraction extracts explicit numbers and entities without fabrication
  const userQuery = 'We spent SGD 250,000 on 15/04/2026 developing new logistics software';
  const facts = extractUserFacts(userQuery);
  assert(facts.some(f => f.includes('250,000')), 'Must extract numerical quantity 250,000');
  assert(facts.some(f => f.includes('15/04/2026')), 'Must extract transaction date 15/04/2026');
  assert(facts.some(f => f.includes('SGD')), 'Must extract SGD functional currency');
  assert(facts.some(f => f.includes('Software development')), 'Must extract software development entity');
  console.log('✓ 2A. Explicit user facts accurately extracted without inventing undeclared facts');
  passed++;

  // 2B. Missing facts detected for incomplete queries
  const devQuery = 'Can we capitalize 100k software costs?';
  const devContext = await buildGroundedReasoningContext(devQuery);
  assert(devContext.missingFacts.length > 0, 'Must detect missing facts for development expenditure');
  assert(devContext.missingFacts.some(m => m.includes('cumulative') && m.includes('criteria')), 'Must list SFRS(I) 1-38 criteria as missing facts');
  console.log('✓ 2B. Missing facts required for legal conclusion explicitly flagged');
  passed++;

  // 2C. Assumptions are explicit and never convert missing facts into established facts
  const scenarioWithAssumption = {
    scenarioType: 'UNIVERSAL',
    rawQuery: devQuery,
    transactionTitle: 'Software Development',
    functionalCurrency: 'SGD',
    transactionCurrency: 'SGD',
    assumptions: [
      {
        id: 'asm-1',
        field: 'SFRS(I) 1-38 Development Criteria',
        assumedValue: 'All 6 criteria satisfied',
        basisOrRationale: 'User requested illustrative journal entry',
        materiality: 'HIGH'
      }
    ]
  };
  const contextWithAssumption = await buildGroundedReasoningContext(devQuery, scenarioWithAssumption);
  assert.strictEqual(contextWithAssumption.assumptions.length, 1, 'Should include explicit assumption');
  assert.strictEqual(contextWithAssumption.assumptions[0].materiality, 'HIGH', 'Assumption must maintain explicit HIGH materiality');
  assert(contextWithAssumption.missingFacts.length > 0, 'Missing facts must remain unresolved even when assumption is provided');
  console.log('✓ 2C. Explicit assumptions maintain materiality and do NOT silently convert missing facts');
  passed++;

  // =========================================================================
  // TEST 3: TIME-SENSITIVITY & FALLBACK MANDATE
  // =========================================================================
  console.log('\n[3. TIME-SENSITIVITY & UNCERTAINTY FALLBACK MANDATE]');

  // 3A. Prompt mandates the exact fallback statement
  const fallbackInstruction = "I couldn't verify the applicable current source from the available evidence.";
  assert(prompt.includes(fallbackInstruction), 'Prompt must mandate the exact fallback uncertainty string');
  console.log('✓ 3A. Grounding prompt enforces the mandatory uncertainty fallback clause');
  passed++;

  // 3B. postProcessAIResponse enforces the fallback notice if time-sensitive info is missing
  const dummyParsedResponse = {
    scenarioType: 'UNIVERSAL',
    transactionTitle: 'Future Rate Query',
    messageText: 'The rate is estimated based on past years.',
    uncertaintyDisclaimer: ''
  };
  const timeSensitiveContext = {
    classification: classifyQuestion('what is the 2030 cpf rate?'),
    userFacts: [],
    missingFacts: ['2030 statutory rates not gazetted'],
    assumptions: [],
    primaryEvidence: [],
    officialGuidance: [],
    curatedSummaries: [],
    applicationRules: [],
    currentInformationRequired: true
  };

  const processed = postProcessAIResponse(dummyParsedResponse, null, 'what is the 2030 cpf rate?', timeSensitiveContext);
  assert(
    processed.scenarioState.uncertaintyDisclaimer?.includes(fallbackInstruction),
    'postProcessAIResponse must inject the mandatory fallback notice if unverified current information was requested'
  );
  console.log('✓ 3B. postProcessAIResponse automatically enforces fallback disclaimer when current evidence is missing');
  passed++;

  // =========================================================================
  // TEST 4: POST-GENERATION CITATION VERIFICATION
  // =========================================================================
  console.log('\n[4. POST-GENERATION CITATION VERIFICATION ON AI RESPONSES]');

  const mockAiOutputWithCitations = {
    scenarioType: 'UNIVERSAL',
    transactionTitle: 'Multi-Citation Test',
    messageText: 'Detailed analysis',
    directGroups: [
      {
        id: 'grp-1',
        eventDate: '01/01/2026',
        title: 'Mixed Citations Group',
        lines: [
          { id: 'l1', accountCode: '1000', accountName: 'Cash', category: 'ASSET', debit: 100, credit: 0 },
          { id: 'l2', accountCode: '2000', accountName: 'Revenue', category: 'REVENUE', debit: 0, credit: 100 }
        ],
        citations: [
          // Case A: Valid primary statutory source
          {
            standard: 'Income Tax Act 1947',
            paragraph: 'Section 14(1)',
            title: 'General deductions',
            text: 'expenses wholly and exclusively incurred',
            authority: 'IRAS',
            officialSourceUrl: 'https://sso.agc.gov.sg/Act/ITA1947?ProvIds=pr14-'
          },
          // Case B: Valid curated standard summary
          {
            standard: 'SFRS(I) 1-38',
            paragraph: '§57',
            title: 'Development Phase',
            text: 'All 6 criteria required',
            authority: 'ACRA',
            officialSourceUrl: 'https://www.acra.gov.sg/accountancy/accounting-standards'
          },
          // Case C: Fabricated non-existent standard
          {
            standard: 'Singapore Space Accounting Act 2099',
            paragraph: 'Section 1',
            title: 'Space assets',
            text: 'Invented standard',
            authority: 'ACRA',
            officialSourceUrl: 'https://sso.agc.gov.sg/Act/FAKE'
          },
          // Case D: Fabricated paragraph on valid act
          {
            standard: 'Income Tax Act 1947',
            paragraph: 'Section 9999Z',
            title: 'Fabricated section',
            text: 'Invented section',
            authority: 'IRAS',
            officialSourceUrl: 'https://sso.agc.gov.sg/Act/ITA1947'
          },
          // Case E: Authority mismatch
          {
            standard: 'Income Tax Act 1947',
            paragraph: 'Section 14(1)',
            title: 'General deductions',
            text: 'Claimed by ACRA instead of IRAS',
            authority: 'ACRA',
            officialSourceUrl: 'https://sso.agc.gov.sg/Act/ITA1947'
          },
          // Case F: Non-canonical domain URL
          {
            standard: 'Income Tax Act 1947',
            paragraph: 'Section 14(1)',
            title: 'General deductions',
            text: 'Valid provision with random blog URL',
            authority: 'IRAS',
            officialSourceUrl: 'https://random-tax-blog.com/singapore/s14'
          }
        ]
      }
    ]
  };

  const processedAi = postProcessAIResponse(mockAiOutputWithCitations, null, 'test query', taxContext);
  const resultCitations = processedAi.scenarioState.directGroups[0].citations;

  // Verify Case A: Valid primary statutory source
  const citeA = resultCitations[0];
  assert.strictEqual(citeA.verificationStatus, 'VERIFIED_PRIMARY_SOURCE', 'Case A must be VERIFIED_PRIMARY_SOURCE');
  assert.strictEqual(citeA.isAuthoritativePrimarySource, true, 'Case A isAuthoritativePrimarySource must be true');
  assert.strictEqual(citeA.isStructurallyValid, true, 'Case A isStructurallyValid must be true');
  console.log('✓ 4A. Case A: Primary statutory provision verified as VERIFIED_PRIMARY_SOURCE');
  passed++;

  // Verify Case B: Curated summary can NEVER become VERIFIED_PRIMARY_SOURCE
  const citeB = resultCitations[1];
  assert.strictEqual(citeB.verificationStatus, 'SOURCE_NEEDS_REVIEW', 'Case B must be SOURCE_NEEDS_REVIEW');
  assert.strictEqual(citeB.isAuthoritativePrimarySource, false, 'Case B isAuthoritativePrimarySource must be false');
  assert.strictEqual(citeB.isStructurallyValid, true, 'Case B isStructurallyValid must be true');
  console.log('✓ 4B. Case B: Curated standard summary verified as SOURCE_NEEDS_REVIEW (never primary source)');
  passed++;

  // Verify Case C: Fabricated standard
  const citeC = resultCitations[2];
  assert.strictEqual(citeC.verificationStatus, 'SOURCE_NOT_FOUND', 'Case C must be SOURCE_NOT_FOUND');
  assert.strictEqual(citeC.isStructurallyValid, false, 'Case C isStructurallyValid must be false');
  console.log('✓ 4C. Case C: Fabricated standard flagged as SOURCE_NOT_FOUND');
  passed++;

  // Verify Case D: Fabricated paragraph
  const citeD = resultCitations[3];
  assert.strictEqual(citeD.verificationStatus, 'PARAGRAPH_NOT_FOUND', 'Case D must be PARAGRAPH_NOT_FOUND');
  assert.strictEqual(citeD.isStructurallyValid, false, 'Case D isStructurallyValid must be false');
  console.log('✓ 4D. Case D: Fabricated paragraph on valid act flagged as PARAGRAPH_NOT_FOUND');
  passed++;

  // Verify Case E: Authority mismatch
  const citeE = resultCitations[4];
  assert.strictEqual(citeE.verificationStatus, 'AUTHORITY_MISMATCH', 'Case E must be AUTHORITY_MISMATCH');
  assert.strictEqual(citeE.isStructurallyValid, false, 'Case E isStructurallyValid must be false');
  console.log('✓ 4E. Case E: Authority mismatch flagged as AUTHORITY_MISMATCH');
  passed++;

  // Verify Case F: Non-canonical domain
  const citeF = resultCitations[5];
  assert.strictEqual(citeF.verificationStatus, 'NON_CANONICAL_URL', 'Case F must be NON_CANONICAL_URL');
  assert.strictEqual(citeF.isStructurallyValid, false, 'Case F isStructurallyValid must be false');
  console.log('✓ 4F. Case F: External blog URL flagged as NON_CANONICAL_URL');
  passed++;

  // =========================================================================
  // TEST 5: DETERMINISTIC ACCOUNTING ENGINE GUARDRAILS
  // =========================================================================
  console.log('\n[5. DETERMINISTIC ACCOUNTING ENGINE GUARDRAILS]');

  // 5A. Double entry balancing check
  const unbalancedAiOutput = {
    scenarioType: 'UNIVERSAL',
    directGroups: [
      {
        id: 'grp-unbal',
        eventDate: '01/01/2026',
        lines: [
          { id: 'l1', accountCode: '1000', accountName: 'Cash', category: 'ASSET', debit: 500, credit: 0 },
          { id: 'l2', accountCode: '2000', accountName: 'Sales', category: 'REVENUE', debit: 0, credit: 400 }
        ]
      }
    ]
  };
  const processedUnbal = postProcessAIResponse(unbalancedAiOutput, null, 'sale entry', taxContext);
  const unbalGrp = processedUnbal.scenarioState.directGroups[0];
  assert.strictEqual(unbalGrp.totalDebit, 500, 'Total debit must be 500');
  assert.strictEqual(unbalGrp.totalCredit, 400, 'Total credit must be 400');
  assert.strictEqual(unbalGrp.isBalanced, false, 'Entry must be flagged isBalanced: false');
  console.log('✓ 5A. Deterministic balancing guardrail catches and flags unbalanced double entry');
  passed++;

  // 5B. Trade discount guardrail: deducted directly from asset purchase cost (SFRS(I) 1-16 §16(a))
  const invalidTradeDiscountExpenseOutput = {
    scenarioType: 'UNIVERSAL',
    directGroups: [
      {
        id: 'grp-discount',
        eventDate: '01/01/2026',
        lines: [
          { id: 'l1', accountCode: '1500', accountName: 'Office Equipment', category: 'ASSET', debit: 18000, credit: 0 },
          { id: 'l2', accountCode: '5200', accountName: 'Trade Discount Expense', category: 'EXPENSE', debit: 2000, credit: 0 },
          { id: 'l3', accountCode: '1000', accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 20000 }
        ]
      }
    ]
  };
  const processedDiscount = postProcessAIResponse(invalidTradeDiscountExpenseOutput, null, 'equipment with trade discount', taxContext);
  const discLines = processedDiscount.scenarioState.directGroups[0].lines;
  assert(!discLines.some(l => l.accountName.includes('Trade Discount Expense')), 'Expense line for trade discount must be stripped');
  console.log('✓ 5B. Trade discount rule enforced: trade discount expense line removed per SFRS(I) 1-16 §16(a)');
  passed++;

  // =========================================================================
  // TEST 6: PROVIDER CONSISTENCY (GEMINI, OPENAI, AZURE)
  // =========================================================================
  console.log('\n[6. PROVIDER CONSISTENCY]');

  // 6A. buildAccountingMessages formats identically for OpenAI / Azure
  const azureMessages = buildAccountingMessages(
    'can we capitalize development costs?',
    null,
    'SFRS_I',
    [],
    sfrsContext
  );
  assert.strictEqual(azureMessages[0].role, 'system', 'First message must be system prompt');
  assert(azureMessages[0].content.includes('EVIDENCE-FIRST REASONING PRINCIPLES (MANDATORY SAFEGUARDS)'), 'Must contain evidence-first safeguards');
  assert(azureMessages[0].content.includes('[6. CURATED SUMMARIES (SFRS(I) STANDARDS & ACT SUMMARIES - NEEDS REVIEW)]'), 'Must contain 4-tier evidence');
  console.log('✓ 6A. Azure OpenAI and OpenAI message adapter shares identical grounded prompt structure');
  passed++;

  // 6B. parseAccountingAIResponse enforces identical citation verification and guardrails
  const rawAiJson = JSON.stringify(mockAiOutputWithCitations);
  const azureParsed = parseAccountingAIResponse(rawAiJson, null, 'test query', taxContext);
  const azureCitations = azureParsed.scenarioState.directGroups[0].citations;
  assert.strictEqual(azureCitations[0].verificationStatus, 'VERIFIED_PRIMARY_SOURCE', 'Azure parsed output must have Case A verified');
  assert.strictEqual(azureCitations[1].verificationStatus, 'SOURCE_NEEDS_REVIEW', 'Azure parsed output must have Case B marked needs review');
  assert.strictEqual(azureCitations[2].verificationStatus, 'SOURCE_NOT_FOUND', 'Azure parsed output must have Case C rejected');
  console.log('✓ 6B. Azure OpenAI and OpenAI adapter uses identical postProcessAIResponse verification');
  passed++;

  console.log('\n=============================================================');
  console.log(`ALL PHASE 2 TESTS PASSED SUCCESSFULLY! (${passed}/${passed} GREEN)`);
  console.log('=============================================================\n');
}

runTests().catch(err => {
  console.error('Test failure:', err);
  process.exit(1);
});
