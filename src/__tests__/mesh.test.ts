import { describe, expect, it } from 'vitest';
import { hostMatchesService, parseHost, serviceFqdn } from '../lib/host';
import {
  istioInfraRole,
  namespaceMeshState,
  podMeshState,
  proxyContainer,
  resolveWaypoint,
} from '../lib/mesh';
import { namespaces, pods, services, waypoints } from './fixtures';

const ns = (name: string) => namespaces.find(n => n.metadata.name === name);
const svc = (name: string) => services.find(s => s.metadata.name === name);

/** Fixtures are plain JSON; the mesh helpers only read metadata and jsonData.spec. */
const asObj = (json: any) => ({ metadata: json.metadata, jsonData: json } as any);

describe('namespaceMeshState', () => {
  it('reports ambient for a dataplane-mode=ambient namespace', () => {
    const state = namespaceMeshState(asObj(ns('shop')));
    expect(state.mode).toBe('ambient');
    expect(state.reason).toContain('istio.io/dataplane-mode=ambient');
  });

  it('reports sidecar for an istio-injection=enabled namespace', () => {
    expect(namespaceMeshState(asObj(ns('legacy'))).mode).toBe('sidecar');
  });

  it('reports out-of-mesh for an unlabelled namespace', () => {
    expect(namespaceMeshState(asObj(ns('nomesh'))).mode).toBe('out-of-mesh');
  });

  it('does not treat istio-system itself as enrolled', () => {
    expect(namespaceMeshState(asObj(ns('istio-system'))).mode).toBe('out-of-mesh');
  });
});

const pod = (match: string) => pods.find(p => p.metadata.name.includes(match));

describe('istioInfraRole', () => {
  it('recognises ztunnel, which runs a container named istio-proxy', () => {
    expect(istioInfraRole(asObj(pod('ztunnel')))).toBe('Istio ztunnel');
  });

  it('recognises a waypoint proxy by its managed-gateway labels', () => {
    expect(istioInfraRole(asObj(pod('waypoint')))).toBe('waypoint proxy');
  });

  it('recognises the control plane and the CNI installer', () => {
    expect(istioInfraRole(asObj(pod('istiod')))).toBe('Istio istiod');
    expect(istioInfraRole(asObj(pod('istio-cni')))).toBe('Istio istio-cni');
  });

  it('does not claim ordinary application pods', () => {
    expect(istioInfraRole(asObj(pod('reviews')))).toBeUndefined();
    expect(istioInfraRole(asObj(pod('orders')))).toBeUndefined();
  });
});

