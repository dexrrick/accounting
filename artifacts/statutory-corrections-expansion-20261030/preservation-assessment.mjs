import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const here = new URL('./', import.meta.url);
const load = async file => JSON.parse(await readFile(new URL(file, here), 'utf8'));
const base = await load('preservation-baseline.json');
const original = await load('fixed100-original.json'), enriched = await load('fixed100-enriched.json');
assert.equal(base.verified.length, 54);
assert.equal(base.explained.length, 25);
const losses = report => base.verified.filter(row => report.outcomes.find(x => x.id === row.id)?.pipelineStatus !== 'VERIFIED').map(row => row.id);
assert.deepEqual(losses(original), ['iras-eci-03']);
assert.deepEqual(losses(enriched), []);
const eci = original.outcomes.find(x => x.id === 'iras-eci-03');
const claims = row => row.citations.flatMap(source => source.claims.map(claim => ({ text: claim.text, documentHash: claim.fetchedSourceBinding?.documentHash })));
assert.deepEqual(claims(eci), claims(base.verified.find(x => x.id === eci.id)));
const explanationLosses = report => base.explained.filter(id => !/rule explanation/.test(report.outcomes.find(x => x.id === id)?.answer || ''));
const natural = await load('natural30-original.json'), richNatural = await load('natural30-enriched.json');
assert.deepEqual(explanationLosses(natural), []);
assert.deepEqual(explanationLosses(richNatural), []);
const corpusBytes = await readFile(new URL('../../tests/evaluation/statutory_coverage_wave_2026-10-25.json', here));
assert.equal(createHash('sha256').update(corpusBytes).digest('hex'), '1e7afa7ec324cbf734c90efae3727a797f68e37ca6407360efbc3e9050edbd71');
const report = { status: 'QUALIFIED_PRESERVATION', strictOriginalStatusPreservationPassed: false,
  originalPathsPreserved: 53, originalEvidenceLosses: losses(original),
  nativeEnrichedPathsPreserved: 54, enrichedEvidenceLosses: losses(enriched),
  previousGeneralExplanations: 25, originalExplanationLosses: explanationLosses(natural), enrichedExplanationLosses: explanationLosses(richNatural),
  fixed100CorpusUnchanged: true, exception: { id: eci.id, originalStatus: eci.pipelineStatus,
    enrichedStatus: enriched.outcomes.find(x => x.id === eci.id).pipelineStatus,
    admittedClaimsUnchanged: true, reason: 'Original admitted quotation establishes filing timing and existence of a waiver, but omits waiver conditions. INSUFFICIENT is preserved; native enrichment separately supplies the complete conditions.' },
  limits: 'Offline evidence-path and explanation-presence audits do not establish complete-answer correctness, historical-rule acceptance, CI or production readiness.' };
await writeFile(new URL('preservation-report.json', here), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
