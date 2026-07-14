const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { Connection, PublicKey } = require('@solana/web3.js');
const lockfile = require('proper-lockfile');
const packageJson = require('../package.json');
const { resolvePaths } = require('rpc_limiter');
const { readState: readRpcLimiterState, writeStateSync: writeRpcLimiterStateSync, bumpRevision: bumpRpcLimiterRevision } = require('rpc_limiter/dist/state');

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
function getProfileName() {
  const args = process.argv.slice(1);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--profile' || arg === '--instance') {
      return String(args[i + 1] ?? '').trim();
    }
    if (arg.startsWith('--profile=')) {
      return arg.slice('--profile='.length).trim();
    }
    if (arg.startsWith('--instance=')) {
      return arg.slice('--instance='.length).trim();
    }
  }
  return '';
}

function sanitizeProfileName(value) {
  return String(value ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const BASE_USER_DATA = path.join(process.env.HOME || process.env.USERPROFILE, '.config', 'fleet-rental-bot');
const DEFAULT_SETTINGS_PATH = path.join(BASE_USER_DATA, 'settings.json');
const _profileName = sanitizeProfileName(getProfileName());
const _instanceName = _profileName;
console.error('[FleetRentalBot] profile from argv =', JSON.stringify(_profileName));
console.error('[FleetRentalBot] HOME =', JSON.stringify(process.env.HOME));
if (_profileName) {
  app.setPath('userData', path.join(BASE_USER_DATA, 'profiles', _profileName));
  app.setName(`Fleet Rental Bot - ${_profileName}`);
  if (typeof app.setDesktopName === 'function') {
    app.setDesktopName(`fleet-rental-bot-${_profileName}.desktop`);
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
  if (profileKey) {
    return path.join(__dirname, '..', 'assets', `fleet-rental-bot-${profileKey}.png`);
  }
  return path.join(__dirname, '..', 'assets', 'fleet-rental-bot-avatar.png');
}

function isDedicatedProfileInstall() {
  if (!_profileName) return true;
  const appRootName = path.basename(getAppRoot()).toLowerCase();
  const profileSlug = _profileName.toLowerCase();
  return appRootName === `fleet-rental-bot-${profileSlug}`;
}

function isSystemdManaged() {
  if (process.env.INVOCATION_ID || process.env.SYSTEMD_EXEC_PID) return true;
  try {
    return fsSync.readFileSync('/proc/self/cgroup', 'utf8').includes('.service');
  } catch {
    return false;
  }
}

const WINDOW_ICON = getWindowIconPath(_profileName);
console.error('[FleetRentalBot] TITLE_SUFFIX =', JSON.stringify(TITLE_SUFFIX));

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
// Do not disable the software rasterizer in WSLg. Electron may need SwiftShader
// when hardware/GPU processes are unavailable; disabling it causes startup
// crashes such as "GPU process isn't usable. Goodbye."

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

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '');
}

function compareVersions(a, b) {
  const left = normalizeVersion(a).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = normalizeVersion(b).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    if ((left[i] || 0) > (right[i] || 0)) return 1;
    if ((left[i] || 0) < (right[i] || 0)) return -1;
  }
  return 0;
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

  if (botRunning) {
    await stopBot();
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fleet-rental-bot-update-'));
  const archivePath = path.join(tempDir, `${latest.branch || 'main'}.tar.gz`);
  await downloadFile(latest.tarballUrl, archivePath);
  await runCommand('tar', ['-xzf', archivePath, '-C', tempDir], { cwd: tempDir });

  const entries = await fs.readdir(tempDir, { withFileTypes: true });
  const extracted = entries.find((entry) => entry.isDirectory() && entry.name.startsWith('fleet-rental-bot-'));
  if (!extracted) {
    throw new Error('Downloaded update archive did not contain the expected project folder.');
  }

  const extractedRoot = path.join(tempDir, extracted.name);
  await fs.cp(extractedRoot, getAppRoot(), {
    recursive: true,
    force: true,
    filter: (source) => {
      const rel = path.relative(extractedRoot, source);
      return !rel.startsWith('.git') && !rel.startsWith('node_modules') && !rel.startsWith('analysis') && !rel.endsWith('-analysis');
    },
  });

  await runCommand('npm', ['install'], { cwd: getAppRoot() });
  await runCommand('npm', ['run', 'build'], { cwd: getAppRoot() });

  // systemd's Restart=always starts the replacement. Calling app.relaunch()
  // as well would create a second, unmanaged copy of the same profile.
  if (!isSystemdManaged()) {
    app.relaunch();
  }
  app.exit(0);
  return { updated: true, currentVersion, latestVersion: latest.version };
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

function buildSharedRpcUrl(state) {
  const base = String(state?.rpcBaseUrl || '').trim();
  const apiKey = String(state?.apiKey || '').trim();
  if (!base) return '';
  if (!apiKey) return base;
  try {
    const url = new URL(base);
    url.searchParams.set('api-key', apiKey);
    return url.toString();
  } catch {
    const separator = base.includes('?') ? '&' : '?';
    return `${base}${separator}api-key=${encodeURIComponent(apiKey)}`;
  }
}

function getRpcLimiterStatus() {
  const paths = getRpcLimiterPaths();
  const state = readRpcLimiterState(paths.stateFile, Date.now());
  return {
    path: paths.stateFile,
    enabled: Boolean(state.enabled),
    rpcBaseUrl: state.rpcBaseUrl || '',
    apiKey: state.apiKey || '',
    currentRpcUrl: buildSharedRpcUrl(state),
    buckets: state.buckets || {},
    updatedBy: state.updatedBy || '',
    updatedAt: state.updatedAt || '',
    revision: state.revision ?? 0,
  };
}

function parseRpcUrlForLimiter(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) {
    throw new Error('RPC URL is empty.');
  }

  const url = new URL(raw);
  const apiKey = url.searchParams.get('api-key') || '';
  url.searchParams.delete('api-key');
  const remainingQuery = url.searchParams.toString();
  const pathname = url.pathname === '/' ? '' : url.pathname;
  const rpcBaseUrl = `${url.origin}${pathname}${remainingQuery ? `?${remainingQuery}` : ''}`;
  return { rpcBaseUrl, apiKey };
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
  const { rpcBaseUrl, apiKey } = parseRpcUrlForLimiter(config.RPC_URL);
  const rpcRequestsPerSecond = parsePositiveRate(config.RPC_REQUESTS_PER_SECOND, 'Requests / sec');
  const txPerSecond = parsePositiveRate(config.RPC_TX_SEND_RATE_LIMIT_PER_SECOND, 'sendTransaction / sec');
  const rpcIntervalMs = Math.max(1, Math.round(1000 / rpcRequestsPerSecond));
  const txIntervalMs = Math.max(1, Math.round(1000 / txPerSecond));

  await withRpcLimiterLock((paths) => {
    const state = readRpcLimiterState(paths.stateFile, Date.now());
    state.enabled = true;
    state.rpcBaseUrl = rpcBaseUrl;
    state.apiKey = apiKey;
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
  try {
    const raw = await fs.readFile(getSettingsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // Instance-specific file doesn't exist yet — fall back to the original
    // default settings so first launch of a new instance isn't blank.
    try {
      const raw = await fs.readFile(DEFAULT_SETTINGS_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
}

async function saveLocalSettings(payload) {
  const current = await loadLocalSettings();
  const sourceConfig = payload?.config && typeof payload.config === 'object' ? payload.config : payload;
  const filtered = {};

  // Always preserve every key that already exists in the settings file.
  // This prevents saving from wiping non-editable fields like RPC_URL.
  for (const key of Object.keys(current)) {
    filtered[key] = current[key];
  }

  // Override with whatever the client sent (only keys present in the payload).
  for (const key of EDITABLE_CONFIG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(sourceConfig || {}, key)) {
      filtered[key] = String(sourceConfig[key] ?? '');
    }
  }

  filtered.USE_RPC_LIMITER = 'false';

  filtered.RENTAL_RULE_ROWS = normalizeRentalRules(payload?.rentalRules ?? current.RENTAL_RULE_ROWS ?? []);
  await fs.mkdir(path.dirname(getSettingsPath()), { recursive: true });
  await fs.writeFile(getSettingsPath(), JSON.stringify(filtered, null, 2), 'utf8');
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
    },
  });
  attachWindowCrashLogging(mainWindow);

  // Keep the instance suffix even when renderer.html's <title> fires a
  // page-title-updated event after load.
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow.setTitle(WINDOW_TITLE);
  });
  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.setTitle(WINDOW_TITLE);
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

ipcMain.handle('settings:get', async () => {
  const config = await getEffectiveEditableConfig();
  const localSettings = await loadLocalSettings();
  return {
    config,
    rpcLimiter: getRpcLimiterStatus(),
    displayAccounts: getDisplayAccounts(config),
    rentalRules: normalizeRentalRules(localSettings.RENTAL_RULE_ROWS ?? []),
  };
});

ipcMain.handle('settings:save', async (_event, payload) => {
  const settings = await saveLocalSettings(payload);
  let restarted = false;

  if (botRunning) {
    await stopBot();
    await startBotFromSettings();
    restarted = true;
  }

  return { settings, rpcLimiter: getRpcLimiterStatus(), restarted };
});

ipcMain.handle('rpc-limiter:send-settings', async (_event, payload) => {
  const sourceConfig = payload?.config && typeof payload.config === 'object' ? payload.config : payload;
  return await sendSettingsToRpcLimiter(sourceConfig || {});
});

ipcMain.handle('rpc-limiter:get-status', async () => getRpcLimiterStatus());

ipcMain.handle('bot:start', async () => {
  await startBotFromSettings();
  return { ok: true };
});

ipcMain.handle('bot:stop', async () => {
  await stopBot();
  return { ok: true };
});

ipcMain.handle('bot:status', async () => {
  if (!bot) return getEmptyStatusSnapshot();
  return bot.getStatusSnapshot();
});

ipcMain.handle('app:get-version', async () => {
  return { version: packageJson.version || 'unknown' };
});

ipcMain.handle('updates:check', async () => {
  return await checkForUpdates();
});

ipcMain.handle('updates:download-and-restart', async () => {
  return await downloadUpdateAndRestart();
});

// Look up on-chain data for a given hot wallet public key.
// Derives the Player Profile PDA and checks if it exists on-chain.
ipcMain.handle('wallet:lookup', async (_event, { hotWalletPublicKey }) => {
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

ipcMain.handle('app:get-instance-name', () => {
  return _instanceName || '';
});

ipcMain.handle('wallet:get-address', async (_event, { secret }) => {
  try {
    const address = getHotWalletAddressFromSecret(secret);
    console.error('[wallet:get-address] address =', address);
    return address;
  } catch (err) {
    console.error('[wallet:get-address] ERROR =', err.message);
    return 'Invalid hot wallet secret';
  }
});

ipcMain.handle('rules:resolve', async (_event, payload) => {
  const config = await getEffectiveBotInputConfig();
  return resolveRentalRuleDetails({
    rpcUrl: config.RPC_URL,
    srslyProgramId: config.SRSLY_PROGRAM_ID,
    fleetAccount: payload?.fleetAccount,
    rentalContract: payload?.rentalContract,
  });
});
