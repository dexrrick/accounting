import { ControlledWebRetriever } from './controlledWebRetriever';
import type { OfficialSourceDiscoveryAdapter, OfficialSourceDiscoveryRequest } from '../services/groundingContextBuilder';

const MAX_HOSTS_PER_SEARCH = 2;
const MAX_SITEMAPS_PER_HOST = 1;
const MAX_INDEX_CHILD_SITEMAPS = 2;
const MAX_CANDIDATES = 4;
// Reserve a fetch slot for each bounded search variant so a broad full-query
// result page cannot consume the entire retrieval cap before topic hints run.
const MAX_CANDIDATES_PER_SEARCH_VARIANT = 1;
const SITEMAP_CACHE_MS = 15 * 60 * 1000;
const UNAVAILABLE_CACHE_MS = 30 * 1000;

export interface OfficialSourceDiscoveryProviderConfig {
  authority: string;
  approvedHosts: readonly string[];
  sitemapUrls?: readonly string[];
  preferredHosts?: readonly string[];
  /** Host used in the restricted `site:` query; it must be an approved host. */
  searchSite?: string;
  searchEndpoint?: string;
  searchRedirectHost?: string;
  searchRedirectParameter?: string;
  lexicalDiscovery: boolean;
}

/** Discovery configuration is provider data; IRAS is the sole configured provider in this phase. */
export const OFFICIAL_SOURCE_DISCOVERY_PROVIDERS: Readonly<Record<string, OfficialSourceDiscoveryProviderConfig>> = Object.freeze({
  IRAS: Object.freeze({
    authority: 'IRAS',
    approvedHosts: Object.freeze(['www.iras.gov.sg', 'iras.gov.sg']),
    sitemapUrls: Object.freeze(['https://www.iras.gov.sg/sitemap']),
    preferredHosts: Object.freeze(['www.iras.gov.sg', 'iras.gov.sg']),
    searchSite: 'iras.gov.sg',
    searchEndpoint: 'https://html.duckduckgo.com/html/',
    searchRedirectHost: 'duckduckgo.com',
    searchRedirectParameter: 'uddg',
    lexicalDiscovery: true
  })
});

export function getOfficialSourceDiscoveryProviderConfig(authority?: string): OfficialSourceDiscoveryProviderConfig | undefined {
  return authority && Object.prototype.hasOwnProperty.call(OFFICIAL_SOURCE_DISCOVERY_PROVIDERS, authority)
    ? OFFICIAL_SOURCE_DISCOVERY_PROVIDERS[authority]
    : undefined;
}

export interface OfficialSourceIndexEntry {
  authority: string;
  canonicalUrl: string;
  pageTitle?: string;
  hierarchy: string[];
  normalizedPath: string;
  topicHints: string[];
  discoverySourceUrl: string;
  discoveredAt: string;
}

interface SitemapCacheEntry {
  expiresAt: number;
  entries: OfficialSourceIndexEntry[];
}

function readLocValues(xml: string): string[] {
  const values: string[] = [];
  for (const match of xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)) {
    const raw = match[1]
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .trim();
    try {
      const url = new URL(raw);
      if (url.protocol === 'https:') values.push(url.toString());
    } catch {
      // Ignore malformed sitemap entries.
    }
  }
  return [...new Set(values)];
}

function decodeHtmlEntities(value: string): string {
  const decodeCodePoint = (raw: string, radix: number, original: string): string => {
    const codePoint = Number.parseInt(raw, radix);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      return original;
    }
    return String.fromCodePoint(codePoint);
  };
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (match, decimal: string) => decodeCodePoint(decimal, 10, match))
    .replace(/&#x([\da-f]+);/gi, (match, hex: string) => decodeCodePoint(hex, 16, match));
}

function normalizedPath(url: URL): string {
  return decodeURIComponent(url.pathname).toLowerCase().replace(/\/+$/, '') || '/';
}

function inferAuthority(host: string): string {
  if (host === 'iras.gov.sg' || host === 'www.iras.gov.sg') return 'IRAS';
  if (host === 'ifrs.org' || host === 'www.ifrs.org') return 'IFRS Foundation';
  if (host === 'sso.agc.gov.sg') return 'AGC';
  if (host === 'acra.gov.sg' || host === 'www.acra.gov.sg' || host === 'asc.acra.gov.sg') return 'ACRA';
  return 'OFFICIAL';
}

