'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createFailoverConnection, resolveRpcEndpoints } = require('../dist/bot');

function createHarness({ mainUrl = 'https://main.example', fallbackUrl = 'https://fallback.example', mainResult = 'main', mainError = null, fallbackResult = 'fallback', fallbackError = null } = {}) {
  const calls = [];
  const warnings = [];
  const connections = {
    'https://main.example': {
      label: 'main-property',
      async getBalance(value) {
        calls.push(['main', 'getBalance', value]);
        if (mainError) throw mainError;
        return mainResult;
      },
      async sendRawTransaction(value) {
        calls.push(['main', 'sendRawTransaction', value]);
        if (mainError) throw mainError;
        return mainResult;
      },
      async onAccountChange() {
        calls.push(['main', 'onAccountChange']);
        if (mainError) throw mainError;
        return 11;
      },
      async removeAccountChangeListener(id) {
        calls.push(['main', 'removeAccountChangeListener', id]);
      },
    },
    'https://fallback.example': {
      label: 'fallback-property',
      async getBalance(value) {
        calls.push(['fallback', 'getBalance', value]);
        if (fallbackError) throw fallbackError;
        return fallbackResult;
      },
      async sendRawTransaction(value) {
        calls.push(['fallback', 'sendRawTransaction', value]);
        if (fallbackError) throw fallbackError;
        return fallbackResult;
      },
      async onAccountChange() {
        calls.push(['fallback', 'onAccountChange']);
        return 22;
      },
      async removeAccountChangeListener(id) {
        calls.push(['fallback', 'removeAccountChangeListener', id]);
      },
    },
  };
  const logger = {
    info() {},
    warn(...args) { warnings.push(args); },
    error() {},
  };
  const connection = createFailoverConnection(
    mainUrl,
    fallbackUrl,
    logger,
    'MUD',
    undefined,
    { createConnection(url) { return connections[url]; } },
  );
  return { calls, connection, warnings };
}

test('RPC slots resolve both, main-only, fallback-only, and reject neither', () => {
  assert.deepEqual(resolveRpcEndpoints(' main ', ' fallback '), { primaryUrl: 'main', fallbackUrl: 'fallback', primaryRole: 'main' });
  assert.deepEqual(resolveRpcEndpoints('main', ''), { primaryUrl: 'main', primaryRole: 'main' });
  assert.deepEqual(resolveRpcEndpoints('', 'fallback'), { primaryUrl: 'fallback', primaryRole: 'fallback' });
  assert.deepEqual(resolveRpcEndpoints('same', 'same'), { primaryUrl: 'same', primaryRole: 'main' });
  assert.throws(() => resolveRpcEndpoints('', ''), /at least one/);
});

test('reads use main first and do not round-robin', async () => {
  const { calls, connection } = createHarness();

  assert.equal(await connection.getBalance('wallet-1'), 'main');
  assert.equal(await connection.getBalance('wallet-2'), 'main');
  assert.deepEqual(calls, [
    ['main', 'getBalance', 'wallet-1'],
    ['main', 'getBalance', 'wallet-2'],
  ]);
});

test('fallback-only configuration uses fallback as the sole active RPC', async () => {
  const { calls, connection } = createHarness({ mainUrl: '', fallbackUrl: 'https://fallback.example' });

  assert.equal(connection.label, 'fallback-property');
  assert.equal(await connection.getBalance('wallet'), 'fallback');
  assert.deepEqual(calls, [['fallback', 'getBalance', 'wallet']]);
});

test('read failure falls back once and warns', async () => {
  const failure = Object.assign(new Error('429 rate limited'), { status: 429 });
  const { calls, connection, warnings } = createHarness({ mainError: failure });

  assert.equal(await connection.getBalance('wallet'), 'fallback');
  assert.deepEqual(calls, [
    ['main', 'getBalance', 'wallet'],
    ['fallback', 'getBalance', 'wallet'],
  ]);
  assert.equal(warnings.length, 1);
});

test('transaction submission is never retried through fallback', async () => {
  const failure = Object.assign(new Error('submission outcome unknown'), { status: 429 });
  const { calls, connection, warnings } = createHarness({ mainError: failure });

  await assert.rejects(connection.sendRawTransaction('serialized'), failure);
  assert.deepEqual(calls, [['main', 'sendRawTransaction', 'serialized']]);
  assert.equal(warnings.length, 0);
});

test('fallback failure is returned after a safe read retries both providers', async () => {
  const mainFailure = new Error('main unavailable');
  const fallbackFailure = new Error('fallback unavailable');
  const { calls, connection } = createHarness({ mainError: mainFailure, fallbackError: fallbackFailure });

  await assert.rejects(connection.getBalance('wallet'), fallbackFailure);
  assert.deepEqual(calls, [
    ['main', 'getBalance', 'wallet'],
    ['fallback', 'getBalance', 'wallet'],
  ]);
});

test('fallback-owned account subscriptions are removed from the same connection', async () => {
  const { calls, connection } = createHarness({ mainError: new Error('main websocket unavailable') });

  const id = await connection.onAccountChange('account', () => undefined);
  assert.equal(id, 22);
  await connection.removeAccountChangeListener(id);
  assert.deepEqual(calls, [
    ['main', 'onAccountChange'],
    ['fallback', 'onAccountChange'],
    ['fallback', 'removeAccountChangeListener', 22],
  ]);
});
