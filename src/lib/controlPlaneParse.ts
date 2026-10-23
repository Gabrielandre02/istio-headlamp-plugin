/**
 * Where the Istio control plane runs.
 *
 * Kept free of Headlamp and React imports so the rule can be tested without a
 * cluster; the hook in ./controlPlane.ts wires it to the API.
 */
import { ISTIO_SYSTEM_NAMESPACE } from './labels';

const ISTIOD_APP = 'istiod';

/** Label selector for istiod Deployments, revisioned ones included. */
export const ISTIOD_SELECTOR = `app=${ISTIOD_APP}`;

/** An istiod Deployment, by name or by the label discovery uses. */
export function isIstiod(d: {
  metadata: { name: string; labels?: Record<string, string> };
}): boolean {
  return d.metadata.name.startsWith('istiod') || d.metadata.labels?.app === ISTIOD_APP;
}

/**
 * The namespace of the istiod Deployments found across the cluster, e.g.
 * `aks-istio-system` on the AKS add-on. `istio-system` wins when istiod runs
 * there too, and is the fallback when none can be listed.
 */
export function controlPlaneNamespace(istiods: { metadata: { namespace?: string } }[]): string {
  const namespaces = istiods.map(d => d.metadata.namespace ?? '').filter(Boolean);
  if (namespaces.length === 0 || namespaces.includes(ISTIO_SYSTEM_NAMESPACE)) {
    return ISTIO_SYSTEM_NAMESPACE;
  }
  return namespaces.sort()[0];
}

/**
 * Where to look for ztunnel and istio-cni. They usually sit next to istiod,
 * but can stay in `istio-system` when only istiod was moved.
 */
export function dataPlaneNamespaces(namespace: string): string[] {
  return namespace === ISTIO_SYSTEM_NAMESPACE
    ? [ISTIO_SYSTEM_NAMESPACE]
    : [namespace, ISTIO_SYSTEM_NAMESPACE];
}
