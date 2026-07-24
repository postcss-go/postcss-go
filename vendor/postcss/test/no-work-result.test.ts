import { spy } from 'nanospy'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SourceMapGenerator } from 'source-map-js'
import { test } from 'uvu'
import { equal, instance, is, not, throws, type } from 'uvu/assert'

import NoWorkResult from '../lib/no-work-result.js'
import parse from '../lib/parse.js'
import postcss = require('../lib/postcss.js')
import Processor from '../lib/processor.js'
import stringify = require('../lib/stringify.js')

let processor = new Processor()

test('contains AST on root access', () => {
  let result = new NoWorkResult(processor, 'a {}', { from: '/a.css' })
  is(result.root.nodes.length, 1)
})

test('has async() method', async () => {
  let noWorkResult = new NoWorkResult(processor, 'a {}', { from: '/a.css' })
  let result1 = await noWorkResult
  let result2 = await noWorkResult
  equal(result1, result2)
})

test('has sync() method', () => {
  let result = new NoWorkResult(processor, 'a {}', { from: '/a.css' }).sync()
  is(result.root.nodes.length, 1)
})

test('throws error on sync()', () => {
  let noWorkResult = new NoWorkResult(processor, 'a {', { from: '/a.css' })

  try {
    noWorkResult.root
  } catch {}

  throws(() => noWorkResult.sync(), 'AAA')
})

test('returns cached root on second access', () => {
  let result = new NoWorkResult(processor, 'a {}', { from: '/a.css' })

  result.root

  is(result.root.nodes.length, 1)
  not.throws(() => result.sync())
})

test('contains css', () => {
  let result = new NoWorkResult(processor, 'a {}', { from: '/a.css' })
  is(result.css, 'a {}')
})

test('stringifies css', () => {
  let result = new NoWorkResult(processor, 'a {}', { from: '/a.css' })
  equal(`${result}`, result.css)
})

test('has content alias for css', () => {
  let result = new NoWorkResult(processor, 'a {}', { from: '/a.css' })
  is(result.content, 'a {}')
})

test('has map only if necessary', () => {
  let result1 = new NoWorkResult(processor, '', { from: '/a.css' })
  type(result1.map, 'undefined')

  let result2 = new NoWorkResult(processor, '', { from: '/a.css' })
  type(result2.map, 'undefined')

  let result3 = new NoWorkResult(processor, '', {
    from: '/a.css',
    map: { inline: false }
  })
  is(result3.map instanceof SourceMapGenerator, true)
})

test('map false does not enable a map from an annotation', () => {
  let result = new NoWorkResult(
    processor,
    'a {}\n/*# sourceMappingURL=missing.css.map */',
    { from: '/a.css', map: false }
  )

  is(result.css, 'a {}')
  type(result.map, 'undefined')
})

test('missing previous map annotation does not enable a map', () => {
  let result = new NoWorkResult(
    processor,
    'a {}\n/*# sourceMappingURL=missing.css.map */',
    { from: '/postcss-go-missing/input.css' }
  )

  is(result.css, 'a {}')
  type(result.map, 'undefined')
})

