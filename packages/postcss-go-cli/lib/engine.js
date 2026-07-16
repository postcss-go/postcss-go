import postcss from 'postcss';
import { createNodeService } from '@postcss-go/core';
import path from 'path';

import getMapfile from './getMapfile.js';
import { resolveGoBridgeServiceOptions } from './resolveGoBridge.js';

export function getEffectiveMapOption(config) {
  if (config?.options?.map !== undefined) {
    return config.options.map;
  }

  return config?.map;
}

export function isSourceMapEnabled(map) {
  return map !== false && map !== undefined;
}

export function isExternalSourceMap(map) {
  if (!isSourceMapEnabled(map)) return false;
  if (map === true) return false;
  return map.inline !== true;
}

export function assertGoEngineCompatible(argv, config) {
  if (argv.engine !== 'go') {
    return;
  }

  if (argv.parser || argv.syntax || argv.stringifier) {
    throw new Error(
      'Engine Error: postcss-go does not support custom parser/syntax/stringifier yet; use --engine postcss',
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
      service: createNodeService(resolveGoBridgeServiceOptions()),
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
      const inputCss = typeof css === 'string' ? css : css.toString('utf8');
      const mapEnabled = isSourceMapEnabled(options.map);
      const shouldRunPostcss = hasPlugins(config?.plugins) || mapEnabled;
      const mapOption = options.map && typeof options.map === 'object' ? options.map : {};
      const pluginMap =
        options.map && typeof options.map === 'object'
          ? { ...options.map, inline: false, annotation: false }
          : { inline: false, annotation: false };
      const pluginResult = shouldRunPostcss
        ? await postcss(config.plugins).process(inputCss, {
            ...options,
            map: mapEnabled ? pluginMap : false,
          })
        : null;
      const resolvedAnnotation =
        typeof mapOption.annotation === 'function'
          ? mapOption.annotation(options.to, pluginResult?.root)
          : mapOption.annotation;
      const mapFile = mapEnabled ? getSourceMapFile(options, resolvedAnnotation) : undefined;
      const processOptions = { from: options.from };
      if (options.to) processOptions.to = options.to;
      if (mapEnabled) {
        processOptions.map = true;
        processOptions.mapFile = mapFile;
        processOptions.absolute = mapOption.absolute === true;
        processOptions.preserveAnnotation = mapOption.annotation === false;
        processOptions.sourceMapFrom = mapOption.from;
        if (mapOption.sourcesContent !== undefined) {
          processOptions.sourcesContent = mapOption.sourcesContent;
        }
        if (pluginResult?.map) {
          processOptions.previousMap = pluginResult.map.toString();
          processOptions.previousMapUrl = `${options.to || options.from || 'to.css'}.map`;
        }
      }
      const result = await engine.service.process(pluginResult?.css ?? inputCss, processOptions);
      const messages = [...(pluginResult?.messages ?? []), ...(result.messages ?? [])];
      const annotated = applySourceMapAnnotation(
        result.css,
        result.map,
        options,
        resolvedAnnotation,
      );

      return {
        css: annotated.css,
        map: annotated.map,
        mapFile: isExternalSourceMap(options.map) ? mapFile : undefined,
        warnings() {
          return messages
            .filter((message) => message.type === 'warning')
            .map((warning) => ({
              ...warning,
              toString() {
                if (
                  typeof warning.toString === 'function' &&
                  warning.toString !== Object.prototype.toString
                ) {
                  return warning.toString();
                }
                return warning.text;
              },
            }));
        },
        messages,
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

function hasPlugins(plugins) {
  if (!plugins) return false;
  if (Array.isArray(plugins)) return plugins.length > 0;
  return Object.keys(plugins).length > 0;
}

function applySourceMapAnnotation(css, map, options, resolvedAnnotation) {
  if (!map || !isSourceMapEnabled(options.map)) {
    return { css, map: undefined };
  }

  const mapOption = options.map && typeof options.map === 'object' ? options.map : {};

  if (options.map === true || mapOption.inline === true) {
    const encoded = Buffer.from(map).toString('base64');
    return {
      css: `${css}\n/*# sourceMappingURL=data:application/json;base64,${encoded} */`,
      map: undefined,
    };
  }

  if (mapOption.annotation === false) {
    return { css, map };
  }

  const annotation =
    typeof resolvedAnnotation === 'string'
      ? resolvedAnnotation
      : path.basename(getMapfile(options));
  return {
    css: `${css}\n/*# sourceMappingURL=${annotation} */`,
    map,
  };
}

function getSourceMapFile(options, resolvedAnnotation) {
  if (!isExternalSourceMap(options.map)) {
    return options.to || options.from || 'to.css';
  }
  if (typeof resolvedAnnotation === 'string') {
    return path.resolve(path.dirname(options.to), resolvedAnnotation);
  }
  return getMapfile(options);
}
