const { app, BrowserWindow, ipcMain, Menu, dialog, powerSaveBlocker, safeStorage, session } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs/promises');
const fsSync = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Connection, PublicKey } = require('@solana/web3.js');
const lockfile = require('proper-lockfile');
const packageJson = require('../package.json');
const { resolvePaths } = require('rpc_limiter');
const { readState: readRpcLimiterState, writeStateSync: writeRpcLimiterStateSync, bumpRevision: bumpRpcLimiterRevision } = require('rpc_limiter/dist/state');
const {
  buildWindowsTransactionalUpdateScript,
  buildWindowsUpdaterLauncher,
  compareVersions,
  isDedicatedProfileInstall: matchesDedicatedProfileInstall,
  normalizeVersion,
} = require('./update-policy');
const {
  REDACTED_VALUE,
  encryptSensitiveSettings,
  mergeSensitiveInput,
  migrateSettingsFile,
  redactSensitiveSettings,
  writeJsonAtomic,
} = require('./secure-settings');
const {
  assertRuleResolvePayload,
  assertSettingsPayload,
  assertTrustedIpcSender,
  assertWalletLookupPayload,
  assertWalletSecretPayload,
} = require('./security-policy');
const {
  applyProviderSettings,
  buildRpcLimiterV2Status,
} = require('./rpc-limiter-v2-policy');
const { validateReleaseTree } = require('./release-validation');
const { canReuseInstalledDependencies } = require('./dependency-reuse-policy');
const {
  getProfileUserDataPath,
  parseProfileName,
  sanitizeProfileName,
} = require('./profile-policy');

// ---------------------------------------------------------------------------
// Profile isolation — one codebase can run multiple local profiles.
// Launch with --profile <name>. The profile name is only a
// local label and is not hardcoded as a faction.
//
// Before app.whenReady() we:
//   1. Read --profile from process.argv
//   2. Set app.setPath('userData') to ~/.config/fleet-rental-bot/profiles/<name>
//   3. Set app.setName() so taskbar/dock entries are distinct per profile
// ---------------------------------------------------------------------------
const BASE_USER_DATA = path.join(process.env.HOME || process.env.USERPROFILE, '.config', 'fleet-rental-bot');
const DEFAULT_SETTINGS_PATH = path.join(BASE_USER_DATA, 'settings.json');
const _profileName = sanitizeProfileName(parseProfileName(process.argv));
const _instanceName = _profileName;
console.error('[FleetRentalBot] profile from argv =', JSON.stringify(_profileName));
console.error('[FleetRentalBot] HOME =', JSON.stringify(process.env.HOME));
if (_profileName) {
  app.setPath('userData', getProfileUserDataPath(BASE_USER_DATA, _profileName));
  app.setName(`Fleet Rental Bot - ${_profileName}`);
  if (typeof app.setDesktopName === 'function') {
    app.setDesktopName(`fleet-rental-bot-${_profileName}.desktop`);
  }
  // On Windows, the taskbar / Start-menu icon is driven by the AppUserModelID,
  // not the BrowserWindow icon option. Without a per-profile AUMID, Windows
  // groups every Fleet Rental Bot instance under the generic Electron identity
  // and the taskbar shows the default Electron icon regardless of what we pass
  // to BrowserWindow. AUMID must be unique per profile so each instance gets
  // its own taskbar entry and uses the per-profile .ico from assets/.
  if (process.platform === 'win32') {
    const appUserModelId = _profileName
      ? `com.aephia.fleet-rental-bot-${_profileName}`
      : 'com.aephia.fleet-rental-bot';
    app.setAppUserModelId(appUserModelId);
  }
}

// TITLE_SUFFIX must be set synchronously so it is available to createWindow().
const TITLE_SUFFIX = _profileName ? ` - ${_profileName}` : '';
const WINDOW_TITLE = `Fleet Rental Bot${TITLE_SUFFIX}`;
const APP_DISPLAY_NAME = WINDOW_TITLE;
const RPC_LIMITER_UPDATED_BY = WINDOW_TITLE;

function getProfileKey(profileName) {
  const normalizedProfile = String(profileName || '').toUpperCase();
  if (normalizedProfile.includes('MUD')) return 'mud';
  if (normalizedProfile.includes('ONI')) return 'oni';
  if (normalizedProfile.includes('USTUR') || normalizedProfile.includes('UST')) return 'ustur';
  return '';
}