test('invalid previous map annotation does not enable a map', () => {
  let dir = mkdtempSync(join(tmpdir(), 'postcss-go-invalid-map-'))
  try {
    writeFileSync(join(dir, 'invalid.css.map'), 'not json')
    let result = new NoWorkResult(
      processor,
      'a {}\n/*# sourceMappingURL=invalid.css.map */',
      { from: join(dir, 'input.css') }
    )

    is(result.css, 'a {}')
    type(result.map, 'undefined')
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('empty map options default inline when annotated map is missing', () => {
  let result = new NoWorkResult(
    processor,
    'a {}\n/*# sourceMappingURL=missing.css.map */',
    { from: '/postcss-go-missing/input.css', map: {} }
  )

  is(result.css.includes('sourceMappingURL=data:application/json;base64,'), true)
  type(result.map, 'undefined')
})

test('empty map options inherit a loaded external map', () => {
  let dir = mkdtempSync(join(tmpdir(), 'postcss-go-external-map-'))
  try {
    writeFileSync(
      join(dir, 'input.css.map'),
      JSON.stringify({
        version: 3,
        sources: ['original.css'],
        names: [],
        mappings: 'AAAA'
      })
    )
    let result = new NoWorkResult(
      processor,
      'a {}\n/*# sourceMappingURL=input.css.map */',
      { from: join(dir, 'input.css'), map: {}, to: join(dir, 'output.css') }
    )

    is(result.css.includes('sourceMappingURL=output.css.map'), true)
    is(result.map instanceof SourceMapGenerator, true)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('contains simple properties', () => {
  let result = new NoWorkResult(processor, 'a {}', {
    from: '/a.css',
    to: 'a.css'
  })
  instance(result.processor, Processor)
  equal(result.opts, { from: '/a.css', to: 'a.css' })
  equal(result.messages, [])
  equal(result.warnings(), [])
})

test('executes on finally callback', () => {
  let cb = spy()
  return new NoWorkResult(processor, 'a {}', { from: '/a.css' })
    .finally(cb)
    .then(() => {
      equal(cb.callCount, 1)
    })
})

test('prints its object type', () => {
  let result = new NoWorkResult(processor, 'a {}', { from: '/a.css' })
  is(Object.prototype.toString.call(result), '[object NoWorkResult]')
})

test('no work result matches lazy result', async () => {
  let source = '.foo { color: red }\n'

  let noWorkResult = await postcss([]).process(source, {
    from: 'foo.css',
    map: false
  })

  let lazyResult = await postcss([]).process(source, {
    from: 'foo.css',
    map: false,
    syntax: { parse, stringify }
  })

  equal(noWorkResult.css, lazyResult.css)
})

// https://github.com/postcss/postcss/issues/1911
test('no work result matches lazy result when map is true', async () => {
  let source = '.foo { color: red }\n'

  let noWorkResult = await postcss([]).process(source, {
    from: 'foo.css',
    map: true
  })

  equal(
    noWorkResult.css,
    '.foo { color: red }\n\n/*# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImZvby5jc3MiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEiLCJmaWxlIjoiZm9vLmNzcyIsInNvdXJjZXNDb250ZW50IjpbIi5mb28geyBjb2xvcjogcmVkIH1cbiJdfQ== */'
  )

  let lazyResult = await postcss([]).process(source, {
    from: 'foo.css',
    map: true,
    syntax: { parse, stringify }
  })

  equal(
    lazyResult.css,
    '.foo { color: red }\n\n/*# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImZvby5jc3MiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxXQUFXIiwiZmlsZSI6ImZvby5jc3MiLCJzb3VyY2VzQ29udGVudCI6WyIuZm9vIHsgY29sb3I6IHJlZCB9XG4iXX0= */'
  )
})

test('no work result matches lazy result when the source contains an inline source map', async () => {
  let source =
    '.foo { color: red }\n\n/*# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImZvby5jc3MiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxXQUFXIiwiZmlsZSI6ImZvby5jc3MiLCJzb3VyY2VzQ29udGVudCI6WyIuZm9vIHsgY29sb3I6IHJlZCB9XG4iXX0= */\n'

  let noWorkResult = await postcss([]).process(source, {
    from: 'foo.css',
    map: false
  })

  let lazyResult = await postcss([]).process(source, {
    from: 'foo.css',
    map: false,
    syntax: { parse, stringify }
  })

  equal(noWorkResult.css, lazyResult.css)
})

test('no work result matches lazy result when map is true and the source contains an inline source map', async () => {
  let source =
    '.foo { color: red }\n\n/*# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImZvby5jc3MiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxXQUFXIiwiZmlsZSI6ImZvby5jc3MiLCJzb3VyY2VzQ29udGVudCI6WyIuZm9vIHsgY29sb3I6IHJlZCB9XG4iXX0= */\n'

  let lazyResult = await postcss([]).process(source, {
    from: 'bar.css',
    map: true,
    syntax: { parse, stringify }
  })

  let noWorkResult = await postcss([]).process(source, {
    from: 'bar.css',
    map: true
  })

  equal(noWorkResult.css, lazyResult.css)
})

test.run()
