import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { HuntDefinition } from '../../lib/engine/types';

const created = new Set<string>();
test.afterAll(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    if (created.size) {
      await pool.query('delete from hunt_v2.hunts where id=any($1::text[])', [[...created]]);
      await pool.query('delete from hunt_v2.drafts where id=any($1::text[])', [[...created]]);
    }
  } finally { await pool.end(); }
});

test('organizer theme presets render in player previews with readable background and reduced-motion success', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(10_000);
  const id = `theme-${randomUUID()}`; created.add(id);
  const title = `Theme adventure ${id.slice(-6)}`;
  const definition: HuntDefinition = { schemaVersion: 1, id, version: 1, title, checkpoints: [{ id: 'start', title: 'The themed trail', basePoints: 10, hints: [{ id: 'rotation-hint', title: 'Picture rotation', cost: 0, content: { type: 'puzzle', puzzle: { type: 'rotation', columns: 1, tiles: [{ id: 'picture', imageUrl: '/v2/demo/cover.svg', correctRotation: 90 }] }, reveal: { type: 'text', text: 'Follow the river.' } } }], flow: { startNodeId: 'clue', nodes: [{ id: 'clue', type: 'show_text', text: 'Follow the path together.', next: 'done' }, { id: 'done', type: 'complete' }] } }] };
  const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { Origin: 'http://127.0.0.1:3100' } });
  expect((await post('/api/v2/admin/session', { password: 'browser-test-password-only' })).ok()).toBeTruthy();
  const published = await post('/api/v2/admin/hunts', { definition });
  expect(published.ok(), await published.text()).toBeTruthy();
  await page.goto('/v2/admin');
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  await page.getByText('Start from a published hunt', { exact: true }).click();
  await page.getByRole('button', { name: `${title} · v1`, exact: true }).click();
  await page.getByText('Game rules, schedule, map & appearance', { exact: true }).click();
  await expect(page.getByLabel('Action button shape', { exact: true })).toHaveValue('rounded');
  await expect(page.getByLabel('Checkpoint icons', { exact: true })).toHaveValue('none');
  await expect(page.getByLabel('Success animation', { exact: true })).toHaveValue('none');

  for (const preset of [
    { shape: 'pill', icons: 'symbols', animation: 'celebrate', background: '/v2/demo/cover.svg' },
    { shape: 'square', icons: 'numbers', animation: 'pulse', background: '' },
  ] as const) {
    await page.getByLabel('Action button shape', { exact: true }).selectOption(preset.shape);
    await page.getByLabel('Checkpoint icons', { exact: true }).selectOption(preset.icons);
    await page.getByLabel('Success animation', { exact: true }).selectOption(preset.animation);
    await page.getByLabel('Background image URL (optional)', { exact: true }).fill(preset.background);
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByText('Draft saved to the event server.', { exact: true })).toBeVisible();
    const previewResponse = page.waitForResponse(response => response.url().endsWith('/api/v2/admin/preview') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Start player preview', exact: true }).click();
    const preview = await (await previewResponse).json(); created.add(preview.view.hunt.id);
    expect(preview.view.hunt.theme.buttonShape).toBe(preset.shape);
    expect(preview.view.hunt.theme.checkpointIconStyle).toBe(preset.icons);
    expect(preview.view.hunt.theme.successAnimation).toBe(preset.animation);
    const player = await page.context().newPage();
    await player.emulateMedia({ reducedMotion: 'no-preference' });
    await player.goto(preview.url);
    await expect(player.getByRole('heading', { name: 'The themed trail', exact: true })).toBeVisible();
    const button = player.getByRole('button', { name: 'Continue', exact: true });
    await expect(button).toHaveCSS('border-top-left-radius', preset.shape === 'pill' ? '9999px' : '0px');
    const badge = player.locator(`[data-checkpoint-icon="${preset.icons}"]`);
    await expect(badge).toHaveCount(1);
    await expect(badge).toHaveAttribute('aria-hidden', 'true');
    if (preset.icons === 'numbers') await expect(badge).toHaveText('1');
    await player.getByRole('button', { name: 'Choose hint: Picture rotation (Free)', exact: true }).click();
    await player.getByRole('button', { name: 'Reveal hint: Picture rotation (Free)', exact: true }).click();
    await expect(player.getByRole('button', { name: /^Rotate tile 1 clockwise/ })).toHaveCSS('border-top-left-radius', '12px');
    if (preset.background) {
      const image = player.locator('[data-hunt-background-image]');
      await expect(image).toHaveAttribute('alt', '');
      await expect(image).toHaveJSProperty('complete', true);
      expect(await image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      await expect(player.locator('.hunt-content')).toHaveCSS('background-color', 'rgb(245, 243, 237)');
    } else await expect(player.locator('[data-hunt-background-image]')).toHaveCount(0);
    expect(await player.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await player.screenshot({ path: testInfo.outputPath(`theme-${preset.shape}-mobile.png`), fullPage: true });
    await button.click();
    await expect(player.getByRole('heading', { name: 'You found your finish.', exact: true })).toBeVisible();
    await expect(player.locator('.hunt-success-mark')).toHaveCSS('animation-name', `hunt-success-${preset.animation}`);
    await player.emulateMedia({ reducedMotion: 'reduce' });
    await expect(player.locator('.hunt-success-mark')).toHaveCSS('animation-name', 'none');
    await expect(player.getByTestId('feedback-toast')).toHaveCSS('animation-name', 'none');
    await player.screenshot({ path: testInfo.outputPath(`theme-${preset.shape}-reduced-motion.png`), fullPage: true });
    await player.close();
  }
  const dashboard = await (await page.request.get('/api/v2/admin')).json();
  expect(dashboard.hunts.find((hunt: { id: string }) => hunt.id === id).definition.theme).toBeUndefined();
  expect(dashboard.drafts.find((draft: { id: string }) => draft.id === id).definition.theme.backgroundUrl).toBeUndefined();
});
