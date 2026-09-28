import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = path.join(projectRoot, 'dist', '_worker.js');
const runnerPath = fileURLToPath(import.meta.url);
const tsxCli = path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

async function runServer() {
  const worker = (await import(pathToFileURL(workerPath))).default;
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks = [];
      let length = 0;
      for await (const chunk of incoming) {
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        length += bytes.byteLength;
        if (length > 8_192) {
          outgoing.writeHead(413).end('Request too large');
          return;
        }
        chunks.push(bytes);
      }
      const requestBody = Buffer.concat(chunks);
      const url = new URL(incoming.url || '/', `http://${incoming.headers.host || '127.0.0.1'}`);
      const headers = new Headers();
      for (const name of ['content-type', 'content-length', 'origin']) {
        const value = incoming.headers[name];
        if (typeof value === 'string') headers.set(name, value);
      }
      const method = incoming.method || 'GET';
      const request = new Request(url, {
        method,
        headers,
        ...(method === 'GET' || method === 'HEAD' ? {} : { body: requestBody })
      });
      const response = await worker.fetch(request, { ASSETS: { fetch: async assetRequest => {
        if (new URL(assetRequest.url).pathname === '/') return new Response('Static asset fallback');
        return new Response('Not found', { status: 404 });
      } } });
      outgoing.statusCode = response.status;
      for (const [name, value] of response.headers) outgoing.setHeader(name, value);
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(500).end('Worker test server failed');
    }
  });
  server.listen(0, '127.0.0.1', () => {
    process.send({ port: server.address().port });
  });
}

async function startServer() {
  const child = fork(tsxCli, [runnerPath, '--serve'], {
    cwd: projectRoot,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc']
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Worker HTTP server startup timed out.')), 10_000);
    child.once('message', message => {
      clearTimeout(timer);
      resolve(message.port);
    });
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Worker HTTP server exited before ready (${code}).`));
    });
  });
  return { child, baseUrl: `http://127.0.0.1:${port}` };
}

async function runLiveValidation() {
  const query = 'If a Singapore tax resident earns employment income while physically working overseas on a temporary secondment, under what conditions is that foreign-sourced income taxable in Singapore or eligible for double taxation relief?';
  const server = await startServer();
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const previousWindow = globalThis.window;
  globalThis.window = {};
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, server.baseUrl);
    if (url.origin === server.baseUrl) return nativeFetch(url, init);
    const isExistingJinaSearchFallback = url.hostname === 'r.jina.ai' &&
      url.pathname.startsWith('/http://html.duckduckgo.com/html/');
    if (isExistingJinaSearchFallback) {
      const headers = new Headers(init?.headers);
      headers.set('origin', server.baseUrl);
      return nativeFetch(url, { ...init, headers });
    }
    throw new Error('Direct browser-to-external fetch blocked by production-path validation');
  };

  try {
    const assetResponse = await nativeFetch(`${server.baseUrl}/`);
    assert.equal(await assetResponse.text(), 'Static asset fallback', 'worker delegates non-endpoint requests to static assets');

    const { processAccountingQuery } = await import('../src/services/geminiService.ts');
    let groundedContext;
    const result = await processAccountingQuery(query, null, 'SFRS_I', undefined, undefined, [], undefined, {
      onGroundedContext: context => { groundedContext = context; }
    });
    const evidence = groundedContext?.evidenceQuality;
    assert.ok(evidence, 'IRAS evidence assessment was produced');
    assert.ok(evidence.eligibleRecords.length > 0, 'official IRAS evidence reached the existing evidence pipeline');
    assert.notEqual(evidence.status, 'INSUFFICIENT', 'exact question passed the insufficient-evidence gate');
    const officialUrls = [...new Set(evidence.eligibleRecords
      .filter(record => record.provenance === 'LIVE_EXTERNAL')
      .map(record => record.officialSourceUrl)
      .filter(Boolean))];
    assert.ok(officialUrls.length > 0, 'verified live IRAS source URLs are present');
    assert.ok(officialUrls.every(value => /^(https:\/\/)(www\.)?iras\.gov\.sg\//i.test(value)), 'only official IRAS URLs reached evidence');
    if (result.messageText.includes('The available verified evidence does not cover the full tax question.')) {
      const fallbackAttempts = groundedContext.sourceMapFallbackTrace?.attempts || [];
      const discoveryAttempts = groundedContext.sourceMapFallbackTrace?.discoveryFetchAttempts || [];
      const statusCounts = list => list.reduce((counts, item) => {
        const status = item.fetchStatus || 'UNKNOWN';
        counts[status] = (counts[status] || 0) + 1;
        return counts;
      }, {});
      console.error(JSON.stringify({
        answerStatus: evidence.status,
        eligibleLiveUrls: officialUrls,
        uncoveredTopics: evidence.uncoveredTopicIds,
        traceStages: groundedContext.sourceMapFallbackTrace?.stages?.map(({ stage, status }) => ({ stage, status })),
        candidateAttemptStatusCounts: statusCounts(fallbackAttempts),
        sitemapFetchStatusCounts: statusCounts(discoveryAttempts),
        uncoveredCandidateAttempts: fallbackAttempts.filter(attempt => evidence.uncoveredTopicIds.includes(attempt.topicId)).map(attempt => ({
          topicId: attempt.topicId,
          status: attempt.fetchStatus,
          candidatePath: attempt.candidateUrl ? new URL(attempt.candidateUrl).pathname : undefined,
          finalPath: attempt.finalUrl ? new URL(attempt.finalUrl).pathname : undefined
        })),
        answerPreview: result.messageText.slice(0, 500)
      }, null, 2));
    }
    assert.ok(!result.messageText.includes('The available verified evidence does not cover the full tax question.'),
      'response did not immediately return the insufficient evidence block');

    console.log(JSON.stringify({
      status: evidence.status,
      blocked: evidence.status === 'INSUFFICIENT',
      eligibleLiveRecords: evidence.eligibleRecords.filter(record => record.provenance === 'LIVE_EXTERNAL').length,
      officialUrls
    }, null, 2));
  } finally {
    globalThis.fetch = nativeFetch;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    server.child.kill();
  }
}

if (process.argv.includes('--serve')) await runServer();
else await runLiveValidation();
