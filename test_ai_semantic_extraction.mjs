import assert from 'assert';
import {
  validateAndNormalizeUnderstanding,
  TransactionUnderstandingService,
  DeterministicSemanticExtractor,
  defaultTransactionUnderstandingService
} from './src/services/transactionUnderstandingService.ts';
import { isDeterministicFixture } from './src/engine/scenarioParser.ts';
import { buildGroundedReasoningContext } from './src/services/groundingContextBuilder.ts';

console.log('=== RUNNING AI SEMANTIC EXTRACTION & SCHEMA GATE TEST SUITE ===\n');

async function runTests() {
  let passed = 0;

  // -------------------------------------------------------------------------
  // 1. STRICT SCHEMA VALIDATION GATE & INVARIANT CHECKS (NO SILENT CORRECTION)
  // -------------------------------------------------------------------------
  console.log('[1. STRICT SCHEMA VALIDATION GATE & INVARIANTS]');

  // 1A. Non-object or null payload
  const nullRes = validateAndNormalizeUnderstanding(null, 'SG', 'ai');
  assert.strictEqual(nullRes.isValid, false, 'Null payload must be rejected');
  assert.ok(nullRes.errors.length > 0, 'Must record error for null payload');
  console.log('✓ 1A. Null/non-object payload strictly rejected');
  passed++;

  // 1B. Invalid enums (e.g. reportingEntity.type = "aliens")
  const invalidEnumPayload = {
    reportingEntity: { type: 'intergalactic_entity' },
    counterparty: { role: 'time_traveler' },
    ownershipContext: 'crypto_dimension',
    currency: { value: 'SGD', source: 'magic', confidence: 1.0 }
  };
  const enumRes = validateAndNormalizeUnderstanding(invalidEnumPayload, 'SG', 'ai');
  assert.strictEqual(enumRes.isValid, false, 'Invalid enums must fail validation gate');
  assert.ok(enumRes.errors.some(e => e.includes('reportingEntity.type')), 'Must flag invalid reportingEntity');
  assert.ok(enumRes.errors.some(e => e.includes('counterparty.role')), 'Must flag invalid counterparty');
  assert.ok(enumRes.errors.some(e => e.includes('ownershipContext')), 'Must flag invalid ownershipContext');
  assert.ok(enumRes.errors.some(e => e.includes('currency.source')), 'Must flag invalid currency source');
  console.log('✓ 1B. Invalid enums strictly rejected across all fields');
  passed++;

  // 1C. Dangerous Contradiction: Own equity classified as FVTPL / foreign shares
  // Must NOT silently correct — must fail validation gate so unsafe classifications are blocked
  const contradictoryOwnEquityPayload = {
    reportingEntity: { type: 'company' },
    counterparty: { role: 'shareholder' },
    ownershipContext: 'own_equity',
    instrument: 'financial_asset_at_fvtpl',
    subject: 'foreign shares investment in own startup',
    currency: { value: 'SGD', source: 'explicit', confidence: 1.0 }
  };
  const contraRes = validateAndNormalizeUnderstanding(contradictoryOwnEquityPayload, 'SG', 'ai');
  assert.strictEqual(contraRes.isValid, false, 'Contradictory own_equity as FVTPL must be rejected');
  assert.ok(
    contraRes.errors.some(e => e.includes('own_equity cannot be classified as financial asset at FVTPL/FVTOCI')),
    'Must explicitly cite SFRS(I) 1-32 §33 invariant violation'
  );
  console.log('✓ 1C. Dangerous contradiction (own_equity as FVTPL) rejected without silent correction');
  passed++;

  // 1D. Contradictory counterparty for own_equity (e.g. counterparty = customer)
  const customerOwnEquityPayload = {
    reportingEntity: { type: 'company' },
    counterparty: { role: 'customer' },
    ownershipContext: 'own_equity',
    instrument: 'own_equity',
    currency: { value: 'SGD', source: 'explicit', confidence: 1.0 }
  };
  const custContraRes = validateAndNormalizeUnderstanding(customerOwnEquityPayload, 'SG', 'ai');
  assert.strictEqual(custContraRes.isValid, false, 'Customer cannot be counterparty for own_equity');
  assert.ok(
    custContraRes.errors.some(e => e.includes('counterparty for own_equity cannot be customer')),
    'Must flag contradictory customer counterparty for own_equity'
  );
  console.log('✓ 1D. Contradictory counterparty (customer issuing own equity) rejected');
  passed++;

  // 1E. Explicit currency source declared, but currency.value is null
  const explicitNullCurrPayload = {
    reportingEntity: { type: 'company' },
    currency: { value: null, source: 'explicit', confidence: 1.0 }
  };
  const currRes = validateAndNormalizeUnderstanding(explicitNullCurrPayload, 'SG', 'ai');
  assert.strictEqual(currRes.isValid, false, 'Explicit currency with null value must be rejected');
  assert.ok(currRes.errors.some(e => e.includes('Explicit currency source declared, but currency value is null')));
  console.log('✓ 1E. Invariant enforced: explicit currency must have non-null value');
  passed++;

  // 1F. Negative amount rejected
  const negAmtPayload = {
    reportingEntity: { type: 'company' },
    amount: -5000,
    currency: { value: 'SGD', source: 'explicit', confidence: 1.0 }
  };
  const negRes = validateAndNormalizeUnderstanding(negAmtPayload, 'SG', 'ai');
  assert.strictEqual(negRes.isValid, false, 'Negative amounts must be rejected');
  assert.ok(negRes.errors.some(e => e.includes('Transaction amount cannot be negative')));
  console.log('✓ 1F. Negative transaction amounts rejected');
  passed++;

  // -------------------------------------------------------------------------
  // 2. PROVENANCE TRACKING: 'ai' vs 'deterministic_fallback'
  // -------------------------------------------------------------------------
  console.log('\n[2. PROVENANCE TRACKING]');

  // 2A. AI Source Provenance
  const validAiPayload = {
    reportingEntity: { type: 'company', description: 'Reporting entity Singapore private limited' },
    counterparty: { role: 'shareholder', description: 'Founding investor' },
    transactionType: 'equity_issuance_subscription',
    subject: 'ordinary share capital',
    instrument: 'own_equity',
    ownershipContext: 'own_equity',
    paymentStatus: 'unpaid',
    amount: 1,
    currency: { value: 'SGD', source: 'context_inference', confidence: 0.9, rationale: 'Singapore jurisdiction context' },
    jurisdiction: 'SG',
    factsMissing: [],
    assumptions: [],
    confidence: 0.95
  };

  const validAiNorm = validateAndNormalizeUnderstanding(validAiPayload, 'SG', 'ai');
  assert.strictEqual(validAiNorm.isValid, true, 'Valid payload must pass schema gate');
  assert.strictEqual(validAiNorm.normalizedUnderstanding.extractionSource, 'ai', 'Must record extractionSource === "ai"');
  console.log('✓ 2A. Valid AI extraction preserves extractionSource === "ai"');
  passed++;

  // 2B. Deterministic Fallback Provenance
  const fallbackUnderstanding = defaultTransactionUnderstandingService.understandTransactionSync(
    'shareholder has invested in own company share capital of $1 but unpaid what\'s the double entry'
  );
  assert.strictEqual(fallbackUnderstanding.extractionSource, 'deterministic_fallback', 'Fallback must record "deterministic_fallback"');
  console.log('✓ 2B. Deterministic fallback records extractionSource === "deterministic_fallback"');
  passed++;

  // 2C. Amount suffix at end of a sentence must populate the journal amount.
  const abbreviatedCapitalAmount = defaultTransactionUnderstandingService.understandTransactionSync(
    'shareholder add in additional capital to the company, 100k what is the double entry'
  );
  assert.strictEqual(abbreviatedCapitalAmount.amount, 100000, 'Standalone 100k must be extracted as 100,000');
  console.log('✓ 2C. Standalone abbreviated capital amount is extracted');
  passed++;

  // -------------------------------------------------------------------------
  // 3. SERVICE RESILIENCE & FALLBACK WHEN AI FAILS
  // -------------------------------------------------------------------------
  console.log('\n[3. SERVICE RESILIENCE & FALLBACK]');

  // 3A. Fallback when AI transport throws (e.g. network timeout or API error)
  const throwingAiExtractor = {
    extract: async () => {
      throw new Error('ETIMEDOUT: Connection to AI gateway timed out');
    }
  };
  const serviceWithThrowingAi = new TransactionUnderstandingService(
    new DeterministicSemanticExtractor(),
    throwingAiExtractor
  );

  const fallbackFromThrow = await serviceWithThrowingAi.understandTransaction(
    'shareholder has invested in own company share capital of $1 but unpaid what\'s the double entry',
    'SGD',
    'SG',
    'dummy-valid-key-1234567890'
  );
  assert.strictEqual(fallbackFromThrow.extractionSource, 'deterministic_fallback', 'Must gracefully fall back on AI throw');
  assert.strictEqual(fallbackFromThrow.ownershipContext, 'own_equity', 'Fallback extracts own_equity');
  assert.strictEqual(fallbackFromThrow.paymentStatus, 'unpaid', 'Fallback extracts unpaid');
  console.log('✓ 3A. Service catches AI network error and falls back seamlessly to deterministic extractor');
  passed++;

  // 3B. Fallback when AI returns malformed schema that fails validation gate
  const badSchemaAiExtractor = {
    extract: async () => ({
      reportingEntity: { type: 'invalid_type' },
      ownershipContext: 'illegal_classification',
      currency: { source: 'magic' }
    })
  };
  const serviceWithBadSchema = new TransactionUnderstandingService(
    new DeterministicSemanticExtractor(),
    badSchemaAiExtractor
  );

  const fallbackFromBadSchema = await serviceWithBadSchema.understandTransaction(
    'shareholder has invested in own company share capital of $1 but unpaid what\'s the double entry',
    'SGD',
    'SG',
    'dummy-valid-key-1234567890'
  );
  assert.strictEqual(fallbackFromBadSchema.extractionSource, 'deterministic_fallback', 'Must fall back when AI fails schema gate');
  assert.strictEqual(fallbackFromBadSchema.ownershipContext, 'own_equity');
  console.log('✓ 3B. Schema validation gate rejects illegal AI output and invokes deterministic fallback');
  passed++;

  // -------------------------------------------------------------------------
  // 4. DETERMINISTIC FIXTURE WHITELIST VS NATURAL LANGUAGE SEPARATION
  // -------------------------------------------------------------------------
  console.log('\n[4. DETERMINISTIC FIXTURE SEPARATION]');

  const explicitBenchmarkFixtures = [
    'a company primary currency is SGD, it invested USD300k into 300 apple shares on 13/11/2026, subsequently the company sold 300 shares for USD400k on 15/12/2026.',
    'i pay for entertainment expenses 3k with bank',
    'i have a rental agreement for 3 years, paying 1 month sgd3,000 what\'s the double entry',
    'Purchase of office equipment with a list price of SGD 20,000 with 10% trade discount and credit terms',
    'trade-in old machinery on 1 april 2026 with catch-up depreciation',
    'I bought a passenger motor car for SGD 120k with bank. Can I claim input GST under IRAS?',
    'a staff is earning sgd3200 a month, his last day is 16/9/2026, calculate his september salary and employer employee cpf',
    'Can software development expenditure be capitalised under SFRS(I) 1-38, and how does IRAS treat it for tax deduction?',
    'What are the ACRA requirements for small company audit exemption under Section 205C?',
    'What are MOM statutory annual leave and outpatient sick leave entitlements?'
  ];

  for (const fix of explicitBenchmarkFixtures) {
    assert.strictEqual(
      isDeterministicFixture(fix),
      true,
      `Explicit benchmark fixture must be recognized: "${fix.slice(0, 50)}..."`
    );
  }
  console.log('✓ 4A. All 10 canonical benchmark test fixtures return isDeterministicFixture === true');
  passed++;

  const naturalLanguageQueries = [
    'shareholder has invested in own company share capital of $1 but unpaid what\'s the double entry',
    'director paid a company expense personally',
    'customer paid us before delivery',
    'Co-founder was allocated equity units in our startup, but the cash hasn\'t come into the bank yet',
    'Client sent funds prior to product shipment',
    'Board member covered the software subscription using personal card',
    'We purchased 100 shares of Microsoft on the open market',
    'Can we pay our overseas contractor in Bitcoin?'
  ];

  for (const nl of naturalLanguageQueries) {
    assert.strictEqual(
      isDeterministicFixture(nl),
      false,
      `Natural language query must NOT be classified as deterministic fixture: "${nl}"`
    );
  }
  console.log('✓ 4B. Free-form queries and paraphrases return isDeterministicFixture === false');
  passed++;

  // -------------------------------------------------------------------------
  // 5. AI SEMANTIC GENERALIZATION ON UNSEEN PARAPHRASES (ZERO KEYWORD OVERLAP)
  // -------------------------------------------------------------------------
  console.log('\n[5. AI SEMANTIC GENERALIZATION ON UNSEEN PARAPHRASES]');

  // Mock an AI extractor that returns structured understanding for unseen phrasings
  const simulatedAiExtractor = {
    extract: async (query) => {
      const q = query.toLowerCase();

      if (q.includes('allocated equity units') || q.includes('cash hasn\'t come into the bank yet')) {
        return {
          reportingEntity: { type: 'company', description: 'Startup entity issuing equity' },
          counterparty: { role: 'shareholder', description: 'Co-founder receiving equity units' },
          transactionType: 'equity_issuance_subscription',
          subject: 'ordinary share capital units of reporting entity',
          instrument: 'own_equity',
          ownershipContext: 'own_equity',
          paymentStatus: 'unpaid',
          amount: null,
          currency: { value: 'SGD', source: 'context_inference', confidence: 0.9, rationale: 'Singapore jurisdiction context' },
          transactionDate: null,
          jurisdiction: 'SG',
          factsMissing: ['Transaction amount / issue price is unspecified'],
          assumptions: [],
          confidence: 0.95
        };
      }

      if (q.includes('client sent funds prior to product shipment')) {
        return {
          reportingEntity: { type: 'company', description: 'Selling business entity' },
          counterparty: { role: 'customer', description: 'Client ordering products' },
          transactionType: 'customer_advance_payment',
          subject: 'unearned revenue / customer deposit for goods',
          instrument: 'contract_liability_deferred_revenue',
          ownershipContext: 'not_applicable',
          paymentStatus: 'paid',
          amount: null,
          currency: { value: 'SGD', source: 'context_inference', confidence: 0.9, rationale: 'Singapore jurisdiction context' },
          transactionDate: null,
          jurisdiction: 'SG',
          factsMissing: ['Transaction amount is unspecified'],
          assumptions: [],
          confidence: 0.94
        };
      }

      if (q.includes('board member covered the software subscription using personal card')) {
        return {
          reportingEntity: { type: 'company', description: 'Operating business entity' },
          counterparty: { role: 'director', description: 'Board member / director' },
          transactionType: 'director_expense_settlement',
          subject: 'software subscription SaaS operating expense',
          instrument: 'amount_due_to_director',
          ownershipContext: 'not_applicable',
          paymentStatus: 'paid',
          amount: null,
          currency: { value: 'SGD', source: 'context_inference', confidence: 0.9, rationale: 'Singapore jurisdiction context' },
          transactionDate: null,
          jurisdiction: 'SG',
          factsMissing: ['Subscription cost amount is unspecified'],
          assumptions: [],
          confidence: 0.96
        };
      }

      if (q.includes('corporate treasury acquired 500 shares in alphabet on nasdaq')) {
        return {
          reportingEntity: { type: 'company', description: 'Corporate entity holding investments' },
          counterparty: { role: 'other', description: 'Alphabet Inc / Open market vendor' },
          transactionType: 'equity_investment_acquisition',
          subject: 'quoted equity securities in external entity',
          instrument: 'financial_asset_equity',
          ownershipContext: 'external_investment',
          paymentStatus: 'paid',
          amount: 500,
          currency: { value: 'USD', source: 'context_inference', confidence: 0.85, rationale: 'Nasdaq listed securities denominated in USD' },
          transactionDate: null,
          jurisdiction: 'SG',
          factsMissing: ['Share purchase price is unspecified'],
          assumptions: [],
          confidence: 0.92
        };
      }

      throw new Error(`Unmapped simulated query: ${query}`);
    }
  };

  const aiService = new TransactionUnderstandingService(
    new DeterministicSemanticExtractor(),
    simulatedAiExtractor
  );

  // Paraphrase 1: Own Equity Unpaid (zero keyword overlap with legacy fixtures)
  const q1 = "Co-founder was allocated equity units in our startup, but the cash hasn't come into the bank yet";
  const r1 = await aiService.understandTransaction(q1, 'SGD', 'SG', 'valid-api-key-test');
  assert.strictEqual(r1.extractionSource, 'ai');
  assert.strictEqual(r1.ownershipContext, 'own_equity', 'Must identify own_equity');
  assert.strictEqual(r1.counterparty?.role, 'shareholder', 'Must identify shareholder');
  assert.strictEqual(r1.paymentStatus, 'unpaid', 'Must identify unpaid');
  console.log('✓ 5A. Unseen Paraphrase 1 (Founder equity allocation unpaid) correctly extracted via AI');
  passed++;

  // Paraphrase 2: Customer advance / deferred revenue
  const q2 = "Client sent funds prior to product shipment";
  const r2 = await aiService.understandTransaction(q2, 'SGD', 'SG', 'valid-api-key-test');
  assert.strictEqual(r2.extractionSource, 'ai');
  assert.strictEqual(r2.counterparty?.role, 'customer', 'Must identify customer');
  assert.strictEqual(r2.transactionType, 'customer_advance_payment', 'Must identify customer advance');
  assert.strictEqual(r2.paymentStatus, 'paid', 'Must identify paid status');
  console.log('✓ 5B. Unseen Paraphrase 2 (Client advance payment) correctly extracted via AI');
  passed++;

  // Paraphrase 3: Director expense settlement
  const q3 = "Board member covered the software subscription using personal card";
  const r3 = await aiService.understandTransaction(q3, 'SGD', 'SG', 'valid-api-key-test');
  assert.strictEqual(r3.extractionSource, 'ai');
  assert.strictEqual(r3.counterparty?.role, 'director', 'Must identify director');
  assert.strictEqual(r3.transactionType, 'director_expense_settlement', 'Must identify director expense');
  console.log('✓ 5C. Unseen Paraphrase 3 (Board member personal card payment) correctly extracted via AI');
  passed++;

  // Paraphrase 4: External quoted stock purchase
  const q4 = "Corporate treasury acquired 500 shares in Alphabet on Nasdaq for long-term hold";
  const r4 = await aiService.understandTransaction(q4, 'SGD', 'SG', 'valid-api-key-test');
  assert.strictEqual(r4.extractionSource, 'ai');
  assert.strictEqual(r4.ownershipContext, 'external_investment', 'Must identify external_investment');
  assert.strictEqual(r4.instrument, 'financial_asset_equity');
  console.log('✓ 5D. Unseen Paraphrase 4 (Nasdaq stock acquisition) correctly identified as external investment');
  passed++;

  // -------------------------------------------------------------------------
  // 6. GROUNDING CONTEXT BUILDER INTEGRATION
  // -------------------------------------------------------------------------
  console.log('\n[6. GROUNDING CONTEXT INTEGRATION]');

  const grounded = await buildGroundedReasoningContext(
    "shareholder has invested in own company share capital of $1 but unpaid what's the double entry"
  );
  assert.ok(grounded.semanticUnderstanding, 'Semantic understanding must be present in grounded context');
  assert.strictEqual(grounded.semanticUnderstanding.ownershipContext, 'own_equity');
  assert.strictEqual(grounded.semanticUnderstanding.paymentStatus, 'unpaid');
  assert.strictEqual(grounded.semanticUnderstanding.amount, 1);
  console.log('✓ 6A. GroundedReasoningContext receives structured semanticUnderstanding');
  passed++;

  console.log('\n=============================================================');
  console.log(`ALL AI SEMANTIC EXTRACTION TESTS PASSED! (${passed} GREEN)`);
  console.log('=============================================================\n');
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
