'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createFailoverConnection } = require('../dist/bot');

function createHarness({ primaryResult = 'primary', primaryError = null, fallbackResult = 'fallback' } = {}) {
  const calls = [];
  const waits = [];
  const warnings = [];
  const outcomes = [];
  const connections = {
    'https://primary.example': {
      label: 'primary-property',
      async getBalance(value) {
        calls.push(['primary', 'getBalance', value]);
        if (primaryError) throw primaryError;
        return primaryResult;
      },
      async sendRawTransaction(value) {
        calls.push(['primary', 'sendRawTransaction', value]);
        if (primaryError) throw primaryError;
        return primaryResult;
      },
    },
    'https://fallback.example': {
      async getBalance(value) {
        calls.push(['fallback', 'getBalance', value]);
        return fallbackResult;
      },
      async sendRawTransaction(value) {
        calls.push(['fallback', 'sendRawTransaction', value]);
        return fallbackResult;
      },
    },
  };
  const logger = {
    info() {},
    warn(...args) { warnings.push(args); },
    error() {},
  };
  const connection = createFailoverConnection(
    'https://primary.example',
    'https://fallback.example',
    logger,
    () => true,
    'MUD',
    undefined,
    {
      createConnection(url) { return connections[url]; },
      limiter: {
        async wait(label, bucket, method) { waits.push([label, bucket, method]); },
        async recordProviderOutcome(provider, outcome) { outcomes.push([provider, outcome]); },
      },
    },
  );
  return { calls, connection, outcomes, waits, warnings };
}

test('read RPC methods use rpc:shared, return primary, and report provider success', async () => {
  const { calls, connection, outcomes, waits } = createHarness();

  assert.equal(await connection.getBalance('wallet'), 'primary');
  assert.deepEqual(calls, [['primary', 'getBalance', 'wallet']]);
  assert.deepEqual(waits, [['Connection.getBalance()', 'rpc:shared', 'getBalance']]);
  assert.deepEqual(outcomes, [['main', 'ok']]);
});

test('sendRawTransaction uses tx:shared and reports primary success', async () => {
  const { connection, outcomes, waits } = createHarness();

  assert.equal(await connection.sendRawTransaction('serialized'), 'primary');
  assert.deepEqual(waits, [['Connection.sendRawTransaction()', 'tx:shared', 'sendRawTransaction']]);
  assert.deepEqual(outcomes, [['main', 'ok']]);
});

test('ambiguous transaction submission errors are reported but never retried through fallback', async () => {
  const failure = Object.assign(new Error('429 rate limited after submission'), { status: 429 });
  const { calls, connection, outcomes, waits, warnings } = createHarness({ primaryError: failure });

  await assert.rejects(connection.sendRawTransaction('serialized'), failure);
  assert.deepEqual(calls, [['primary', 'sendRawTransaction', 'serialized']]);
  assert.deepEqual(waits, [['Connection.sendRawTransaction()', 'tx:shared', 'sendRawTransaction']]);
  assert.deepEqual(outcomes, [['main', 'rate_limited']]);
  assert.equal(warnings.length, 0);
});

test('read failover reports provider outcomes and retries through the same limiter bucket', async () => {
  const failure = new Error('primary unavailable');
  const { calls, connection, outcomes, waits, warnings } = createHarness({ primaryError: failure });

  assert.equal(await connection.getBalance('wallet'), 'fallback');
  assert.deepEqual(calls, [
    ['primary', 'getBalance', 'wallet'],
    ['fallback', 'getBalance', 'wallet'],
  ]);
  assert.deepEqual(waits, [
    ['Connection.getBalance()', 'rpc:shared', 'getBalance'],
    ['fallback Connection.getBalance()', 'rpc:shared', 'getBalance'],
  ]);
  assert.deepEqual(outcomes, [
    ['main', 'error'],
    ['fallback', 'ok'],
  ]);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][1], failure);
});

test('non-function properties come from the primary connection', () => {
  const { connection } = createHarness();
  assert.equal(connection.label, 'primary-property');
});
