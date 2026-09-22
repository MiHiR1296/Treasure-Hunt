import { expect, test } from '@playwright/test';
import { createInitialState, getPlayerView } from '../../lib/engine';
import { huntTemplates } from '../../lib/engine/templates';

const definition = structuredClone(huntTemplates.find(template => template.id === 'frankie-code-hunt')!.definition);
const state = createInitialState(definition, 'frankie-browser-team', '2026-09-22T10:00:00.000Z');
const view = {
  ...getPlayerView(definition, state, '2026-09-22T10:00:10.000Z'),
  teamName: 'Wrap Raiders', members: ['Mira', 'Dev'], isPreview: false, eventStatus: 'live' as const,
};

test('Frankie player shows a short visual task card and formatted hunt instructions without leaking answers', async ({ page }, testInfo) => {
  await page.route('**/api/v2/session', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ view }) }));
  await page.route('**/api/v2/hunts', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hunts: [{ id: definition.id, title: definition.title }] }) }));
  await page.route('**/api/v2/leaderboard**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ visible: true, entries: [] }) }));
  await page.goto(`/v2?hunt=${definition.id}`);

  await expect(page.getByRole('heading', { name: 'Round 1 · The shared wrap' })).toBeVisible();
  await expect(page.getByText(/Read this clue/i)).toBeVisible();
  await expect(page.getByText(/5 quick rounds\. Work as a team/).first()).toBeVisible();
  await expect(page.getByText('YOUR TASK ①', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
  await expect(page.getByText(/Accepted answers:/)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  if (testInfo.project.name === 'android-chrome') await page.screenshot({ path: '.data/verification/frankie-code-hunt-player.png', fullPage: true, animations: 'disabled' });
  await testInfo.attach('Frankie player mobile', { body: await page.screenshot({ fullPage: true, animations: 'disabled' }), contentType: 'image/png' });
});

test('organizer can open the exact pinned route, see private solutions, and browse builder steps', async ({ page }, testInfo) => {
  const dashboard = {
    hunts: [{ id: definition.id, title: definition.title, version: 1, status: 'live', definition }],
    drafts: [], help: [], photos: [], example: definition,
    templates: [{ id: 'frankie-code-hunt', title: 'Frankie code hunt', description: 'Five quick shop rounds.', definition }],
    teams: [{
      id: state.teamId, name: 'Wrap Raiders', huntId: definition.id, version: 1, isPreview: false,
      lastActivity: '2026-09-22T10:00:10.000Z', view, ledger: state.ledger, events: state.events,
      checkpoints: state.checkpoints, definition,
    }],
  };
  await page.route('**/api/v2/admin', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dashboard) }));
  await page.goto('/v2/admin');

  await page.getByRole('button', { name: /^Live control/ }).click();
  const team = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Wrap Raiders', exact: true }) });
  await team.getByText('Route & private solutions', { exact: true }).click();
  await expect(team.getByText('TEAM IS HERE', { exact: true })).toBeVisible();
  await expect(team.getByText('Accepted answers: bread · roti · wrap', { exact: true })).toBeVisible();
  if (testInfo.project.name === 'android-chrome') await page.screenshot({ path: '.data/verification/frankie-code-hunt-organizer.png', fullPage: true });
  await testInfo.attach('Frankie organizer mobile', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

  await page.getByRole('button', { name: 'Design', exact: true }).click();
  await page.getByRole('button', { name: /Frankie code hunt/ }).click();
  await expect(page.getByRole('button', { name: 'Previous step', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Next step', exact: true }).click();
  await expect(page.getByLabel('Accepted answers — one per line', { exact: true })).toHaveValue('bread\nroti\nwrap');
  await page.getByRole('button', { name: 'Previous step', exact: true }).click();
  await expect(page.getByLabel('Clue or instructions', { exact: true })).toHaveValue(/YOUR TASK ①/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
});
