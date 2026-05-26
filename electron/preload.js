const { contextBridge, ipcRenderer } = require('electron');

function getProfileName() {
  const args = process.argv.slice(1);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--profile' || arg === '--instance') return String(args[i + 1] ?? '').trim();
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

const INSTANCE_NAME = sanitizeProfileName(getProfileName());

// Set the window title synchronously before any renderer script runs,
// so there is never a flash of the generic HTML <title> value.
document.title = INSTANCE_NAME ? `Fleet Rental Bot - ${INSTANCE_NAME}` : 'Fleet Rental Bot';

contextBridge.exposeInMainWorld('botApi', {
  // Synchronous — value is available immediately from the env var
  instanceName: INSTANCE_NAME,
  getInstanceName: () => ipcRenderer.invoke('app:get-instance-name'),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdateAndRestart: () => ipcRenderer.invoke('updates:download-and-restart'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (payload) => ipcRenderer.invoke('settings:save', payload),
  startBot: () => ipcRenderer.invoke('bot:start'),
  stopBot: () => ipcRenderer.invoke('bot:stop'),
  getBotStatus: () => ipcRenderer.invoke('bot:status'),
  resolveRule: (payload) => ipcRenderer.invoke('rules:resolve', payload),
  getHotWalletAddress: (secret) => ipcRenderer.invoke('wallet:get-address', { secret }),
  walletLookup: (payload) => ipcRenderer.invoke('wallet:lookup', payload),
  onLog: (handler) => {
    const wrapped = (_event, payload) => handler(payload);
    ipcRenderer.on('bot-log', wrapped);
    return () => ipcRenderer.removeListener('bot-log', wrapped);
  },
  onStatus: (handler) => {
    const wrapped = (_event, payload) => handler(payload);
    ipcRenderer.on('bot-status', wrapped);
    return () => ipcRenderer.removeListener('bot-status', wrapped);
  },
});
