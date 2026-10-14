import { defaultExternalSourceValidator, ExternalSourceValidator, type TopicContentExpectation } from './externalSourceValidator';
import { defaultSourceCache, SourceCache, type CachedSource } from './sourceCache';
import { computeSha256, computeSha256Bytes } from '../standards/sourceVersioning';
import { getDefaultOfficialSourceFetch, type OfficialSourceResponse } from './officialSourceTransport';

export type ControlledFetchStatus =
  | 'SUCCESS'
  | 'TIMEOUT'
  | 'CORS_ERROR'
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'UNAUTHORIZED_DOMAIN_ACCESS'
  | 'INVALID_URL'
  | 'INVALID_CONTENT'
  | 'REDIRECT_REJECTED'
  | 'HASH_MISMATCH'
  | 'PROVENANCE_MISMATCH'
  | 'TOPIC_MISMATCH';

export interface ControlledFetchOptions {
  timeoutMs?: number;
  useCache?: boolean;
  ttlMs?: number;
  expectedHash?: string;
  customFetch?: (url: string, init?: RequestInit) => Promise<Response>;
  redirectCount?: number;
  maxRedirects?: number;
  /** Requires fetched title and substantive page content to match the mapped topic. */
  topicValidation?: TopicContentExpectation;
  /** Fetch bounded raw document bytes instead of the legacy text response. */
  responseMode?: 'TEXT' | 'DOCUMENT';
  /** Maximum response payload bytes when responseMode is DOCUMENT. */
  maxResponseBytes?: number;
}

export interface ControlledFetchResult {
  status: ControlledFetchStatus;
  httpStatus?: number;
  content?: string;
  contentBytes?: Uint8Array;
  contentType?: string;
  contentHash?: string;
  cached?: boolean;
  error?: string;
  retrievedAt: string;
  sourceUrl: string;
  finalUrl?: string;
  pageTitle?: string;
  topicMatched?: boolean;
  titleMatched?: boolean;
  contentMatched?: boolean;
  substantiveText?: string;
  /** Explicit HTML anchor targets from this fetched page; discovery metadata only. */
  discoveredLinks?: Array<{ href: string; text: string }>;
  etag?: string;
  lastModified?: string;
}

const DEFAULT_MAX_DOCUMENT_RESPONSE_BYTES = 1_500_000;
const DOCUMENT_CONTENT_TYPES = ['application/pdf', 'text/html', 'application/xhtml+xml', 'text/plain'];

