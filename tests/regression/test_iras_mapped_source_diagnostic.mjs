import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  REPOSITORY_ROOT,
  V3_SELECTED_CASE_IDS,
  createMappedOnlyTransport,
  fingerprintProtectedArtifacts,
  runMappedSourceDiagnostic,
  writeFreshReport
} from '../evaluation/singapore/iras-mapped-source-diagnostic-v3.mjs';
import { IRAS_SOURCE_MAP_DEFINITIONS, getCoverageTopicsByIds } from '../../src/standards/coverageRegistry.ts';

function htmlResponse(content, status = 200, headers = { 'content-type': 'text/html; charset=utf-8' }) {
  return new Response(content, { status, headers });
}

function canonicalUrlForTransport(urlValue) {
  const url = new URL(urlValue);
  if (url.hostname === 'iras.gov.sg') url.hostname = 'www.iras.gov.sg';
  return url.toString();
}

function syntheticPage(page, mapDefinitions) {
  const definitions = page.mapIds.map(id => mapDefinitions.find(definition => definition.id === id)).filter(Boolean);
  const topics = getCoverageTopicsByIds(page.topicIds);
  const visibleTopicTerms = [...new Set(topics.flatMap(topic => [topic.title, ...(topic.aliases || []), ...topic.keywords]))];
  const firstTitle = definitions[0]?.pageTitle || 'IRAS source-map test page';
  const body = [
    'SYNTHETIC TEST DATA ONLY; NOT AN IRAS WEBPAGE OR TAX GUIDANCE.',
    'This neutral fixture exists only to exercise the existing mapped-source transport and topic filters.',
    ...visibleTopicTerms
  ].join(' ');
  return `<!doctype html><html><head><title>${firstTitle} | IRAS</title></head><body><main><h1>${firstTitle}</h1><p>${body}</p></main></body></html>`;
}

