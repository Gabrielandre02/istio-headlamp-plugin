import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox, SectionHeader } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box, Card, CardContent, Chip, Typography } from '@mui/material';
import { ReactNode, useMemo } from 'react';
import { MeshBadge } from '../components/common/Badges';
import { ChipList } from '../components/common/SpecSection';
import { Mono, SpecTable } from '../components/detail/Table';
import { istiodVersion, useIstioCrds, useMeshStatus } from '../lib/detect';
import { WAYPOINT_FOR } from '../lib/labels';
import { namespaceMeshState, resolveWaypoint } from '../lib/mesh';

/**
 * Mesh Overview: the page that answers "what kind of mesh is this, and is it healthy"
 * before you go looking at individual resources.
 */
export function MeshOverview() {
  const status = useMeshStatus();
  const { crds } = useIstioCrds();
  const [namespaces] = K8s.ResourceClasses.Namespace.useList();

  const enrolment = useMemo(() => {
    const rows = (namespaces ?? []).map(ns => ({
      ns,
      state: namespaceMeshState(ns),
      waypoint: resolveWaypoint(ns as any, ns as any),
    }));
    return {
      rows: rows.filter(r => r.state.mode !== 'out-of-mesh'),
      ambient: rows.filter(r => r.state.mode === 'ambient').length,
      sidecar: rows.filter(r => r.state.mode === 'sidecar').length,
      out: rows.filter(r => r.state.mode === 'out-of-mesh').length,
    };
  }, [namespaces]);

  if (!status.controlPlaneLoading && !status.controlPlaneUnknown && status.istiod.length === 0) {
    return (
      <SectionBox title="Istio">
        <Alert severity="warning">
          No <Mono>istiod</Mono> Deployment found in <Mono>{status.namespace}</Mono>. Either Istio
          is not installed, it lives in another namespace, or this account cannot read that
          namespace.
        </Alert>
      </SectionBox>
    );
  }

  const version = istiodVersion(status.istiod);

  return (
    // Headlamp's own pages get their breathing room from the layout; a plugin
    // route renders bare, so the last section sat flush against the bottom edge.
    <Box sx={{ pb: 6 }}>
      <SectionHeader title="Istio mesh overview" />

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(4, 1fr)' },
          px: 2,
        }}
      >
        <StatCard
          icon="mdi:cog-outline"
          label="Control plane"
          value={
            status.controlPlaneLoading
              ? 'Loading…'
              : status.controlPlaneUnknown
              ? 'Cannot determine'
              : version ?? 'Not found'
          }
          detail={
            status.controlPlaneLoading
              ? 'Checking Deployments'
              : status.controlPlaneUnknown
              ? `Deployment access denied in ${
                  status.controlPlaneForbiddenNamespaces.join(', ') || 'the cluster'
                }`
              : `${status.istiod.length} istiod deployment${status.istiod.length === 1 ? '' : 's'}`
          }
          tone={
            status.controlPlaneLoading
              ? 'warn'
              : status.controlPlaneUnknown
              ? 'warn'
              : status.istiod.length > 0
              ? 'ok'
              : 'bad'
          }
        />
        <StatCard
          icon="mdi:waves"
          label="Data plane mode"
          value={
            status.dataPlaneLoading
              ? 'Loading…'
              : status.ztunnelUnknown
              ? 'Cannot determine'
              : status.ambientEnabled
              ? enrolment.sidecar > 0
                ? 'Ambient + sidecar'
                : 'Ambient'
              : 'Sidecar'
          }
          detail={
            status.dataPlaneLoading
              ? 'Checking DaemonSets'
              : status.ztunnelUnknown
              ? 'DaemonSet access denied'
              : describeEnrolment(enrolment)
          }
          tone={status.dataPlaneLoading || status.ztunnelUnknown ? 'warn' : 'ok'}
        />
        <DaemonSetCard
          icon="mdi:tunnel-outline"
          label="ztunnel"
          ds={status.ztunnel}
          missingNote="not installed (sidecar mesh)"
          unknown={status.ztunnelUnknown}
          loading={status.dataPlaneLoading}
          forbiddenNamespaces={status.dataPlaneForbiddenNamespaces}
        />
        <DaemonSetCard
          icon="mdi:lan-connect"
          label="istio-cni"
          ds={status.cni}
          missingNote="not installed"
          unknown={status.cniUnknown}
          loading={status.dataPlaneLoading}
          forbiddenNamespaces={status.dataPlaneForbiddenNamespaces}
        />
      </Box>

      {(status.ztunnelUnknown || status.cniUnknown) && (
        <Box sx={{ px: 2, pt: 2 }}>
          <Alert severity="info">
            {status.ztunnelUnknown
              ? 'Ambient mode could not be confirmed'
              : 'Ambient mode was confirmed by ztunnel, but istio-cni could not be confirmed'}
            . DaemonSet access was denied in{' '}
            <Mono>
              {status.dataPlaneForbiddenNamespaces.length > 0
                ? status.dataPlaneForbiddenNamespaces.join(', ')
                : 'one or more namespaces'}
            </Mono>
            .
          </Alert>
        </Box>
      )}

      {status.ambientEnabled && !status.cni && !status.cniUnknown && (
        <Box sx={{ px: 2, pt: 2 }}>
          <Alert severity="error">
            ztunnel is running but the <Mono>istio-cni</Mono> DaemonSet is missing. Ambient mode
            cannot redirect traffic without it.
          </Alert>
        </Box>
      )}

      <SectionBox title="Namespace enrolment">
        <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
          <Chip
            icon={<Icon icon="mdi:waves" width={16} />}
            color="success"
            label={`${enrolment.ambient} ambient`}
          />
          <Chip
            icon={<Icon icon="mdi:car-side" width={16} />}
            color="info"
            label={`${enrolment.sidecar} sidecar`}
          />
          <Chip variant="outlined" label={`${enrolment.out} out of mesh`} />
        </Box>
        <SpecTable
          items={enrolment.rows}
          emptyText="No namespace is labelled for Istio."
          columns={[
            {
              label: 'Namespace',
              render: r => (
                <Link routeName="namespace" params={{ name: r.ns.metadata.name }}>
                  {r.ns.metadata.name}
                </Link>
              ),
            },
            { label: 'Mode', render: r => <MeshBadge state={r.state} /> },
            { label: 'Revision', render: r => <Mono>{r.state.revision}</Mono> },
            {
              label: 'Default waypoint',
              render: r =>
                r.waypoint.disabled ? (
                  <Chip size="small" label="disabled" variant="outlined" />
                ) : (
                  <Mono>{r.waypoint.name}</Mono>
                ),
            },
            {
              label: 'Why',
              render: r => (
                <Typography variant="body2" color="text.secondary">
                  {r.state.reason}
                </Typography>
              ),
            },
          ]}
        />
      </SectionBox>

      <WaypointSection waypoints={status.waypoints} />

      <SectionBox title="Installed Istio APIs">
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Sidebar entries are shown only for CRDs present in this cluster.
        </Typography>
        <SpecTable
          items={[...crds.values()].sort((a, b) => a.key.localeCompare(b.key))}
          emptyText="No Istio CRDs found."
          columns={[
            { label: 'Kind', render: c => <Mono>{c.kind}</Mono> },
            { label: 'Group', render: c => <Mono>{c.group}</Mono> },
            { label: 'Served versions', render: c => <ChipList items={c.servedVersions} /> },
          ]}
        />
      </SectionBox>
    </Box>
  );
}