function makeIndexEntry(
  rawUrl: string,
  discoverySourceUrl: string,
  pageTitle?: string,
  hierarchy: string[] = [],
  authority?: string
): OfficialSourceIndexEntry | undefined {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return undefined;
    const path = normalizedPath(parsed);
    const pathHierarchy = path.split('/').filter(Boolean);
    // Sitemap entries sometimes omit anchor labels. Derive a ranking/validation
    // hint from the path slug; the fetched HTML title and body must still pass
    // the normal content validator before a page can become evidence.
    const slugTitle = pathHierarchy.at(-1)?.replace(/[-_]+/g, ' ');
    const title = pageTitle?.trim() || slugTitle || undefined;
    const hints = [...new Set(`${title || ''} ${hierarchy.join(' ')} ${pathHierarchy.join(' ')}`
      .toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length >= 4))];
    return {
      authority: authority || inferAuthority(parsed.hostname.toLowerCase()),
      canonicalUrl: parsed.toString(),
      pageTitle: title,
      hierarchy: [...hierarchy.filter(Boolean), ...pathHierarchy],
      normalizedPath: path,
      topicHints: hints,
      discoverySourceUrl,
      discoveredAt: new Date().toISOString()
    };
  } catch {
    return undefined;
  }
}

function readHtmlSitemapEntries(html: string, sitemapUrl: string, approvedHosts: readonly string[], authority?: string): OfficialSourceIndexEntry[] {
  const entries: OfficialSourceIndexEntry[] = [];
  const allowed = new Set(approvedHosts.map(host => host.toLowerCase()));
  const anchorPattern = /<a\b([^>]*)\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const rawHref = match[2] || match[3] || match[4] || '';
    const pageTitle = decodeHtmlEntities((match[6] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!rawHref || !pageTitle) continue;
    try {
      const candidate = new URL(decodeHtmlEntities(rawHref), sitemapUrl);
      if (candidate.protocol !== 'https:' || !allowed.has(candidate.hostname.toLowerCase()) ||
          /^\/(?:sitemap|sitemap\.xml)\/?$/i.test(candidate.pathname)) continue;
      const pathHierarchy = candidate.pathname.split('/').filter(Boolean).slice(0, -1);
      const entry = makeIndexEntry(candidate.toString(), sitemapUrl, pageTitle, pathHierarchy, authority);
      if (entry) entries.push(entry);
    } catch {
      // Malformed and off-domain page links are discovery noise, never evidence.
    }
  }
  return [...new Map(entries.map(entry => [entry.canonicalUrl, entry])).values()];
}

function standardPathTokens(standardOrAct: string): string[] {
  const tokens = new Set<string>();
  for (const match of standardOrAct.matchAll(/\b(SFRS\s*\(\s*I\s*\)|IFRS|IAS)\s*(\d+(?:\s*[-/]\s*\d+)?)\b/gi)) {
    const prefix = match[1].toUpperCase().replace(/\s+/g, '');
    const number = match[2].replace(/\s+/g, '');
    if (prefix === 'IAS' || (prefix.startsWith('SFRS') && number.includes('-'))) {
      const finalNumber = number.split(/[-/]/).at(-1)!;
      tokens.add(`ias${finalNumber}`);
      tokens.add(`ias-${finalNumber}`);
    } else {
      const standardPrefix = prefix.startsWith('SFRS') ? 'ifrs' : prefix.toLowerCase();
      tokens.add(`${standardPrefix}${number.replace(/[-/]/g, '')}`);
      tokens.add(`${standardPrefix}-${number.replace(/[-/]/g, '-')}`);
    }
  }
  return [...tokens];
}

function normalizeWords(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(word => {
    if (word.endsWith('ies') && word.length > 5) return `${word.slice(0, -3)}y`;
    if (word.endsWith('es') && word.length > 5) return word.slice(0, -2);
    if (word.endsWith('s') && word.length > 4) return word.slice(0, -1);
    return word;
  });
}

