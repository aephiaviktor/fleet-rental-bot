'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  REDACTED_VALUE,
  decryptSensitiveSettings,
  encryptSensitiveSettings,
  mergeSensitiveInput,
  redactSensitiveSettings,
  writeJsonAtomic,
} = require('../electron/secure-settings');
const {
  assertSettingsPayload,
  assertTrustedIpcSender,
  assertWalletLookupPayload,
  assertRuleResolvePayload,
} = require('../electron/security-policy');

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (buffer) => buffer.toString('utf8').replace(/^encrypted:/, ''),
  };
}

test('sensitive settings are encrypted on disk and decrypted only in the main process', () => {
  const clear = {
    HOT_WALLET_SECRET: 'wallet-secret',
    AEPHIA_API_KEY: 'aephia-secret',
    RPC_URL: 'https://rpc.example/?api-key=rpc-secret',
    OWNER_WALLET: 'public-wallet',
  };
  const stored = encryptSensitiveSettings(clear, fakeSafeStorage());

  assert.equal(stored.OWNER_WALLET, 'public-wallet');
  assert.doesNotMatch(stored.HOT_WALLET_SECRET, /wallet-secret/);
  assert.doesNotMatch(stored.AEPHIA_API_KEY, /aephia-secret/);
  assert.doesNotMatch(stored.RPC_URL, /rpc-secret/);
  assert.deepEqual(decryptSensitiveSettings(stored, fakeSafeStorage()), clear);
});

test('renderer settings are redacted and placeholder saves preserve existing secrets', () => {
  const current = { HOT_WALLET_SECRET: 'wallet-secret', AEPHIA_API_KEY: 'api-secret', OWNER_WALLET: 'owner' };
  const redacted = redactSensitiveSettings(current);

  assert.equal(redacted.HOT_WALLET_SECRET, REDACTED_VALUE);
  assert.equal(redacted.AEPHIA_API_KEY, REDACTED_VALUE);
  assert.equal(redacted.OWNER_WALLET, 'owner');
  assert.deepEqual(
    mergeSensitiveInput(current, { HOT_WALLET_SECRET: REDACTED_VALUE, AEPHIA_API_KEY: '', OWNER_WALLET: 'new-owner' }),
    { HOT_WALLET_SECRET: 'wallet-secret', AEPHIA_API_KEY: '', OWNER_WALLET: 'new-owner' },
  );
});

test('encryption refuses to persist a non-empty secret when safe storage is unavailable', () => {
  assert.throws(
    () => encryptSensitiveSettings({ HOT_WALLET_SECRET: 'secret' }, { isEncryptionAvailable: () => false }),
    /secure storage is unavailable/i,
  );
});

test('atomic JSON writes replace the target without leaving temporary files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fleet-rental-security-'));
  const target = path.join(dir, 'settings.json');
  await fs.writeFile(target, '{"old":true}', 'utf8');

  await writeJsonAtomic(fs, target, { new: true });

  assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), { new: true });
  assert.deepEqual((await fs.readdir(dir)).sort(), ['settings.json']);
  await fs.rm(dir, { recursive: true, force: true });
});

test('trusted IPC requires the exact local renderer URL', () => {
  const expected = 'file:///app/electron/renderer.html';
  assert.doesNotThrow(() => assertTrustedIpcSender({ senderFrame: { url: expected } }, expected));
  assert.throws(() => assertTrustedIpcSender({ senderFrame: { url: 'https://evil.example/' } }, expected), /untrusted ipc sender/i);
  assert.throws(() => assertTrustedIpcSender({}, expected), /untrusted ipc sender/i);
});

test('sensitive IPC payload validators reject unknown, oversized, and malformed input', () => {
  const allowed = ['HOT_WALLET_SECRET', 'OWNER_WALLET'];
  assert.doesNotThrow(() => assertSettingsPayload({ config: { OWNER_WALLET: 'owner' }, rentalRules: [] }, allowed));
  assert.throws(() => assertSettingsPayload({ config: { UNKNOWN: 'value' }, rentalRules: [] }, allowed), /unknown setting/i);
  assert.throws(() => assertSettingsPayload({ config: { OWNER_WALLET: 'owner' }, unexpected: true }, allowed), /unknown settings payload field/i);
  assert.throws(() => assertSettingsPayload({ config: { OWNER_WALLET: 'x'.repeat(20_001) }, rentalRules: [] }, allowed), /too long/i);
  assert.throws(() => assertWalletLookupPayload({ hotWalletPublicKey: 42 }), /hotWalletPublicKey/i);
  assert.throws(() => assertRuleResolvePayload({ fleetAccount: {}, rentalContract: 'contract' }), /fleetAccount/i);
});
