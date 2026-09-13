import assert from 'assert';
import { parseAccountingQuery } from '../../src/engine/scenarioParser.ts';
import {
  buildGroundedReasoningContext,
  formulateApplicationRules,
  postProcessAIResponse
} from '../../src/services/groundingContextBuilder.ts';
import {
  evaluateFastPathEligibility,
  processAccountingQuery
} from '../../src/services/geminiService.ts';
import { assembleDeterministicResponse } from '../../src/engine/responseAssembler.ts';
import { defaultSourceRetriever } from '../../src/retrieval/sourceRetriever.ts';

console.log('=== RUNNING SIDE QUEST 1.1: ARCHITECTURAL & GROUNDED VERIFICATION TESTS ===\n');

async function runSideQuestTests() {
  let passed = 0;

  // =========================================================================
  // TEST 1: STRICT 6-CONDITION FAST-PATH LOGIC (DETERMINISTIC != AUTHORITATIVE)
  // =========================================================================
  console.log('[1. STRICT 6-CONDITION FAST-PATH LOGIC]');

  // 1A. Fast-path triggers when ALL 6 conditions are met (MOM Statutory Leave)
  const qMomLeave = 'What are MOM statutory annual leave and outpatient sick leave entitlements?';
  const momDeterministic = await parseAccountingQuery(qMomLeave);
  const momContext = await buildGroundedReasoningContext(qMomLeave);
  const momEval = evaluateFastPathEligibility(qMomLeave, momDeterministic, momContext);

  assert.strictEqual(momEval.canBypass, true, 'MOM leave query must satisfy all 6 fast-path conditions');
  assert.strictEqual(momDeterministic.isComplete, true, 'MOM deterministic scenario must be complete');
  assert.strictEqual(momContext.classification.intent, 'STATUTORY_ADVISORY', 'Intent must be STATUTORY_ADVISORY');
  assert.strictEqual(momContext.classification.accountingAnalysisRequired, false, 'No accounting analysis required');
  assert.ok(momContext.primaryEvidence.length > 0, 'Must have retrieved primary evidence');
  console.log('✓ 1A. Fast-path triggers when all 6 conditions are met (verified primary source + deterministic coverage)');
  passed++;

  // 1B. Invariant: Unverified supporting source (NEEDS_REVIEW) PREVENTS fast-path even if isComplete === true
  // Companies Act Section 205C is explicitly marked NEEDS_REVIEW in repository
  const qAcra = 'What are the ACRA Section 205C criteria for small company audit exemption?';
  const acraDeterministic = await parseAccountingQuery(qAcra);
  const acraContext = await buildGroundedReasoningContext(qAcra);
  assert.strictEqual(acraDeterministic.isComplete, true, 'ACRA deterministic engine is complete');
  const acraEval = evaluateFastPathEligibility(qAcra, acraDeterministic, acraContext);
  assert.strictEqual(acraEval.canBypass, false, 'Unverified source (NEEDS_REVIEW) must PREVENT fast-path bypass');
  assert.ok(
    acraEval.reason.includes('NEEDS_REVIEW') || acraEval.reason.includes('not VERIFIED'),
    `Reason must cite unverified source status: ${acraEval.reason}`
  );
  console.log('✓ 1B. Proved: Deterministic != Authoritative (NEEDS_REVIEW source prevents fast-path despite isComplete === true)');
  passed++;

  // 1C. Invariant: Professional accounting interpretation/judgment required PREVENTS fast-path
  const qTradeDiscount = 'Purchase of office equipment list price SGD 20,000 with 10% trade discount, 9% GST, paid 5,000 cash and balance on 30-day credit.';
  const tdDeterministic = await parseAccountingQuery(qTradeDiscount);
  const tdContext = await buildGroundedReasoningContext(qTradeDiscount);
  const tdEval = evaluateFastPathEligibility(qTradeDiscount, tdDeterministic, tdContext);
  assert.strictEqual(tdEval.canBypass, false, 'Transaction requiring accounting classification must NOT bypass Gemini');
  assert.ok(
    tdEval.reason.includes('interpretation') || tdEval.reason.includes('accounting') || tdEval.reason.includes('transaction'),
    `Reason must cite accounting interpretation requirement: ${tdEval.reason}`
  );
  console.log('✓ 1C. Proved: Accounting interpretation/judgment requires LLM (Q8 routes to Gemini)');
  passed++;

  // 1D. Invariant: Share transaction & FX bifurcation requires LLM classification
  const qFxShare = 'A company primary currency is SGD, it invested USD 300k into shares on 13/11/2026, subsequently sold them for USD 400k on 15/12/2026.';
  const fxDeterministic = await parseAccountingQuery(qFxShare);
  const fxContext = await buildGroundedReasoningContext(qFxShare);
  const fxEval = evaluateFastPathEligibility(qFxShare, fxDeterministic, fxContext);
  assert.strictEqual(fxEval.canBypass, false, 'Forex share transaction must NOT bypass Gemini');
  console.log('✓ 1D. Proved: Foreign currency equity transaction routes to Gemini for classification (Q9)');
  passed++;

  // 1E. Invariant: Missing material facts PREVENT fast-path
  const qCapIncomplete = 'Can I capitalise software development costs?';
  const capDeterministic = await parseAccountingQuery(qCapIncomplete);
  const capContext = await buildGroundedReasoningContext(qCapIncomplete);
  const capEval = evaluateFastPathEligibility(qCapIncomplete, capDeterministic, capContext);
  assert.strictEqual(capEval.canBypass, false, 'Incomplete query with missing facts must NOT bypass Gemini');
  console.log('✓ 1E. Missing material facts prevent fast-path');
  passed++;

  // =========================================================================
  // TEST 2: PROMPT PRUNING & REASONING DELEGATION
  // =========================================================================
  console.log('\n[2. PROMPT PRUNING & REASONING DELEGATION]');

  // 2A. Application rules strictly relevant to query domain (no domain cross-contamination)
  const momRules = formulateApplicationRules(momContext.classification, qMomLeave);
  assert(
    !momRules.some(r => r.toLowerCase().includes('foreign') || r.toLowerCase().includes('spot_disposal')),
    'Employment query must NOT contain foreign currency conventions'
  );
  assert(
    !momRules.some(r => r.toLowerCase().includes('supplier trade discount')),
    'Employment query must NOT contain supplier trade discount conventions'
  );
  console.log('✓ 2A. Application rules pruned cleanly without domain cross-contamination');
  passed++;

  // =========================================================================
  // TEST 3: CORRECT JOURNAL DELEGATION & ZERO PLACEHOLDER NUMBERS
  // =========================================================================
  console.log('\n[3. CORRECT JOURNAL DELEGATION & ZERO PLACEHOLDER NUMBERS]');

  // 3A. Q10 Barter Trade: Gemini proposes accounts, amounts are uncalculated, NO $1,000 or $50,000 invented
  const qBarter = 'We exchanged a delivery truck for specialized machinery with another company. How do we account for this barter trade?';
  const barterContext = await buildGroundedReasoningContext(qBarter);
  const barterDeterministic = await parseAccountingQuery(qBarter);

  const mockAiBarterDecision = {
    transactionNature: 'Barter Exchange of PPE Assets',
    treatment: 'Derecognise old delivery truck and capitalise new specialized machinery at fair value under SFRS(I) 1-16 §24.',
    requiredAccounts: [
      { accountName: 'Specialized Machinery - Cost', category: 'ASSET', debitCredit: 'DEBIT', rationale: 'Acquisition of new machinery' },
      { accountName: 'Delivery Truck - Cost', category: 'ASSET', debitCredit: 'CREDIT', rationale: 'Derecognition of surrendered truck' },
      { accountName: 'Accumulated Depreciation - Delivery Truck', category: 'ASSET', debitCredit: 'DEBIT', rationale: 'Derecognition of accumulated depreciation' },
      { accountName: 'Gain or Loss on Disposal of PPE', category: 'EXPENSE', debitCredit: 'DEBIT', rationale: 'Balancing gain/loss on exchange' }
    ],
    citations: [
      { standard: 'SFRS(I) 1-16', paragraph: '§24', authority: 'ASC', officialSourceUrl: 'https://www.acra.gov.sg/accountancy/accounting-standards' }
    ]
  };

  const barterResponse = assembleDeterministicResponse(
    mockAiBarterDecision,
    qBarter,
    null,
    barterContext,
    barterDeterministic,
    'SFRS_I'
  );

  const barterGroup = barterResponse.scenarioState.directGroups?.[0];
  assert.ok(barterGroup, 'Must construct journal group for barter trade');

  // PROOF: Zero placeholder numbers invented (no 1000, no 50000)
  for (const line of barterGroup.lines) {
    assert.strictEqual(line.debit, 0, `Line ${line.accountName} debit must be 0, never arbitrary placeholder`);
    assert.strictEqual(line.credit, 0, `Line ${line.accountName} credit must be 0, never arbitrary placeholder`);
    assert.ok(line.lineExplanation.includes('[Valuation pending determination]'), 'Line explanation must declare valuation pending');
  }

  // PROOF: Journal group is NOT balanced and marked CONDITIONAL
  assert.strictEqual(barterGroup.isBalanced, false, 'Barter entry without valuation must have isBalanced === false');
  assert.strictEqual(barterGroup.authorityStatus, 'CONDITIONAL', 'Barter entry must have authorityStatus === CONDITIONAL');
  assert.strictEqual(barterResponse.scenarioState.authorityStatus, 'CONDITIONAL', 'Scenario must have authorityStatus === CONDITIONAL');
  assert.strictEqual(barterResponse.scenarioState.isComplete, false, 'Scenario must be marked isComplete === false');

  // PROOF: Missing valuation facts explicitly populated
  assert.ok(
    barterResponse.scenarioState.missingFacts?.some(f => f.includes('Fair value') || f.includes('exchange consideration')),
    'Must list fair value/transaction price as missing fact'
  );

  // PROOF: Prominent uncertified proposal callout in markdown
  assert.ok(
    barterResponse.messageText.includes('Uncertified Journal Proposal'),
    'Markdown must include prominent Uncertified Journal Proposal callout'
  );
  assert.ok(
    barterResponse.messageText.includes('Pending Valuation'),
    'Markdown must include Pending Valuation balance check'
  );
  console.log('✓ 3A. Proved: Q10 Barter trade has ZERO invented numbers, isBalanced === false, CONDITIONAL, and uncertified proposal callout');
  passed++;

  // 3B. Deterministic Response Fast-Path via processAccountingQuery
  const fastPathResult = await processAccountingQuery(
    qMomLeave,
    null,
    'SFRS_I',
    'dummy-api-key-that-would-fail-network-call-if-called'
  );

  assert.ok(fastPathResult.messageText.includes('Statutory Directive'), 'Fast-path result must render statutory directive');
  assert.strictEqual(fastPathResult.scenarioState.authorityStatus, 'DETERMINISTIC', 'Fast-path authorityStatus must be DETERMINISTIC');
  console.log('✓ 3B. Fast-path successfully returned structured authoritative response with 0 network calls');
  passed++;

  console.log('\n=============================================================');
  console.log(`ALL SIDE QUEST 1.1 TESTS PASSED SUCCESSFULLY! (${passed}/${passed} GREEN)`);
  console.log('=============================================================\n');
}

runSideQuestTests().catch(err => {
  console.error('Test failure:', err);
  process.exit(1);
});