async function transportPolicyChecks() {
  const canonicalUrl = 'https://www.iras.gov.sg/taxes/corporate-income-tax/test-source-map';
  let calls = 0;
  const redirectTransport = createMappedOnlyTransport({
    canonicalUrls: [canonicalUrl],
    maxActualGets: 2,
    now: () => '2026-10-02T00:00:00.000Z',
    fetchImpl: async url => {
      calls += 1;
      if (url === canonicalUrl) {
        return new Response('', { status: 301, headers: { location: url.replace('www.iras.gov.sg', 'iras.gov.sg') } });
      }
      return htmlResponse('<main>one approved redirected page</main>');
    }
  });
  const first = await redirectTransport.fetch(canonicalUrl, { method: 'GET' });
  assert.equal(first.status, 301, 'A mapped request receives its transport-attested canonical redirect');
  const redirected = await redirectTransport.fetch(canonicalUrl.replace('www.iras.gov.sg', 'iras.gov.sg'), { method: 'GET' });
  assert.equal(redirected.status, 200, 'One same-host canonical redirect target is allowed');
  await redirectTransport.fetch(canonicalUrl, { method: 'GET' });
  assert.equal(calls, 2, 'Repeated canonical and redirect responses are served from the in-memory page cache');
  assert.ok(redirectTransport.snapshot().cacheReuseCount >= 1);
  assert.equal(redirectTransport.snapshot().actualGetCount, 2);

  let maliciousCalls = 0;
  const maliciousTransport = createMappedOnlyTransport({
    canonicalUrls: [canonicalUrl],
    maxActualGets: 2,
    fetchImpl: async () => {
      maliciousCalls += 1;
      return new Response('', { status: 302, headers: { location: 'https://evil.example/private' } });
    }
  });
  const rejectedRedirect = await maliciousTransport.fetch(canonicalUrl, { method: 'GET' });
  assert.equal(rejectedRedirect.status, 502, 'An unapproved redirect is stopped at the mapped transport boundary');
  await assert.rejects(maliciousTransport.fetch('https://evil.example/private', { method: 'GET' }), /MAPPED_PAGE_URL_REJECTED/);
  assert.equal(maliciousCalls, 1, 'No off-map URL reaches the injected transport');
  assert.equal(maliciousTransport.snapshot().actualGetCount, 1);
  assert.equal(maliciousTransport.snapshot().policyRejectionCount, 2);

  const otherPathTransport = createMappedOnlyTransport({
    canonicalUrls: [canonicalUrl],
    maxActualGets: 2,
    fetchImpl: async () => new Response('', { status: 302, headers: { location: 'https://www.iras.gov.sg/taxes/other-page' } })
  });
  const rejectedOtherPath = await otherPathTransport.fetch(canonicalUrl, { method: 'GET' });
  assert.equal(rejectedOtherPath.status, 502, 'Same-host redirects to an unregistered page are denied');
  assert.equal(otherPathTransport.snapshot().actualGetCount, 1);

  const methodTransport = createMappedOnlyTransport({
    canonicalUrls: [canonicalUrl],
    maxActualGets: 1,
    fetchImpl: async () => { throw new Error('transport should not receive non-GET'); }
  });
  await assert.rejects(methodTransport.fetch(canonicalUrl, { method: 'POST' }), /MAPPED_PAGE_METHOD_REJECTED/);
  assert.equal(methodTransport.snapshot().actualGetCount, 0);

  let failedTransportCalls = 0;
  const failedTransport = createMappedOnlyTransport({
    canonicalUrls: [canonicalUrl],
    maxActualGets: 2,
    fetchImpl: async () => {
      failedTransportCalls += 1;
      throw new Error('synthetic transport timeout');
    }
  });
  const firstFailure = await failedTransport.fetch(canonicalUrl, { method: 'GET' });
  const repeatedFailure = await failedTransport.fetch(canonicalUrl, { method: 'GET' });
  assert.equal(firstFailure.status, 599);
  assert.equal(repeatedFailure.status, 599);
  assert.equal(failedTransportCalls, 1, 'Transport failures are cached and cannot cause retries');
  assert.equal(failedTransport.snapshot().actualGetCount, 1);

  let bodyReadCalls = 0;
  const bodyReadFailure = createMappedOnlyTransport({
    canonicalUrls: [canonicalUrl],
    maxActualGets: 2,
    fetchImpl: async () => {
      bodyReadCalls += 1;
      const response = htmlResponse('<main>synthetic body read failure</main>');
      Object.defineProperty(response, 'arrayBuffer', { value: async () => { throw new Error('synthetic aborted response body'); } });
      return response;
    }
  });
  const firstBodyFailure = await bodyReadFailure.fetch(canonicalUrl, { method: 'GET' });
  const cachedBodyFailure = await bodyReadFailure.fetch(canonicalUrl, { method: 'GET' });
  assert.equal(firstBodyFailure.status, 599);
  assert.equal(cachedBodyFailure.status, 599);
  assert.equal(bodyReadCalls, 1, 'A body-read timeout is cached and cannot trigger a second GET');
  assert.equal(bodyReadFailure.snapshot().actualGetCount, 1);
  assert.equal(bodyReadFailure.snapshot().cacheReuseCount, 1);
  assert.equal(bodyReadFailure.snapshot().events.filter(event => event.status === 'TRANSPORT_ERROR').length, 1,
    'An aborted body read yields exactly one safe transport-error event');
}

