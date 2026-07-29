import { UnsupportedSyntaxError } from './errors.js';

export interface SyntaxBearingOptions {
  parser?: unknown;
  syntax?: unknown;
  stringifier?: unknown;
}

export function hasUnsupportedSyntax(options: SyntaxBearingOptions = {}): boolean {
  return Boolean(options.parser || options.syntax || options.stringifier);
}

/**
 * Reject extension points that cannot cross a Go backend boundary.
 *
 * Canonical gate: `prepareOrchestrateOptions` / orchestrate helpers in
 * `orchestrate.ts`. Call that before any path that narrows options or crosses
 * the service bridge so custom parser/syntax/stringifier are never silently
 * dropped.
 */
export function assertSupportedSyntax(options: SyntaxBearingOptions): void {
  if (options.parser) throw new UnsupportedSyntaxError('Custom parser options');
  if (options.syntax) throw new UnsupportedSyntaxError('Custom syntax options');
  if (!options.stringifier) return;
  throw new UnsupportedSyntaxError('Custom stringifier options');
}
