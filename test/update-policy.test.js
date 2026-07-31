'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  compareVersions,
  isDedicatedProfileInstall,
  normalizeVersion,
  shouldCopyUpdatePath,
} = require('../electron/update-policy');

test('version comparison normalizes v prefixes and missing numeric segments', () => {
  assert.equal(normalizeVersion(' v0.2.27 '), '0.2.27');
  assert.equal(compareVersions('0.2.28', '0.2.27'), 1);
  assert.equal(compareVersions('0.2.27', '0.2.27.0'), 0);
  assert.equal(compareVersions('0.2.26', '0.2.27'), -1);
});

test('profile updater only accepts its dedicated app directory', () => {
  assert.equal(isDedicatedProfileInstall('fleet-rental-bot-MUD', 'MUD'), true);
  assert.equal(isDedicatedProfileInstall('fleet-rental-bot-ONI', 'MUD'), false);
  assert.equal(isDedicatedProfileInstall('fleet-rental-bot', 'MUD'), false);
  assert.equal(isDedicatedProfileInstall('fleet-rental-bot', ''), true);
});

test('update copy preserves runtime data and dependencies while accepting release files', () => {
  assert.equal(shouldCopyUpdatePath('src/bot.ts'), true);
  assert.equal(shouldCopyUpdatePath('electron/main.js'), true);
  assert.equal(shouldCopyUpdatePath('.git/config'), false);
  assert.equal(shouldCopyUpdatePath('node_modules/rpc_limiter/package.json'), false);
  assert.equal(shouldCopyUpdatePath('analysis/bot-state.json'), false);
  assert.equal(shouldCopyUpdatePath('MUD-analysis'), false);
  assert.equal(shouldCopyUpdatePath('node_modules\\electron\\package.json'), false);
});

test('current updater installs dependencies before building and exits after relaunch decision', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  const installAt = main.indexOf("runCommand('npm', ['install']");
  const buildAt = main.indexOf("runCommand('npm', ['run', 'build']");
  const validationAt = main.indexOf('validateReleaseTree(fs, extractedRoot');
  const activationAt = main.indexOf('await fs.cp(extractedRoot, getAppRoot()');
  const relaunchAt = main.indexOf('app.relaunch()');
  const exitAt = main.indexOf('app.exit(0)');

  assert.ok(installAt >= 0);
  assert.ok(installAt < buildAt);
  assert.ok(buildAt < validationAt);
  assert.ok(validationAt < activationAt);
  assert.ok(activationAt < relaunchAt);
  assert.ok(relaunchAt < exitAt);
});
