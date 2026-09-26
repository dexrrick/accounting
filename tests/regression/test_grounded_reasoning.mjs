import assert from 'assert';
import {
  buildGroundedReasoningContext,
  formatGroundedSystemPrompt,
  postProcessAIResponse,
  extractUserFacts,
  formulateApplicationRules
} from '../../src/services/groundingContextBuilder.ts';
import { buildAccountingMessages, parseAccountingAIResponse } from '../../src/services/azureOpenAiService.ts';
import { defaultCitationVerifier } from '../../src/verification/citationVerifier.ts';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { parseAccountingQuery } from '../../src/engine/scenarioParser.ts';
import { getSafeOfficialUrl } from '../../src/utils/statutoryLinkResolver.ts';

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

  // 4. Citation verification on combined evidence context (containing both primary statutory provision and curated SFRS standard)
  const testEvidenceContext = {
    ...taxContext,
    primaryEvidence: taxContext.primaryEvidence,
    curatedSummaries: sfrsContext.curatedSummaries
  };

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
          // Case A: Valid primary statutory source (in scope)
          {
            standard: 'Income Tax Act 1947',
            paragraph: 'Section 14(1)',
            title: 'General deductions',
            text: 'expenses wholly and exclusively incurred',
            authority: 'IRAS',
            officialSourceUrl: 'https://sso.agc.gov.sg/Act/ITA1947?ProvIds=pr14-'
          },
          // Case B: Valid curated standard summary (in scope, never primary source)
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

  const processedAi = postProcessAIResponse(mockAiOutputWithCitations, null, 'test query', testEvidenceContext);
  const resultCitations = processedAi.scenarioState.directGroups[0].citations;
  const submittedCitations = mockAiOutputWithCitations.directGroups[0].citations;

  // The source record still supports the statutory content, but sourceStatus
  // alone must not cause the unverified URL to appear in the answer.
  const evidenceScope = [...testEvidenceContext.primaryEvidence, ...testEvidenceContext.officialGuidance, ...testEvidenceContext.curatedSummaries];
  const submittedCaseA = submittedCitations[0];
  const verificationA = defaultCitationVerifier.verifyCitation(submittedCaseA, submittedCaseA.authority, evidenceScope);
  assert.strictEqual(verificationA.matchedRecord?.sourceStatus, 'VERIFIED', 'Case A still matches verified statutory content');
  assert.strictEqual(verificationA.matchedRecord?.isVerbatimText, true, 'Case A still matches verbatim primary-source content');
  assert.strictEqual(verificationA.status, 'NON_CANONICAL_URL', 'Case A URL must fail without URL-specific provenance');
  assert.strictEqual(verificationA.isValid, false, 'Case A must not be a clickable citation');
  assert.strictEqual(getSafeOfficialUrl(submittedCaseA.officialSourceUrl, submittedCaseA.standard, submittedCaseA.paragraph, submittedCaseA.authority), '',
    'The display gate must withhold Case A’s unverified URL');
  assert.deepEqual(resultCitations, [], 'An unverified URL must not be retained as a user-facing citation');
  const resultGroup = processedAi.scenarioState.directGroups[0];
  assert.strictEqual(resultGroup.totalDebit, 100, 'Suppressing the citation must preserve the debit');
  assert.strictEqual(resultGroup.totalCredit, 100, 'Suppressing the citation must preserve the credit');
  assert.strictEqual(resultGroup.isBalanced, true, 'Citation suppression must preserve the balanced journal');
  console.log('✓ 4A. Case A: Verified statutory content is retained as evidence but its unverified URL is withheld');
  passed++;

  // Cases B-F are rejected and omitted. Verify their substantive rejection
  // reasons directly rather than expecting invalid citations to remain in the
  // user-facing answer.
  assert.strictEqual(resultCitations.length, 0, 'No citations with unverified URLs should remain in the answer');
  const rejectedCases = [
    ['B', 'NON_CANONICAL_URL'],
    ['C', 'SOURCE_NOT_FOUND'],
    ['D', 'PARAGRAPH_NOT_FOUND'],
    ['E', 'AUTHORITY_MISMATCH'],
    ['F', 'NON_CANONICAL_URL']
  ];
  for (const [caseId, expectedStatus] of rejectedCases) {
    const inputCitation = submittedCitations[caseId.charCodeAt(0) - 'A'.charCodeAt(0)];
    const verification = defaultCitationVerifier.verifyCitation(inputCitation, inputCitation.authority, evidenceScope);
    assert.strictEqual(verification.status, expectedStatus, `Case ${caseId} must retain its specific rejection reason`);
    assert.strictEqual(verification.isValid, false, `Case ${caseId} must not be valid`);
    assert.ok(!resultCitations.some(citation => citation.standard === inputCitation.standard &&
      citation.paragraph === inputCitation.paragraph &&
      citation.officialSourceUrl === inputCitation.officialSourceUrl &&
      citation.authority === inputCitation.authority),
      `Rejected case ${caseId} must be omitted from the user-facing answer`);
  }
  console.log('✓ 4B-F. Invalid, generic, or out-of-scope citations retain distinct rejection reasons and are omitted');
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
  const azureParsed = parseAccountingAIResponse(rawAiJson, null, 'test query', testEvidenceContext);
  const azureCitations = azureParsed.scenarioState.directGroups[0].citations;
  assert.deepEqual(azureCitations, [], 'Azure parsing must also withhold every citation whose URL lacks verified provenance');
  assert.strictEqual(azureParsed.scenarioState.directGroups[0].isBalanced, true,
    'Withholding unverified citation URLs must preserve the balanced journal');
  console.log('✓ 6B. Azure OpenAI and OpenAI adapter uses identical postProcessAIResponse verification');
  passed++;

  // =========================================================================
  // TEST 7: PHASE 2.1 EXPLICIT PROOF SUITE
  // =========================================================================
  console.log('\n[7. PHASE 2.1 EXPLICIT PROOF SUITE]');

  // 7A. Unsupported GST/CPF/tax claims aren't treated as verified
  const taxOnlyContext = await buildGroundedReasoningContext('is business entertainment deductible under section 14(1) of income tax act?');
  const unsupportedCitations = [
    {
      standard: 'Goods and Services Tax Act 1993',
      paragraph: 'First Schedule',
      title: 'GST Compulsory Registration Threshold',
      text: 'taxable turnover exceeds SGD 1,000,000',
      authority: 'IRAS',
      officialSourceUrl: 'https://sso.agc.gov.sg/Act/GSTA1993?ProvIds=P112-#Sc1-'
    },
    {
      standard: 'Central Provident Fund Act 1953',
      paragraph: 'Section 7 & First Schedule',
      title: 'Statutory CPF Contribution Rates & Rounding Rules',
      text: 'employer and employee contributions at statutory rates',
      authority: 'CPF',
      officialSourceUrl: 'https://sso.agc.gov.sg/Act/CPFA1953?ProvIds=P12-#pr7-'
    }
  ];
  const retrievedEvidenceForTax = [
    ...taxOnlyContext.primaryEvidence,
    ...taxOnlyContext.officialGuidance,
    ...taxOnlyContext.curatedSummaries
  ];
  for (const cite of unsupportedCitations) {
    const verified = defaultCitationVerifier.verifyCitation(cite, cite.authority, retrievedEvidenceForTax);
    assert.strictEqual(verified.status, 'NON_CANONICAL_URL', `${cite.standard} URL must be rejected without URL-specific provenance`);
    assert.strictEqual(verified.isValid, false, 'Unsupported citation must not be valid');
    assert.strictEqual(verified.isAuthoritativePrimarySource, false, 'Unsupported claim cannot be authoritative primary source');
    assert.ok(verified.matchedRecord, `${cite.standard} may match registered source content`);
    assert.ok(!retrievedEvidenceForTax.some(record => record.id === verified.matchedRecord.id),
      `${cite.standard} content must remain outside the retrieved evidence scope for this answer`);
  }
  console.log('✓ 7A. PROOF 1: Unsupported GST/CPF/tax sources remain outside answer scope and their unverified URLs are rejected');
  passed++;

  // 7B. Fabricated citations are rejected
  const fakeStdRes = defaultCitationVerifier.verifyCitation({
    standard: 'Imaginary Singapore Tax Law 2099',
    paragraph: 'Section 1',
    authority: 'IRAS',
    officialSourceUrl: 'https://sso.agc.gov.sg/Act/FAKE'
  });
  assert.strictEqual(fakeStdRes.status, 'SOURCE_NOT_FOUND', 'Fabricated standard must be SOURCE_NOT_FOUND');
  assert.strictEqual(fakeStdRes.isValid, false);

  const fakeSecRes = defaultCitationVerifier.verifyCitation({
    standard: 'Income Tax Act 1947',
    paragraph: 'Section 8888ZZ',
    authority: 'IRAS',
    officialSourceUrl: 'https://sso.agc.gov.sg/Act/ITA1947'
  });
  assert.strictEqual(fakeSecRes.status, 'PARAGRAPH_NOT_FOUND', 'Fabricated section must be PARAGRAPH_NOT_FOUND');
  assert.strictEqual(fakeSecRes.isValid, false);
  console.log('✓ 7B. PROOF 2: Fabricated standards and paragraphs are strictly rejected');
  passed++;

  // 7C. Missing material facts produce conditional conclusions
  const devMissingQuery = 'Can we capitalize 100k software development costs?';
  const devMissingContext = await buildGroundedReasoningContext(devMissingQuery);
  assert(devMissingContext.missingFacts.length > 0, 'Must have missing facts for unverified development costs');

  const processedConditional = postProcessAIResponse({
    scenarioType: 'UNIVERSAL',
    messageText: 'We should capitalize this.',
    directGroups: []
  }, null, devMissingQuery, devMissingContext);

  assert.strictEqual(processedConditional.scenarioState.isComplete, false, 'Scenario with missing facts must be isComplete: false');
  assert(processedConditional.scenarioState.missingFacts && processedConditional.scenarioState.missingFacts.length > 0, 'missingFacts must be preserved');
  assert(
    processedConditional.scenarioState.uncertaintyDisclaimer?.includes('conditional upon establishing'),
    'Uncertainty disclaimer must state that conclusion is conditional upon establishing missing facts'
  );
  console.log('✓ 7C. PROOF 3: Missing material facts produce explicitly conditional conclusions');
  passed++;

  // 7D. AI cannot override deterministic journal calculations
  const appleQuery = 'A company primary currency is SGD, it invested USD300k into 300 apple shares on 13/11/2026, subsequently the company sold 300 shares for USD400k on 15/12/2026. What are the double entries and FX gain?';
  const deterministicApple = await parseAccountingQuery(appleQuery);
  assert(deterministicApple.directGroups && deterministicApple.directGroups.length > 0, 'Deterministic engine must generate Apple shares entries');

  // Simulate AI attempting to override journal entries with completely wrong numbers and missing FX gain
  const hallucinatedAiOutput = {
    scenarioType: 'UNIVERSAL',
    transactionTitle: 'Hallucinated AI Response',
    messageText: 'AI explanation with wrong numbers',
    directGroups: [
      {
        id: 'grp-wrong',
        eventDate: '15/12/2026',
        title: 'Hallucinated Entry',
        lines: [
          { id: 'l1', accountCode: '1010', accountName: 'Cash', category: 'ASSET', debit: 999999, credit: 0 },
          { id: 'l2', accountCode: '4000', accountName: 'Revenue', category: 'REVENUE', debit: 0, credit: 999999 }
        ]
      }
    ]
  };

  const appleContext = await buildGroundedReasoningContext(appleQuery);
  const governedResult = postProcessAIResponse(hallucinatedAiOutput, null, appleQuery, appleContext, deterministicApple);

  // Deterministic calculations MUST govern
  const governedGroups = governedResult.scenarioState.directGroups;
  assert.strictEqual(governedGroups.length, deterministicApple.directGroups.length, 'Must have deterministic groups count');
  assert.strictEqual(governedGroups[0].totalDebit, deterministicApple.directGroups[0].totalDebit, 'Deterministic initial debit must govern');
  assert.strictEqual(governedGroups[1].totalDebit, deterministicApple.directGroups[1].totalDebit, 'Deterministic sale debit must govern');
  const fxGainLine = governedGroups[1].lines.find(l => l.accountCode === '4600' || l.accountName.includes('Foreign Exchange'));
  assert(fxGainLine, 'Realized FX gain line from deterministic engine must be present');
  assert.strictEqual(fxGainLine.credit, 6000, 'Realized FX gain must be exactly SGD 6,000 (ECB benchmark rate calculation)');
  console.log('✓ 7D. PROOF 4: AI cannot override deterministic journal calculations (deterministic engine strictly governs)');
  passed++;

  // 7E. No retrieved evidence → no claim presented as authoritative
  const zeroEvidenceContext = {
    classification: classifyQuestion('hypothetical future regulation xyz'),
    userFacts: [],
    missingFacts: [],
    assumptions: [],
    primaryEvidence: [],
    officialGuidance: [],
    curatedSummaries: [],
    applicationRules: [],
    currentInformationRequired: false
  };

  const ungroundedAiOutput = {
    scenarioType: 'UNIVERSAL',
    messageText: 'Under hypothetical law, this is allowable.',
    directGroups: [
      {
        id: 'grp-1',
        eventDate: '01/01/2026',
        lines: [
          { id: 'l1', accountCode: '1000', accountName: 'Cash', category: 'ASSET', debit: 100, credit: 0 },
          { id: 'l2', accountCode: '2000', accountName: 'Sales', category: 'REVENUE', debit: 0, credit: 100 }
        ],
        citations: [
          {
            standard: 'Income Tax Act 1947',
            paragraph: 'Section 14(1)',
            authority: 'IRAS',
            officialSourceUrl: 'https://sso.agc.gov.sg/Act/ITA1947?ProvIds=pr14-'
          }
        ]
      }
    ]
  };

  const zeroEvidenceResult = postProcessAIResponse(ungroundedAiOutput, null, 'hypothetical query', zeroEvidenceContext);
  assert.strictEqual(zeroEvidenceResult.scenarioState.isComplete, false, 'isComplete must be false when 0 evidence is retrieved');
  assert(
    zeroEvidenceResult.scenarioState.uncertaintyDisclaimer?.includes('No authoritative evidence was retrieved'),
    'Mandatory uncertainty disclaimer must be injected when no evidence is retrieved'
  );
  const zeroCitations = zeroEvidenceResult.scenarioState.directGroups[0].citations;
  assert.strictEqual(zeroCitations.length, 0, 'Citation without retrieved evidence must be omitted from the user-facing answer');
  const zeroEvidenceVerification = defaultCitationVerifier.verifyCitation(
    ungroundedAiOutput.directGroups[0].citations[0],
    'IRAS',
    []
  );
  assert.strictEqual(zeroEvidenceVerification.status, 'NON_CANONICAL_URL', 'The citation URL must be rejected before evidence-scope evaluation');
  assert.ok(!zeroEvidenceContext.primaryEvidence.length && !zeroEvidenceContext.officialGuidance.length && !zeroEvidenceContext.curatedSummaries.length,
    'The answer context must remain empty of authoritative source evidence');
  assert.strictEqual(zeroEvidenceVerification.isAuthoritativePrimarySource, false, 'No claim can be presented as authoritative primary source without retrieved evidence');
  console.log('✓ 7E. PROOF 5: No evidence triggers an uncertainty fallback and citation URL suppression');
  passed++;

  // =========================================================================
  // TEST 8: PHASE 2.2 HARDENING SUITE — AUTHORITY STATUS TRIAD & STRUCTURAL VERIFICATION
  // =========================================================================
  console.log('\n[8. PHASE 2.2 HARDENING: AUTHORITY STATUS TRIAD & STRUCTURAL VERIFICATION]');

  // 8A. UNRECOGNIZED transaction journal entries are strictly AI_PROPOSED (never DETERMINISTIC)
  const unrecognizedQuery = 'A company enters into a complex tripartite cross-border swap of non-fungible carbon credits for commodities';
  const unrecContext = await buildGroundedReasoningContext(unrecognizedQuery);
  const unrecDeterministic = await parseAccountingQuery(unrecognizedQuery);
  assert.strictEqual(unrecDeterministic.scenarioType, 'UNRECOGNIZED', 'Transaction must be classified as UNRECOGNIZED');
  assert.strictEqual(unrecDeterministic.authorityStatus, 'AI_PROPOSED', 'Deterministic scenario parser must tag UNRECOGNIZED as AI_PROPOSED');

  const aiProposedPayload = {
    scenarioType: 'UNRECOGNIZED',
    messageText: 'Proposed accounting for cross-border swap.',
    directGroups: [
      {
        id: 'grp-ai-swap',
        title: 'Illustrative Carbon Credit Swap',
        lines: [
          { id: 'l1', accountCode: '1750', accountName: 'Carbon Credit Assets', category: 'ASSET', debit: 50000, credit: 0 },
          { id: 'l2', accountCode: '1010', accountName: 'Cash', category: 'ASSET', debit: 0, credit: 50000 }
        ],
        citations: []
      }
    ]
  };

  const unrecProcessed = postProcessAIResponse(aiProposedPayload, null, unrecognizedQuery, unrecContext, unrecDeterministic);
  assert.strictEqual(unrecProcessed.scenarioState.authorityStatus, 'AI_PROPOSED', 'Unrecognized transaction scenarioState MUST be AI_PROPOSED');
  assert.notStrictEqual(unrecProcessed.scenarioState.authorityStatus, 'DETERMINISTIC', 'Unrecognized transaction MUST NEVER be DETERMINISTIC');
  assert.strictEqual(unrecProcessed.scenarioState.directGroups[0].authorityStatus, 'AI_PROPOSED', 'AI proposed direct group MUST have authorityStatus === AI_PROPOSED');
  console.log('✓ 8A. Unrecognized transactions with AI proposed journals are strictly AI_PROPOSED (never DETERMINISTIC)');
  passed++;

  // 8B. Recognized transactions calculated by the deterministic accounting engine have authorityStatus === 'DETERMINISTIC'
  const recognizedCarQuery = 'Company buys an S-plate passenger car for 100000 for use by employees';
  const carDeterministic = await parseAccountingQuery(recognizedCarQuery);
  assert.strictEqual(carDeterministic.scenarioType, 'CAR_PURCHASE_STATUTORY');
  assert.strictEqual(carDeterministic.authorityStatus, 'DETERMINISTIC');
  assert.strictEqual(carDeterministic.directGroups[0].authorityStatus, 'DETERMINISTIC');

  const carContext = await buildGroundedReasoningContext(recognizedCarQuery);
  const carProcessed = postProcessAIResponse(
    { messageText: 'Car purchase accounting.' },
    null,
    recognizedCarQuery,
    carContext,
    carDeterministic
  );
  assert.strictEqual(carProcessed.scenarioState.authorityStatus, 'DETERMINISTIC', 'Recognized transaction must have authorityStatus === DETERMINISTIC');
  assert.strictEqual(carProcessed.scenarioState.directGroups[0].authorityStatus, 'DETERMINISTIC', 'Recognized directGroup must have authorityStatus === DETERMINISTIC');
  const ambiguousCarQuery = 'Company buys passenger car for 100000 with bank';
  const ambiguousCar = await parseAccountingQuery(ambiguousCarQuery);
  assert.notStrictEqual(ambiguousCar.scenarioType, 'CAR_PURCHASE_STATUTORY', 'A passenger-car purchase without explicit own-use facts must not enter the automatic statutory fast path.');
  assert.ok(!ambiguousCar.statutoryAdvisory?.some(advisory => advisory.isGstClaimable === false), 'Ambiguous recipient/use facts must not receive an unconditional GST block.');
  console.log('✓ 8B. Fully specified recognized transactions computed by deterministic engine receive DETERMINISTIC');
  passed++;

  // 8C. Incomplete queries or missing facts produce CONDITIONAL status
  const conditionalQuery = 'Can we capitalize 150000 software development expenditure?';
  const condDeterministic = await parseAccountingQuery(conditionalQuery);
  assert.strictEqual(condDeterministic.authorityStatus, 'CONDITIONAL', 'SFRS(I) 1-38 without established criteria must be CONDITIONAL');
  assert.strictEqual(condDeterministic.directGroups[0].authorityStatus, 'CONDITIONAL', 'Provisional directGroup must be CONDITIONAL');

  const condContext = await buildGroundedReasoningContext(conditionalQuery);
  const condProcessed = postProcessAIResponse(
    { messageText: 'Assessment under SFRS(I) 1-38.' },
    null,
    conditionalQuery,
    condContext,
    condDeterministic
  );
  assert.strictEqual(condProcessed.scenarioState.authorityStatus, 'CONDITIONAL', 'Missing facts must produce scenarioState.authorityStatus === CONDITIONAL');
  assert.strictEqual(condProcessed.scenarioState.directGroups[0].authorityStatus, 'CONDITIONAL', 'Direct group with missing facts must be CONDITIONAL');
  console.log('✓ 8C. Missing material facts strictly enforce CONDITIONAL status on scenario and direct groups');
  passed++;

  // 8D. Citations processed have structuralVerificationOnly: true
  const taxQuery = 'Is entertainment deductible under Section 14(1)?';
  const taxCtx = await buildGroundedReasoningContext(taxQuery);
  const taxAIOutput = {
    scenarioType: 'UNIVERSAL',
    messageText: 'Deductible if wholly and exclusively incurred.',
    directGroups: [
      {
        id: 'grp-test-tax',
        title: 'Tax Advisory Entry',
        lines: [],
        citations: [
          {
            standard: 'Income Tax Act 1947',
            paragraph: 'Section 14(1)',
            authority: 'IRAS',
            officialSourceUrl: 'https://sso.agc.gov.sg/Act/ITA1947?ProvIds=pr14-'
          }
        ]
      }
    ]
  };
  const taxProcessed = postProcessAIResponse(taxAIOutput, null, taxQuery, taxCtx);
  const taxCite = taxAIOutput.directGroups[0].citations[0];
  const taxVerification = defaultCitationVerifier.verifyCitation(taxCite);
  assert.strictEqual(taxProcessed.scenarioState.directGroups[0].citations.length, 0,
    'Section 14(1) content must not be emitted as a citation with an unverified URL');
  assert.strictEqual(taxVerification.structuralVerificationOnly, true,
    'Citation verifier must retain its structural-verification boundary');
  assert.strictEqual(taxVerification.status, 'NON_CANONICAL_URL',
    'Section 14(1) URL without independent provenance must be rejected');
  assert.strictEqual(getSafeOfficialUrl(taxCite.officialSourceUrl, taxCite.standard, taxCite.paragraph, taxCite.authority), '',
    'The display gate must withhold the Section 14(1) URL');

  // Verify defaultCitationVerifier also returns structuralVerificationOnly: true
  assert.strictEqual(taxVerification.structuralVerificationOnly, true, 'defaultCitationVerifier must declare structuralVerificationOnly: true');
  console.log('✓ 8D. Structural verification boundary remains explicit while unverified statutory URLs are withheld');
  passed++;

  console.log('\n=============================================================');
  console.log(`ALL PHASE 2, 2.1 & 2.2 TESTS PASSED SUCCESSFULLY! (${passed}/${passed} GREEN)`);
  console.log('=============================================================\n');
}

runTests().catch(err => {
  console.error('Test failure:', err);
  process.exit(1);
});
