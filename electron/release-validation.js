'use strict';

const path = require('node:path');

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

/**
 * Returns the list of files required for a valid release tree.
 *
 * This is the source of truth for required files. The updater reads the *new*
 * release's `getRequiredFiles` (not the old updater's hardcoded list), so
 * intentionally removed files don't block updates. If the new release is an
 * old version that doesn't export `getRequiredFiles`, the old updater falls
 * back to its own hardcoded list — backward compatible.
 */
function getRequiredFiles(options = {}) {
  const electronBinary = options.platform === 'win32'
    ? 'node_modules/electron/dist/electron.exe'
    : 'node_modules/electron/dist/electron';
  return [
    'dist/bot.js',
    'electron/main.js',
    'electron/preload.js',
    'electron/renderer.html',
    'electron/secure-settings.js',
    'electron/security-policy.js',
    'electron/profile-policy.js',
    'electron/dependency-reuse-policy.js',
    electronBinary,
  ];
}

async function validateReleaseTree(fs, root, options = {}) {
  const packageJson = await readJson(fs, path.join(root, 'package.json'));
  const packageLock = await readJson(fs, path.join(root, 'package-lock.json'));
  const appVersion = String(packageJson.version || '');
  if (!appVersion || packageLock.version !== appVersion || packageLock.packages?.['']?.version !== appVersion) {
    throw new Error('Staged release package and lockfile versions do not match.');
  }

  const requiredFiles = Array.isArray(options.requiredFiles) ? options.requiredFiles : getRequiredFiles(options);
  for (const relativePath of requiredFiles) {
    const label = relativePath.includes('electron/dist/') ? 'Electron runtime' : relativePath;
    await requireFile(fs, root, relativePath, label);
  }
  return { appVersion };
}

module.exports = { validateReleaseTree, getRequiredFiles };
