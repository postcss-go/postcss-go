import { test } from 'vitest'
import {
  Document,
  Result,
  parse,
  is,
  match,
} from './helpers.ts'

test('generates result without map', async () => {
  let root = parse('a {}')
  let document = new Document()

  document.append(root)

  let result = await document.toResult()

  is(result instanceof Result, true)
  is(result.css, 'a {}')
})

test('generates result with map', async () => {
  let root = parse('a {}')
  let document = new Document()

  document.append(root)

  let result = await document.toResult({ map: true })

  is(result instanceof Result, true)
  match(result.css, /a {}\n\/\*# sourceMappingURL=/)
})
