import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { CliConfig } from './engine.js';
import type { AcceptedPlugin } from './plugin-types.js';

export interface ConfigContext {
  env?: string;
  file?: Record<string, string>;
  options?: CliConfig['options'];
  [key: string]: unknown;
}

export interface LoadedConfig extends CliConfig {
  file: string;
  options: NonNullable<CliConfig['options']>;
  plugins: AcceptedPlugin[];
}

const CONFIG_NAMES = [
  'postcss.config.js',
  'postcss.config.mjs',
  'postcss.config.cjs',
  '.postcssrc.js',
  '.postcssrc.mjs',
  '.postcssrc.cjs',
  '.postcssrc.json',
];

export async function loadConfig(
  context: ConfigContext = {},
  searchFrom = process.cwd(),
): Promise<LoadedConfig | undefined> {
  const file = await findConfig(searchFrom);
  if (!file) return undefined;
  const stat = await fs.stat(file);
  let exported: unknown;
  if (file.endsWith('.json')) {
    exported = JSON.parse(await fs.readFile(file, 'utf8'));
  } else {
    const imported = await import(`${pathToFileURL(file).href}?mtime=${stat.mtimeMs}`);
    exported = imported.default ?? imported;
  }
  if (typeof exported === 'function') {
    exported = await exported({ env: process.env.NODE_ENV, ...context });
  }
  if (!exported || typeof exported !== 'object') {
    throw new Error(
      `Config Error: ${file} must export an object or a function returning an object`,
    );
  }
  const config = exported as Record<string, unknown>;
  const { plugins: pluginConfig, ...options } = config;
  delete options.postcss;
  return {
    file,
    options: { ...(context.options ?? {}), ...options },
    plugins: await normalizeConfiguredPlugins(pluginConfig, path.dirname(file)),
  };
}

async function findConfig(searchFrom: string): Promise<string | undefined> {
  const resolved = path.resolve(searchFrom);
  const info = await fs.stat(resolved).catch(() => undefined);
  if (info?.isFile()) return resolved;
  let directory = resolved;
  while (true) {
    for (const name of CONFIG_NAMES) {
      const candidate = path.join(directory, name);
      if (
        await fs.access(candidate).then(
          () => true,
          () => false,
        )
      )
        return candidate;
    }
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

async function normalizeConfiguredPlugins(
  value: unknown,
  directory: string,
): Promise<AcceptedPlugin[]> {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean) as AcceptedPlugin[];
  if (typeof value !== 'object') {
    throw new Error('Config Error: plugins must be an array or an object');
  }
  const plugins: AcceptedPlugin[] = [];
  for (const [moduleId, pluginOptions] of Object.entries(value as Record<string, unknown>)) {
    if (pluginOptions === false) continue;
    const specifier =
      moduleId.startsWith('.') || moduleId.startsWith('/')
        ? pathToFileURL(path.resolve(directory, moduleId)).href
        : moduleId;
    const imported = await import(specifier);
    const creator = imported.default ?? imported;
    plugins.push(
      typeof creator === 'function'
        ? creator(pluginOptions === true ? undefined : pluginOptions)
        : creator,
    );
  }
  return plugins;
}
