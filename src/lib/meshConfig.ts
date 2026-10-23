import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useMemo } from 'react';
import { useControlPlaneNamespace } from './controlPlane';
import {
  MeshDefaultConfig,
  meshRootNamespace,
  parseMeshConfig,
  pickMeshConfigMap,
} from './meshConfigParse';

export * from './meshConfigParse';

/**
 * The mesh-wide proxy defaults, read from the `istio` ConfigMap.
 *
 * Almost nobody writes ProxyConfig resources: proxy settings overwhelmingly
 * live in `meshConfig.defaultConfig` here, and a ProxyConfig only ever layers
 * an exception on top. A Proxy Configs page that shows the exceptions and not
 * the defaults is empty on most clusters while the real configuration sits one
 * API call away.
 */

export interface MeshConfigResult {
  /** `meshConfig.defaultConfig`, the part that configures proxies. */
  defaultConfig?: MeshDefaultConfig;
  /** The whole parsed mesh config, for anything not covered above. */
  meshConfig?: Record<string, unknown>;
  /** The mesh root namespace, where mesh-wide policies live. */
  rootNamespace: string;
  /** The control-plane namespace the ConfigMap is read from. */
  namespace: string;
  /** Name of the ConfigMap the values came from. */
  sourceName?: string;
  loading: boolean;
  /** Set when the ConfigMap could not be read, usually RBAC. */
  error: unknown;
}

export function useMeshConfig(): MeshConfigResult {
  const { namespace, loading: namespaceLoading } = useControlPlaneNamespace();
  const [configMaps, error] = K8s.ResourceClasses.ConfigMap.useList({ namespace });

  return useMemo(() => {
    if (namespaceLoading || configMaps === null) {
      return {
        rootNamespace: meshRootNamespace(undefined, namespace),
        namespace,
        loading: namespaceLoading || !error,
        error,
      };
    }

    const candidate = pickMeshConfigMap(configMaps as any[]);
    const meshConfig = parseMeshConfig((candidate?.jsonData as any)?.data?.mesh);

    return {
      meshConfig,
      rootNamespace: meshRootNamespace(meshConfig, namespace),
      namespace,
      defaultConfig: meshConfig?.defaultConfig as MeshDefaultConfig | undefined,
      sourceName: candidate?.metadata.name,
      loading: false,
      error,
    };
  }, [namespace, namespaceLoading, configMaps, error]);
}

/** True when an API error is a permission problem rather than a missing resource. */
export function isForbidden(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  return status === 403;
}
