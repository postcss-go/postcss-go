import postcss from 'postcss';
import { createNodeService } from '@postcss-go/core';

export function assertGoEngineCompatible(argv, config) {
  if (argv.engine !== 'go') {
    return;
  }

  if (argv.use?.length) {
    throw new Error(
      'Engine Error: postcss-go does not support --use plugins yet; use --engine postcss',
    );
  }

  if (argv.parser || argv.syntax || argv.stringifier) {
    throw new Error(
      'Engine Error: postcss-go does not support custom parser/syntax/stringifier yet; use --engine postcss',
    );
  }

  if (argv.map) {
    throw new Error(
      'Engine Error: postcss-go does not support external sourcemaps yet; use --engine postcss',
    );
  }

  const plugins = config?.plugins;
  if (Array.isArray(plugins) && plugins.length > 0) {
    throw new Error(
      'Engine Error: postcss-go does not support postcss.config.js plugins yet; use --engine postcss',
    );
  }

  if (plugins && !Array.isArray(plugins) && Object.keys(plugins).length > 0) {
    throw new Error(
      'Engine Error: postcss-go does not support postcss.config.js plugins yet; use --engine postcss',
    );
  }

  if (config?.options?.parser || config?.options?.syntax || config?.options?.stringifier) {
    throw new Error(
      'Engine Error: postcss-go does not support postcss.config.js parser/syntax/stringifier yet; use --engine postcss',
    );
  }
}

export function createEngine(argv) {
  if (argv.engine === 'go') {
    return {
      name: 'go',
      queue: Promise.resolve(),
      service: createNodeService(),
      async close() {
        await this.service.close();
      },
    };
  }

  return {
    name: 'postcss',
    async close() {},
  };
}

export async function processWithEngine(engine, config, css, options) {
  if (engine.name === 'go') {
    const run = async () => {
      const result = await engine.service.process(
        typeof css === 'string' ? css : css.toString('utf8'),
        {
          from: options.from,
        },
      );

      return {
        css: result.css,
        map: undefined,
        warnings() {
          return (result.messages ?? []).map((warning) => ({
            ...warning,
            toString() {
              return warning.text;
            },
          }));
        },
        messages: [],
      };
    };

    const next = engine.queue.then(run);
    engine.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  return postcss(config.plugins).process(css, options);
}
