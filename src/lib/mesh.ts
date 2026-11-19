import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import {
  APP_NAME,
  DATAPLANE_MODE,
  GATEWAY_CLASS_NAME,
  GATEWAY_MANAGED,
  PART_OF,
  PROXY_CONTAINER,
  REVISION,
  SIDECAR_INJECT_ANNOTATION,
  SIDECAR_INJECTION,
  USE_WAYPOINT,
  USE_WAYPOINT_NAMESPACE,
  WAYPOINT_FOR,
  WAYPOINT_GATEWAY_CLASS,
} from './labels';

export type MeshMode = 'ambient' | 'sidecar' | 'infra' | 'out-of-mesh' | 'unknown';

export interface MeshState {
  mode: MeshMode;
  /** Short human-readable reason, shown in tooltips. */
  reason: string;
  /** Istio revision, when the namespace or workload pins one. */
  revision?: string;
}

type Labels = Record<string, string> | undefined;

function labelsOf(obj: KubeObject | undefined | null): Labels {
  return obj?.metadata?.labels as Labels;
}

function annotationsOf(obj: KubeObject | undefined | null): Labels {
  return obj?.metadata?.annotations as Labels;
}

/**
 * Mesh state of a namespace, from its labels alone.
 *
 * Ambient and sidecar labels can both be present; Istio gives ambient
 * precedence only when the workload has no injected sidecar, so at the
 * namespace level we report the ambiguity rather than guessing.
 */
export function namespaceMeshState(ns: KubeObject | undefined | null): MeshState {
  // A namespace we could not read is not a namespace without labels. Plenty of
  // accounts cannot list namespaces cluster-wide, and reporting those
  // workloads as out of the mesh is a confident answer drawn from nothing.
  if (!ns) {
    return { mode: 'unknown', reason: 'namespace not readable (still loading, or not permitted)' };
  }

  const labels = labelsOf(ns) ?? {};
  const dataplane = labels[DATAPLANE_MODE];
  const injection = labels[SIDECAR_INJECTION];
  const rev = labels[REVISION];

  if (dataplane === 'ambient') {
    return {
      mode: 'ambient',
      reason: `namespace labelled ${DATAPLANE_MODE}=ambient`,
      revision: rev,
    };
  }
  if (dataplane === 'none') {
    return { mode: 'out-of-mesh', reason: `namespace labelled ${DATAPLANE_MODE}=none` };
  }
  if (injection === 'enabled' || (rev && rev !== 'default' && injection !== 'disabled')) {
    return {
      mode: 'sidecar',
      reason:
        injection === 'enabled'
          ? `namespace labelled ${SIDECAR_INJECTION}=enabled`
          : `namespace labelled ${REVISION}=${rev}`,
      revision: rev,
    };
  }
  return { mode: 'out-of-mesh', reason: 'no Istio namespace labels' };
}

/**
 * The injected `istio-proxy` container of a pod. Native sidecar mode
 * (ENABLE_NATIVE_SIDECARS) injects it as a restartable init container instead
 * of a regular container.
 */
export function proxyContainer(pod: KubeObject): { name?: string; image?: string } | undefined {
  const spec = (pod.jsonData as any)?.spec ?? {};
  return (
    (spec.containers ?? []).find((c: any) => c.name === PROXY_CONTAINER) ??
    (spec.initContainers ?? []).find(
      (c: any) => c.name === PROXY_CONTAINER && c.restartPolicy === 'Always'
    )
  );
}

/**
 * Mesh state of a pod. The pod's own spec is authoritative: an injected
 * `istio-proxy` container means sidecar regardless of namespace labels.
 */
