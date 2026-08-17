import { materializePreviousMap } from '@postcss-go/shared/map-options';

import { AtRule, Comment, Declaration, Root, Rule } from './ast.js';
import { CssSyntaxError, positionAt } from './errors.js';
import { attachPreviousMap, Input } from './input.js';
import type { ProcessOptions, SourceLocation } from './types.js';

type Parent = Root | Rule | AtRule;

/**
 * Browser-compatible synchronous parser used where no native sync runtime can
 * exist (notably the Worker-only WASM entry). The Node entry injects Go/native
 * parsing for AST string insertion and plugin helpers.
 */
export function parseOwnedSync(
  cssInput: string | { toString(): string },
  options: ProcessOptions = {},
): Root {
  options = materializePreviousMap(options);
  const css = String(cssInput);
  const input = new Input(css, options);
  const root = new Root();
  const stack: Parent[] = [root];
  let index = 0;
  let pending = '';

  const location = (start: number, end: number): SourceLocation => ({
    start: positionAt(css, start),
    end: positionAt(css, Math.max(start, end)),
    ...(options.from ? { file: options.from } : {}),
    input,
  });
  const fail = (message: string, offset = index): never => {
    const point = positionAt(css, offset);
    throw new CssSyntaxError(message, {
      file: options.from,
      input,
      source: css,
      line: point.line,
      column: point.column,
    });
  };
  const parent = (): Parent => stack[stack.length - 1];
  const append = (node: Comment | Declaration | Rule | AtRule): void => {
    parent().append(node);
  };

  while (index < css.length) {
    const whitespaceStart = index;
    while (index < css.length && /\s/.test(css[index])) index += 1;
    pending += css.slice(whitespaceStart, index);
    if (index >= css.length) break;

    if (css.startsWith('/*', index)) {
      const start = index;
      const close = css.indexOf('*/', index + 2);
      if (close === -1) fail('Unclosed comment', start);
      const body = css.slice(index + 2, close);
      const left = body.match(/^\s*/)?.[0] ?? '';
      const right = left.length === body.length ? '' : (body.match(/\s*$/)?.[0] ?? '');
      append(
        new Comment({
          text: body.slice(left.length, body.length - right.length),
          raws: { before: pending, left, right },
          source: location(start, close + 2),
        }),
      );
      pending = '';
      index = close + 2;
      continue;
    }

    if (css[index] === '}') {
      if (stack.length === 1) fail('Unexpected }');
      const closing = stack.pop()!;
      closing.raws.after = pending;
      pending = '';
      index += 1;
      if (closing.source) {
        // Match PostCSS: end.column is inclusive of `}`, end.offset is exclusive.
        const endExclusive = index;
        const endInclusive = positionAt(css, Math.max(0, endExclusive - 1));
        closing.source.end = {
          line: endInclusive.line,
          column: endInclusive.column,
          offset: endExclusive,
        };
      }
      continue;
    }

    const start = index;
    const boundary = scanBoundary(css, index);
    if (!boundary) {
      const tail = css.slice(index);
      if (tail.trim()) {
        parseStatement(tail, start, false);
        parent().raws.semicolon = false;
      }
      index = css.length;
      continue;
    }
    const head = css.slice(index, boundary.index);
    index = boundary.index + 1;

    if (boundary.char === '{') {
      const { value, trailing } = trimEnd(head);
      if (!value.trim()) fail('Unexpected {', start);
      if (value.trimStart().startsWith('@')) {
        const parsed = parseAtRuleHeader(value.trimStart().slice(1));
        const node = new AtRule({
          name: parsed.name,
          params: parsed.params,
          block: true,
          nodes: [],
          raws: {
            before: pending,
            afterName: parsed.afterName,
            between: trailing,
          },
          source: location(start, index),
        });
        append(node);
        stack.push(node);
      } else {
        const leadingLength = value.length - value.trimStart().length;
        const node = new Rule({
          selector: value.trim(),
          raws: { before: pending, between: trailing },
          source: location(start + leadingLength, index),
        });
        append(node);
        stack.push(node);
      }
      pending = '';
      continue;
    }

    if (boundary.char === ';') {
      parseStatement(head, start, true);
      parent().raws.semicolon = true;
      continue;
    }

    // A closing brace also terminates a final declaration/at-rule.
    if (head.trim()) {
      parseStatement(head, start, false);
      parent().raws.semicolon = false;
    }
    if (stack.length === 1) fail('Unexpected }', boundary.index);
    const closing = stack.pop()!;
    closing.raws.after = pending;
    pending = '';
    if (closing.source) closing.source.end = positionAt(css, index);
  }

  if (stack.length > 1) {
    const open = stack.at(-1)!;
    fail('Unclosed block', open.source?.start.offset ?? css.length);
  }
  root.raws.after = pending;
  root.source = location(0, css.length);
  attachPreviousMap(input, css, options);
  return root;

  function parseStatement(statement: string, offset: number, terminated: boolean): void {
    const { value, trailing } = trimEnd(statement);
    const leading = value.match(/^\s*/)?.[0] ?? '';
    const clean = value.slice(leading.length);
    if (!clean) {
      pending += statement + (terminated ? ';' : '');
      return;
    }
    if (clean.startsWith('@')) {
      const parsed = parseAtRuleHeader(clean.slice(1));
      append(
        new AtRule({
          name: parsed.name,
          params: parsed.params,
          raws: {
            before: pending + leading,
            afterName: parsed.afterName,
            between: trailing,
          },
          source: location(offset + leading.length, offset + statement.length + Number(terminated)),
        }),
      );
      pending = '';
      return;
    }
    const colon = findTopLevelColon(clean);
    if (colon === -1) fail('Unknown word', offset + leading.length);
    const propertyPart = clean.slice(0, colon);
    const property = propertyPart.trim();
    if (!property) fail('Missing declaration property', offset + leading.length);
    const afterProperty = propertyPart.slice(propertyPart.trimEnd().length);
    const rawValue = clean.slice(colon + 1);
    const valueLeading = rawValue.match(/^\s*/)?.[0] ?? '';
    let declarationValue = rawValue.slice(valueLeading.length).trimEnd();
    let important = false;
    let importantRaw: string | undefined;
    const importantMatch = declarationValue.match(/(\s*!\s*important)\s*$/i);
    if (importantMatch) {
      important = true;
      importantRaw = importantMatch[1];
      declarationValue = declarationValue.slice(0, -importantMatch[0].length);
    }
    const declStart = offset + leading.length;
    const declEndExclusive = declStart + clean.length + Number(terminated);
    const endPosition = positionAt(css, Math.max(declStart, declEndExclusive - 1));
    append(
      new Declaration({
        prop: property,
        value: declarationValue,
        important,
        raws: {
          before: pending + leading,
          between: `${afterProperty}:${valueLeading}`,
          ...(importantRaw ? { important: importantRaw } : {}),
        },
        source: {
          start: positionAt(css, declStart),
          // Match PostCSS: end.column is inclusive, end.offset is exclusive.
          end: { line: endPosition.line, column: endPosition.column, offset: declEndExclusive },
          ...(options.from ? { file: options.from } : {}),
          input,
        },
      }),
    );
    pending = trailing;
  }
}

