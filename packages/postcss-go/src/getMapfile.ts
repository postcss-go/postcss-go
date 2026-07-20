import path from 'node:path';

export interface MapOptions {
  inline?: boolean;
  annotation?: boolean | string | ((to: string | undefined, root: unknown) => string);
  absolute?: boolean;
  from?: string;
  sourcesContent?: boolean;
}

export interface ProcessFileOptions {
  from?: string;
  to?: string;
  map?: boolean | MapOptions;
  parser?: unknown;
  syntax?: unknown;
  stringifier?: unknown;
  [key: string]: unknown;
}

export default function getMapfile(options: ProcessFileOptions): string {
  if (
    options.map &&
    typeof options.map === 'object' &&
    typeof options.map.annotation === 'string'
  ) {
    return `${path.dirname(options.to ?? '')}/${options.map.annotation}`;
  }
  return `${options.to}.map`;
}
