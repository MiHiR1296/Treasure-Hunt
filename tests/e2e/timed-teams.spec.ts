import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import type { HuntDefinition } from '../../lib/engine/types';

const origin = 'http://127.0.0.1:3100', ids: string[] = [];
const post = (request: APIRequestContext, url: string, data: unknown) => request.post(url, { headers: { Origin: origin }, data });
const definition = (): HuntDefinition => {
  const id = `browser-timed-${randomUUID()}`; ids.push(id);
  return { schemaVersion: 1, id, version: 1, title: 'Timed browser hunt', settings: { minTeamSize: 2, maxTeamSize: 4, sessionDurationSeconds: 120, assignmentVersion: 2 }, checkpoints: [{ id: 'one', title: 'Word task', basePoints: 10,
    hints: [{ id: 'cat', title: 'CAT clue', cost: 2, relevance: { nodeId: 'words', puzzleItemId: 'CAT' }, content: { type: 'text', text: 'Top row' } }, { id: 'future', title: 'Future route secret', cost: 2, relevance: { nodeId: 'answer' }, content: { type: 'text', text: 'Secret' } }],
    flow: { startNodeId: 'words', nodes: [{ id: 'words', type: 'puzzle', prompt: 'Find both words', puzzle: { type: 'word_search', grid: ['CAT', 'DOG', 'XYZ'].map(row => [...row]), words: ['CAT', 'DOG'] }, next: 'answer' },
      { id: 'answer', type: 'verify_answer', prompt: 'Last answer', answers: ['yes'], recordAnswerAttempts: true, next: 'done' }, { id: 'done', type: 'complete' }] } }] };
};
test.beforeEach(async ({ request }) => { expect((await post(request, '/api/v2/admin/session', { password: 'browser-test-password-only' })).ok()).toBeTruthy(); });
test.afterAll(async () => { const pool = new Pool({ connectionString: process.env.DATABASE_URL }); try { await pool.query('delete from hunt_v2.hunts where id=any($1::text[])', [ids]); await pool.query('delete from hunt_v2.drafts where id=any($1::text[])', [ids]); } finally { await pool.end(); } });

test('preview detail and every history endpoint are excluded from Results', async ({ request }) => {
  const h = definition(); expect((await post(request, '/api/v2/admin/hunts', { definition: h })).ok()).toBeTruthy();
  const response = await post(request, '/api/v2/admin/preview', { huntId: h.id }); expect(response.ok(), await response.text()).toBeTruthy();
  const preview = await response.json(), id = preview.view.teamId;
  for (const section of ['', 'activity', 'events', 'ledger', 'help']) {
    const params = new URLSearchParams({ teamId: id, throughRevision: '0', count: '0', offset: '0', asOf: new Date().toISOString() });
    if (section) params.set('section', section);
    expect((await request.get(`/api/v2/admin/results?${params}`)).status()).toBe(404);
  }
  expect((await request.get(`/api/v2/admin/team-inspector?teamId=${id}`)).status()).toBe(200);
});