function candidateScore(entry: OfficialSourceIndexEntry, request: OfficialSourceDiscoveryRequest): number {
  const searchable = `${entry.pageTitle || ''} ${entry.hierarchy.join(' ')} ${entry.normalizedPath} ${entry.topicHints.join(' ')}`;
  const path = searchable.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const topicPhrases = [request.topicTitle, ...(request.topicHints || [])]
    .map(value => value.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  const standards = standardPathTokens(request.standardOrAct);
  const matchedStandard = standards.some(token => path.replace(/[^a-z0-9]+/g, '').includes(token.replace(/[^a-z0-9]+/g, '')));
  if (matchedStandard) {
    const topicWords = normalizeWords(`${request.query} ${topicPhrases.join(' ')}`)
      .filter(word => word.length >= 5);
    const candidateWords = new Set(normalizeWords(searchable));
    const matchedTopicWords = new Set(topicWords.filter(word => candidateWords.has(word)));
    return 10 + matchedTopicWords.size;
  }

  if (!request.lexicalDiscovery) return 0;

  // Provider-configured non-standard authorities can opt into topic-specific
  // lexical discovery. Sitemap membership remains ranking metadata only.
  const stopWords = new Set([
    'iras', 'singapore', 'tax', 'taxes', 'income', 'gst', 'goods', 'services',
    'company', 'companies', 'business', 'businesses', 'the', 'and', 'for', 'from',
    'with', 'under', 'into', 'what', 'when', 'where', 'does', 'should', 'can', 'are'
  ]);
  const candidateWords = new Set(normalizeWords(searchable));
  const expectedTitleWords = normalizeWords((request.expectedTitles || []).join(' '))
    .filter(word => word.length >= 4 && !stopWords.has(word));
  const topicTitleWords = normalizeWords(`${request.topicTitle} ${(request.topicHints || []).join(' ')}`)
    .filter(word => word.length >= 4 && !stopWords.has(word));
  const queryWords = normalizeWords(`${request.query} ${topicPhrases.join(' ')}`)
    .filter(word => word.length >= 5 && !stopWords.has(word));
  const matchedExpectedTitleWords = new Set(expectedTitleWords.filter(word => candidateWords.has(word)));
  const matchedTitleWords = new Set(topicTitleWords.filter(word => candidateWords.has(word)));
  const matchedQueryWords = new Set(queryWords.filter(word => candidateWords.has(word)));
  const expectedTitleMatch = matchedExpectedTitleWords.size >= 2 || [...matchedExpectedTitleWords].some(word => word.length >= 9);
  const distinctiveTitleMatch = [...matchedTitleWords].some(word => word.length >= 9);
  const matchedSpecificHint = (request.topicHints || []).some(hint => {
    const hintWords = normalizeWords(hint).filter(word => word.length >= 5 && !stopWords.has(word));
    const titleWords = new Set(normalizeWords(entry.pageTitle || ''));
    return hintWords.length >= 2 && hintWords.every(word => titleWords.has(word));
  });
  const matchedTopicPhrase = topicPhrases.some(phrase => {
    const phraseWords = normalizeWords(phrase).filter(word => word.length >= 4 && !stopWords.has(word));
    return phraseWords.length >= 2 && phraseWords.every(word => candidateWords.has(word));
  });
  const authorityQueryMatch = request.authorityLevelFallback &&
    [...matchedQueryWords].some(word => word.length >= 7);
  if (!expectedTitleMatch && !distinctiveTitleMatch && matchedTitleWords.size < 2 && matchedQueryWords.size < 2 &&
      !matchedSpecificHint && !matchedTopicPhrase && !authorityQueryMatch) return 0;
  return 20 + matchedExpectedTitleWords.size * 6 + matchedTitleWords.size * 4 + matchedQueryWords.size +
    (matchedSpecificHint ? 8 : 0) + (matchedTopicPhrase ? 8 : 0);
}

/**
 * Bounded, first-party URL discovery. Configured provider sitemap URLs are
 * tried first; other approved hosts use robots.txt sitemap locations. Index
 * membership is routing metadata only. Every candidate is separately fetched
 * and topic-validated before it can become evidence.
 */
export class OfficialSitemapDiscoveryAdapter implements OfficialSourceDiscoveryAdapter {
  private readonly retriever: ControlledWebRetriever;
  private readonly fetchOptions: { timeoutMs?: number; customFetch?: (url: string, init?: RequestInit) => Promise<Response> };
  private readonly sitemapCache = new Map<string, SitemapCacheEntry>();
  private readonly candidateIndex = new Map<string, OfficialSourceIndexEntry>();
  private lastFetchTrace: Array<{ topicId: string; status: string }> = [];

  constructor(
    retriever: ControlledWebRetriever,
    fetchOptions: { timeoutMs?: number; customFetch?: (url: string, init?: RequestInit) => Promise<Response> } = {}
  ) {
    this.retriever = retriever;
    this.fetchOptions = { timeoutMs: 1200, ...fetchOptions };
  }

  /** Read-only metadata snapshot for deterministic diagnostics and focused tests. */
  public getIndexedCandidates(): OfficialSourceIndexEntry[] {
    return [...this.candidateIndex.values()].map(entry => ({ ...entry, hierarchy: [...entry.hierarchy], topicHints: [...entry.topicHints] }));
  }

  public getCandidateTitle(url: string): string | undefined {
    return this.candidateIndex.get(url)?.pageTitle;
  }

  /** Bounded status-only trace for sitemap fetches; it is diagnostic metadata, never evidence. */
  public getLastFetchTrace(): Array<{ topicId: string; status: string }> {
    return this.lastFetchTrace.slice(0, 40).map(item => ({ ...item }));
  }

  private recordFetchStatus(request: OfficialSourceDiscoveryRequest, status: string): void {
    this.lastFetchTrace.push({ topicId: request.topicId.slice(0, 100), status: status.slice(0, 60) });
    if (this.lastFetchTrace.length > 40) this.lastFetchTrace.shift();
  }

  private async readConfiguredSitemapEntries(
    content: string,
    sitemapUrl: string,
    approvedHosts: readonly string[],
    request: OfficialSourceDiscoveryRequest
  ): Promise<OfficialSourceIndexEntry[]> {
    if (!/<(?:urlset|sitemapindex)\b/i.test(content)) {
      return readHtmlSitemapEntries(content, sitemapUrl, approvedHosts, request.authority);
    }

    const allowedHosts = new Set(approvedHosts.map(host => host.toLowerCase()));
    const locations: Array<{ url: string; sourceUrl: string }> = [];
    if (/<sitemapindex\b/i.test(content)) {
      const childSitemaps = readLocValues(content).filter(url => {
        try { return allowedHosts.has(new URL(url).hostname.toLowerCase()); } catch { return false; }
      }).slice(0, MAX_INDEX_CHILD_SITEMAPS);
      for (const childSitemapUrl of childSitemaps) {
        const childSitemap = await this.retriever.fetchOfficialSource(childSitemapUrl, {
          ...this.fetchOptions,
          useCache: false
        });
        this.recordFetchStatus(request, childSitemap.status);
        let finalHost = '';
        try { finalHost = new URL(childSitemap.finalUrl || '').hostname.toLowerCase(); } catch { /* reject below */ }
        if (childSitemap.status === 'SUCCESS' && childSitemap.content && allowedHosts.has(finalHost)) {
          locations.push(...readLocValues(childSitemap.content).map(url => ({ url, sourceUrl: childSitemap.finalUrl || childSitemapUrl })));
        }
      }
    } else {
      locations.push(...readLocValues(content).map(url => ({ url, sourceUrl: sitemapUrl })));
    }

    const entries = new Map<string, OfficialSourceIndexEntry>();
    for (const location of locations) {
      try {
        const url = new URL(location.url);
        if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname.toLowerCase())) continue;
        const entry = makeIndexEntry(url.toString(), location.sourceUrl, undefined, [], request.authority);
        if (entry) entries.set(entry.canonicalUrl, entry);
      } catch { /* Ignore malformed or unapproved XML locations. */ }
    }
    return [...entries.values()];
  }

  private async getSitemapEntries(host: string, approvedHosts: readonly string[], request: OfficialSourceDiscoveryRequest): Promise<OfficialSourceIndexEntry[]> {
    const allowedHosts = new Set(approvedHosts.map(item => item.toLowerCase()));
    const configuredSitemaps = (request.sitemapUrls || []).flatMap(value => {
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && allowedHosts.has(url.hostname.toLowerCase()) ? [url.toString()] : [];
      } catch { return []; }
    }).slice(0, MAX_SITEMAPS_PER_HOST);
    const cacheKey = `${request.authority || 'OFFICIAL'}|${host.toLowerCase()}|${configuredSitemaps.join('|')}`;
    const cached = this.sitemapCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.entries;

    if (configuredSitemaps.length > 0 && allowedHosts.has(host.toLowerCase())) {
      for (const sitemapUrl of configuredSitemaps) {
      const sitemap = await this.retriever.fetchOfficialSource(sitemapUrl, {
        ...this.fetchOptions,
        useCache: false
      });
      this.recordFetchStatus(request, sitemap.status);
      const finalHost = (() => {
        try { return new URL(sitemap.finalUrl || '').hostname.toLowerCase(); } catch { return ''; }
      })();
      if (sitemap.status === 'SUCCESS' && sitemap.content && allowedHosts.has(finalHost)) {
        const entries = await this.readConfiguredSitemapEntries(
          sitemap.content, sitemap.finalUrl || sitemapUrl, [...allowedHosts], request
        );
        if (entries.length > 0) {
          this.sitemapCache.set(cacheKey, { expiresAt: Date.now() + SITEMAP_CACHE_MS, entries });
          return entries;
        }
      }
      }
      // Fall through to robots.txt when an authority sitemap is unavailable.
    }

    const robots = await this.retriever.fetchOfficialSource(`https://${host}/robots.txt`, {
      ...this.fetchOptions,
      useCache: false
    });
    this.recordFetchStatus(request, robots.status);
    if (robots.status !== 'SUCCESS' || !robots.content) {
      this.sitemapCache.set(cacheKey, { expiresAt: Date.now() + UNAVAILABLE_CACHE_MS, entries: [] });
      return [];
    }

    const sitemapUrls = robots.content.split(/\r?\n/)
      .map(line => line.match(/^\s*sitemap:\s*(\S+)\s*$/i)?.[1])
      .filter((value): value is string => Boolean(value))
      .flatMap(value => {
        try {
          const url = new URL(value);
          return url.protocol === 'https:' && allowedHosts.has(url.hostname.toLowerCase()) ? [url.toString()] : [];
        } catch {
          return [];
        }
      })
      .slice(0, MAX_SITEMAPS_PER_HOST);
    if (sitemapUrls.length === 0) {
      this.sitemapCache.set(cacheKey, { expiresAt: Date.now() + UNAVAILABLE_CACHE_MS, entries: [] });
      return [];
    }

    const discovered = new Map<string, OfficialSourceIndexEntry>();
    for (const sitemapUrl of sitemapUrls) {
      const sitemap = await this.retriever.fetchOfficialSource(sitemapUrl, {
        ...this.fetchOptions,
        useCache: false
      });
      this.recordFetchStatus(request, sitemap.status);
      if (sitemap.status !== 'SUCCESS' || !sitemap.content) continue;
      let locations = readLocValues(sitemap.content);
      if (/<sitemapindex\b/i.test(sitemap.content)) {
        const childSitemaps = locations.filter(location => {
          try {
            return allowedHosts.has(new URL(location).hostname.toLowerCase());
          } catch {
            return false;
          }
        }).slice(0, MAX_INDEX_CHILD_SITEMAPS);
        locations = [];
        for (const childSitemapUrl of childSitemaps) {
          const childSitemap = await this.retriever.fetchOfficialSource(childSitemapUrl, {
            ...this.fetchOptions,
            useCache: false
          });
          this.recordFetchStatus(request, childSitemap.status);
          if (childSitemap.status === 'SUCCESS' && childSitemap.content) {
            locations.push(...readLocValues(childSitemap.content));
          }
        }
      }
      for (const location of locations) {
        try {
          const parsed = new URL(location);
          if (parsed.protocol === 'https:' && allowedHosts.has(parsed.hostname.toLowerCase())) {
            const entry = makeIndexEntry(parsed.toString(), sitemapUrl, undefined, [], request.authority);
            if (entry) discovered.set(entry.canonicalUrl, entry);
          }
        } catch {
          // readLocValues already filters invalid URLs; keep this boundary defensive.
        }
      }
    }

    const entries = [...discovered.values()];
    this.sitemapCache.set(cacheKey, {
      expiresAt: Date.now() + (entries.length > 0 ? SITEMAP_CACHE_MS : UNAVAILABLE_CACHE_MS),
      entries
    });
    return entries;
  }

  public async discoverOfficialSourceCandidates(request: OfficialSourceDiscoveryRequest): Promise<string[]> {
    this.lastFetchTrace = [];
    const approvedHosts = [...new Set(request.approvedHosts.map(host => host.toLowerCase()))];
    const distinctHosts = approvedHosts.filter(host => {
      if (!host.startsWith('www.') && approvedHosts.includes(`www.${host}`)) return false;
      return true;
    });
    const configuredOrder = request.preferredHosts?.map(host => host.toLowerCase()) || [];
    const preferredHosts = distinctHosts.sort((a, b) => {
      const aIndex = configuredOrder.indexOf(a);
      const bIndex = configuredOrder.indexOf(b);
      if (aIndex >= 0 || bIndex >= 0) return (aIndex < 0 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex < 0 ? Number.MAX_SAFE_INTEGER : bIndex);
      const score = (host: string) => host === 'www.ifrs.org' ? 0 : host === 'ifrs.org' ? 1 : host === 'asc.acra.gov.sg' ? 2 : 3;
      return score(a) - score(b);
    }).slice(0, MAX_HOSTS_PER_SEARCH);
    const candidates = new Map<string, OfficialSourceIndexEntry>();

    for (const host of preferredHosts) {
      const entries = await this.getSitemapEntries(host, approvedHosts, request);
      for (const entry of entries) {
        if (candidateScore(entry, request) > 0) {
          candidates.set(entry.canonicalUrl, entry);
          this.candidateIndex.set(entry.canonicalUrl, entry);
        }
      }
    }

    return [...candidates.values()]
      .sort((a, b) => candidateScore(b, request) - candidateScore(a, request))
      .slice(0, Math.min(MAX_CANDIDATES, request.maxCandidates || MAX_CANDIDATES))
      .map(entry => entry.canonicalUrl);
  }
}

