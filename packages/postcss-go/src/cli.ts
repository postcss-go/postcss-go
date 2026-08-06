import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { text } from 'node:stream/consumers';

import chokidar from 'chokidar';
import pc from 'picocolors';
import prettyHrtime from 'pretty-hrtime';
import read from 'read-cache';
import slash from 'slash';
import { glob } from 'tinyglobby';

import { parseCliArgs } from './args.js';
import createDependencyGraph, { type GraphMessage } from './create-dependency-graph.js';
import { isExternalSourceMap } from '@postcss-go/shared/map-options';
import { getMapfile } from '@postcss-go/shared/map-path';
import {
  createGoEngine,
  getEffectiveMapOption,
  processWithGoEngine,
  type CliConfig,
  type CliProcessResult,
} from './engine.js';
import { UnsupportedSyntaxError } from './errors.js';
import { getPollInterval, usePolling } from './poll.js';
import { loadConfig, isPathSpecifier } from './config.js';
import { formatWarnings } from './reporter.js';

export async function runCLI(argvInput: string[] = process.argv.slice(2)): Promise<void> {
  const argv = parseCliArgs(argvInput);
  if (argv.help) return;
  const depGraph = createDependencyGraph();
  const engine = createGoEngine();
  printVerbose(pc.dim(`Backend: ${engine.backend} (native addon available)`));
  const explicitConfigPath = argv.config ? path.resolve(argv.config) : null;
  const cliMapExplicit = argv.map !== undefined;

  let input: string[] = argv._.map(String);
  const { dir, output } = argv;

  if (argv.map) argv.map = { inline: false };

  let cliConfig: CliConfig;
  let watcher: chokidar.FSWatcher | undefined;

  async function buildCliConfig(): Promise<void> {
    // Reject before importing modules so custom syntax never runs side effects.
    if (argv.parser) throw new UnsupportedSyntaxError('Custom parser options');
    if (argv.syntax) throw new UnsupportedSyntaxError('Custom syntax options');
    if (argv.stringifier) throw new UnsupportedSyntaxError('Custom stringifier options');

    cliConfig = {
      options: {
        map: cliMapExplicit ? argv.map : { inline: true },
      },
      plugins: argv.use
        ? await Promise.all(
            argv.use.map(async (plugin) => {
              try {
                const imported = await import(toImportSpecifier(String(plugin)));
                const creator = imported.default ?? imported;
                return typeof creator === 'function' ? creator() : creator;
              } catch (e) {
                const err = e as Error & { name?: string };
                const msg = err.message || `Cannot find module '${plugin}'`;
                let prefix = msg.includes(String(plugin)) ? '' : ` (${plugin})`;
                if (err.name && err.name !== 'Error') prefix += `: ${err.name}`;
                throw new Error(`Plugin Error${prefix}: ${msg}`, { cause: e });
              }
            }),
          )
        : [],
    };
  }

  function toImportSpecifier(moduleId: string): string {
    if (!isPathSpecifier(moduleId)) return moduleId;
    return pathToFileURL(path.resolve(moduleId)).href;
  }

  const configFiles = new Set<string>();

  if (argv.env) process.env.NODE_ENV = argv.env;

  let { isTTY } = process.stdin;

  if (process.env.FORCE_IS_TTY === 'true') {
    isTTY = true;
  }

  let shuttingDown = false;
  const shutdown = async (exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      if (watcher && typeof watcher.close === 'function') {
        await watcher.close();
      }
      await engine.close();
    } finally {
      process.exit(exitCode);
    }
  };

  if (argv.watch) {
    // Installing signal listeners removes Node's default exit behavior, so the
    // handlers must close the engine and exit explicitly.
    process.on('SIGINT', () => {
      void shutdown(0);
    });
    process.on('SIGTERM', () => {
      void shutdown(0);
    });
  }

  if (argv.watch && isTTY) {
    process.stdin.on('end', () => {
      void shutdown(0);
    });
    process.stdin.resume();
  }

  function rc(
    ctx: {
      options?: CliConfig['options'];
      file?: { dirname: string; basename: string; extname: string };
    },
    configPath: string,
  ): Promise<CliConfig | undefined> {
    return loadConfig(ctx, configPath).then((loaded) => {
      if (!loaded) {
        if (explicitConfigPath) {
          throw new Error(
            `Config Error: Could not find a config file at or above ${explicitConfigPath}`,
          );
        }
        return undefined;
      }
      if (loaded.options.from || loaded.options.to) {
        throw new Error(
          'Config Error: Can not set from or to options in config file, use CLI arguments instead',
        );
      }
      if (loaded.file) configFiles.add(loaded.file);
      // `--use` replaces config plugins only; map and other options still apply.
      if (argv.use) {
        return {
          options: loaded.options,
          plugins: cliConfig.plugins,
        };
      }
      return loaded;
    });
  }

  function files(fileList: string | string[]): Promise<CliProcessResult[]> {
    if (typeof fileList === 'string') fileList = [fileList];

    return Promise.all(
      fileList.map((file) => {
        if (file === 'stdin') {
          return text(process.stdin).then((content) => {
            if (!content) throw new Error('Input Error: Did not receive any STDIN');
            return css(content, 'stdin');
          });
        }

        return read(file).then((content) =>
          css(typeof content === 'string' ? content : content.toString('utf8'), file),
        );
      }),
    );
  }

  function css(cssText: string, file: string): Promise<CliProcessResult> {
    const ctx: {
      options?: CliConfig['options'];
      file?: { dirname: string; basename: string; extname: string };
    } = {
      options: cliConfig.options,
    };

    if (file !== 'stdin') {
      ctx.file = {
        dirname: path.dirname(file),
        basename: path.basename(file),
        extname: path.extname(file),
      };
    }

    const relativePath = file !== 'stdin' ? path.relative(path.resolve(), file) : file;
    const configSearchPath =
      explicitConfigPath || (file !== 'stdin' ? path.dirname(file) : process.cwd());

    const time = process.hrtime();

    printVerbose(pc.cyan(`Processing ${pc.bold(relativePath)}...`));

    return rc(ctx, configSearchPath)
      .then((config) => {
        const activeConfig: CliConfig = {
          ...(config || cliConfig),
          plugins: argv.use ? cliConfig.plugins : (config || cliConfig).plugins,
          options: {
            ...(config || cliConfig).options,
            // Explicit `--map` / `--no-map` always win over config map settings.
            ...(cliMapExplicit ? { map: cliConfig.options?.map } : {}),
          },
        };
        const options = { ...activeConfig.options };
        if (options.map === undefined) {
          options.map = getEffectiveMapOption(activeConfig);
        }

        options.from = file === 'stdin' ? path.join(process.cwd(), 'stdin') : file;

        if (output || dir || argv.replace) {
          const toBase = file === 'stdin' && output ? output : file;
          const base = argv.base
            ? path.relative(path.resolve(argv.base), toBase)
            : path.basename(toBase);
          options.to = output || (argv.replace ? file : path.join(dir as string, base));

          if (argv.ext) {
            options.to = replaceOutputExtension(options.to, argv.ext);
          }

          options.to = path.resolve(options.to);
        }

        if (!options.to && isExternalSourceMap(getEffectiveMapOption(activeConfig))) {
          throw new Error('Output Error: Cannot output external sourcemaps when writing to STDOUT');
        }

        return processWithGoEngine(engine, activeConfig, cssText, options).then((result) => {
          // mapAuto / mapInlineAuto may only become external after Go loads a
          // previous map, so also guard on the concrete result payload.
          if (!options.to && result.map) {
            throw new Error(
              'Output Error: Cannot output external sourcemaps when writing to STDOUT',
            );
          }

          const parent = options.from;
          for (const message of result.messages) {
            if (
              (message.type === 'dependency' || message.type === 'dir-dependency') &&
              typeof message.parent !== 'string'
            ) {
              message.parent = parent;
            }
          }

          const tasks: Array<Promise<void>> = [];

          if (options.to) {
            tasks.push(outputFile(options.to, result.css));

            if (result.map) {
              const mapfile = result.mapFile || getMapfile(options);
              tasks.push(outputFile(mapfile, result.map.toString()));
            }
          } else process.stdout.write(result.css, 'utf8');

          return Promise.all(tasks).then(() => {
            const prettyTime = prettyHrtime(process.hrtime(time));
            printVerbose(pc.green(`Finished ${pc.bold(relativePath)} in ${pc.bold(prettyTime)}`));
            printVerbose(pc.dim(`Backend: ${result.backend}`));

            const messages = result.warnings();
            if (messages.length) {
              console.warn(
                formatWarnings({
                  ...result,
                  messages: messages as Array<{
                    type?: string;
                    text?: string;
                    toString?: () => string;
                  }>,
                }),
              );
            }

            return result;
          });
        });
      })
      .catch((err: unknown) => {
        throw err;
      });
  }

  async function outputFile(file: string, string: string): Promise<void> {
    const fileExists = await fs.access(file).then(
      () => true,
      () => false,
    );
    const currentValue = fileExists ? await fs.readFile(file, 'utf8') : null;
    if (currentValue === string) return;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, string);
  }

  function dependencies(results: CliProcessResult | CliProcessResult[]): string[] {
    if (!Array.isArray(results)) results = [results];

    const messages: string[] = [];

    results.forEach((result) => {
      if (!Array.isArray(result.messages) || result.messages.length <= 0) return;

      result.messages
        .filter((msg) => msg.type === 'dependency' || msg.type === 'dir-dependency')
        .map((msg) => depGraph.add(msg as GraphMessage))
        .forEach((dependency) => {
          if (dependency.type === 'dir-dependency') {
            messages.push(
              dependency.glob ? path.join(dependency.dir, dependency.glob) : dependency.dir,
            );
          } else {
            messages.push(dependency.file);
          }
        });
    });

    return messages;
  }

  function printVerbose(message: string): void {
    if (argv.verbose) console.warn(message);
  }

  function error(err: unknown): void {
    if (argv.verbose) console.error();

    if (typeof err === 'string') {
      console.error(pc.red(err));
    } else if (err && typeof err === 'object' && 'name' in err && err.name === 'CssSyntaxError') {
      console.error(String(err));
    } else {
      console.error(err);
    }

    if (argv.watch) return;
    process.exit(1);
  }

  function getAncestorDirs(fileOrDir: string): string[] {
    const { root } = path.parse(fileOrDir);
    if (fileOrDir === root) {
      return [];
    }
    const parentDir = path.dirname(fileOrDir);
    // path.dirname('.') === '.' and path.dirname('') === '.'; stop before looping.
    if (parentDir === fileOrDir) {
      return [];
    }
    return [parentDir, ...getAncestorDirs(parentDir)];
  }

  try {
    await buildCliConfig();

    if (argv.watch && !(argv.output || argv.replace || argv.dir)) {
      throw new Error('Cannot write to stdout in watch mode');
    }

    let resolvedInputs: string[];
    if (input && input.length) {
      resolvedInputs = await glob(
        input.map((i) => slash(String(i))),
        { dot: argv.includeDotfiles },
      );
    } else {
      if (argv.replace || argv.dir) {
        throw new Error('Input Error: Cannot use --dir or --replace when reading from stdin');
      }

      if (argv.watch) {
        throw new Error('Input Error: Cannot run in watch mode when reading from stdin');
      }

      resolvedInputs = ['stdin'];
    }

    if (!resolvedInputs || !resolvedInputs.length) {
      throw new Error('Input Error: You must pass a valid list of files to parse');
    }

    if (resolvedInputs.length > 1 && !argv.dir && !argv.replace) {
      throw new Error('Input Error: Must use --dir or --replace with multiple input files');
    }

    if (resolvedInputs[0] !== 'stdin') {
      resolvedInputs = resolvedInputs.map((entry) => path.resolve(entry));
    }

    input = resolvedInputs;
    const inputKeys = new Set(input.map(watchKey));

    const results = await files(input);

    if (argv.watch) {
      const printMessage = () => printVerbose(pc.dim('\nWaiting for file changes...'));
      watcher = chokidar.watch(input.concat(dependencies(results)), {
        usePolling: usePolling(argv.poll),
        interval: getPollInterval(argv.poll),
        awaitWriteFinish: {
          stabilityThreshold: 50,
          pollInterval: 10,
        },
      });

      watcher.add([...configFiles]);

      watcher.on('ready', printMessage).on('change', (file) => {
        read.clear();

        let recompile: string[] = [];
        const changedKey = watchKey(file);

        if (inputKeys.has(changedKey)) {
          const matched = input.find((entry) => watchKey(entry) === changedKey);
          if (matched) recompile.push(matched);
        }

        const dependants = depGraph
          .dependantsOf(file)
          .concat(getAncestorDirs(file).flatMap((dirName) => depGraph.dependantsOf(dirName)));

        recompile = recompile.concat(
          dependants.filter((entry) => inputKeys.has(watchKey(entry))),
        );

        if (!recompile.length) recompile = input;

        return files([...new Set(recompile)])
          .then((nextResults) => watcher?.add(dependencies(nextResults)))
          .then(printMessage)
          .catch(error);
      });
    }
  } catch (err: unknown) {
    error(err);
    if (argv.watch) {
      // error() does not exit in watch mode; shut down the engine explicitly.
      await shutdown(1);
      return;
    }
    process.exit(1);
  } finally {
    if (!argv.watch && !shuttingDown) {
      await engine.close();
    }
  }
}

/** Replace or append an extension without corrupting extensionless basenames. */
export function replaceOutputExtension(filePath: string, ext: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}${ext}`);
}

/** Normalize watch paths so Windows slash/casing variants still match inputs. */
export function watchKey(file: string): string {
  const normalized = path.normalize(path.resolve(file));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
