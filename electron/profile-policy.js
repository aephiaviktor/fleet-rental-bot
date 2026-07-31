'use strict';

const path = require('node:path');

function parseProfileName(argv) {
  const args = Array.isArray(argv) ? argv.slice(1) : [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] ?? '');
    if (arg === '--profile' || arg === '--instance') return String(args[index + 1] ?? '').trim();
    if (arg.startsWith('--profile=')) return arg.slice('--profile='.length).trim();
    if (arg.startsWith('--instance=')) return arg.slice('--instance='.length).trim();
  }
  return '';
}

function sanitizeProfileName(value) {
  return String(value ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getProfileUserDataPath(baseUserData, profileName) {
  const profile = sanitizeProfileName(profileName);
  return profile ? path.join(baseUserData, 'profiles', profile) : baseUserData;
}

function resolveProfileAnalysisDir(profileName, rawAnalysisDir) {
  const profile = sanitizeProfileName(profileName);
  const analysisDir = String(rawAnalysisDir || 'analysis');
  const isBareRelativeName = !path.isAbsolute(analysisDir)
    && !analysisDir.startsWith('~')
    && !/[\\/]/.test(analysisDir);
  return profile && isBareRelativeName ? `${profile}-${analysisDir}` : analysisDir;
}

module.exports = {
  getProfileUserDataPath,
  parseProfileName,
  resolveProfileAnalysisDir,
  sanitizeProfileName,
};
