'use strict';

const { SourceMapGenerator } = require('source-map-js');

module.exports = function previousMapLoader(content) {
  const css = String(content);
  const options = this.getOptions();
  const source = options.source || 'original.scss';
  const sourceContent = options.sourceContent || css;
  const generator = new SourceMapGenerator({ file: this.resourcePath });

  const lines = css.split('\n');
  for (let line = 1; line <= lines.length; line += 1) {
    if (line === lines.length && lines[line - 1] === '') continue;
    generator.addMapping({
      generated: { line, column: 0 },
      original: { line, column: 0 },
      source,
    });
  }
  generator.setSourceContent(source, sourceContent);
  this.callback(null, css, generator.toJSON());
};
