"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.call = call;
exports.errorFromPayload = errorFromPayload;
const node_path_1 = __importDefault(require("node:path"));
const clientPath = process.env.POSTCSS_GO_COMPAT_BRIDGE_CLIENT;
if (!clientPath) {
    throw new Error('POSTCSS_GO_COMPAT_BRIDGE_CLIENT is required in Go compat mode');
}
const { callSync, createError } = require(node_path_1.default.resolve(clientPath));
function call(method, params) {
    return callSync(method, params);
}
function errorFromPayload(payload) {
    return createError(payload);
}
