/**
 * Where the Istio control plane runs.
 *
 * Kept free of Headlamp and React imports so the rule can be tested without a
 * cluster; the hook in ./controlPlane.ts wires it to the API.
 */
import { ISTIO_SYSTEM_NAMESPACE, KUBE_SYSTEM_NAMESPACE } from './labels';

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
 * but can stay in `istio-system` when only istiod was moved, and GKE needs them
 * in `kube-system` for its node-critical priority class quota.
 */
export function dataPlaneNamespaces(namespace: string): string[] {
  return [...new Set([namespace, ISTIO_SYSTEM_NAMESPACE, KUBE_SYSTEM_NAMESPACE])];
}

/** Namespaces where DaemonSet listing failed with Forbidden. */
export function forbiddenDataPlaneNamespaces(
  errors: ({ status?: number; namespace?: string } | null | undefined)[] | null | undefined
): string[] {
  return [
    ...new Set(
      (errors ?? [])
        .filter(error => error?.status === 403)
        .map(error => error?.namespace)
        .filter((namespace): namespace is string => Boolean(namespace))
    ),
  ];
}

/** A missing DaemonSet is unknown if listing failed in any namespace. */
export function dataPlaneResourceUnknown(
  errors: ({ status?: number } | null | undefined)[] | null | undefined,
  resourceFound: boolean
): boolean {
  return !resourceFound && (errors ?? []).some(error => error?.status === 403);
}

/** A Google-managed control plane, from a Cloud Service Mesh `ControlPlaneRevision`. */
export interface ManagedControlPlane {
  /** Revision name, which is also the channel: `asm-managed`, `asm-managed-rapid`, ... */
  name: string;
  /** The `Reconciled` condition; undefined while GKE has not reported it or says `Unknown`. */
  reconciled?: boolean;
}

/**
 * Managed Cloud Service Mesh runs istiod outside the cluster, so there is no
 * Deployment to find. What it leaves behind is a `ControlPlaneRevision` per
 * channel in `istio-system`.
 */
export function managedControlPlanes(
  revisions: { metadata: { name: string }; status?: { conditions?: any[] } }[]
): ManagedControlPlane[] {
  return revisions.map(r => {
    const cond = (r.status?.conditions ?? []).find(c => c?.type === 'Reconciled');
    return {
      name: r.metadata.name,
      reconciled: cond?.status === 'True' ? true : cond?.status === 'False' ? false : undefined,
    };
  });
}

/** What to say next to the managed revisions; empty when all are reconciled. */
export function managedStatusNote(managed: ManagedControlPlane[]): string {
  if (managed.some(m => m.reconciled === false)) return ' (not reconciled)';
  if (managed.some(m => m.reconciled === undefined)) return ' (status pending)';
  return '';
}

/** What the cluster's CRD list says about the CRD named `name`. */
export function crdState(
  crds: { metadata: { name: string } }[] | null | undefined,
  error: unknown,
  name: string
): 'loading' | 'unreadable' | 'present' | 'absent' {
  // A failed apiVersion probe returns an empty list along with the error, so
  // check the error first or a denied CRD list would read as "absent".
  if (error) return 'unreadable';
  if (!crds) return 'loading';
  return crds.some(crd => crd.metadata.name === name) ? 'present' : 'absent';
}

/**
 * How far the ControlPlaneRevision lookup got. `crd` is what the cluster's CRD
 * list says about the ControlPlaneRevision CRD.
 *
 * Kubernetes answers 403, not 404, for a resource that does not exist when the
 * account has no broad read access. So a 403 only means "cannot tell" where
 * the CRD is not known to be absent.
 */
export function managedLookup(
  crd: 'loading' | 'unreadable' | 'present' | 'absent',
  revisionsLoaded: boolean,
  errors: ({ status?: number } | null | undefined)[] | null | undefined
): 'pending' | 'forbidden' | 'settled' {
  if (crd === 'loading') return 'pending';
  if (crd === 'absent') return 'settled';
  if ((errors ?? []).some(error => error?.status === 403)) return 'forbidden';
  return revisionsLoaded || errors?.length ? 'settled' : 'pending';
}