describe('podMeshState', () => {
  // Regression: ztunnel and waypoint pods both run an `istio-proxy` container,
  // so sniffing containers alone labelled them "Sidecar" on an ambient cluster.
  it('classifies ztunnel as Istio infrastructure, not a sidecar workload', () => {
    const state = podMeshState(asObj(pod('ztunnel')), asObj(ns('istio-system')));
    expect(state.mode).toBe('infra');
    expect(state.reason).toContain('ztunnel');
  });

  it('classifies a waypoint proxy as infrastructure, not a sidecar workload', () => {
    const state = podMeshState(asObj(pod('waypoint')), asObj(ns('legacy')));
    expect(state.mode).toBe('infra');
    expect(state.reason).toContain('waypoint');
  });

  it('classifies istiod and the CNI installer as infrastructure', () => {
    expect(podMeshState(asObj(pod('istiod')), asObj(ns('istio-system'))).mode).toBe('infra');
    expect(podMeshState(asObj(pod('istio-cni')), asObj(ns('istio-system'))).mode).toBe('infra');
  });

  it('still reports sidecar for a real injected workload carrying dataplane-mode=none', () => {
    // Istio stamps dataplane-mode=none onto injected pods to keep them out of
    // ambient, so that label must not be treated as an opt-out on its own.
    const injected = asObj({
      metadata: { name: 'app', namespace: 'legacy', labels: { 'istio.io/dataplane-mode': 'none' } },
      spec: { containers: [{ name: 'app' }, { name: 'istio-proxy' }] },
    });
    expect(podMeshState(injected, asObj(ns('legacy'))).mode).toBe('sidecar');
  });

  it('reports ambient for an uninjected pod in an ambient namespace', () => {
    const pod = pods.find(p => p.metadata.namespace === 'shop');
    expect(pod).toBeDefined();
    const state = podMeshState(asObj(pod), asObj(ns('shop')));
    expect(state.mode).toBe('ambient');
  });

  it('reports sidecar when an istio-proxy container is present', () => {
    const fake = asObj({
      metadata: { name: 'p', namespace: 'legacy' },
      spec: { containers: [{ name: 'app' }, { name: 'istio-proxy' }] },
    });
    expect(podMeshState(fake, asObj(ns('legacy'))).mode).toBe('sidecar');
  });

  it('reports sidecar when istio-proxy runs as a native sidecar init container', () => {
    const fake = asObj({
      metadata: { name: 'p', namespace: 'legacy' },
      spec: {
        initContainers: [{ name: 'istio-init' }, { name: 'istio-proxy', restartPolicy: 'Always' }],
        containers: [{ name: 'app' }],
      },
    });
    expect(podMeshState(fake, asObj(ns('legacy'))).mode).toBe('sidecar');
  });

  it('does not treat a non-restartable istio-proxy init container as a sidecar', () => {
    const fake = asObj({
      metadata: { name: 'p', namespace: 'legacy' },
      spec: { initContainers: [{ name: 'istio-proxy' }], containers: [{ name: 'app' }] },
    });
    expect(podMeshState(fake, asObj(ns('legacy'))).mode).toBe('out-of-mesh');
  });

  it('finds the proxy container of a native sidecar, so its image can be shown', () => {
    const fake = asObj({
      metadata: { name: 'p', namespace: 'legacy' },
      spec: {
        initContainers: [{ name: 'istio-proxy', image: 'proxyv2:1.30.1', restartPolicy: 'Always' }],
        containers: [{ name: 'app' }],
      },
    });
    expect(proxyContainer(fake)?.image).toBe('proxyv2:1.30.1');
  });

  it('flags a pod in an injection-enabled namespace that has no sidecar', () => {
    const fake = asObj({
      metadata: { name: 'p', namespace: 'legacy' },
      spec: { containers: [{ name: 'app' }] },
    });
    const state = podMeshState(fake, asObj(ns('legacy')));
    expect(state.mode).toBe('out-of-mesh');
    expect(state.reason).toContain('restart');
  });

  it('does not ask for a restart of a host-network pod, which the injector skips', () => {
    const fake = asObj({
      metadata: { name: 'p', namespace: 'legacy' },
      spec: { hostNetwork: true, containers: [{ name: 'app' }] },
    });
    const state = podMeshState(fake, asObj(ns('legacy')));
    expect(state.mode).toBe('out-of-mesh');
    expect(state.reason).toContain('host-network');
    expect(state.reason).not.toContain('restart');
  });

  it('honours a pod-level opt-out of ambient', () => {
    const fake = asObj({
      metadata: { name: 'p', namespace: 'shop', labels: { 'istio.io/dataplane-mode': 'none' } },
      spec: { containers: [{ name: 'app' }] },
    });
    expect(podMeshState(fake, asObj(ns('shop'))).mode).toBe('out-of-mesh');
  });
});

describe('resolveWaypoint', () => {
  it('inherits the namespace default waypoint', () => {
    const binding = resolveWaypoint(asObj(svc('reviews')), asObj(ns('shop')));
    expect(binding.name).toBe('shop-waypoint');
    expect(binding.source).toBe('namespace');
    expect(binding.disabled).toBe(false);
  });

  it('honours an object-level opt-out that overrides the namespace default', () => {
    const binding = resolveWaypoint(asObj(svc('orders')), asObj(ns('shop')));
    expect(binding.disabled).toBe(true);
    expect(binding.source).toBe('object');
    expect(binding.name).toBeUndefined();
  });

  it('returns no binding for a namespace without the label', () => {
    expect(resolveWaypoint(asObj(ns('nomesh')), asObj(ns('nomesh'))).name).toBeUndefined();
  });
});

