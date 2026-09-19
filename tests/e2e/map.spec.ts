import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { HuntDefinition } from '../../lib/engine/types';

const origin = 'http://127.0.0.1:3100';
const huntId = `map-${randomUUID()}`;
const literalTitle = '<img src=x onerror="window.__mapInjected=true"> Gate';
const definition: HuntDefinition = {
  schemaVersion: 1, id: huntId, version: 1, title: 'Map exploration', settings: { map: 'all', leaderboard: 'hidden' },
  checkpoints: ['gate', 'bridge'].map((id, index) => ({
    id, title: id === 'gate' ? literalTitle : 'The bridge', basePoints: 20, hints: [],
    location: { latitude: 19.24 + index * 0.002, longitude: 73.13 + index * 0.002, radiusMeters: 60 },
    flow: { startNodeId: 'clue', nodes: [{ id: 'clue', type: 'show_text', text: 'Explore the map before continuing.', next: 'done' }, { id: 'done', type: 'complete' }] },
  })),
};
const post = (request: APIRequestContext, route: string, data: unknown) => request.post(route, { headers: { Origin: origin }, data });

test.beforeAll(async ({ request }) => {
  expect((await post(request, '/api/v2/admin/session', { password: 'browser-test-password-only' })).ok()).toBeTruthy();
  const result = await post(request, '/api/v2/admin/hunts', { definition });
  expect(result.ok(), await result.text()).toBeTruthy();
});
test.afterAll(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try { await pool.query('delete from hunt_v2.hunts where id=$1', [huntId]); } finally { await pool.end(); }
});

test('refreshing unchanged search areas preserves the player map zoom and pan', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(/^https:\/\/[abc]\.tile\.openstreetmap\.org\//, route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') }));
  const teamName = `Map explorers ${randomUUID().slice(0, 8)}`;
  expect((await post(page.request, '/api/v2/session', { huntId, mode: 'create', teamName, playerName: 'Map reader', pin: '123456' })).ok()).toBeTruthy();
  await page.goto(`/v2?hunt=${huntId}`);
  await page.getByRole('button', { name: 'Show hunt map', exact: true }).click();
  const map = page.getByRole('region', { name: 'Approximate search areas', exact: true });
  const circles = map.locator('.leaflet-overlay-pane path');
  await expect(circles).toHaveCount(2);
  // Opaque attribution keeps its small link text readable over any map tile.
  await expect(map.locator('.leaflet-control-attribution')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  const first = circles.first();
  await first.dispatchEvent('mouseover');
  await expect(map.locator('.leaflet-tooltip')).toHaveText(literalTitle);
  await expect(map.locator('.leaflet-tooltip img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __mapInjected?: boolean }).__mapInjected)).toBeUndefined();
  await first.dispatchEvent('mouseout');
  const initial = await first.getAttribute('d');
  await map.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(first).not.toHaveAttribute('d', initial!);
  const zoomed = await first.getAttribute('d');

  // A new member gives an observable confirmation that the refreshed view was
  // rendered; its map coordinates are exactly the same as before.
  expect((await post(page.request, '/api/v2/session', { huntId, mode: 'join', teamName, playerName: 'Compass teammate', pin: '123456' })).ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText('Map reader · Compass teammate', { exact: true })).toBeVisible();
  await expect(first).toHaveAttribute('d', zoomed!);

  // Leaflet's keyboard pan is also deliberate player state. An identical
  // session response must not reset either it or the zoom level.
  await map.locator('.leaflet-container').focus();
  await page.keyboard.press('ArrowRight');
  const viewport = map.locator('.leaflet-map-pane');
  await expect.poll(() => viewport.getAttribute('style')).toMatch(/translate3d\(-80px/);
  const panned = await viewport.getAttribute('style');
  const response = page.waitForResponse(result => result.url().endsWith('/api/v2/session') && result.request().method() === 'GET');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  expect((await response).ok()).toBeTruthy();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(first).toHaveAttribute('d', zoomed!);
  await expect(viewport).toHaveAttribute('style', panned!);
});
