'use strict';

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertTrustedIpcSender(event, expectedUrl) {
  const actualUrl = event?.senderFrame?.url || '';
  if (!actualUrl || actualUrl !== expectedUrl) {
    throw new Error('Untrusted IPC sender.');
  }
}

function assertBoundedString(value, fieldName, maxLength = 20_000) {
  if (typeof value !== 'string') throw new Error(`${fieldName} must be a string.`);
  if (value.length > maxLength) throw new Error(`${fieldName} is too long.`);
}

function assertSettingsPayload(payload, allowedConfigKeys) {
  if (!isPlainObject(payload)) throw new Error('Settings payload must be an object.');
  if (Object.prototype.hasOwnProperty.call(payload, 'config')) {
    for (const key of Object.keys(payload)) {
      if (key !== 'config' && key !== 'rentalRules') {
        throw new Error(`Unknown settings payload field: ${key}`);
      }
    }
  }
  const config = payload.config ?? payload;
  if (!isPlainObject(config)) throw new Error('Settings config must be an object.');
  const allowed = new Set(allowedConfigKeys || []);
  for (const [key, value] of Object.entries(config)) {
    if (!allowed.has(key)) throw new Error(`Unknown setting: ${key}`);
    if (!['string', 'number', 'boolean'].includes(typeof value) && value != null) {
      throw new Error(`${key} must be a scalar value.`);
    }
    if (String(value ?? '').length > 20_000) throw new Error(`${key} is too long.`);
  }
  if (payload.rentalRules != null) {
    if (!Array.isArray(payload.rentalRules)) throw new Error('rentalRules must be an array.');
    if (payload.rentalRules.length > 500) throw new Error('Too many rental rules.');
    const allowedRuleKeys = new Set([
      'enabled',
      'fleetName',
      'fleetAccount',
      'rentalContract',
      'currentRentalEnd',
      'durationDays',
      'maxRentPricePerDay',
      'comment',
    ]);
    for (const [index, row] of payload.rentalRules.entries()) {
      if (!isPlainObject(row)) throw new Error(`rentalRules[${index}] must be an object.`);
      for (const [key, value] of Object.entries(row)) {
        if (!allowedRuleKeys.has(key)) throw new Error(`Unknown rental rule field: ${key}`);
        if (!['string', 'number', 'boolean'].includes(typeof value) && value != null) {
          throw new Error(`rentalRules[${index}].${key} must be a scalar value.`);
        }
        if (String(value ?? '').length > 2_000) throw new Error(`rentalRules[${index}].${key} is too long.`);
      }
    }
  }
}

function assertWalletLookupPayload(payload) {
  if (!isPlainObject(payload)) throw new Error('Wallet lookup payload must be an object.');
  assertBoundedString(payload.hotWalletPublicKey, 'hotWalletPublicKey', 128);
}

function assertWalletSecretPayload(payload) {
  if (!isPlainObject(payload)) throw new Error('Wallet secret payload must be an object.');
  assertBoundedString(payload.secret, 'secret');
}

function assertRuleResolvePayload(payload) {
  if (!isPlainObject(payload)) throw new Error('Rule resolve payload must be an object.');
  assertBoundedString(payload.fleetAccount, 'fleetAccount', 128);
  assertBoundedString(payload.rentalContract, 'rentalContract', 128);
}

module.exports = {
  assertRuleResolvePayload,
  assertSettingsPayload,
  assertTrustedIpcSender,
  assertWalletLookupPayload,
  assertWalletSecretPayload,
  isPlainObject,
};
