import assert from 'assert';
import { defaultQueryTopicResolver } from './src/retrieval/queryTopicResolver.ts';
import { DeterministicSemanticAlignmentEvaluator } from './src/retrieval/semanticAlignmentEvaluator.ts';
import { RetrievalTelemetryRecorder } from './src/retrieval/retrievalTelemetry.ts';
import { DeterministicSemanticExtractor } from './src/services/transactionUnderstandingService.ts';

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
  // TEST 1: PRIMARY SEMANTIC TOPIC RESOLUTION (Lease without keywords)
  // -------------------------------------------------------------------------
  console.log('[TEST 1: Primary Semantic Topic Resolution (Implicit Lease)]');
  {
    const query = 'Our company signed a 3-year commercial vehicle contract payable $2,000 monthly.';
    const semanticContext = {
      reportingEntity: { type: 'standalone_private' },
      transactionType: 'lease_payment',
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
  // TEST 3: PRIMARY SEMANTIC TOPIC RESOLUTION (External Investment)
  // -------------------------------------------------------------------------
  console.log('\n[TEST 3: Primary Semantic Topic Resolution (External Investment)]');
  {
    const query = 'Purchased bonds issued by foreign treasury.';
    const semanticContext = {
      reportingEntity: { type: 'standalone_private' },
      transactionType: 'asset_purchase',
      ownershipContext: 'external_entity_equity',
      instrument: 'debt_instrument',
      confidence: 0.88,
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
    console.log('  ✓ External bond investment resolved to sfrsi_financial_instruments');
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
      ownershipContext: 'own_company_equity',
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
      ownershipContext: 'own_company_equity',
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

  console.log('\n================================================================');
  console.log(`🎉 ALL ${passed}/9 TESTS PASSED CLEANLY!`);
  console.log('================================================================\n');
}

runTopicResolverAndProvenanceTests().catch((err) => {
  console.error('\n❌ TEST RUN FAILED:', err);
  process.exit(1);
});
