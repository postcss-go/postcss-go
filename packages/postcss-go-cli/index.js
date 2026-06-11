#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'path';

import prettyHrtime from 'pretty-hrtime';
import { text } from 'stream/consumers';
import read from 'read-cache';
import pc from 'picocolors';
import { glob } from 'tinyglobby';
import slash from 'slash';
import chokidar from 'chokidar';

import postcss from 'postcss';
import postcssrc from 'postcss-load-config';
import postcssReporter from 'postcss-reporter/lib/formatter.js';

import argv from './lib/args.js';
import createDependencyGraph from './lib/DependencyGraph.js';
import getMapfile from './lib/getMapfile.js';
import { assertGoEngineCompatible, createEngine, processWithEngine } from './lib/engine.js';

const reporter = postcssReporter();
const depGraph = createDependencyGraph();
const engine = createEngine(argv);

let input = argv._;
const { dir, output } = argv;

if (argv.map) argv.map = { inline: false };

let cliConfig;

async function buildCliConfig() {
  cliConfig = {
    options: {
      map: argv.map !== undefined ? argv.map : { inline: true },
      parser: argv.parser ? await import(argv.parser) : undefined,
      syntax: argv.syntax ? await import(argv.syntax) : undefined,
      stringifier: argv.stringifier ? await import(argv.stringifier) : undefined,
    },
    plugins: argv.use
      ? await Promise.all(
          argv.use.map(async (plugin) => {
            try {
              return (await import(plugin)).default();
            } catch (e) {
              const msg = e.message || `Cannot find module '${plugin}'`;
              let prefix = msg.includes(plugin) ? '' : ` (${plugin})`;
              if (e.name && e.name !== 'Error') prefix += `: ${e.name}`;
              throw new Error(`Plugin Error${prefix}: ${msg}`, { cause: e });
            }
          }),
        )
      : [],
  };
}

let configFile;

if (argv.env) process.env.NODE_ENV = argv.env;
if (argv.config) argv.config = path.resolve(argv.config);

let { isTTY } = process.stdin;

if (process.env.FORCE_IS_TTY === 'true') {
  isTTY = true;
}

if (argv.watch && isTTY) {
  process.stdin.on('end', () => process.exit(0));
  process.stdin.resume();
}

/* istanbul ignore next */
if (parseInt(postcss().version) < 8) {
  error('Please install PostCSS 8 or above');
}

buildCliConfig()
  .then(() => {
    if (argv.watch && !(argv.output || argv.replace || argv.dir)) {
      throw new Error('Cannot write to stdout in watch mode');
    }

    if (input && input.length) {
      return glob(
        input.map((i) => slash(String(i))),
        { dot: argv.includeDotfiles },
      );
    }

    if (argv.replace || argv.dir) {
      throw new Error('Input Error: Cannot use --dir or --replace when reading from stdin');
    }

    if (argv.watch) {
      throw new Error('Input Error: Cannot run in watch mode when reading from stdin');
    }

    return ['stdin'];
  })
  .then((i) => {
    if (!i || !i.length) {
      throw new Error('Input Error: You must pass a valid list of files to parse');
    }

    if (i.length > 1 && !argv.dir && !argv.replace) {
      throw new Error('Input Error: Must use --dir or --replace with multiple input files');
    }

    if (i[0] !== 'stdin') i = i.map((i) => path.resolve(i));

    input = i;

    return files(input);
  })
  .then((results) => {
    if (argv.watch) {
      const printMessage = () => printVerbose(pc.dim('\nWaiting for file changes...'));
      const watcher = chokidar.watch(input.concat(dependencies(results)), {
        usePolling: argv.poll,
        interval: argv.poll && typeof argv.poll === 'number' ? argv.poll : 100,
        awaitWriteFinish: {
          stabilityThreshold: 50,
          pollInterval: 10,
        },
      });

      if (configFile) watcher.add(configFile);

      watcher.on('ready', printMessage).on('change', (file) => {
        let recompile = [];

        if (input.includes(file)) recompile.push(file);

        const dependants = depGraph
          .dependantsOf(file)
          .concat(getAncestorDirs(file).flatMap(depGraph.dependantsOf));

        recompile = recompile.concat(dependants.filter((file) => input.includes(file)));

        if (!recompile.length) recompile = input;

        return files([...new Set(recompile)])
          .then((results) => watcher.add(dependencies(results)))
          .then(printMessage)
          .catch(error);
      });
    }
  })
  .catch((err) => {
    error(err);
    process.exit(1);
  })
  .finally(() => {
    if (!argv.watch) {
      return engine.close();
    }
  });

