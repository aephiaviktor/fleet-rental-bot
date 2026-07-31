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

function quotePowerShellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildWindowsTransactionalUpdateScript({ appRoot, stagedRoot, parentPid, taskName, readyFile, startupReadyFile }) {
  const pid = Number.parseInt(String(parentPid), 10);
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('A positive parent process id is required.');
  if (!taskName) throw new Error('A scheduled task name is required.');
  if (!readyFile) throw new Error('A helper readiness file is required.');
  if (!startupReadyFile) throw new Error('An application readiness file is required.');

  return [
    '$ErrorActionPreference = "Stop"',
    `$appRoot = ${quotePowerShellLiteral(appRoot)}`,
    `$stagedRoot = ${quotePowerShellLiteral(stagedRoot)}`,
    `$parentPid = ${pid}`,
    `$taskName = ${quotePowerShellLiteral(taskName)}`,
    `$readyFile = ${quotePowerShellLiteral(readyFile)}`,
    `$startupReadyFile = ${quotePowerShellLiteral(startupReadyFile)}`,
    '$backupRoot = $appRoot + ".rollback"',
    '$manifestPath = Join-Path $stagedRoot ".update-release.json"',
    '$stagedNodeModules = Join-Path $stagedRoot "node_modules"',
    '$backupNodeModules = Join-Path $backupRoot "node_modules"',
    '$stagedElectron = Join-Path $stagedRoot "node_modules\\electron\\dist\\electron.exe"',
    '$logDir = Join-Path $env:LOCALAPPDATA "FleetRentalBot\\logs"',
    '$logFile = Join-Path $logDir "updater.log"',
    'New-Item -ItemType Directory -Force -Path $logDir | Out-Null',
    'Set-Content -Path $readyFile -Value $PID',
    'function Write-UpdateLog([string]$message) { Add-Content -Path $logFile -Value ("{0:o} {1}" -f (Get-Date), $message) }',
    'try {',
    '  Write-UpdateLog "Waiting for Fleet Rental Bot to exit"',
    '  Wait-Process -Id $parentPid -ErrorAction SilentlyContinue',
    '  if (-not (Test-Path $manifestPath)) { throw "Staged release manifest is missing" }',
    '  $manifest = Get-Content -Raw -Path $manifestPath | ConvertFrom-Json',
    '  $reuseDependencies = [bool]$manifest.reuseDependencies',
    '  if (-not (Test-Path $stagedElectron)) { throw "Staged Electron executable is missing" }',
    '  if ($reuseDependencies) { [System.IO.Directory]::Delete($stagedNodeModules) }',
    '  if (Test-Path $backupRoot) { Remove-Item -Recurse -Force $backupRoot }',
    '  $moveDeadline = (Get-Date).AddSeconds(30)',
    '  while ($true) {',
    '    try {',
    '      Move-Item -Path $appRoot -Destination $backupRoot',
    '      break',
    '    } catch {',
    '      if ((Get-Date) -ge $moveDeadline) { throw }',
    '      Start-Sleep -Milliseconds 500',
    '    }',
    '  }',
    '  try {',
    '    if ($reuseDependencies) {',
    '      if (-not (Test-Path $backupNodeModules)) { throw "Installed dependency folder is missing from rollback release" }',
    '      Move-Item -Path $backupNodeModules -Destination $stagedNodeModules',
    '    }',
    '    Move-Item -Path $stagedRoot -Destination $appRoot',
    '    Get-ChildItem -Path $backupRoot -Directory | Where-Object { $_.Name -eq "analysis" -or $_.Name -like "*-analysis" } | ForEach-Object {',
    '      $destination = Join-Path $appRoot $_.Name',
    '      if (-not (Test-Path $destination)) { Move-Item -Path $_.FullName -Destination $destination }',
    '    }',
    '    Write-UpdateLog "Release swap completed; starting scheduled task"',
    '    & schtasks.exe /Run /TN $taskName *>> $logFile',
    '    if ($LASTEXITCODE -ne 0) { throw "Scheduled task restart failed with exit code $LASTEXITCODE" }',
    '    Write-UpdateLog "Waiting for the updated application readiness marker"',
    '    $startupDeadline = (Get-Date).AddSeconds(45)',
    '    while (-not (Test-Path $startupReadyFile)) {',
    '      if ((Get-Date) -ge $startupDeadline) { throw "Updated application did not confirm startup within 45 seconds" }',
    '      Start-Sleep -Milliseconds 500',
    '    }',
    '    Write-UpdateLog "Update completed successfully"',
    '  } catch {',
    '    Write-UpdateLog ("New release failed; rolling back: " + $_.Exception.Message)',
    '    & schtasks.exe /End /TN $taskName *>> $logFile',
    '    Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -like ($appRoot + "*") } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
    '    Start-Sleep -Milliseconds 500',
    '    if ($reuseDependencies -and -not (Test-Path $backupNodeModules)) {',
    '      $activeNodeModules = if (Test-Path (Join-Path $appRoot "node_modules")) { Join-Path $appRoot "node_modules" } else { Join-Path $stagedRoot "node_modules" }',
    '      if (Test-Path $activeNodeModules) { Move-Item -Path $activeNodeModules -Destination $backupNodeModules }',
    '    }',
    '    $rollbackDeadline = (Get-Date).AddSeconds(30)',
    '    while (Test-Path $appRoot) {',
    '      try {',
    '        Remove-Item -Recurse -Force $appRoot',
    '      } catch {',
    '        if ((Get-Date) -ge $rollbackDeadline) { throw }',
    '        Start-Sleep -Milliseconds 500',
    '      }',
    '    }',
    '    Move-Item -Path $backupRoot -Destination $appRoot',
    '    & schtasks.exe /Run /TN $taskName *>> $logFile',
    '    throw',
    '  }',
    '} catch {',
    '  Write-UpdateLog ("Update failed: " + $_.Exception.Message)',
    '  if (Test-Path $appRoot) { & schtasks.exe /Run /TN $taskName *>> $logFile }',
    '  exit 1',
    '}',
  ].join('\r\n');
}

function buildWindowsUpdaterLauncher({ powershellPath, scriptPath }) {
  const quoteVbs = (value) => String(value).replace(/"/g, '""');
  const command = `"${powershellPath}" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptPath}"`;
  return [
    'Set shell = CreateObject("WScript.Shell")',
    `exitCode = shell.Run("${quoteVbs(command)}", 0, False)`,
    'WScript.Quit exitCode',
  ].join('\r\n');
}

module.exports = {
  buildWindowsTransactionalUpdateScript,
  buildWindowsUpdaterLauncher,
  compareVersions,
  isDedicatedProfileInstall,
  normalizeVersion,
  shouldCopyUpdatePath,
};
