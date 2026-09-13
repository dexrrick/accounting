/**
 * Read-only registry auditor for Singapore Statutes Online deep links.
 *
 * It discovers the parent `ProvIds` value for each `#pr…` anchor from SSO's
 * published table of contents. Output is JSON for review before the registry
 * is changed; it never rewrites source files itself.
 */
import { readFile } from 'node:fs/promises';

const registry = await readFile(new URL('../src/standards/singaporeStatutesKnowledge.ts', import.meta.url), 'utf8');
const legacyLinks = [...registry.matchAll(/canonicalUrl:\s*'(https:\/\/sso\.agc\.gov\.sg\/(?:Act|SL)\/[^']+#(?:pr|Sc)[^']+)'/g)]
  .map((match) => match[1]);

const uniqueLinks = [...new Set(legacyLinks)];
const documentCache = new Map();

async function getDocument(url) {
  const parsed = new URL(url);
  const key = `${parsed.origin}${parsed.pathname}`;
  if (!documentCache.has(key)) {
    documentCache.set(key, fetch(key, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    }).then(async (response) => {
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response.text();
    }));
  }
  return documentCache.get(key);
}

function parentIdForAnchor(html, anchor) {
  const token = `value="${anchor}"`;
  const position = html.indexOf(token);
  if (position < 0) return undefined;
  // The table of contents places a provision below its nearest Part. Search
  // backwards only within the preceding TOC region to obtain that parent.
  const before = html.slice(0, position);
  const parents = [...before.matchAll(/value="(P\d+[A-Za-z-]*)"/g)];
  return parents.at(-1)?.[1];
}

const outcomes = await Promise.all(uniqueLinks.map(async (legacyUrl) => {
  const parsed = new URL(legacyUrl);
  const anchor = parsed.hash.slice(1);
  try {
    const html = await getDocument(legacyUrl);
    const parent = parentIdForAnchor(html, anchor);
    return {
      legacyUrl,
      verifiedUrl: parent ? `${parsed.origin}${parsed.pathname}?ProvIds=${parent}#${anchor}` : null,
      status: parent ? 'VERIFIED' : 'UNRESOLVED'
    };
  } catch (error) {
    return { legacyUrl, verifiedUrl: null, status: 'FETCH_FAILED', error: String(error) };
  }
}));

if (process.argv.includes('--summary')) {
  const unresolved = outcomes.filter((outcome) => outcome.status !== 'VERIFIED');
  console.log(JSON.stringify({ total: outcomes.length, verified: outcomes.length - unresolved.length, unresolved }, null, 2));
} else {
  console.log(JSON.stringify(outcomes, null, 2));
}