export function WaypointSection({ waypoints }: { waypoints: any[] }) {
  return (
    <SectionBox title={`Waypoints (${waypoints.length})`}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Waypoints are Gateways of class <Mono>istio-waypoint</Mono>. They provide the L7 features
        that ztunnel does not: HTTP-level authorization, routing and telemetry.
      </Typography>
      <SpecTable
        items={waypoints}
        emptyText="No waypoints deployed. Only L4 policy is enforced in this mesh."
        columns={[
          {
            label: 'Name',
            render: w => (
              <Link
                routeName="gateway"
                params={{ name: w.metadata.name, namespace: w.metadata.namespace }}
              >
                {w.metadata.name}
              </Link>
            ),
          },
          {
            label: 'Namespace',
            render: w => (
              <Link routeName="namespace" params={{ name: w.metadata.namespace }}>
                {w.metadata.namespace}
              </Link>
            ),
          },
          {
            label: 'Handles',
            render: w => <Mono>{w.metadata.labels?.[WAYPOINT_FOR] ?? 'service (default)'}</Mono>,
          },
          {
            label: 'Programmed',
            render: w => {
              const cond = (w.jsonData?.status?.conditions ?? []).find(
                (c: any) => c.type === 'Programmed'
              );
              return (
                <Chip
                  size="small"
                  color={cond?.status === 'True' ? 'success' : 'error'}
                  label={cond?.status === 'True' ? 'Ready' : cond?.reason ?? 'Unknown'}
                  variant="outlined"
                />
              );
            },
          },
          {
            label: 'Address',
            render: w => (
              <Mono>
                {(w.jsonData?.status?.addresses ?? []).map((a: any) => a.value).join(', ')}
              </Mono>
            ),
          },
        ]}
      />
    </SectionBox>
  );
}

