import {
  HANDLE_CAPABILITY_ASYNCLIFETIME,
  HANDLE_CAPABILITY_ATOMICPATCHES,
  HANDLE_CAPABILITY_MUTATIONTRAVERSAL,
  HANDLE_CAPABILITY_READONLYFACADE,
  HANDLE_CAPABILITY_SOURCEMAPS,
  HANDLE_REQUIRED_CAPABILITIES,
} from './generated/handle-protocol.js';
import { hasNativeHandleBridge, type NativeHandleAddon } from './handle-session.js';

export type HandleExecutionPlan = {
  runtime: 'binary' | 'handle-readonly' | 'handle-scalar' | 'handle-full' | 'unsupported';
  requiredCapabilities: number[];
  reason: string;
};

const FULL_MASK =
  HANDLE_CAPABILITY_READONLYFACADE |
  HANDLE_CAPABILITY_ATOMICPATCHES |
  HANDLE_CAPABILITY_MUTATIONTRAVERSAL;

/** Decide before callbacks: JavaScript callback shape cannot prove access requirements. */
export function planHandleExecution(
  mode: string,
  addon: NativeHandleAddon | null | undefined,
  sourceMaps: boolean,
  plugins: readonly unknown[] = [],
): HandleExecutionPlan {
  if (!['auto', 'binary', 'handle'].includes(mode))
    throw new Error('invalid POSTCSS_GO_NATIVE_AST mode');
  const requiredCapabilities: number[] = [...HANDLE_REQUIRED_CAPABILITIES];
  requiredCapabilities[0] |= HANDLE_CAPABILITY_READONLYFACADE;
  if (mode === 'binary')
    return { runtime: 'binary', requiredCapabilities, reason: 'explicit binary mode' };

  const wantsAsync = plugins.some(hasAsyncCallback);
  let capabilities = 0;
  let negotiationFailed = false;
  let bridgeOk = false;
  try {
    if (
      hasNativeHandleBridge(addon) &&
      typeof addon!.handleReadSnapshotsV2 === 'function' &&
      (addon!.handleProtocolInfo().capabilities[0] & HANDLE_CAPABILITY_READONLYFACADE) ===
        HANDLE_CAPABILITY_READONLYFACADE
    ) {
      bridgeOk = true;
      capabilities = addon!.handleProtocolInfo().capabilities[0] >>> 0;
    }
  } catch {
    negotiationFailed = true;
  }

  const has = (bit: number) => (capabilities & bit) === bit;
  const fullReady =
    bridgeOk &&
    typeof addon!.handleApplyPatchesV2 === 'function' &&
    has(FULL_MASK) &&
    (!sourceMaps || has(HANDLE_CAPABILITY_SOURCEMAPS)) &&
    (!wantsAsync || has(HANDLE_CAPABILITY_ASYNCLIFETIME));

  if (mode === 'auto') {
    if (fullReady) {
      requiredCapabilities[0] |= FULL_MASK;
      if (sourceMaps) requiredCapabilities[0] |= HANDLE_CAPABILITY_SOURCEMAPS;
      if (wantsAsync) requiredCapabilities[0] |= HANDLE_CAPABILITY_ASYNCLIFETIME;
      return {
        runtime: 'handle-full',
        requiredCapabilities,
        reason: 'capability-complete auto handle execution',
      };
    }
    return {
      runtime: 'binary',
      requiredCapabilities,
      reason: bridgeOk ? 'callback access requirements are unknown' : 'handle facade unavailable',
    };
  }

  // Explicit handle mode.
  if (wantsAsync && !has(HANDLE_CAPABILITY_ASYNCLIFETIME))
    return { runtime: 'unsupported', requiredCapabilities, reason: 'async callbacks' };
  if (sourceMaps && !has(HANDLE_CAPABILITY_SOURCEMAPS))
    return { runtime: 'unsupported', requiredCapabilities, reason: 'source maps' };
  if (!bridgeOk) {
    return {
      runtime: 'unsupported',
      requiredCapabilities,
      reason: negotiationFailed
        ? 'read-only facade negotiation failed'
        : 'read-only facade capability unavailable',
    };
  }

  if (fullReady) {
    requiredCapabilities[0] |= FULL_MASK;
    if (sourceMaps) requiredCapabilities[0] |= HANDLE_CAPABILITY_SOURCEMAPS;
    if (wantsAsync) requiredCapabilities[0] |= HANDLE_CAPABILITY_ASYNCLIFETIME;
    return {
      runtime: 'handle-full',
      requiredCapabilities,
      reason:
        'explicit full handle execution; structural writes, live relationships and scalar patches apply immediately',
    };
  }

  if (typeof addon!.handleApplyPatchesV2 === 'function' && has(HANDLE_CAPABILITY_ATOMICPATCHES)) {
    requiredCapabilities[0] |= HANDLE_CAPABILITY_ATOMICPATCHES;
    return {
      runtime: 'handle-scalar',
      requiredCapabilities,
      reason:
        'explicit scalar handle execution; structural writes throw without replay and patches flush per callback',
    };
  }
  return {
    runtime: 'handle-readonly',
    requiredCapabilities,
    reason: 'explicit read-only handle execution; unsupported operations throw without replay',
  };
}

function hasAsyncCallback(plugin: unknown): boolean {
  if (typeof plugin === 'function') return plugin.constructor.name === 'AsyncFunction';
  if (!plugin || typeof plugin !== 'object') return false;
  return Object.entries(plugin).some(([event, listener]) => {
    if (
      !/^(prepare|Once(?:Exit)?|(?:Document|Root|Rule|AtRule|Declaration|Comment)(?:Exit)?)$/.test(
        event,
      )
    )
      return false;
    if (typeof listener === 'function') return hasAsyncCallback(listener);
    return (
      listener !== null &&
      typeof listener === 'object' &&
      Object.values(listener).some(hasAsyncCallback)
    );
  });
}
