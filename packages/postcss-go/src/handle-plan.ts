import {
  HANDLE_CAPABILITY_ASYNCLIFETIME,
  HANDLE_CAPABILITY_ATOMICPATCHES,
  HANDLE_CAPABILITY_MUTATIONTRAVERSAL,
  HANDLE_CAPABILITY_READONLYFACADE,
  HANDLE_CAPABILITY_SOURCEMAPS,
  HANDLE_REQUIRED_CAPABILITIES,
} from './generated/handle-protocol.js';
import { hasHandleBridge, type HandleBridge } from './handle-session.js';

export type HandleExecutionPlan = {
  runtime: 'handle-readonly' | 'handle-scalar' | 'handle-full' | 'unsupported';
  requiredCapabilities: number[];
  reason: string;
};

const FULL_MASK =
  HANDLE_CAPABILITY_READONLYFACADE |
  HANDLE_CAPABILITY_ATOMICPATCHES |
  HANDLE_CAPABILITY_MUTATIONTRAVERSAL;

/** Decide before callbacks: JavaScript callback shape cannot prove access requirements. */
export function planHandleExecution(
  bridge: HandleBridge | null | undefined,
  sourceMaps: boolean,
  plugins: readonly unknown[] = [],
  _previousMaps = false,
): HandleExecutionPlan {
  const requiredCapabilities: number[] = [...HANDLE_REQUIRED_CAPABILITIES];
  requiredCapabilities[0] |= HANDLE_CAPABILITY_READONLYFACADE;

  const wantsAsync = plugins.some(hasAsyncCallback);
  let capabilities = 0;
  let bridgeOk = false;
  try {
    if (
      hasHandleBridge(bridge) &&
      typeof bridge!.handleReadSnapshots === 'function' &&
      (bridge!.handleProtocolInfo().capabilities[0] & HANDLE_CAPABILITY_READONLYFACADE) ===
        HANDLE_CAPABILITY_READONLYFACADE
    ) {
      bridgeOk = true;
      capabilities = bridge!.handleProtocolInfo().capabilities[0] >>> 0;
    }
  } catch {
    // Negotiation failures fall through as an unavailable facade.
  }

  const has = (bit: number) => (capabilities & bit) === bit;
  const fullReady =
    bridgeOk &&
    typeof bridge!.handleApplyPatches === 'function' &&
    has(FULL_MASK) &&
    (!sourceMaps || has(HANDLE_CAPABILITY_SOURCEMAPS)) &&
    (!wantsAsync || has(HANDLE_CAPABILITY_ASYNCLIFETIME));

  if (fullReady) {
    requiredCapabilities[0] |= FULL_MASK;
    if (sourceMaps) requiredCapabilities[0] |= HANDLE_CAPABILITY_SOURCEMAPS;
    if (wantsAsync) requiredCapabilities[0] |= HANDLE_CAPABILITY_ASYNCLIFETIME;
    return {
      runtime: 'handle-full',
      requiredCapabilities,
      reason: 'capability-complete handle execution',
    };
  }
  return {
    runtime: 'unsupported',
    requiredCapabilities,
    reason: bridgeOk ? 'callback access requirements are unknown' : 'handle facade unavailable',
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
