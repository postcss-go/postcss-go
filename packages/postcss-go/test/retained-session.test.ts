import { afterEach, beforeEach, expect, test } from 'vitest';

import { AtRule, fromJSON, Root, Rule } from '../src/ast.ts';
import {
  createNativeService,
  installNativeSyncCssRuntime,
  isNativeBridgeAvailable,
} from '../src/native.ts';
import { ownerOf } from '../src/handle-facade.ts';
import { parseRetained, releaseRetained } from '../src/retained-session.ts';

afterEach(() => {
  installNativeSyncCssRuntime();
});

beforeEach(() => {
  installNativeSyncCssRuntime();
});

test.skipIf(!isNativeBridgeAvailable())(
  'parseRetained trees are Go-owned and release is idempotent',
  () => {
    const service = createNativeService();
    try {
      const root = parseRetained(service.handleBridge!, '.a { color: red }');
      expect(root).toBeInstanceOf(Root);
      expect(ownerOf(root)).toBeDefined();
      expect(root.toString()).toContain('color: red');
      releaseRetained(root);
      releaseRetained(root);
      expect(() => root.toString()).toThrow();
    } finally {
      service.close();
    }
  },
);

test.skipIf(!isNativeBridgeAvailable())('public parseSync returns a Go-owned root', () => {
  const service = createNativeService();
  try {
    const root = service.parseSync('.a{}').root;
    expect(ownerOf(root)).toBeDefined();
  } finally {
    service.close();
  }
});

test.skipIf(!isNativeBridgeAvailable())(
  'explicit release and dropped references close the arena',
  () => {
    const service = createNativeService();
    try {
      const root = parseRetained(service.handleBridge!, '.a { color: red }');
      expect(ownerOf(root)).toBeDefined();
      releaseRetained(root);
      expect(() => root.toString()).toThrow();
    } finally {
      service.close();
    }
  },
);

test.skipIf(!isNativeBridgeAvailable())(
  'constructors intern into a Go arena and keep identity on append',
  () => {
    const service = createNativeService();
    try {
      const rule = new Rule({ selector: '.b', nodes: [] });
      expect(ownerOf(rule)).toBeDefined();
      const root = service.parseSync('.a{}').root;
      root.append(rule);
      expect(ownerOf(rule)).toBe(ownerOf(root));
      expect(rule.parent).toBe(root);
      expect(root.toString()).toContain('.b');
    } finally {
      service.close();
    }
  },
);

test.skipIf(!isNativeBridgeAvailable())('fromJSON intern keeps empty at-rule blocks', () => {
  const page = new AtRule({ name: 'page', nodes: [], params: 1 });
  expect(page.toString()).toBe('@page 1 {}');
  const hydrated = fromJSON({
    type: 'root',
    nodes: [{ type: 'rule', selector: '.a', nodes: [] }],
  }) as Root;
  expect(ownerOf(hydrated)).toBeDefined();
  expect(hydrated.toString()).toContain('.a');
});

test.skipIf(!isNativeBridgeAvailable())(
  'retained trees stay usable across await and explicit release zeros the arena',
  async () => {
    const service = createNativeService();
    try {
      const root = parseRetained(service.handleBridge!, '.a { color: red }');
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(root.toString()).toContain('color: red');
      expect(ownerOf(root)).toBeDefined();
      releaseRetained(root);
      expect(() => root.toString()).toThrow();
    } finally {
      service.close();
    }
  },
);
