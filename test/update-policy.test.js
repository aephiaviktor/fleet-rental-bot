'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildWindowsTransactionalUpdateScript,
  buildWindowsUpdaterLauncher,
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
  assert.equal(shouldCopyUpdatePath('node_modules/example_dependency/package.json'), false);
  assert.equal(shouldCopyUpdatePath('analysis/bot-state.json'), false);
  assert.equal(shouldCopyUpdatePath('MUD-analysis'), false);
  assert.equal(shouldCopyUpdatePath('node_modules\\electron\\package.json'), false);
});

test('transactional updater waits, swaps, preserves runtime data, restarts, and rolls back', () => {
  const script = buildWindowsTransactionalUpdateScript({
    appRoot: "C:\\Apps\\fleet-rental-bot-MUD's",
    stagedRoot: 'C:\\Apps\\.stage\\release',
    parentPid: 4321,
    taskName: 'Fleet Rental Bot MUD',
    readyFile: 'C:\\Apps\\.stage\\helper-ready',
    startupReadyFile: 'C:\\Apps\\.stage\\app-started',
  });

  assert.ok(script.indexOf('Wait-Process') < script.indexOf('Move-Item -Path $appRoot'));
  assert.match(script, /Waiting for scheduled task to become Ready/);
  assert.match(script, /Get-ScheduledTask -TaskName \$taskName/);
  assert.match(script, /Timed out waiting for scheduled task/);
  assert.ok(script.indexOf('Scheduled task is Ready') < script.indexOf('Move-Item -Path $appRoot'));
  assert.match(script, /\.update-release\.json/);
  assert.match(script, /ConvertFrom-Json/);
  assert.match(script, /\$reuseDependencies/);
  assert.match(script, /\[System\.IO\.Directory\]::Delete\(\$stagedNodeModules\)/);
  assert.match(script, /Move-Item -Path \$backupNodeModules -Destination \$stagedNodeModules/);
  assert.match(script, /Move-Item -Path \$activeNodeModules -Destination \$backupNodeModules/);
  assert.match(script, /if \(Test-Path \$appRoot\) \{ & schtasks\.exe \/Run \/TN \$taskName/);
  assert.match(script, /node_modules\\electron\\dist\\electron\.exe/);
  assert.match(script, /Staged Electron executable is missing/);
  assert.match(script, /\.rollback/);
  assert.match(script, /\*-analysis/);
  assert.match(script, /Move-Item -Path \$backupRoot -Destination \$appRoot/);
  assert.match(script, /schtasks\.exe \/Run \/TN \$taskName/);
  assert.match(script, /Waiting for the updated application readiness marker/);
  assert.match(script, /AddSeconds\(180\)/);
  assert.match(script, /schtasks\.exe \/End \/TN \$taskName/);
  assert.match(script, /ExecutablePath -like/);
  assert.match(script, /\$rollbackDeadline = \(Get-Date\)\.AddSeconds\(30\)/);
  assert.match(script, /while \(Test-Path \$appRoot\)/);
  assert.ok(script.indexOf('Waiting for the updated application readiness marker') < script.indexOf('Update completed successfully'));
  assert.match(script, /Fleet Rental Bot MUD/);
  assert.match(script, /MUD''s/);
  assert.ok(script.indexOf('Set-Content -Path $readyFile') < script.indexOf('Wait-Process'));
});

test('Windows updater launcher starts PowerShell asynchronously', () => {
  const launcher = buildWindowsUpdaterLauncher({
    powershellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    scriptPath: 'C:\\Apps\\stage with spaces\\finish-update.ps1',
  });
  assert.match(launcher, /WScript\.Shell/);
  assert.match(launcher, /, 0, False\)/);
  assert.match(launcher, /-File/);
  assert.match(launcher, /stage with spaces/);
});

test('transactional updater rejects invalid process and task identity', () => {
  const valid = { appRoot: 'x', stagedRoot: 'y', parentPid: 1, taskName: 'x', readyFile: 'z', startupReadyFile: 'started' };
  assert.throws(() => buildWindowsTransactionalUpdateScript({ ...valid, parentPid: 0 }), /positive/);
  assert.throws(() => buildWindowsTransactionalUpdateScript({ ...valid, taskName: '' }), /task name/);
  assert.throws(() => buildWindowsTransactionalUpdateScript({ ...valid, readyFile: '' }), /helper readiness file/);
  assert.throws(() => buildWindowsTransactionalUpdateScript({ ...valid, startupReadyFile: '' }), /application readiness file/);
});

test('main updater stages and validates before handing activation to the external helper', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  const installAt = main.indexOf("runCommand('npm', ['install'");
  const buildAt = main.indexOf("runCommand('npm', ['run', 'build']");
  const validationAt = main.indexOf('validateReleaseTree(fs, stagedRoot');
  const helperAt = main.indexOf('await launchWindowsTransactionalUpdater');
  const exitAt = main.indexOf('app.exit(0)');

  assert.ok(installAt >= 0);
  assert.ok(installAt < buildAt);
  assert.ok(buildAt < validationAt);
  assert.ok(validationAt < helperAt);
  assert.ok(helperAt < exitAt);
  assert.doesNotMatch(main, /fs\.cp\(extractedRoot, getAppRoot\(\)/);
  assert.match(main, /canReuseInstalledDependencies/);
  assert.match(main, /fs\.symlink\(/);
  assert.match(main, /'junction'/);
  assert.match(main, /reuseDependencies/);
});
