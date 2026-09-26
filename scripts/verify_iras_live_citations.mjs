#!/usr/bin/env node
/** Independently fetch and validate IRAS/SSO URLs cited by a saved live run. */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultControlledWebRetriever } from '../src/retrieval/controlledWebRetriever.ts';
import { defaultExternalSourceValidator } from '../src/retrieval/externalSourceValidator.ts';
import { cleanHtmlText } from '../src/retrieval/sourceAdapters.ts';
import { IRAS_SOURCE_MAP_DEFINITIONS } from '../src/standards/coverageRegistry.ts';

const DEFAULT_OUTPUT = 'docs/evaluation/iras-live-2026-09-26/iras-citation-verification.jsonl';

function parseArgs(argv) {
  const options = { captures: [] };
  for (const argument of argv) {
    if (argument.startsWith('--captures=')) options.captures.push(...argument.slice('--captures='.length).split(',').filter(Boolean).map(value => path.resolve(value)));
    else if (argument.startsWith('--out=')) options.outputPath = path.resolve(argument.slice('--out='.length));
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.captures.length) throw new Error('Supply one or more capture files with --captures=path[,path].');
  return options;
}

function normalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    url.pathname = url.pathname.replace(/%28/gi, '(').replace(/%29/gi, ')');
    return `${url.origin.toLowerCase()}${url.pathname}${url.search}`;
  } catch {
    return undefined;
  }
}

function extractMarkdownUrls(text) {
  const urls = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf('](', cursor);
    if (start < 0) break;
    let urlStart = start + 2;
    const angleWrapped = text[urlStart] === '<';
    if (angleWrapped) urlStart += 1;
    let depth = 0;
    let end = urlStart;
    for (; end < text.length; end += 1) {
      const char = text[end];
      if (char === '(') depth += 1;
      else if (char === ')') {
        if (depth === 0) break;
        depth -= 1;
      } else if (angleWrapped && char === '>' && depth === 0) break;
      else if (!angleWrapped && /\s/.test(char)) break;
    }
    const url = text.slice(urlStart, end).replace(/[.,;]+$/, '');
    if (/^https?:\/\//i.test(url)) urls.push(url);
    cursor = end + 1;
  }
  return urls;
}

function collectCitations(record) {
  const byKey = new Map();
  const add = (url, method, detail = {}) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
    const key = normalizeUrl(url) || url;
    if (!byKey.has(key)) byKey.set(key, { url, urlVariants: [], methods: [], metadata: [] });
    const citation = byKey.get(key);
    if (!citation.urlVariants.includes(url)) citation.urlVariants.push(url);
    if (!citation.methods.includes(method)) citation.methods.push(method);
    if (Object.keys(detail).length && !citation.metadata.some(item => JSON.stringify(item) === JSON.stringify(detail))) citation.metadata.push(detail);
  };
  const message = record.finalResponse?.messageText || record.gemini?.finalAnswer || '';
  if (message) {
    for (const url of extractMarkdownUrls(message)) add(url, 'MARKDOWN');
  } else {
    for (const url of record.finalCitations?.markdownUrls || []) add(url, 'CAPTURED_MARKDOWN');
  }
  for (const citation of record.finalCitations?.structured || []) {
    add(citation.officialSourceUrl, 'STRUCTURED_CITATION', {
      authority: citation.authority,
      title: citation.title,
      standard: citation.standard,
      paragraph: citation.paragraph,
      priorVerificationStatus: citation.verificationStatus
    });
  }
  const scenario = record.finalResponse?.scenarioState || {};
  const structured = [
    ...(scenario.directGroups || []).flatMap(group => group.citations || []),
    ...(scenario.statutoryAdvisory || []).flatMap(advisory => advisory.citations || [])
  ];
  for (const citation of structured) {
    add(citation.officialSourceUrl, 'STRUCTURED_CITATION', {
      authority: citation.authority,
      title: citation.title,
      standard: citation.standard,
      paragraph: citation.paragraph,
      priorVerificationStatus: citation.verificationStatus
    });
  }
  return [...byKey.values()];
}

export { collectCitations, normalizeUrl };

function getSourceMaps(url) {
  const normalized = normalizeUrl(url);
  if (!normalized) return [];
  return IRAS_SOURCE_MAP_DEFINITIONS.filter(definition => normalizeUrl(definition.canonicalSourceUrl) === normalized);
}

function readCanonicalUrl(html, baseUrl) {
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const rel = tag.match(/\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const relValue = rel?.[1] ?? rel?.[2] ?? rel?.[3] ?? '';
    if (!relValue.split(/\s+/).some(value => value.toLowerCase() === 'canonical')) continue;
    const href = tag.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const hrefValue = href?.[1] ?? href?.[2] ?? href?.[3];
    if (!hrefValue) return undefined;
    try { return new URL(hrefValue, baseUrl).toString(); } catch { return hrefValue; }
  }
  return undefined;
}

