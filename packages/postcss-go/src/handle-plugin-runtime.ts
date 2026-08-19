import type { AcceptedPlugin } from './plugin-types.js';
import type { RuntimePlugin } from './plugin-runtime.js';
import {
  createHandleDeclarationStub,
  HANDLE_FIELD_PROP,
  HANDLE_FIELD_VALUE,
  NativeHandleSession,
  type HandleDeclarationStub,
  type NativeHandleAddon,
} from './handle-session.js';

const DECLARATION_ONLY_KEYS = new Set([
  'postcssPlugin',
  'Declaration',
  'DeclarationExit',
  'prepare',
  'postcss',
  'plugins',
]);

function isPlainDeclarationPlugin(plugin: RuntimePlugin): boolean {
  if (typeof plugin.Declaration !== 'function') return false;
  for (const key of Object.keys(plugin)) {
    if (!DECLARATION_ONLY_KEYS.has(key)) return false;
  }
  return true;
}

/** True when every plugin only registers Declaration visitors. */
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
  const session = new NativeHandleSession(addon);
  try {
    const root = session.parse(css);
    const count = session.cursorWalkDecls(root);
    if (count === 0) return session.stringify(root);
    const handles = session.walkBuffer.subarray(0, count);
    const props = session.readFields(handles, HANDLE_FIELD_PROP);
    let values = session.readFields(handles, HANDLE_FIELD_VALUE);
    let propsChanged = false;

    for (const plugin of plugins) {
      if (typeof plugin === 'function') continue;
      const visitor = (plugin as RuntimePlugin).Declaration;
      if (typeof visitor !== 'function') continue;
      for (let i = 0; i < count; i += 1) {
        const stub = createHandleDeclarationStub(props[i], values[i]);
        (visitor as unknown as (decl: HandleDeclarationStub) => void).call(plugin, stub);
        if (stub.value !== values[i]) values[i] = stub.value;
        if (stub.prop !== props[i]) {
          props[i] = stub.prop;
          propsChanged = true;
        }
      }
    }

    session.setFields(handles, HANDLE_FIELD_VALUE, values);
    if (propsChanged) session.setFields(handles, HANDLE_FIELD_PROP, props);
    return session.stringify(root);
  } finally {
    session.close();
  }
}