function getWindowIconPath(profileName) {
  const profileKey = getProfileKey(profileName);
  // On Windows the taskbar / window icon must be an .ico for proper
  // display. A .png is accepted by Electron's BrowserWindow icon option
  // but Windows falls back to the default app icon when it can't read a
  // proper .ico resource from the path.
  const ext = process.platform === 'win32' ? '.ico' : '.png';
  if (profileKey) {
    return path.join(__dirname, '..', 'assets', `fleet-rental-bot-${profileKey}${ext}`);
  }
  return path.join(__dirname, '..', 'assets', `fleet-rental-bot-avatar${ext}`);
}

function isDedicatedProfileInstall() {
  return matchesDedicatedProfileInstall(path.basename(getAppRoot()), _profileName);
}

const WINDOW_ICON = getWindowIconPath(_profileName);
console.error('[FleetRentalBot] TITLE_SUFFIX =', JSON.stringify(TITLE_SUFFIX));

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
// Do not disable the software rasterizer in WSLg. Electron may need SwiftShader
// when hardware/GPU processes are unavailable; disabling it causes startup
// crashes such as "GPU process isn't usable. Goodbye."

// Disable Chromium background throttling. Fleet Rental Bot is a 24/7
// automation process and must remain responsive even when its window
// is covered, minimized, or otherwise inactive on Windows.
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

const {
  FleetRentalBot,
  buildBotConfig,
  getEditableConfigFromEnv,
  getHotWalletAddressFromSecret,
  resolveRentalRuleDetails,
  EDITABLE_CONFIG_KEYS,
} = require('../dist/bot');

let mainWindow = null;
let bot = null;
let botRunning = false;

function emitUpdateProgress(phase, message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-progress', { phase, message });
  }
}

const AEPHIA_TOKEN_VALIDATE_URL = 'https://api.aephia.com/token/validate';
const GITHUB_REPO = 'aephiaviktor/fleet-rental-bot';
const GITHUB_MAIN_PACKAGE_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/package.json`;
const GITHUB_MAIN_ARCHIVE_URL = `https://github.com/${GITHUB_REPO}/archive/refs/heads/main.tar.gz`;

function getAppRoot() {
  return path.resolve(__dirname, '..');
}

function serializeCrashValue(value) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      code: value.code,
    };
  }
  if (value && typeof value === 'object') {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return String(value);
    }
  }
  return value;
}

function logCrashEvent(type, details = {}) {
  const logPath = path.join(getAppRoot(), 'analysis', 'crash-events.jsonl');
  const event = {
    timestamp: new Date().toISOString(),
    app: APP_DISPLAY_NAME,
    profile: _profileName || null,
    pid: process.pid,
    ppid: process.ppid,
    platform: process.platform,
    versions: {
      app: packageJson.version || 'unknown',
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
    type,
    details: serializeCrashValue(details),
  };
  try {
    fsSync.mkdirSync(path.dirname(logPath), { recursive: true });
    fsSync.appendFileSync(logPath, `${JSON.stringify(event)}\n`, 'utf8');
  } catch (err) {
    console.error('[FleetRentalBot] failed to write crash event:', err);
  }
  console.error('[FleetRentalBot] crash event:', JSON.stringify({ type, details: event.details }));
}

function attachWindowCrashLogging(win) {
  if (!win || !win.webContents) return;
  win.webContents.on('render-process-gone', (_event, details) => {
    logCrashEvent('window-render-process-gone', {
      title: win.getTitle(),
      url: win.webContents.getURL(),
      details,
    });
  });
  win.webContents.on('unresponsive', () => {
    logCrashEvent('window-unresponsive', {
      title: win.getTitle(),
      url: win.webContents.getURL(),
    });
  });
}

function installCrashEventLogging() {
  process.on('uncaughtExceptionMonitor', (error) => {
    logCrashEvent('uncaughtExceptionMonitor', error);
  });
  process.on('unhandledRejection', (reason) => {
    logCrashEvent('unhandledRejection', reason);
  });
  process.on('exit', (code) => {
    logCrashEvent('process-exit', { code });
  });
  app.on('render-process-gone', (_event, webContents, details) => {
    logCrashEvent('app-render-process-gone', {
      id: webContents?.id,
      url: typeof webContents?.getURL === 'function' ? webContents.getURL() : '',
      details,
    });
  });
  app.on('child-process-gone', (_event, details) => {
    logCrashEvent('child-process-gone', details);
  });
  app.on('gpu-process-crashed', (_event, killed) => {
    logCrashEvent('gpu-process-crashed', { killed });
  });
}

async function readPackageVersion() {
  const raw = await fs.readFile(path.join(getAppRoot(), 'package.json'), 'utf8');
  return JSON.parse(raw).version;
}

async function fetchGithubJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'fleet-rental-bot-updater',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub request failed: HTTP ${response.status}`);
  }
  return await response.json();
}

async function getLatestGithubVersion() {
  const remotePackage = await fetchGithubJson(GITHUB_MAIN_PACKAGE_URL);
  const version = normalizeVersion(remotePackage?.version);
  if (!version) {
    throw new Error('No package version found on GitHub main.');
  }

  return {
    version,
    branch: 'main',
    url: `https://github.com/${GITHUB_REPO}/tree/main`,
    tarballUrl: GITHUB_MAIN_ARCHIVE_URL,
  };
}

