import type { AcceptedPlugin } from './plugin-types.js';
import type { RuntimePlugin } from './plugin-runtime.js';
import { isThenable } from './errors.js';
import {
  createHandleDeclarationStub,
  HANDLE_FIELD_IMPORTANT,
  HANDLE_FIELD_PROP,
  HANDLE_FIELD_VALUE,
  HandleDeclarationUnsupportedError,
  NativeHandleSession,
  type HandleDeclarationStub,
  type HandleField,
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

/** Experimental scalar shape check; the production execution planner does not use it. */
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

/** The direct caller retains the owner until explicit close or GC. */
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
      const importants = session.readFields(handles, HANDLE_FIELD_IMPORTANT);
      for (let i = 0; i < count; i += 1) {
        const stub = createHandleDeclarationStub(props[i], values[i], importants[i] === '1');
        const patches: Array<{ field: HandleField; value: string }> = [];
        const track = new Proxy(stub, {
          get(target, key, receiver) {
            return Reflect.get(target, key, receiver);
          },
          set(target, key, next) {
            if (key === 'important') {
              const value = Boolean(next);
              if (target.important !== value) {
                target.important = value;
                patches.push({ field: HANDLE_FIELD_IMPORTANT, value: value ? '1' : '0' });
              }
              return true;
            }
            if (key === 'prop' || key === 'value') {
              const value = String(next);
              if (target[key] !== value) {
                target[key] = value;
                patches.push({
                  field: key === 'prop' ? HANDLE_FIELD_PROP : HANDLE_FIELD_VALUE,
                  value,
                });
              }
              return true;
            }
            throw new HandleDeclarationUnsupportedError(String(key));
          },
        });
        for (const plugin of plugins) {
          if (typeof plugin === 'function') continue;
          const visitor = (plugin as RuntimePlugin).Declaration;
          if (!isSyncFunction(visitor)) continue;
          try {
            const returned = (
              visitor as (decl: HandleDeclarationStub, helpers: unknown) => unknown
            ).call(plugin, track, unsupportedHandleHelpers);
            if (isThenable(returned)) {
              void Promise.resolve(returned).catch(() => {});
              throw new HandleDeclarationUnsupportedError('async');
            }
            flushDeclarationPatches(session, handles[i], patches);
          } catch (error) {
            flushDeclarationPatches(session, handles[i], patches);
            throw error;
          }
        }
      }
    }
    return { css: session.stringify(root), session };
  } catch (error) {
    session.close();
    throw error;
  }
}

function flushDeclarationPatches(
  session: NativeHandleSession,
  handle: number,
  patches: Array<{ field: HandleField; value: string }>,
): void {
  if (patches.length === 0) return;
  const queued = patches.splice(0, patches.length);
  const handles = new Uint32Array(queued.length);
  const fields = new Int32Array(queued.length);
  const values = new Array<string>(queued.length);
  for (let i = 0; i < queued.length; i++) {
    handles[i] = handle;
    fields[i] = queued[i].field;
    values[i] = queued[i].value;
  }
  session.applyPatches(handles, fields, values);
}
