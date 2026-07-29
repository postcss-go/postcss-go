import postcss, {
  PreviousMap,
  Processor,
  isSyncPostcssGoService,
  type PluginHelpers,
  type PostcssGoService,
  type Declaration,
  type Rule,
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
