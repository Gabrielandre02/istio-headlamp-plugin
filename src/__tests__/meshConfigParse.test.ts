import { describe, expect, it } from 'vitest';
import { meshRootNamespace, parseMeshConfig, pickMeshConfigMap } from '../lib/meshConfigParse';

const cm = (name: string, mesh?: string) => ({
  metadata: { name },
  jsonData: { data: mesh === undefined ? {} : { mesh } },
});

describe('pickMeshConfigMap', () => {
  it('prefers the unrevisioned istio ConfigMap', () => {
    const picked = pickMeshConfigMap([cm('istio-1-26-0', 'a: 1'), cm('istio', 'b: 2')]);
    expect(picked?.metadata.name).toBe('istio');
  });

  it('falls back to a revisioned ConfigMap that carries a mesh config', () => {
    const picked = pickMeshConfigMap([cm('istio-sidecar-injector'), cm('istio-1-26-0', 'a: 1')]);
    expect(picked?.metadata.name).toBe('istio-1-26-0');
  });

  it('returns nothing when no ConfigMap holds a mesh config', () => {
    expect(pickMeshConfigMap([cm('istio-ca-root-cert')])).toBeUndefined();
  });
});

describe('parseMeshConfig', () => {
  it('parses nested mesh config', () => {
    const parsed = parseMeshConfig('defaultConfig:\n  discoveryAddress: istiod:15012\n');
    expect(parsed).toEqual({ defaultConfig: { discoveryAddress: 'istiod:15012' } });
  });

  it('returns undefined for missing or unparsable input', () => {
    expect(parseMeshConfig(undefined)).toBeUndefined();
    expect(parseMeshConfig('\tnot: [valid')).toBeUndefined();
  });

  it('returns undefined for a scalar document', () => {
    expect(parseMeshConfig('just-a-string')).toBeUndefined();
  });
});

describe('meshRootNamespace', () => {
  it('reads a custom rootNamespace', () => {
    expect(meshRootNamespace({ rootNamespace: 'mesh-root' })).toBe('mesh-root');
  });

  it('ignores a nested key of the same name', () => {
    expect(meshRootNamespace({ defaultConfig: { rootNamespace: 'nested' } })).toBe('istio-system');
  });

  it('falls back to istio-system without a mesh config', () => {
    expect(meshRootNamespace(undefined)).toBe('istio-system');
  });

  it('falls back to the control-plane namespace, as Istio does', () => {
    expect(meshRootNamespace(undefined, 'aks-istio-system')).toBe('aks-istio-system');
    expect(meshRootNamespace({ rootNamespace: 'mesh-root' }, 'aks-istio-system')).toBe('mesh-root');
  });
});
