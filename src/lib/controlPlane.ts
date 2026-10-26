import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useMemo } from 'react';
import {
  controlPlaneNamespace,
  forbiddenDataPlaneNamespaces,
  isIstiod,
  ISTIOD_SELECTOR,
} from './controlPlaneParse';

export * from './controlPlaneParse';

/**
 * The namespace istiod runs in, found from its `app=istiod` label across the
 * cluster. Accounts that cannot list Deployments cluster-wide get
 * `istio-system`, as before.
 */
export function useControlPlaneNamespace(): {
  namespace: string;
  loading: boolean;
  unknown: boolean;
  forbiddenNamespaces: string[];
} {
  const query = K8s.ResourceClasses.Deployment.useList({ labelSelector: ISTIOD_SELECTOR });
  const [istiods] = query;

  return useMemo(() => {
    const errors = query.errors ?? [];
    const istiodFound = (istiods ?? []).some(isIstiod);
    const forbidden = errors.some(error => error?.status === 403);
    return {
      namespace: controlPlaneNamespace(istiods ?? []),
      loading: query.isLoading,
      unknown: !query.isLoading && !istiodFound && forbidden,
      forbiddenNamespaces: forbiddenDataPlaneNamespaces(errors),
    };
  }, [istiods, query.errors, query.isLoading]);
}
