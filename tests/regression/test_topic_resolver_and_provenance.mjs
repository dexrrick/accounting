import assert from 'assert';
import { defaultQueryTopicResolver } from '../../src/retrieval/queryTopicResolver.ts';
import { DeterministicSemanticAlignmentEvaluator } from '../../src/retrieval/semanticAlignmentEvaluator.ts';
import { RetrievalTelemetryRecorder } from '../../src/retrieval/retrievalTelemetry.ts';
import {
  DeterministicSemanticExtractor,
  TransactionUnderstandingService,
  validateAndNormalizeUnderstanding
} from '../../src/services/transactionUnderstandingService.ts';
import {
  commitAccountingEvent,
  deriveAccountingStateFromEvents,
  validateAccountingStateTransition
} from '../../src/services/conversationAccountingState.ts';

async function runTopicResolverAndProvenanceTests() {
  console.log('================================================================');
  console.log('🧪 RUNNING TOPIC RESOLVER SEMANTICS & PROVENANCE SEPARATION TESTS');
  console.log('================================================================\n');

  let passed = 0;
  const evaluator = new DeterministicSemanticAlignmentEvaluator();
  const resolver = defaultQueryTopicResolver;

  // Mock chunk and record helpers
  const mockRecord = (id, metadata = {}) => ({
    id,
    documentTitle: metadata.documentTitle || 'Statute Document',
    standardOrActCode: metadata.standardOrActCode || 'Companies Act 1967',
    paragraphOrSection: metadata.paragraphOrSection || 'Section 68',
    authorityName: metadata.authorityName || 'ACRA',
    evidenceTier: metadata.evidenceTier || 'PRIMARY_SOURCE',
    sourceType: 'AUTHORITATIVE_SOURCE',
    sourceStatus: 'VERIFIED',
    validFrom: '2020-01-01',
    validTo: '2099-12-31',
    isVerbatimText: true,
    officialSourceUrl: 'https://sso.agc.gov.sg',
    tags: metadata.tags || []
  });

  const mockChunk = (id, parentRecordId, text = 'Statutory provision text', section = '68') => ({
    id,
    parentRecordId,
    chunkText: text,
    startOffset: 0,
    endOffset: text.length,
    sourceLocator: { section },
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    authority: 'ACRA',
    validFrom: '2020-01-01',
    validTo: '2099-12-31',
    sourceStatus: 'VERIFIED',
    isVerbatimText: true,
    tags: []
  });

  // -------------------------------------------------------------------------
  // TEST 1: PRIMARY SEMANTIC TOPIC RESOLUTION (Lease Contract Inception)
  // -------------------------------------------------------------------------
  console.log('[TEST 1: Primary Semantic Topic Resolution (Implicit Lease)]');
  {
    const query = 'Our company signed a 3-year commercial vehicle contract payable $2,000 monthly.';
    const semanticContext = {
      reportingEntity: { type: 'standalone_private' },
      transactionType: 'lease_contract',
      instrument: 'right_of_use_asset',
      ownershipContext: 'not_applicable',
      confidence: 0.95,
      provenance: {
        tier: 'AI_REASONING',
        isFallback: false,
        engine: 'GEMINI_2_5_FLASH',
        appliedRules: [],
        confidenceCapped: false,
        timestamp: new Date().toISOString()
      }
    };

    const result = resolver.decomposeQuery(query, semanticContext);
    const leaseTopic = result.topics.find(t => t.id === 'sfrsi_leases');
    assert(leaseTopic, 'sfrsi_leases must be resolved via semantic criteria');
    assert.strictEqual(leaseTopic.matchSource, 'semantic_primary', 'Match source must be semantic_primary');
    assert(leaseTopic.primarySignalScore >= 0.9, `Primary signal score should reflect semantic confidence (${leaseTopic.primarySignalScore})`);
    console.log('  ✓ Implicit lease query accurately resolved to sfrsi_leases as semantic_primary');
    passed++;
  }

  // -------------------------------------------------------------------------
  // TEST 2: PRIMARY SEMANTIC TOPIC RESOLUTION (R&D Development Costs)
  // -------------------------------------------------------------------------
  console.log('\n[TEST 2: Primary Semantic Topic Resolution (Software R&D)]');
  {
    const query = 'We invested $150k developing our proprietary internal trading platform.';
    const semanticContext = {
      reportingEntity: { type: 'standalone_private' },
      transactionType: 'rd_capitalization',
      instrument: 'intangible_asset',
      ownershipContext: 'not_applicable',
      confidence: 0.90,
      provenance: {
        tier: 'AI_REASONING',
        isFallback: false,
        engine: 'GEMINI_2_5_FLASH',
        appliedRules: [],
        confidenceCapped: false,
        timestamp: new Date().toISOString()
      }
    };

    const result = resolver.decomposeQuery(query, semanticContext);
    const intangiblesTopic = result.topics.find(t => t.id === 'sfrsi_intangibles_cap');
    assert(intangiblesTopic, 'sfrsi_intangibles_cap must be resolved via structured semantics');
    assert.strictEqual(intangiblesTopic.matchSource, 'semantic_primary', 'Must be semantic_primary when statutory keywords omitted');
    console.log('  ✓ Proprietary platform development resolved to sfrsi_intangibles_cap');
    passed++;
  }

  // -------------------------------------------------------------------------
  // TEST 3: PRIMARY SEMANTIC TOPIC RESOLUTION (External Investment) & NARROWED CONFLICT
  // -------------------------------------------------------------------------
  console.log('\n[TEST 3: Primary Semantic Topic Resolution & Narrowed Conflict (External Investment)]');
  {
    const query = 'Acquired ordinary shares in an overseas tech company for portfolio investment.';
    const semanticContext = {
      reportingEntity: { type: 'standalone_private' },
      transactionType: 'equity_investment_acquisition',
      ownershipContext: 'external_investment',
      instrument: 'financial_asset_equity',
      confidence: 0.92,
      provenance: {
        tier: 'AI_REASONING',
        isFallback: false,
        engine: 'GEMINI_2_5_FLASH',
        appliedRules: [],
        confidenceCapped: false,
        timestamp: new Date().toISOString()
      }
    };

    const result = resolver.decomposeQuery(query, semanticContext);
    const finTopic = result.topics.find(t => t.id === 'sfrsi_financial_instruments');
    assert(finTopic, 'sfrsi_financial_instruments must be resolved for external entity instruments');
    assert.strictEqual(finTopic.matchSource, 'semantic_primary');

    // Invariant: Companies Act §199 (record keeping) must NEVER conflict with external investments
    const recCA199 = mockRecord('REC_CA_199', { standardOrActCode: 'Companies Act 1967', paragraphOrSection: 'Section 199' });
    const chkCA199 = mockChunk('CHK_CA_199', recCA199.id, 'Accounting records and keeping of accounts', '199');
    const scoreCA199 = evaluator.evaluateAlignment(chkCA199, recCA199, semanticContext);
    assert.strictEqual(scoreCA199.hasSemanticConflict, false, 'CA §199 must NOT conflict with external investments');
    assert.strictEqual(scoreCA199.penalty, 0, 'CA §199 penalty must be 0');
    assert.strictEqual(scoreCA199.finalDeltaSemantics, 0, 'CA §199 final delta must be 0 (neutral)');

    // Invariant: Companies Act §68 (own share allotment) MUST conflict with external investments
    const recCA68 = mockRecord('REC_CA_68', { standardOrActCode: 'Companies Act 1967', paragraphOrSection: 'Section 68' });
    const chkCA68 = mockChunk('CHK_CA_68', recCA68.id, 'Abolition of par value / allotment of shares', '68');
    const scoreCA68 = evaluator.evaluateAlignment(chkCA68, recCA68, semanticContext);
    assert.strictEqual(scoreCA68.hasSemanticConflict, true, 'CA §68 MUST conflict with external investments');
    assert(scoreCA68.penalty < 0, 'CA §68 penalty must be negative');
    assert(scoreCA68.finalDeltaSemantics < 0, 'CA §68 final delta must be negative');

    // Invariant: SFRS(I) 9 must positively align with external investments
    const recSfrsi9 = mockRecord('REC_SFRSI9', { standardOrActCode: 'SFRS(I) 9', paragraphOrSection: 'Section 5.1.1' });
    const chkSfrsi9 = mockChunk('CHK_SFRSI9', recSfrsi9.id, 'Financial asset initial measurement', '5.1.1');
    const scoreSfrsi9 = evaluator.evaluateAlignment(chkSfrsi9, recSfrsi9, semanticContext);
    assert.strictEqual(scoreSfrsi9.hasSemanticConflict, false, 'SFRS(I) 9 must not conflict');
    assert(scoreSfrsi9.boost > 0, 'SFRS(I) 9 must receive positive boost');
    assert(scoreSfrsi9.finalDeltaSemantics > 0, 'SFRS(I) 9 final delta must be positive');

    console.log('  ✓ External investment resolved to sfrsi_financial_instruments (semantic_primary)');
    console.log('  ✓ Verified: CA §199 does NOT conflict (neutral: 0.00)');
    console.log('  ✓ Verified: CA §68 properly conflicts (penalty applied)');
    console.log('  ✓ Verified: SFRS(I) 9 receives positive alignment boost');
    passed++;
  }

  // -------------------------------------------------------------------------
  // TEST 4: NEGATIVE SEMANTIC-TOPIC INVARIANT (Primary-Topic Pruning)
  // -------------------------------------------------------------------------
  console.log('\n[TEST 4: Negative Semantic-Topic Invariant (Pruning Incidental Mentions)]');
  {
    // The query contains incidental/negated words: "lease", "share"
    const query = 'We purchased office supplies for $200, definitely not a lease and not issuing any shares.';
    const semanticContext = {
      reportingEntity: { type: 'standalone_private' },
      transactionType: 'expense_payment',
      ownershipContext: 'not_applicable',
      confidence: 0.95,
      provenance: {
        tier: 'AI_REASONING',
        isFallback: false,
        engine: 'GEMINI_2_5_FLASH',
        appliedRules: [],
        confidenceCapped: false,
        timestamp: new Date().toISOString()
      }
    };

    const result = resolver.decomposeQuery(query, semanticContext);
    const hasLease = result.topics.some(t => t.id === 'sfrsi_leases');
    const hasShares = result.topics.some(t => t.id === 'acra_share_capital');
    const hasExpenseDeduction = result.topics.some(t => t.id === 'cit_section_14');

    assert(!hasLease, 'sfrsi_leases must be PRUNED by blockedByTransactionTypes: [expense_payment]');
    assert(!hasShares, 'acra_share_capital must be PRUNED by blockedByTransactionTypes: [expense_payment]');
    assert(hasExpenseDeduction, 'cit_section_14 should match validly for expense_payment');
    console.log('  ✓ Incidental mentions pruned: sfrsi_leases and acra_share_capital suppressed');
    console.log('  ✓ Appropriate topic retained: cit_section_14 matched');
    passed++;
  }

  // -------------------------------------------------------------------------
  // TEST 5: NEUTRALITY OF "UNKNOWN" ATTRIBUTES
  // -------------------------------------------------------------------------
  console.log('\n[TEST 5: Strict Neutrality of "unknown" and Unclassified Attributes]');
  {
    const unknownContext = {
      reportingEntity: { type: 'unknown' },
      transactionType: 'unclassified_transaction',
      ownershipContext: 'unknown',
      instrument: 'unknown',
      counterparty: { role: 'unknown' },
      confidence: 0.10,
      provenance: {
        tier: 'AI_REASONING',
        isFallback: false,
        engine: 'MOCK',
        appliedRules: [],
        confidenceCapped: false,
        timestamp: new Date().toISOString()
      }
    };

    // Evaluator check: unknown attributes must yield zero delta and no matches/conflicts
    const rec = mockRecord('REC_CA_S68', { standardOrActCode: 'Companies Act 1967', paragraphOrSection: 'Section 68' });
    const chk = mockChunk('CHK_1', rec.id);
    const evalScore = evaluator.evaluateAlignment(chk, rec, unknownContext);

    assert.strictEqual(evalScore.baseDeltaSemantics, 0.0, 'baseDeltaSemantics must be 0 for unknown attributes');
    assert.strictEqual(evalScore.finalDeltaSemantics, 0.0, 'finalDeltaSemantics must be 0 for unknown attributes');
    assert.strictEqual(evalScore.matchedAttributes.length, 0, 'No attributes should match for unknown');
    assert.strictEqual(evalScore.conflictAttributes.length, 0, 'No attributes should conflict for unknown');
    assert.strictEqual(evalScore.hasSemanticConflict, false, 'hasSemanticConflict must be false');

    // Topic resolver check: unknown attributes must not trigger any semantic matching
    const res = resolver.decomposeQuery('General question regarding corporate structure', unknownContext);
    const semanticMatched = res.topics.filter(t => t.matchSource === 'semantic_primary');
    assert.strictEqual(semanticMatched.length, 0, 'No topics should match semantically with unknown attributes');
    console.log('  ✓ Evaluator returned delta = 0.00 and 0 matches/conflicts for unknown attributes');
    console.log('  ✓ Topic resolver generated 0 spurious semantic matches');
    passed++;
  }

  // -------------------------------------------------------------------------
  // TEST 6: AI FULL SEMANTIC WEIGHTING (Multiplier = 1.0)
  // -------------------------------------------------------------------------
  console.log('\n[TEST 6: AI Full Semantic Weighting (1.0x)]');
  {
    const aiContext = {
      reportingEntity: { type: 'standalone_private' },
      transactionType: 'share_capital_issuance',
      ownershipContext: 'own_equity',
      counterparty: { role: 'shareholder' },
      confidence: 0.95,
      provenance: {
        tier: 'AI_REASONING',
        isFallback: false,
        engine: 'GEMINI_2_5_FLASH',
        appliedRules: [],
        confidenceCapped: false,
        timestamp: new Date().toISOString()
      }
    };

    const recCA68 = mockRecord('REC_CA_S68', { standardOrActCode: 'Companies Act 1967', paragraphOrSection: 'Section 68' });
    const chkCA68 = mockChunk('CHK_CA_68', recCA68.id, 'Share capital provision text', '68');

    const evalScore = evaluator.evaluateAlignment(chkCA68, recCA68, aiContext);

    assert.strictEqual(evalScore.provenanceTier, 'AI_REASONING');
    assert.strictEqual(evalScore.provenanceMultiplier, 1.0, 'AI reasoning must receive 1.0 multiplier');
    assert(evalScore.baseDeltaSemantics > 0, `baseDeltaSemantics must be positive (${evalScore.baseDeltaSemantics})`);
    assert.strictEqual(evalScore.finalDeltaSemantics, evalScore.baseDeltaSemantics, 'finalDelta must equal baseDelta under 1.0x');
    assert(evalScore.explanation.includes('Full Semantic Weighting (1.0x)'), `Explanation must state Full Semantic Weighting: ${evalScore.explanation}`);
    console.log(`  ✓ AI Reasoning correctly received 1.0x multiplier: base=${evalScore.baseDeltaSemantics}, final=${evalScore.finalDeltaSemantics}`);
    console.log(`  ✓ Rationale: ${evalScore.explanation}`);
    passed++;
  }

  // -------------------------------------------------------------------------
  // TEST 7: DETERMINISTIC HEURISTIC FALLBACK CALIBRATION (Multiplier = 0.70)
  // -------------------------------------------------------------------------
  console.log('\n[TEST 7: Deterministic Heuristic Fallback Calibration (0.70x & Capped Confidence)]');
  {
    const fallbackExtractor = new DeterministicSemanticExtractor();
    const query = 'Shareholder contributed $50,000 for new company shares.';
    const fallbackUnderstanding = fallbackExtractor.extract(query, 'SGD', 'SG');

    // Verify provenance attributes on extractor output
    assert.strictEqual(fallbackUnderstanding.provenance.tier, 'DETERMINISTIC_HEURISTIC_FALLBACK');
    assert.strictEqual(fallbackUnderstanding.provenance.isFallback, true);
    assert.strictEqual(fallbackUnderstanding.provenance.confidenceCapped, true);
    assert(fallbackUnderstanding.confidence <= 0.65, `Fallback confidence must be capped at <= 0.65, got ${fallbackUnderstanding.confidence}`);
    assert(fallbackUnderstanding.provenance.appliedRules.length > 0, 'Applied rules must be tracked');

    // Evaluate against Companies Act 1967 Section 68
    const recCA68 = mockRecord('REC_CA_S68', { standardOrActCode: 'Companies Act 1967', paragraphOrSection: 'Section 68' });
    const chkCA68 = mockChunk('CHK_CA_68', recCA68.id, 'Share capital allotment', '68');

    const evalScore = evaluator.evaluateAlignment(chkCA68, recCA68, fallbackUnderstanding);

    assert.strictEqual(evalScore.provenanceTier, 'DETERMINISTIC_HEURISTIC_FALLBACK');
    assert.strictEqual(evalScore.provenanceMultiplier, 0.70, 'Fallback multiplier must be 0.70');
    assert.strictEqual(evalScore.baseDeltaSemantics, 0.25, `Expected capped baseDelta of 0.25 (0.15 own_equity + 0.15 txType + 0.05 role capped at 0.25), got ${evalScore.baseDeltaSemantics}`);
    // 0.25 * 0.70 = 0.175
    const expectedFinal = Math.round(0.25 * 0.70 * 1e6) / 1e6;
    assert.strictEqual(evalScore.finalDeltaSemantics, expectedFinal, `Expected final delta ${expectedFinal}, got ${evalScore.finalDeltaSemantics}`);
    assert(evalScore.explanation.includes('Deterministic Heuristic Fallback (0.70x)'), `Explanation must state Deterministic Heuristic Fallback: ${evalScore.explanation}`);
    console.log(`  ✓ Fallback confidence capped at ${fallbackUnderstanding.confidence} (<= 0.65)`);
    console.log(`  ✓ Provenance multiplier scaled: base=${evalScore.baseDeltaSemantics} * 0.70 = ${evalScore.finalDeltaSemantics}`);
    console.log(`  ✓ Rules applied: [${fallbackUnderstanding.provenance.appliedRules.join(', ')}]`);
    passed++;
  }

  // -------------------------------------------------------------------------
  // TEST 8: DETAILED SCORING TELEMETRY & CONFLICT AUDITABILITY
  // -------------------------------------------------------------------------
  console.log('\n[TEST 8: Detailed Scoring Telemetry & Conflict Auditability]');
  {
    const recorder = new RetrievalTelemetryRecorder('test-query-1', 'snap-1', 'vec-1');
    const conflictContext = {
      reportingEntity: { type: 'standalone_private' },
      transactionType: 'share_capital_issuance',
      ownershipContext: 'own_equity',
      confidence: 0.95,
      provenance: {
        tier: 'AI_REASONING',
        isFallback: false,
        engine: 'GEMINI_2_5_FLASH',
        appliedRules: [],
        confidenceCapped: false,
        timestamp: new Date().toISOString()
      }
    };

    recorder.recordSemanticContext(conflictContext);

    // Inapplicable instrument chunk: SFRS(I) 9 Financial Asset at FVTPL
    const recSfrsi9 = mockRecord('REC_SFRSI9', {
      standardOrActCode: 'SFRS(I) 9',
      paragraphOrSection: 'Section 4.1',
      tags: ['fvtpl', 'financial asset', 'trading']
    });
    const chkSfrsi9 = mockChunk('CHK_SFRSI9', recSfrsi9.id, 'Financial asset at fair value through profit or loss', '4.1');

    const evalScore = evaluator.evaluateAlignment(chkSfrsi9, recSfrsi9, conflictContext);
    assert.strictEqual(evalScore.hasSemanticConflict, true, 'hasSemanticConflict must be true for FVTPL own equity');
    assert(evalScore.penalty < 0, 'Penalty must be negative');
    assert(evalScore.finalDeltaSemantics < 0, 'Final delta must be negative');

    recorder.recordSemanticEvaluation(chkSfrsi9.id, evalScore);
    const telemetry = recorder.getTelemetry();

    assert.strictEqual(telemetry.semanticExtractionTier, 'AI_REASONING');
    assert.strictEqual(telemetry.isFallbackSemanticExtraction, false);
    assert.strictEqual(telemetry.semanticConflictsDetected, 1, 'Telemetry must record 1 semantic conflict');
    assert.strictEqual(telemetry.semanticPenaltiesApplied, 1, 'Telemetry must record 1 penalty');

    const item = telemetry.semanticBreakdown[0];
    assert.strictEqual(item.chunkId, chkSfrsi9.id);
    assert.strictEqual(item.hasSemanticConflict, true);
    assert.strictEqual(item.provenanceMultiplier, 1.0);
    assert.strictEqual(item.baseDeltaSemantics, evalScore.baseDeltaSemantics);
    assert.strictEqual(item.finalDeltaSemantics, evalScore.finalDeltaSemantics);
    console.log(`  ✓ Conflict accurately flagged: hasSemanticConflict = ${evalScore.hasSemanticConflict}`);
    console.log(`  ✓ Telemetry recorded conflicts detected: ${telemetry.semanticConflictsDetected}`);
    console.log(`  ✓ Full audit formula preserved: base (${item.baseDeltaSemantics}) * mult (${item.provenanceMultiplier}) = final (${item.finalDeltaSemantics})`);
    passed++;
  }

  // -------------------------------------------------------------------------
  // TEST 9: NO SEMANTIC CONTEXT BACKWARD COMPATIBILITY
  // -------------------------------------------------------------------------
  console.log('\n[TEST 9: No Semantic Context Backward Compatibility]');
  {
    const query = 'What are the small company audit exemption thresholds in Singapore?';
    // When semanticContext is completely undefined
    const decomp = resolver.decomposeQuery(query, undefined);
    assert(decomp.topics.length > 0, 'Topic resolver must still resolve topics via lexical rules');
    const smallCo = decomp.topics.find(t => t.id === 'acra_small_company');
    assert(smallCo, 'acra_small_company must be found via keywords');
    assert.strictEqual(smallCo.matchSource, 'lexical_only', 'Match source must be lexical_only');

    const rec = mockRecord('REC_1');
    const chk = mockChunk('CHK_1', rec.id);
    const evalScore = evaluator.evaluateAlignment(chk, rec, undefined);
    assert.strictEqual(evalScore.deltaSemantics, 0);
    assert.strictEqual(evalScore.baseDeltaSemantics, 0);
    assert.strictEqual(evalScore.finalDeltaSemantics, 0);
    assert.strictEqual(evalScore.explanation, 'No semantic context provided (neutral alignment)');
    console.log('  ✓ Query decomposition without semanticContext functions seamlessly (matchSource: lexical_only)');
    console.log('  ✓ Evaluator neutral alignment backward-compatible when context is undefined');
    passed++;
  }

  // -------------------------------------------------------------------------
  // TEST 10: LEXICAL-ONLY TOPIC SUPPRESSION UNDER USABLE SEMANTIC CONTEXT
  // -------------------------------------------------------------------------
  console.log('\n[TEST 10: Lexical-Only Topic Suppression Under Usable Semantic Context]');
  {
    const query = 'Office utility bill paid via bank. Director requested standard accounting treatment.';
    const semanticContext = {
      reportingEntity: { type: 'standalone_private' },
      transactionType: 'expense_payment',
      ownershipContext: 'not_applicable',
      confidence: 0.90,
      provenance: {
        tier: 'AI_REASONING',
        isFallback: false,
        engine: 'GEMINI_2_5_FLASH',
        appliedRules: [],
        confidenceCapped: false,
        timestamp: new Date().toISOString()
      }
    };

    const result = resolver.decomposeQuery(query, semanticContext);
    const hasCit = result.topics.some(t => t.id === 'cit_section_14');
    assert(hasCit, 'cit_section_14 should match for expense_payment');

    const lexicalOnlyTopics = result.topics.filter(t => t.matchSource === 'lexical_only');
    assert.strictEqual(lexicalOnlyTopics.length, 0, 'Lexical-only topics must be suppressed when usable semantic context exists');
    console.log('  ✓ Lexical-only spurious expansions suppressed under usable semantic context');
    passed++;
  }

  // -------------------------------------------------------------------------
  // TEST 11: CONTROLLED FALLBACK (0 Semantic Matches or allowLexicalExpansion)
  // -------------------------------------------------------------------------
  console.log('\n[TEST 11: Controlled Fallback when 0 Semantic Topics Match]');
  {
    const query = 'What are the small company audit exemption thresholds in Singapore?';
    const unclassifiedContext = {
      reportingEntity: { type: 'standalone_private' },
      transactionType: 'unclassified_transaction',
      ownershipContext: 'not_applicable',
      confidence: 0.85,
      provenance: {
        tier: 'AI_REASONING',
        isFallback: false,
        engine: 'GEMINI_2_5_FLASH',
        appliedRules: [],
        confidenceCapped: false,
        timestamp: new Date().toISOString()
      }
    };

    const result = resolver.decomposeQuery(query, unclassifiedContext);
    const smallCo = result.topics.find(t => t.id === 'acra_small_company');
    assert(smallCo, 'acra_small_company must be preserved via controlled fallback when 0 semantic topics match');
    assert.strictEqual(smallCo.matchSource, 'lexical_only');
    console.log('  ✓ Controlled fallback preserved lexical topics when 0 semantic topics matched');
    passed++;
  }

  // -------------------------------------------------------------------------
  // TEST 12: AI SCHEMA FAILURE → HEURISTIC FALLBACK PROVENANCE REGRESSION
  // -------------------------------------------------------------------------
  console.log('\n[TEST 12: AI Schema Failure → Heuristic Fallback Provenance Regression]');
  {
    const invalidAiExtractor = {
      extract: async () => ({
        reportingEntity: { type: 'illegal_alien_dimension' },
        counterparty: { role: 'time_traveler' },
        ownershipContext: 'interdimensional_equity',
        transactionType: 'magic_teleportation',
        currency: { value: 'SGD', source: 'supernatural' }
      })
    };

    const heuristicFallbackExtractor = new DeterministicSemanticExtractor();
    const service = new TransactionUnderstandingService(heuristicFallbackExtractor, invalidAiExtractor);

    const query = 'Shareholder contributed $50,000 for new company shares.';
    const understanding = await service.understandTransaction(query, 'SGD', 'SG', 'mock-ai-api-key');

    assert.strictEqual(understanding.extractionSource, 'deterministic_fallback');
    assert.strictEqual(understanding.provenance.tier, 'DETERMINISTIC_HEURISTIC_FALLBACK');
    assert.strictEqual(understanding.provenance.isFallback, true);
    assert.strictEqual(understanding.provenance.confidenceCapped, true);
    assert(understanding.confidence <= 0.65, `Confidence must be capped <= 0.65, got ${understanding.confidence}`);

    const recCA68 = mockRecord('REC_CA_68', { standardOrActCode: 'Companies Act 1967', paragraphOrSection: 'Section 68' });
    const chkCA68 = mockChunk('CHK_CA_68', recCA68.id, 'Share capital allotment', '68');
    const score = evaluator.evaluateAlignment(chkCA68, recCA68, understanding);
    assert.strictEqual(score.provenanceMultiplier, 0.70);
    assert.strictEqual(score.provenanceTier, 'DETERMINISTIC_HEURISTIC_FALLBACK');
    assert.strictEqual(score.finalDeltaSemantics, Math.round(score.baseDeltaSemantics * 0.70 * 1e6) / 1e6);

    const recorder = new RetrievalTelemetryRecorder('test-fallback-q', 'snap-fb', 'vec-fb');
    recorder.recordSemanticContext(understanding);
    recorder.recordSemanticEvaluation(chkCA68.id, score);
    const telemetry = recorder.getTelemetry();
    assert.strictEqual(telemetry.semanticExtractionTier, 'DETERMINISTIC_HEURISTIC_FALLBACK');
    assert.strictEqual(telemetry.isFallbackSemanticExtraction, true);

    console.log('  ✓ AI schema validation failure caught without crash');
    console.log('  ✓ Seamless fallback to DETERMINISTIC_HEURISTIC_FALLBACK');
    console.log(`  ✓ Provenance confidence capped at ${understanding.confidence} (<= 0.65)`);
    console.log(`  ✓ Evaluator applied 0.70x multiplier: base=${score.baseDeltaSemantics} -> final=${score.finalDeltaSemantics}`);
    console.log('  ✓ Telemetry verified isFallbackSemanticExtraction = true');
    passed++;
  }

  // -------------------------------------------------------------------------
  // TEST 13: GENUINE SQ3 -> SQ2 -> PHASE 5 MULTI-TURN LEASE INTEGRATION TEST
  // -------------------------------------------------------------------------
  console.log('\n[TEST 13: Genuine SQ3 -> SQ2 -> Phase 5 Multi-Turn Lease Integration Test]');
  {
    console.log('  --- Turn 1: Commercial Lease Inception ($180,000 Total Commitment) ---');
    const turn1Query = 'Our company entered a 3-year commercial property lease contract with monthly rent of $5,000.';

    // SQ2: Understand Inception
    const rawTurn1 = {
      reportingEntity: { type: 'company', description: 'Singapore operating entity' },
      transactionType: 'lease_contract',
      instrument: 'right_of_use_asset',
      ownershipContext: 'not_applicable',
      amount: 180000,
      currency: { value: 'SGD', source: 'explicit', confidence: 1.0 },
      confidence: 0.95
    };
    const normTurn1 = validateAndNormalizeUnderstanding(rawTurn1, 'SG', 'ai');
    assert(normTurn1.isValid, `Turn 1 understanding must be valid: ${normTurn1.errors.join(', ')}`);
    const turn1Context = normTurn1.normalizedUnderstanding;

    // Phase 5: Topic Resolution & Provision Alignment
    const decomp1 = resolver.decomposeQuery(turn1Query, turn1Context);
    const leaseTopic1 = decomp1.topics.find(t => t.id === 'sfrsi_leases');
    assert(leaseTopic1, 'Turn 1 must resolve to sfrsi_leases');
    assert.strictEqual(leaseTopic1.matchSource, 'semantic_primary');

    const recSfrsi16_22 = mockRecord('REC_SFRS16_22', { standardOrActCode: 'SFRS(I) 16', paragraphOrSection: 'Paragraph 22' });
    const chkSfrsi16_22 = mockChunk('CHK_16_22', recSfrsi16_22.id, 'Right-of-use asset and lease liability initial recognition at commencement date', '22');

    const recSfrsi16_36 = mockRecord('REC_SFRS16_36', { standardOrActCode: 'SFRS(I) 16', paragraphOrSection: 'Paragraph 36' });
    const chkSfrsi16_36 = mockChunk('CHK_16_36', recSfrsi16_36.id, 'Subsequent measurement of lease liability; allocation between finance charge and liability reduction', '36');

    const recCA68 = mockRecord('REC_CA_68', { standardOrActCode: 'Companies Act 1967', paragraphOrSection: 'Section 68' });
    const chkCA68 = mockChunk('CHK_CA_68', recCA68.id, 'Abolition of par value / allotment of shares', '68');

    const score1_22 = evaluator.evaluateAlignment(chkSfrsi16_22, recSfrsi16_22, turn1Context);
    assert.strictEqual(score1_22.hasSemanticConflict, false);
    assert(score1_22.boost > 0, 'Turn 1 must boost SFRS(I) 16 §22');

    const score1_36 = evaluator.evaluateAlignment(chkSfrsi16_36, recSfrsi16_36, turn1Context);
    assert.strictEqual(score1_36.boost, 0, 'Turn 1 inception must NOT boost subsequent settlement §36');

    const score1_CA68 = evaluator.evaluateAlignment(chkCA68, recCA68, turn1Context);
    assert.strictEqual(score1_CA68.hasSemanticConflict, true, 'Lease inception cannot be share capital allotment');

    // SQ3: Commit Inception Event & Derive State
    const event1 = {
      id: 'evt-lease-inc-01',
      transactionId: 'tx-lease-101',
      eventType: 'initial_transaction',
      type: 'initial_transaction',
      eventDate: '2026-03-01',
      amount: 180000,
      currency: 'SGD',
      description: 'Initial recognition of 3-year commercial property lease',
      journalLines: [
        { accountCode: '1700', accountName: 'Right-of-Use Asset', category: 'ASSET', debit: 180000, credit: 0 },
        { accountCode: '2600', accountName: 'Lease Liability', category: 'LIABILITY', debit: 0, credit: 180000 }
      ]
    };

    let committedEvents = commitAccountingEvent([], event1);
    let stateTurn1 = deriveAccountingStateFromEvents(committedEvents);

    const leaseLiabilityBal1 = stateTurn1.outstandingBalances.find(b => b.transactionId === 'tx-lease-101');
    assert(leaseLiabilityBal1, 'Must find lease liability balance after Turn 1');
    assert.strictEqual(leaseLiabilityBal1.originalAmount, 180000);
    assert.strictEqual(leaseLiabilityBal1.remainingAmount, 180000);
    assert.strictEqual(leaseLiabilityBal1.settledAmount, 0);
    console.log('    ✓ Turn 1 SQ3 State: Outstanding Lease Liability recognised: $180,000');
    console.log('    ✓ Turn 1 Phase 5: SFRS(I) 16 §22 boosted (+0.15), §36 neutral (0.00), CA §68 conflict (-0.20)');

    console.log('  --- Turn 2: Subsequent Monthly Lease Payment ($5,000) ---');
    const turn2Query = 'Paid monthly commercial lease installment of $5,000 via bank transfer for tx-lease-101.';

    // SQ2: Semantic Understanding with prior conversation context
    const rawTurn2 = {
      reportingEntity: { type: 'company', description: 'Singapore operating entity' },
      counterparty: { role: 'other' },
      transactionType: 'lease_payment',
      instrument: 'lease_liability',
      ownershipContext: 'not_applicable',
      paymentStatus: 'paid',
      amount: 5000,
      currency: { value: 'SGD', source: 'explicit', confidence: 1.0 },
      confidence: 0.94,
      followUpAnalysis: {
        eventType: 'settlement',
        isFollowUp: true,
        targetOutstandingAccount: leaseLiabilityBal1.accountName,
        settlementAmount: 5000,
        settlementAccount: 'cash_at_bank',
        isHypothetical: false,
        explanation: 'Monthly lease installment payment'
      }
    };
    const normTurn2 = validateAndNormalizeUnderstanding(rawTurn2, 'SG', 'ai', {
      outstandingBalances: stateTurn1.outstandingBalances,
      recognizedEquityTotal: stateTurn1.recognizedEquityTotal,
      activeEntity: { type: 'company' },
      events: committedEvents
    });
    assert(normTurn2.isValid, `Turn 2 understanding must be valid: ${normTurn2.errors.join(', ')}`);
    const turn2Context = normTurn2.normalizedUnderstanding;

    // Phase 5: Topic Resolution & Provision Alignment on Turn 2
    const decomp2 = resolver.decomposeQuery(turn2Query, turn2Context);
    const leaseTopic2 = decomp2.topics.find(t => t.id === 'sfrsi_leases');
    assert(leaseTopic2, 'Turn 2 must resolve to sfrsi_leases');

    const score2_36 = evaluator.evaluateAlignment(chkSfrsi16_36, recSfrsi16_36, turn2Context);
    assert.strictEqual(score2_36.hasSemanticConflict, false);
    assert(score2_36.boost > 0, 'Turn 2 must boost SFRS(I) 16 §36');

    const score2_22 = evaluator.evaluateAlignment(chkSfrsi16_22, recSfrsi16_22, turn2Context);
    assert.strictEqual(score2_22.boost, 0, 'Turn 2 settlement must NOT boost initial inception §22');

    const score2_CA68 = evaluator.evaluateAlignment(chkCA68, recCA68, turn2Context);
    assert.strictEqual(score2_CA68.hasSemanticConflict, false);

    // SQ3: Validate Transition & Commit Settlement Event
    const proposedSettlementLines = [
      { accountCode: '2600', accountName: 'Lease Liability', category: 'LIABILITY', debit: 5000, credit: 0 },
      { accountCode: '1000', accountName: 'Cash at Bank', category: 'ASSET', debit: 0, credit: 5000 }
    ];

    const transitionCheck = validateAccountingStateTransition({
      outstandingBalances: stateTurn1.outstandingBalances,
      recognizedEquityTotal: stateTurn1.recognizedEquityTotal,
      activeEntity: { type: 'company' },
      events: committedEvents
    }, proposedSettlementLines, 'settlement');
    assert(transitionCheck.isValid, `Transition must be valid: ${transitionCheck.violations.join(', ')}`);

    const event2 = {
      id: 'evt-lease-set-01',
      transactionId: 'tx-settle-101',
      targetTransactionId: 'tx-lease-101',
      targetBalanceKey: leaseLiabilityBal1.balanceKey,
      eventType: 'settlement',
      type: 'settlement',
      eventDate: '2026-03-31',
      amount: 5000,
      currency: 'SGD',
      description: 'Monthly lease installment payment #1',
      journalLines: proposedSettlementLines
    };

    committedEvents = commitAccountingEvent(committedEvents, event2);
    let stateTurn2 = deriveAccountingStateFromEvents(committedEvents);

    const leaseLiabilityBal2 = stateTurn2.outstandingBalances.find(b => b.transactionId === 'tx-lease-101');
    assert(leaseLiabilityBal2, 'Must find lease liability balance after Turn 2');
    assert.strictEqual(leaseLiabilityBal2.originalAmount, 180000);
    assert.strictEqual(leaseLiabilityBal2.settledAmount, 5000);
    assert.strictEqual(leaseLiabilityBal2.remainingAmount, 175000, 'Remaining liability must reduce to $175,000');
    console.log('    ✓ Turn 2 SQ3 State: Outstanding liability reduced from $180,000 -> $175,000 (settled: $5,000)');
    console.log('    ✓ Turn 2 Phase 5: SFRS(I) 16 §36 boosted (+0.15), §22 neutral (0.00), CA §68 neutral (0.00)');

    console.log('  --- Deterministic Event Replay Equivalence ---');
    const replayState = deriveAccountingStateFromEvents([event1, event2]);
    assert.deepStrictEqual(stateTurn2, replayState, 'Incremental final state must strictly match replay(all events)');
    console.log('    ✓ Invariant verified: deriveAccountingStateFromEvents([evt1, evt2]) === incremental_state');
    passed++;
  }

  // -------------------------------------------------------------------------
  // TEST 14: COMPILE-TIME / FIXTURE GUARD TEST (Invalid Semantic Strings Rejection)
  // -------------------------------------------------------------------------
  console.log('\n[TEST 14: Compile-Time / Fixture Guard Test (Rejection of Invalid Semantic Strings)]');
  {
    // 1. Invalid ownership string is rejected by validateAndNormalizeUnderstanding
    const invalidOwnershipRaw = {
      reportingEntity: { type: 'company' },
      ownershipContext: 'fraudulent_or_unregistered_equity',
      transactionType: 'share_capital_issuance',
      currency: { source: 'unknown' }
    };
    const res1 = validateAndNormalizeUnderstanding(invalidOwnershipRaw);
    assert.strictEqual(res1.isValid, false, 'Invalid ownershipContext must be rejected');
    assert(res1.errors.some(e => e.includes("Invalid ownershipContext: 'fraudulent_or_unregistered_equity'")));
    console.log('  ✓ Invalid ownershipContext rejected at validation gate');

    // 2. Invalid transactionType is rejected
    const invalidTxRaw = {
      reportingEntity: { type: 'company' },
      ownershipContext: 'own_equity',
      transactionType: 'made_up_crypto_mining_token_sale',
      currency: { source: 'unknown' }
    };
    const res2 = validateAndNormalizeUnderstanding(invalidTxRaw);
    assert.strictEqual(res2.isValid, false, 'Invalid transactionType must be rejected');
    assert(res2.errors.some(e => e.includes("Invalid transactionType: 'made_up_crypto_mining_token_sale'")));
    console.log('  ✓ Invalid transactionType rejected at validation gate');

    // 3. Invalid instrument is rejected
    const invalidInstRaw = {
      reportingEntity: { type: 'company' },
      ownershipContext: 'own_equity',
      transactionType: 'share_capital_issuance',
      instrument: 'space_elevator_debenture',
      currency: { source: 'unknown' }
    };
    const res3 = validateAndNormalizeUnderstanding(invalidInstRaw);
    assert.strictEqual(res3.isValid, false, 'Invalid instrument must be rejected');
    assert(res3.errors.some(e => e.includes("Invalid instrument: 'space_elevator_debenture'")));
    console.log('  ✓ Invalid instrument rejected at validation gate');

    // 4. Boundary normalization correctly normalizes legacy aliases into pure canonical members
    const legacyRaw = {
      reportingEntity: { type: 'company' },
      ownershipContext: 'own_company_equity',
      transactionType: 'equity_issuance_subscription',
      instrument: 'fixed_asset',
      counterparty: { role: 'shareholder' },
      currency: { source: 'context_inference', value: 'SGD', confidence: 0.9 }
    };
    const res4 = validateAndNormalizeUnderstanding(legacyRaw);
    assert.strictEqual(res4.isValid, true, `Legacy aliases must be normalized cleanly: ${res4.errors.join(', ')}`);
    assert.strictEqual(res4.normalizedUnderstanding.ownershipContext, 'own_equity');
    assert.strictEqual(res4.normalizedUnderstanding.transactionType, 'share_capital_issuance');
    assert.strictEqual(res4.normalizedUnderstanding.instrument, 'property_plant_equipment');
    console.log('  ✓ Boundary normalizer mapped: own_company_equity -> own_equity, equity_issuance_subscription -> share_capital_issuance, fixed_asset -> property_plant_equipment');

    // 5. QueryTopicResolver accepts canonical TransactionUnderstanding with strict type fidelity
    const decomp = resolver.decomposeQuery('General business question', res4.normalizedUnderstanding);
    assert(decomp.topics.length > 0);
    const acraTopic = decomp.topics.find(t => t.id === 'acra_share_capital');
    assert(acraTopic, 'acra_share_capital must match for normalized share_capital_issuance');
    assert.strictEqual(acraTopic.matchSource, 'semantic_primary');
    console.log('  ✓ QueryTopicResolver processes normalized TransactionUnderstanding with strict type fidelity');
    passed++;
  }

  console.log('\n================================================================');
  console.log(`🎉 ALL ${passed}/14 TESTS PASSED CLEANLY!`);
  console.log('================================================================\n');
}

runTopicResolverAndProvenanceTests().catch((err) => {
  console.error('\n❌ TEST RUN FAILED:', err);
  process.exit(1);
});
