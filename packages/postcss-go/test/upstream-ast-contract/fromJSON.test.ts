import { test } from 'vitest'
import * as v8 from 'v8'

import {
  Declaration,
  Input,
  Root,
  Rule,
  fromJSON,
  postcss,
  equal,
  is,
  instance,
  throws,
} from './helpers.ts'

test('rehydrates a JSON AST', async () => {
  const cssWithMap = (
    await postcss().process(
      '.foo { color: red; font-size: 12pt; } /* abc */ @media (width: 60em) { }',
      {
        from: 'x.css',
        map: {
          inline: true,
        },
      },
    )
  ).css

  const root = postcss.parse(cssWithMap)

  const json = root.toJSON()
  const serialized = v8.serialize(json)
  const deserialized = v8.deserialize(serialized)
  const rehydrated = postcss.fromJSON(deserialized as object) as Root

  rehydrated.nodes[0].remove()

  is(rehydrated.nodes.length, 3)

  const processed = await postcss().process(rehydrated, {
    from: undefined,
    map: {
      inline: true,
    },
  })
  is(processed.css.includes('/* abc */'), true)
  is(processed.css.includes('@media (width: 60em)'), true)
  is(processed.css.includes('sourceMappingURL='), true)
})

test('rehydrates an array of Nodes via JSON.stringify', () => {
  const root = postcss.parse('.cls { color: orange; }')

  const rule = root.first as Rule
  const json = JSON.stringify(rule.nodes)
  const rehydrated = postcss.fromJSON(JSON.parse(json)) as any
  instance(rehydrated[0], Declaration)
  instance(rehydrated[0].source?.input, Input)
})

test('preserves custom node types through fromJSON', () => {
  const node = postcss.fromJSON({ type: 'word', value: 'hello' }) as { type: string; value?: string }
  equal(node.type, 'word')
})

test('throws when rehydrating a typeless invalid JSON AST', () => {
  throws(() => {
    postcss.fromJSON({ foo: 'bar' } as object)
  }, /Unknown node type/)
})