async function checkForUpdates() {
  const currentVersion = await readPackageVersion();
  const latest = await getLatestGithubVersion();
  return {
    currentVersion,
    latestVersion: latest.version,
    latestBranch: latest.branch,
    updateAvailable: compareVersions(latest.version, currentVersion) > 0,
    releaseUrl: latest.url,
  };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || getAppRoot(),
      shell: process.platform === 'win32',
      windowsHide: true,
    });

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}: ${output.slice(-2000)}`));
      }
    });
  });
}

async function downloadFile(url, targetPath) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'fleet-rental-bot-updater' },
  });
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(targetPath, buffer);
}

async function sha256File(filePath) {
  const contents = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(contents).digest('hex');
}

async function launchWindowsTransactionalUpdater({ appRoot, stagedRoot, tempDir }) {
  const scriptPath = path.join(tempDir, 'finish-update.ps1');
  const launcherPath = path.join(tempDir, 'finish-update.vbs');
  const readyFile = path.join(tempDir, 'helper-ready');
  const startupReadyFile = path.join(tempDir, 'app-started');
  const script = buildWindowsTransactionalUpdateScript({
    appRoot,
    stagedRoot,
    parentPid: process.pid,
    taskName: `Fleet Rental Bot ${_profileName}`,
    readyFile,
    startupReadyFile,
  });
  await fs.writeFile(scriptPath, script, 'utf8');
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const powershellPath = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  await fs.writeFile(launcherPath, buildWindowsUpdaterLauncher({ powershellPath, scriptPath }), 'utf8');
  const wscriptPath = path.join(systemRoot, 'System32', 'wscript.exe');
  const child = spawn(wscriptPath, [launcherPath], {
    cwd: tempDir,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      await fs.access(readyFile);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error('Windows update helper did not confirm startup; the current version is still running.');
}

async function confirmTransactionalUpdateStartup() {
  const appRoot = getAppRoot();
  const readinessPath = path.join(appRoot, '.update-readiness.json');
  try {
    const readiness = JSON.parse(await fs.readFile(readinessPath, 'utf8'));
    const readyFile = path.resolve(String(readiness?.readyFile || ''));
    const readyDir = path.dirname(readyFile);
    const expectedParent = path.dirname(appRoot);
    if (!path.isAbsolute(readyFile)
      || path.dirname(readyDir) !== expectedParent
      || !path.basename(readyDir).startsWith('.fleet-rental-bot-update-')) {
      throw new Error('Update readiness marker path is invalid.');
    }
    await fs.writeFile(readyFile, JSON.stringify({
      version: packageJson.version || 'unknown',
      profile: _profileName,
      pid: process.pid,
      readyAt: new Date().toISOString(),
    }), 'utf8');
    await fs.rm(readinessPath, { force: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') console.error('[FleetRentalBot] Failed to confirm update startup:', error);
  }
}

async function downloadUpdateAndRestart() {
  if (!isDedicatedProfileInstall()) {
    throw new Error(
      `This ${APP_DISPLAY_NAME} instance is running from the shared app folder. ` +
        `Launch it from a dedicated folder named fleet-rental-bot-${_profileName} before updating.`
    );
  }

  const latest = await getLatestGithubVersion();
  const currentVersion = await readPackageVersion();
  if (compareVersions(latest.version, currentVersion) <= 0) {
    return { updated: false, currentVersion, latestVersion: latest.version };
  }
  if (process.platform !== 'win32') {
    throw new Error('Transactional in-app updates are supported only on Windows.');
  }
  if (!_profileName) {
    throw new Error('Transactional updates require a named Fleet Rental Bot profile.');
  }

  const appRoot = getAppRoot();
  const tempDir = await fs.mkdtemp(path.join(path.dirname(appRoot), '.fleet-rental-bot-update-'));
  const archivePath = path.join(tempDir, `${latest.branch || 'main'}.tar.gz`);
  emitUpdateProgress('downloading', `Downloading Fleet Rental Bot v${latest.version}...`);
  await downloadFile(latest.tarballUrl, archivePath);
  const archiveSha256 = await sha256File(archivePath);
  emitUpdateProgress('extracting', 'Extracting and validating the downloaded release...');
  await runCommand('tar', ['-xzf', archivePath, '-C', tempDir], { cwd: tempDir });

  const entries = await fs.readdir(tempDir, { withFileTypes: true });
  const extracted = entries.find((entry) => entry.isDirectory() && entry.name.startsWith('fleet-rental-bot-'));
  if (!extracted) {
    throw new Error('Downloaded update archive did not contain the expected project folder.');
  }

  const stagedRoot = path.join(tempDir, extracted.name);
  const stagedPackage = JSON.parse(await fs.readFile(path.join(stagedRoot, 'package.json'), 'utf8'));
  if (normalizeVersion(stagedPackage.version) !== normalizeVersion(latest.version)) {
    throw new Error(`Staged release version ${stagedPackage.version || 'unknown'} does not match ${latest.version}.`);
  }

  const currentLockfile = JSON.parse(await fs.readFile(path.join(appRoot, 'package-lock.json'), 'utf8'));
  const stagedLockfile = JSON.parse(await fs.readFile(path.join(stagedRoot, 'package-lock.json'), 'utf8'));
  const installedNodeModules = path.join(appRoot, 'node_modules');
  const installedElectron = path.join(installedNodeModules, 'electron', 'dist', 'electron.exe');
  let reuseDependencies = canReuseInstalledDependencies(currentLockfile, stagedLockfile);
  if (reuseDependencies) {
    try {
      await fs.access(installedElectron);
    } catch {
      reuseDependencies = false;
    }
  }

  if (reuseDependencies) {
    emitUpdateProgress('dependencies', 'Dependencies are unchanged — reusing the installed dependency set...');
    await fs.symlink(installedNodeModules, path.join(stagedRoot, 'node_modules'), 'junction');
    emitUpdateProgress('runtime', 'Validating the reused Electron runtime...');
  } else {
    emitUpdateProgress('dependencies', 'Dependencies changed — installing the updated dependency set...');
    await runCommand('npm', ['install', '--include=dev', '--no-audit', '--no-fund'], { cwd: stagedRoot });
    emitUpdateProgress('runtime', 'Validating the Electron runtime...');
    await runCommand('npm', ['run', 'ensure-electron-runtime'], { cwd: stagedRoot });
  }
  emitUpdateProgress('building', 'Building and validating the updated application...');
  await runCommand('npm', ['run', 'build'], { cwd: stagedRoot });
  await validateReleaseTree(fs, stagedRoot, { platform: process.platform });
  await fs.writeFile(path.join(stagedRoot, '.update-release.json'), JSON.stringify({
    version: latest.version,
    branch: latest.branch,
    archiveSha256,
    reuseDependencies,
    stagedAt: new Date().toISOString(),
  }, null, 2));
  await fs.writeFile(path.join(stagedRoot, '.update-readiness.json'), JSON.stringify({
    readyFile: path.join(tempDir, 'app-started'),
  }, null, 2));

  if (botRunning) await stopBot();
  emitUpdateProgress('restarting', 'Update staged successfully. Restarting Fleet Rental Bot...');
  await launchWindowsTransactionalUpdater({ appRoot, stagedRoot, tempDir });
  setTimeout(() => app.exit(0), 750);
  return { updated: true, currentVersion, latestVersion: latest.version, staged: true };
}

function installApplicationMenu() {
  const appVersion = packageJson.version || 'unknown';
  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox(mainWindow || undefined, {
              type: 'info',
              title: `About ${APP_DISPLAY_NAME}`,
              message: `${APP_DISPLAY_NAME} v${appVersion}`,
              detail: `Electron ${process.versions.electron}\nChrome ${process.versions.chrome}\nNode ${process.versions.node}`,
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ]);

  Menu.setApplicationMenu(menu);
}

function getAephiaApiKey(config) {
  return String(config?.AEPHIA_API_KEY || '').trim();
}

async function validateAephiaApiKeyOrThrow(config) {
  const token = getAephiaApiKey(config);
  if (!token) {
    throw new Error('Aephia API key missing. Add/refresh your Aephia token in settings before starting the bot.');
  }

  let response;
  try {
    response = await fetch(AEPHIA_TOKEN_VALIDATE_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new Error('Aephia token service/network unavailable. Temporary service problem; token was not marked invalid.');
  }

  if (response.status === 204) return;
  if (response.status === 401) {
    throw new Error('Aephia token auth failed. Refresh/reclaim your Aephia token in settings.');
  }
  if (response.status === 405) {
    throw new Error('Aephia token validation method rejected. Bot must use GET /token/validate.');
  }
  if (response.status >= 500) {
    throw new Error('Aephia token service unavailable. Temporary service problem; token was not marked invalid.');
  }
  throw new Error(`Unexpected Aephia token validation response: HTTP ${response.status}`);
}


function formatLogChunk(args) {
  return args
    .map((arg) => {
      if (arg instanceof Error) return arg.stack || arg.message;
      if (typeof arg === 'string') return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

function broadcast(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

const logger = {
  info: (...args) => {
    const message = formatLogChunk(args);
    console.log(message);
    broadcast('bot-log', { timestamp: new Date().toISOString(), level: 'INFO', message });
  },
  warn: (...args) => {
    const message = formatLogChunk(args);
    console.warn(message);
    broadcast('bot-log', { timestamp: new Date().toISOString(), level: 'WARN', message });
  },
  error: (...args) => {
    const message = formatLogChunk(args);
    console.error(message);
    broadcast('bot-log', { timestamp: new Date().toISOString(), level: 'ERROR', message });
  },
};

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function normalizeRentalRules(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    fleetName: String(row?.fleetName ?? row?.label ?? ''),
    fleetAccount: String(row?.fleetAccount ?? ''),
    rentalContract: String(row?.rentalContract ?? ''),
    currentRentalEnd: String(row?.currentRentalEnd ?? row?.rentEndsAt ?? ''),
    durationDays: String(row?.durationDays ?? row?.durationHours ?? '24'),
    maxRentPricePerDay: String(row?.maxRentPricePerDay ?? ''),
    comment: String(row?.comment ?? row?.shortComment ?? '').slice(0, 40),
    enabled: row?.enabled !== false && row?.enabled !== 'false' && row?.enabled !== 0,
  }));
}

function parseBooleanSetting(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function getRpcLimiterPaths() {
  return resolvePaths();
}

function getRpcLimiterStatus() {
  const paths = getRpcLimiterPaths();
  const state = readRpcLimiterState(paths.stateFile, Date.now());
  return buildRpcLimiterV2Status(state, paths.stateFile, Date.now());
}

function parsePositiveRate(value, fieldName) {
  const parsed = Number.parseFloat(String(value ?? '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive number.`);
  }
  return parsed;
}