async function readBoundedResponseBytes(
  response: Response,
  maximumBytes: number,
  timeoutMs: number,
  controller: AbortController
): Promise<{ bytes?: Uint8Array; status: 'SUCCESS' | 'TOO_LARGE' | 'TIMEOUT' | 'READ_ERROR' }> {
  if (!response.body) return { bytes: new Uint8Array(), status: 'SUCCESS' };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const readPromise = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maximumBytes) {
          void reader.cancel().catch(() => undefined);
          return { status: 'TOO_LARGE' as const };
        }
        chunks.push(value);
      }
    } catch {
      return { status: 'READ_ERROR' as const };
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { bytes, status: 'SUCCESS' as const };
  })();
  const timeoutPromise = new Promise<{ status: 'TIMEOUT' }>(resolve => {
    timeout = setTimeout(() => {
      controller.abort();
      void reader.cancel().catch(() => undefined);
      resolve({ status: 'TIMEOUT' });
    }, timeoutMs);
  });
  try {
    return await Promise.race([readPromise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function extractExplicitAnchorLinks(html: string): Array<{ href: string; text: string }> {
  const links: Array<{ href: string; text: string }> = [];
  const withoutChrome = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const mainContent = withoutChrome.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i)?.[1];
  const articleContent = withoutChrome.match(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/i)?.[1];
  const bodyContent = withoutChrome.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)?.[1];
  // IRAS pages can have hundreds of header/footer anchors before their actual
  // guidance links. Scope discovery to the content region before applying the
  // cap, so chrome cannot crowd substantive first-party navigation out.
  const contentMarkup = mainContent || articleContent || bodyContent || withoutChrome;
  const decode = (value: string): string => value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&nbsp;|&#160;/gi, ' ')
    .trim();
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  for (const match of contentMarkup.matchAll(anchorPattern)) {
    const hrefMatch = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[1]);
    const href = decode(hrefMatch?.[1] || hrefMatch?.[2] || hrefMatch?.[3] || '');
    if (!href) continue;
    const text = decode((match[2] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).slice(0, 500);
    links.push({ href, text });
    if (links.length >= 200) break;
  }
  return links;
}

/**
 * Controlled External Web Retriever.
 * Safely fetches official statutory resources adhering to exact-hostname allowlists,
 * HTTPS on port 443, 3000ms timeouts, and non-throwing failure handling.
 */
export class ControlledWebRetriever {
  private validator: ExternalSourceValidator;
  private cache: SourceCache;

  constructor(validator: ExternalSourceValidator = defaultExternalSourceValidator, cache: SourceCache = defaultSourceCache) {
    this.validator = validator;
    this.cache = cache;
  }

  /**
   * Fetches official source with strict security validation, caching, and timeout controls.
   */
  public async fetchOfficialSource(
    url: string,
    options: ControlledFetchOptions = {}
  ): Promise<ControlledFetchResult> {
    const {
      timeoutMs = 3000,
      useCache = true,
      ttlMs,
      expectedHash,
      customFetch,
      responseMode = 'TEXT',
      maxResponseBytes = DEFAULT_MAX_DOCUMENT_RESPONSE_BYTES
    } = options;
    const documentByteLimit = Math.min(maxResponseBytes, DEFAULT_MAX_DOCUMENT_RESPONSE_BYTES);
    const documentTimeoutMs = Math.min(timeoutMs, 15_000);
    if (responseMode === 'DOCUMENT' && (!Number.isFinite(maxResponseBytes) || maxResponseBytes <= 0 ||
        !Number.isFinite(timeoutMs) || timeoutMs <= 0 || documentByteLimit <= 0)) {
      return { status: 'INVALID_CONTENT', error: 'Document byte and timeout limits must be finite positive values', retrievedAt: new Date().toISOString(), sourceUrl: url };
    }
    const fetchTransport = customFetch ?? getDefaultOfficialSourceFetch();

    const retrievedAt = new Date().toISOString();

    // 1. Validate URL security and allowlist
    const secValidation = this.validator.validateUrlSecurity(url);
    if (!secValidation.isValid) {
      return {
        status: secValidation.errorCode === 'UNAUTHORIZED_DOMAIN_ACCESS'
          ? 'UNAUTHORIZED_DOMAIN_ACCESS'
          : 'INVALID_URL',
        error: secValidation.reason,
        retrievedAt,
        sourceUrl: url
      };
    }

    // 2. Check source cache
    let cached: CachedSource | null = null;
    if (useCache && responseMode === 'TEXT') {
      cached = this.cache.get(url);
      if (cached && cached.rawContent) {
        // If expectedHash is specified, verify cached content integrity
        if (expectedHash && cached.contentHash.toLowerCase() !== expectedHash.toLowerCase()) {
          this.cache.invalidate(url);
          cached = null;
        } else if (this.cache.isFresh(url)) {
          const topicCheck = options.topicValidation
            ? this.validator.validateTopicContent(cached.rawContent, options.topicValidation)
            : undefined;
          if (topicCheck && !topicCheck.isValid) {
            this.cache.invalidate(url);
            cached = null;
          } else {
          return {
            status: 'SUCCESS',
            httpStatus: cached.httpStatus,
            content: cached.rawContent,
            contentHash: cached.contentHash,
            cached: true,
            retrievedAt: cached.retrievedAt,
            sourceUrl: cached.canonicalUrl,
            finalUrl: cached.canonicalUrl,
            pageTitle: topicCheck?.pageTitle,
            topicMatched: options.topicValidation ? true : undefined,
            titleMatched: options.topicValidation ? true : undefined,
            contentMatched: options.topicValidation ? true : undefined,
            substantiveText: topicCheck?.substantiveText,
            etag: cached.etag,
            lastModified: cached.lastModified
          };
          }
        }
      }
    }

    // 3. Prepare Fetch with AbortController for strict timeout
    if (!fetchTransport) {
      return {
        status: 'NETWORK_ERROR',
        error: 'No fetch transport available in current runtime environment',
        retrievedAt,
        sourceUrl: url
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Accept': responseMode === 'DOCUMENT'
          ? 'application/pdf, text/html, application/xhtml+xml, text/plain;q=0.9, */*;q=0.1'
          : 'text/plain, application/json, text/html, */*'
      };
      if (responseMode === 'DOCUMENT') headers['x-official-source-response-mode'] = 'document';
      if (useCache && cached) {
        const condHeaders = this.cache.getConditionalHeaders(url);
        Object.assign(headers, condHeaders);
      }

      const response = await fetchTransport(url, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'manual', // Intercept redirects for security validation
        headers
      });

      clearTimeout(timeoutId);

      const transportFailure = (response as OfficialSourceResponse).__officialSourceTransportFailure;
      if (transportFailure) {
        return {
          status: transportFailure,
          error: transportFailure === 'TIMEOUT'
            ? `Official source transport timed out after ${timeoutMs}ms`
            : transportFailure === 'REDIRECT_REJECTED'
              ? 'Official source redirect was rejected by the server transport'
              : 'Official source server transport failed',
          retrievedAt,
          sourceUrl: url
        };
      }

      // Handle 304 Not Modified
      if (response.status === 304 && cached && cached.rawContent) {
        const topicCheck = options.topicValidation
          ? this.validator.validateTopicContent(cached.rawContent, options.topicValidation)
          : undefined;
        if (topicCheck && !topicCheck.isValid) {
          this.cache.invalidate(url);
          return {
            status: 'TOPIC_MISMATCH',
            httpStatus: 304,
            error: topicCheck.reason,
            retrievedAt,
            sourceUrl: cached.canonicalUrl,
            finalUrl: cached.canonicalUrl,
            pageTitle: topicCheck.pageTitle,
            topicMatched: false,
            titleMatched: false,
            contentMatched: false,
            substantiveText: topicCheck.substantiveText,
            discoveredLinks: extractExplicitAnchorLinks(cached.rawContent)
          };
        }
        this.cache.touch(url, ttlMs);
        return {
          status: 'SUCCESS',
          httpStatus: 304,
          content: cached.rawContent,
          contentHash: cached.contentHash,
          cached: true,
          retrievedAt,
          sourceUrl: cached.canonicalUrl,
          finalUrl: cached.canonicalUrl,
          pageTitle: topicCheck?.pageTitle,
          topicMatched: options.topicValidation ? true : undefined,
          titleMatched: options.topicValidation ? true : undefined,
          contentMatched: options.topicValidation ? true : undefined,
          substantiveText: topicCheck?.substantiveText,
          discoveredLinks: extractExplicitAnchorLinks(cached.rawContent),
          etag: cached.etag,
          lastModified: cached.lastModified
        };
      }

      // Handle redirect status codes (301, 302, 303, 307, 308)
      if (response.status >= 300 && response.status < 400) {
        const redirectLocation = response.headers?.get('location');
        if (!redirectLocation) {
          return {
            status: 'REDIRECT_REJECTED',
            httpStatus: response.status,
            error: 'Redirect response missing Location header',
            retrievedAt,
            sourceUrl: url
          };
        }

        let targetUrl: string;
        try {
          targetUrl = new URL(redirectLocation, url).toString();
        } catch {
          return {
            status: 'REDIRECT_REJECTED',
            httpStatus: response.status,
            error: `Invalid redirect location: '${redirectLocation}'`,
            retrievedAt,
            sourceUrl: url
          };
        }

        const redirectValidation = this.validator.validateRedirect(url, targetUrl);
        if (!redirectValidation.isValid) {
          return {
            status: 'REDIRECT_REJECTED',
            httpStatus: response.status,
            error: redirectValidation.reason,
            retrievedAt,
            sourceUrl: url
          };
        }

        // Follow authorized redirect
        const redirectCount = options.redirectCount ?? 0;
        const maxRedirects = options.maxRedirects ?? 5;
        if (redirectCount >= maxRedirects) {
          return { status: 'REDIRECT_REJECTED', httpStatus: response.status, error: `Maximum redirect limit (${maxRedirects}) exceeded`, retrievedAt, sourceUrl: url };
        }
        return await this.fetchOfficialSource(targetUrl, { ...options, useCache: false, redirectCount: redirectCount + 1 });
      }

      if (!response.ok) {
        return {
          status: 'HTTP_ERROR',
          httpStatus: response.status,
          error: `HTTP response error: ${response.status} ${response.statusText}`,
          retrievedAt,
          sourceUrl: url
        };
      }

      const responseUrl = response.url || url;
      if (responseUrl !== url) {
        const finalUrlCheck = this.validator.validateRedirect(url, responseUrl);
        if (!finalUrlCheck.isValid) {
          return {
            status: 'REDIRECT_REJECTED',
            httpStatus: response.status,
            error: finalUrlCheck.reason,
            retrievedAt,
            sourceUrl: url
          };
        }
      }

      const contentType = response.headers?.get('content-type') || undefined;
      let text: string | undefined;
      let contentBytes: Uint8Array | undefined;
      if (responseMode === 'DOCUMENT') {
        const normalizedContentType = contentType?.split(';', 1)[0]?.trim().toLowerCase();
        if (!normalizedContentType || !DOCUMENT_CONTENT_TYPES.includes(normalizedContentType)) {
          return {
            status: 'INVALID_CONTENT', httpStatus: response.status,
            error: `Official document must return HTML, plain text, or PDF; received '${contentType || 'unknown content type'}'`,
            retrievedAt, sourceUrl: responseUrl, finalUrl: responseUrl
          };
        }
        const boundedRead = await readBoundedResponseBytes(response, documentByteLimit, documentTimeoutMs, controller);
        if (boundedRead.status === 'TIMEOUT') {
          return { status: 'TIMEOUT', error: `Official document body timed out after ${documentTimeoutMs}ms`, retrievedAt, sourceUrl: responseUrl, finalUrl: responseUrl };
        }
        if (boundedRead.status === 'TOO_LARGE') {
          return {
            status: 'INVALID_CONTENT', httpStatus: response.status,
            error: `Official document exceeded the ${documentByteLimit}-byte response limit`,
            retrievedAt, sourceUrl: responseUrl, finalUrl: responseUrl
          };
        }
        if (boundedRead.status !== 'SUCCESS' || !boundedRead.bytes) {
          return { status: 'NETWORK_ERROR', httpStatus: response.status, error: 'Official document body could not be read', retrievedAt, sourceUrl: responseUrl, finalUrl: responseUrl };
        }
        contentBytes = boundedRead.bytes;
        if (contentBytes.byteLength === 0) {
          return { status: 'INVALID_CONTENT', httpStatus: response.status, error: 'Received empty response body', retrievedAt, sourceUrl: responseUrl, finalUrl: responseUrl };
        }
        if (normalizedContentType !== 'application/pdf') {
          try { text = new TextDecoder('utf-8', { fatal: true }).decode(contentBytes); }
          catch {
            return { status: 'INVALID_CONTENT', httpStatus: response.status, error: 'Official text document was not valid UTF-8', retrievedAt, sourceUrl: responseUrl, finalUrl: responseUrl };
          }
        }
      } else {
        text = await response.text();
      }
      if (responseMode === 'TEXT' && (!text || text.trim().length === 0)) {
        return {
          status: 'INVALID_CONTENT',
          httpStatus: response.status,
          error: 'Received empty response body',
          retrievedAt,
          sourceUrl: url
        };
      }

      if (options.topicValidation && text !== undefined) {
        if (!contentType || (!contentType.toLowerCase().includes('text/html') && !contentType.toLowerCase().includes('text/plain'))) {
          return {
            status: 'INVALID_CONTENT',
            httpStatus: response.status,
            error: `Topic-verified source must return HTML or plain text; received '${contentType || 'unknown content type'}'`,
            retrievedAt,
            sourceUrl: responseUrl
          };
        }
        const topicCheck = this.validator.validateTopicContent(text, options.topicValidation);
        if (!topicCheck.isValid) {
          return {
            status: 'TOPIC_MISMATCH',
            httpStatus: response.status,
            error: topicCheck.reason,
            retrievedAt,
            sourceUrl: responseUrl,
            finalUrl: responseUrl,
            pageTitle: topicCheck.pageTitle,
            topicMatched: false,
            titleMatched: false,
            contentMatched: false,
            substantiveText: topicCheck.substantiveText,
            discoveredLinks: extractExplicitAnchorLinks(text)
          };
        }
      }

      const hash = contentBytes ? computeSha256Bytes(contentBytes) : computeSha256(text || '');

      // Hash mismatch verification
      if (expectedHash && hash.toLowerCase() !== expectedHash.toLowerCase()) {
        return {
          status: 'HASH_MISMATCH',
          httpStatus: response.status,
          content: text,
          contentHash: hash,
          error: `Content hash mismatch: expected '${expectedHash}', got '${hash}'`,
          retrievedAt,
          sourceUrl: url
        };
      }

      const etag = response.headers?.get('etag') || undefined;
      const lastModified = response.headers?.get('last-modified') || undefined;
      // Store into cache
      if (useCache && responseMode === 'TEXT' && text !== undefined) {
        const defaultUrlTtl = responseUrl.includes('frankfurter') ? 3_600_000 : 86_400_000;
        const effectiveTtl = ttlMs ?? defaultUrlTtl;
        const cachedSource: CachedSource = {
          canonicalUrl: responseUrl,
          retrievedAt,
          contentHash: hash,
          rawContent: text,
          httpStatus: response.status,
          contentType,
          etag,
          lastModified,
          ttlMs: effectiveTtl
        };
        this.cache.set(cachedSource, effectiveTtl);
      }

      return {
        status: 'SUCCESS',
        httpStatus: response.status,
        content: text,
        contentBytes,
        contentType,
        contentHash: hash,
        cached: false,
        retrievedAt,
        sourceUrl: responseUrl,
        finalUrl: responseUrl,
        pageTitle: options.topicValidation && text !== undefined ? this.validator.validateTopicContent(text, options.topicValidation).pageTitle : undefined,
        topicMatched: options.topicValidation && text !== undefined ? true : undefined,
        titleMatched: options.topicValidation && text !== undefined ? true : undefined,
        contentMatched: options.topicValidation && text !== undefined ? true : undefined,
        substantiveText: options.topicValidation && text !== undefined ? this.validator.validateTopicContent(text, options.topicValidation).substantiveText : undefined,
        discoveredLinks: text !== undefined ? extractExplicitAnchorLinks(text) : [],
        etag,
        lastModified
      };
    } catch (err: any) {
      clearTimeout(timeoutId);

      if (err.name === 'AbortError' || controller.signal.aborted) {
        return {
          status: 'TIMEOUT',
          error: `Fetch timed out after ${timeoutMs}ms`,
          retrievedAt,
          sourceUrl: url
        };
      }

      // Check for CORS failure signature in browsers
      const errStr = (err.message || '').toLowerCase();
      if (errStr.includes('failed to fetch') || errStr.includes('cors') || errStr.includes('networkerror')) {
        return {
          status: 'CORS_ERROR',
          error: `Network/CORS error: ${err.message}`,
          retrievedAt,
          sourceUrl: url
        };
      }

      return {
        status: 'NETWORK_ERROR',
        error: `Network error: ${err.message || String(err)}`,
        retrievedAt,
        sourceUrl: url
      };
    }
  }

  /** Explicit bounded byte-preserving document fetch; legacy text fetching stays unchanged. */
  public async fetchOfficialDocument(
    url: string,
    options: Omit<ControlledFetchOptions, 'responseMode' | 'useCache'> = {}
  ): Promise<ControlledFetchResult> {
    return await this.fetchOfficialSource(url, {
      ...options,
      responseMode: 'DOCUMENT',
      useCache: false
    });
  }
}

/**
 * Singleton instance of ControlledWebRetriever.
 */
export const defaultControlledWebRetriever = new ControlledWebRetriever();
