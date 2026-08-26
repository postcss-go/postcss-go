'use strict';

module.exports = function captureLoader(content, sourceMap, meta) {
  const options = this.getOptions();
  const ast = meta && meta.ast;
  this.emitFile(
    options.filename,
    JSON.stringify(
      {
        css: String(content),
        map: sourceMap || null,
        ast: ast
          ? {
              type: ast.type,
              version: ast.version,
              rootType: ast.root && ast.root.type,
              css: ast.root && ast.root.toString(),
            }
          : null,
      },
      null,
      2,
    ),
  );
  return `export default ${JSON.stringify(String(content))};`;
};
