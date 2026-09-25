import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  InMemorySourceRetriever,
  defaultSourceRetriever
} from '../../src/retrieval/sourceRetriever.ts';
import { HybridRetriever } from '../../src/retrieval/hybridRetriever.ts';
import { DeterministicLocalEmbeddingService } from '../../src/retrieval/localVectorizer.ts';
import { DeterministicVectorIndex } from '../../src/retrieval/vectorIndex.ts';
import { ProvisionChunker } from '../../src/retrieval/provisionChunker.ts';
import { getAllAuthoritativeSources } from '../../src/standards/unifiedSourceModel.ts';

const reviewed = JSON.parse(await readFile(new URL('../evaluation/singapore/reviewed-knowledge.json', import.meta.url), 'utf8'));
const holdToCollect = reviewed.cases.find(testCase => testCase.id === 'sfrsi9-debt-hold-collect');
assert.ok(holdToCollect, 'The reviewed hold-to-collect case should exist.');

const constrainedQuery = {
  query: holdToCollect.question,
  authorities: ['ACRA'],
  domain: 'ACCOUNTING_SFRS',
  maxResults: 100
};
const constrainedSources = await defaultSourceRetriever.retrieveSources(constrainedQuery);
const constrainedIds = constrainedSources.map(source => source.id);
assert.ok(constrainedIds.includes('IFRS9_DEBT_CLASSIFICATION'), 'Conjunctive authority/domain retrieval must retain the relevant IFRS 9 record.');
assert.ok(!constrainedIds.includes('ACRA_VCC_STRUCTURE_AND_ONGOING_COMPLIANCE'), 'ACRA corporate-law records from another domain must be ineligible for this query.');

const allSources = getAllAuthoritativeSources();
const byId = new Map(allSources.map(source => [source.id, source]));
const vcc = byId.get('ACRA_VCC_STRUCTURE_AND_ONGOING_COMPLIANCE');
const ifrs9 = byId.get('IFRS9_DEBT_CLASSIFICATION');
assert.ok(vcc && ifrs9, 'The hybrid check requires both the ACRA VCC record and IFRS 9 source record.');

const chunker = new ProvisionChunker();
const vccChunk = chunker.chunkRecord(vcc)[0];
const ifrs9Chunk = chunker.chunkRecord(ifrs9)[0];
assert.ok(vccChunk && ifrs9Chunk, 'Both source records should have eligible chunks.');
const embedding = new DeterministicLocalEmbeddingService();
const hybrid = new HybridRetriever(new DeterministicVectorIndex(embedding), embedding);
const hybridConstrained = hybrid.retrieveHybridCandidates(
  { query: holdToCollect.question, authorities: ['ACRA'], domain: 'ACCOUNTING_SFRS', referenceDate: '2026-09-25' },
  [
    { chunk: vccChunk, parentRecord: vcc, score: 2 },
    { chunk: ifrs9Chunk, parentRecord: ifrs9, score: 1 }
  ],
  id => byId.get(id)
);
const hybridIds = hybridConstrained.candidates.map(candidate => candidate.parentRecord.id);
assert.ok(hybridIds.includes('IFRS9_DEBT_CLASSIFICATION'), 'Hybrid eligibility must retain the IFRS 9 source.');
assert.ok(!hybridIds.includes('ACRA_VCC_STRUCTURE_AND_ONGOING_COMPLIANCE'), 'Hybrid eligibility must exclude ACRA sources outside the hinted domain.');

// With no single-domain hint, multi-authority retrieval must continue to span
// the intentionally requested authority set.
const iras = allSources.find(source => source.authority === 'IRAS');
const mas = allSources.find(source => source.authority === 'MAS');
assert.ok(iras && mas, 'The no-domain multi-authority checks require IRAS and MAS records.');
const noDomainRetriever = new InMemorySourceRetriever([iras, mas]);
const noDomainSources = await noDomainRetriever.retrieveSources({
  query: 'What are the IRAS and MAS considerations?',
  authorities: ['IRAS', 'MAS'],
  maxResults: 10,
  referenceDate: '2026-09-25'
});
assert.deepEqual(new Set(noDomainSources.map(source => source.authority)), new Set(['IRAS', 'MAS']));

const irasChunk = chunker.chunkRecord(iras)[0];
const masChunk = chunker.chunkRecord(mas)[0];
assert.ok(irasChunk && masChunk, 'The no-domain hybrid check requires chunks for both authorities.');
const hybridNoDomain = hybrid.retrieveHybridCandidates(
  { query: 'What are the IRAS and MAS considerations?', authorities: ['IRAS', 'MAS'], referenceDate: '2026-09-25' },
  [
    { chunk: irasChunk, parentRecord: iras, score: 2 },
    { chunk: masChunk, parentRecord: mas, score: 1 }
  ],
  id => byId.get(id)
);
assert.deepEqual(new Set(hybridNoDomain.candidates.map(candidate => candidate.parentRecord.authority)), new Set(['IRAS', 'MAS']));

console.log('PASS | Explicit authority and domain hints are conjunctive; no-domain multi-authority retrieval is preserved.');
