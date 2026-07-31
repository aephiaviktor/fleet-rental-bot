'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  getProfileUserDataPath,
  parseProfileName,
  resolveProfileAnalysisDir,
  sanitizeProfileName,
} = require('../electron/profile-policy');

test('profile arguments support both profile and instance forms', () => {
  assert.equal(parseProfileName(['electron', '.', '--profile', 'MUD']), 'MUD');
  assert.equal(parseProfileName(['electron', '.', '--profile=ONI']), 'ONI');
  assert.equal(parseProfileName(['electron', '.', '--instance', 'USTUR']), 'USTUR');
  assert.equal(parseProfileName(['electron', '.']), '');
});

test('profile names cannot escape their dedicated storage directory', () => {
  assert.equal(sanitizeProfileName(' ../../MUD profile '), '..-..-MUD-profile');
  const base = path.join('/tmp', 'fleet-rental-bot');
  const userData = getProfileUserDataPath(base, '../../MUD profile');
  assert.equal(userData, path.join(base, 'profiles', '..-..-MUD-profile'));
  assert.equal(path.relative(base, userData).startsWith('..'), false);
});

test('MUD ONI and USTUR receive distinct settings and analysis roots', () => {
  const base = path.join('/tmp', 'fleet-rental-bot');
  const profiles = ['MUD', 'ONI', 'USTUR'];
  const userDataPaths = profiles.map((profile) => getProfileUserDataPath(base, profile));
  const analysisDirs = profiles.map((profile) => resolveProfileAnalysisDir(profile, 'analysis'));

  assert.equal(new Set(userDataPaths).size, 3);
  assert.equal(new Set(analysisDirs).size, 3);
  assert.deepEqual(analysisDirs, ['MUD-analysis', 'ONI-analysis', 'USTUR-analysis']);
});

test('explicit or nested analysis paths remain unchanged', () => {
  assert.equal(resolveProfileAnalysisDir('MUD', '/var/lib/fleet-analysis'), '/var/lib/fleet-analysis');
  assert.equal(resolveProfileAnalysisDir('MUD', 'data/analysis'), 'data/analysis');
});
