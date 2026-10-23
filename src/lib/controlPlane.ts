import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useMemo } from 'react';
import { controlPlaneNamespace, ISTIOD_SELECTOR } from './controlPlaneParse';

export * from './controlPlaneParse';

/**
 * The namespace istiod runs in, found from its `app=istiod` label across the
 * cluster. Accounts that cannot list Deployments cluster-wide get
 * `istio-system`, as before.
 */
export function useControlPlaneNamespace(): { namespace: string; loading: boolean } {
  const [istiods, error] = K8s.ResourceClasses.Deployment.useList({
    labelSelector: ISTIOD_SELECTOR,
  });

  return useMemo(
    () => ({
      namespace: controlPlaneNamespace(istiods ?? []),
      loading: istiods === null && !error,
    }),
    [istiods, error]
  );
}