function visibleExcerpt(html, fallbackText = '') {
  const withoutChrome = html
    .replace(/<!--[^]*?-->/g, ' ')
    .replace(/<(script|style|noscript|nav|footer|header|aside)\b[^>]*>[^]*?<\/\1\s*>/gi, ' ');
  const main = withoutChrome.match(/<(?:main|article)\b[^>]*>([^]*?)<\/(?:main|article)\s*>/i)?.[1]
    || withoutChrome.match(/<body\b[^>]*>([^]*?)<\/body\s*>/i)?.[1]
    || withoutChrome;
  return cleanHtmlText(main || fallbackText).replace(/\s+/g, ' ').trim().slice(0, 5000);
}

function parseTitle(html) {
  const title = html.match(/<title\b[^>]*>([^]*?)<\/title>/i)?.[1] || '';
  return cleanHtmlText(title).replace(/\s+/g, ' ').trim() || undefined;
}

function officialScope(url) {
  try {
    const { hostname, protocol } = new URL(url);
    if (protocol !== 'https:') return 'INSECURE';
    if (hostname === 'iras.gov.sg' || hostname === 'www.iras.gov.sg') return 'IRAS';
    if (hostname === 'sso.agc.gov.sg') return 'SSO';
    return 'OUT_OF_IRAS_SCOPE';
  } catch {
    return 'INVALID_URL';
  }
}

