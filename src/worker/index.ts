import { handleOfficialSourceProxyRequest, OFFICIAL_SOURCE_PROXY_PATH } from '../retrieval/officialSourceProxy';

interface WorkerEnvironment {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, environment: WorkerEnvironment): Promise<Response> {
    const requestUrl = new URL(request.url);
    if (requestUrl.pathname === OFFICIAL_SOURCE_PROXY_PATH) {
      return handleOfficialSourceProxyRequest(request);
    }
    return environment.ASSETS.fetch(request);
  }
};
