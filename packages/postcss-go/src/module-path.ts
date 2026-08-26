import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Absolute filesystem path of the calling module.
 *
 * Prefer `__filename` in published CommonJS builds; fall back to
 * `import.meta.url` for native ESM.
 */
export function currentModulePath(metaUrl: string): string {
  return typeof __filename === 'string' && isAbsolute(__filename)
    ? __filename
    : fileURLToPath(metaUrl);
}