test('timed roster, late teammate, pause, sticky word hints, expiry and organizer reopen', async ({ page, browser, request }, info) => {
  test.setTimeout(90000);
  const h = definition(), teamName = `Timed-${randomUUID().slice(0, 8)}`;
  const published = await post(request, '/api/v2/admin/hunts', { definition: h }); expect(published.ok(), await published.text()).toBeTruthy();
  await page.goto(`/v2?hunt=${h.id}`); await page.getByRole('button', { name: 'Create a team', exact: true }).click();
  await page.getByLabel('Team name', { exact: true }).fill(teamName); await page.getByLabel('Team PIN').fill('123456'); await page.getByLabel('Your name', { exact: true }).fill('Alice');
  await page.getByRole('button', { name: 'Create team lobby', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Get your team ready' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start team hunt', exact: true })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Word task', exact: true })).not.toBeVisible();
  await page.getByLabel('Team roster', { exact: true }).fill('Alice\nBob\nCarol\nDan\nEve'); await page.getByRole('button', { name: 'Save roster', exact: true }).click();
  await expect(page.getByText(/This roster must have 1 to 4 members/)).toBeVisible();
  await page.getByLabel('Team roster', { exact: true }).fill('Alice\nBob'); await page.getByRole('button', { name: 'Save roster', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start team hunt', exact: true })).toBeEnabled();
  if (await page.getByRole('button', { name: 'Dismiss feedback' }).isVisible()) await page.getByRole('button', { name: 'Dismiss feedback' }).click();
  await page.screenshot({ path: `test-results/timed-lobby-${info.project.name}.png`, fullPage: true, animations: 'disabled' });
  await page.route('**/api/v2/command', async route => { await route.fetch(); await route.abort(); }, { times: 1 });
  await page.getByRole('button', { name: 'Start team hunt', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry last action', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry last action', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Word task', exact: true })).toBeVisible();
  await expect(page.getByLabel('Team timer', { exact: true })).toContainText('Time left');
  const view = async () => (await (await page.request.get('/api/v2/session')).json()).view;
  const initial = await view(); expect(JSON.stringify(initial)).not.toContain('Future route secret');
  const device = await browser.newContext({ baseURL: origin }), teammate = await device.newPage();
  try {
    expect((await post(device.request, '/api/v2/session', { huntId: h.id, teamName, playerName: 'Bob', pin: '123456', mode: 'join' })).ok()).toBeTruthy();
    await teammate.goto('/v2'); await expect(teammate.getByRole('heading', { name: 'Word task', exact: true })).toBeVisible();
    const unauthorized = await post(device.request, '/api/v2/session', { huntId: h.id, teamName, playerName: 'Eve', pin: '123456', mode: 'join' }); expect(unauthorized.status()).toBe(409);
    expect((await post(device.request, '/api/v2/session', { huntId: h.id, teamName, playerName: 'Bob', pin: '123456', mode: 'join', routeChoices: {} })).status()).toBe(400);
    expect((await device.request.get(`/api/v2/admin/results?teamId=${initial.teamId}`)).status()).toBe(401);
    expect((await device.request.get(`/api/v2/admin/team-inspector?teamId=${initial.teamId}`)).status()).toBe(401);
    const status = async (value: string) => {
      const dashboard = await (await request.get('/api/v2/admin')).json();
      const response = await request.patch('/api/v2/admin/hunts', { headers: { Origin: origin }, data: { huntId: h.id, status: value, expectedRevision: dashboard.hunts.find((item: { id: string }) => item.id === h.id).lifecycleRevision } }); expect(response.ok(), await response.text()).toBeTruthy();
    };
    await status('paused'); await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await expect(page.getByLabel('Team timer')).toContainText('Paused');
    const pausedText = await page.getByLabel('Team timer').textContent(); await page.waitForTimeout(1100); expect(await page.getByLabel('Team timer').textContent()).toBe(pausedText);
    await status('live'); await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    const solve = await post(page.request, '/api/v2/command', { teamId: initial.teamId, requestId: randomUUID(), command: { type: 'submit_puzzle', checkpointId: 'one', nodeId: 'words', expectedRevision: 0, value: { path: [0, 1, 2].map(column => ({ row: 0, column })) } } }); expect(solve.ok(), await solve.text()).toBeTruthy();
    await Promise.all([page.getByRole('button', { name: 'Refresh', exact: true }).click(), teammate.getByRole('button', { name: 'Refresh', exact: true }).click()]);
    for (const tab of [page, teammate]) await expect(tab.getByRole('button', { name: 'Choose hint: CAT clue (2 points)', exact: true })).not.toBeVisible();
    // Device wall-clock changes cannot extend the display or server deadline.
    await page.evaluate(() => { Date.now = () => 0; });
    expect((await view()).timer.deadlineAt).not.toBe(initial.timer.deadlineAt); // pause was added, not the clock change
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try { await pool.query(`update hunt_v2.teams set state=jsonb_set(state,'{timer,deadlineAt}',to_jsonb(to_char(clock_timestamp()-interval '1 second','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) where id=$1`, [initial.teamId]); } finally { await pool.end(); }
    await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await expect(page.getByLabel('Team timer')).toContainText('Time ended');
    const expired = await view();
    const extend = await post(request, '/api/v2/admin/control', { teamId: initial.teamId, requestId: randomUUID(), control: { type: 'extend_session', seconds: 60, expectedRevision: expired.revision, reason: 'Reopen for field assistance' } }); expect(extend.ok(), await extend.text()).toBeTruthy();
    await page.reload(); await expect(page.getByLabel('Team timer')).toContainText('Time left');
    await page.setViewportSize({ width: 667, height: 375 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await expect(page.getByRole('button', { name: 'D, row 2, column 1', exact: true })).toBeEnabled();
    await page.screenshot({ path: `test-results/timed-running-${info.project.name}.png`, fullPage: true, animations: 'disabled' });
  } finally { await device.close(); }
});

test('draft deletion keeps unsaved device work; results review and exports stay private', async ({ page, request }, info) => {
  const h = definition(); expect((await post(request, '/api/v2/admin/hunts', { definition: h })).ok()).toBeTruthy();
  expect((await post(request, '/api/v2/admin/drafts', { definition: h, expectedRevision: null })).ok()).toBeTruthy();
  const team = await (await post(request, '/api/v2/session', { huntId: h.id, teamName: 'Waiting team', playerName: 'Alice', memberNames: ['Alice', 'Bob'], pin: '123456', mode: 'create' })).json();
  await page.goto('/v2/admin'); await page.getByLabel('Password', { exact: true }).fill('browser-test-password-only'); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`^${h.title}.*Revision`) }).click();
  await page.getByLabel('Hunt title', { exact: true }).fill('Unsaved retained title');
  await page.locator('li').filter({ has: page.getByRole('button', { name: new RegExp(`^${h.title}.*Revision`) }) }).getByRole('button', { name: 'Delete saved draft', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete draft', exact: true }).click();
  await expect(page.getByLabel('Hunt title', { exact: true })).toHaveValue('Unsaved retained title');
  const dashboard = await (await page.request.get('/api/v2/admin')).json(); expect(dashboard.drafts.some((d: { id: string }) => d.id === h.id)).toBe(false); expect(dashboard.hunts.some((d: { id: string }) => d.id === h.id)).toBe(true);
  await page.getByRole('button', { name: 'Results', exact: true }).click(); await page.getByLabel('Results hunt', { exact: true }).selectOption(h.id);
  await page.getByRole('button', { name: 'Inspect result: Waiting team', exact: true }).click();
  await page.getByLabel('Organizer action', { exact: true }).selectOption('review_result'); await page.getByLabel('Private review status', { exact: true }).selectOption('flagged');
  await page.getByLabel('Reason for organizer action', { exact: true }).fill('Check declared roster before final results'); await page.getByRole('button', { name: 'Record result review', exact: true }).click();
  await expect(page.getByText(/Review: flagged/).first()).toBeVisible();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export complete team record (JSON)', exact: true }).click();
  const json = await download; expect(json.suggestedFilename()).toContain(team.view.teamId);
  const exported = JSON.parse(await readFile((await json.path())!, 'utf8'));
  expect(exported.team.definition).toEqual({ id: h.id, title: h.title, checkpoints: [{ id: 'one', title: 'Word task', basePoints: 10, required: true }] });
  expect(JSON.stringify(exported)).not.toContain('"answers"');
  const csvDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export all team summaries (CSV)', exact: true }).click();
  const csv = await csvDownload; expect(csv.suggestedFilename()).toBe(`${h.id}-results.csv`);
  const contents = await readFile((await csv.path())!, 'utf8'); expect(contents).toContain(team.view.teamId); expect(contents).toContain('registrationCutoff'); expect(contents).toContain('"flagged"');
  await page.screenshot({ path: `test-results/organizer-results-${info.project.name}.png`, fullPage: true, animations: 'disabled' });
});
