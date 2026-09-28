import { handleOfficialSourceProxyRequest, OFFICIAL_SOURCE_PROXY_PATH } from '../src/retrieval/officialSourceProxy.ts';

function middleware() {
  return async (req, res, next) => {
    try {
      const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (requestUrl.pathname !== OFFICIAL_SOURCE_PROXY_PATH) {
        next();
        return;
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
        size += bytes.byteLength;
        if (size > 8_192) {
          res.statusCode = 413;
          res.end('Request too large');
          return;
        }
        chunks.push(bytes);
      }
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const method = req.method || 'GET';
      const headers = new Headers();
      for (const name of ['content-type', 'content-length', 'origin']) {
        const value = req.headers[name];
        if (typeof value === 'string') headers.set(name, value);
      }
      const request = new Request(requestUrl, {
        method,
        headers,
        ...(method === 'GET' || method === 'HEAD' ? {} : { body: new TextDecoder().decode(body) })
      });
      const response = await handleOfficialSourceProxyRequest(request);
      res.statusCode = response.status;
      for (const [name, value] of response.headers) res.setHeader(name, value);
      res.end(new Uint8Array(await response.arrayBuffer()));
    } catch (error) {
      next(error instanceof Error ? error : new Error(String(error)));
    }
  };
}

export function officialSourceProxyPlugin() {
  return {
    name: 'official-source-same-origin-proxy',
    configureServer(server) {
      server.middlewares.use(middleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware());
    }
  };
}
