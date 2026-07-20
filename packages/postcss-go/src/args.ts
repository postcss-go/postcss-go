import { parseArgs } from 'node:util';

export interface CliArgv {
  _: string[];
  o?: string;
  output?: string;
  d?: string;
  dir?: string;
  r?: boolean;
  replace?: boolean;
  map?: boolean | { inline: boolean };
  m?: boolean | { inline: boolean };
  w?: boolean;
  watch?: boolean;
  verbose?: boolean;
  env?: string;
  u?: string[];
  use?: string[];
  parser?: string;
  stringifier?: string;
  syntax?: string;
  ext?: string;
  base?: string;
  includeDotfiles?: boolean;
  poll?: boolean | string | number;
  config?: string;
  help?: boolean;
  engine?: unknown;
  [key: string]: unknown;
}

const HELP = `Usage:
  postcss-go [input.css] [OPTIONS] [-o|--output output.css] [--watch|-w]
  postcss-go <input.css>... [OPTIONS] --dir <output-directory> [--watch|-w]
  postcss-go <input-directory> [OPTIONS] --dir <output-directory> [--watch|-w]
  postcss-go <input-glob-pattern> [OPTIONS] --dir <output-directory> [--watch|-w]
  postcss-go <input.css>... [OPTIONS] --replace

Options:
  -o, --output <file>       Output file
  -d, --dir <directory>     Output directory
  -r, --replace             Replace (overwrite) the input file
  -m, --map                 Create an external sourcemap
      --no-map              Disable the default inline sourcemaps
  -w, --watch               Watch files for changes and recompile as needed
      --verbose             Be verbose
      --env <name>           A shortcut for setting NODE_ENV
  -u, --use <plugin>        PostCSS plugin to use (repeatable)
      --parser <module>     Custom postcss parser
      --stringifier <module> Custom postcss stringifier
      --syntax <module>     Custom postcss syntax
      --ext <extension>     Override the output file extension; for use with --dir
      --base <path>         Mirror the directory structure relative to this path in the output directory
      --include-dotfiles    Enable glob to match files/dirs that begin with "."
      --poll [milliseconds] Use polling for file watching; default 100 ms
      --config <directory>  Set a custom directory to look for a config file
  -h, --help                Show this help

If no input files are passed, it reads from stdin. If neither -o, --dir, or --replace is passed, it writes to stdout.

For more details, please see https://github.com/eryue0220/postcss-go`;

const options = {
  output: { type: 'string' as const, short: 'o' },
  dir: { type: 'string' as const, short: 'd' },
  replace: { type: 'boolean' as const, short: 'r' },
  map: { type: 'boolean' as const, short: 'm' },
  watch: { type: 'boolean' as const, short: 'w' },
  verbose: { type: 'boolean' as const },
  env: { type: 'string' as const },
  use: { type: 'string' as const, short: 'u', multiple: true },
  parser: { type: 'string' as const },
  stringifier: { type: 'string' as const },
  syntax: { type: 'string' as const },
  ext: { type: 'string' as const },
  base: { type: 'string' as const },
  'include-dotfiles': { type: 'boolean' as const },
  poll: { type: 'string' as const },
  config: { type: 'string' as const },
  help: { type: 'boolean' as const, short: 'h' },
};

function hasValue(argv: Record<string, unknown>, name: string): boolean {
  return argv[name] !== undefined;
}

function validateArgs(argv: Record<string, unknown>): void {
  const conflicts: Array<[string, string]> = [
    ['output', 'dir'],
    ['output', 'replace'],
    ['dir', 'replace'],
    ['watch', 'replace'],
  ];

  for (const [left, right] of conflicts) {
    if (hasValue(argv, left) && hasValue(argv, right)) {
      throw new Error(`Arguments ${left} and ${right} are mutually exclusive`);
    }
  }

  for (const option of ['ext', 'base']) {
    if (hasValue(argv, option) && !hasValue(argv, 'dir')) {
      throw new Error(`Argument ${option} requires dir`);
    }
  }

  if (hasValue(argv, 'poll') && !hasValue(argv, 'watch')) {
    throw new Error('Argument poll requires watch');
  }
}

function normalizePoll(argvInput: string[]): string[] {
  return argvInput.map((arg, index) => {
    if (arg === '--poll' && (!argvInput[index + 1] || argvInput[index + 1].startsWith('-'))) {
      return '--poll=100';
    }
    return arg;
  });
}

function parseArgsWithStableErrors(argvInput: string[]) {
  try {
    return parseArgs({
      args: normalizePoll(argvInput),
      options,
      allowNegative: true,
      allowPositionals: true,
      strict: true,
    });
  } catch (error: unknown) {
    if (
      error instanceof TypeError &&
      'code' in error &&
      error.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION'
    ) {
      const option = error.message.match(/Unknown option ['"]--?([^'"]+)['"]/u)?.[1];
      if (option) throw new Error(`Unknown argument: ${option}`);
    }
    throw error;
  }
}

export function parseCliArgs(argvInput: string[] = process.argv.slice(2)): CliArgv {
  const parsed = parseArgsWithStableErrors(argvInput);
  const values = parsed.values as Record<string, unknown>;
  const argv: CliArgv = {
    ...values,
    _: parsed.positionals,
    o: values.output as string | undefined,
    d: values.dir as string | undefined,
    r: values.replace as boolean | undefined,
    m: values.map as boolean | undefined,
    w: values.watch as boolean | undefined,
    u: values.use as string[] | undefined,
    includeDotfiles: values['include-dotfiles'] as boolean | undefined,
  };

  argv.output = argv.o;
  argv.dir = argv.d;
  argv.replace = argv.r;
  argv.map = values.map as boolean | undefined;
  argv.watch = argv.w;
  argv.use = argv.u;

  if (argv.ext && !argv.ext.startsWith('.')) argv.ext = `.${argv.ext}`;

  if (argv.help) {
    process.stdout.write(`${HELP}\n`);
    return argv;
  }

  validateArgs(values);
  return argv;
}
