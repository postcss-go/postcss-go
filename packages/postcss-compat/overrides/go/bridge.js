'use strict';
/* eslint-disable @typescript-eslint/no-require-imports */

const path = require('node:path');

const clientPath = process.env.POSTCSS_GO_COMPAT_BRIDGE_CLIENT;
if (!clientPath) {
  throw new Error('POSTCSS_GO_COMPAT_BRIDGE_CLIENT is required in Go compat mode');
}

const { callSync } = require(path.resolve(clientPath));

module.exports = {
  call(method, params) {
    return callSync(method, params);
  },
};
