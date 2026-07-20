import path from 'path';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export default function (
  args: string[],
  cwd = packageRoot,
  options: {
    env?: NodeJS.ProcessEnv;
    stdin?: string;
    timeout?: number;
  } = {},
) {
  const { env, stdin, timeout } = options;
  return new Promise<{
    code: number;
    error: Error | null;
    stdout: string;
    stderr: string;
  }>((resolve) => {
    const child = execFile(
      process.execPath,
      [path.join(packageRoot, 'bin/postcss-go.js'), ...args],
      {
        cwd,
        env: env ? { ...process.env, ...env } : process.env,
        timeout,
      },
      (error, stdout, stderr) => {
        resolve({
          code: error && error.code ? Number(error.code) : 0,
          error: error as Error | null,
          stdout,
          stderr,
        });
      },
    );
    if (stdin !== undefined) {
      child.stdin?.end(stdin);
    }
  });
}