export function podMeshState(
  pod: KubeObject | undefined | null,
  namespace?: KubeObject | null
): MeshState {
  if (!pod) return { mode: 'unknown', reason: 'pod not loaded' };

  const infra = istioInfraRole(pod);
  if (infra) {
    return { mode: 'infra', reason: `${infra}, part of the Istio data plane` };
  }

  const hasProxy = !!proxyContainer(pod);
  const labels = labelsOf(pod) ?? {};
  const annotations = annotationsOf(pod) ?? {};

  if (hasProxy) {
    return { mode: 'sidecar', reason: `pod has an ${PROXY_CONTAINER} container` };
  }

  const podDataplane = labels[DATAPLANE_MODE];
  if (podDataplane === 'none') {
    return { mode: 'out-of-mesh', reason: `pod labelled ${DATAPLANE_MODE}=none (opted out)` };
  }
  if (podDataplane === 'ambient') {
    return { mode: 'ambient', reason: `pod labelled ${DATAPLANE_MODE}=ambient` };
  }

  const nsState = namespaceMeshState(namespace);
  if (nsState.mode === 'unknown') {
    // The pod itself said nothing and the namespace is unreadable, so the only
    // honest answer is that we do not know.
    return { mode: 'unknown', reason: nsState.reason };
  }
  if (nsState.mode === 'ambient') {
    return { mode: 'ambient', reason: nsState.reason };
  }
  if (nsState.mode === 'sidecar') {
    if (
      annotations[SIDECAR_INJECT_ANNOTATION] === 'false' ||
      labels[SIDECAR_INJECT_ANNOTATION] === 'false'
    ) {
      return {
        mode: 'out-of-mesh',
        reason: `injection disabled on the pod (${SIDECAR_INJECT_ANNOTATION}=false)`,
      };
    }
    // Restarting would not help: the injector never touches these.
    if ((pod.jsonData as any)?.spec?.hostNetwork) {
      return { mode: 'out-of-mesh', reason: 'the injector skips host-network pods' };
    }
    // Namespace says inject, but this pod has no proxy -- it predates the
    // label or was never restarted. Worth flagging rather than claiming mesh.
    return {
      mode: 'out-of-mesh',
      reason: 'namespace enables injection but this pod has no sidecar (restart required?)',
    };
  }
  return { mode: 'out-of-mesh', reason: nsState.reason };
}

/**
 * Istio's own components, which are data plane rather than workloads *in* the
 * mesh. ztunnel and waypoint pods both run a container named `istio-proxy`, so
 * container sniffing alone labels them "Sidecar" -- wrong, and it inflates the
 * sidecar count on an ambient cluster.
 *
 * Note this cannot be done by checking `istio.io/dataplane-mode=none` instead:
 * Istio stamps that same label onto genuinely sidecar-injected pods to keep
 * them out of ambient, so that check would flip real sidecars to out-of-mesh.
 */
export function istioInfraRole(pod: KubeObject | undefined | null): string | undefined {
  const labels = labelsOf(pod) ?? {};

  if (labels[GATEWAY_MANAGED]) {
    return labels[GATEWAY_CLASS_NAME] === WAYPOINT_GATEWAY_CLASS
      ? 'waypoint proxy'
      : 'Istio gateway proxy';
  }
  if (labels[PART_OF] === 'istio') {
    const name = labels[APP_NAME] ?? labels['app'];
    return name ? `Istio ${name}` : 'Istio component';
  }
  return undefined;
}

/** A waypoint is a Gateway whose class is `istio-waypoint`. */
export function isWaypoint(gateway: KubeObject | undefined | null): boolean {
  return (gateway?.jsonData as any)?.spec?.gatewayClassName === WAYPOINT_GATEWAY_CLASS;
}

/** What a waypoint intercepts: `service` (default), `workload`, `all`, or `none`. */
export function waypointFor(gateway: KubeObject): string {
  return (labelsOf(gateway) ?? {})[WAYPOINT_FOR] ?? 'service';
}

export interface WaypointBinding {
  /** Waypoint name, or undefined when the object opts out. */
  name?: string;
  namespace?: string;
  /** Where the binding came from, for display. */
  source: 'object' | 'namespace' | 'none';
  /** True when `istio.io/use-waypoint=none` explicitly disables enrolment. */
  disabled: boolean;
}

/**
 * Resolves which waypoint an object (Service, Pod or Namespace) is enrolled
 * with. Object-level labels win over the namespace default, and the literal
 * value `none` opts out entirely.
 */
export function resolveWaypoint(
  obj: KubeObject | undefined | null,
  namespace: KubeObject | undefined | null
): WaypointBinding {
  const objLabels = labelsOf(obj) ?? {};
  const nsLabels = labelsOf(namespace) ?? {};

  const own = objLabels[USE_WAYPOINT];
  if (own) {
    if (own === 'none') return { source: 'object', disabled: true };
    return {
      name: own,
      namespace: objLabels[USE_WAYPOINT_NAMESPACE] ?? obj?.metadata?.namespace,
      source: 'object',
      disabled: false,
    };
  }

  const inherited = nsLabels[USE_WAYPOINT];
  if (inherited) {
    if (inherited === 'none') return { source: 'namespace', disabled: true };
    return {
      name: inherited,
      namespace: nsLabels[USE_WAYPOINT_NAMESPACE] ?? namespace?.metadata?.name,
      source: 'namespace',
      disabled: false,
    };
  }

  return { source: 'none', disabled: false };
}

/** Does a label selector (matchLabels only, as Istio uses) match these labels? */
export function matchLabels(
  selector: Record<string, string> | undefined,
  labels: Record<string, string> | undefined
): boolean {
  if (!selector || Object.keys(selector).length === 0) return true;
  if (!labels) return false;
  return Object.entries(selector).every(([k, v]) => labels[k] === v);
}
