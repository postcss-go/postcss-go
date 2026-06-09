'use strict';

process.env.TS_NODE_PROJECT = require('node:path').join(__dirname, 'tsconfig.json');
require('ts-node/register/transpile-only');