/**
 * Last-resort URL discovery against a restricted first-party site query.
 * Search HTML and snippets are discovery metadata only. Returned URLs are
 * independently fetched and topic-validated by the grounding pipeline.
 */
export class OfficialDomainSearchAdapter {
  private readonly fetchOptions: { timeoutMs?: number; customFetch?: (url: string, init?: RequestInit) => Promise<Response> };
  private readonly candidateTitles = new Map<string, string>();
  private readonly candidateQueryVariants = new Map<string, 'FULL_QUERY' | 'TOPIC_HINT_1' | 'TOPIC_HINT_2' | 'TOPIC_HINT_3'>();
  private lastSearchTrace: Array<{ variant: 'FULL_QUERY' | 'TOPIC_HINT_1' | 'TOPIC_HINT_2' | 'TOPIC_HINT_3'; candidateUrls: string[]; status: 'RESULTS' | 'NO_CANDIDATES'; reason?: string }> = [];

  constructor(
    _retriever: ControlledWebRetriever,
    fetchOptions: { timeoutMs?: number; customFetch?: (url: string, init?: RequestInit) => Promise<Response> } = {}
  ) {
    this.fetchOptions = { timeoutMs: 3000, ...fetchOptions };
  }

  public getCandidateTitle(url: string): string | undefined {
    return this.candidateTitles.get(url);
  }

