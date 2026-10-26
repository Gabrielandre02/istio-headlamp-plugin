/**
 * Reading Istio's mesh config: which ConfigMap holds it, and what it says.
 *
 * Kept free of Headlamp and React imports so the rules can be tested without a
 * cluster or a browser; the hook in ./meshConfig.ts wires it to the API.
 */
import yaml from 'js-yaml';
import { ISTIO_SYSTEM_NAMESPACE } from './labels';

export interface MeshDefaultConfig {
  concurrency?: number;
  discoveryAddress?: string;
  holdApplicationUntilProxyStarts?: boolean;
  terminationDrainDuration?: string;
  image?: Record<string, unknown>;
  proxyMetadata?: Record<string, string>;
  tracing?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Istio stores its mesh config in `istio-system/istio`, or in
 * `istio-<revision>` on a revisioned install. Pick the unrevisioned one first
 * and fall back to whichever revisioned ConfigMap carries a mesh config.
 *
 * Split from the hook so the selection rule can be tested without a cluster.
 */
export function pickMeshConfigMap<T extends { metadata: { name: string }; jsonData?: any }>(
  configMaps: T[]
): T | undefined {
  return (
    configMaps.find(cm => cm.metadata.name === 'istio') ??
    configMaps.find(cm => /^istio-[0-9a-z-]+$/.test(cm.metadata.name) && cm.jsonData?.data?.mesh)
  );
}

/** Parses the `mesh` key of that ConfigMap; undefined when it is unusable. */
export function parseMeshConfig(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = yaml.load(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The namespace mesh-wide policies live in. Istio defaults it to the
 * control-plane namespace unless meshConfig says otherwise, and plenty of
 * installs do say otherwise.
 */
export function meshRootNamespace(
  meshConfig: Record<string, unknown> | undefined,
  fallback: string = ISTIO_SYSTEM_NAMESPACE
): string {
  const root = meshConfig?.rootNamespace;
  return typeof root === 'string' && root ? root : fallback;
}
