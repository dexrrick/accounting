#!/usr/bin/env node
/** Live IRAS discovery-route check. Search/sitemap metadata never enters evidence. */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ControlledWebRetriever } from '../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../src/retrieval/sourceCache.ts';
import { OfficialDomainSearchAdapter, OfficialSitemapDiscoveryAdapter } from '../src/retrieval/officialSitemapDiscovery.ts';
import { defaultSourceRetriever } from '../src/retrieval/sourceRetriever.ts';
import { evaluateEvidenceQuality } from '../src/retrieval/evidenceQualityGate.ts';
import { verifyEvidenceClaims } from '../src/verification/claimEvidenceVerifier.ts';
import { classifyQuestion } from '../src/classification/questionClassifier.ts';
import { resolveMappedOfficialSourceFallback } from '../src/services/groundingContextBuilder.ts';

const QUESTION = 'IRAS working outside Singapore overseas employment income';
const outputArgument = process.argv.slice(2).find(argument => argument.startsWith('--out='));
const OUTPUT = path.resolve(outputArgument?.slice('--out='.length) || 'docs/evaluation/iras-live-2026-09-27/iras-live-discovery-routes.json');

async function main() {
  const requestedUrls = [];
  const searchResponseDiagnostics = [];
  const originalFetch = globalThis.fetch.bind(globalThis);
  const observedFetch = async (url, init = {}) => {
    requestedUrls.push({ url: String(url), method: String(init.method || 'GET') });
    const response = await originalFetch(url, init);
    let host = '';
    try { host = new URL(String(url)).hostname.toLowerCase(); } catch { /* omitted from diagnostics */ }
    if (host === 'html.duckduckgo.com' || host === 'r.jina.ai') {
      const body = await response.clone().text().catch(() => '');
      const preview = body
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/https?:\/\/[^\s"'<>)]*/gi, '[URL]')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\bAIza[0-9A-Za-z_-]{15,}\b/g, '[REDACTED]')
        .replace(/\s+/g, ' ').trim().slice(0, 240);
      searchResponseDiagnostics.push({
        host,
        status: response.status,
        contentType: response.headers.get('content-type'),
        bodyLength: body.length,
        untrustedMetadataPreview: preview
      });
    }
    return response;
  };
  const webRetriever = new ControlledWebRetriever(undefined, new SourceCache());
  const liveSitemap = new OfficialSitemapDiscoveryAdapter(webRetriever, { customFetch: observedFetch, timeoutMs: 12000 });
  const liveSearch = new OfficialDomainSearchAdapter(webRetriever, { customFetch: observedFetch, timeoutMs: 12000 });
  let sitemapCandidates = [];
  const exhaustedSitemap = {
    async discoverOfficialSourceCandidates(request) {
      sitemapCandidates = await liveSitemap.discoverOfficialSourceCandidates(request);
      // Simulate the live sitemap yielding no *adequate* candidates. Keep the
      // discovered candidate URLs as metadata, then prove search can continue.
      return [];
    },
    getCandidateTitle(url) { return liveSitemap.getCandidateTitle(url); }
  };
  const classification = classifyQuestion(QUESTION);
  const result = await resolveMappedOfficialSourceFallback([], QUESTION, defaultSourceRetriever, {
    authorityLevelDiscovery: true,
    webRetriever,
    fetchOptions: { customFetch: observedFetch, timeoutMs: 12000, useCache: false },
    discoveryAdapter: exhaustedSitemap,
    officialDomainSearchAdapter: liveSearch
  });
  const quality = evaluateEvidenceQuality({
    query: QUESTION,
    topicIds: [],
    provisionalTopics: result.provisionalTopics,
    authorities: ['IRAS'],
    records: result.records,
    missingFacts: [],
    sourceMapFallbackTrace: result.trace
  });
  const admitted = quality.eligibleRecords;
  const quote = admitted[0]?.sourceText.split(/\n{2,}/).find(text => /render your full employment services wholly outside Singapore/i.test(text));
  const claims = quote ? [{ kind: 'RULE', text: quote, quote, recordId: admitted[0].id, citationUrl: admitted[0].canonicalSourceUrl }] : [];
  const claimVerification = verifyEvidenceClaims(claims, admitted, { missingFacts: [] });
  const report = {
    evaluatedAt: new Date().toISOString(),
    query: QUESTION,
    classification: {
      primaryDomain: classification.primaryDomain,
      authorities: classification.authorities,
      topicIds: classification.topicIds,
      domainIds: classification.domainIds
    },
    sourceMapIds: result.trace.sourceMapIds,
    trace: result.trace,
    liveSitemapFetched: requestedUrls.some(item => item.url === 'https://www.iras.gov.sg/sitemap'),
    sitemapCandidateUrls: sitemapCandidates,
    onlineSearchFetched: requestedUrls.some(item => item.url.startsWith('https://html.duckduckgo.com/html/?')),
    searchResponseDiagnostics,
    searchCandidateTitles: result.trace.attempts.filter(attempt => attempt.discoveryStage === 'OFFICIAL_DOMAIN_SEARCH' && attempt.candidateUrl)
      .map(attempt => ({ url: attempt.candidateUrl, title: liveSearch.getCandidateTitle(attempt.candidateUrl) })),
    fetchedPageUrls: requestedUrls.filter(item => /https:\/\/(?:www\.)?iras\.gov\.sg\//.test(item.url) && item.url !== 'https://www.iras.gov.sg/sitemap').map(item => item.url),
    requestedUrls,
    evidenceAdmission: { status: quality.status, eligibleRecordIds: admitted.map(record => record.id), rejectedRecords: quality.rejectedRecords },
    evidence: admitted.map(record => ({ id: record.id, title: record.documentTitle, url: record.canonicalSourceUrl, sourceText: record.sourceText, provenance: record.provenance, isVerbatimText: record.isVerbatimText })),
    providerCalls: 0,
    claimVerification,
    finalCitations: admitted.map(record => record.canonicalSourceUrl),
    finalAnswer: admitted.length ? 'Evidence admitted from an independently fetched IRAS page; answer generation is evaluated in the production Gemini run.' : null,
    abstentionAppropriate: admitted.length === 0
  };
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (!report.liveSitemapFetched) throw new Error('Live IRAS sitemap was not fetched.');
  if (!report.onlineSearchFetched) throw new Error('Live official-domain search was not fetched.');
  if (!result.trace.stages?.some(stage => stage.stage === 'SITEMAP_DISCOVERY')) throw new Error('SITEMAP_DISCOVERY is missing from the trace.');
  if (!result.trace.stages?.some(stage => stage.stage === 'OFFICIAL_DOMAIN_SEARCH')) throw new Error('OFFICIAL_DOMAIN_SEARCH is missing from the trace.');
  if (quality.status !== 'RETRIEVED_SUFFICIENT' || !admitted.length) throw new Error('Live official-domain search did not produce admitted IRAS evidence.');
  if (!claimVerification.accepted.length || claimVerification.rejected.length) throw new Error('The retrieved evidence failed exact claim verification.');
  process.stdout.write(`PASS: live IRAS sitemap fetched; restricted official search fetched ${admitted[0].canonicalSourceUrl}; evidence admitted and exact claim verified. Report: ${path.relative(process.cwd(), OUTPUT)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(error => {
    process.stderr.write(`${String(error?.message || 'Live discovery validation failed.')}\n`);
    process.exitCode = 1;
  });
}
