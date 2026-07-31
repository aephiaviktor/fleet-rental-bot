'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const ENCRYPTED_PREFIX = 'safeStorage:v1:';
const REDACTED_VALUE = '••••••••';
const SENSITIVE_CONFIG_KEYS = Object.freeze([
  'HOT_WALLET_SECRET',
  'AEPHIA_API_KEY',
  'RPC_URL',
  'RPC_URL_FALLBACK',
]);

function isEncryptedValue(value) {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
}

function requireSafeStorage(safeStorage) {
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function' || !safeStorage.isEncryptionAvailable()) {
    throw new Error('Electron secure storage is unavailable; refusing to persist secrets.');
  }
}

function encryptSensitiveSettings(config, safeStorage) {
  const result = { ...(config || {}) };
  for (const key of SENSITIVE_CONFIG_KEYS) {
    const value = String(result[key] ?? '');
    if (!value || isEncryptedValue(value)) continue;
    requireSafeStorage(safeStorage);
    result[key] = `${ENCRYPTED_PREFIX}${safeStorage.encryptString(value).toString('base64')}`;
  }
  return result;
}

function decryptSensitiveSettings(config, safeStorage) {
  const result = { ...(config || {}) };
  for (const key of SENSITIVE_CONFIG_KEYS) {
    const value = result[key];
    if (!isEncryptedValue(value)) continue;
    requireSafeStorage(safeStorage);
    const encrypted = Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64');
    result[key] = safeStorage.decryptString(encrypted);
  }
  return result;
}

function redactSensitiveSettings(config) {
  const result = { ...(config || {}) };
  for (const key of SENSITIVE_CONFIG_KEYS) {
    if (String(result[key] ?? '')) result[key] = REDACTED_VALUE;
  }
  return result;
}

function mergeSensitiveInput(current, incoming) {
  const result = { ...(current || {}), ...(incoming || {}) };
  for (const key of SENSITIVE_CONFIG_KEYS) {
    if (incoming?.[key] === REDACTED_VALUE) result[key] = current?.[key] ?? '';
  }
  return result;
}

async function writeJsonAtomic(fs, targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempPath, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tempPath, targetPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

module.exports = {
  ENCRYPTED_PREFIX,
  REDACTED_VALUE,
  SENSITIVE_CONFIG_KEYS,
  decryptSensitiveSettings,
  encryptSensitiveSettings,
  isEncryptedValue,
  mergeSensitiveInput,
  redactSensitiveSettings,
  writeJsonAtomic,
};
