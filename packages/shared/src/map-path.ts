import type { ProcessFileOptions } from './map-options.js';

/**
 * Browser-safe join of an output CSS path and a map annotation file name.
 * Matches Node `path.join(dirname(to), annotation)` for typical CSS paths.
 */
export function joinMapAnnotationPath(to: string | undefined, annotation: string): string {
  if (!to) return annotation;
  const slash = Math.max(to.lastIndexOf('/'), to.lastIndexOf('\\'));
  if (slash < 0) return annotation;
  return `${to.slice(0, slash + 1)}${annotation}`;
}

/** Normalize path separators for source-map URLs. */
export function toSourceMapPath(value: string): string {
  return value.replaceAll('\\', '/');
}

/** Resolve the external `.map` file path for CLI / engine output writing. */
export function getMapfile(options: ProcessFileOptions): string {
  if (
    options.map &&
    typeof options.map === 'object' &&
    typeof options.map.annotation === 'string'
  ) {
    return joinMapAnnotationPath(options.to, options.map.annotation);
  }
  return `${options.to ?? options.from ?? 'to.css'}.map`;
}
