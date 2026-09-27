import { ControlledWebRetriever } from './controlledWebRetriever';
import type { OfficialSourceDiscoveryAdapter, OfficialSourceDiscoveryRequest } from '../services/groundingContextBuilder';

const MAX_HOSTS_PER_SEARCH = 2;
const MAX_SITEMAPS_PER_HOST = 1;
const MAX_INDEX_CHILD_SITEMAPS = 2;
const MAX_CANDIDATES = 2;
const SITEMAP_CACHE_MS = 15 * 60 * 1000;
const UNAVAILABLE_CACHE_MS = 30 * 1000;

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
  hierarchy: string[] = []
): OfficialSourceIndexEntry | undefined {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return undefined;
    const path = normalizedPath(parsed);
    const pathHierarchy = path.split('/').filter(Boolean);
    const title = pageTitle?.trim() || undefined;
    const hints = [...new Set(`${title || ''} ${hierarchy.join(' ')} ${pathHierarchy.join(' ')}`
      .toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length >= 4))];
    return {
      authority: inferAuthority(parsed.hostname.toLowerCase()),
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

function readHtmlSitemapEntries(html: string, sitemapUrl: string, approvedHosts: readonly string[]): OfficialSourceIndexEntry[] {
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
      const entry = makeIndexEntry(candidate.toString(), sitemapUrl, pageTitle, pathHierarchy);
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
  const standards = standardPathTokens(request.standardOrAct);
  const matchedStandard = standards.some(token => path.replace(/[^a-z0-9]+/g, '').includes(token.replace(/[^a-z0-9]+/g, '')));
  if (matchedStandard) {
    const topicWords = normalizeWords(`${request.topicTitle} ${(request.topicHints || []).join(' ')} ${request.query}`)
      .filter(word => word.length >= 5);
    const candidateWords = new Set(normalizeWords(searchable));
    const matchedTopicWords = new Set(topicWords.filter(word => candidateWords.has(word)));
    return 10 + matchedTopicWords.size;
  }

  const irasDiscovery = request.approvedHosts.some(host => ['iras.gov.sg', 'www.iras.gov.sg', 'sso.agc.gov.sg'].includes(host.toLowerCase()));
  if (!irasDiscovery) return 0;

  // IRAS and SSO sitemap routes do not encode IFRS/IAS standard IDs in their
  // path. Score only topic-specific lexical overlap and reject broad landing
  // pages that happen to share generic words such as "tax", "GST" or "income".
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
  const queryWords = normalizeWords(request.query)
    .filter(word => word.length >= 5 && !stopWords.has(word));
  const matchedExpectedTitleWords = new Set(expectedTitleWords.filter(word => candidateWords.has(word)));
  const matchedTitleWords = new Set(topicTitleWords.filter(word => candidateWords.has(word)));
  const matchedQueryWords = new Set(queryWords.filter(word => candidateWords.has(word)));
  const expectedTitleMatch = matchedExpectedTitleWords.size >= 2 || [...matchedExpectedTitleWords].some(word => word.length >= 9);
  const distinctiveTitleMatch = [...matchedTitleWords].some(word => word.length >= 9);
  const matchedSpecificHint = (request.topicHints || []).some(hint => {
    const hintWords = normalizeWords(hint).filter(word => word.length >= 5 && !stopWords.has(word));
    const titleWords = new Set(normalizeWords(entry.pageTitle || ''));
    return hintWords.length > 0 && hintWords.some(word => titleWords.has(word));
  });
  if (!expectedTitleMatch && !distinctiveTitleMatch && matchedTitleWords.size < 2 && matchedQueryWords.size < 2 && !matchedSpecificHint) return 0;
  return 20 + matchedExpectedTitleWords.size * 6 + matchedTitleWords.size * 4 + matchedQueryWords.size + (matchedSpecificHint ? 3 : 0);
}

/**
 * Bounded, first-party URL discovery. IRAS pages are indexed from its published
 * HTML sitemap first; other approved hosts continue to use robots.txt sitemap
 * locations. Index membership is routing metadata only. Every candidate is
 * separately fetched and topic-validated before it can become evidence.
 */
export class OfficialSitemapDiscoveryAdapter implements OfficialSourceDiscoveryAdapter {
  private readonly retriever: ControlledWebRetriever;
  private readonly fetchOptions: { timeoutMs?: number; customFetch?: (url: string, init?: RequestInit) => Promise<Response> };
  private readonly sitemapCache = new Map<string, SitemapCacheEntry>();
  private readonly candidateIndex = new Map<string, OfficialSourceIndexEntry>();

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

  private async getSitemapEntries(host: string, approvedHosts: readonly string[]): Promise<OfficialSourceIndexEntry[]> {
    const cached = this.sitemapCache.get(host);
    if (cached && cached.expiresAt > Date.now()) return cached.entries;

    const isIrasHost = host === 'iras.gov.sg' || host === 'www.iras.gov.sg';
    if (isIrasHost) {
      const sitemapUrl = 'https://www.iras.gov.sg/sitemap';
      const irasHosts = new Set<string>(approvedHosts.filter(item => item === 'iras.gov.sg' || item === 'www.iras.gov.sg'));
      const sitemap = await this.retriever.fetchOfficialSource(sitemapUrl, {
        ...this.fetchOptions,
        useCache: false
      });
      const finalHost = (() => {
        try { return new URL(sitemap.finalUrl || '').hostname.toLowerCase(); } catch { return ''; }
      })();
      if (sitemap.status === 'SUCCESS' && sitemap.content && irasHosts.has(finalHost)) {
        const entries = readHtmlSitemapEntries(sitemap.content, sitemap.finalUrl || sitemapUrl, [...irasHosts]);
        if (entries.length > 0) {
          this.sitemapCache.set(host, { expiresAt: Date.now() + SITEMAP_CACHE_MS, entries });
          return entries;
        }
      }
      // Retain the earlier first-party sitemap mechanism as an availability
      // fallback. It is still index metadata and never substantive evidence.
    }

    const robots = await this.retriever.fetchOfficialSource(`https://${host}/robots.txt`, {
      ...this.fetchOptions,
      useCache: false
    });
    if (robots.status !== 'SUCCESS' || !robots.content) {
      this.sitemapCache.set(host, { expiresAt: Date.now() + UNAVAILABLE_CACHE_MS, entries: [] });
      return [];
    }

    const allowedHosts = new Set(approvedHosts.map(item => item.toLowerCase()));
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
      this.sitemapCache.set(host, { expiresAt: Date.now() + UNAVAILABLE_CACHE_MS, entries: [] });
      return [];
    }

    const discovered = new Map<string, OfficialSourceIndexEntry>();
    for (const sitemapUrl of sitemapUrls) {
      const sitemap = await this.retriever.fetchOfficialSource(sitemapUrl, {
        ...this.fetchOptions,
        useCache: false
      });
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
          if (childSitemap.status === 'SUCCESS' && childSitemap.content) {
            locations.push(...readLocValues(childSitemap.content));
          }
        }
      }
      for (const location of locations) {
        try {
          const parsed = new URL(location);
          if (parsed.protocol === 'https:' && allowedHosts.has(parsed.hostname.toLowerCase())) {
            const entry = makeIndexEntry(parsed.toString(), sitemapUrl);
            if (entry) discovered.set(entry.canonicalUrl, entry);
          }
        } catch {
          // readLocValues already filters invalid URLs; keep this boundary defensive.
        }
      }
    }

    const entries = [...discovered.values()];
    this.sitemapCache.set(host, {
      expiresAt: Date.now() + (entries.length > 0 ? SITEMAP_CACHE_MS : UNAVAILABLE_CACHE_MS),
      entries
    });
    return entries;
  }

  public async discoverOfficialSourceCandidates(request: OfficialSourceDiscoveryRequest): Promise<string[]> {
    const approvedHosts = [...new Set(request.approvedHosts.map(host => host.toLowerCase()))];
    const distinctHosts = approvedHosts.filter(host => {
      if (host === 'ifrs.org' && approvedHosts.includes('www.ifrs.org')) return false;
      if (host === 'acra.gov.sg' && approvedHosts.includes('www.acra.gov.sg')) return false;
      if (host === 'iras.gov.sg' && approvedHosts.includes('www.iras.gov.sg')) return false;
      return true;
    });
    const preferredHosts = distinctHosts.sort((a, b) => {
      const score = (host: string) => host === 'www.ifrs.org' ? 0 : host === 'ifrs.org' ? 1 : host === 'www.iras.gov.sg' ? 2 : host === 'iras.gov.sg' ? 3 : host === 'asc.acra.gov.sg' ? 4 : host === 'sso.agc.gov.sg' ? 5 : 6;
      return score(a) - score(b);
    }).slice(0, MAX_HOSTS_PER_SEARCH);
    const candidates = new Map<string, OfficialSourceIndexEntry>();

    for (const host of preferredHosts) {
      const entries = await this.getSitemapEntries(host, approvedHosts);
      for (const entry of entries) {
        if (candidateScore(entry, request) > 0) {
          candidates.set(entry.canonicalUrl, entry);
          this.candidateIndex.set(entry.canonicalUrl, entry);
        }
      }
    }

    return [...candidates.values()]
      .sort((a, b) => candidateScore(b, request) - candidateScore(a, request))
      .slice(0, MAX_CANDIDATES)
      .map(entry => entry.canonicalUrl);
  }
}
