import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { Typography } from '@mui/material';
import { MeshBadge } from '../components/common/Badges';
import {
  namespaceMeshState,
  namespaceOf,
  podMeshState,
  workloadMeshState,
  workloadPods,
} from '../lib/mesh';

/**
 * Adds a "Mesh" column to Headlamp's own Pod and workload lists.
 *
 * Only tables that declare an ID can be targeted, which today means
 * `headlamp-pods` and `headlamp-workloads`. Namespace and Service lists do not
 * set one, so those views get the information through their details sections
 * instead.
 */

function PodMeshCell({ pod }: { pod: KubeObject }) {
  // react-query dedupes this across every cell in the table.
  const [namespaces] = K8s.ResourceClasses.Namespace.useList();
  const ns = namespaceOf(pod, namespaces);
  return <MeshBadge state={podMeshState(pod, ns as any)} />;
}

function WorkloadMeshCell({ workload }: { workload: KubeObject }) {
  const [namespaces] = K8s.ResourceClasses.Namespace.useList();
  const ns = namespaceOf(workload, namespaces);

  // Headlamp's workload page lists every pod for its charts, so this reads
  // the same cached list instead of asking again for each row.
  const [pods, podsError] = K8s.ResourceClasses.Pod.useList();

  const dash = (
    <Typography variant="body2" color="text.disabled">
      —
    </Typography>
  );
  // A CronJob has no selector and never runs pods of its own.
  if (!(workload.jsonData as any)?.spec?.selector) return dash;

  const state = pods && workloadMeshState(workloadPods(workload, pods), ns as any);
  if (state) return <MeshBadge state={state} />;
  // A failed list can still hold the pods of the namespaces that answered, so
  // finding none here does not mean the workload has none.
  if (podsError) {
    return <MeshBadge state={{ mode: 'unknown', reason: 'pods not readable' }} />;
  }
  // "—" means no pods; until the list arrives we do not know that yet.
  if (!pods) return <MeshBadge state={{ mode: 'unknown', reason: 'pods still loading' }} />;
  return dash;
}

const meshColumn = (render: (item: any) => JSX.Element) => ({
  id: 'istio-mesh',
  label: 'Mesh',
  getValue: () => '',
  render,
  gridTemplate: 'min-content',
});

export const meshColumnsProcessor = {
  id: 'istio-headlamp-plugin-mesh-column',
  processor: ({ id, columns }: { id: string; columns: any[] }) => {
    if (columns.some((c: any) => c?.id === 'istio-mesh')) return columns;

    if (id === 'headlamp-pods') {
      return insertBeforeAge(
        columns,
        meshColumn(item => <PodMeshCell pod={item} />)
      );
    }
    if (id === 'headlamp-workloads') {
      return insertBeforeAge(
        columns,
        meshColumn(item => <WorkloadMeshCell workload={item} />)
      );
    }
    return columns;
  },
};

/** Keep "Age" last, where people expect it. */
function insertBeforeAge(columns: any[], column: any): any[] {
  const ageIndex = columns.findIndex((c: any) => c === 'age' || c?.id === 'age');
  if (ageIndex < 0) return [...columns, column];
  return [...columns.slice(0, ageIndex), column, ...columns.slice(ageIndex)];
}

export function namespaceMeshBadge(ns: KubeObject) {
  return <MeshBadge state={namespaceMeshState(ns)} />;
}
