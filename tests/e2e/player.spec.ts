import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { HuntDefinition } from '../../lib/engine/types';
import { getPool } from '../../lib/server/db';

const origin = 'http://127.0.0.1:3100';
const huntId = `browser-${randomUUID()}`;
const title = `Browser adventure ${huntId.slice(-6)}`;
const definition: HuntDefinition = {
  schemaVersion: 1, id: huntId, version: 1, title,
  dudQrs: [{ token: 'coffee-stash', message: 'Only coffee here. Keep looking!' }],
  checkpoints: [
    { id: 'riddle', title: 'The First Clue', basePoints: 20,
      flow: { startNodeId: 'clue', nodes: [
        { id: 'clue', type: 'show_text', text: 'Find the explorer’s direction tool.', next: 'answer' },
        { id: 'answer', type: 'verify_answer', prompt: 'What points north?', answers: ['compass'], next: 'done' },
        { id: 'done', type: 'complete' },
      ] },
      hints: [1, 2, 3].map(i => ({ id: `hint-${i}`, title: `Clue ${i}`, cost: i * 2, content: { type: 'text' as const, text: `Helpful detail ${i}` } })),
    },
    { id: 'qr', title: 'The Hidden Code', basePoints: 20,
      flow: { startNodeId: 'scan', nodes: [
        { id: 'scan', type: 'verify_qr', prompt: 'Scan the hidden code.', token: 'private-browser-qr', backupCode: 'RESCUE', next: 'done' },
        { id: 'done', type: 'complete' },
      ] }, hints: [],
    },
  ],
};

async function post(api: APIRequestContext, path: string, data: unknown) {
  return api.post(path, { headers: { Origin: origin }, data });
}

async function join(page: Page, name: string, mode: 'create' | 'join') {
  await page.goto(`/v2?hunt=${huntId}`);
  await page.getByRole('button', { name: mode === 'create' ? 'Create a team' : 'Join a team', exact: true }).click();
  await page.getByLabel('Your hunt').selectOption(huntId);
  await page.getByLabel('Team name', { exact: true }).fill(name);
  await page.getByLabel('Team PIN').fill('123456');
  await page.getByLabel('Your name', { exact: true }).fill(mode === 'create' ? 'Alice' : 'Bob');
  await page.getByRole('button', { name: mode === 'create' ? 'Start our adventure' : 'Join the adventure' }).click();
  await expect(page.getByRole('heading', { name: 'The First Clue' })).toBeVisible();
}

test.beforeAll(async ({ request }) => {
  expect((await post(request, '/api/v2/admin/session', { password: 'browser-test-password-only' })).ok()).toBeTruthy();
  expect((await post(request, '/api/v2/admin/hunts', { definition })).ok()).toBeTruthy();
});

test.afterAll(async () => {
  await getPool().query('delete from hunt_v2.hunts where id=$1', [huntId]);
  await getPool().end();
});

test('two phones share hints and progression; retries, refresh, QR recovery and completion', async ({ page, browser }) => {
  const teamName = `Explorers-${randomUUID().slice(0, 8)}`;
  await join(page, teamName, 'create');
  const second = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: origin });
  const teammate = await second.newPage();
  await join(teammate, teamName, 'join');

  await page.getByRole('button', { name: 'View hint options' }).nth(2).click();
  // A lost response must retain a retry ID through refresh.
  await page.route('**/api/v2/command', async route => { await route.fetch(); await route.abort(); });
  await page.getByRole('button', { name: 'Reveal hint · 6 points' }).click();
  await expect(page.getByRole('button', { name: 'Retry last action' })).toBeVisible();
  await page.reload();
  await page.unroute('**/api/v2/command');
  await page.getByRole('button', { name: 'Retry last action' }).click();
  await expect(page.getByText('Helpful detail 3')).toBeVisible();
  await expect(page.getByText('Helpful detail 1')).not.toBeVisible();
  await teammate.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(teammate.getByText('Helpful detail 3')).toBeVisible();
  await expect(teammate.getByText('-6', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Helpful detail 3')).toBeVisible();

  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Your answer').fill('needle');
  await page.getByRole('button', { name: 'Check answer' }).click();
  await expect(page.getByText('Not quite. Give it another try.')).toBeVisible();
  await page.getByLabel('Your answer').fill('compass');
  await page.getByRole('button', { name: 'Check answer' }).click();
  await expect(page.getByRole('heading', { name: 'The Hidden Code' })).toBeVisible();
  await expect(page.getByText('14', { exact: true })).toBeVisible();
  const view = await (await page.request.get('/api/v2/session')).json();
  expect(JSON.stringify(view)).not.toContain('private-browser-qr');
  expect(JSON.stringify(view)).not.toContain('RESCUE');
  await page.evaluate(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
    });
  });
  await page.getByRole('button', { name: 'Start QR scanner' }).click();
  await expect(page.getByText(/Camera permission is blocked/)).toBeVisible();
  await page.getByLabel('Have a backup code?').fill('wrong-code');
  await page.getByRole('button', { name: 'Check code' }).click();
  await expect(page.getByText('That is not the code for this task. Keep looking and try again.')).toBeVisible();
  await page.getByLabel('Have a backup code?').fill('coffee-stash');
  await page.getByRole('button', { name: 'Check code' }).click();
  await expect(page.getByText('Only coffee here. Keep looking!')).toBeVisible();
  await page.getByLabel('Have a backup code?').fill('RESCUE');
  await page.getByRole('button', { name: 'Check code' }).click();
  await expect(page.getByRole('heading', { name: 'You found your finish.' })).toBeVisible();
  await expect(page.getByText('34', { exact: true })).toBeVisible();
  await teammate.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(teammate.getByRole('heading', { name: 'You found your finish.' })).toBeVisible();
  await second.close();
});

test('refresh during connection failure keeps the saved task and gates commands until reauthenticated', async ({ page }) => {
  await join(page, `Offline-${randomUUID().slice(0, 8)}`, 'create');
  await page.route('**/api/v2/session', route => route.abort());
  await page.reload();
  await expect(page.getByRole('heading', { name: 'The First Clue' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await page.unroute('**/api/v2/session');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
});

test('API rejects unauthenticated admin, cross-origin changes and changed team session', async ({ page }) => {
  expect((await page.request.get('/api/v2/admin')).status()).toBe(401);
  expect((await page.request.post('/api/v2/admin/hunts', { data: { definition }, headers: { Origin: origin } })).status()).toBe(401);
  expect((await page.request.post('/api/v2/admin/session', { data: { password: 'browser-test-password-only' }, headers: { Origin: 'https://other.example' } })).status()).toBe(403);
  await join(page, `Scope-${randomUUID().slice(0, 8)}`, 'create');
  expect((await post(page.request, '/api/v2/command', { requestId: randomUUID(), teamId: randomUUID(), command: { type: 'continue', checkpointId: 'riddle', nodeId: 'clue' } })).status()).toBe(409);
  await page.goto('/v2/admin');
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill('browser-test-password-only');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
});
