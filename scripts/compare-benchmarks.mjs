#!/usr/bin/env node
/**
 * Run postcss-go (Go) and postcss (Node) benchmarks and print a comparison table.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function runGoBenchmarks() {
  const result = spawnSync(
    'go',
    ['test', '-mod=mod', './benchmark/', '-bench=.', '-benchmem', '-count=5'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout)
    process.exit(result.status ?? 1)
  }

  const lines = result.stdout.split('\n')
  const parsed = new Map()
  const totals = new Map()

  for (const line of lines) {
    const match = line.match(
      /^Benchmark(\w+)_(\w+)-\d+\s+\d+\s+([\d.]+)\s+ns\/op(?:\s+[\d.]+\s+MB\/s)?\s+([\d.]+)\s+B\/op\s+([\d.]+)\s+allocs\/op/,
    )
    if (!match) continue

    const [, scenario, size, nsPerOp, bytesPerOp, allocsPerOp] = match
    const name = `${scenario}/${size}`
    const current = totals.get(name) ?? { nsPerOp: 0, bytesPerOp: 0, allocsPerOp: 0, count: 0 }
    current.nsPerOp += Number(nsPerOp)
    current.bytesPerOp += Number(bytesPerOp)
    current.allocsPerOp += Number(allocsPerOp)
    current.count += 1
    totals.set(name, current)
  }

  for (const [name, current] of totals) {
    parsed.set(name, {
      nsPerOp: current.nsPerOp / current.count,
      bytesPerOp: current.bytesPerOp / current.count,
      allocsPerOp: current.allocsPerOp / current.count,
    })
  }

  return parsed
}

function runPostCSSBenchmarks() {
  const result = spawnSync('node', ['benchmark/postcss.bench.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout)
    process.exit(result.status ?? 1)
  }

  const parsed = new Map()
  for (const line of result.stdout.trim().split('\n')) {
    if (!line) continue
    const entry = JSON.parse(line)
    parsed.set(entry.name, entry)
  }

  return parsed
}

function formatNs(ns) {
  if (ns >= 1e6) return `${(ns / 1e6).toFixed(2)} ms/op`
  if (ns >= 1e3) return `${(ns / 1e3).toFixed(1)} µs/op`
  return `${Math.round(ns)} ns/op`
}

function formatRatio(goNs, postcssNs) {
  if (!goNs || !postcssNs) return '—'
  const ratio = postcssNs / goNs
  if (ratio >= 1) return `${ratio.toFixed(2)}x faster`
  return `${(1 / ratio).toFixed(2)}x slower`
}

function printSection(title, order, goResults, postcssResults) {
  console.log(title)
  console.log('')
  console.log(
    [
      'Workload'.padEnd(28),
      'postcss-go'.padStart(14),
      'postcss'.padStart(14),
      'vs postcss'.padStart(16),
    ].join('  '),
  )
  console.log('-'.repeat(76))

  for (const name of order) {
    const go = goResults.get(name)
    const postcss = postcssResults.get(name)
    if (!go || !postcss) continue

    console.log(
      [
        name.padEnd(28),
        formatNs(go.nsPerOp).padStart(14),
        formatNs(postcss.nsPerOp).padStart(14),
        formatRatio(go.nsPerOp, postcss.nsPerOp).padStart(16),
      ].join('  '),
    )
  }

  console.log('')
}

const manifest = JSON.parse(
  readFileSync(path.join(repoRoot, 'benchmark/fixtures/manifest.json'), 'utf8'),
)
const realWorldIds = manifest.map((entry) => entry.id)

const syntheticOrder = [
  'Parse/Small',
  'Parse/Medium',
  'Parse/Large',
  'ParseStringify/Small',
  'ParseStringify/Medium',
  'ParseStringify/Large',
  'Process/Small',
  'Process/Medium',
  'Process/Large',
]

const realWorldOrder = [
  ...realWorldIds.map((id) => `ParseReal/${id}`),
  ...realWorldIds.map((id) => `ParseStringifyReal/${id}`),
  ...realWorldIds.map((id) => `ProcessReal/${id}`),
]

const goResults = runGoBenchmarks()
const postcssResults = runPostCSSBenchmarks()

console.log('')
console.log('postcss-go vs postcss benchmark (lower ns/op is better)')
console.log('')

printSection('Synthetic scaling workloads', syntheticOrder, goResults, postcssResults)
printSection('Real-world CSS fixtures', realWorldOrder, goResults, postcssResults)

console.log('Fixtures: modern-normalize, Tailwind preflight, animate.css, Bootstrap (formatted + minified)')
console.log('Go:   go test -mod=mod ./benchmark/ -bench=. -benchmem -count=5')
console.log('Node: node benchmark/postcss.bench.mjs')
console.log('Upstream: https://github.com/postcss/postcss')
console.log('')