async function withRpcLimiterLock(fn) {
  const paths = getRpcLimiterPaths();
  if (!fsSync.existsSync(paths.lockfile)) {
    fsSync.mkdirSync(path.dirname(paths.lockfile), { recursive: true });
    fsSync.writeFileSync(paths.lockfile, '');
  }

  const release = await lockfile.lock(paths.lockfile, {
    stale: 5000,
    retries: { retries: 50, minTimeout: 5, maxTimeout: 50, factor: 1.2 },
    realpath: false,
  });
  try {
    return fn(paths);
  } finally {
    await release().catch(() => undefined);
  }
}

async function sendSettingsToRpcLimiter(config) {
  if (!String(config.RPC_URL || '').trim()) throw new Error('Main RPC URL is empty.');
  if (!String(config.RPC_URL_FALLBACK || '').trim()) throw new Error('Fallback RPC URL is empty.');
  const rpcRequestsPerSecond = parsePositiveRate(config.RPC_REQUESTS_PER_SECOND, 'Requests / sec');
  const txPerSecond = parsePositiveRate(config.RPC_TX_SEND_RATE_LIMIT_PER_SECOND, 'sendTransaction / sec');
  const rpcIntervalMs = Math.max(1, Math.round(1000 / rpcRequestsPerSecond));
  const txIntervalMs = Math.max(1, Math.round(1000 / txPerSecond));

  await withRpcLimiterLock((paths) => {
    const state = readRpcLimiterState(paths.stateFile, Date.now());
    state.enabled = true;
    applyProviderSettings(state, config);
    state.buckets = state.buckets || {};
    state.buckets['rpc:shared'] = {
      ...(state.buckets['rpc:shared'] || { nextSlotMs: 0 }),
      intervalMs: rpcIntervalMs,
    };
    state.buckets['tx:shared'] = {
      ...(state.buckets['tx:shared'] || { nextSlotMs: 0 }),
      intervalMs: txIntervalMs,
    };
    state.updatedBy = RPC_LIMITER_UPDATED_BY;
    state.updatedAt = new Date().toISOString();
    bumpRpcLimiterRevision(state);
    writeRpcLimiterStateSync(paths.stateFile, state);
  });

  return getRpcLimiterStatus();
}

