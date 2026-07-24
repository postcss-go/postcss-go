'use strict';

process.env.TS_NODE_PROJECT = require('node:path').join(__dirname, 'tsconfig.upstream.json');
require('ts-node/register/transpile-only');
