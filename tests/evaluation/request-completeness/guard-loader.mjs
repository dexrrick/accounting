const blocked = new Set([
  'http', 'node:http', 'https', 'node:https', 'http2', 'node:http2',
  'net', 'node:net', 'tls', 'node:tls', 'dns', 'node:dns',
  'dns/promises', 'node:dns/promises', 'dgram', 'node:dgram',
  'child_process', 'node:child_process',
]);

export async function resolve(specifier, context, nextResolve) {
  if (blocked.has(specifier)) {
    throw new Error(`Blocked evaluation import: ${specifier}`);
  }
  return nextResolve(specifier, context);
}
