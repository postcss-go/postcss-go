import { test } from 'vitest'
import {
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
  parse,
  postcss,
  stringify,
  equal,
  is,
  instance,
  match,
  not,
  ok,
  throws,
  type,
  type AnyNode,
  type Plugin,
} from './helpers.ts'

test('toString() inserts default spaces', () => {
  let comment = new Comment({ text: 'hi' })
  is(comment.toString(), '/* hi */')
})

test('toString() clones spaces from another comment', () => {
  let root = parse('a{} /*hello*/')
  let comment = new Comment({ text: 'world' })
  root.append(comment)

  is(root.toString(), 'a{} /*hello*/ /*world*/')
})

