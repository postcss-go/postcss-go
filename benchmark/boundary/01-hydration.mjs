/**
 * Part A of the boundary-cost spike.
 *
 * Measures what the current "two crossings per file" design actually costs:
 * the JSON wire encode/decode, `fromAst` hydration into the TypeScript AST,
 * and `toAst` serialization back out. Also counts how many boundary operations
 * an equivalent handle-based AST would need, so the two models can be compared
 * once parts B and C supply a per-crossing price.
 */
import { createNodeService, fromAst, toAst } from '../../packages/postcss-go/dist/index.js';
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
    // A visitor dispatch needs the node type, and the walk needs child access.
    ops.traversal += 1;

    if (node.type === 'decl') {
      // Typical: read prop, read value, decide, sometimes rewrite value.
      ops.reads += 2;
      if (/^(display|width|height|margin|padding|color)$/.test(node.prop)) {
        ops.writes += 1;
        // Prefixing plugins clone the decl and insert a sibling.
        ops.structural += 2;
      }
      return;
    }

    if (node.type === 'rule') {
      ops.reads += 1; // selector
    } else if (node.type === 'atrule') {
      ops.reads += 2; // name + params
    } else if (node.type === 'comment') {
      ops.reads += 1; // text
    }

    if (node.nodes) {
      ops.traversal += 1; // read child count
      for (const child of node.nodes) {
        ops.traversal += 1; // index into children
        visit(child);
      }
    }
  };

  visit(root);
  ops.total = ops.reads + ops.writes + ops.traversal + ops.structural;
  return ops;
}

async function main() {
  const service = createNodeService({
    binPath: getBundledGoBridgeBinPath(),
    binArgs: ['--single'],
  });
  const fixtures = loadFixtures();
  const rows = [];

  try {
    for (const fixture of fixtures) {
      const { root } = await service.parse(fixture.css, { from: `${fixture.name}.css` });
      const counts = countNodes(root);
      const json = JSON.stringify(root);
      const ops = countBoundaryOps(fromAst(root));

      const encode = measureSlow(() => JSON.stringify(root));
      const decode = measureSlow(() => JSON.parse(json));
      const hydrate = measureSlow(() => fromAst(root));
      const hydrated = fromAst(root);
      const serialize = measureSlow(() => toAst(hydrated));

      /*
       * What a plugin run pays today on the JS side, on top of Go's own
       * parse/stringify. The JSON encode/decode counts: `node.ts` parses the
       * whole parse response and stringifies the whole AST back for stringify.
       * A handle-based AST would have no DTO and no wire format at all, so all
       * four of these disappear together.
       */
      const wireOverhead = encode.ns + decode.ns;
      const jsOverhead = hydrate.ns + serialize.ns;
      const currentTotal = wireOverhead + jsOverhead;

      rows.push({
        fixture: fixture.name,
        bytes: fixture.css.length,
        nodes: counts.total,
        decls: counts.decl ?? 0,
        json: json.length,
        encode: encode.ns,
        decode: decode.ns,
        hydrate: hydrate.ns,
        serialize: serialize.ns,
        wireOverhead,
        jsOverhead,
        currentTotal,
        perNode: currentTotal / counts.total,
        ops,
        opsTotal: ops.total,
        opsPerNode: ops.total / counts.total,
      });
    }
  } finally {
    await service.close();
  }

  console.log('# Part A — current design: JSON DTO + TypeScript AST mirror\n');
  console.log(
    'Go parses the CSS and returns a JSON DTO. JavaScript decodes it, rebuilds it\n' +
      'as TypeScript AST objects, mutates it, then reverses both steps on the way\n' +
      'out. This part prices those four steps.\n',
  );

  console.log('## Input shape\n');
  console.log(
    legend('How much data each fixture moves across the boundary.', [
      ['css', 'source stylesheet size'],
      ['json dto', 'bridge payload encoding the same tree'],
      ['nodes', 'AST nodes, including the root'],
      ['decls', 'declaration nodes, the ones plugins touch most'],
    ]),
  );
  console.log(
    table(rows, [
      { label: 'fixture', value: (r) => r.fixture },
      { label: 'css', value: (r) => formatBytes(r.bytes) },
      { label: 'json dto', value: (r) => formatBytes(r.json) },
      { label: 'nodes', value: (r) => r.nodes.toLocaleString() },
      { label: 'decls', value: (r) => r.decls.toLocaleString() },
    ]),
  );

  console.log('\n## Cost of crossing the boundary today (per file)\n');
  console.log(
    legend('What JavaScript pays per file, on top of Go\u2019s own parse and stringify.', [
      ['JSON.stringify', 'encode the mutated AST for the stringify request'],
      ['JSON.parse', 'decode the parse response from Go'],
      ['fromAst', 'build TypeScript AST objects from the decoded DTO'],
      ['toAst', 'flatten those objects back into a DTO'],
      ['total', 'sum of the four; all of it disappears if the DTO does'],
      ['per node', 'total divided by node count'],
    ]),
  );
  console.log(
    table(rows, [
      { label: 'fixture', value: (r) => r.fixture },
      { label: 'JSON.stringify', value: (r) => formatNs(r.encode) },
      { label: 'JSON.parse', value: (r) => formatNs(r.decode) },
      { label: 'fromAst', value: (r) => formatNs(r.hydrate) },
      { label: 'toAst', value: (r) => formatNs(r.serialize) },
      { label: 'total', value: (r) => formatNs(r.currentTotal) },
      { label: 'per node', value: (r) => formatNs(r.perNode) },
    ]),
  );

  console.log('\n## Boundary operations a handle-based AST would need instead\n');
  console.log(
    legend(
      `A handle-based AST trades one bulk transfer for many small crossings.
       Counted from a walk that reads every node and rewrites common declarations.`,
      [
        ['nodes', 'AST nodes, including the root'],
        ['native calls', 'crossings that walk would need, one per field or step'],
        ['calls/node', 'native calls divided by node count'],
        ['break-even cost/call', 'the price above which the handle model loses'],
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
        label: 'break-even cost/call',
        value: (r) => formatNs(r.currentTotal / r.opsTotal),
      },
    ]),
  );

  console.log(
    '\nA handle-based AST is only faster if one native round trip costs less than\n' +
      'the break-even figure above. Parts B and C measure that price.',
  );

  const json = rows.map((row) => ({ ...row }));
  return json;
}

const results = await main();
if (process.env.SPIKE_JSON) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.env.SPIKE_JSON, `${JSON.stringify(results, null, 2)}\n`);
}