  public getCandidateQueryVariant(url: string): 'FULL_QUERY' | 'TOPIC_HINT_1' | 'TOPIC_HINT_2' | 'TOPIC_HINT_3' | undefined {
    return this.candidateQueryVariants.get(url);
  }

  public getLastSearchTrace(): Array<{ variant: 'FULL_QUERY' | 'TOPIC_HINT_1' | 'TOPIC_HINT_2' | 'TOPIC_HINT_3'; candidateUrls: string[]; status: 'RESULTS' | 'NO_CANDIDATES'; reason?: string }> {
    return this.lastSearchTrace.map(trace => ({ ...trace, candidateUrls: [...trace.candidateUrls] }));
  }

  private buildSearchQueries(request: OfficialSourceDiscoveryRequest, searchSite: string): { queries: string[]; context?: string } {
    const genericContextWords = new Set([
      'iras', 'singapore', 'individual', 'employee', 'employer', 'company', 'corporate', 'business',
      'official', 'guidance', 'tax', 'income', 'the', 'and', 'for', 'from', 'with', 'under'
    ]);
    const queryWords = new Set(normalizeWords(request.query).filter(word => !genericContextWords.has(word)));
    const candidates = [...(request.topicHints || []), request.topicTitle]
      .map(value => value.trim().replace(/\s+/g, ' ').replace(/"/g, ''))
      .filter(Boolean)
      .map((phrase, index) => ({
        phrase,
        index,
        tokenCount: normalizeWords(phrase).length,
        allWords: [...new Set(normalizeWords(phrase))],
        words: [...new Set(normalizeWords(phrase).filter(word => !genericContextWords.has(word)))],
      }))
      .filter(candidate => candidate.words.length >= 2);
    const rankedHints = [...candidates].sort((a, b) =>
      this.searchHintScore(b.words, queryWords) - this.searchHintScore(a.words, queryWords) ||
      b.words.filter(word => !queryWords.has(word)).length - a.words.filter(word => !queryWords.has(word)).length ||
      a.index - b.index || a.tokenCount - b.tokenCount
    );
    const selectedHints: typeof rankedHints = [];
    for (const candidate of rankedHints) {
      const words = new Set(candidate.words);
      const overlapsExisting = selectedHints.some(selected => {
        const selectedWords = new Set(selected.words);
        const intersection = [...words].filter(word => selectedWords.has(word)).length;
        const union = new Set([...words, ...selectedWords]).size;
        return union > 0 && intersection / union >= 0.8;
      });
      if (!overlapsExisting) selectedHints.push(candidate);
      if (selectedHints.length >= 3) break;
    }
    // Preserve the full user query as the first attempt. Later variants use
    // compact registry phrases without exact-phrase quoting, which lets search
    // engines tolerate punctuation, inflection, and page-title variants.
    const fullQuery = `site:${searchSite} ${request.query.trim()}`;
    const topicQueries = selectedHints.map(candidate => {
      const stopwords = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'under', 'with']);
      const searchTerms = candidate.allWords.filter(word => !stopwords.has(word));
      return `site:${searchSite} ${searchTerms.join(' ')}`;
    });
    return {
      queries: [...new Set([fullQuery, ...topicQueries])].slice(0, 4),
      context: selectedHints[0]?.phrase
    };
  }

