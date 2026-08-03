'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ATLAS_MINT,
  DEFAULT_SRSLY_PROGRAM_ID,
  RENTAL_FEE_WALLET,
  buildBotConfig,
  getEditableConfigFromEnv,
  parseRentalRule,
  parseRentalRules,
} = require('../dist/bot');

const validRule = {
  fleetName: '  Finch Fleet  ',
  fleetAccount: ATLAS_MINT,
  rentalContract: RENTAL_FEE_WALLET,
  durationDays: '7',
  maxRentPricePerDay: '123.45',
  comment: '  renew this fleet  ',
};

test('editable defaults preserve the current safe startup policy', () => {
  const config = getEditableConfigFromEnv();

  assert.equal(config.RPC_URL, 'https://api.mainnet-beta.solana.com');
  assert.equal(config.RPC_URL_FALLBACK, '');
  assert.equal(config.USE_HELIUS_SENDER, 'false');
  assert.equal(config.DRY_RUN, 'true');
});

test('rental rule parsing trims labels, preserves numeric values, and defaults enabled', () => {
  const parsed = parseRentalRule(validRule);

  assert.deepEqual(parsed, {
    fleetName: 'Finch Fleet',
    fleetAccount: ATLAS_MINT,
    rentalContract: RENTAL_FEE_WALLET,
    durationDays: 7,
    maxRentPricePerDay: 123.45,
    comment: 'renew this fleet',
    enabled: true,
  });
});

test('rental rule list ignores blank and disabled rows without renumbering validation errors', () => {
  const parsed = parseRentalRules([
    {},
    { ...validRule, enabled: false },
    validRule,
  ]);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].fleetName, 'Finch Fleet');

  assert.throws(
    () => parseRentalRules([{}, { ...validRule, maxRentPricePerDay: '0' }]),
    /rentalRules\[1\]\.maxRentPricePerDay must be a positive number/,
  );
});

test('legacy durationHours is interpreted by the current parser and the 24-day cap is enforced', () => {
  assert.equal(parseRentalRule({ ...validRule, durationDays: undefined, durationHours: '12' }).durationDays, 12);
  assert.throws(() => parseRentalRule({ ...validRule, durationDays: '25' }), /durationDays must be <= 24/);
});

test('bot config supports independent main and fallback RPC slots', () => {
  const base = {
    HOT_WALLET_SECRET: 'characterization-only',
    SRSLY_PROGRAM_ID: DEFAULT_SRSLY_PROGRAM_ID,
    OWNER_WALLET: ATLAS_MINT,
    OWNER_PROFILE: RENTAL_FEE_WALLET,
    DRY_RUN: 'false',
    rentalRules: [validRule],
  };

  const both = buildBotConfig({ ...base, RPC_URL: ' https://main.example ', RPC_URL_FALLBACK: ' https://fallback.example ' });
  assert.equal(both.rpcUrl, 'https://main.example');
  assert.equal(both.rpcUrlFallback, 'https://fallback.example');

  const fallbackOnly = buildBotConfig({ ...base, RPC_URL: '', RPC_URL_FALLBACK: 'https://fallback.example' });
  assert.equal(fallbackOnly.rpcUrl, 'https://fallback.example');
  assert.equal(fallbackOnly.rpcUrlFallback, undefined);

  assert.throws(
    () => buildBotConfig({ ...base, RPC_URL: '', RPC_URL_FALLBACK: '' }),
    /at least one of RPC_URL or RPC_URL_FALLBACK/,
  );
  assert.equal(both.dryRun, false);
  assert.equal(both.rentalRules.length, 1);
});

test('Helius Sender currently disables normal transaction submission and enforces its minimum tip', () => {
  const base = {
    HOT_WALLET_SECRET: 'characterization-only',
    SRSLY_PROGRAM_ID: DEFAULT_SRSLY_PROGRAM_ID,
    OWNER_WALLET: ATLAS_MINT,
    OWNER_PROFILE: RENTAL_FEE_WALLET,
    USE_HELIUS_SENDER: 'true',
  };

  assert.throws(
    () => buildBotConfig({ ...base, HELIUS_SENDER_TIP_SOL: '0.0001' }),
    /HELIUS_SENDER_TIP_SOL must be >= 0.0002 SOL/,
  );
  assert.equal(buildBotConfig({ ...base, HELIUS_SENDER_TIP_SOL: '0.0002' }).useNormalTxs, false);
});