async function run() {
  const diagnosticSource = await readFile(new URL('../evaluation/singapore/iras-mapped-source-diagnostic-v3.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(diagnosticSource, /process\.env|GEMINI_API_KEY|OPENAI_API_KEY|interpretSemanticQuestion\s*\(/,
    'The fixed source diagnostic does not inspect model credentials or invoke semantic-model interpretation');

  const historyBefore = await fingerprintProtectedArtifacts();
  const plan = await runMappedSourceDiagnostic({ mode: 'plan' });
  assert.equal(plan.selectedCaseCount, V3_SELECTED_CASE_IDS.length);
  assert.deepEqual(plan.selectedCaseIds, [...V3_SELECTED_CASE_IDS]);
  assert.equal(plan.modelRequests, 0);
  assert.equal(plan.maximumActualGetCount, plan.uniqueSourceMapUrlCount * 2);
  assert.ok(plan.uniqueSourceMapUrlCount > 0);
  assert.ok(plan.preregisteredMapFetches.every(page => page.host === 'www.iras.gov.sg' || page.host === 'iras.gov.sg'));
  assert.ok(plan.preregisteredMapFetches.every(page => page.mapIds.length > 0 && page.canonicalUrl.startsWith('https://')));

  await transportPolicyChecks();

  const redirectMapId = plan.preregisteredMapFetches[0].mapIds[0];
  const mockFetch = async (urlValue, init = {}) => {
    assert.equal((init.method || 'GET').toUpperCase(), 'GET');
    const canonicalUrl = canonicalUrlForTransport(urlValue);
    const page = plan.preregisteredMapFetches.find(candidate => candidate.canonicalUrl === canonicalUrl);
    assert.ok(page, `Synthetic transport received preregistered map only: ${urlValue}`);
    const definition = IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === page.mapIds[0]);
    assert.ok(definition, `Synthetic HTML maps to a registered source-map definition: ${page.mapIds[0]}`);
    if (page.mapIds.includes(redirectMapId) && urlValue === page.canonicalUrl) {
      return new Response('', { status: 302, headers: { location: urlValue.replace('www.iras.gov.sg', 'iras.gov.sg') } });
    }
    return htmlResponse(syntheticPage(page, IRAS_SOURCE_MAP_DEFINITIONS));
  };
  const report = await runMappedSourceDiagnostic({
    mode: 'synthetic-test',
    fetchImpl: mockFetch,
    now: () => '2026-10-02T00:00:00.000Z'
  });
  assert.equal(report.summary.modelRequests, 0);
  assert.equal(report.summary.networkMode, 'SYNTHETIC_TRANSPORT_NO_LIVE_NETWORK');
  assert.equal(report.summary.selectedCaseCount, V3_SELECTED_CASE_IDS.length);
  assert.equal(report.summary.uniqueSourceMapUrlCount, plan.uniqueSourceMapUrlCount);
  assert.ok(report.summary.actualGetCount <= report.maximumActualGetCount,
    'The injected transport remains within the preregistered GET budget');
  assert.ok(report.summary.cacheReuseCount > 0, 'Repeated case/topic paths reuse canonical page bodies in memory');
  assert.ok(report.pageFetches.every(page => page.contentHashes.every(hash => /^[a-f0-9]{64}$/.test(hash))));
  assert.ok(report.issues.every(issue => issue.topics.every(topic => topic.maps.every(map =>
    map.candidateCount >= 0 && map.admittedCount >= 0 && map.fetchAttempts.every(attempt => typeof attempt.status === 'string')))));
  assert.deepEqual(await fingerprintProtectedArtifacts(), historyBefore, 'All protected v1/v2 artifacts remain byte-identical');

  const temporaryDirectory = await mkdtemp(path.join(REPOSITORY_ROOT, '.tmp-ci', 'iras-mapped-source-diagnostic-v3-'));
  try {
    const outputFile = path.join(temporaryDirectory, 'new-report.json');
    await writeFile(outputFile, 'preserve-existing-output', 'utf8');
    let existingOutputNetworkCalls = 0;
    await assert.rejects(runMappedSourceDiagnostic({ mode: 'live-source', outputPath: outputFile,
      fetchImpl: async () => { existingOutputNetworkCalls += 1; return htmlResponse('unused'); } }), error => error.code === 'EEXIST');
    assert.equal(existingOutputNetworkCalls, 0, 'An existing output is rejected before any source fetch');
    assert.equal(await readFile(outputFile, 'utf8'), 'preserve-existing-output');
    await rm(outputFile, { force: true });

    const safeReport = { schemaVersion: 1, purpose: 'synthetic test only', summary: { modelRequests: 0 } };
    await writeFreshReport(safeReport, outputFile);
    const originalBytes = await readFile(outputFile, 'utf8');
    await assert.rejects(writeFreshReport({ ...safeReport, changed: true }, outputFile), error => error.code === 'EEXIST');
    assert.equal(await readFile(outputFile, 'utf8'), originalBytes, 'An existing diagnostic output is never overwritten');
    assert.match(createHash('sha256').update(originalBytes).digest('hex'), /^[a-f0-9]{64}$/);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  assert.deepEqual(await fingerprintProtectedArtifacts(), historyBefore);
  process.stdout.write(`IRAS mapped-source diagnostic safety passed: ${plan.uniqueSourceMapUrlCount} preregistered URLs, ${report.summary.actualGetCount} synthetic GETs, ${report.summary.cacheReuseCount} cache reuses, no live calls.\n`);
}

await run();