function trimEnd(value: string): { value: string; trailing: string } {
  const trailing = value.match(/\s*$/)?.[0] ?? '';
  return { value: value.slice(0, value.length - trailing.length), trailing };
}

function parseAtRuleHeader(value: string): {
  name: string;
  params: string;
  afterName: string;
} {
  const match = value.match(/^([^\s({;"']+)(\s*)([\s\S]*)$/);
  if (!match) return { name: value, params: '', afterName: '' };
  return { name: match[1], afterName: match[2], params: match[3].trimEnd() };
}

function findTopLevelColon(value: string): number {
  let quote = '';
  let depth = 0;
  let escaped = false;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (escaped) escaped = false;
    else if (char === '\\') escaped = true;
    else if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    else if (char === ':' && depth === 0) return index;
  }
  return -1;
}

function scanBoundary(css: string, from: number): { index: number; char: '{' | '}' | ';' } | null {
  let quote = '';
  let round = 0;
  let square = 0;
  let escaped = false;
  for (let index = from; index < css.length; index++) {
    const char = css[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (css.startsWith('/*', index)) {
      const close = css.indexOf('*/', index + 2);
      if (close === -1) return null;
      index = close + 1;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(') round += 1;
    else if (char === ')') round = Math.max(0, round - 1);
    else if (char === '[') square += 1;
    else if (char === ']') square = Math.max(0, square - 1);
    else if (round === 0 && square === 0 && (char === '{' || char === '}' || char === ';')) {
      return { index, char };
    }
  }
  return null;
}

export type Parser = typeof parseOwnedSync;
