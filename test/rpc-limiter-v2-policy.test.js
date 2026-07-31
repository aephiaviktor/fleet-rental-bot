'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyProviderSettings,
  buildRpcLimiterV2Status,
  parseRpcProviderUrl,
} = require('../electron/rpc-limiter-v2-policy');

function stateFixture() {
  return {
    version: 2,
    enabled: true,
    providers: {
      main: { rpcBaseUrl: 'https://old-main.example', apiKey: 'old-main', failures: 2, cooldownUntilMs: 123 },
      fallback: { rpcBaseUrl: 'https://old-fallback.example', apiKey: 'old-fallback', failures: 1, cooldownUntilMs: null },
    },
    providersRoundRobinCounter: 9,
    buckets: { 'rpc:shared': { nextSlotMs: 10, intervalMs: 100 } },
    limits: { maxExclusiveMs: 30_000, minNormalMsBetweenExclusives: 5_000, cooldownMs: 60_000, failureThreshold: 3 },
    exclusive: null,
    lastExclusiveEndedAtMs: null,
    revision: 4,
  };
}

test('provider URL parsing removes only the api-key query parameter', () => {
  assert.deepEqual(parseRpcProviderUrl('https://rpc.example/path?cluster=mainnet&api-key=secret'), {
    rpcBaseUrl: 'https://rpc.example/path?cluster=mainnet',
    apiKey: 'secret',
  });
});

test('sending Fleet settings configures both v2 providers without disturbing limiter coordination state', () => {
  const state = stateFixture();
  applyProviderSettings(state, {
    RPC_URL: 'https://main.example/?api-key=main-key',
    RPC_URL_FALLBACK: 'https://fallback.example/?api-key=fallback-key',
  });

  assert.deepEqual(state.providers.main, {
    rpcBaseUrl: 'https://main.example',
    apiKey: 'main-key',
    failures: 0,
    cooldownUntilMs: null,
  });
  assert.deepEqual(state.providers.fallback, {
    rpcBaseUrl: 'https://fallback.example',
    apiKey: 'fallback-key',
    failures: 0,
    cooldownUntilMs: null,
  });
  assert.equal(state.providersRoundRobinCounter, 9);
  assert.deepEqual(state.buckets, { 'rpc:shared': { nextSlotMs: 10, intervalMs: 100 } });
  assert.equal(state.revision, 4);
});

test('status exposes per-provider health and prefers fallback for Fleet direct RPC', () => {
  const state = stateFixture();
  state.providers.main.cooldownUntilMs = 20_000;
  state.providers.fallback.cooldownUntilMs = null;

  const status = buildRpcLimiterV2Status(state, '/tmp/state.json', 10_000);

  assert.equal(status.version, 2);
  assert.equal(status.providers.main.inCooldown, true);
  assert.equal(status.providers.fallback.inCooldown, false);
  assert.equal(status.currentRpcUrl, 'https://old-fallback.example/?api-key=old-fallback');
  assert.equal(status.routingMode, 'round-robin');
});

test('live fleet aggressive exclusive reports main-preferred routing', () => {
  const state = stateFixture();
  state.exclusive = {
    ownerId: 'other',
    label: 'fleet:aggressive',
    acquiredAtMs: 9_000,
    untilMs: 20_000,
    priorityHint: 0,
  };

  const status = buildRpcLimiterV2Status(state, '/tmp/state.json', 10_000);
  assert.equal(status.routingMode, 'main-preferred');
  assert.equal(status.exclusive.label, 'fleet:aggressive');
});
