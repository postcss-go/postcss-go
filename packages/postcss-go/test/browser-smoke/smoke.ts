import { BrowserPostcssGoService, CssSyntaxError, WasmWorkerError } from '@postcss-go/core/wasm';
import wasmUrl from '@postcss-go/core/wasm/postcss-go.wasm?url';
import wasmExecUrl from '@postcss-go/core/wasm/wasm_exec.js?url';
import workerUrl from '@postcss-go/core/wasm/worker?url';

declare global {
  var __postcssGoWasmSmoke:
    | { status: 'pending' }
    | { status: 'passed'; mapFile?: string }
    | { status: 'failed'; name: string; message: string; stack?: string };
}

globalThis.__postcssGoWasmSmoke = { status: 'pending' };

void (async () => {
  const service = new BrowserPostcssGoService({
    workerUrl,
    wasmUrl,
    wasmExecUrl,
    requestTimeoutMs: 15_000,
  });
  try {
    const parsed = await service.parse('.a { color: red }', { from: 'styles/a.css' });
    if (!parsed.root.source?.file?.endsWith('styles/a.css')) {
      throw new Error(`relative source path was not preserved: ${parsed.root.source?.file}`);
    }

    const processed = await service.process('.b { color: blue }', {
      from: 'styles/b.css',
      to: 'dist/b.css',
      map: { inline: false, annotation: false },
    });
    if (processed.mapFile !== 'dist/b.css.map') {
      throw new Error(`unexpected mapFile: ${processed.mapFile}`);
    }
    if (!processed.map) throw new Error('external source map was not returned');

    let syntaxErrorSeen = false;
    try {
      await service.process('{', { from: 'styles/broken.css' });
    } catch (error) {
      syntaxErrorSeen = error instanceof CssSyntaxError;
    }
    if (!syntaxErrorSeen) throw new Error('CssSyntaxError was not rebuilt across Worker RPC');

    await service.close();
    try {
      await service.parse('.closed {}');
      throw new Error('closed service unexpectedly accepted a request');
    } catch (error) {
      if (!(error instanceof WasmWorkerError)) throw error;
    }

    globalThis.__postcssGoWasmSmoke = { status: 'passed', mapFile: processed.mapFile };
  } catch (error) {
    await service.close();
    const failure = error instanceof Error ? error : new Error(String(error));
    globalThis.__postcssGoWasmSmoke = {
      status: 'failed',
      name: failure.name,
      message: failure.message,
      stack: failure.stack,
    };
  }
})();
