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
        dependencies: { electron: '^42.1.0', example_dependency: 'https://example/dependency.tar.gz' },
        devDependencies: { typescript: '^5.9.3' },
      },
      'node_modules/electron': { version: '42.1.0', resolved: 'https://registry/electron.tgz', integrity: 'electron-integrity' },
      'node_modules/example_dependency': { version: '1.0.0', resolved: 'https://example/dependency.tar.gz', integrity: 'dependency-integrity' },
      'node_modules/typescript': { version: '5.9.3', resolved: 'https://registry/typescript.tgz', integrity: 'ts-integrity' },
      ...overrides,
    },
  };
}

test('dependency reuse ignores app version and root install-script metadata', () => {
  assert.equal(canReuseInstalledDependencies(lock('0.2.32'), lock('0.2.33')), true);
});

test('dependency reuse ignores npm-added libc metadata when package identity is unchanged', () => {
  const current = lock('0.2.39', {
    'node_modules/@rollup/rollup-linux-x64-gnu': {
      version: '4.60.2',
      resolved: 'https://registry/rollup-linux-x64-gnu.tgz',
      integrity: 'rollup-integrity',
      optional: true,
      cpu: ['x64'],
      os: ['linux'],
    },
  });
  const staged = structuredClone(current);
  staged.version = '0.2.40';
  staged.packages[''].version = '0.2.40';
  staged.packages['node_modules/@rollup/rollup-linux-x64-gnu'].libc = ['glibc'];

  assert.equal(canReuseInstalledDependencies(current, staged), true);
});

test('dependency reuse rejects direct or transitive dependency changes', () => {
  const directChange = lock('0.2.34');
  directChange.packages[''].dependencies.electron = '^43.0.0';
  assert.equal(canReuseInstalledDependencies(lock('0.2.33'), directChange), false);

  const transitiveChange = lock('0.2.34', {
    'node_modules/electron': { version: '43.0.0', resolved: 'https://registry/electron-43.tgz', integrity: 'new' },
  });
  assert.equal(canReuseInstalledDependencies(lock('0.2.33'), transitiveChange), false);

  const sourceChange = lock('0.2.40');
  sourceChange.packages['node_modules/example_dependency'].resolved = 'https://example/new-dependency.tar.gz';
  assert.equal(canReuseInstalledDependencies(lock('0.2.39'), sourceChange), false);

  const integrityChange = lock('0.2.40');
  integrityChange.packages['node_modules/typescript'].integrity = 'different-integrity';
  assert.equal(canReuseInstalledDependencies(lock('0.2.39'), integrityChange), false);

  const dependencyEdgeChange = lock('0.2.40');
  dependencyEdgeChange.packages['node_modules/electron'].dependencies = { extract: '^3.0.0' };
  assert.equal(canReuseInstalledDependencies(lock('0.2.39'), dependencyEdgeChange), false);
});

test('dependency reuse rejects missing or malformed lockfiles', () => {
  assert.equal(canReuseInstalledDependencies({}, lock('0.2.34')), false);
  assert.equal(canReuseInstalledDependencies(lock('0.2.33'), { packages: [] }), false);
  assert.equal(canReuseInstalledDependencies(null, null), false);
});
