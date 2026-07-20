# @postcss-go/wasm

Browser and worker-oriented wrapper package for `postcss-go`.

The package ships a Go WASM runtime and a classic Web Worker entry point. The
worker keeps parsing and stringifying off the browser main thread.

## Usage

```ts
import { BrowserPostcssGoService } from '@postcss-go/wasm';

const service = new BrowserPostcssGoService({
  workerUrl: new URL('@postcss-go/wasm/worker', import.meta.url).toString(),
  wasmUrl: new URL('@postcss-go/wasm/postcss-go.wasm', import.meta.url).toString(),
  wasmExecUrl: new URL('@postcss-go/wasm/wasm_exec.js', import.meta.url).toString(),
});

const result = await service.process('.a { color: red }');
await service.close();
```

The worker URL must point to the package's `dist/worker.js`, and the WASM
runtime requires Go's `wasm_exec.js`. Bundlers may need to copy the `.wasm` and
`wasm_exec.js` files as assets.