  private searchHintScore(words: readonly string[], queryWords: ReadonlySet<string>): number {
    const newWords = words.filter(word => !queryWords.has(word)).length;
    const queryOverlap = words.filter(word => queryWords.has(word)).length;
    const hasEmployment = words.some(word => ['employment', 'employee', 'employees'].includes(word));
    const hasCrossBorder = words.some(word => ['foreign', 'overseas', 'abroad', 'outside', 'sourced'].includes(word));
    const hasTreaty = words.some(word => ['dta', 'treaty', 'agreement', 'agreements', 'exemption', 'relief'].includes(word));
    const topicSpecificPairBoost = Number(hasEmployment && hasCrossBorder) * 100 + Number(hasEmployment && hasTreaty) * 100;
    return topicSpecificPairBoost + newWords * 5 + queryOverlap * 2;
  }

  public async searchOfficialDomainCandidates(request: OfficialSourceDiscoveryRequest): Promise<string[]> {
    const approvedHosts = new Set(request.approvedHosts.map(host => host.toLowerCase()));
    if (request.lexicalDiscovery !== true || !request.searchSite || !request.searchEndpoint ||
        !request.searchRedirectHost || !request.searchRedirectParameter) return [];
    let searchSite = '';
    try {
      const configuredSite = new URL(`https://${request.searchSite}`);
      if (configuredSite.protocol !== 'https:' || configuredSite.username || configuredSite.password ||
          configuredSite.pathname !== '/' || configuredSite.search || configuredSite.hash) return [];
      searchSite = configuredSite.hostname.toLowerCase();
    } catch { return []; }
    if (!approvedHosts.has(searchSite)) return [];

    let endpoint: URL;
    let redirectHostname = '';
    try {
      endpoint = new URL(request.searchEndpoint);
      const configuredRedirectHost = new URL(`https://${request.searchRedirectHost}`);
      if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash || endpoint.search ||
          configuredRedirectHost.pathname !== '/' || configuredRedirectHost.username || configuredRedirectHost.password ||
          configuredRedirectHost.search || configuredRedirectHost.hash || !/^[a-z][a-z\d_-]*$/i.test(request.searchRedirectParameter)) return [];
      redirectHostname = configuredRedirectHost.hostname.toLowerCase();
    } catch { return []; }

