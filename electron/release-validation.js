'use strict';

const path = require('node:path');
const { compareVersions } = require('./update-policy');

async function readJson(fs, filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function requireFile(fs, root, relativePath, label = relativePath) {
  try {
    await fs.access(path.join(root, relativePath));
  } catch {
    throw new Error(`Staged release is missing ${label}: ${relativePath}`);
  }
}

async function validateReleaseTree(fs, root, options = {}) {
  const packageJson = await readJson(fs, path.join(root, 'package.json'));
  const packageLock = await readJson(fs, path.join(root, 'package-lock.json'));
  const appVersion = String(packageJson.version || '');
  if (!appVersion || packageLock.version !== appVersion || packageLock.packages?.['']?.version !== appVersion) {
    throw new Error('Staged release package and lockfile versions do not match.');
  }

  const rpcLimiterLockEntry = packageLock.packages?.['node_modules/rpc_limiter'] || {};
  const rpcLimiterVersion = String(rpcLimiterLockEntry.version || '');
  if (!rpcLimiterVersion || compareVersions(rpcLimiterVersion, '0.2.0') < 0) {
    throw new Error(`Staged release requires RPC Limiter >= 0.2.0; found ${rpcLimiterVersion || 'none'}.`);
  }
  const rpcLimiterResolved = String(rpcLimiterLockEntry.resolved || '');
  if (!/^https:\/\/github\.com\/aephiaviktor\/rpc-limiter\/archive\/[0-9a-f]{40}\.tar\.gz$/i.test(rpcLimiterResolved)) {
    throw new Error('Staged release requires RPC Limiter from a pinned HTTPS archive.');
  }

  for (const relativePath of [
    'dist/bot.js',
    'electron/main.js',
    'electron/preload.js',
    'electron/renderer.html',
    'electron/secure-settings.js',
    'electron/security-policy.js',
    'electron/rpc-limiter-v2-policy.js',
    'electron/profile-policy.js',
    'electron/dependency-reuse-policy.js',
  ]) {
    await requireFile(fs, root, relativePath);
  }

  const electronBinary = options.platform === 'win32'
    ? 'node_modules/electron/dist/electron.exe'
    : 'node_modules/electron/dist/electron';
  await requireFile(fs, root, electronBinary, 'Electron runtime');
  return { appVersion, rpcLimiterVersion };
}

module.exports = { validateReleaseTree };