/**
 * Says how the mesh is actually split, rather than restating that ztunnel
 * exists -- the ztunnel card beside this one already shows that, with counts.
 */
function describeEnrolment({ ambient, sidecar }: { ambient: number; sidecar: number }): string {
  const parts = [
    ambient > 0 ? `${ambient} ambient` : '',
    sidecar > 0 ? `${sidecar} sidecar` : '',
  ].filter(Boolean);
  if (parts.length === 0) return 'no namespace is enrolled yet';
  return `${parts.join(', ')} ${ambient + sidecar === 1 ? 'namespace' : 'namespaces'}`;
}

function StatCard({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: string;
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone: 'ok' | 'bad' | 'warn';
}) {
  const color = tone === 'ok' ? 'success.main' : tone === 'warn' ? 'warning.main' : 'error.main';
  return (
    <Card variant="outlined">
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Icon icon={icon} width={20} />
          <Typography variant="overline" color="text.secondary">
            {label}
          </Typography>
        </Box>
        <Typography variant="h6" sx={{ color, wordBreak: 'break-word' }}>
          {value}
        </Typography>
        {detail && (
          <Typography variant="body2" color="text.secondary">
            {detail}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

function DaemonSetCard({
  icon,
  label,
  ds,
  missingNote,
  unknown,
  loading,
  forbiddenNamespaces = [],
}: {
  icon: string;
  label: string;
  ds: any;
  missingNote: string;
  unknown?: boolean;
  loading?: boolean;
  forbiddenNamespaces?: string[];
}) {
  if (loading && !ds) {
    return (
      <StatCard
        icon={icon}
        label={label}
        value="Loading…"
        detail="Checking DaemonSets"
        tone="warn"
      />
    );
  }
  if (!ds) {
    // Absent and unreadable look the same from here, so say which one it is.
    const deniedIn =
      forbiddenNamespaces.length > 0 ? forbiddenNamespaces.join(', ') : 'one or more namespaces';
    const [value, detail] = unknown
      ? ['unknown', `Access denied in ${deniedIn}`]
      : ['absent', missingNote];
    return <StatCard icon={icon} label={label} value={value} detail={detail} tone="warn" />;
  }
  const s = ds.jsonData?.status ?? {};
  const ready = s.numberReady ?? 0;
  const desired = s.desiredNumberScheduled ?? 0;
  return (
    <StatCard
      icon={icon}
      label={label}
      value={`${ready}/${desired}`}
      detail={ready === desired ? 'all nodes ready' : `${desired - ready} node(s) not ready`}
      tone={ready === desired && desired > 0 ? 'ok' : 'bad'}
    />
  );
}