describe('waypoint fixtures', () => {
  it('captured both waypoint Gateways', () => {
    expect(waypoints.map(w => w.metadata.name).sort()).toEqual([
      'orphan-waypoint',
      'shop-waypoint',
    ]);
    waypoints.forEach(w => expect(w.spec.gatewayClassName).toBe('istio-waypoint'));
  });
});

describe('parseHost', () => {
  it('parses a fully qualified cluster host', () => {
    const p = parseHost('reviews.shop.svc.cluster.local');
    expect(p).toMatchObject({ serviceName: 'reviews', namespace: 'shop', isClusterLocal: true });
  });

  it('resolves a short name against the resource namespace', () => {
    expect(parseHost('reviews', 'shop')).toMatchObject({
      serviceName: 'reviews',
      namespace: 'shop',
    });
  });

  it('treats a public domain as external, not name.namespace', () => {
    expect(parseHost('payments.example.com').isClusterLocal).toBe(false);
    expect(parseHost('api.com').isClusterLocal).toBe(false);
  });

  it('extracts the namespace scope from the ns/host form', () => {
    expect(parseHost('istio-system/*')).toMatchObject({ scope: 'istio-system', isWildcard: true });
  });

  it('marks wildcards', () => {
    expect(parseHost('*.example.com').isWildcard).toBe(true);
  });
});

describe('hostMatchesService', () => {
  it('matches the real DestinationRule host to its Service', () => {
    expect(hostMatchesService('reviews.shop.svc.cluster.local', 'reviews', 'shop')).toBe(true);
  });

  it('matches a short host against the rule namespace', () => {
    expect(hostMatchesService('reviews', 'reviews', 'shop', 'shop')).toBe(true);
  });

  it('does not match a different namespace', () => {
    expect(hostMatchesService('reviews.other.svc.cluster.local', 'reviews', 'shop')).toBe(false);
  });

  it('matches "*"', () => {
    expect(hostMatchesService('*', 'reviews', 'shop')).toBe(true);
  });

  it('matches a suffix wildcard', () => {
    expect(hostMatchesService('*.shop.svc.cluster.local', 'reviews', 'shop')).toBe(true);
  });

  // The `ns/host` form Sidecar egress uses restricts which namespace the host
  // may resolve in. Stripping the prefix instead of honouring it made a host
  // scoped to one namespace match Services in every namespace.
  it('honours a namespace scope that matches', () => {
    expect(hostMatchesService('shop/*.shop.svc.cluster.local', 'reviews', 'shop')).toBe(true);
  });

  it('rejects a host scoped to a different namespace', () => {
    expect(hostMatchesService('other/*.shop.svc.cluster.local', 'reviews', 'shop')).toBe(false);
    expect(hostMatchesService('other/reviews.shop.svc.cluster.local', 'reviews', 'shop')).toBe(
      false
    );
  });

  it('treats the "*" scope as any namespace', () => {
    expect(hostMatchesService('*/reviews.shop.svc.cluster.local', 'reviews', 'shop')).toBe(true);
  });

  it('resolves the "." scope against the namespace declaring the host', () => {
    expect(hostMatchesService('./reviews', 'reviews', 'shop', 'shop')).toBe(true);
    expect(hostMatchesService('./reviews.shop.svc.cluster.local', 'reviews', 'shop', 'other')).toBe(
      false
    );
  });

  it('builds the canonical FQDN', () => {
    expect(serviceFqdn('reviews', 'shop')).toBe('reviews.shop.svc.cluster.local');
  });
});
