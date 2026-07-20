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

declare module 'postcss-reporter/lib/formatter.js' {
  export default function formatter(): (result: {
    messages: Array<{ type?: string; text?: string; toString?: () => string }>;
    css?: string;
  }) => string;
}

declare module 'dependency-graph' {
  export class DepGraph<T = string> {
    addNode(name: string, data?: T): void;
    addDependency(from: string, to: string): void;
    hasNode(name: string): boolean;
    dependantsOf(name: string): string[];
  }
}

declare module 'postcss-load-config' {
  interface ConfigContext {
    env?: string;
    file?: Record<string, string>;
    options?: Record<string, unknown>;
    [key: string]: unknown;
  }

  interface Result {
    file?: string;
    options: Record<string, unknown>;
    plugins: unknown[];
  }

  export default function postcssrc(ctx?: ConfigContext, path?: string): Promise<Result>;
}