    const customFetch = this.fetchOptions.customFetch || (globalThis.fetch ? globalThis.fetch.bind(globalThis) : undefined);
    if (!customFetch) return [];
    const { queries, context } = this.buildSearchQueries(request, searchSite);
    const candidateLimit = Math.min(request.maxCandidates || MAX_CANDIDATES, MAX_CANDIDATES);
    this.lastSearchTrace = [];
    this.candidateQueryVariants.clear();
    const found = new Map<string, string>();
    const contextWords = new Set(normalizeWords(context || request.topicTitle)
      .filter(word => word.length >= 4 && !['iras', 'singapore', 'individual', 'employee', 'employer', 'official', 'guidance', 'tax', 'income'].includes(word)));

    // Search the complete question first, then relax to one topic-specific
    // phrase if needed. Both variants stay restricted to the configured site;
    // result titles/snippets remain metadata and pages still require a fetch.
    for (const [queryIndex, searchQuery] of queries.entries()) {
      if (found.size >= candidateLimit) break;
      const variant = queryIndex === 0 ? 'FULL_QUERY' as const : `TOPIC_HINT_${queryIndex}` as 'TOPIC_HINT_1' | 'TOPIC_HINT_2' | 'TOPIC_HINT_3';
      const queryCandidateUrls = new Set<string>();
      const variantCandidates = new Map<string, string>();
      const traceReason = 'No approved official HTTPS URL candidates were returned for this restricted query variant.';
      endpoint.searchParams.set('q', searchQuery);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.fetchOptions.timeoutMs);
      try {
        let html = '';
        let searchHost = endpoint.hostname;
        let directResponse: Response | undefined;
        try {
          directResponse = await customFetch(endpoint.toString(), {
            method: 'GET', signal: controller.signal, redirect: 'manual', headers: { Accept: 'text/html' }
          });
          if (directResponse.ok && directResponse.status === 200) html = await directResponse.text();
        } catch (error) {
          if (controller.signal.aborted) throw error;
          // A browser CORS/network failure for the direct HTML search should
          // still allow the existing fixed Jina rendering fallback below.
        }
        if (!html) {
          if (controller.signal.aborted) throw new Error('Official-domain search request timed out.');
          // Some environments rate-limit direct HTML search. A text-rendering
          // proxy may expose the same restricted query as Markdown; its output
          // remains untrusted metadata and only approved-host URLs are retained.
          const proxy = new URL(`https://r.jina.ai/http://${endpoint.host}${endpoint.pathname}?q=${encodeURIComponent(searchQuery)}`);
          const proxyResponse = await customFetch(proxy.toString(), {
            method: 'GET', signal: controller.signal, redirect: 'manual', headers: { Accept: 'text/plain' }
          });
          if (!proxyResponse.ok || proxyResponse.status >= 300) continue;
          if (proxyResponse.url) {
            try {
              const finalUrl = new URL(proxyResponse.url);
              if (finalUrl.origin !== proxy.origin) continue;
            } catch { continue; }
          }
          searchHost = proxy.hostname;
          html = await proxyResponse.text();
        } else if (directResponse?.url) {
          try {
            const finalUrl = new URL(directResponse.url);
            if (finalUrl.origin !== endpoint.origin) continue;
          } catch { continue; }
        }
        const candidates: Array<{ href: string; title: string }> = [];
        const anchorPattern = /<a\b([^>]*)\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))([^>]*)>([\s\S]*?)<\/a\s*>/gi;
        for (const match of html.matchAll(anchorPattern)) {
          candidates.push({
            href: decodeHtmlEntities(match[2] || match[3] || match[4] || ''),
            title: decodeHtmlEntities((match[6] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
          });
        }
        if (searchHost === 'r.jina.ai') {
          // DDG's Jina-rendered Markdown wraps URLs that may contain literal
          // parentheses (for example `(DTAs)`) and appends tracking parameters.
          // Capture the whole Markdown target, then only unwrap the configured
          // `uddg` parameter below; tracking parameters never supply a URL.
          for (const match of html.matchAll(/^## \[([^\]]*)\]\((https?:\/\/[^\r\n]+)\)$/gm)) {
            candidates.push({ href: match[2], title: match[1].replace(/\*\*/g, '').trim() });
          }
        }
        for (const candidate of candidates) {
          if (!candidate.href) continue;
          let resultUrl: URL;
          try {
            const link = new URL(candidate.href, endpoint);
            if (link.hostname.toLowerCase() === redirectHostname &&
                (link.protocol === 'https:' || link.protocol === 'http:') && !link.username && !link.password && !link.port) {
              const wrapped = link.searchParams.get(request.searchRedirectParameter);
              if (!wrapped) continue;
              resultUrl = new URL(wrapped);
            } else {
              resultUrl = link;
            }
          } catch { continue; }
          if (resultUrl.protocol !== 'https:' || resultUrl.username || resultUrl.password || !approvedHosts.has(resultUrl.hostname.toLowerCase())) continue;
          resultUrl.hash = '';
          const canonicalUrl = resultUrl.toString();
          queryCandidateUrls.add(canonicalUrl);
          if (!variantCandidates.has(canonicalUrl) || candidate.title) variantCandidates.set(canonicalUrl, candidate.title);
        }
      } catch {
        // A failed/empty full-query attempt must not prevent the bounded topic
        // query from running.
      } finally {
        clearTimeout(timeoutId);
        const rankByContext = (entries: Array<[string, string]>) => entries.sort(([urlA, titleA], [urlB, titleB]) => {
          const score = (url: string, title: string) => {
            const candidateWords = new Set(normalizeWords(`${title} ${url}`));
            return [...contextWords].filter(word => candidateWords.has(word)).length;
          };
          return score(urlB, titleB) - score(urlA, titleA);
        });
        const selectedVariantCandidates = rankByContext([...variantCandidates.entries()])
          .slice(0, Math.min(MAX_CANDIDATES_PER_SEARCH_VARIANT, candidateLimit - found.size));
        for (const [candidateUrl, title] of selectedVariantCandidates) {
          if (!found.has(candidateUrl)) {
            this.candidateQueryVariants.set(candidateUrl, variant);
            found.set(candidateUrl, title);
            this.candidateTitles.set(candidateUrl, title);
          } else if (variant !== 'FULL_QUERY') {
            // If a topic-specific query independently finds the same page,
            // retain that stronger discovery route for fetch ordering.
            this.candidateQueryVariants.set(candidateUrl, variant);
          }
        }
        this.lastSearchTrace.push({
          variant,
          candidateUrls: [...queryCandidateUrls],
          status: queryCandidateUrls.size ? 'RESULTS' : 'NO_CANDIDATES',
          ...(queryCandidateUrls.size ? {} : { reason: traceReason })
        });
      }
    }
    const rankedCandidates = [...found.entries()].sort(([urlA, titleA], [urlB, titleB]) => {
      const score = (url: string, title: string) => {
        const candidateWords = new Set(normalizeWords(`${title} ${url}`));
        return [...contextWords].filter(word => candidateWords.has(word)).length;
      };
      const variantPriority = (url: string) => {
        const variant = this.candidateQueryVariants.get(url);
        if (variant === 'FULL_QUERY') return 4;
        return variant ? Number(variant.slice(-1)) - 1 : 3;
      };
      const priorityDifference = variantPriority(urlA) - variantPriority(urlB);
      if (priorityDifference !== 0) return priorityDifference;
      return score(urlB, titleB) - score(urlA, titleA);
    });
    for (const [url, title] of rankedCandidates) this.candidateTitles.set(url, title);
    return rankedCandidates.slice(0, candidateLimit).map(([url]) => url);
  }
}
