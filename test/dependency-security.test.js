'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const lockfile = require('../package-lock.json');

function versionAt(packagePath) {
  return lockfile.packages?.[packagePath]?.version || '';
}

function compareVersions(left, right) {
  const a = String(left).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const b = String(right).split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  }
  return 0;
}

function assertAtLeast(packagePath, minimum) {
  const actual = versionAt(packagePath);
  assert.ok(actual, `${packagePath} must exist in package-lock.json`);
  assert.ok(compareVersions(actual, minimum) >= 0, `${packagePath} ${actual} must be at least ${minimum}`);
}

test('lockfile excludes patched Undici and WebSocket vulnerability ranges', () => {
  assertAtLeast('node_modules/undici', '7.28.0');
  assertAtLeast('node_modules/ws', '7.5.11');
  assertAtLeast('node_modules/rpc-websockets/node_modules/ws', '8.21.0');
});

test('upstream-blocked dependency advisories remain explicitly documented', () => {
  const document = fs.readFileSync(path.join(root, 'docs', 'dependency-security.md'), 'utf8');
  for (const advisory of [
    'GHSA-3gc7-fjrx-p6mg',
    'GHSA-378v-28hj-76wf',
    'GHSA-w5hq-g745-h8pq',
  ]) {
    assert.match(document, new RegExp(advisory));
  }
  assert.match(document, /npm audit fix --force/i);
});
