/**
 * Part A of the boundary-cost suite.
 *
 * Compares the legacy JSON-RPC path against the production native + binary
 * codec path (direct hydrate/serialize, no intermediate DTO).
 */
import {
  createNativeService,
  createNodeService,
  fromAst,
  hydrateAst,
  isNativeBridgeAvailable,
  serializeAst,
  toAst,
} from '../../packages/postcss-go/dist/index.js';
import { getBundledGoBridgeBinPath } from '../../packages/postcss-go/dist/resolve-go-bridge.js';
import { formatBytes, formatNs, legend, measureSlow, table } from './lib/bench.mjs';
import { countNodes, loadFixtures } from './lib/fixtures.mjs';

/**
 * Walks a hydrated tree the way a realistic plugin does and counts the
 * property reads, writes, and traversal steps involved. In the current design
 * these are free (plain JS memory). In a handle-based AST every one of them is
 * a native call, so this count is the multiplier that decides the trade-off.
 */
function countBoundaryOps(root) {
  const ops = { reads: 0, writes: 0, traversal: 0, structural: 0 };

  const visit = (node) => {
    ops.traversal += 1;

    if (node.type === 'decl') {
      ops.reads += 2;
      if (/^(display|width|height|margin|padding|color)$/.test(node.prop)) {
        ops.writes += 1;
        ops.structural += 2;
      }
      return;
    }

    if (node.type === 'rule') {
      ops.reads += 1;
    } else if (node.type === 'atrule') {
      ops.reads += 2;
    } else if (node.type === 'comment') {
      ops.reads += 1;
    }

    if (node.nodes) {
      ops.traversal += 1;
      for (const child of node.nodes) {
        ops.traversal += 1;
        visit(child);
      }
    }
  };

  visit(root);
  ops.total = ops.reads + ops.writes + ops.traversal + ops.structural;
  return ops;
}