async function loadLocalSettings() {
  const candidatePaths = [getSettingsPath(), DEFAULT_SETTINGS_PATH];
  for (const settingsPath of candidatePaths) {
    try {
      return (await migrateSettingsFile(fs, settingsPath, safeStorage)).settings;
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      if (error instanceof SyntaxError || /must contain a JSON object/.test(String(error?.message || ''))) continue;
      throw error;
    }
  }
  return {};
}

async function saveLocalSettings(payload) {
  const current = await loadLocalSettings();
  const sourceConfig = payload?.config && typeof payload.config === 'object' ? payload.config : payload;
  const mergedSource = mergeSensitiveInput(current, sourceConfig);
  const filtered = {};

  // Always preserve every key that already exists in the settings file.
  // This prevents saving from wiping non-editable fields like RPC_URL.
  for (const key of Object.keys(current)) {
    filtered[key] = current[key];
  }

  // Override with whatever the client sent (only keys present in the payload).
  for (const key of EDITABLE_CONFIG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(sourceConfig || {}, key)) {
      filtered[key] = String(mergedSource[key] ?? '');
    }
  }

  filtered.USE_RPC_LIMITER = 'false';

  filtered.RENTAL_RULE_ROWS = normalizeRentalRules(payload?.rentalRules ?? current.RENTAL_RULE_ROWS ?? []);
  await writeJsonAtomic(fs, getSettingsPath(), encryptSensitiveSettings(filtered, safeStorage));
  return filtered;
}

