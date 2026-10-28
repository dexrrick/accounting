import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

// Offline source enrichment is opt-in. It never changes the frozen questions or
// claims live retrieval; adapted visible-text captures retain their stated kind.
export async function loadStatutoryKnowledgeSources(directory) {
  if (!directory) return [];
  const root = path.resolve(directory);
  const pages = [];
  const manifests = (await readdir(root)).filter(name => /source-manifest\.json$/.test(name)).sort();
  for (const manifestName of manifests) {
    const manifest = JSON.parse(await readFile(path.join(root, manifestName), 'utf8'));
    for (const source of manifest.sources) {
      const filename = source.nativePdfFixture || source.fixture || source.file;
      const file = path.resolve(root, filename);
      if (!file.startsWith(root + path.sep)) throw new Error(`Source outside fixture directory: ${filename}`);
      const bytes = await readFile(file);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const expectedHash = source.nativePdfFixture
        ? source.nativePdfSha256 || source.sourceResponseSha256 || source.sha256
        : source.fixtureSha256 || source.sha256;
      if (!expectedHash || expectedHash !== sha256) throw new Error(`Fixture hash mismatch: ${filename}`);
      const sourceUrl = source.url || source.officialUrl;
      const title = source.pageTitle || source.title;
      const pdf = filename.endsWith('.pdf');
      const nativeHtml = /<html\b|<!doctype\s+html/i.test(bytes.toString('utf8'));
      const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      const body = pdf || nativeHtml ? bytes : Buffer.from(`<html><head><title>${escape(source.authority)} | ${escape(title)}</title></head><body><main><h1>${escape(source.authority)} | ${escape(title)}</h1><p>${escape(bytes.toString('utf8')).replaceAll('\n', '<br>')}</p></main></body></html>`);
      pages.push({ id: filename, sourceUrl, title, authority: source.authority,
        topicIds: source.topicIds || [], body, html: body, contentType: pdf ? 'application/pdf' : 'text/html',
        fixtureKind: source.fixtureKind || source.kind || manifest.captureMethod || manifest.method,
        fixtureSha256: sha256, responseSha256: createHash('sha256').update(body).digest('hex'),
        manifest: manifestName, filename });
    }
  }
  return pages;
}
