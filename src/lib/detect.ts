import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useMemo } from 'react';
import { dataPlaneNamespaces, isIstiod, useControlPlaneNamespace } from './controlPlane';
import { WAYPOINT_GATEWAY_CLASS } from './labels';
import { useMeshConfig } from './meshConfig';

const CRD = K8s.ResourceClasses.CustomResourceDefinition;
const Deployment = K8s.ResourceClasses.Deployment;
const DaemonSet = K8s.ResourceClasses.DaemonSet;
const GatewayClass = K8s.ResourceClasses.Gateway;

export interface IstioCrdInfo {
  /** `plural.group`, e.g. `destinationrules.networking.istio.io`. */
  key: string;
  group: string;
  plural: string;
  kind: string;
  servedVersions: string[];
}

/**
 * Which Istio CRDs this cluster actually has.
 *
 * Sidebar entries for missing CRDs are hidden rather than rendered as broken
 * pages -- Istio installs differ (EnvoyFilter-only meshes, no telemetry API,
 * Gateway API absent) and a plugin that assumes everything is installed is the
 * main way these plugins rot.
 */
export function useIstioCrds(): {
  crds: Map<string, IstioCrdInfo>;
  loading: boolean;
  error: unknown;
} {
  const [items, error] = CRD.useList();

  const crds = useMemo(() => {
    const map = new Map<string, IstioCrdInfo>();
    (items ?? []).forEach(crd => {
      const spec = (crd.jsonData as any)?.spec;
      const group: string = spec?.group ?? '';
      if (!group.endsWith('istio.io')) return;
      const plural: string = spec?.names?.plural ?? '';
      map.set(`${plural}.${group}`, {
        key: `${plural}.${group}`,
        group,
        plural,
        kind: spec?.names?.kind ?? '',
        servedVersions: (spec?.versions ?? []).filter((v: any) => v.served).map((v: any) => v.name),
      });
    });
    return map;
  }, [items]);

  return { crds, loading: items === null && !error, error };
}

/** True when the given resource class has a matching CRD installed. */
export function isCrdInstalled(
  crds: Map<string, IstioCrdInfo>,
  cls: { apiName: string; apiVersion: string | string[] }
): boolean {
  const versions = Array.isArray(cls.apiVersion) ? cls.apiVersion : [cls.apiVersion];
  return versions.some(v => crds.has(`${cls.apiName}.${v.split('/')[0]}`));
}

export interface MeshStatus {
  /** Every Gateway API Gateway, not only the waypoints. */
  gateways: any[];
  /** The namespace istiod runs in, usually `istio-system`. */
  namespace: string;
  /** istiod deployments in that namespace, usually one per revision. */
  istiod: any[];
  /** ztunnel DaemonSet; present only in ambient installs. */
  ztunnel: any | null;
  /** istio-cni DaemonSet; required by ambient, optional otherwise. */
  cni: any | null;
  /** Gateways whose class is `istio-waypoint`. */
  waypoints: any[];
  /** True when a ztunnel DaemonSet exists. */
  ambientEnabled: boolean;
  loading: boolean;
}

/**
 * Control-plane and data-plane status, read from the workloads Istio installs.
 *
 * Deliberately derived from Deployments/DaemonSets rather than from istiod's
 * debug endpoints: those need port-forwarding and elevated RBAC, which most
 * Headlamp users viewing a production cluster will not have.
 */
export function useMeshStatus(): MeshStatus {
  const controlPlane = useControlPlaneNamespace();
  const dataPlane = useMemo(
    () => dataPlaneNamespaces(controlPlane.namespace),
    [controlPlane.namespace]
  );
  const [deployments] = Deployment.useList({ namespace: controlPlane.namespace });
  const [daemonSets] = DaemonSet.useList({ namespace: dataPlane });
  const [gateways] = GatewayClass.useList();

  return useMemo(() => {
    const istiod = (deployments ?? []).filter(isIstiod);
    const ztunnel = (daemonSets ?? []).find(d => d.metadata.name.includes('ztunnel')) ?? null;
    const cni = (daemonSets ?? []).find(d => d.metadata.name.includes('istio-cni')) ?? null;
    const waypoints = (gateways ?? []).filter(
      g => (g.jsonData as any)?.spec?.gatewayClassName === WAYPOINT_GATEWAY_CLASS
    );

    return {
      namespace: controlPlane.namespace,
      istiod,
      ztunnel,
      cni,
      gateways: gateways ?? [],
      waypoints,
      ambientEnabled: Boolean(ztunnel),
      loading: controlPlane.loading || deployments === null || daemonSets === null,
    };
  }, [controlPlane, deployments, daemonSets, gateways]);
}

/** The image tag of the first istiod deployment, e.g. `1.30.1-distroless`. */
export function istiodVersion(istiod: any[]): string | undefined {
  const image: string | undefined =
    istiod?.[0]?.jsonData?.spec?.template?.spec?.containers?.[0]?.image;
  return image?.split(':').pop();
}

/**
 * The mesh root namespace, where mesh-wide PeerAuthentication and
 * AuthorizationPolicy live. Falls back to the control-plane namespace when the
 * mesh config is missing or unreadable.
 */
export function useRootNamespace(): string {
  return useMeshConfig().rootNamespace;
}