async function updateSavedRentalEnd(details) {
  if (!details?.rentEndsAt) return;
  const current = await loadLocalSettings();
  const rows = normalizeRentalRules(current.RENTAL_RULE_ROWS ?? []);
  let changed = false;
  const updatedRows = rows.map((row) => {
    const sameFleet = row.fleetAccount && row.fleetAccount === details.fleetAccount;
    const sameContract = row.rentalContract && row.rentalContract === details.rentalContract;
    if (!sameFleet && !sameContract) return row;
    changed = true;
    return {
      ...row,
      fleetName: details.fleetName || row.fleetName,
      currentRentalEnd: details.rentEndsAt,
    };
  });
  if (!changed) return;
  await saveLocalSettings({ ...current, RENTAL_RULE_ROWS: updatedRows, rentalRules: updatedRows });
}

async function getEffectiveEditableConfig() {
  const defaults = getEditableConfigFromEnv({ INSTANCE_NAME: _instanceName });
  const localSettings = await loadLocalSettings();

  // Merge: localSettings values take precedence. Only fill gaps from built-in defaults.
  const config = { ...defaults };
  for (const key of EDITABLE_CONFIG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(localSettings, key)) {
      const value = localSettings[key];
      // Treat blank managed-account fields as not configured.
      if ((key === 'OWNER_WALLET' || key === 'OWNER_PROFILE') && String(value ?? '').trim() === '') {
        continue;
      }
      config[key] = value;
    }
  }
  config.USE_RPC_LIMITER = 'false';

  return config;
}

async function getEffectiveBotInputConfig() {
  const editable = await getEffectiveEditableConfig();
  const localSettings = await loadLocalSettings();
  const useRpcLimiter = parseBooleanSetting(editable.USE_RPC_LIMITER);
  const botConfig = { ...editable };

  if (useRpcLimiter) {
    const rpcLimiter = getRpcLimiterStatus();
    if (!rpcLimiter.currentRpcUrl) {
      throw new Error('Use RPC Limiter is enabled, but no Current RPC Limiter URL is configured. Send settings to RPC Limiter first.');
    }
    botConfig.RPC_URL = rpcLimiter.currentRpcUrl;
  }

  return {
    ...botConfig,
    rentalRules: normalizeRentalRules(localSettings.RENTAL_RULE_ROWS ?? []),
  };
}

