import { expect, test } from 'vitest';

import { createBrowserProcessor } from '../src/wasm/browser.ts';
import { createHandleBridge, type HandleEnvelopeExports } from '../src/wasm/handle-bridge.ts';
import { HANDLE_BRIDGE_METHODS } from '../src/generated/handle-protocol.ts';
import { createNativeService, isNativeBridgeAvailable } from '../src/native.ts';
import type { HandleBridge } from '../src/handle-session.ts';

class UnusedWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { error?: unknown; message?: string }) => void) | null = null;
  readonly sent: unknown[] = [];
  terminated = false;

  postMessage(message: unknown) {
    this.sent.push(message);
  }

  terminate() {
    this.terminated = true;
  }
}

/** Stand in for the main-thread WASM instance using the in-process Go arena. */
function mainThreadBridge(): HandleBridge {
  return createNativeService().handleBridge!;
}

test.runIf(isNativeBridgeAvailable())(
  'browser plugins mutate the Go AST through the main-thread session without a worker round trip',
  async () => {
    const worker = new UnusedWorker();
    const processor = createBrowserProcessor(
      [
        {
          postcssPlugin: 'to-blue',
          Declaration(decl) {
            if (decl.prop === 'color') decl.value = 'blue';
          },
        },
      ],
      { worker, handleBridge: mainThreadBridge() },
    );

    const result = await processor.process('.a { color: red }', { from: 'a.css', map: false });

    expect(result.css).toBe('.a { color: blue }');
    expect(result.nativePlan?.hydration).toBe(false);
    // Only the boot-time init message may reach the worker; no AST crosses it.
    expect(worker.sent.filter((message) => (message as { method?: string }).method)).toEqual([]);
  },
);

test.runIf(isNativeBridgeAvailable())(
  'browser source maps stay Go-owned through the main-thread session',
  async () => {
    const processor = createBrowserProcessor(
      [
        {
          postcssPlugin: 'to-blue',
          Declaration(decl) {
            if (decl.prop === 'color') decl.value = 'blue';
          },
        },
      ],
      { worker: new UnusedWorker(), handleBridge: mainThreadBridge() },
    );

    const result = await processor.process('.a { color: red }', {
      from: 'a.css',
      to: 'a.out.css',
      map: { inline: false, annotation: false },
    });

    expect(result.css).toBe('.a { color: blue }');
    expect(result.map?.toJSON().sources).toEqual(['a.css']);
    expect(result.nativePlan?.hydration).toBe(false);
  },
);

test('createHandleBridge rejects an export table missing generated methods', () => {
  expect(() => createHandleBridge({} as HandleEnvelopeExports)).toThrow(/is unavailable/);
});

test('createHandleBridge rethrows Go status envelopes as errors', () => {
  const exports = Object.fromEntries(
    HANDLE_BRIDGE_METHODS.map((name) => [
      name,
      () => ({ ok: false as const, status: 3, message: 'session closed' }),
    ]),
  ) as HandleEnvelopeExports;

  const bridge = createHandleBridge(exports);
  expect(() => bridge.handleType(1, 1)).toThrow(
    expect.objectContaining({ message: 'session closed', status: 3 }),
  );
});

test('createHandleBridge unwraps successful envelopes', () => {
  const exports = Object.fromEntries(
    HANDLE_BRIDGE_METHODS.map((name) => [name, () => ({ ok: true as const, value: 'decl' })]),
  ) as HandleEnvelopeExports;

  expect(createHandleBridge(exports).handleGetField(1, 1, 0)).toBe('decl');
});
