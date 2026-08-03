'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { validateReleaseTree } = require('../electron/release-validation');

async function createReleaseFixture({ includeElectron = true, includeBuild = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fleet-rental-release-'));
  const packageJson = { name: 'fleet-rental-bot', version: '0.2.31', main: 'electron/main.js' };
  const packageLock = {
    name: 'fleet-rental-bot',
    version: '0.2.31',
    packages: {
      '': { name: 'fleet-rental-bot', version: '0.2.31' },
    },
  };
  await fs.mkdir(path.join(root, 'electron'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(packageJson), 'utf8');
  await fs.writeFile(path.join(root, 'package-lock.json'), JSON.stringify(packageLock), 'utf8');
  for (const file of ['main.js', 'preload.js', 'renderer.html', 'secure-settings.js', 'security-policy.js', 'rpc-limiter-v2-policy.js', 'profile-policy.js', 'dependency-reuse-policy.js']) {
    await fs.writeFile(path.join(root, 'electron', file), '', 'utf8');
  }
  if (includeBuild) {
    await fs.mkdir(path.join(root, 'dist'), { recursive: true });
    await fs.writeFile(path.join(root, 'dist', 'bot.js'), '', 'utf8');
  }
  if (includeElectron) {
    await fs.mkdir(path.join(root, 'node_modules', 'electron', 'dist'), { recursive: true });
    await fs.writeFile(path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron'), '', 'utf8');
  }
  return root;
}

test('release validation accepts a complete staged Fleet Rental Bot release', async () => {
  const root = await createReleaseFixture();
  const result = await validateReleaseTree(fs, root, { platform: process.platform });
  assert.deepEqual(result, { appVersion: '0.2.31' });
  await fs.rm(root, { recursive: true, force: true });
});

test('release validation rejects missing build output or Electron runtime', async () => {
  const missingBuild = await createReleaseFixture({ includeBuild: false });
  await assert.rejects(validateReleaseTree(fs, missingBuild, { platform: process.platform }), /dist\/bot\.js/);
  await fs.rm(missingBuild, { recursive: true, force: true });

  const missingElectron = await createReleaseFixture({ includeElectron: false });
  await assert.rejects(validateReleaseTree(fs, missingElectron, { platform: process.platform }), /Electron runtime/);
  await fs.rm(missingElectron, { recursive: true, force: true });
});
