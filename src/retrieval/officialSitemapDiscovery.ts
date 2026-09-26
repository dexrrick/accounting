import { ControlledWebRetriever } from './controlledWebRetriever';
import type { OfficialSourceDiscoveryAdapter, OfficialSourceDiscoveryRequest } from '../services/groundingContextBuilder';

const MAX_HOSTS_PER_SEARCH = 2;
const MAX_SITEMAPS_PER_HOST = 1;
const MAX_INDEX_CHILD_SITEMAPS = 2;
const MAX_CANDIDATES = 2;
const SITEMAP_CACHE_MS = 15 * 60 * 1000;
const UNAVAILABLE_CACHE_MS = 30 * 1000;

interface SitemapCacheEntry {
  expiresAt: number;
  urls: string[];
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

function candidateScore(url: string, request: OfficialSourceDiscoveryRequest): number {
  const path = new URL(url).pathname.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const standards = standardPathTokens(request.standardOrAct);
  const matchedStandard = standards.some(token => path.replace(/[^a-z0-9]+/g, '').includes(token.replace(/[^a-z0-9]+/g, '')));
  if (!matchedStandard) return 0;

  const topicWords = `${request.topicTitle} ${request.query}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(word => word.length >= 5);
  const matchedTopicWords = new Set(topicWords.filter(word => path.includes(word)));
  return 10 + matchedTopicWords.size;
}

/**
 * Bounded first-party discovery using each approved host's robots.txt and only
 * sitemap locations named by that file. Every discovered candidate is later
 * fetched and topic-validated by resolveMappedOfficialSourceFallback.
 * Unavailable robots/sitemap endpoints fail closed and return no candidates.
 */
export class OfficialSitemapDiscoveryAdapter implements OfficialSourceDiscoveryAdapter {
  private readonly retriever: ControlledWebRetriever;
  private readonly fetchOptions: { timeoutMs?: number; customFetch?: (url: string, init?: RequestInit) => Promise<Response> };
  private readonly sitemapCache = new Map<string, SitemapCacheEntry>();

  constructor(
    retriever: ControlledWebRetriever,
    fetchOptions: { timeoutMs?: number; customFetch?: (url: string, init?: RequestInit) => Promise<Response> } = {}
  ) {
    this.retriever = retriever;
    this.fetchOptions = { timeoutMs: 1200, ...fetchOptions };
  }

  private async getSitemapUrls(host: string, approvedHosts: readonly string[]): Promise<string[]> {
    const cached = this.sitemapCache.get(host);
    if (cached && cached.expiresAt > Date.now()) return cached.urls;

    const robots = await this.retriever.fetchOfficialSource(`https://${host}/robots.txt`, {
      ...this.fetchOptions,
      useCache: false
    });
    if (robots.status !== 'SUCCESS' || !robots.content) {
      this.sitemapCache.set(host, { expiresAt: Date.now() + UNAVAILABLE_CACHE_MS, urls: [] });
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
      this.sitemapCache.set(host, { expiresAt: Date.now() + UNAVAILABLE_CACHE_MS, urls: [] });
      return [];
    }

    const discovered = new Set<string>();
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
          if (allowedHosts.has(parsed.hostname.toLowerCase())) discovered.add(parsed.toString());
        } catch {
          // readLocValues already filters invalid URLs; keep this boundary defensive.
        }
      }
    }

    const urls = [...discovered];
    this.sitemapCache.set(host, {
      expiresAt: Date.now() + (urls.length > 0 ? SITEMAP_CACHE_MS : UNAVAILABLE_CACHE_MS),
      urls
    });
    return urls;
  }

  public async discoverOfficialSourceCandidates(request: OfficialSourceDiscoveryRequest): Promise<string[]> {
    const approvedHosts = [...new Set(request.approvedHosts.map(host => host.toLowerCase()))];
    const distinctHosts = approvedHosts.filter(host => {
      if (host === 'ifrs.org' && approvedHosts.includes('www.ifrs.org')) return false;
      if (host === 'acra.gov.sg' && approvedHosts.includes('www.acra.gov.sg')) return false;
      return true;
    });
    const preferredHosts = distinctHosts.sort((a, b) => {
      const score = (host: string) => host === 'www.ifrs.org' ? 0 : host === 'ifrs.org' ? 1 : host === 'asc.acra.gov.sg' ? 2 : 3;
      return score(a) - score(b);
    }).slice(0, MAX_HOSTS_PER_SEARCH);
    const candidates = new Set<string>();

    for (const host of preferredHosts) {
      const sitemapUrls = await this.getSitemapUrls(host, approvedHosts);
      for (const url of sitemapUrls) {
        if (candidateScore(url, request) > 0) candidates.add(url);
      }
      if (candidates.size > 0) break;
    }

    return [...candidates]
      .sort((a, b) => candidateScore(b, request) - candidateScore(a, request))
      .slice(0, MAX_CANDIDATES);
  }
}
