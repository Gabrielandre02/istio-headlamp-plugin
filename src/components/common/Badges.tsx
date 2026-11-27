import { Icon } from '@iconify/react';
import { Router } from '@kinvolk/headlamp-plugin/lib';
import { Box, Chip, Link as MuiLink, Tooltip, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { MeshMode, MeshState } from '../../lib/mesh';
import { IstioObject } from '../../resources/base';
import { LabelPairs } from './SpecSection';

const MESH_STYLE: Record<
  MeshMode,
  { label: string; color: 'success' | 'info' | 'default' | 'warning'; icon: string }
> = {
  ambient: { label: 'Ambient', color: 'success', icon: 'mdi:waves' },
  sidecar: { label: 'Sidecar', color: 'info', icon: 'mdi:car-side' },
  infra: { label: 'Istio infra', color: 'default', icon: 'mdi:cog-outline' },
  'out-of-mesh': { label: 'Out of mesh', color: 'default', icon: 'mdi:link-variant-off' },
  unknown: { label: 'Unknown', color: 'warning', icon: 'mdi:help-circle-outline' },
};

/** Compact indicator of how a workload or namespace participates in the mesh. */
export function MeshBadge({ state }: { state: MeshState }) {
  const style = MESH_STYLE[state.mode];
  return (
    <Tooltip title={state.reason}>
      <Chip
        size="small"
        color={style.color}
        variant={state.mode === 'out-of-mesh' || state.mode === 'infra' ? 'outlined' : 'filled'}
        icon={<Icon icon={style.icon} width={16} />}
        label={state.share ? `${style.label} ${state.share}` : style.label}
      />
    </Tooltip>
  );
}

/**
 * How an Istio resource selects the workloads it affects.
 *
 * Ambient-era resources attach through `targetRefs` (a Gateway API style
 * reference to a Service or waypoint Gateway), while sidecar-era ones use a
 * label selector. Showing which mechanism is in play, and that "neither" means
 * namespace-wide, removes most of the guesswork around policy scope.
 */
export function AppliesTo({ resource }: { resource: IstioObject }) {
  const kind = resource.attachmentKind;
  const namespace = resource.metadata.namespace;

  if (kind === 'targetRef') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {resource.targetRefs.map((ref, i) => (
          <TargetRefChip key={i} refObj={ref} fallbackNamespace={namespace} />
        ))}
      </Box>
    );
  }

  if (kind === 'selector') {
    return (
      <Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
          Workloads in <b>{namespace}</b> matching:
        </Typography>
        <LabelPairs labels={resource.selectorLabels} />
      </Box>
    );
  }

  return (
    <Typography variant="body2">
      All workloads in namespace <b>{namespace}</b>
    </Typography>
  );
}

export function TargetRefChip({
  refObj,
  fallbackNamespace,
}: {
  refObj: { group?: string; kind?: string; name?: string; namespace?: string };
  fallbackNamespace?: string;
}) {
  const ns = refObj.namespace ?? fallbackNamespace;
  const label = `${refObj.kind ?? 'Unknown'}/${refObj.name ?? '?'}`;

  if (refObj.kind === 'Service' && refObj.name && ns) {
    return (
      <MuiLink
        component={RouterLink}
        to={Router.createRouteURL('service', { name: refObj.name, namespace: ns })}
        underline="none"
        color="inherit"
      >
        <Chip
          size="small"
          icon={<Icon icon="mdi:kubernetes" width={16} />}
          label={label}
          variant="outlined"
          clickable
        />
      </MuiLink>
    );
  }
  if (refObj.kind === 'Gateway' && refObj.name && ns) {
    return (
      <MuiLink
        component={RouterLink}
        to={Router.createRouteURL('gateway', { name: refObj.name, namespace: ns })}
        underline="none"
        color="inherit"
      >
        <Chip
          size="small"
          icon={<Icon icon="mdi:door-open" width={16} />}
          label={label}
          variant="outlined"
          clickable
        />
      </MuiLink>
    );
  }
  return <Chip size="small" label={label} variant="outlined" />;
}

/** Colour-coded chip for enum-ish spec values (mTLS mode, resolution, action). */
export function EnumChip({
  value,
  good,
  bad,
  neutral,
}: {
  value?: string;
  good?: string[];
  bad?: string[];
  neutral?: string[];
}) {
  if (!value) {
    return (
      <Typography component="span" variant="body2" color="text.disabled">
        —
      </Typography>
    );
  }
  let color: 'success' | 'error' | 'default' | 'info' = 'info';
  if (good?.includes(value)) color = 'success';
  else if (bad?.includes(value)) color = 'error';
  else if (neutral?.includes(value)) color = 'default';
  return (
    <Chip
      size="small"
      label={value}
      color={color}
      variant="outlined"
      sx={{ fontFamily: 'monospace' }}
    />
  );
}
