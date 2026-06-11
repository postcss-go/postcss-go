import path from 'path';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export default function (args, cwd = packageRoot, options = {}) {
  const { env, stdin, timeout } = options;
  return new Promise((resolve) => {
    const child = exec(
      `node ${path.join(packageRoot, 'index.js')} ${args.join(' ')}`,
      {
        cwd,
        env: env ? { ...process.env, ...env } : process.env,
        timeout,
      },
      (error, stdout, stderr) => {
        resolve({
          code: error && error.code ? error.code : 0,
          error,
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
