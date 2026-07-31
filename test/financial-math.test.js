'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateFallbackRentEndsAt,
  calculateRentalPaymentBaseUnits,
  normalizePricePerDay,
} = require('../dist/bot');

test('price normalization preserves displayed rates and converts raw ATLAS units above the current threshold', () => {
  assert.equal(normalizePricePerDay(null), null);
  assert.equal(normalizePricePerDay(600), 600);
  assert.equal(normalizePricePerDay(1_000_000), 1_000_000);
  assert.equal(normalizePricePerDay(1_000_001), 0.01000001);
  assert.equal(normalizePricePerDay(60_000_000_000), 600);
});

test('rental payment uses eight ATLAS decimals, duration in days, and floors fractional base units', () => {
  assert.equal(calculateRentalPaymentBaseUnits(600, 24), 1_440_000_000_000);
  assert.equal(calculateRentalPaymentBaseUnits(0.000000019, 1), 1);
  assert.equal(calculateRentalPaymentBaseUnits(0.25, 3), 75_000_000);
});

test('fallback rental end time advances by exact 24-hour rental days', () => {
  const now = Date.parse('2026-07-31T12:00:00.000Z');
  assert.equal(calculateFallbackRentEndsAt(now, 1), '2026-08-01T12:00:00.000Z');
  assert.equal(calculateFallbackRentEndsAt(now, 24), '2026-08-24T12:00:00.000Z');
});
