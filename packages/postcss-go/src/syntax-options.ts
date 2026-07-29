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
 * Canonical gate: every PostcssGoService method asserts before serialization.
 * Also assert before any caller narrows options (drops parser/syntax/stringifier)
 * so those fields are never silently ignored — today that is plugin-runtime and
 * the CLI engine path.
 */
export function assertSupportedSyntax(options: SyntaxBearingOptions): void {
  if (options.parser) throw new UnsupportedSyntaxError('Custom parser options');
  if (options.syntax) throw new UnsupportedSyntaxError('Custom syntax options');
  if (!options.stringifier) return;
  throw new UnsupportedSyntaxError('Custom stringifier options');
}
