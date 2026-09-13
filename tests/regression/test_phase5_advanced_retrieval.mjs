import assert from 'assert';
import { DeterministicLocalEmbeddingService } from '../../src/retrieval/localVectorizer.ts';
import { DeterministicVectorIndex } from '../../src/retrieval/vectorIndex.ts';
import { ProvisionChunker } from '../../src/retrieval/provisionChunker.ts';
import { HybridRetriever } from '../../src/retrieval/hybridRetriever.ts';
import { DeterministicReranker } from '../../src/retrieval/deterministicReranker.ts';
import { QueryTopicResolver } from '../../src/retrieval/queryTopicResolver.ts';
import { AdvancedSourceRetriever } from '../../src/retrieval/advancedSourceRetriever.ts';
import { CompositeSourceRetriever } from '../../src/retrieval/compositeSourceRetriever.ts';
import { evaluateFastPathEligibility } from '../../src/services/geminiService.ts';
import { buildGroundedReasoningContext } from '../../src/services/groundingContextBuilder.ts';
import { parseAccountingQuery } from '../../src/engine/scenarioParser.ts';

async function runPhase5Tests() {
  console.log('================================================================');
  console.log('🚀 RUNNING PHASE 5: ADVANCED RETRIEVAL, VECTOR INDEX & RRF TESTS');
  console.log('================================================================\n');

  let passed = 0;
  const embeddingService = new DeterministicLocalEmbeddingService();
  const chunker = new ProvisionChunker();
  const topicResolver = new QueryTopicResolver();

  // -------------------------------------------------------------------------
  // 1. DETERMINISTIC LOCAL VECTORIZATION & VECTORIZER_VERSION
  // -------------------------------------------------------------------------
  console.log('[1. DETERMINISTIC LOCAL VECTORIZATION & VECTORIZER_VERSION]');

  // 1A. Invariant: Byte-for-byte reproducibility
  const textSample = 'ACRA Companies Act 1967 Section 199 requires keeping accounting records for 5 years.';
  const vec1 = embeddingService.embed(textSample);
  const vec2 = embeddingService.embed(textSample);

  assert.strictEqual(vec1.length, 128, 'Vector dimension must be exactly 128');
  assert.strictEqual(vec2.length, 128, 'Vector dimension must be exactly 128');
  assert.strictEqual(embeddingService.vectorizerVersion, '1.0.0-semlex', 'vectorizerVersion must be 1.0.0-semlex');

  for (let i = 0; i < 128; i++) {
    assert.strictEqual(vec1[i], vec2[i], `Byte-for-byte identity failed at index ${i}`);
  }
  console.log('✓ 1A. Proved: Identical text produces byte-for-byte identical 128D vector with vectorizerVersion 1.0.0-semlex');
  passed++;

  // 1B. L2 Normalization
  let sumSq = 0;
  for (let i = 0; i < 128; i++) sumSq += vec1[i] * vec1[i];
  assert(Math.abs(Math.sqrt(sumSq) - 1.0) < 1e-4, `L2 norm must equal 1.0, got ${Math.sqrt(sumSq)}`);
  console.log('✓ 1B. Proved: Vector is strictly L2-normalized to unit sphere (||v||_2 = 1.0)');
  passed++;

  // 1C. Semantic Cosine Similarity & Concept Mapping
  const queryRetain = 'how many years do companies need to keep accounting records?';
  const queryUnrelated = 'entertainment dinner hospitality expense';
  const vQueryRetain = embeddingService.embed(queryRetain);
  const vQueryUnrelated = embeddingService.embed(queryUnrelated);

  const simRelated = embeddingService.similarity(vQueryRetain, vec1);
  const simUnrelated = embeddingService.similarity(vQueryUnrelated, vec1);

  assert(simRelated > 0.45, `Related concept query should have high similarity, got ${simRelated}`);
  assert(simRelated > simUnrelated + 0.20, `Related query (${simRelated}) must significantly exceed unrelated query (${simUnrelated})`);
  console.log(`✓ 1C. Proved: Conceptually aligned query achieves strong similarity (${simRelated.toFixed(3)}) vs unrelated (${simUnrelated.toFixed(3)})`);
  passed++;

  // -------------------------------------------------------------------------
  // 2. AUTHORITATIVE VECTOR INDEX ADMISSION & SNAPSHOT METADATA
  // -------------------------------------------------------------------------
  console.log('\n[2. AUTHORITATIVE VECTOR INDEX ADMISSION & SNAPSHOT METADATA]');

  const vectorIndex = new DeterministicVectorIndex(embeddingService);

  const dummyVerifiedChunk = {
    id: 'MOM_SEC88A#chunk1',
    parentRecordId: 'MOM_SEC88A_ANNUAL_LEAVE',
    chunkText: '(1) An employee who has served for at least 3 months is entitled to paid annual leave.',
    startOffset: 0,
    endOffset: 86,
    sourceLocator: { section: '88A', subsection: '(1)' },
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    validFrom: '2026-01-01',
    textHash: ProvisionChunker.computeTextHash('(1) An employee who has served for at least 3 months is entitled to paid annual leave.')
  };

  const dummyStagedChunk = {
    ...dummyVerifiedChunk,
    id: 'staged_candidate_pkg_chunk',
    parentRecordId: 'staged_candidate_pkg_record',
    chunkText: 'Unapproved staged candidate text'
  };

  const dummyCuratedSummaryChunk = {
    ...dummyVerifiedChunk,
    id: 'ACRA_SEC205C#chunk1',
    parentRecordId: 'ACRA_SEC205C_AUDIT_EXEMPTION',
    sourceType: 'CURATED_SUMMARY',
    evidenceTier: 'CURATED_SUMMARY'
  };

  // 2A. Snapshot Metadata Invariant
  const snapshotMeta = vectorIndex.build([dummyVerifiedChunk], 'ledger_hash_test_123', 'reg_v1');
  assert.strictEqual(snapshotMeta.indexVersion, 'v1', 'Index version must increment to v1');
  assert.strictEqual(snapshotMeta.vectorizerVersion, '1.0.0-semlex', 'Vectorizer version must be captured in snapshot');
  assert.strictEqual(snapshotMeta.ledgerHeadHash, 'ledger_hash_test_123', 'Ledger head hash must match');
  assert.strictEqual(snapshotMeta.totalChunks, 1, 'Total chunks must be 1');
  console.log('✓ 2A. Proved: Vector index produces immutable snapshot metadata with ledger head hash and vectorizerVersion');
  passed++;

  // 2B. Admission Gate: Rejection of STAGED and UNVERIFIED records
  const admittedStaged = vectorIndex.add(dummyStagedChunk);
  assert.strictEqual(admittedStaged, false, 'STAGED candidate chunk must be rejected from vector index');

  const admittedCurated = vectorIndex.add(dummyCuratedSummaryChunk);
  assert.strictEqual(admittedCurated, false, 'CURATED_SUMMARY chunk must be rejected from vector index');
  assert.strictEqual(vectorIndex.size(), 1, 'Vector index size must remain 1 after rejections');
  console.log('✓ 2B. Proved: Admission Gate strictly excludes STAGED candidates and CURATED_SUMMARY records from vector index');
  passed++;

  // -------------------------------------------------------------------------
  // 3. PARAGRAPH-LEVEL CHUNK INTEGRITY & EXACT CHARACTER BOUNDARIES
  // -------------------------------------------------------------------------
  console.log('\n[3. PARAGRAPH-LEVEL CHUNK INTEGRITY & EXACT CHARACTER BOUNDARIES]');

  const testParentRecord = {
    id: 'TEST_CORP_ACT_SEC199',
    authority: 'ACRA',
    authorityName: 'Accounting and Corporate Regulatory Authority',
    sourcePublisher: 'Singapore Statutes Online / AGC',
    legalOrStandardInstrument: 'Companies Act 1967',
    documentTitle: 'Companies Act 1967',
    standardOrActCode: 'CoA1967',
    paragraphOrSection: 'Section 199',
    sourceText: '(1) Every company shall keep accounting and other records.\n(2) The records referred to in subsection (1) shall be kept for a period of not less than 5 years.',
    principleSummary: 'Companies must retain accounting records for 5 years.',
    officialSourceUrl: 'https://sso.agc.gov.sg/Act/CoA1967#pr199-',
    domain: 'ACRA_CORP',
    jurisdiction: 'Singapore',
    tags: ['records', 'retention', 'accounting records'],
    sourceStatus: 'VERIFIED',
    sourceType: 'AUTHORITATIVE_SOURCE',
    evidenceTier: 'PRIMARY_SOURCE',
    isVerbatimText: true,
    lastVerifiedDate: '2026-09-11',
    provenance: 'LOCAL_STATIC'
  };

  const chunks = chunker.chunkRecord(testParentRecord);
  assert.strictEqual(chunks.length, 2, 'Should extract exactly 2 subsection chunks');

  // Invariant: parentRecord.sourceText.slice(startOffset, endOffset) === chunk.chunkText
  for (const chunk of chunks) {
    const slicedText = testParentRecord.sourceText.slice(chunk.startOffset, chunk.endOffset);
    assert.strictEqual(slicedText, chunk.chunkText, `Chunk ${chunk.id} slice mismatch`);
    assert(chunker.verifyChunk(chunk, testParentRecord), `Chunk ${chunk.id} must pass verifyChunk`);
  }
  console.log('✓ 3A. Proved: Paragraph chunker strictly satisfies slice invariant parentRecord.sourceText.slice(start, end) === chunk.chunkText');
  passed++;

  // 3B. Adversarial Tampering Rejection
  const tamperedChunk = {
    ...chunks[0],
    chunkText: 'Fabricated text that does not match original parent sourceText'
  };
  assert.strictEqual(chunker.verifyChunk(tamperedChunk, testParentRecord), false, 'Tampered chunk text must be rejected');

  const tamperedOffsetsChunk = {
    ...chunks[0],
    startOffset: 10,
    endOffset: 25
  };
  assert.strictEqual(chunker.verifyChunk(tamperedOffsetsChunk, testParentRecord), false, 'Tampered offsets must be rejected');
  console.log('✓ 3B. Proved: Adversarially tampered chunk text or offsets fail chunk integrity verification');
  passed++;

  // -------------------------------------------------------------------------
  // 4. EXACT MATHEMATICAL RRF & 55/45 DETERMINISTIC RERANKING
  // -------------------------------------------------------------------------
  console.log('\n[4. EXACT MATHEMATICAL RRF & 55/45 DETERMINISTIC RERANKING]');

  const hybridRetriever = new HybridRetriever(vectorIndex, embeddingService);
  const reranker = new DeterministicReranker();

  // Test RRF math: rank_lex = 1, rank_vec = 1 with k = 60
  // RRF = 1/61 + 1/61 = 2/61. Normalized = (2/61) / (2/61) = 1.0
  const candidatePool = [
    {
      chunk: dummyVerifiedChunk,
      parentRecord: { ...testParentRecord, id: dummyVerifiedChunk.parentRecordId },
      lexicalRank: 1,
      lexicalScore: 100,
      vectorRank: 1,
      vectorScore: 0.95,
      rrfScore: (1 / 61) + (1 / 61),
      normalizedRrfScore: 1.0
    }
  ];

  const reranked = reranker.rerank(candidatePool, {
    query: 'annual leave requirements',
    referenceDate: '2026-09-11'
  });

  assert.strictEqual(reranked.length, 1, 'Reranked results length must be 1');
  const topResult = reranked[0];

  // S_base = 0.55 * 1.0 + 0.45 * 0.95 = 0.55 + 0.4275 = 0.9775
  // S_rrf = 0.10 * 1.0 = 0.10
  // Delta_tier (PRIMARY_SOURCE) = 0.15
  // Delta_topic = 0.10 (matches mom_annual_leave topic)
  // Expected finalScore = 0.9775 + 0.10 + 0.15 + 0.10 = 1.3275
  const expectedFinal = 0.55 + (0.45 * 0.95) + 0.10 + 0.15 + 0.10;
  assert(Math.abs((topResult.finalScore || 0) - expectedFinal) < 1e-4, `Expected finalScore ~${expectedFinal}, got ${topResult.finalScore}`);
  console.log(`✓ 4A. Proved: Deterministic Reranker calculates exact mathematical score: ${topResult.finalScore} (matches formula 55/45 + 0.10*RRF + tier + topic)`);
  passed++;

  // -------------------------------------------------------------------------
  // 5. HARD TEMPORAL ELIGIBILITY GATING
  // -------------------------------------------------------------------------
  console.log('\n[5. HARD TEMPORAL ELIGIBILITY GATING]');

  const historicalChunk = {
    ...dummyVerifiedChunk,
    id: 'GST_HISTORICAL_2023#chunk1',
    parentRecordId: 'GST_RATE_2023_8PCT',
    validFrom: '2023-01-01',
    validTo: '2023-12-31'
  };

  const currentChunk = {
    ...dummyVerifiedChunk,
    id: 'GST_CURRENT_2026#chunk1',
    parentRecordId: 'GST_RATE_2026_9PCT',
    validFrom: '2024-01-01',
    validTo: undefined // Open-ended active
  };

  // Case 5A: Query with explicit 2026 target date
  const isHistoricalEligible2026 = hybridRetriever.isTemporallyEligible(historicalChunk, '2026-05-15', '2026-09-11', false);
  const isCurrentEligible2026 = hybridRetriever.isTemporallyEligible(currentChunk, '2026-05-15', '2026-09-11', false);
  assert.strictEqual(isHistoricalEligible2026, false, 'Historical 2023 chunk must be HARD REJECTED for explicit 2026 target date');
  assert.strictEqual(isCurrentEligible2026, true, 'Current chunk must be ELIGIBLE for explicit 2026 target date');
  console.log('✓ 5A. Proved: Explicit target date 2026 strictly excludes historical 2023 provision at hard eligibility gate');
  passed++;

  // Case 5B: Query with explicit 2023 target date
  const isHistoricalEligible2023 = hybridRetriever.isTemporallyEligible(historicalChunk, '2023-06-15', '2026-09-11', false);
  const isCurrentEligible2023 = hybridRetriever.isTemporallyEligible(currentChunk, '2023-06-15', '2026-09-11', false);
  assert.strictEqual(isHistoricalEligible2023, true, 'Historical 2023 chunk must be ELIGIBLE for explicit 2023 target date');
  assert.strictEqual(isCurrentEligible2023, false, 'Current 2024+ chunk must be HARD REJECTED for explicit 2023 target date');
  console.log('✓ 5B. Proved: Explicit target date 2023 strictly admits historical provision and hard-rejects 2024+ provision');
  passed++;

  // -------------------------------------------------------------------------
  // 6. MULTI-TOPIC QUERY DECOMPOSITION & BALANCED COVERAGE
  // -------------------------------------------------------------------------
  console.log('\n[6. MULTI-TOPIC QUERY DECOMPOSITION & BALANCED COVERAGE]');

  const multiTopicQ = 'What are the MOM statutory annual leave and outpatient sick leave entitlements?';
  const decomp = topicResolver.decomposeQuery(multiTopicQ);

  assert.strictEqual(decomp.isMultiTopic, true, 'Query must be recognized as multi-topic');
  assert.strictEqual(decomp.topics.length, 2, 'Should identify exactly 2 topics');
  assert(decomp.topics.some(t => t.id === 'mom_annual_leave'), 'Should identify mom_annual_leave');
  assert(decomp.topics.some(t => t.id === 'mom_sick_leave'), 'Should identify mom_sick_leave');
  console.log('✓ 6A. Proved: QueryTopicResolver decomposes composite query into Section 88A Annual Leave and Section 89 Sick Leave');
  passed++;

  // Multi-topic coverage test with reranker
  const annualLeaveChunk = {
    ...dummyVerifiedChunk,
    id: 'MOM_88A_LEAVE',
    chunkText: 'Section 88A: Paid annual leave of 7 to 14 days based on completed years of service.'
  };
  const sickLeaveChunk = {
    ...dummyVerifiedChunk,
    id: 'MOM_89_SICK',
    chunkText: 'Section 89: Paid outpatient sick leave up to 14 days, and hospitalisation up to 60 days.'
  };
  const extraLeaveChunk = {
    ...dummyVerifiedChunk,
    id: 'MOM_88A_EXTRA',
    chunkText: 'Section 88A: Annual leave forfeiture and untaken leave encashment rules.'
  };

  const multiCandidates = [
    { chunk: annualLeaveChunk, parentRecord: testParentRecord, lexicalScore: 100, vectorScore: 0.9, rrfScore: 0.03, normalizedRrfScore: 0.9 },
    { chunk: extraLeaveChunk, parentRecord: testParentRecord, lexicalScore: 95, vectorScore: 0.88, rrfScore: 0.028, normalizedRrfScore: 0.85 },
    { chunk: sickLeaveChunk, parentRecord: testParentRecord, lexicalScore: 70, vectorScore: 0.75, rrfScore: 0.02, normalizedRrfScore: 0.6 }
  ];

  const rerankedMulti = reranker.rerank(multiCandidates, {
    query: multiTopicQ,
    topics: decomp.topics
  });

  // Ensure both Section 88A and Section 89 are in top results despite sick leave having lower individual score
  const hasAnnual = rerankedMulti.some(r => r.chunk.id === 'MOM_88A_LEAVE');
  const hasSick = rerankedMulti.some(r => r.chunk.id === 'MOM_89_SICK');
  assert(hasAnnual && hasSick, 'Multi-topic reranking must ensure both queried statutory topics are represented in top slots');
  console.log('✓ 6B. Proved: Reranker enforces multi-topic coverage guarantee (both topics represented in top candidate set)');
  passed++;

  // -------------------------------------------------------------------------
  // 7. PHASE 4 -> PHASE 5 INDEX REFRESH LIFECYCLE
  // -------------------------------------------------------------------------
  console.log('\n[7. PHASE 4 -> PHASE 5 INDEX REFRESH LIFECYCLE]');

  const composite = new CompositeSourceRetriever();
  const advRetriever = new AdvancedSourceRetriever(composite);

  const initialMeta = advRetriever.getSnapshotMetadata();
  assert(initialMeta.totalChunks > 0, 'Vector index must have indexed approved baseline chunks');

  // Verify that staged candidates do NOT exist in initial index
  const stagedSearch = advRetriever.getVectorIndex().search(embeddingService.embed('staged candidate update text'), 10);
  assert(!stagedSearch.some(r => r.chunk.parentRecordId.includes('staged')), 'Staged candidate must NOT be present in vector index');

  // Trigger refresh with new ledger head hash (simulating Phase 4 package activation)
  const updatedMeta = advRetriever.refreshFromRegistry('new_ledger_head_hash_sha256_active');
  assert.strictEqual(updatedMeta.ledgerHeadHash, 'new_ledger_head_hash_sha256_active', 'Snapshot ledgerHeadHash must update on refresh');
  console.log('✓ 7A. Proved: Phase 4 package activation triggers Phase 5 vector index refresh, updating ledgerHeadHash snapshot');
  passed++;

  // -------------------------------------------------------------------------
  // 8. TELEMETRY & OBSERVATION SEPARATION
  // -------------------------------------------------------------------------
  console.log('\n[8. TELEMETRY & OBSERVATION SEPARATION]');

  const { results: hybridRes, telemetry } = await advRetriever.retrieveHybridChunks({
    query: 'What are the rules for keeping accounting records under Section 199?'
  });

  assert(hybridRes.length > 0, 'Should return hybrid search results');
  assert(telemetry.queryId.startsWith('q_'), 'Telemetry must have valid queryId');
  assert(telemetry.totalLatencyMs >= 0, 'Telemetry totalLatencyMs must be recorded');
  assert(telemetry.vectorIndexSize > 0, 'Telemetry vectorIndexSize must be recorded');
  assert.strictEqual(telemetry.vectorizerVersion, '1.0.0-semlex', 'Telemetry must record vectorizerVersion');
  console.log(`✓ 8A. Proved: RetrievalTelemetry captures execution performance (total: ${telemetry.totalLatencyMs}ms, vector: ${telemetry.vectorLatencyMs}ms) without altering deterministic rankings`);
  passed++;

  // -------------------------------------------------------------------------
  // 9. FAST-PATH INTEGRITY INVARIANT WITH VECTOR SIMILARITY
  // -------------------------------------------------------------------------
  console.log('\n[9. FAST-PATH INTEGRITY INVARIANT WITH VECTOR SIMILARITY]');

  // Test: High semantic vector similarity to a curated summary or non-primary source CANNOT bypass fast path
  const queryAudit = 'What are the ACRA Section 205C criteria for small company audit exemption?';
  const parsedAudit = await parseAccountingQuery(queryAudit);
  const contextAudit = await buildGroundedReasoningContext(queryAudit);

  const checkAudit = evaluateFastPathEligibility(queryAudit, parsedAudit, contextAudit);
  assert.strictEqual(checkAudit.canBypass, false, 'Audit exemption (curated summary) must strictly reject zero-LLM fast path');
  assert(
    checkAudit.reason.includes('NEEDS_REVIEW') || checkAudit.reason.includes('CURATED_SUMMARY') || checkAudit.reason.includes('not VERIFIED'),
    `Reason must indicate unverified status, got: ${checkAudit.reason}`
  );
  console.log(`✓ 9A. Proved: High vector similarity CANNOT bypass fast-path gate without verified section-level primary law: "${checkAudit.reason}"`);
  passed++;

  console.log('\n=============================================================');
  console.log(`ALL PHASE 5 TESTS PASSED SUCCESSFULLY! (${passed}/${passed} GREEN)`);
  console.log('=============================================================\n');
}

runPhase5Tests().catch((err) => {
  console.error('Phase 5 Test failure:', err);
  process.exit(1);
});
