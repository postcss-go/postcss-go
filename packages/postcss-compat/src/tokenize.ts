import { call, errorFromPayload } from './bridge';

type Token = [string, string, ...number[]];

type TokenSnapshot = {
  tokens: Token[];
  positions: number[];
  error?: unknown;
  errorIndex?: number;
};

type TokenizerInput = {
  css: { valueOf(): string };
  file?: string;
};

type NextTokenOptions = {
  ignoreUnclosed?: boolean;
};

type TokenizerOptions = {
  ignoreErrors?: boolean;
};

// Go returns a UTF-16 token snapshot; this wrapper only preserves PostCSS's
// cursor, back-stack, and lazy error-handling contract.
function tokenizer(input: TokenizerInput, options: TokenizerOptions = {}) {
  const css = input.css.valueOf();
  let snapshot: TokenSnapshot | undefined;
  let index = 0;
  let currentPosition = 0;
  const returned: Token[] = [];

  function load() {
    snapshot = call('tokenize', {
      css,
      file: input.file || '',
      options: { ignoreErrors: Boolean(options.ignoreErrors) },
      ignoreUnclosed: false,
    }) as TokenSnapshot;
    index = 0;
    currentPosition = 0;
  }

  function positionOf(indexToRead: number) {
    if (indexToRead <= 0) return 0;
    const position = snapshot!.positions[indexToRead - 1];
    return position === undefined ? currentPosition : position;
  }

  function position() {
    return currentPosition;
  }

  function endOfFile() {
    if (!snapshot) load();
    return (
      returned.length === 0 &&
      snapshot !== undefined &&
      index >= snapshot.tokens.length &&
      !snapshot.error
    );
  }

  function nextToken(opts?: NextTokenOptions) {
    if (returned.length) return returned.pop();

    if (!snapshot) load();
    if (snapshot!.error && index === snapshot!.errorIndex) {
      if (opts && opts.ignoreUnclosed) {
        snapshot!.error = undefined;
        currentPosition = positionOf(index);
      } else {
        throw errorFromPayload(snapshot!.error);
      }
    }

    if (index >= snapshot!.tokens.length) return;
    const token = snapshot!.tokens[index++];
    currentPosition = positionOf(index);
    return token;
  }

  function back(token: Token) {
    returned.push(token);
  }

  return { back, endOfFile, nextToken, position };
}

export = tokenizer;
