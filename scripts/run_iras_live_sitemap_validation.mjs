#!/usr/bin/env node
/** Live IRAS sitemap discovery check with independent page/evidence validation. */
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

const QUESTION = 'Is foreign income received in Singapore taxable under individual income tax?';
const outputArgument = process.argv.slice(2).find(argument => argument.startsWith('--out='));
const OUTPUT = path.resolve(outputArgument?.slice('--out='.length) || 'docs/evaluation/iras-live-2026-09-27/iras-live-sitemap-validation.json');

async function main() {
  const requestedUrls = [];
  const originalFetch = globalThis.fetch.bind(globalThis);
  const observedFetch = async (url, init = {}) => {
    requestedUrls.push({ url: String(url), method: String(init.method || 'GET') });
    return originalFetch(url, init);
  };
  const webRetriever = new ControlledWebRetriever(undefined, new SourceCache());
  const sitemapAdapter = new OfficialSitemapDiscoveryAdapter(webRetriever, { customFetch: observedFetch, timeoutMs: 12000 });
  const searchAdapter = new OfficialDomainSearchAdapter(webRetriever, { customFetch: observedFetch, timeoutMs: 12000 });
  const classification = classifyQuestion(QUESTION);
  const result = await resolveMappedOfficialSourceFallback([], QUESTION, defaultSourceRetriever, {
    authorityLevelDiscovery: true,
    webRetriever,
    fetchOptions: { customFetch: observedFetch, timeoutMs: 12000, useCache: false },
    discoveryAdapter: sitemapAdapter,
    officialDomainSearchAdapter: searchAdapter
  });
  const quality = evaluateEvidenceQuality({ query: QUESTION, topicIds: classification.topicIds, provisionalTopics: result.provisionalTopics,
    authorities: ['IRAS'], records: result.records, missingFacts: [], sourceMapFallbackTrace: result.trace });
  const admitted = quality.eligibleRecords;
  // Verify a tax-treatment statement that is actually present on the admitted
  // page. This sitemap case intentionally covers taxable-income guidance, not
  // residency, so the claim must not assume residency language.
  const quote = admitted[0]?.sourceText.split(/\n{2,}/).map(text => text.trim()).find(text =>
    text.length >= 60 && /[.!?]["')\]]?$/.test(text) &&
    /\b(?:chargeable to income tax|is not taxable|is taxable)\b/i.test(text)
  );
  const claims = quote ? [{ kind: 'RULE', text: quote, quote, recordId: admitted[0].id, citationUrl: admitted[0].canonicalSourceUrl }] : [];
  const claimVerification = verifyEvidenceClaims(claims, admitted, { missingFacts: [] });
  const report = {
    evaluatedAt: new Date().toISOString(), query: QUESTION,
    classification: { primaryDomain: classification.primaryDomain, authorities: classification.authorities, topicIds: classification.topicIds },
    sourceMapIds: result.trace.sourceMapIds, trace: result.trace,
    liveSitemapFetched: requestedUrls.some(item => item.url === 'https://www.iras.gov.sg/sitemap'),
    indexedPageCount: sitemapAdapter.getIndexedCandidates().length,
    topicalSitemapEntries: sitemapAdapter.getIndexedCandidates().filter(entry => /income|employment|residen|relief|foreign|tax treatment|certificate/i.test(`${entry.pageTitle || ''} ${entry.canonicalUrl}`))
      .map(entry => ({ url: entry.canonicalUrl, title: entry.pageTitle })),
    sitemapCandidateUrls: result.trace.attempts.filter(attempt => attempt.discoveryStage === 'SITEMAP_DISCOVERY').map(attempt => attempt.candidateUrl).filter(Boolean),
    independentlyFetchedUrls: requestedUrls.filter(item => /https:\/\/(?:www\.)?iras\.gov\.sg\//.test(item.url) && item.url !== 'https://www.iras.gov.sg/sitemap').map(item => item.url),
    onlineSearchAttempted: result.trace.stages?.some(stage => stage.stage === 'OFFICIAL_DOMAIN_SEARCH' && stage.status !== 'SKIPPED'),
    requestedUrls,
    evidenceAdmission: { status: quality.status, eligibleRecordIds: admitted.map(record => record.id), rejectedRecords: quality.rejectedRecords },
    rejectedEvidenceDetails: quality.rejectedRecords.map(rejection => {
      const record = result.records.find(item => item.id === rejection.recordId);
      return record ? { id: record.id, title: record.documentTitle, url: record.canonicalSourceUrl, sourceText: record.sourceText, rejection } : { rejection };
    }),
    evidence: admitted.map(record => ({ id: record.id, title: record.documentTitle, url: record.canonicalSourceUrl, sourceText: record.sourceText, provenance: record.provenance })),
    providerCalls: 0, claimVerification,
    finalCitations: admitted.map(record => record.canonicalSourceUrl),
    finalAnswer: admitted.length ? 'Evidence admitted from an independently fetched page discovered through the live IRAS sitemap.' : null,
    abstentionAppropriate: admitted.length === 0
  };
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (!report.liveSitemapFetched || !result.trace.stages?.some(stage => stage.stage === 'SITEMAP_DISCOVERY' && stage.status === 'SUFFICIENT')) throw new Error('The live sitemap route did not produce sufficient evidence.');
  if (result.trace.stages?.some(stage => stage.stage === 'OFFICIAL_DOMAIN_SEARCH' && stage.status === 'SUFFICIENT')) throw new Error('The search fallback, rather than sitemap discovery, supplied evidence.');
  if (!admitted.length || !quote || !claimVerification.accepted.length || claimVerification.rejected.length) throw new Error('The live sitemap result did not pass evidence admission and claim verification with a substantive rule paragraph.');
  process.stdout.write(`PASS: live IRAS sitemap discovery fetched and admitted ${admitted[0].canonicalSourceUrl}; claim verified. Report: ${path.relative(process.cwd(), OUTPUT)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(error => { process.stderr.write(`${String(error?.message || 'Live sitemap validation failed.')}\n`); process.exitCode = 1; });
}
