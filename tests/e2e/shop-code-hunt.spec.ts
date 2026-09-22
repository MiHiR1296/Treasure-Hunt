import { expect, test } from '@playwright/test';
import { createInitialState, getPlayerView } from '../../lib/engine';
import { huntTemplates } from '../../lib/engine/templates';

const definition = structuredClone(huntTemplates.find(template => template.id === 'frankie-code-hunt')!.definition);
const state = createInitialState(definition, 'frankie-browser-team', '2026-09-22T10:00:00.000Z');
const view = {
  ...getPlayerView(definition, state, '2026-09-22T10:00:10.000Z'),
  teamName: 'Wrap Raiders', members: ['Mira', 'Dev'], isPreview: false, eventStatus: 'live' as const,
};

test('Frankie player shows one direct question with dot progress and no repeated interface labels', async ({ page }, testInfo) => {
  await page.route('**/api/v2/session', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ view }) }));
  await page.route('**/api/v2/hunts', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hunts: [{ id: definition.id, title: definition.title }] }) }));
  await page.route('**/api/v2/leaderboard**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ visible: true, entries: [] }) }));
  await page.goto(`/v2?hunt=${definition.id}`);

  await expect(page.getByRole('heading', { name: 'What wraps every Frankie?' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Hunt progress' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Hunt progress' }).locator('[aria-current="step"]')).toHaveCount(1);
  await expect(page.getByText(/every Frankie needs the same outer layer/)).toBeVisible();
  await expect(page.getByLabel('Your answer')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check answer', exact: true })).toBeVisible();
  await expect(page.getByText('Checkpoint 1', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Read this clue', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/^Round 1/)).toHaveCount(0);
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
  await expect(page.getByLabel('Accepted answers — one per line', { exact: true })).toHaveValue('bread\nroti\nwrap');
  await page.getByRole('button', { name: 'Next step', exact: true }).click();
  await page.getByRole('button', { name: 'Previous step', exact: true }).click();
  await expect(page.getByLabel('Accepted answers — one per line', { exact: true })).toHaveValue('bread\nroti\nwrap');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
});
