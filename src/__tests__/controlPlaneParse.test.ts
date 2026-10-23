import { describe, expect, it } from 'vitest';
import { controlPlaneNamespace, dataPlaneNamespaces, isIstiod } from '../lib/controlPlaneParse';

const istiod = (namespace: string, name = 'istiod') => ({ metadata: { name, namespace } });

describe('controlPlaneNamespace', () => {
  it('uses the namespace istiod runs in', () => {
    expect(controlPlaneNamespace([istiod('aks-istio-system', 'istiod-asm-1-30')])).toBe(
      'aks-istio-system'
    );
  });

  it('prefers istio-system when istiod runs in several namespaces', () => {
    expect(controlPlaneNamespace([istiod('a-mesh'), istiod('istio-system')])).toBe('istio-system');
  });

  it('picks the same namespace whatever order the API lists them in', () => {
    expect(controlPlaneNamespace([istiod('mesh-b'), istiod('mesh-a')])).toBe('mesh-a');
    expect(controlPlaneNamespace([istiod('mesh-a'), istiod('mesh-b')])).toBe('mesh-a');
  });

  it('falls back to istio-system when no istiod is found', () => {
    expect(controlPlaneNamespace([])).toBe('istio-system');
  });
});

describe('isIstiod', () => {
  it('matches revisioned istiod names', () => {
    expect(isIstiod({ metadata: { name: 'istiod-asm-1-30' } })).toBe(true);
  });

  it('matches the app=istiod label used for discovery, whatever the name', () => {
    expect(isIstiod({ metadata: { name: 'pilot', labels: { app: 'istiod' } } })).toBe(true);
  });

  it('ignores other Deployments', () => {
    expect(isIstiod({ metadata: { name: 'istio-ingressgateway', labels: { app: 'istio' } } })).toBe(
      false
    );
  });
});

describe('dataPlaneNamespaces', () => {
  it('still looks in istio-system when istiod runs elsewhere', () => {
    expect(dataPlaneNamespaces('aks-istio-system')).toEqual([
      'aks-istio-system',
      'istio-system',
      'kube-system',
    ]);
  });

  it('lists istio-system once', () => {
    expect(dataPlaneNamespaces('istio-system')).toEqual(['istio-system', 'kube-system']);
  });

  it('lists kube-system once when istiod runs there', () => {
    expect(dataPlaneNamespaces('kube-system')).toEqual(['kube-system', 'istio-system']);
  });
});