async function main() {
  const nativeAvailable = isNativeBridgeAvailable();
  const child = createNodeService({
    binPath: getBundledGoBridgeBinPath(),
    binArgs: ['--single'],
  });
  const native = nativeAvailable ? createNativeService() : null;
  const fixtures = loadFixtures();
  const rows = [];

  try {
    for (const fixture of fixtures) {
      const { root } = await child.parse(fixture.css, { from: `${fixture.name}.css` });
      const counts = countNodes(root);
      const json = JSON.stringify(root);
      const hydrated = fromAst(root);
      const ops = countBoundaryOps(hydrated);

      const jsonEncode = measureSlow(() => JSON.stringify(root));
      const jsonDecode = measureSlow(() => JSON.parse(json));
      const hydrate = measureSlow(() => fromAst(root));
      const serialize = measureSlow(() => toAst(hydrated));

      const jsonWire = jsonEncode.ns + jsonDecode.ns;
      const jsMirror = hydrate.ns + serialize.ns;
      const jsonTotal = jsonWire + jsMirror;

      let binary = 0;
      let directHydrate = 0;
      let directSerialize = 0;
      let nativeParse = 0;
      let nativeRoundTrip = 0;
      let binaryTotal = 0;

      if (native) {
        // Production path: Go emits binary → hydrateAst → mutate → serializeAst → Go.
        const live = native.parseSync(fixture.css, { from: `${fixture.name}.css` }).root;
        const bin = serializeAst(live);
        binary = bin.length;

        directHydrate = measureSlow(() => hydrateAst(bin)).ns;
        directSerialize = measureSlow(() => serializeAst(live)).ns;
        nativeParse = measureSlow(() =>
          native.parseSync(fixture.css, { from: `${fixture.name}.css` }),
        ).ns;
        nativeRoundTrip = measureSlow(() => {
          const { root: r } = native.parseSync(fixture.css, { from: `${fixture.name}.css` });
          native.stringifyResultSync(r);
        }).ns;

        // JS-side cost of the preferred path: one hydrate + one serialize.
        binaryTotal = directHydrate + directSerialize;
      }

      rows.push({
        fixture: fixture.name,
        bytes: fixture.css.length,
        nodes: counts.total,
        decls: counts.decl ?? 0,
        json: json.length,
        binary,
        jsonEncode: jsonEncode.ns,
        jsonDecode: jsonDecode.ns,
        hydrate: hydrate.ns,
        serialize: serialize.ns,
        jsonWire,
        jsMirror,
        jsonTotal,
        directHydrate,
        directSerialize,
        binaryTotal,
        nativeParse,
        nativeRoundTrip,
        perNode: jsonTotal / counts.total,
        ops,
        opsTotal: ops.total,
        opsPerNode: ops.total / counts.total,
      });
    }
  } finally {
    await child.close();
    if (native) await native.close();
  }

  console.log('# Part A — JSON-RPC vs native binary codec\n');
  if (!nativeAvailable) {
    console.log(
      'Native addon unavailable; only the JSON-RPC path is measured.\n' +
        'Build it with `node packages/postcss-go/native/build.mjs`.\n',
    );
  } else {
    console.log(
      'JSON-RPC still moves a JSON DTO over stdio. The preferred path moves a\n' +
        'compact binary AST through the in-process native addon and hydrates\n' +
        'straight into live TypeScript AST classes (no intermediate DTO).\n',
    );
  }

  console.log('## Input shape\n');
  console.log(
    legend('How much data each fixture moves across the boundary.', [
      ['css', 'source stylesheet size'],
      ['json dto', 'legacy bridge payload'],
      ['binary', 'production codec payload (native path)'],
      ['nodes', 'AST nodes, including the root'],
      ['decls', 'declaration nodes, the ones plugins touch most'],
    ]),
  );
  console.log(
    table(rows, [
      { label: 'fixture', value: (r) => r.fixture },
      { label: 'css', value: (r) => formatBytes(r.bytes) },
      { label: 'json dto', value: (r) => formatBytes(r.json) },
      {
        label: 'binary',
        value: (r) => (r.binary ? formatBytes(r.binary) : '—'),
      },
      {
        label: 'bin/json',
        value: (r) => (r.binary ? `${((100 * r.binary) / r.json).toFixed(0)}%` : '—'),
      },
      { label: 'nodes', value: (r) => r.nodes.toLocaleString() },
      { label: 'decls', value: (r) => r.decls.toLocaleString() },
    ]),
  );

  console.log('\n## Legacy JSON-RPC path (per file, JS side)\n');
  console.log(
    legend('What JavaScript pays per file on the stdio JSON bridge.', [
      ['JSON.stringify', 'encode the mutated AST for the stringify request'],
      ['JSON.parse', 'decode the parse response from Go'],
      ['fromAst', 'build TypeScript AST objects from the decoded DTO'],
      ['toAst', 'flatten those objects back into a DTO'],
      ['total', 'sum of the four'],
    ]),
  );
  console.log(
    table(rows, [
      { label: 'fixture', value: (r) => r.fixture },
      { label: 'JSON.stringify', value: (r) => formatNs(r.jsonEncode) },
      { label: 'JSON.parse', value: (r) => formatNs(r.jsonDecode) },
      { label: 'fromAst', value: (r) => formatNs(r.hydrate) },
      { label: 'toAst', value: (r) => formatNs(r.serialize) },
      { label: 'total', value: (r) => formatNs(r.jsonTotal) },
    ]),
  );

  if (nativeAvailable) {
    console.log('\n## Native + binary codec path (per file)\n');
    console.log(
      legend('Production path: sync addon + direct hydrate/serialize.', [
        ['hydrateAst', 'binary → live TypeScript AST'],
        ['serializeAst', 'live TypeScript AST → binary'],
        ['JS total', 'hydrate + serialize'],
        ['native parse', 'Go parse + binary encode + hydrateAst'],
        ['round-trip', 'parseSync → stringifyResultSync'],
        ['vs JSON', 'JS total compared with the legacy JSON total'],
      ]),
    );
    console.log(
      table(rows, [
        { label: 'fixture', value: (r) => r.fixture },
        { label: 'hydrateAst', value: (r) => formatNs(r.directHydrate) },
        { label: 'serializeAst', value: (r) => formatNs(r.directSerialize) },
        { label: 'JS total', value: (r) => formatNs(r.binaryTotal) },
        { label: 'native parse', value: (r) => formatNs(r.nativeParse) },
        { label: 'round-trip', value: (r) => formatNs(r.nativeRoundTrip) },
        {
          label: 'vs JSON',
          value: (r) => {
            const ratio = r.binaryTotal / r.jsonTotal;
            return ratio < 1 ? `${(1 / ratio).toFixed(2)}x faster` : `${ratio.toFixed(2)}x slower`;
          },
        },
      ]),
    );
  }

  console.log('\n## Boundary operations a handle-based AST would need instead\n');
  console.log(
    legend(
      `A handle-based AST trades one bulk transfer for many small crossings.
       Counted from a walk that reads every node and rewrites common declarations.`,
      [
        ['nodes', 'AST nodes, including the root'],
        ['native calls', 'crossings that walk would need, one per field or step'],
        ['calls/node', 'native calls divided by node count'],
        ['break-even (JSON)', 'per-call budget against the legacy JSON total'],
        ['break-even (bin)', 'per-call budget against the binary JS total'],
      ],
    ),
  );
  console.log(
    table(rows, [
      { label: 'fixture', value: (r) => r.fixture },
      { label: 'nodes', value: (r) => r.nodes.toLocaleString() },
      { label: 'native calls', value: (r) => r.opsTotal.toLocaleString() },
      { label: 'calls/node', value: (r) => r.opsPerNode.toFixed(1) },
      {
        label: 'break-even (JSON)',
        value: (r) => formatNs(r.jsonTotal / r.opsTotal),
      },
      {
        label: 'break-even (bin)',
        value: (r) => (r.binaryTotal ? formatNs(r.binaryTotal / r.opsTotal) : '—'),
      },
    ]),
  );

  console.log(
    '\nA handle-based AST is only faster if one native round trip costs less than\n' +
      'the break-even figure above. Parts B and C measure that price.',
  );

  return rows.map((row) => ({
    ...row,
    currentTotal: row.binaryTotal || row.jsonTotal,
    jsOverhead: row.directHydrate
      ? row.directHydrate + row.directSerialize
      : row.hydrate + row.serialize,
    wireOverhead: row.binary ? 0 : row.jsonWire,
  }));
}

const results = await main();
if (process.env.SPIKE_JSON) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.env.SPIKE_JSON, `${JSON.stringify(results, null, 2)}\n`);
}
