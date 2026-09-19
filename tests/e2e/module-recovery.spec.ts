import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { HuntDefinition } from '../../lib/engine/types';

const origin = 'http://127.0.0.1:3100';
const huntId = `module-${randomUUID()}`;
const definition: HuntDefinition = {
  schemaVersion: 1, id: huntId, version: 1, title: 'Download recovery adventure', settings: { map: 'all', leaderboard: 'hidden' },
  checkpoints: [{ id: 'first', title: 'A saved clue', basePoints: 20, location: { latitude: 19.24, longitude: 73.13, radiusMeters: 80 },
    hints: [{ id: 'hint', title: 'A shared nudge', cost: 2, content: { type: 'text', text: 'Your team kept this helpful clue.' } }],
    flow: { startNodeId: 'clue', nodes: [
      { id: 'clue', type: 'show_text', text: 'Your next challenge opens when you continue.', next: 'puzzle' },
      { id: 'puzzle', type: 'puzzle', prompt: 'Choose the direction.', puzzle: { type: 'multiple_choice', prompt: 'Which direction is shown by a compass?', options: [{ id: 'north', label: 'North' }, { id: 'up', label: 'Up' }], correctOptionId: 'north' }, next: 'done' },
      { id: 'done', type: 'complete' },
    ] },
  }],
};
const post = (request: APIRequestContext, route: string, data: unknown) => request.post(route, { headers: { Origin: origin }, data });

test.beforeAll(async ({ request }) => {
  expect((await post(request, '/api/v2/admin/session', { password: 'browser-test-password-only' })).ok()).toBeTruthy();
  const response = await post(request, '/api/v2/admin/hunts', { definition });
  expect(response.ok(), await response.text()).toBeTruthy();
});
test.afterAll(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try { await pool.query('delete from hunt_v2.hunts where id=$1', [huntId]); } finally { await pool.end(); }
});

for (const feature of ['puzzle', 'map'] as const) test(`a failed lazy ${feature} download offers reload and preserves purchased hints and progress`, async ({ page }) => {
  const chunkName = feature === 'puzzle' ? 'components_v2_puzzles_PuzzlePlayer_tsx' : 'components_v2_player_RegionMap_tsx';
  const aborted: string[] = [];
  await page.route('**/_next/static/chunks/**', async route => {
    if (route.request().resourceType() === 'script' && route.request().url().includes(chunkName)) { aborted.push(route.request().url()); await route.abort('failed'); }
    else await route.continue();
  });
  const joined = await post(page.request, '/api/v2/session', { huntId, mode: 'create', teamName: `Recovery ${randomUUID().slice(0, 8)}`, playerName: 'Explorer', pin: '123456' });
  expect(joined.ok(), await joined.text()).toBeTruthy();
  const teamId = (await joined.json()).view.teamId;
  await page.goto(`/v2?hunt=${huntId}`);
  await page.getByRole('button', { name: 'View hint options', exact: true }).click();
  await page.getByRole('button', { name: 'Reveal hint · 2 points', exact: true }).click();
  await expect(page.getByText('Your team kept this helpful clue.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: feature === 'puzzle' ? 'Continue' : 'Show hunt map', exact: true }).click();
  await expect.poll(() => aborted.length).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: 'This part of the adventure could not open.', exact: true })).toBeVisible();
  await expect(page.getByText('Check your connection, then reload this page.', { exact: true })).toBeVisible();
  const before = (await (await page.request.get('/api/v2/session')).json()).view;
  expect(before.teamId).toBe(teamId);
  expect(before.score).toBe(-2);
  expect(before.node.id).toBe(feature === 'puzzle' ? 'puzzle' : 'clue');
  await page.unroute('**/_next/static/chunks/**');
  await page.route(/^https:\/\/[abc]\.tile\.openstreetmap\.org\//, route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') }));
  await page.getByRole('button', { name: 'Reload page', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A saved clue', exact: true })).toBeVisible();
  await expect(page.getByText('Your team kept this helpful clue.', { exact: true })).toBeVisible();
  if (feature === 'map') {
    await page.getByRole('button', { name: 'Show hunt map', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Approximate search areas', exact: true }).locator('.leaflet-overlay-pane path')).toHaveCount(1);
  } else await expect(page.getByRole('button', { name: 'North', exact: true })).toBeVisible();
  const after = (await (await page.request.get('/api/v2/session')).json()).view;
  expect(after.teamId).toBe(teamId);
  expect(after.score).toBe(-2);
  expect(after.revision).toBe(before.revision);
});
