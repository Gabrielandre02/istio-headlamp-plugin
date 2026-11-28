import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { useMemo } from 'react';
import {
  crdState,
  dataPlaneNamespaces,
  dataPlaneResourceUnknown,
  forbiddenDataPlaneNamespaces,
  isIstiod,
  ManagedControlPlane,
  managedControlPlanes,
  managedLookup,
  useControlPlaneNamespace,
} from './controlPlane';
import { isIstioCrdGroup } from './detectParse';
import { ISTIO_SYSTEM_NAMESPACE, WAYPOINT_GATEWAY_CLASS } from './labels';
import { useMeshConfig } from './meshConfig';

const CRD = K8s.ResourceClasses.CustomResourceDefinition;
const Deployment = K8s.ResourceClasses.Deployment;
const DaemonSet = K8s.ResourceClasses.DaemonSet;
const GatewayClass = K8s.ResourceClasses.Gateway;

/** GKE's managed Cloud Service Mesh control plane, one per release channel. */
class ControlPlaneRevision extends KubeObject<any> {
  static kind = 'ControlPlaneRevision';
  static apiName = 'controlplanerevisions';
  static apiVersion = ['mesh.cloud.google.com/v1beta1', 'mesh.cloud.google.com/v1alpha1'];
  static isNamespaced = true;
}
const REVISION_CRD = `${ControlPlaneRevision.apiName}.mesh.cloud.google.com`;
const NO_REVISIONS: ControlPlaneRevision[] = [];

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
      if (!isIstioCrdGroup(group)) return;
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
  /** Google-managed control planes (GKE Cloud Service Mesh), which run no istiod in the cluster. */
  managed: ManagedControlPlane[];
  /** ztunnel DaemonSet; present only in ambient installs. */
  ztunnel: any | null;
  /** istio-cni DaemonSet; required by ambient, optional otherwise. */
  cni: any | null;
  /** Gateways whose class is `istio-waypoint`. */
  waypoints: any[];
  /** Gateway listing could not be read, so waypoint attachment is unconfirmed. */
  gatewayUnknown: boolean;
  /** Gateway listing is still pending. */
  gatewayLoading: boolean;
  /** Whether the control plane is still being checked. */
  controlPlaneLoading: boolean;
  /**
   * A missing control plane could not be confirmed because Deployment or
   * ControlPlaneRevision access was denied.
   */
  controlPlaneUnknown: boolean;
  /** The Deployments were readable; only ControlPlaneRevision access was denied. */
  managedUnknown: boolean;
  /** Namespaces where a namespaced control-plane query was forbidden. */
  controlPlaneForbiddenNamespaces: string[];
  /** True when a ztunnel DaemonSet was found; this does not imply it is healthy. */
  ambientEnabled: boolean;
  /** A missing ztunnel could not be confirmed because a namespace was forbidden. */
  ztunnelUnknown: boolean;
  /** A missing istio-cni DaemonSet could not be confirmed because a namespace was forbidden. */
  cniUnknown: boolean;
  /** Namespaces where this account could not list DaemonSets. */
  dataPlaneForbiddenNamespaces: string[];
  /** Whether DaemonSet queries are still pending. */
  dataPlaneLoading: boolean;
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
  const deploymentQuery = Deployment.useList({ namespace: controlPlane.namespace });
  const [deployments] = deploymentQuery;
  const deploymentErrors = deploymentQuery.errors;
  // One namespace of the three can be forbidden while the others answer. The
  // tuple's error then holds only the first failure; `errors` names each
  // namespace that failed.
  const daemonSetQuery = DaemonSet.useList({ namespace: dataPlane });
  const [daemonSets] = daemonSetQuery;
  const daemonSetErrors = daemonSetQuery.errors;
  const revisionQuery = ControlPlaneRevision.useList({ namespace: ISTIO_SYSTEM_NAMESPACE });
  // A failed probe hands back a new empty array on every render, which would
  // defeat the memo below on every cluster that is not GKE.
  const revisions = revisionQuery.items?.length ? revisionQuery.items : NO_REVISIONS;
  // Shares react-query's cache with useIstioCrds.
  const [crds, crdError] = CRD.useList();
  const revisionCrd = crdState(crds, crdError, REVISION_CRD);
  // While Headlamp probes the apiVersions, the list is null with isLoading
  // false; calling that "not managed" flashed the "No istiod" warning.
  const lookup = managedLookup(revisionCrd, revisionQuery.items !== null, revisionQuery.errors);
  const revisionsForbidden = lookup === 'forbidden';
  const revisionsPending = lookup === 'pending';
  const gatewayQuery = GatewayClass.useList();
  const [gateways, gatewayError] = gatewayQuery;

  return useMemo(() => {
    const istiod = (deployments ?? []).filter(isIstiod);
    const managed = managedControlPlanes(revisions.map(r => r.jsonData));
    const deploymentsForbidden =
      controlPlane.unknown || (deploymentErrors ?? []).some(error => error?.status === 403);
    const controlPlaneUnknown =
      istiod.length === 0 && managed.length === 0 && (deploymentsForbidden || revisionsForbidden);
    const ztunnel = (daemonSets ?? []).find(d => d.metadata.name.includes('ztunnel')) ?? null;
    const cni = (daemonSets ?? []).find(d => d.metadata.name.includes('istio-cni')) ?? null;

    const waypoints = (gateways ?? []).filter(
      g => (g.jsonData as any)?.spec?.gatewayClassName === WAYPOINT_GATEWAY_CLASS
    );

    return {
      namespace: controlPlane.namespace,
      istiod,
      managed,
      // The revisions only matter without an istiod; do not hold a regular
      // cluster on a probe that is expected to 404.
      controlPlaneLoading:
        controlPlane.loading ||
        deploymentQuery.isLoading ||
        (istiod.length === 0 && revisionsPending),
      controlPlaneUnknown,
      managedUnknown: revisionsForbidden && !deploymentsForbidden,
      controlPlaneForbiddenNamespaces: [
        ...new Set([
          ...controlPlane.forbiddenNamespaces,
          ...forbiddenDataPlaneNamespaces(deploymentErrors),
        ]),
      ],
      ztunnel,
      cni,
      gateways: gateways ?? [],
      waypoints,
      gatewayUnknown: Boolean(gatewayError),
      gatewayLoading: gatewayQuery.isLoading,
      ambientEnabled: Boolean(ztunnel),
      ztunnelUnknown:
        !daemonSetQuery.isLoading && dataPlaneResourceUnknown(daemonSetErrors, Boolean(ztunnel)),
      cniUnknown:
        !daemonSetQuery.isLoading && dataPlaneResourceUnknown(daemonSetErrors, Boolean(cni)),
      dataPlaneForbiddenNamespaces: forbiddenDataPlaneNamespaces(daemonSetErrors),
      dataPlaneLoading: daemonSetQuery.isLoading,
      loading: controlPlane.loading || deploymentQuery.isLoading || daemonSetQuery.isLoading,
    };
  }, [
    controlPlane,
    dataPlane,
    deploymentQuery.isLoading,
    deploymentErrors,
    deployments,
    revisions,
    revisionsPending,
    revisionsForbidden,
    daemonSetQuery.isLoading,
    daemonSets,
    daemonSetErrors,
    gateways,
    gatewayError,
    gatewayQuery.isLoading,
  ]);
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
