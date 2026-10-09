// Validation-only preload. Blocks ambient network; explicit in-memory mocks can replace fetch.
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';

globalThis.fetch = async () => {
  throw new Error('API_FREE_VALIDATION: ambient fetch is disabled');
};

function isLoopbackTarget(target) {
  if (target instanceof URL || typeof target === 'string') {
    try {
      return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(target).hostname);
    } catch {
      return false;
    }
  }
  const hostname = target?.hostname || target?.host;
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
}

for (const transport of [http, https]) {
  for (const operation of ['request', 'get']) {
    const original = transport[operation];
    transport[operation] = function guardedTransport(target, ...args) {
      if (!isLoopbackTarget(target)) throw new Error('API_FREE_VALIDATION: external HTTP is disabled');
      return original.call(this, target, ...args);
    };
  }
}
syncBuiltinESMExports();
