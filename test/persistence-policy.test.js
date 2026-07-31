'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parsePersistedStateText,
  parseRecentActivityText,
  serializePersistedState,
} = require('../dist/persistence-policy');

test('persisted state round-trips rule keys and runtime values', () => {
  const entries = new Map([
    ['fleet:contract', { status: 'pending', lastTx: 'signature' }],
  ]);
  const text = serializePersistedState(entries.entries());

  assert.deepEqual(parsePersistedStateText(text), {
    'fleet:contract': { status: 'pending', lastTx: 'signature' },
  });
  assert.match(text, /\n  "fleet:contract"/);
});

test('current corrupted-state policy silently produces empty state', () => {
  assert.deepEqual(parsePersistedStateText('{not-json'), {});
  assert.deepEqual(parsePersistedStateText(''), {});
});

test('recent activity returns the newest bounded entries in reverse chronology', () => {
  const raw = [1, 2, 3, 4]
    .map((sequence) => JSON.stringify({ sequence }))
    .join('\n') + '\n';

  assert.deepEqual(parseRecentActivityText(raw, 3), [
    { sequence: 4 },
    { sequence: 3 },
    { sequence: 2 },
  ]);
});

test('current malformed activity policy drops the entire recent-activity result', () => {
  const raw = `${JSON.stringify({ sequence: 1 })}\nnot-json\n${JSON.stringify({ sequence: 2 })}\n`;
  assert.deepEqual(parseRecentActivityText(raw, 20), []);
});
