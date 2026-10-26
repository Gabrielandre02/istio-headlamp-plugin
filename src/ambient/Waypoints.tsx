import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box, Chip, Typography } from '@mui/material';
import { useMemo } from 'react';
import { ChipList } from '../components/common/SpecSection';
import { Mono, SpecTable } from '../components/detail/Table';
import { useMeshStatus } from '../lib/detect';
import { USE_WAYPOINT, WAYPOINT_FOR } from '../lib/labels';
import { resolveWaypoint } from '../lib/mesh';
import { AuthorizationPolicy } from '../resources/security';
import { WaypointSection } from './Overview';

interface Coverage {
  waypointKey: string;
  services: Array<{ name: string; namespace: string; source: string }>;
  namespaces: string[];
}

/**
 * Waypoints and what they actually cover.
 *
 * Enrolment is expressed by labels pointing *at* the waypoint, so the only way
 * to answer "what does this waypoint handle" is to scan Services and Namespaces
 * and resolve each one back. That reverse lookup is exactly what is tedious to
 * do with kubectl, so it belongs in the UI.
 */
export function WaypointsPage() {
  const { waypoints, ambientEnabled, ztunnelUnknown, dataPlaneForbiddenNamespaces, loading } =
    useMeshStatus();
  const [namespaces] = K8s.ResourceClasses.Namespace.useList();
  const [services] = K8s.ResourceClasses.Service.useList();
  const [policies] = AuthorizationPolicy.useList();

  const coverage = useMemo(() => {
    const map = new Map<string, Coverage>();
    const key = (ns?: string, name?: string) => `${ns ?? ''}/${name ?? ''}`;

    const nsByName = new Map((namespaces ?? []).map(n => [n.metadata.name, n]));

    (namespaces ?? []).forEach(ns => {
      const binding = resolveWaypoint(ns as any, ns as any);
      if (!binding.name || binding.disabled) return;
      const k = key(binding.namespace ?? ns.metadata.name, binding.name);
      const entry = map.get(k) ?? { waypointKey: k, services: [], namespaces: [] };
      entry.namespaces.push(ns.metadata.name);
      map.set(k, entry);
    });

    (services ?? []).forEach(svc => {
      const ns = nsByName.get(svc.metadata.namespace ?? '') ?? null;
      const binding = resolveWaypoint(svc as any, ns as any);
      if (!binding.name || binding.disabled || binding.source !== 'object') return;
      const k = key(binding.namespace ?? svc.metadata.namespace, binding.name);
      const entry = map.get(k) ?? { waypointKey: k, services: [], namespaces: [] };
      entry.services.push({
        name: svc.metadata.name,
        namespace: svc.metadata.namespace ?? '',
        source: binding.source,
      });
      map.set(k, entry);
    });

    return map;
  }, [namespaces, services]);

  const policiesByWaypoint = useMemo(() => {
    const map = new Map<string, AuthorizationPolicy[]>();
    (policies ?? []).forEach(p => {
      p.targetRefs.forEach(ref => {
        if (ref.kind !== 'Gateway' || !ref.name) return;
        const k = `${ref.namespace ?? p.metadata.namespace}/${ref.name}`;
        map.set(k, [...(map.get(k) ?? []), p]);
      });
    });
    return map;
  }, [policies]);

  if (loading || ztunnelUnknown) {
    return (
      <SectionBox title="Waypoints">
        <Alert severity="info">
          {loading
            ? 'Checking whether ambient mode is installed…'
            : `Cannot determine whether ambient mode is installed. DaemonSet access was denied in ${
                dataPlaneForbiddenNamespaces.join(', ') || 'one or more namespaces'
              }.`}
        </Alert>
      </SectionBox>
    );
  }

  if (!ambientEnabled) {
    return (
      <SectionBox title="Waypoints">
        <Alert severity="info">
          This mesh does not run ambient mode (no <Mono>ztunnel</Mono> DaemonSet), so there are no
          waypoints. Sidecar proxies handle L7 for injected workloads.
        </Alert>
      </SectionBox>
    );
  }

  const rows = waypoints.map(w => {
    const k = `${w.metadata.namespace}/${w.metadata.name}`;
    return {
      waypoint: w,
      coverage: coverage.get(k) ?? { waypointKey: k, services: [], namespaces: [] },
      policies: policiesByWaypoint.get(k) ?? [],
    };
  });

  const orphaned = rows.filter(
    r => r.coverage.services.length === 0 && r.coverage.namespaces.length === 0
  );

  return (
    <Box sx={{ pt: 3, pb: 6 }}>
      {/*
        No page-level heading here: the first section is already titled
        "Waypoints (n)", and having both read as a duplicated heading.
      */}
      {orphaned.length > 0 && (
        <Box sx={{ px: 2 }}>
          <Alert severity="warning">
            {orphaned.length} waypoint{orphaned.length === 1 ? ' is' : 's are'} deployed but nothing
            is enrolled with {orphaned.length === 1 ? 'it' : 'them'}:{' '}
            <Mono>
              {orphaned
                .map(r => `${r.waypoint.metadata.namespace}/${r.waypoint.metadata.name}`)
                .join(', ')}
            </Mono>
            . Label a namespace or Service with <Mono>{USE_WAYPOINT}</Mono> to route through it.
          </Alert>
        </Box>
      )}

      <WaypointSection waypoints={waypoints} />

      <SectionBox title="Coverage">
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Resolved from <Mono>{USE_WAYPOINT}</Mono> labels on namespaces and Services.
        </Typography>
        <SpecTable
          items={rows}
          emptyText="No waypoints deployed."
          columns={[
            {
              label: 'Waypoint',
              render: r => (
                <Link
                  routeName="gateway"
                  params={{
                    name: r.waypoint.metadata.name,
                    namespace: r.waypoint.metadata.namespace,
                  }}
                >
                  {r.waypoint.metadata.namespace}/{r.waypoint.metadata.name}
                </Link>
              ),
            },
            {
              label: 'Handles',
              render: r => <Mono>{r.waypoint.metadata.labels?.[WAYPOINT_FOR] ?? 'service'}</Mono>,
            },
            {
              label: 'Namespaces enrolled',
              render: r => <ChipList items={r.coverage.namespaces} emptyText="none" />,
            },
            {
              label: 'Services explicitly enrolled',
              render: r => (
                <ChipList
                  items={r.coverage.services.map(s => `${s.namespace}/${s.name}`)}
                  emptyText="none"
                />
              ),
            },
            {
              label: 'L7 policies attached',
              render: r =>
                r.policies.length === 0 ? (
                  <Chip size="small" label="none" variant="outlined" />
                ) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                    {r.policies.map(p => (
                      <Mono key={p.metadata.uid}>
                        {p.metadata.namespace}/{p.metadata.name} ({p.action})
                      </Mono>
                    ))}
                  </Box>
                ),
            },
          ]}
        />
      </SectionBox>
    </Box>
  );
}
