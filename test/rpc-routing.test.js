'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createFailoverConnection } = require('../dist/bot');

function createHarness({ primaryResult = 'primary', primaryError = null, fallbackResult = 'fallback' } = {}) {
  const calls = [];
  const waits = [];
  const warnings = [];
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
      },
    },
  );
  return { calls, connection, waits, warnings };
}

test('read RPC methods use rpc:shared and return the primary result', async () => {
  const { calls, connection, waits } = createHarness();

  assert.equal(await connection.getBalance('wallet'), 'primary');
  assert.deepEqual(calls, [['primary', 'getBalance', 'wallet']]);
  assert.deepEqual(waits, [['Connection.getBalance()', 'rpc:shared', 'getBalance']]);
});

test('sendRawTransaction uses tx:shared', async () => {
  const { connection, waits } = createHarness();

  assert.equal(await connection.sendRawTransaction('serialized'), 'primary');
  assert.deepEqual(waits, [['Connection.sendRawTransaction()', 'tx:shared', 'sendRawTransaction']]);
});

test('current failover retries any primary error through the same limiter bucket', async () => {
  const failure = new Error('primary unavailable');
  const { calls, connection, waits, warnings } = createHarness({ primaryError: failure });

  assert.equal(await connection.getBalance('wallet'), 'fallback');
  assert.deepEqual(calls, [
    ['primary', 'getBalance', 'wallet'],
    ['fallback', 'getBalance', 'wallet'],
  ]);
  assert.deepEqual(waits, [
    ['Connection.getBalance()', 'rpc:shared', 'getBalance'],
    ['fallback Connection.getBalance()', 'rpc:shared', 'getBalance'],
  ]);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][1], failure);
});

test('non-function properties come from the primary connection', () => {
  const { connection } = createHarness();
  assert.equal(connection.label, 'primary-property');
});
