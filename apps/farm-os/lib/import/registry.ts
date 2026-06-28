/**
 * Central registry of import descriptors (spec §4). The convention check
 * `rpcsWithoutDescriptor` (spec IMP-9) is pure so a future test can assert every
 * importable write-RPC ships a descriptor.
 */
import type { ImportDescriptor } from "./types";

const registry = new Map<string, ImportDescriptor>();

export function registerDescriptor(d: ImportDescriptor): void {
  if (registry.has(d.key)) throw new Error(`duplicate import descriptor key: ${d.key}`);
  registry.set(d.key, d);
}

export function getDescriptor(key: string): ImportDescriptor | undefined {
  return registry.get(key);
}

export function listDescriptors(): ImportDescriptor[] {
  return [...registry.values()];
}

export function rpcsWithoutDescriptor(
  importableRpcs: string[],
  descriptors: ImportDescriptor[],
): string[] {
  const covered = new Set(descriptors.map((d) => d.rpc));
  return importableRpcs.filter((rpc) => !covered.has(rpc));
}
