'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const packageJson = require('../package.json');
const packageLock = require('../package-lock.json');
const { APP_VERSION } = require('../dist/bot');

test('package metadata, lockfile, and runtime metrics expose one release version', () => {
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages?.['']?.version, packageJson.version);
  assert.equal(APP_VERSION, packageJson.version);
});