function getEmptyStatusSnapshot() {
  return {
    running: false,
    wallet: '—',
    ownerWallet: '—',
    ownerProfile: '—',
    srslyProgramId: '—',
    dryRun: true,
    solBalance: null,
    atlasBalance: null,
    startedAt: null,
    lastCycleStartedAt: null,
    lastCycleCompletedAt: null,
    lastCycleDurationMs: null,
    activeRuleCount: 0,
    ruleHealth: [],
    recentActivity: [],
  };
}

async function startBotFromSettings() {
  if (botRunning) return;
  const configInput = await getEffectiveBotInputConfig();
  await validateAephiaApiKeyOrThrow(configInput);
  const config = buildBotConfig(configInput);
  config.onRentSuccess = updateSavedRentalEnd;
  bot = new FleetRentalBot(config, logger);
  botRunning = true;
  broadcast('bot-status', { running: true });

  try {
    await bot.start();
  } catch (err) {
    logger.error('Bot exited with error:', err);
    botRunning = false;
    bot = null;
    broadcast('bot-status', { running: false });
    throw err;
  }
}

async function stopBot() {
  if (!bot || !botRunning) return;
  await bot.stop();
  botRunning = false;
  bot = null;
  broadcast('bot-status', { running: false });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 880,
    backgroundColor: '#0f172a',
    title: WINDOW_TITLE,
    icon: WINDOW_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      navigateOnDragDrop: false,
      backgroundThrottling: false,
    },
  });
  attachWindowCrashLogging(mainWindow);

  const rendererUrl = pathToFileURL(path.join(__dirname, 'renderer.html')).href;
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (targetUrl !== rendererUrl) event.preventDefault();
  });

  // Keep the instance suffix even when renderer.html's <title> fires a
  // page-title-updated event after load.
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow.setTitle(WINDOW_TITLE);
  });
  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.setTitle(WINDOW_TITLE);
    void confirmTransactionalUpdateStartup();
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer.html'));
}

installCrashEventLogging();

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    const powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension')
    console.log(`[FleetRentalBot] prevent-app-suspension blocker=${powerSaveBlockerId} active=${powerSaveBlocker.isStarted(powerSaveBlockerId)}`)

    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

    installApplicationMenu();
    createWindow();

    try {
      await startBotFromSettings();
    } catch (err) {
      logger.error('Auto-start failed:', err);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', async (event) => {
    if (botRunning) {
      event.preventDefault();
      await stopBot();
      app.quit();
    }
  });
}

function getDisplayAccounts(config) {
  let hotWalletAddress = '—';
  try {
    if (config.HOT_WALLET_SECRET) {
      hotWalletAddress = getHotWalletAddressFromSecret(config.HOT_WALLET_SECRET);
    }
  } catch {
    hotWalletAddress = 'Invalid hot wallet secret';
  }

  return {
    hotWalletAddress,
    managedWallet: config.OWNER_WALLET,
    managedPlayerProfile: config.OWNER_PROFILE,
  };
}

function redactRpcLimiterStatus(status) {
  const providers = {};
  for (const providerId of ['main', 'fallback']) {
    const provider = status?.providers?.[providerId] || {};
    providers[providerId] = {
      ...provider,
      currentRpcUrl: provider.currentRpcUrl ? REDACTED_VALUE : '',
    };
  }
  return {
    ...status,
    providers,
    currentRpcUrl: status?.currentRpcUrl ? REDACTED_VALUE : '',
  };
}

const TRUSTED_RENDERER_URL = pathToFileURL(path.join(__dirname, 'renderer.html')).href;

function handleTrusted(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedIpcSender(event, TRUSTED_RENDERER_URL);
    return handler(event, ...args);
  });
}

handleTrusted('settings:get', async () => {
  const config = await getEffectiveEditableConfig();
  const localSettings = await loadLocalSettings();
  return {
    config: redactSensitiveSettings(config),
    rpcLimiter: redactRpcLimiterStatus(getRpcLimiterStatus()),
    displayAccounts: getDisplayAccounts(config),
    rentalRules: normalizeRentalRules(localSettings.RENTAL_RULE_ROWS ?? []),
  };
});

