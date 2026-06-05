const form = document.getElementById('config-form');
const logsEl = document.getElementById('logs');
const rentalRulesBody = document.getElementById('rental-rules-body');
const addRuleRowBtn = document.getElementById('add-rule-row-btn');
const saveBtn = document.getElementById('save-btn');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const toggleSensitiveBtn = document.getElementById('toggle-sensitive-btn');
const statusSummary = document.getElementById('status-summary');
const ruleHealth = document.getElementById('rule-health');
const recentActivity = document.getElementById('recent-activity');
const runningBadge = document.getElementById('running-badge');
const displayHotWalletAddress = document.getElementById('display-hot-wallet-address');
const displayManagedWallet = document.getElementById('display-managed-wallet');
const displayManagedPlayerProfile = document.getElementById('display-managed-player-profile');
const updateBtn = document.getElementById('update-btn');
const updateModal = document.getElementById('update-modal');
const updateCurrentVersionEl = document.getElementById('update-current-version');
const updateLatestVersionEl = document.getElementById('update-latest-version');
const updateMessageEl = document.getElementById('update-message');
const updateConfirmBtn = document.getElementById('update-confirm-btn');
const updateCancelBtn = document.getElementById('update-cancel-btn');
const sendRpcLimiterBtn = document.getElementById('send-rpc-limiter-btn');
const rpcLimiterCurrentUrlEl = document.getElementById('rpc-limiter-current-url');
const rpcLimiterStatePathEl = document.getElementById('rpc-limiter-state-path');
const rpcLimiterUpdatedEl = document.getElementById('rpc-limiter-updated');
const tabButtons = Array.from(document.querySelectorAll('.tab-button'));
const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));

const CONFIG_KEYS = [
  'INSTANCE_NAME',
  'AEPHIA_API_KEY',
  'RPC_URL',
  'RPC_URL_FALLBACK',
  'HOT_WALLET_SECRET',
  'SRSLY_PROGRAM_ID',
  'OWNER_WALLET',
  'OWNER_PROFILE',
  'AGGRESSIVE_START_BEFORE_END_SECONDS',
  'AGGRESSIVE_STOP_AFTER_END_SECONDS',
  'AGGRESSIVE_SEND_INTERVAL_MS',
  'RPC_REQUESTS_PER_SECOND',
  'RPC_TX_SEND_RATE_LIMIT_PER_SECOND',
  'USE_RPC_LIMITER',
  'TRANSACTION_PRIORITY_FEE_MICROLAMPORTS',
  'HELIUS_PRIORITY_FEE_MAX_MICROLAMPORTS',
  'USE_HELIUS_SENDER',
  'HELIUS_SENDER_SWQOS_ONLY',
  'HELIUS_SENDER_TIP_SOL',
  'ANALYSIS_DIR',
  'DRY_RUN',
];

const HELIUS_SENDER_MIN_TIP_SOL = 0.0002;
const HELIUS_SENDER_SWQOS_ONLY_MIN_TIP_SOL = 0.000005;
let statusTimer = null;
let rentalRulesHealthTimer = null;
let appVersion = 'unknown';
let availableUpdate = null;
let updateCheckInFlight = false;
let updateCheckPromise = null;
const GENERAL_CHECK_INTERVAL_MS = 3600 * 1000;
const RULE_RESOLVE_RETRY_MS = 5 * 60 * 1000;
const ruleResolveRetryTimers = new WeakMap();
let ruleResolveQueue = Promise.resolve();

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function shortKey(value) {
  const text = String(value ?? '');
  return text.length > 14 ? `${text.slice(0, 6)}…${text.slice(-6)}` : text;
}

function formatRetryDelay(ms) {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  if (totalSeconds >= 60 && totalSeconds % 60 === 0) {
    return `${totalSeconds / 60}m`;
  }
  return `${totalSeconds}s`;
}

