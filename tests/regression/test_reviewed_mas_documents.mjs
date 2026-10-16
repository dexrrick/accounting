import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { extractOfficialDocumentFromRetrieved } from '../../src/retrieval/officialDocumentExtractor.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';

const fixtureRoot = new URL('../fixtures/mas-reviewed/', import.meta.url);
const captures = JSON.parse(await readFile(new URL('capture.json', fixtureRoot), 'utf8'));
const review = JSON.parse(await readFile(new URL('review.json', fixtureRoot), 'utf8'));
const requests = [
  {
    url: captures[0].url,
    authority: 'MAS',
    domain: 'MAS_FUNDS',
    standardOrActCode: 'MAS-FUND-MANAGEMENT-LICENSING',
    legalOrStandardInstrument: 'MAS Fund Management Licensing Guidance',
    documentKind: 'HTML',
    sectionHeading: 'What are the admission criteria and applicable requirements?',
    expectedTopic: {
      standardIdentifiers: ['Securities and Futures Act'],
      expectedTitles: ['Fund Management Licensing'],
      topicTerms: ['fund management', 'licence']
    }
  },
  {
    url: captures[1].url,
    authority: 'MAS',
    domain: 'MAS_FUNDS',
    standardOrActCode: 'MAS-IID-04-2025',
    legalOrStandardInstrument: 'MAS Circular IID 04/2025',
    documentKind: 'PDF',
    sectionHeading: 'Substantive Fund Management Activity',
    expectedTopic: {
      standardIdentifiers: ['IID 04/2025'],
      expectedTitles: ['GOVERNANCE AND MANAGEMENT OF VARIABLE CAPITAL COMPANIES'],
      topicTerms: ['VCC', 'fund management']
    }
  }
];

assert.equal(captures.length, 2);
assert.equal(review.documents.length, 2);
const registryBefore = structuredClone(UNIFIED_SOURCE_REGISTRY);
for (const [index, capture] of captures.entries()) {
  const bytes = gunzipSync(await readFile(new URL(capture.file, fixtureRoot)));
  assert.equal(bytes.length, capture.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), capture.documentHash);
  assert.match(bytes.toString('utf8'), /<title>Maintenance/);
  assert.equal(capture.responseClassification, 'MAS_MAINTENANCE_HTML_NOT_SOURCE_DOCUMENT');
  assert.equal(capture.httpStatus, 200, 'HTTP success alone must not establish source evidence');
  const result = await extractOfficialDocumentFromRetrieved(requests[index], {
    status: 'SUCCESS',
    httpStatus: capture.httpStatus,
    sourceUrl: capture.url,
    finalUrl: capture.finalUrl,
    contentType: capture.contentType,
    contentBytes: new Uint8Array(bytes),
    retrievedAt: capture.retrievedAt,
    ...(capture.etag ? { etag: capture.etag } : {}),
    ...(capture.lastModified ? { lastModified: capture.lastModified } : {})
  });
  assert.equal(result.status, 'REJECTED', `${review.documents[index].title}: maintenance must never become evidence`);
  assert.ok(['HTML_SECTION_UNVERIFIED', 'DOCUMENT_TITLE_MISMATCH', 'DOCUMENT_KIND_MISMATCH'].includes(result.code), result.code);
  assert.equal('record' in result, false);
}
assert.deepEqual(UNIFIED_SOURCE_REGISTRY, registryBefore, 'Failed real-source retrieval must not add or activate knowledge');
console.log('PASS | Two reviewed MAS source-response replays reject maintenance HTML; positive real-document admission remains unverified');