if (argv.watch) {
  const closeEngine = () => {
    void engine.close();
  };
  process.on('SIGINT', closeEngine);
  process.on('SIGTERM', closeEngine);
  process.on('exit', closeEngine);
}

function rc(ctx, configPath) {
  if (argv.use) return Promise.resolve(cliConfig);

  return postcssrc(ctx, configPath)
    .then((rc) => {
      if (rc.options.from || rc.options.to) {
        throw new Error(
          'Config Error: Can not set from or to options in config file, use CLI arguments instead',
        );
      }
      configFile = rc.file;
      return rc;
    })
    .catch((err) => {
      if (!err.message.includes('No PostCSS Config found')) throw err;
    });
}

function files(files) {
  if (typeof files === 'string') files = [files];

  return Promise.all(
    files.map((file) => {
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

function css(css, file) {
  const ctx = { options: cliConfig.options };

  if (file !== 'stdin') {
    ctx.file = {
      dirname: path.dirname(file),
      basename: path.basename(file),
      extname: path.extname(file),
    };

    if (!argv.config) argv.config = path.dirname(file);
  }

  const relativePath = file !== 'stdin' ? path.relative(path.resolve(), file) : file;

  if (!argv.config) argv.config = process.cwd();

  const time = process.hrtime();

  printVerbose(pc.cyan(`Processing ${pc.bold(relativePath)}...`));

  return rc(ctx, argv.config)
    .then((config) => {
      config = config || cliConfig;
      assertGoEngineCompatible(argv, config);
      const options = { ...config.options };

      if (file === 'stdin' && output) file = output;

      options.from = file === 'stdin' ? path.join(process.cwd(), 'stdin') : file;

      if (output || dir || argv.replace) {
        const base = argv.base ? path.relative(path.resolve(argv.base), file) : path.basename(file);
        options.to = output || (argv.replace ? file : path.join(dir, base));

        if (argv.ext) {
          options.to = options.to.replace(path.extname(options.to), argv.ext);
        }

        options.to = path.resolve(options.to);
      }

      if (!options.to && config.options.map && !config.options.map.inline) {
        throw new Error('Output Error: Cannot output external sourcemaps when writing to STDOUT');
      }

      return processWithEngine(engine, config, css, options).then((result) => {
        const tasks = [];

        if (options.to) {
          tasks.push(outputFile(options.to, result.css));

          if (result.map) {
            const mapfile = getMapfile(options);
            tasks.push(outputFile(mapfile, result.map.toString()));
          }
        } else process.stdout.write(result.css, 'utf8');

        return Promise.all(tasks).then(() => {
          const prettyTime = prettyHrtime(process.hrtime(time));
          printVerbose(pc.green(`Finished ${pc.bold(relativePath)} in ${pc.bold(prettyTime)}`));

          const messages = result.warnings();
          if (messages.length) {
            console.warn(reporter({ ...result, messages }));
          }

          return result;
        });
      });
    })
    .catch((err) => {
      throw err;
    });

  async function outputFile(file, string) {
    const fileExists = await fs.access(file).then(
      () => true,
      () => false,
    );
    const currentValue = fileExists ? await fs.readFile(file, 'utf8') : null;
    if (currentValue === string) return;
    await fs.mkdir(path.dirname(file), { recursive: true });
    return fs.writeFile(file, string);
  }
}

function dependencies(results) {
  if (!Array.isArray(results)) results = [results];

  const messages = [];

  results.forEach((result) => {
    if (!Array.isArray(result.messages) || result.messages.length <= 0) return;

    result.messages
      .filter((msg) => (msg.type === 'dependency' || msg.type === 'dir-dependency' ? msg : ''))
      .map(depGraph.add)
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

function printVerbose(message) {
  if (argv.verbose) console.warn(message);
}

function error(err) {
  if (argv.verbose) console.error();

  if (typeof err === 'string') {
    console.error(pc.red(err));
  } else if (err.name === 'CssSyntaxError') {
    console.error(err.toString());
  } else {
    console.error(err);
  }

  if (argv.watch) return;
  process.exit(1);
}

function getAncestorDirs(fileOrDir) {
  const { root } = path.parse(fileOrDir);
  if (fileOrDir === root) {
    return [];
  }
  const parentDir = path.dirname(fileOrDir);
  return [parentDir, ...getAncestorDirs(parentDir)];
}
