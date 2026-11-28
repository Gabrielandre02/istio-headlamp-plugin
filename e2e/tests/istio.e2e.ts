import { expect, Page, test } from '@playwright/test';

/**
 * Checks against the sample mesh from dev/sample-istio-config.yaml: an ambient
 * `shop` namespace behind `shop-waypoint`, a sidecar `legacy` namespace, and
 * policies built to hit the L7 enforcement cases.
 *
 * These cover what unit tests cannot: that the plugin loads into a real
 * Headlamp, reads a real API server, and puts its sections on Headlamp's own
 * pages.
 */

const CLUSTER = process.env.HEADLAMP_CLUSTER ?? 'kind-istio-dev';
// Relative, so the path stays under a base URL such as /headlamp/.
const go = (page: Page, path: string) => page.goto(`c/${CLUSTER}${path}`);

/** The Istio section Headlamp's own detail pages get from the plugin. */
const istioSection = (page: Page) =>
  page
    .getByRole('heading', { name: 'Istio', exact: true })
    .locator('xpath=ancestor::*[.//table][1]');

test('the sidebar lists the Istio section', async ({ page }) => {
  await go(page, '/');
  const nav = page.getByRole('navigation');
  await nav.getByText('Istio', { exact: true }).click();
  await expect(nav.getByText('Mesh Overview', { exact: true })).toBeVisible();
  await expect(nav.getByText('Waypoints', { exact: true })).toBeVisible();
});

test('mesh overview reports ambient and sidecar namespaces', async ({ page }) => {
  await go(page, '/istio');
  await expect(page.getByRole('heading', { name: 'Istio mesh overview' })).toBeVisible();
  await expect(page.getByText('Ambient + sidecar')).toBeVisible();
  const enrolment = page.getByRole('row').filter({ hasText: 'shop-waypoint' }).first();
  await expect(enrolment).toContainText('Ambient');
});

test('VirtualService detail renders the spec without the editor', async ({ page }) => {
  await go(page, '/istio/virtualservices/shop/reviews');
  await expect(page.getByText('VirtualService: reviews')).toBeVisible();
  await expect(page.getByText(/HTTP routes/)).toBeVisible();
  await expect(page.getByText('Full spec')).toBeVisible();
});

test('DestinationRule detail renders traffic policy and subsets', async ({ page }) => {
  await go(page, '/istio/destinationrules/shop/reviews');
  await expect(page.getByRole('heading', { name: 'Traffic policy' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Subsets/ })).toBeVisible();
});

// The full spec leads with the tree and offers YAML behind the toggle, for
// reading the document as written and copying it back out.
test('Full spec shows the tree and switches to YAML', async ({ page }) => {
  await go(page, '/istio/virtualservices/shop/reviews');
  await expect(page.getByText('Full spec')).toBeVisible();
  await expect(page.getByText('[0] canary')).toBeVisible();

  await page.getByRole('button', { name: 'YAML' }).click();
  await expect(page.locator('pre').filter({ hasText: 'hosts:' }).first()).toContainText(
    'reviews.shop.svc.cluster.local'
  );

  await page.getByRole('button', { name: 'Tree' }).click();
  await expect(page.getByText('[0] canary')).toBeVisible();
});

// The mesh default lives in a ConfigMap, not in ProxyConfig resources, and the
// page was empty on clusters configured entirely through that ConfigMap.
test('Proxy Configs shows the mesh default and the overrides', async ({ page }) => {
  await go(page, '/istio/proxyconfigs');
  await expect(page.getByRole('heading', { name: 'Mesh default' })).toBeVisible();
  await expect(page.getByText('istiod.istio-system.svc:15012')).toBeVisible();
  await expect(page.getByText('istio-system/istio')).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Overrides (ProxyConfig)' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'shop-proxy' })).toBeVisible();
});

test('an L7 policy whose Service has no waypoint is flagged as unenforced', async ({ page }) => {
  await go(page, '/istio/authorizationpolicies/shop/orders-l7-unenforced');
  await expect(page.getByText('This policy is not enforced for these Services')).toBeVisible();
});

// The chip once imported a router path that Headlamp does not expose to
// plugins, and the whole "Applies to" cell failed to render.
test('a targetRef chip opens the Service within Headlamp', async ({ page }) => {
  await go(page, '/istio/authorizationpolicies/shop/reviews-read-only');
  await page.evaluate(() => ((window as { spaMarker?: boolean }).spaMarker = true));
  await page.getByRole('link', { name: 'Service/reviews' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${CLUSTER}/services/shop/reviews$`));
  expect(await page.evaluate(() => (window as { spaMarker?: boolean }).spaMarker)).toBe(true);
});

test('the waypoints page lists the shop waypoint', async ({ page }) => {
  await go(page, '/istio/waypoints');
  await expect(page.getByRole('link', { name: 'shop-waypoint' }).first()).toBeVisible();
});

test('a Service page shows the Istio config that applies to it', async ({ page }) => {
  await go(page, '/services/shop/reviews');
  const section = istioSection(page);
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByRole('link', { name: 'shop/reviews' }).first()).toBeVisible();
  await expect(section.getByRole('link', { name: 'shop/reviews-read-only' })).toBeVisible();

  const waypoint = section.getByRole('link', { name: 'shop-waypoint' });
  await expect(waypoint).toBeVisible();
  await expect(section.getByText('via namespace label')).toBeVisible();
});

// The detail panel is narrow; a fixed-width label column once squeezed the
// waypoint name to a few characters per line.
test('the Service Istio section stays readable in the detail panel', async ({ page }) => {
  await go(page, '/services');
  await page.getByRole('link', { name: 'reviews', exact: true }).first().click();
  const waypoint = page.getByRole('link', { name: 'shop-waypoint' }).last();
  await waypoint.scrollIntoViewIfNeeded();
  await expect(waypoint).toBeVisible();
  const box = await waypoint.boundingBox();
  expect(box!.height).toBeLessThan(30);
});

test('a Namespace page shows enrolment, waypoint and revision', async ({ page }) => {
  await go(page, '/namespaces/shop');
  const section = istioSection(page);
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByText('Ambient', { exact: true })).toBeVisible();
  await expect(section.getByText('shop-waypoint')).toBeVisible();
  await expect(section.getByText('default (no istio.io/rev label)')).toBeVisible();
});
