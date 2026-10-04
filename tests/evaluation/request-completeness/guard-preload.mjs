import Module, { register, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import dgram from 'node:dgram';
import childProcess from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const blocked = new Set([
  'http', 'node:http', 'https', 'node:https', 'http2', 'node:http2',
  'net', 'node:net', 'tls', 'node:tls', 'dns', 'node:dns',
  'dns/promises', 'node:dns/promises', 'dgram', 'node:dgram',
  'child_process', 'node:child_process',
]);
const guardStats = { blockedAttempts: 0, actualRequests: 0, guardSelfTests: 0 };
globalThis.__requestCompletenessGuardStats = guardStats;

function deny(name) {
  return function blockedTransport() {
    guardStats.blockedAttempts += 1;
    throw new Error(`Blocked evaluation transport: ${name}`);
  };
}

function patch(object, name, label = name) {
  if (object && typeof object[name] === 'function') object[name] = deny(label);
}

for (const api of [http, https]) {
  patch(api, 'request');
  patch(api, 'get');
  patch(api.Server?.prototype, 'listen', `${api === http ? 'http' : 'https'}.Server.listen`);
}
patch(http2, 'connect');
patch(http2, 'createServer');
patch(http2, 'createSecureServer');
patch(http2.Http2Server?.prototype, 'listen', 'http2.Server.listen');
patch(net, 'connect');
patch(net, 'createConnection');
patch(net.Socket?.prototype, 'connect', 'net.Socket.connect');
patch(net.Server?.prototype, 'listen', 'net.Server.listen');
patch(tls, 'connect');
patch(tls.TLSSocket?.prototype, 'connect', 'tls.TLSSocket.connect');
function patchDnsQueries(target, label) {
  if (!target) return;
  for (const name of Object.getOwnPropertyNames(target)) {
    if (/^(?:lookup.*|resolve.*|reverse)$/.test(name)) {
      patch(target, name, `${label}.${name}`);
    }
  }
}
patchDnsQueries(dns, 'dns');
patchDnsQueries(dnsPromises, 'dns.promises');
patchDnsQueries(dns.Resolver?.prototype, 'dns.Resolver');
patchDnsQueries(dnsPromises.Resolver?.prototype, 'dns.promises.Resolver');
patch(dgram, 'createSocket');
for (const name of ['bind', 'send', 'connect']) patch(dgram.Socket?.prototype, name, `dgram.Socket.${name}`);
for (const name of ['spawn', 'exec', 'execFile', 'fork', 'spawnSync', 'execSync', 'execFileSync']) {
  patch(childProcess, name, `child_process.${name}`);
}
patch(childProcess.ChildProcess?.prototype, 'spawn', 'child_process.ChildProcess.spawn');

globalThis.fetch = deny('fetch');
for (const name of ['WebSocket', 'EventSource', 'XMLHttpRequest']) {
  if (typeof globalThis[name] === 'function') globalThis[name] = deny(name);
}

// Block every public import path, even if the caller loaded a builtin earlier.
const originalLoad = Module._load;
Module._load = function guardedLoad(specifier, parent, isMain) {
  if (blocked.has(specifier)) {
    guardStats.blockedAttempts += 1;
    throw new Error(`Blocked evaluation dependency: ${specifier}`);
  }
  return originalLoad.call(this, specifier, parent, isMain);
};
if (typeof process.getBuiltinModule === 'function') {
  const originalGetBuiltinModule = process.getBuiltinModule.bind(process);
  process.getBuiltinModule = (specifier) => {
    if (blocked.has(specifier) || blocked.has(`node:${specifier}`)) {
      guardStats.blockedAttempts += 1;
      throw new Error(`Blocked evaluation builtin: ${specifier}`);
    }
    return originalGetBuiltinModule(specifier);
  };
}
syncBuiltinESMExports();
globalThis.__requestCompletenessGuardedTransports = Object.freeze({
  http, https, http2, net, tls, dns, dnsPromises, dgram, childProcess,
});
register(pathToFileURL(resolve(here, 'guard-loader.mjs')).href, import.meta.url);
