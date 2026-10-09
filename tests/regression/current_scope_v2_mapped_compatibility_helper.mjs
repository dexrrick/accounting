import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { SINGAPORE_STATUTORY_REPOSITORY } from '../../src/standards/singaporeStatutesKnowledge.ts';

const PRIVATE_RECORD_ID = 'ITA_SEC15_PROHIBITED_DEDUCTIONS';
const LOCAL_REPLAY_PATH = new URL(
  '../../docs/evaluation/multi-authority-workstreams/iras-first-contract-resolution-2026-10-04/lifecycle-local-mapped-proof-final.json',
  import.meta.url
);
const LOCAL_REPLAY_SHA256 = '69b482b683d67d40d07bd0c8fef1d0744222c2c11a66a42d0a8538cbd73801e8';
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');

export async function assertSec15Attribution({ privateRender, privateRuntime, privateRequestedConceptId, version }) {
  const replayBytes = await readFile(LOCAL_REPLAY_PATH);
  // Git may check this new text proof out with CRLF on Windows.
  assert.equal(hash(replayBytes.toString('utf8').replace(/\r\n/g, '\n')), LOCAL_REPLAY_SHA256,
    'The API-free default local replay remains the reviewed attribution control.');
  const replay = JSON.parse(replayBytes.toString('utf8'));
  const source = SINGAPORE_STATUTORY_REPOSITORY[PRIVATE_RECORD_ID];
  assert.ok(source && source.id === PRIVATE_RECORD_ID && source.principle,
    'The current statutory registry exposes the reviewed Section 15 source record.');
  assert.ok(replay.local.eligibleIds.includes(PRIVATE_RECORD_ID),
    'The default local replay admits the reviewed Section 15 record.');
  assert.equal(replay.finalIssue.evidenceStatus, 'VERIFIED',
    'The API-free local replay verifies the source-backed rule evidence.');
  const verifiedSection15Quote = replay.finalIssue.verifiedClaimQuotes.find(claim => claim.recordId === PRIVATE_RECORD_ID);
  assert.ok(verifiedSection15Quote, 'The local replay attributes a verified quote to the Section 15 record.');
  assert.equal(verifiedSection15Quote.quote, source.principle,
    'The saved replay quote is exactly the current reviewed registry text.');
  const section15Hash = hash(source.principle);

  assert.equal(privateRender.renderContextAdmittedConceptFlags[privateRequestedConceptId], true,
    'The rendered context recognizes the private-expense concept from admitted evidence.');
  assert.ok(privateRender.uncoveredTopicIds.includes('iras-cit-deductibility'),
    'Concept support does not fill the distinct general-deductibility topic.');
  assert.equal(privateRuntime.evidenceStatus, 'INSUFFICIENT',
    'The remaining general-deductibility topic keeps the final runtime fail-closed.');
  assert.equal(privateRuntime.gapCodes.includes('IRAS_SCOPE_NOT_COVERED'), true,
    'The distinct general-deductibility scope retains its explicit coverage gap.');
  assert.equal(privateRuntime.uncoveredConceptIds.includes(privateRequestedConceptId), false,
    'The supported private-expense concept itself is no longer reported as uncovered.');

  if (version === 'v5') {
    assert.equal(Object.hasOwn(privateRender, 'admittedSourceExcerptProjections'), false,
      'V5 has no per-excerpt source attribution field; the pinned API-free local replay supplies it.');
    return { section15Hash, attribution: 'PINNED_DEFAULT_LOCAL_REPLAY' };
  }

  assert.ok(Array.isArray(privateRender.admittedSourceExcerptProjections) &&
    privateRender.admittedSourceExcerptProjections.length > 0,
  `${version} exposes admitted render-context excerpt hashes.`);
  assert.ok(privateRender.admittedSourceExcerptProjections.some(projection =>
    projection.excerptSha256 === section15Hash),
  `${version} render context includes the exact reviewed Section 15 source excerpt.`);
  return { section15Hash, attribution: 'RENDER_EXCERPT_SHA256' };
}
