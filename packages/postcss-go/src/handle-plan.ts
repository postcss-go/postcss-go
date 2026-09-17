import {
  HANDLE_CAPABILITY_ATOMICPATCHES,
  HANDLE_CAPABILITY_READONLYFACADE,
  HANDLE_REQUIRED_CAPABILITIES,
} from './generated/handle-protocol.js';
import { hasNativeHandleBridge, type NativeHandleAddon } from './handle-session.js';

export type HandleExecutionPlan = {
  runtime: 'binary' | 'handle-readonly' | 'handle-scalar' | 'unsupported';
  requiredCapabilities: number[];
  reason: string;
};

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
  if (mode === 'auto')
    return {
      runtime: 'binary',
      requiredCapabilities,
      reason: 'callback access requirements are unknown',
    };
  if (plugins.some(hasAsyncCallback))
    return { runtime: 'unsupported', requiredCapabilities, reason: 'async callbacks' };
  if (sourceMaps) return { runtime: 'unsupported', requiredCapabilities, reason: 'source maps' };
  try {
    if (
      !hasNativeHandleBridge(addon) ||
      typeof addon.handleReadSnapshotsV2 !== 'function' ||
      !(addon.handleProtocolInfo().capabilities[0] & HANDLE_CAPABILITY_READONLYFACADE)
    )
      return {
        runtime: 'unsupported',
        requiredCapabilities,
        reason: 'read-only facade capability unavailable',
      };
  } catch {
    return {
      runtime: 'unsupported',
      requiredCapabilities,
      reason: 'read-only facade negotiation failed',
    };
  }
  const capabilities = addon!.handleProtocolInfo().capabilities[0];
  if (
    typeof addon!.handleApplyPatchesV2 === 'function' &&
    (capabilities & HANDLE_CAPABILITY_ATOMICPATCHES) === HANDLE_CAPABILITY_ATOMICPATCHES
  ) {
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