handleTrusted('settings:save', async (_event, payload) => {
  assertSettingsPayload(payload, EDITABLE_CONFIG_KEYS);
  const settings = await saveLocalSettings(payload);
  let restarted = false;

  if (botRunning) {
    await stopBot();
    await startBotFromSettings();
    restarted = true;
  }

  return {
    settings: redactSensitiveSettings(settings),
    rpcLimiter: redactRpcLimiterStatus(getRpcLimiterStatus()),
    displayAccounts: getDisplayAccounts(settings),
    restarted,
  };
});

handleTrusted('rpc-limiter:send-settings', async (_event, payload) => {
  assertSettingsPayload(payload, EDITABLE_CONFIG_KEYS);
  const sourceConfig = payload?.config && typeof payload.config === 'object' ? payload.config : payload;
  const effectiveConfig = await getEffectiveEditableConfig();
  const mergedConfig = mergeSensitiveInput(effectiveConfig, sourceConfig || {});
  return redactRpcLimiterStatus(await sendSettingsToRpcLimiter(mergedConfig));
});

handleTrusted('rpc-limiter:get-status', async () => redactRpcLimiterStatus(getRpcLimiterStatus()));

handleTrusted('bot:start', async () => {
  await startBotFromSettings();
  return { ok: true };
});

handleTrusted('bot:stop', async () => {
  await stopBot();
  return { ok: true };
});

handleTrusted('bot:status', async () => {
  if (!bot) return getEmptyStatusSnapshot();
  return bot.getStatusSnapshot();
});

handleTrusted('app:get-version', async () => {
  return { version: packageJson.version || 'unknown' };
});

handleTrusted('updates:check', async () => {
  return await checkForUpdates();
});

handleTrusted('updates:download-and-restart', async () => {
  return await downloadUpdateAndRestart();
});

// Look up on-chain data for a given hot wallet public key.
// Derives the Player Profile PDA and checks if it exists on-chain.
handleTrusted('wallet:lookup', async (_event, payload) => {
  assertWalletLookupPayload(payload);
  const { hotWalletPublicKey } = payload;
  console.error('[wallet:lookup] hotWalletPublicKey =', hotWalletPublicKey);
  try {
    const config = await getEffectiveBotInputConfig();
    console.error('[wallet:lookup] RPC_URL =', config.RPC_URL);
    const connection = new Connection(config.RPC_URL || 'https://api.mainnet-beta.solana.com', {
      commitment: 'confirmed',
      disableRetryOnRateLimit: true,
    });
    const walletPK = new PublicKey(hotWalletPublicKey);
    const PLAYER_PROFILE_PROGRAM_ID = 'pprofELXjL5Kck7Jn5hCpwAL82DpTkSYBENzahVtbc9';
    // Profile PDA: seeds = ['profile', wallet_pubkey]
    const [profilePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('profile'), walletPK.toBuffer()],
      new PublicKey(PLAYER_PROFILE_PROGRAM_ID),
    );
    const accountInfo = await connection.getAccountInfo(profilePDA, 'confirmed');
    console.error('[wallet:lookup] profilePDA =', profilePDA.toBase58(), 'exists =', !!accountInfo);
    return {
      ownerWallet: hotWalletPublicKey,
      playerProfile: accountInfo ? profilePDA.toBase58() : null,
    };
  } catch (err) {
    console.error('[wallet:lookup] ERROR =', err.message);
    return { ownerWallet: null, playerProfile: null, error: err.message };
  }
});

handleTrusted('app:get-instance-name', () => {
  return _instanceName || '';
});

handleTrusted('wallet:get-address', async (_event, payload) => {
  assertWalletSecretPayload(payload);
  const { secret } = payload;
  try {
    const address = getHotWalletAddressFromSecret(secret);
    console.error('[wallet:get-address] address =', address);
    return address;
  } catch (err) {
    console.error('[wallet:get-address] ERROR =', err.message);
    return 'Invalid hot wallet secret';
  }
});

handleTrusted('rules:resolve', async (_event, payload) => {
  assertRuleResolvePayload(payload);
  const config = await getEffectiveBotInputConfig();
  return resolveRentalRuleDetails({
    rpcUrl: config.RPC_URL,
    srslyProgramId: config.SRSLY_PROGRAM_ID,
    fleetAccount: payload?.fleetAccount,
    rentalContract: payload?.rentalContract,
  });
});
