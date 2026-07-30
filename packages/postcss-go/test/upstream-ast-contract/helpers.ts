import { expect } from 'vitest'

import owned, {
  AtRule,
  Comment,
  Container,
  CssSyntaxError,
  Declaration,
  Document,
  Input,
  Node,
  Result,
  Root,
  Rule,
  Warning,
  fromJSON,
  list,
  type AnyNode,
} from '../../src/index.ts'
import type { Plugin } from '../../src/plugin-types.ts'

export {
  AtRule,
  Comment,
  Container,
  CssSyntaxError,
  Declaration,
  Document,
  Input,
  Node,
  Result,
  Root,
  Rule,
  Warning,
  fromJSON,
  list,
}
export type { AnyNode, Plugin }

export const postcss = owned
export const parse = owned.parse.bind(owned) as typeof owned.parse
export const stringify = owned.stringify.bind(owned) as typeof owned.stringify

/** Minimal uvu/assert adapters for converted upstream tests. */
export const is = (actual: unknown, expected: unknown): void => {
  expect(actual).toBe(expected)
}
export const equal = (actual: unknown, expected: unknown): void => {
  expect(actual).toEqual(expected)
}
export const match = (actual: unknown, expected: RegExp | string): void => {
  expect(String(actual)).toMatch(expected)
}
export const throws = (fn: () => unknown, expected?: RegExp | string): void => {
  if (expected === undefined) expect(fn).toThrow()
  else expect(fn).toThrow(expected)
}
export const type = (actual: unknown, expected: string): void => {
  expect(typeof actual).toBe(expected)
}
export const not = {
  equal: (actual: unknown, expected: unknown): void => {
    expect(actual).not.toEqual(expected)
  },
  ok: (actual: unknown): void => {
    expect(actual).toBeFalsy()
  },
  type: (actual: unknown, expected: string): void => {
    expect(typeof actual).not.toBe(expected)
  },
}
export const ok = (actual: unknown): void => {
  expect(actual).toBeTruthy()
}

export const instance = (actual: unknown, expected: Function): void => {
  expect(actual).toBeInstanceOf(expected)
}