async function verifyCitation(url) {
  const security = defaultExternalSourceValidator.validateUrlSecurity(url);
  const scope = officialScope(url);
  const maps = getSourceMaps(url);
  const base = {
    citedUrl: url,
    sourceMapMatches: maps.map(map => ({ id: map.id, topicIds: map.topicIds, pageTitle: map.pageTitle, canonicalSourceUrl: map.canonicalSourceUrl })),
    claimRelationStatus: 'NOT_EVALUATED',
    periodApplicabilityStatus: 'NOT_EVALUATED',
    securityValidation: security,
    officialScope: scope
  };
  if (!security.isValid || (scope !== 'IRAS' && scope !== 'SSO')) {
    return { ...base, urlVerificationStatus: scope === 'OUT_OF_IRAS_SCOPE' ? 'NOT_EVALUATED' : 'BLOCKED_BY_SOURCE', fetchStatus: 'NOT_ATTEMPTED' };
  }

  const redirectChain = [];
  const transport = globalThis.fetch.bind(globalThis);
  const fetched = await defaultControlledWebRetriever.fetchOfficialSource(url, {
    useCache: false,
    customFetch: async (requestUrl, init) => {
      const response = await transport(requestUrl, init);
      let target;
      const location = response.headers.get('location');
      if (location) {
        try { target = new URL(location, requestUrl).toString(); } catch { target = location; }
      }
      redirectChain.push({ requestedUrl: requestUrl, httpStatus: response.status, redirectLocation: target, responseUrl: response.url || requestUrl });
      return response;
    }
  });

  const finalUrl = fetched.finalUrl || fetched.sourceUrl;
  const html = fetched.content || '';
  const pageCanonicalUrl = html ? readCanonicalUrl(html, finalUrl) : undefined;
  const canonicalUrl = pageCanonicalUrl || (html ? finalUrl : undefined);
  const finalSecurity = finalUrl ? defaultExternalSourceValidator.validateUrlSecurity(finalUrl) : undefined;
  const canonicalSecurity = canonicalUrl ? defaultExternalSourceValidator.validateUrlSecurity(canonicalUrl) : undefined;
  const finalScope = finalUrl ? officialScope(finalUrl) : 'INVALID_URL';
  const canonicalScope = canonicalUrl ? officialScope(canonicalUrl) : 'INVALID_URL';
  let topicValidation;
  if (html && maps.length > 0) {
    const map = maps[0];
    topicValidation = defaultExternalSourceValidator.validateTopicContent(html, {
      standardIdentifiers: [map.pageTitle],
      expectedTitles: [map.pageTitle],
      topicTerms: [map.pageTitle],
      minimumTopicTermMatches: 1
    });
  }
  const finalAndCanonicalMatch = normalizeUrl(url) === normalizeUrl(finalUrl) &&
    (!canonicalUrl || normalizeUrl(url) === normalizeUrl(canonicalUrl));
  const pageTitle = fetched.pageTitle || parseTitle(html);
  const substantiveText = topicValidation?.substantiveText || visibleExcerpt(html, fetched.substantiveText);
  const genericOrUnavailableTitle = !pageTitle || /^(?:home(?:page)?|search(?: results)?|sign in|log in|login|access denied|not found|error)(?:\s*[-|:].*)?$/i.test(pageTitle);
  const substantivePage = !genericOrUnavailableTitle && substantiveText.length >= 55 &&
    new Set(substantiveText.toLowerCase().match(/[a-z0-9]+/g) || []).size >= 8;
  const urlOkay = fetched.status === 'SUCCESS' && finalSecurity?.isValid === true &&
    canonicalSecurity?.isValid === true && ['IRAS', 'SSO'].includes(finalScope) &&
    finalScope === canonicalScope && finalAndCanonicalMatch && substantivePage;
  const topicOkay = !topicValidation || topicValidation.isValid;
  const urlVerificationStatus = !urlOkay || !topicOkay
    ? 'BLOCKED_BY_SOURCE'
    : maps.length === 0 ? 'NOT_EVALUATED' : 'LIVE_PASS';
  const fragment = (() => { try { return new URL(url).hash || undefined; } catch { return undefined; } })();
  return {
    ...base,
    urlVerificationStatus,
    requestedUrlSecurityStatus: security.isValid ? 'LIVE_PASS' : 'BLOCKED_BY_SOURCE',
    canonicalIdentityStatus: urlOkay && finalAndCanonicalMatch ? 'LIVE_PASS' : 'BLOCKED_BY_SOURCE',
    pageStructureStatus: substantivePage ? 'LIVE_PASS' : 'BLOCKED_BY_SOURCE',
    topicValidationStatus: topicValidation ? (topicValidation.isValid ? 'LIVE_PASS' : 'BLOCKED_BY_SOURCE') : 'NOT_EVALUATED',
    transportStatus: fetched.status === 'SUCCESS' ? 'SUCCESS' : fetched.status,
    fetchStatus: fetched.status,
    httpStatus: fetched.httpStatus,
    cached: fetched.cached,
    sourceUrl: fetched.sourceUrl,
    finalUrl,
    finalHostname: (() => { try { return new URL(finalUrl).hostname; } catch { return undefined; } })(),
    finalScope,
    canonicalScope,
    finalUrlSecurity: finalSecurity,
    pageTitle,
    expectedMappedTitles: maps.map(map => map.pageTitle),
    topicValidation,
    canonicalUrl,
    canonicalLinkPresent: Boolean(pageCanonicalUrl),
    citedUrlFragment: fragment,
    canonicalUrlSecurity: canonicalSecurity,
    citedUrlMatchesFinalUrl: normalizeUrl(url) === normalizeUrl(finalUrl),
    citedUrlMatchesCanonicalUrl: canonicalUrl ? normalizeUrl(url) === normalizeUrl(canonicalUrl) : undefined,
    redirectChain,
    relevantBodyExcerpt: substantiveText,
    bodyExcerptIsUnreviewed: true,
    contentSha256: fetched.contentHash,
    error: fetched.error
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outputPath = options.outputPath || path.resolve(DEFAULT_OUTPUT);
  const captureRecords = [];
  for (const inputPath of options.captures) {
    const text = await readFile(inputPath, 'utf8');
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      const record = JSON.parse(line);
      if (record.recordType === 'case') captureRecords.push({ ...record, captureFile: path.relative(process.cwd(), inputPath) });
    }
  }
  const citations = captureRecords.flatMap(record => collectCitations(record).map(citation => ({ caseId: record.caseId, captureFile: record.captureFile, ...citation })));
  const verificationByUrl = new Map();
  for (const citation of citations) {
    const verificationKey = normalizeUrl(citation.url) || citation.url;
    if (!verificationByUrl.has(verificationKey)) verificationByUrl.set(verificationKey, await verifyCitation(citation.url));
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  for (const citation of citations) {
    const verification = verificationByUrl.get(normalizeUrl(citation.url) || citation.url);
    const record = {
      recordType: 'citation-verification',
      schemaVersion: 1,
      checkedAt: new Date().toISOString(),
      caseId: citation.caseId,
      captureFile: citation.captureFile,
      citationMethods: citation.methods,
      citedUrlVariants: citation.urlVariants,
      citationMetadata: citation.metadata,
      ...verification,
      independentOfAnswerGeneration: true
    };
    await appendFile(outputPath, `${JSON.stringify(record)}\n`, 'utf8');
  }
  process.stdout.write(`Citation verification records written: ${citations.length}; unique URLs examined: ${verificationByUrl.size}.\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(error => {
    process.stderr.write(`${error?.message || 'Citation verification failed.'}\n`);
    process.exitCode = 1;
  });
}
