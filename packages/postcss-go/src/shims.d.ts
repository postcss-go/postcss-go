declare module 'postcss-import' {
  interface PostcssImportOptions {
    root?: string;
    path?: string | string[];
    skipDuplicates?: boolean;
    warnOnEmpty?: boolean;
  }

  const atImport: ((options?: PostcssImportOptions) => { postcssPlugin: string }) & {
    postcss: true;
  };
  export default atImport;
}

declare module 'pretty-hrtime' {
  export default function prettyHrtime(
    hrtime: [number, number],
    options?: { verbose?: boolean; precise?: boolean },
  ): string;
}

declare module 'read-cache' {
  interface ReadCache {
    (path: string): Promise<string | Buffer>;
    clear(): void;
  }

  const read: ReadCache;
  export default read;
}

declare module 'dependency-graph' {
  export class DepGraph<T = string> {
    addNode(name: string, data?: T): void;
    addDependency(from: string, to: string): void;
    hasNode(name: string): boolean;
    dependantsOf(name: string): string[];
  }
}
