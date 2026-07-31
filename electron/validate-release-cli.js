'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { validateReleaseTree } = require('./release-validation');

validateReleaseTree(fs, path.resolve(__dirname, '..'), { platform: process.platform })
  .then(({ appVersion, rpcLimiterVersion }) => {
    process.stdout.write(`Fleet Rental Bot ${appVersion}; RPC Limiter ${rpcLimiterVersion}; release tree valid.\n`);
  })
  .catch((error) => {
    process.stderr.write(`${error?.message || String(error)}\n`);
    process.exitCode = 1;
  });
