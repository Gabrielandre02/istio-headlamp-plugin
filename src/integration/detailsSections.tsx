import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { Alert, Box, Chip, Typography } from '@mui/material';
import { useMemo } from 'react';
import { EnumChip, MeshBadge } from '../components/common/Badges';
import { Mono, SpecTable } from '../components/detail/Table';
import { useMeshStatus, useRootNamespace } from '../lib/detect';
import { hostMatchesService } from '../lib/host';
import { REVISION, USE_WAYPOINT } from '../lib/labels';
import { namespaceMeshState, podMeshState, proxyContainer, resolveWaypoint } from '../lib/mesh';
import { policiesForService } from '../lib/servicePolicies';
import { detailRouteName, IstioObject } from '../resources/base';
import { DestinationRule, ServiceEntry, VirtualService } from '../resources/networking';
import { AuthorizationPolicy, PeerAuthentication } from '../resources/security';

/**
 * Istio context injected into Headlamp's own Service, Pod and Namespace pages.
 *
 * This is the reverse of the plugin's own list pages: instead of "what does
 * this DestinationRule apply to", it answers "what Istio config applies to the
 * thing I am already looking at" -- the question you otherwise answer by
 * grepping kubectl output across four resource kinds.
 */

function istioRoute(resource: IstioObject) {
  const cls = resource.constructor as any;
  return {
    routeName: detailRouteName(cls.urlSegment),
    params: { namespace: resource.metadata.namespace, name: resource.metadata.name },
  };
}

/**
 * A namespace we could not read may still carry the use-waypoint label, so an
 * object without its own label has an unknown waypoint rather than none. Only
 * the object's own label can be trusted while the namespace list is missing.
 */
function waypointUnknown(
  resource: KubeObject,
  namespaces: KubeObject[] | null,
  ns: KubeObject | null
) {
  return !resource.metadata.labels?.[USE_WAYPOINT] && (namespaces === null || ns === null);
}

function UnknownWaypoint() {
  return (
    <Typography variant="body2" color="text.secondary">
      unknown — namespace not readable
    </Typography>
  );
}

function ResourceLinks({ items }: { items: IstioObject[] }) {
  if (items.length === 0) {
    return (
      <Typography variant="body2" color="text.disabled">
        none
      </Typography>
    );
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      {items.map(i => (
        <Link key={i.metadata.uid} {...istioRoute(i)}>
          <Mono>
            {i.metadata.namespace}/{i.metadata.name}
          </Mono>
        </Link>
      ))}
    </Box>
  );
}

export function ServiceIstioSection({ resource }: { resource: KubeObject }) {
  const name = resource.metadata.name;
  const namespace = resource.metadata.namespace ?? '';

  const [virtualServices] = VirtualService.useList();
  const [destinationRules] = DestinationRule.useList();
  const [serviceEntries] = ServiceEntry.useList();
  // Cluster-wide: mesh-wide policies sit in the root namespace, and a waypoint
  // policy sits wherever the waypoint does.
  const [policies] = AuthorizationPolicy.useList();
  const [namespaces] = K8s.ResourceClasses.Namespace.useList();
  const rootNamespace = useRootNamespace();

  const ns = (namespaces ?? []).find(n => n.metadata.name === namespace) ?? null;
  const waypoint = resolveWaypoint(resource, ns as any);
  const unknown = waypointUnknown(resource, namespaces, ns);

  const matched = useMemo(() => {
    const vs = (virtualServices ?? []).filter(v =>
      (v.spec.hosts ?? []).some(h => hostMatchesService(h, name, namespace, v.metadata.namespace))
    );
    const dr = (destinationRules ?? []).filter(d =>
      d.host ? hostMatchesService(d.host, name, namespace, d.metadata.namespace) : false
    );
    const se = (serviceEntries ?? []).filter(s =>
      (s.spec.hosts ?? []).some(h => hostMatchesService(h, name, namespace, s.metadata.namespace))
    );
    const ap = policiesForService(policies ?? [], {
      name,
      namespace,
      rootNamespace,
      waypoint:
        waypoint.name && !waypoint.disabled
          ? { name: waypoint.name, namespace: waypoint.namespace ?? namespace }
          : undefined,
    });
    return { vs, dr, se, ap };
  }, [
    virtualServices,
    destinationRules,
    serviceEntries,
    policies,
    name,
    namespace,
    rootNamespace,
    waypoint.name,
    waypoint.namespace,
    waypoint.disabled,
  ]);

  const total = matched.vs.length + matched.dr.length + matched.se.length + matched.ap.length;
  if (total === 0 && !waypoint.name) return null;

  return (
    <SectionBox title="Istio">
      <SpecTable
        items={[
          {
            label: 'VirtualServices routing to this host',
            value: <ResourceLinks items={matched.vs} />,
          },
          { label: 'DestinationRules for this host', value: <ResourceLinks items={matched.dr} /> },
          {
            label: 'ServiceEntries claiming this host',
            value: <ResourceLinks items={matched.se} />,
          },
          { label: 'AuthorizationPolicies', value: <ResourceLinks items={matched.ap} /> },
          {
            label: 'Waypoint',
            value: unknown ? (
              <UnknownWaypoint />
            ) : waypoint.disabled ? (
              <Chip size="small" label="explicitly disabled" variant="outlined" />
            ) : waypoint.name ? (
              <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1 }}>
                <Link
                  routeName="gateway"
                  params={{ name: waypoint.name, namespace: waypoint.namespace ?? namespace }}
                >
                  <Mono>{waypoint.name}</Mono>
                </Link>
                <Typography variant="caption" color="text.secondary">
                  via {waypoint.source} label
                </Typography>
              </Box>
            ) : (
              <Typography variant="body2" color="text.disabled">
                none — L4 only
              </Typography>
            ),
          },
        ]}
        columns={[
          {
            label: '',
            render: r => (
              <Typography variant="body2" color="text.secondary">
                {r.label}
              </Typography>
            ),
            width: '40%',
          },
          { label: ' ', render: r => r.value },
        ]}
      />
    </SectionBox>
  );
}

