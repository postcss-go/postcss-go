import postcss, {
  AtRule,
  Comment,
  Container,
  Declaration,
  Document,
  Node,
  PreviousMap,
  Processor,
  Root,
  Rule,
  fromJSON,
  isSyncPostcssGoService,
  type AnyNode,
  type PluginHelpers,
  type PostcssGoService,
} from '../src/index.js';

const processor = postcss({
  postcssPlugin: 'type-contract',
  Rule(_rule, helpers) {
    const typedHelpers: PluginHelpers = helpers;
    const processorConstructor: typeof Processor = typedHelpers.Processor;
    const legacyPlugin = typedHelpers.plugin('legacy', () => ({}));
    const nodeConstructor = typedHelpers.node;
    const sameApi = typedHelpers.postcss.default;
    void [processorConstructor, legacyPlugin, nodeConstructor, sameApi];
  },
});

void processor.process('.a{}');

postcss({
  postcssPlugin: 'specific-listener-types',
  Declaration(decl) {
    const declaration: Declaration = decl;
    declaration.value = 'blue';
  },
  Rule(rule) {
    const typedRule: Rule = rule;
    typedRule.selector = '.b';
  },
  Once(root) {
    root.walkDecls(() => undefined);
  },
});

const input = postcss.parse('.a{}').source?.input;
if (input?.map instanceof PreviousMap) {
  input.map.toJSON();
}

declare const service: PostcssGoService;
if (isSyncPostcssGoService(service)) {
  const synchronous: true = service.capabilities.synchronous;
  service.parseSync('.a{}');
  service.processSync('.a{}');
  service.stringifySync(postcss.root());
  service.noWorkSync('.a{}');
  void synchronous;
}

// Node/Container public surface used by plugins and AST tooling.
const root: Root = postcss.parse('.a, .b { color: red } /* c */');
const rule: Rule = root.first as Rule;
const decl: Declaration = rule.first as Declaration;
const comment: Comment = root.last as Comment;
const nodes: AnyNode[] = [root, rule, decl, comment];

rule.selectors = ['em', 'strong'];
decl.assign({ value: 'blue' }).cloneBefore({ value: 'green' });
root.walkDecls(/color/, (node, index) => {
  node.cloneAfter({ prop: 'opacity', value: String(index) });
});
root.each((child) => {
  if (child instanceof Rule) child.append({ text: 'x' });
});

const cloned = root.clone();
const json = cloned.toJSON();
const hydrated: Root | Document | Node | Node[] = fromJSON(json);
const container: Container = new Container({ type: 'custom', nodes: [] });
const atRule: AtRule = new AtRule({ name: 'media', params: 'screen', nodes: [] });
const document: Document = new Document({ nodes: [root.clone()] });

void [nodes, hydrated, container, atRule, document, rule.toProxy(), decl.rangeBy({ word: 'blue' })];
