import { SectionBox, SectionHeader } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box, Typography } from '@mui/material';
import { isForbidden, useMeshConfig } from '../../lib/meshConfig';
import { ProxyConfig } from '../../resources/networking';
import { GenericList } from '../common/GenericList';
import { InlineSpec } from '../common/InlineSpec';
import { ChipList, Row, SpecSection } from '../common/SpecSection';
import { SpecTree } from '../common/SpecTree';
import { Mono } from './Table';

/**
 * Proxy configuration, mesh default first and per-workload overrides second.
 *
 * ProxyConfig resources are rare; the settings that actually apply to every
 * proxy live in `meshConfig.defaultConfig` in the `istio` ConfigMap. Listing
 * only the resources left this page blank on clusters that are configured
 * perfectly well, and said nothing about what the proxies are actually running
 * with.
 */
export function ProxyConfigsPage() {
  const { defaultConfig, sourceName, namespace, loading, error } = useMeshConfig();

  return (
    <Box sx={{ pb: 6 }}>
      <SectionHeader title="Proxy configuration" />

      <MeshDefaultSection
        defaultConfig={defaultConfig}
        sourceName={sourceName}
        namespace={namespace}
        loading={loading}
        error={error}
      />

      <ProxyConfigOverrides />
    </Box>
  );
}

function MeshDefaultSection({
  defaultConfig,
  sourceName,
  namespace,
  loading,
  error,
}: {
  defaultConfig?: Record<string, unknown>;
  sourceName?: string;
  namespace: string;
  loading: boolean;
  error: unknown;
}) {
  if (loading) return null;

  if (error) {
    return (
      <SectionBox title="Mesh default">
        <Alert severity={isForbidden(error) ? 'info' : 'warning'}>
          {isForbidden(error)
            ? `You do not have permission to read ConfigMaps in ${namespace}, so the mesh-wide proxy defaults cannot be shown.`
            : 'The istio ConfigMap could not be read, so the mesh-wide proxy defaults cannot be shown.'}
        </Alert>
      </SectionBox>
    );
  }

  if (!defaultConfig || Object.keys(defaultConfig).length === 0) {
    return (
      <SectionBox title="Mesh default">
        <Typography variant="body2" color="text.secondary">
          {sourceName
            ? `${sourceName} defines no meshConfig.defaultConfig, so proxies run with Istio's built-in defaults.`
            : `No istio ConfigMap was found in ${namespace}.`}
        </Typography>
      </SectionBox>
    );
  }

  const rows: Row[] = [
    { name: 'Concurrency', value: valueOf(defaultConfig.concurrency) },
    { name: 'Discovery address', value: valueOf(defaultConfig.discoveryAddress) },
    {
      name: 'Hold application until proxy starts',
      value: valueOf(defaultConfig.holdApplicationUntilProxyStarts),
    },
    { name: 'Termination drain duration', value: valueOf(defaultConfig.terminationDrainDuration) },
    { name: 'Proxy metadata', value: metadataChips(defaultConfig.proxyMetadata) },
    {
      name: 'Image',
      value: defaultConfig.image ? <InlineSpec value={defaultConfig.image} /> : undefined,
    },
  ];

  // Whatever the rows above do not cover. On most clusters this is empty, and
  // rendering the whole of defaultConfig underneath them just repeated it.
  const remaining = Object.fromEntries(
    Object.entries(defaultConfig).filter(([key]) => !SUMMARISED_KEYS.has(key))
  );

  return (
    <SpecSection title="Mesh default" rows={rows}>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        From <Mono>{`${namespace}/${sourceName}`}</Mono>, key <Mono>mesh</Mono> →{' '}
        <Mono>defaultConfig</Mono>. These apply to every proxy in the mesh unless a ProxyConfig
        below overrides them.
      </Typography>
      {Object.keys(remaining).length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Other settings
          </Typography>
          <SpecTree value={remaining} collapseDepth={1} />
        </Box>
      )}
    </SpecSection>
  );
}

/** Fields the summary rows already show, so the tree below does not repeat them. */
const SUMMARISED_KEYS = new Set([
  'concurrency',
  'discoveryAddress',
  'holdApplicationUntilProxyStarts',
  'terminationDrainDuration',
  'proxyMetadata',
  'image',
]);

/** The ProxyConfig resources themselves, which layer on top of the mesh default. */
function ProxyConfigOverrides() {
  return (
    <Box>
      <GenericList
        id="istio-proxyconfigs"
        title="Overrides (ProxyConfig)"
        resourceClass={ProxyConfig}
        columns={[
          {
            id: 'concurrency',
            label: 'Concurrency',
            getValue: (p: ProxyConfig) => p.spec.concurrency ?? '',
          },
          {
            id: 'selector',
            label: 'Applies to',
            getValue: (p: ProxyConfig) => JSON.stringify(p.spec.selector?.matchLabels ?? {}),
            render: (p: ProxyConfig) => {
              const labels = p.spec.selector?.matchLabels;
              return labels && Object.keys(labels).length > 0 ? (
                <ChipList items={Object.entries(labels).map(([k, v]) => `${k}=${v}`)} />
              ) : (
                <Typography variant="body2" color="text.secondary">
                  all of {p.metadata.namespace}
                </Typography>
              );
            },
          },
        ]}
        description="ProxyConfig resources override the mesh default for a namespace or for the workloads they select. Most meshes have none, and that is normal."
      />
    </Box>
  );
}

function valueOf(value: unknown) {
  if (value === undefined || value === null) return undefined;
  return <Mono>{String(value)}</Mono>;
}

function metadataChips(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const entries = Object.entries(metadata as Record<string, string>);
  if (entries.length === 0) return undefined;
  return <ChipList items={entries.map(([k, v]) => `${k}=${v}`)} />;
}
