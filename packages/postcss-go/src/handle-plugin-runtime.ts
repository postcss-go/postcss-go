import type { AcceptedPlugin } from './plugin-types.js';
import type { RuntimePlugin } from './plugin-runtime.js';
import { isThenable } from './errors.js';
import {
  createHandleDeclarationStub,
  HANDLE_FIELD_PROP,
  HANDLE_FIELD_VALUE,
  HandleDeclarationUnsupportedError,
  NativeHandleSession,
  type HandleDeclarationStub,
  type NativeHandleAddon,
  type NativeHandleParseOptions,
} from './handle-session.js';

const DECLARATION_ONLY_KEYS = new Set(['postcssPlugin', 'Declaration', 'postcss', 'plugins']);

const unsupportedHandleHelpers = new Proxy(Object.create(null) as Record<string, never>, {
  get(_target, key) {
    throw new HandleDeclarationUnsupportedError(`helpers.${String(key)}`);
  },
});

function isSyncFunction(value: unknown): value is (decl: HandleDeclarationStub) => unknown {
  return typeof value === 'function' && value.constructor.name !== 'AsyncFunction';
}

function isPlainDeclarationPlugin(plugin: RuntimePlugin): boolean {
  if (!isSyncFunction(plugin.Declaration)) return false;
  for (const key of Object.keys(plugin)) {
    if (!DECLARATION_ONLY_KEYS.has(key)) return false;
  }
  return true;
}

/** True when every plugin only registers synchronous Declaration visitors. */
export function isHandleDeclarationPluginRun(plugins: AcceptedPlugin[]): boolean {
  for (const plugin of plugins) {
    if (typeof plugin === 'function') return false;
    if (!isPlainDeclarationPlugin(plugin as RuntimePlugin)) return false;
  }
  return plugins.length > 0;
}

export function runHandleDeclarationPlugins(
  addon: NativeHandleAddon,
  css: string,
  plugins: AcceptedPlugin[],
): string {
  const run = runHandleDeclarationSession(addon, css, plugins);
  try {
    return run.css;
  } finally {
    run.session.close();
  }
}

/** The caller retains the owner until lazy Result.root materialization or GC. */
export function runHandleDeclarationSession(
  addon: NativeHandleAddon,
  css: string,
  plugins: AcceptedPlugin[],
  options?: NativeHandleParseOptions,
): { css: string; session: NativeHandleSession } {
  const session = new NativeHandleSession(addon);
  try {
    const root = session.parse(css, options);
    for (const handles of session.declarationBatches()) {
      const count = handles.length;
      const props = session.readFields(handles, HANDLE_FIELD_PROP);
      const values = session.readFields(handles, HANDLE_FIELD_VALUE);
      let propsChanged = false;
      let valuesChanged = false;

      for (let i = 0; i < count; i += 1) {
        const stub = createHandleDeclarationStub(props[i], values[i]);
        for (const plugin of plugins) {
          if (typeof plugin === 'function') continue;
          const visitor = (plugin as RuntimePlugin).Declaration;
          if (!isSyncFunction(visitor)) continue;
          const returned = (
            visitor as (decl: HandleDeclarationStub, helpers: unknown) => unknown
          ).call(plugin, stub, unsupportedHandleHelpers);
          if (isThenable(returned)) {
            void Promise.resolve(returned).catch(() => {});
            throw new HandleDeclarationUnsupportedError('async');
          }
        }
        if (stub.value !== values[i]) {
          values[i] = stub.value;
          valuesChanged = true;
        }
        if (stub.prop !== props[i]) {
          props[i] = stub.prop;
          propsChanged = true;
        }
      }

      if (valuesChanged) session.setFields(handles, HANDLE_FIELD_VALUE, values);
      if (propsChanged) session.setFields(handles, HANDLE_FIELD_PROP, props);
    }
    return { css: session.stringify(root), session };
  } catch (error) {
    session.close();
    throw error;
  }
}
