import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ProcessFileOptions } from 'postcss-go-shared/map-options';
import type { AcceptedPlugin } from './plugin-types.js';

/** Per-input metadata supplied to function configuration files. */
export interface ConfigFileContext {
  dirname: string;
  basename: string;
  extname: string;
}

/** Stable environment passed to a function configuration export. */
export interface ConfigContext {
  /** Effective environment. Defaults to NODE_ENV, then `development`. */
  env: string;
  /** Directory containing the configuration file. */
  cwd: string;
  file?: ConfigFileContext;
  /** CLI-derived options for the current input, before config overrides. */
  options?: ProcessFileOptions;
  [key: string]: unknown;
}

export type ConfiguredPlugins = AcceptedPlugin[] | Record<string, unknown | false>;

/**
 * Standalone postcss-go configuration contract.
 *
 * Process options may be written at the top level for PostCSS config
 * familiarity or under `options`. Top-level values win.
 */
export interface PostcssGoConfig extends ProcessFileOptions {
  plugins?: ConfiguredPlugins;
  options?: ProcessFileOptions;
}

export type PostcssGoConfigExport =
  | PostcssGoConfig
  | ((context: ConfigContext) => PostcssGoConfig | Promise<PostcssGoConfig>);

export interface LoadedConfig {
  file: string;
  options: ProcessFileOptions;
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
  context: Partial<ConfigContext> = {},
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
    exported = await exported({
      ...context,
      // Always own these: cwd is the config directory; env falls back to NODE_ENV.
      cwd: path.dirname(file),
      env: context.env ?? process.env.NODE_ENV ?? 'development',
    });
  }
  if (!exported || typeof exported !== 'object') {
    throw new Error(
      `Config Error: ${file} must export an object or a function returning an object`,
    );
  }
  const config = exported as Record<string, unknown>;
  const {
    plugins: pluginConfig,
    options: nestedOptions,
    postcss: _legacyPostcss,
    ...topLevelOptions
  } = config;
  if (
    nestedOptions !== undefined &&
    (!nestedOptions || typeof nestedOptions !== 'object' || Array.isArray(nestedOptions))
  ) {
    throw new Error('Config Error: options must be an object');
  }
  return {
    file,
    options: {
      ...(context.options ?? {}),
      ...((nestedOptions as ProcessFileOptions | undefined) ?? {}),
      ...(topLevelOptions as ProcessFileOptions),
    },
    plugins: await normalizeConfiguredPlugins(pluginConfig, path.dirname(file)),
  };
}

async function findConfig(searchFrom: string): Promise<string | undefined> {
  const resolved = path.resolve(searchFrom);
  const info = await fs.stat(resolved).catch(() => undefined);
  if (info?.isFile()) return resolved;
  // A missing start path must not walk into unrelated ancestor configs
  // (especially when the caller passed an explicit --config path).
  if (!info) return undefined;
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
    const specifier = isPathSpecifier(moduleId)
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

/**
 * True for relative, POSIX absolute, Windows drive-letter, current-drive
 * absolute (`\foo`), and UNC (`\\server\share`) paths.
 */
export function isPathSpecifier(moduleId: string): boolean {
  return (
    moduleId.startsWith('.') ||
    moduleId.startsWith('/') ||
    moduleId.startsWith('\\') ||
    /^[a-zA-Z]:[\\/]/.test(moduleId)
  );
}