export function PodIstioSection({ resource }: { resource: KubeObject }) {
  const namespace = resource.metadata.namespace ?? '';
  const [namespaces] = K8s.ResourceClasses.Namespace.useList();
  const ns = (namespaces ?? []).find(n => n.metadata.name === namespace) ?? null;

  const state = podMeshState(resource, ns as any);
  const waypoint = resolveWaypoint(resource, ns as any);
  const unknown = waypointUnknown(resource, namespaces, ns);

  const proxy = proxyContainer(resource);

  return (
    <SectionBox title="Istio">
      <SpecTable
        items={[
          { label: 'Mesh', value: <MeshBadge state={state} /> },
          {
            label: 'Reason',
            value: (
              <Typography variant="body2" color="text.secondary">
                {state.reason}
              </Typography>
            ),
          },
          ...(proxy ? [{ label: 'Proxy image', value: <Mono>{proxy.image}</Mono> }] : []),
          {
            label: 'Waypoint',
            value: unknown ? (
              <UnknownWaypoint />
            ) : waypoint.name && !waypoint.disabled ? (
              <Mono>{waypoint.name}</Mono>
            ) : (
              <Typography variant="body2" color="text.disabled">
                none
              </Typography>
            ),
          },
        ]}
        columns={[
          {
            label: '',
            render: r => (
              <Typography variant="body2" color="text.secondary">
                {r.label}
              </Typography>
            ),
            width: '40%',
          },
          { label: ' ', render: r => r.value },
        ]}
      />
    </SectionBox>
  );
}

export function NamespaceIstioSection({ resource }: { resource: KubeObject }) {
  const name = resource.metadata.name;
  const { ambientEnabled } = useMeshStatus();
  const [peerAuths] = PeerAuthentication.useList({ namespace: name });
  const rootNamespace = useRootNamespace();
  const [rootPeerAuths] = PeerAuthentication.useList({ namespace: rootNamespace });

  const state = namespaceMeshState(resource);
  const waypoint = resolveWaypoint(resource, resource);

  const nsWide = (peerAuths ?? []).find(p => p.attachmentKind === 'namespace');
  const meshWide = (rootPeerAuths ?? []).find(p => p.attachmentKind === 'namespace');
  const effective = nsWide ?? meshWide;

  return (
    <SectionBox title="Istio">
      {state.mode === 'out-of-mesh' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          This namespace is not enrolled in the mesh. Label it{' '}
          <Mono>istio.io/dataplane-mode=ambient</Mono>
          {ambientEnabled ? '' : ' or istio-injection=enabled'} to enrol it.
        </Alert>
      )}
      <SpecTable
        items={[
          { label: 'Mesh', value: <MeshBadge state={state} /> },
          {
            label: 'Reason',
            value: (
              <Typography variant="body2" color="text.secondary">
                {state.reason}
              </Typography>
            ),
          },
          {
            label: 'Revision',
            // Without an istio.io/rev label the default revision serves the
            // namespace, which a bare dash does not say.
            value:
              state.revision || (state.mode !== 'ambient' && state.mode !== 'sidecar') ? (
                <Mono>{state.revision}</Mono>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  default (no {REVISION} label)
                </Typography>
              ),
          },
          {
            label: 'Default waypoint',
            value: waypoint.disabled ? (
              <Chip size="small" label={`disabled (${USE_WAYPOINT}=none)`} variant="outlined" />
            ) : waypoint.name ? (
              <Mono>{waypoint.name}</Mono>
            ) : (
              <Typography variant="body2" color="text.disabled">
                none
              </Typography>
            ),
          },
          {
            label: 'Effective mTLS',
            value: effective ? (
              <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1 }}>
                <EnumChip
                  value={effective.mtlsMode}
                  good={['STRICT']}
                  bad={['DISABLE']}
                  neutral={['UNSET', 'PERMISSIVE']}
                />
                <Typography variant="caption" color="text.secondary">
                  from {effective === nsWide ? 'this namespace' : 'mesh-wide policy'} (
                  {effective.metadata.name})
                </Typography>
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary">
                no PeerAuthentication — mesh default (PERMISSIVE)
              </Typography>
            ),
          },
        ]}
        columns={[
          {
            label: '',
            render: r => (
              <Typography variant="body2" color="text.secondary">
                {r.label}
              </Typography>
            ),
            width: '40%',
          },
          { label: ' ', render: r => r.value },
        ]}
      />
    </SectionBox>
  );
}