function formatUptime(startedAt) {
  if (!startedAt) return 'Not running';
  const startedMs = Date.parse(startedAt);
  if (!Number.isFinite(startedMs)) return 'Running';

  const totalSeconds = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `Running for ${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `Running for ${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `Running for ${minutes}m ${seconds}s`;
  return `Running for ${seconds}s`;
}

function setRunningBadge(running) {
  runningBadge.textContent = running ? 'Running' : 'Stopped';
  runningBadge.classList.toggle('running', running);
  runningBadge.classList.toggle('stopped', !running);
}

function appendLog(payload) {
  const line = `[${payload.timestamp}] ${payload.level}: ${payload.message}\n`;
  logsEl.textContent += line;
  logsEl.scrollTop = logsEl.scrollHeight;
}

function setUpdateModalOpen(open) {
  updateModal.hidden = !open;
}

function setUpdateButtonAvailable(available) {
  updateBtn.classList.toggle('update-available', Boolean(available));
  updateBtn.title = available ? 'A newer Fleet Rental Bot version is available' : 'Check for updates';
}

function renderUpdateState(result, error = null) {
  const currentVersion = result?.currentVersion || appVersion;
  const latestVersion = result?.latestVersion || result?.remoteVersion || null;
  updateCurrentVersionEl.textContent = currentVersion ? `v${currentVersion}` : 'Unknown';
  updateLatestVersionEl.textContent = latestVersion ? `v${latestVersion}` : 'Unknown';
  updateConfirmBtn.disabled = !result?.updateAvailable;

  if (error) {
    updateLatestVersionEl.textContent = 'Unavailable';
    updateMessageEl.textContent = `Update check failed: ${error?.message || String(error)}`;
    updateConfirmBtn.textContent = 'Update';
    setUpdateButtonAvailable(false);
    return;
  }

  setUpdateButtonAvailable(Boolean(result?.updateAvailable));
  if (result?.updateAvailable) {
    updateMessageEl.textContent = 'A newer Fleet Rental Bot version is available on GitHub.';
    updateConfirmBtn.textContent = `Update to v${latestVersion}`;
    return;
  }

  updateMessageEl.textContent = 'Fleet Rental Bot is already up to date.';
  updateConfirmBtn.textContent = 'Update';
}

function renderUpdateChecking() {
  updateCurrentVersionEl.textContent = appVersion !== 'unknown' ? `v${appVersion}` : 'Checking...';
  updateLatestVersionEl.textContent = 'Checking...';
  updateMessageEl.textContent = 'Checking GitHub for the latest version...';
  updateConfirmBtn.textContent = 'Update';
  updateConfirmBtn.disabled = true;
  updateCancelBtn.disabled = false;
}

async function refreshAppVersion() {
  try {
    const versionInfo = await window.botApi.getAppVersion();
    appVersion = versionInfo?.version || appVersion;
  } catch {
    appVersion = 'unknown';
  }
}

async function checkForUpdates() {
  if (updateCheckInFlight) {
    return updateCheckPromise || availableUpdate;
  }

  updateCheckInFlight = true;
  updateCheckPromise = window.botApi.checkForUpdates();
  try {
    const result = await updateCheckPromise;
    availableUpdate = result;
    renderUpdateState(result);
    return result;
  } catch (err) {
    renderUpdateState(null, err);
    return null;
  } finally {
    updateCheckInFlight = false;
    updateCheckPromise = null;
  }
}

function createRuleRow(rule = {}) {
  const locked = Boolean(rule.fleetAccount || rule.rentalContract);
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input data-field="enabled" type="checkbox" ${rule.enabled === false ? '' : 'checked'} /></td>
    <td>
      <input data-field="fleetName" type="text" value="${escapeHtml(rule.fleetName ?? rule.label ?? '')}" placeholder="Loaded from chain" readonly />
      <div class="row-hint" data-field="resolveHint"></div>
    </td>
    <td><input data-field="fleetAccount" type="text" value="${escapeHtml(rule.fleetAccount ?? '')}" placeholder="Fleet account" ${locked ? 'readonly' : ''} /></td>
    <td><input data-field="rentalContract" type="text" value="${escapeHtml(rule.rentalContract ?? '')}" placeholder="Rental contract" ${locked ? 'readonly' : ''} /></td>
    <td><input data-field="currentRentalEnd" type="text" value="${escapeHtml(rule.currentRentalEnd ?? rule.rentEndsAt ?? '')}" placeholder="Loaded from chain" readonly /></td>
    <td><input data-field="durationDays" type="number" min="1" max="24" value="${escapeHtml(rule.durationDays ?? rule.durationHours ?? '24')}" /></td>
    <td class="max-price-cell"><input data-field="maxRentPricePerDay" type="number" min="0" step="0.00000001" value="${escapeHtml(rule.maxRentPricePerDay ?? '')}" /></td>
    <td class="comment-cell"><input data-field="comment" type="text" maxlength="40" value="${escapeHtml(rule.comment ?? '')}" placeholder="Short note" /></td>
    <td class="remove-cell"><button type="button" data-action="remove">Remove</button></td>
  `;
  tr.querySelector('[data-action="remove"]').addEventListener('click', () => {
    clearRuleResolveRetry(tr);
    tr.remove();
  });
  const fleetInput = tr.querySelector('[data-field="fleetAccount"]');
  const contractInput = tr.querySelector('[data-field="rentalContract"]');
  const maybeResolve = () => resolveRuleRow(tr);
  fleetInput.addEventListener('change', maybeResolve);
  fleetInput.addEventListener('blur', maybeResolve);
  contractInput.addEventListener('change', maybeResolve);
  contractInput.addEventListener('blur', maybeResolve);
  rentalRulesBody.appendChild(tr);
  if (locked) {
    setTimeout(() => resolveRuleRow(tr, { force: true }), 0);
  }
}

function clearRuleResolveRetry(tr) {
  const timer = ruleResolveRetryTimers.get(tr);
  if (timer) {
    clearTimeout(timer);
    ruleResolveRetryTimers.delete(tr);
  }
}

function scheduleRuleResolveRetry(tr, message) {
  clearRuleResolveRetry(tr);
  const timer = setTimeout(() => {
    ruleResolveRetryTimers.delete(tr);
    if (!tr.isConnected) return;
    void resolveRuleRow(tr, { force: true, retry: true });
  }, RULE_RESOLVE_RETRY_MS);
  ruleResolveRetryTimers.set(tr, timer);

  const hint = tr.querySelector('[data-field="resolveHint"]');
  if (hint) {
    hint.textContent = `${message} · retrying in ${formatRetryDelay(RULE_RESOLVE_RETRY_MS)}`;
  }
}

function enqueueRuleResolve(task) {
  const run = ruleResolveQueue.then(task, task);
  ruleResolveQueue = run.catch(() => {});
  return run;
}

async function resolveRuleRow(tr, options = {}) {
  const get = (field) => tr.querySelector(`[data-field="${field}"]`);
  const fleetInput = get('fleetAccount');
  const contractInput = get('rentalContract');
  const hint = get('resolveHint');
  const fleetAccount = fleetInput.value.trim();
  const rentalContract = contractInput.value.trim();
  if (!fleetAccount && !rentalContract) return;
  const hasResolvedDisplay = get('fleetName').value.trim() && get('currentRentalEnd').value.trim();
  if (!options.force && fleetInput.readOnly && contractInput.readOnly && hasResolvedDisplay) return;

  hint.textContent = options.retry ? 'Retrying chain load…' : 'Loading from chain…';
  try {
    const resolved = await enqueueRuleResolve(async () => {
      if (!tr.isConnected) return null;
      return window.botApi.resolveRule({ fleetAccount, rentalContract });
    });
    if (!resolved) return;
    clearRuleResolveRetry(tr);
    get('fleetName').value = resolved.fleetName || '—';
    get('currentRentalEnd').value = resolved.rentEndsAt || '—';
    fleetInput.value = resolved.fleetAccount || fleetAccount;
    contractInput.value = resolved.rentalContract || rentalContract;
    fleetInput.readOnly = true;
    contractInput.readOnly = true;
    const relistingStatus = resolved.relistingStatus === 'closing' ? 'closing' : 'relisting';
    hint.textContent = `Rate ${resolved.currentPricePerDay ?? '—'} ATLAS/day · ${relistingStatus}`;
  } catch (err) {
    scheduleRuleResolveRetry(tr, err.message || String(err));
  }
}

function rentalEndSortValue(tr) {
  const input = tr.querySelector('[data-field="currentRentalEnd"]');
  const value = String(input?.value ?? '').trim();
  if (!value || value === '—') return Number.POSITIVE_INFINITY;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

function sortRentalRulesByCurrentRentalEnd() {
  [...rentalRulesBody.querySelectorAll('tr')]
    .sort((a, b) => rentalEndSortValue(a) - rentalEndSortValue(b))
    .forEach((tr) => rentalRulesBody.appendChild(tr));
}

async function refreshRentalRulesHealth() {
  const rows = [...rentalRulesBody.querySelectorAll('tr')];
  for (const tr of rows) {
    await resolveRuleRow(tr, { force: true });
  }
  sortRentalRulesByCurrentRentalEnd();
}

function getRentalRulesFromForm() {
  return [...rentalRulesBody.querySelectorAll('tr')].map((tr) => {
    const get = (field) => tr.querySelector(`[data-field="${field}"]`);
    return {
      enabled: get('enabled').checked,
      fleetName: get('fleetName').value,
      fleetAccount: get('fleetAccount').value,
      rentalContract: get('rentalContract').value,
      currentRentalEnd: get('currentRentalEnd').value,
      durationDays: get('durationDays').value,
      maxRentPricePerDay: get('maxRentPricePerDay').value,
      comment: get('comment').value,
    };
  });
}

function setConfigValues(config) {
  for (const key of CONFIG_KEYS) {
    const input = form.elements[key];
    if (!input) continue;
    if (input.type === 'checkbox') {
      input.checked = parseBoolean(config?.[key]);
    } else {
      input.value = config?.[key] ?? '';
    }
  }
  syncHeliusSenderTipMinimum();
  updateRpcLimiterModeTone();
}

function updateRpcLimiterModeTone() {
  const useRpcLimiter = parseBoolean(form.elements['USE_RPC_LIMITER']?.checked ? 'true' : 'false');
  form.classList.toggle('rpc-limiter-enabled', useRpcLimiter);
  form.classList.toggle('rpc-limiter-disabled', !useRpcLimiter);
}

function renderRpcLimiterStatus(status) {
  if (!status) {
    rpcLimiterCurrentUrlEl.value = '';
    rpcLimiterStatePathEl.textContent = '—';
    rpcLimiterUpdatedEl.textContent = '';
    return;
  }

  rpcLimiterCurrentUrlEl.value = status.currentRpcUrl || '';
  rpcLimiterStatePathEl.textContent = status.path || '—';
  const updatedParts = [];
  if (status.updatedBy) updatedParts.push(`updated by ${status.updatedBy}`);
  if (status.updatedAt) updatedParts.push(`at ${status.updatedAt}`);
  rpcLimiterUpdatedEl.textContent = updatedParts.join(' ');
}

function setDisplayAccounts(displayAccounts) {
  displayHotWalletAddress.textContent = displayAccounts?.hotWalletAddress ?? '—';
  displayHotWalletAddress.title = displayAccounts?.hotWalletAddress ?? '';
  displayManagedWallet.textContent = displayAccounts?.managedWallet ?? '—';
  displayManagedWallet.title = displayAccounts?.managedWallet ?? '';
  displayManagedPlayerProfile.textContent = displayAccounts?.managedPlayerProfile ?? '—';
  displayManagedPlayerProfile.title = displayAccounts?.managedPlayerProfile ?? '';
}

function getConfigValues() {
  const config = {};
  for (const key of CONFIG_KEYS) {
    const input = form.elements[key];
    if (input) config[key] = input.type === 'checkbox' ? String(input.checked) : input.value;
  }
  const useSender = form.elements['USE_HELIUS_SENDER']?.checked;
  config.USE_NORMAL_TXS = String(!useSender);
  config.USE_SWQOS = 'false';
  config.USE_HELIUS_SENDER = String(Boolean(useSender));
  config.HELIUS_SENDER_SWQOS_ONLY = 'false';
  return config;
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}

function getHeliusSenderMinimumTipSol() {
  return form.elements['HELIUS_SENDER_SWQOS_ONLY']?.checked ? HELIUS_SENDER_SWQOS_ONLY_MIN_TIP_SOL : HELIUS_SENDER_MIN_TIP_SOL;
}

function syncHeliusSenderTipMinimum() {
  const input = form.elements['HELIUS_SENDER_TIP_SOL'];
  if (!input) return;
  const min = HELIUS_SENDER_MIN_TIP_SOL;
  input.min = String(min);
  input.placeholder = String(min);
  if (!String(input.value ?? '').trim()) {
    input.value = String(min);
  }
}

function validateHeliusSenderSettings() {
  const useSender = form.elements['USE_HELIUS_SENDER']?.checked;
  if (!useSender) return;
  const input = form.elements['HELIUS_SENDER_TIP_SOL'];
  const min = HELIUS_SENDER_MIN_TIP_SOL;
  const value = Number.parseFloat(String(input?.value ?? ''));
  if (!Number.isFinite(value) || value < min) {
    throw new Error(`HELIUS_SENDER_TIP_SOL must be >= ${min} SOL`);
  }
}

function refreshDisplayAccountsFromForm() {
  setDisplayAccounts({
    hotWalletAddress: displayHotWalletAddress.textContent || '—',
    managedWallet: form.elements['OWNER_WALLET']?.value?.trim() || '—',
    managedPlayerProfile: form.elements['OWNER_PROFILE']?.value?.trim() || '—',
  });
}

async function loadSettings() {
  const settings = await window.botApi.getSettings();
  setConfigValues(settings.config || {});
  renderRpcLimiterStatus(settings.rpcLimiter);
  setDisplayAccounts(settings.displayAccounts || {});
  rentalRulesBody.innerHTML = '';
  (settings.rentalRules || []).forEach(createRuleRow);
  await refreshRentalRulesHealth();
}

async function saveSettings() {
  saveBtn.disabled = true;
  try {
    validateHeliusSenderSettings();
    const result = await window.botApi.saveSettings({ config: getConfigValues(), rentalRules: getRentalRulesFromForm() });
    if (result?.rpcLimiter) renderRpcLimiterStatus(result.rpcLimiter);
    refreshDisplayAccountsFromForm();
    appendLog({
      timestamp: new Date().toISOString(),
      level: 'INFO',
      message: result?.restarted ? 'Settings saved. Running bot restarted with updated rules.' : 'Settings saved.',
    });
    if (result?.restarted) {
      setRunningUi(true);
      await refreshStatus();
    }
  } catch (err) {
    appendLog({ timestamp: new Date().toISOString(), level: 'ERROR', message: err.message || String(err) });
  } finally {
    saveBtn.disabled = false;
  }
}

function renderSummary(snapshot) {
  setRunningBadge(Boolean(snapshot.running));
  const runtimeText = snapshot.running ? formatUptime(snapshot.startedAt) : 'Stopped';
  statusSummary.classList.remove('muted');
  statusSummary.innerHTML = `
    <div class="status-runtime-line">${escapeHtml(runtimeText)} | v${escapeHtml(appVersion)}</div>
    <div class="status-grid">
      <div class="status-row"><span>Hot Wallet</span><span title="${escapeHtml(snapshot.wallet)}">${escapeHtml(shortKey(snapshot.wallet))}</span></div>
      <div class="status-row"><span>Managed Wallet</span><span title="${escapeHtml(snapshot.ownerWallet)}">${escapeHtml(shortKey(snapshot.ownerWallet))}</span></div>
      <div class="status-row"><span>Managed Profile</span><span title="${escapeHtml(snapshot.ownerProfile)}">${escapeHtml(shortKey(snapshot.ownerProfile))}</span></div>
      <div class="status-row"><span>SOL</span><span>${snapshot.solBalance == null ? '—' : snapshot.solBalance.toFixed(4)}</span></div>
      <div class="status-row"><span>ATLAS</span><span>${snapshot.atlasBalance == null ? '—' : snapshot.atlasBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
      <div class="status-row"><span>Rules</span><span>${snapshot.activeRuleCount ?? 0}</span></div>
      <div class="status-row"><span>Last Cycle</span><span>${escapeHtml(snapshot.lastCycleCompletedAt ?? '—')}</span></div>
    </div>
  `;
}

function renderRuleHealth(snapshot) {
  const rules = snapshot.ruleHealth || [];
  if (!rules.length) {
    ruleHealth.className = 'rule-health-list muted';
    ruleHealth.textContent = 'No rules.';
    return;
  }

  ruleHealth.className = 'rule-health-list';
  ruleHealth.innerHTML = rules
    .map((rule) => `
      <article class="rule-card">
        <h3>${escapeHtml(rule.fleetName)} <span class="badge ${escapeHtml(rule.status)}">${escapeHtml(rule.status)}</span></h3>
        <p>Price: ${rule.currentPricePerDay == null ? '—' : `${rule.currentPricePerDay} ATLAS/day`} / max ${escapeHtml(rule.maxRentPricePerDay)}</p>
        <p>Duration: ${escapeHtml(rule.durationDays)} days</p>
        <p>Ends: ${escapeHtml(rule.rentEndsAt ?? '—')} ${rule.secondsUntilEnd == null ? '' : `(${rule.secondsUntilEnd}s)`}</p>
        <p>${escapeHtml(rule.note ?? '')}</p>
      </article>
    `)
    .join('');
}

function getActivityMessage(item) {
  if (item.event === 'START') return '';
  let message = String(item.message ?? '').trim();
  if (item.tx && message.includes(item.tx)) {
    message = message.replace(item.tx, '').replace(/\s*\(\s*\)\s*$/, '').replace(/\s*:\s*$/, '').trim();
  }
  return [item.label, message].filter(Boolean).join(' ');
}

function renderActivity(snapshot) {
  const items = snapshot.recentActivity || [];
  if (!items.length) {
    recentActivity.className = 'activity-list muted';
    recentActivity.textContent = 'No activity.';
    return;
  }
  recentActivity.className = 'activity-list';
  recentActivity.innerHTML = items
    .map((item) => {
      const message = getActivityMessage(item);
      return `
        <article class="activity-card">
          <h3>${escapeHtml(item.event ?? 'EVENT')}</h3>
          <p>${escapeHtml(item.timestamp ?? '')}</p>
          ${message ? `<p>${escapeHtml(message)}</p>` : ''}
          ${item.tx ? `<p>Tx: ${escapeHtml(item.tx)}</p>` : ''}
        </article>
      `;
    })
    .join('');
}

async function refreshStatus() {
  try {
    const snapshot = await window.botApi.getBotStatus();
    renderSummary(snapshot);
    renderRuleHealth(snapshot);
    renderActivity(snapshot);
  } catch (err) {
    appendLog({ timestamp: new Date().toISOString(), level: 'ERROR', message: err.message || String(err) });
  }
}

function setRunningUi(running) {
  setRunningBadge(running);
  startBtn.disabled = running;
  stopBtn.disabled = !running;
}

function setActiveTab(tabName) {
  const nextTab = tabName === 'setup' ? 'setup' : 'rental-rules';

  for (const button of tabButtons) {
    const settingsOpen = nextTab === 'setup';
    button.classList.toggle('active', settingsOpen);
    button.setAttribute('aria-selected', String(settingsOpen));
    if (button.id === 'tab-setup') {
      button.textContent = settingsOpen ? 'Rental Rules' : 'Settings';
      button.dataset.tab = settingsOpen ? 'rental-rules' : 'setup';
    }
  }

  for (const panel of tabPanels) {
    panel.classList.toggle('active', panel.dataset.panel === nextTab);
  }
}

function setupTabs() {
  for (const button of tabButtons) {
    button.addEventListener('click', () => setActiveTab(button.dataset.tab));
  }
}

addRuleRowBtn.addEventListener('click', () => createRuleRow());
saveBtn.addEventListener('click', saveSettings);
sendRpcLimiterBtn.addEventListener('click', async () => {
  sendRpcLimiterBtn.disabled = true;
  try {
    const status = await window.botApi.sendSettingsToRpcLimiter({ config: getConfigValues() });
    renderRpcLimiterStatus(status);
    appendLog({ timestamp: new Date().toISOString(), level: 'INFO', message: 'Sent settings to RPC Limiter' });
  } catch (err) {
    appendLog({ timestamp: new Date().toISOString(), level: 'ERROR', message: err.message || String(err) });
  } finally {
    sendRpcLimiterBtn.disabled = false;
  }
});
form.elements['USE_RPC_LIMITER']?.addEventListener('change', updateRpcLimiterModeTone);
startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  try {
    await saveSettings();
    appendLog({ timestamp: new Date().toISOString(), level: 'INFO', message: 'Starting bot…' });
    await window.botApi.startBot();
    appendLog({ timestamp: new Date().toISOString(), level: 'INFO', message: 'Bot start requested.' });
    setRunningUi(true);
    await refreshStatus();
  } catch (err) {
    appendLog({ timestamp: new Date().toISOString(), level: 'ERROR', message: err.message || String(err) });
    setRunningUi(false);
  } finally {
    if (stopBtn.disabled) startBtn.disabled = false;
  }
});
stopBtn.addEventListener('click', async () => {
  stopBtn.disabled = true;
  try {
    appendLog({ timestamp: new Date().toISOString(), level: 'INFO', message: 'Stopping bot…' });
    await window.botApi.stopBot();
    appendLog({ timestamp: new Date().toISOString(), level: 'INFO', message: 'Bot stopped.' });
    setRunningUi(false);
    await refreshStatus();
  } catch (err) {
    appendLog({ timestamp: new Date().toISOString(), level: 'ERROR', message: err.message || String(err) });
  } finally {
    stopBtn.disabled = false;
  }
});
toggleSensitiveBtn.addEventListener('click', () => {
  form.classList.toggle('sensitive-hidden');
  toggleSensitiveBtn.textContent = form.classList.contains('sensitive-hidden') ? 'Show Sensitive Fields' : 'Hide Sensitive Fields';
});

window.botApi.onLog((payload) => {
  appendLog(payload);
  if (/rent successful/i.test(String(payload?.message ?? ''))) {
    setTimeout(() => {
      void refreshStatus();
      void refreshRentalRulesHealth();
    }, 1000);
  }
});
window.botApi.onStatus((payload) => {
  if (typeof payload?.running === 'boolean') setRunningUi(payload.running);
});

// Auto-fill player profile from chain for the asset owner wallet.
// Use OWNER_WALLET if filled, otherwise fall back to the hot wallet.
let pendingFillTimer = null;

async function fillPlayerProfileFromWallet() {
  // Use setTimeout so that when HOT_WALLET_SECRET changes, this runs after
  // the companion OWNER_WALLET field has also been updated by the form set.
  clearTimeout(pendingFillTimer);
  pendingFillTimer = setTimeout(await _fillPlayerProfileFromWallet, 100);
}

async function _fillPlayerProfileFromWallet() {
  const ownerWallet = (form.elements['OWNER_WALLET']?.value ?? '').trim();
  let walletToQuery = ownerWallet;

  // If no asset owner filled yet, derive it from the hot wallet.
  if (!walletToQuery) {
    const secret = (form.elements['HOT_WALLET_SECRET']?.value ?? '').trim();
    if (!secret) return;
    const address = await window.botApi.getHotWalletAddress(secret);
    if (!address || address === 'Invalid hot wallet secret') return;
    walletToQuery = address;
  }

  try {
    const lookup = await window.botApi.walletLookup({ hotWalletPublicKey: walletToQuery });
    if (lookup?.playerProfile) {
      const profileInput = form.elements['OWNER_PROFILE'];
      if (profileInput && !profileInput.value.trim()) {
        profileInput.value = lookup.playerProfile;
      }
      refreshDisplayAccountsFromForm();
    }
  } catch {
    // Silently ignore lookup errors — user can still fill fields manually
  }
}

// Re-fill player profile whenever the user changes either the hot wallet or asset owner field.
form.elements['HOT_WALLET_SECRET']?.addEventListener('input', fillPlayerProfileFromWallet);
form.elements['OWNER_WALLET']?.addEventListener('input', fillPlayerProfileFromWallet);
form.elements['USE_HELIUS_SENDER']?.addEventListener('change', () => {
  syncHeliusSenderTipMinimum();
});

// Update the window title bar with the instance name.
// instanceName is synchronous (preload-set), so this runs immediately.
if (window.botApi.instanceName) {
  document.title = `Fleet Rental Bot - ${window.botApi.instanceName}`;
}

updateBtn.addEventListener('click', () => {
  setUpdateModalOpen(true);
  renderUpdateChecking();
  void checkForUpdates();
});

updateCancelBtn.addEventListener('click', () => {
  setUpdateModalOpen(false);
});

updateModal.addEventListener('click', (event) => {
  if (event.target === updateModal) {
    setUpdateModalOpen(false);
  }
});

updateConfirmBtn.addEventListener('click', async () => {
  if (!availableUpdate?.updateAvailable) return;
  updateConfirmBtn.disabled = true;
  updateCancelBtn.disabled = true;
  updateMessageEl.textContent = `Downloading Fleet Rental Bot v${availableUpdate.latestVersion} and restarting...`;

  try {
    await window.botApi.downloadUpdateAndRestart();
  } catch (err) {
    updateMessageEl.textContent = `Update failed: ${err?.message || String(err)}`;
    appendLog({ timestamp: new Date().toISOString(), level: 'ERROR', message: `Update failed: ${err?.message || String(err)}` });
    updateCancelBtn.disabled = false;
  }
});

setupTabs();
refreshAppVersion()
  .then(loadSettings)
  .then(fillPlayerProfileFromWallet)
  .then(refreshStatus)
  .catch((err) => appendLog({ timestamp: new Date().toISOString(), level: 'ERROR', message: err.message || String(err) }));
statusTimer = setInterval(refreshStatus, 10000);
rentalRulesHealthTimer = setInterval(() => {
  void refreshRentalRulesHealth().catch((err) => {
    appendLog({ timestamp: new Date().toISOString(), level: 'ERROR', message: err.message || String(err) });
  });
}, GENERAL_CHECK_INTERVAL_MS);
window.addEventListener('beforeunload', () => {
  if (statusTimer) clearInterval(statusTimer);
  if (rentalRulesHealthTimer) clearInterval(rentalRulesHealthTimer);
});
