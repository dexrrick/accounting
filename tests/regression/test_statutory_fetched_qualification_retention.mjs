import assert from 'node:assert/strict';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import { OFFICIAL_SOURCE_DISCOVERY_PROVIDERS } from '../../src/retrieval/officialSitemapDiscovery.ts';
import { defaultSourceRetriever } from '../../src/retrieval/sourceRetriever.ts';
import { resolveMappedOfficialSourceFallback } from '../../src/services/groundingContextBuilder.ts';

const officialUrl = 'https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days';
const title = 'Part IV Working Hours and Overtime Eligibility | Ministry of Manpower';
const noise = 'General employment information and administrative guidance. '.repeat(72);
const qualification = `However, ${'some employment arrangements may fall outside the described eligibility categories. '.repeat(13)}`;
const body = [
  'Part IV of the Employment Act applies to hours of work and overtime. Managers and executives are not covered under Part IV.',
  noise,
  'You can claim overtime if you are:',
  'Workmen who earn a basic monthly salary of $4,500 or less are eligible for overtime under Part IV.',
  'Non-workmen who earn a basic monthly salary of $2,600 or less are also eligible for overtime under Part IV.',
  qualification
];
const html = `<html><head><title>${title}</title></head><body><main><h1>${title}</h1>
  <p>${body[0]}</p><p>${body[1]}</p><p>${body[2]}</p>
  <ul><li>${body[3]}</li><li>${body[4]}</li></ul><p>${body[5]}</p>
</main></body></html>`;
const response = content => new Response(content, { status: 200, headers: { 'content-type': 'text/html' } });
const momProvider = OFFICIAL_SOURCE_DISCOVERY_PROVIDERS.MOM;
const webRetriever = new ControlledWebRetriever(undefined, new SourceCache());

const result = await resolveMappedOfficialSourceFallback(
  ['mom-part-iv-overtime'],
  'Which employees are eligible for Part IV overtime coverage?',
  defaultSourceRetriever,
  {
    webRetriever,
    referenceDate: '2026-10-14',
    fetchOptions: {
      customFetch: async requestedUrl => {
        if (momProvider.sitemapUrls.includes(requestedUrl)) {
          return response(`<urlset><url><loc>${officialUrl}</loc></url></urlset>`);
        }
        if (requestedUrl === officialUrl) return response(html);
        if (requestedUrl.endsWith('/robots.txt')) return new Response('not found', { status: 404 });
        if (requestedUrl.startsWith('https://html.duckduckgo.com/html/')) return response('<html><body></body></html>');
        if (requestedUrl.startsWith('https://r.jina.ai/')) return new Response('not found', { status: 404 });
        throw new Error(`Unexpected fetch ${requestedUrl}`);
      },
      useCache: false,
      timeoutMs: 500
    }
  }
);

assert.ok(body.join('\n\n').length > 5_000, 'fixture exceeds the final source excerpt limit');
assert.equal(result.records.length, 0,
  'a complete MOM coverage bundle with an oversized attached qualification cannot create a truncated fetched record');
assert.ok(result.trace.attempts.some(attempt => attempt.finalUrl === officialUrl &&
  attempt.fetchStatus === 'TOPIC_MISMATCH' && /attached qualifications/.test(attempt.error || '')),
'the fetch trace records that complete bounded guidance could not be preserved safely');

console.log('Fetched statutory qualification retention regression tests passed.');
