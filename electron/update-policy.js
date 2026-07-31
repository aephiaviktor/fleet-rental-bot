'use strict';

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '');
}

function compareVersions(a, b) {
  const left = normalizeVersion(a).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = normalizeVersion(b).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if ((left[index] || 0) > (right[index] || 0)) return 1;
    if ((left[index] || 0) < (right[index] || 0)) return -1;
  }
  return 0;
}

function isDedicatedProfileInstall(appRootName, profileName) {
  const profileSlug = String(profileName || '').trim().toLowerCase();
  if (!profileSlug) return true;
  return String(appRootName || '').trim().toLowerCase() === `fleet-rental-bot-${profileSlug}`;
}

function shouldCopyUpdatePath(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  return !normalized.startsWith('.git')
    && !normalized.startsWith('node_modules')
    && !normalized.startsWith('analysis')
    && !normalized.endsWith('-analysis');
}

module.exports = {
  compareVersions,
  isDedicatedProfileInstall,
  normalizeVersion,
  shouldCopyUpdatePath,
};
