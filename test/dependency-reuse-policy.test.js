'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { canReuseInstalledDependencies } = require('../electron/dependency-reuse-policy');

function lock(version, overrides = {}) {
  return {
    name: 'fleet-rental-bot',
    version,
    packages: {
      '': {
        name: 'fleet-rental-bot',
        version,
        hasInstallScript: version === '0.2.33',
        dependencies: { electron: '^42.1.0', rpc_limiter: 'https://example/rpc.tar.gz' },
        devDependencies: { typescript: '^5.9.3' },
      },
      'node_modules/electron': { version: '42.1.0', resolved: 'https://registry/electron.tgz', integrity: 'electron-integrity' },
      'node_modules/rpc_limiter': { version: '0.2.0', resolved: 'https://example/rpc.tar.gz', integrity: 'rpc-integrity' },
      'node_modules/typescript': { version: '5.9.3', resolved: 'https://registry/typescript.tgz', integrity: 'ts-integrity' },
      ...overrides,
    },
  };
}

test('dependency reuse ignores app version and root install-script metadata', () => {
  assert.equal(canReuseInstalledDependencies(lock('0.2.32'), lock('0.2.33')), true);
});

test('dependency reuse rejects direct or transitive dependency changes', () => {
  const directChange = lock('0.2.34');
  directChange.packages[''].dependencies.electron = '^43.0.0';
  assert.equal(canReuseInstalledDependencies(lock('0.2.33'), directChange), false);

  const transitiveChange = lock('0.2.34', {
    'node_modules/electron': { version: '43.0.0', resolved: 'https://registry/electron-43.tgz', integrity: 'new' },
  });
  assert.equal(canReuseInstalledDependencies(lock('0.2.33'), transitiveChange), false);
});

test('dependency reuse rejects missing or malformed lockfiles', () => {
  assert.equal(canReuseInstalledDependencies({}, lock('0.2.34')), false);
  assert.equal(canReuseInstalledDependencies(lock('0.2.33'), { packages: [] }), false);
  assert.equal(canReuseInstalledDependencies(null, null), false);
});
