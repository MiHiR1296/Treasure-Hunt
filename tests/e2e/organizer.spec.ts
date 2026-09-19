import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import type { HuntDefinition, OrganizerControl } from '../../lib/engine/types';

const created = new Set<string>();
test.beforeEach(async ({ page }) => { page.setDefaultTimeout(10000); });

test.afterAll(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  if (created.size) {
    await pool.query('delete from hunt_v2.hunts where id=any($1::text[])', [[...created]]);
    await pool.query('delete from hunt_v2.drafts where id=any($1::text[])', [[...created]]);
  }
  await pool.end();
});

test('organizer builds branching checkpoints without JSON, recovers drafts, previews and publishes versions', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const id = `builder-${randomUUID()}`; created.add(id);
  const title = `Builder trail ${id.slice(-6)}`;
  await page.goto('/v2/admin');
  await page.getByLabel('Password', { exact: true }).fill('browser-test-password-only');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  await page.getByRole('button', { name: 'New hunt', exact: true }).click();
  await page.getByLabel('Hunt title', { exact: true }).fill(title);
  await page.getByLabel('Unique hunt ID', { exact: true }).fill(id);
  await page.getByLabel('Checkpoint title', { exact: true }).fill('The first clue');
  await page.getByLabel('Clue or instructions', { exact: true }).fill('Find the tool that points north.');
  await page.getByRole('button', { name: 'Connect next step on canvas', exact: true }).click();
  await page.getByRole('button', { name: /Finish checkpoint/ }).click();
  await expect(page.getByText(/configuration issues? to resolve before publishing/)).toBeVisible();
  await page.getByLabel('After success, continue to', { exact: true }).selectOption('answer');
  await page.getByRole('button', { name: /Step 2 Answer a question/ }).click();
  await page.getByLabel('What should the player do?', { exact: true }).fill('What points north?');
  await page.getByLabel('Accepted answers — one per line', { exact: true }).fill('compass');
  await page.getByRole('button', { name: 'Add hint', exact: true }).click();
  await page.getByLabel('Hint title', { exact: true }).fill('A small pointer');
  await page.getByLabel('Text to reveal', { exact: true }).fill('It has a magnetic needle.');

  await page.getByRole('button', { name: 'Add checkpoint', exact: true }).click();
  await page.getByLabel('Checkpoint title', { exact: true }).fill('The river gate');
  await page.getByLabel('Clue or instructions', { exact: true }).fill('Follow the water to the old gate.');
  await page.getByRole('button', { name: /Step 2 Answer a question/ }).click();
  await page.getByRole('button', { name: 'Remove step', exact: true }).click();
  await page.getByRole('button', { name: 'Remove and reconnect', exact: true }).click();
  await page.getByLabel('Add an action', { exact: true }).selectOption('verify_qr');
  await page.getByRole('button', { name: 'Add step', exact: true }).click();
  await page.getByRole('button', { name: 'Generate a random token', exact: true }).click();
  await page.getByLabel('Backup code (optional)', { exact: true }).fill('RIVER7');
  await page.getByRole('button', { name: 'Add GPS + code alternative route', exact: true }).click();
  await page.getByRole('button', { name: /Reach a GPS region/ }).click();
  await page.getByLabel('Latitude', { exact: true }).fill('19.24');
  await page.getByLabel('Longitude', { exact: true }).fill('73.13');
  await page.getByRole('button', { name: /Enter a code/ }).click();
  await page.getByLabel('Correct code', { exact: true }).fill('LANDMARK');
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await page.getByLabel('Checkpoint title', { exact: true }).fill('Temporary copy');
  await page.getByRole('button', { name: 'Move earlier', exact: true }).click();
  await page.getByRole('button', { name: 'Remove checkpoint', exact: true }).click();
  await page.getByRole('button', { name: 'Remove from draft', exact: true }).click();
  await expect(page.getByText('Configuration is ready for server validation.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Draft saved to the event server.', { exact: true })).toBeVisible();
  await page.getByLabel('Hunt title', { exact: true }).fill(title + ' updated');
  await page.reload();
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  await expect(page.getByLabel('Hunt title', { exact: true })).toHaveValue(title + ' updated');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Draft saved to the event server.', { exact: true })).toBeVisible();

  const saved = await (await page.request.get('/api/v2/admin')).json();
  const draft = saved.drafts.find((item: { id: string }) => item.id === id);
  expect(draft.definition.checkpoints).toHaveLength(2);
  expect(draft.definition.checkpoints[1].flow.nodes.some((node: { type: string }) => node.type === 'choose_path')).toBeTruthy();
  expect(draft.issues).toEqual([]);
  const previewResponse = page.waitForResponse(response => response.url().endsWith('/api/v2/admin/preview') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Start player preview', exact: true }).click();
  const preview = await (await previewResponse).json(); created.add(preview.view.hunt.id);
  await expect(page.getByRole('link', { name: /Open player preview/ })).toBeVisible();
  const previewPage = await page.context().newPage();
  await previewPage.goto(preview.url);
  await expect(previewPage.getByRole('heading', { name: 'The first clue', exact: true })).toBeVisible();
  await previewPage.close();
  await page.getByLabel('Introduction (optional)', { exact: true }).fill('Follow the clues together.');
  await expect(page.getByRole('link', { name: /Open player preview/ })).not.toBeVisible();
  await page.getByLabel('Publish as', { exact: true }).selectOption('live');
  await page.getByRole('button', { name: 'Validate & publish hunt', exact: true }).click();
  await expect(page.getByText(/Hunt published as live/)).toBeVisible();
  await page.getByRole('button', { name: 'Events', exact: true }).click();
  await expect(page.getByRole('heading', { name: title + ' updated', exact: true })).toBeVisible();
  const event = page.locator('article').filter({ has: page.getByRole('heading', { name: title + ' updated', exact: true }) });
  await event.getByText('QR materials', { exact: true }).click();
  await expect(event.getByText('Join ' + title + ' updated', { exact: true })).toBeVisible();
  await expect(event.locator('svg')).toHaveCount(2);
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export hunt', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(id + '.json');
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(exported.id).toBe(id);
  expect(exported.checkpoints).toHaveLength(2);
  await page.getByRole('button', { name: 'Duplicate as new hunt', exact: true }).click();
  const copyId = await page.getByLabel('Unique hunt ID', { exact: true }).inputValue(); created.add(copyId);
  expect(copyId).not.toBe(id);
  await expect(page.getByLabel('Hunt title', { exact: true })).toHaveValue(title + ' updated (copy)');
  await expect(page.getByLabel('Clue or instructions', { exact: true })).toHaveValue('Find the tool that points north.');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Draft saved to the event server.', { exact: true })).toBeVisible();
  const copies = await (await page.request.get('/api/v2/admin')).json();
  expect(copies.drafts.find((item: { id: string }) => item.id === copyId).definition.checkpoints).toEqual(exported.checkpoints);
  expect(copies.hunts.find((item: { id: string }) => item.id === id).title).toBe(title + ' updated');
});

test('mobile organizer preserves work when changing sections without page overflow', async ({ page }) => {
  await page.goto('/v2/admin');
  await page.getByLabel('Password', { exact: true }).fill('browser-test-password-only');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  await page.getByRole('button', { name: 'New hunt', exact: true }).click();
  await page.getByLabel('Hunt title', { exact: true }).fill('Unsaved mobile adventure');
  await page.getByRole('button', { name: 'Add checkpoint', exact: true }).click();
  await expect(page.getByLabel('Checkpoint title', { exact: true })).toHaveValue('Checkpoint 2');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  await page.getByRole('button', { name: 'Events', exact: true }).click();
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  await expect(page.getByLabel('Hunt title', { exact: true })).toHaveValue('Unsaved mobile adventure');
});

test('printing isolates the selected event and keeps each QR on a readable page', async ({ page, browserName }, testInfo) => {
  const id = `print-${randomUUID()}`; const otherId = `other-${randomUUID()}`; created.add(id); created.add(otherId);
  const title = `Selected print event ${id.slice(-6)}`;
  const definition: HuntDefinition = { schemaVersion: 1, id, version: 1, title, dudQrs: [{ token: 'printed-decoy-token', message: 'A private decoy message.' }], checkpoints: [1, 2].map(index => ({ id: `checkpoint-${index}`, title: `Printed checkpoint ${index}`, basePoints: 10, hints: [], flow: { startNodeId: 'scan', nodes: [
    { id: 'scan', type: 'verify_qr', prompt: 'Find this checkpoint.', token: `printed-qr-token-${index}`, ...(index === 1 ? { backupCode: 'PLAYER-RECOVERY-1' } : {}), next: 'answer' },
    { id: 'answer', type: 'verify_answer', prompt: 'What did you discover?', answers: ['PRIVATE-PRINT-ANSWER'], next: 'done' }, { id: 'done', type: 'complete' },
  ] } })) };
  const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { Origin: 'http://127.0.0.1:3100' } });
  expect((await post('/api/v2/admin/session', { password: 'browser-test-password-only' })).ok()).toBeTruthy();
  expect((await post('/api/v2/admin/hunts', { definition })).ok()).toBeTruthy();
  expect((await post('/api/v2/admin/hunts', { definition: { ...definition, id: otherId, title: 'Unrelated event must not print' } })).ok()).toBeTruthy();
  await page.goto('/v2/admin');
  const selectedEvent = page.locator('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await selectedEvent.getByText('QR materials', { exact: true }).click();
  await page.evaluate(() => { window.print = () => { document.body.dataset.printRequested = 'yes'; }; });
  await selectedEvent.getByRole('button', { name: 'Print QR materials', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-print-requested', 'yes');
  await page.setViewportSize({ width: 794, height: 1123 });
  await page.emulateMedia({ media: 'print' });
  const sheet = page.locator('#hunt-print-root');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('svg')).toHaveCount(4);
  const printedText = await page.locator('body').innerText();
  expect(printedText).toContain(title);
  expect(printedText).toContain('Printed checkpoint 1');
  expect(printedText).toContain('Printed checkpoint 2');
  expect(printedText).toContain('Mystery marker');
  expect(printedText).toContain('Backup code: PLAYER-RECOVERY-1');
  await expect(sheet.locator('.hunt-print-backup')).toHaveCount(1);
  await expect(sheet.locator('.hunt-print-card').filter({ has: page.getByRole('heading', { name: 'Printed checkpoint 2', exact: true }) }).locator('.hunt-print-backup')).toHaveCount(0);
  for (const hidden of ['Unrelated event must not print', 'Organizer console', 'PRIVATE-PRINT-ANSWER', 'Decoy 1', 'A private decoy message.']) expect(printedText).not.toContain(hidden);
  for (const svg of await sheet.locator('svg').all()) {
    const box = await svg.boundingBox();
    expect(box?.width).toBeGreaterThan(300);
    expect(box?.height).toBeCloseTo(box!.width, 0);
    expect(await svg.evaluate(element => { const container = element.closest('.hunt-print-card')!.getBoundingClientRect(); const bounds = element.getBoundingClientRect(); return bounds.left >= container.left && bounds.right <= container.right && bounds.top >= container.top && bounds.bottom <= container.bottom; })).toBe(true);
  }
  if (browserName === 'chromium') {
    const pdf = await page.pdf({ path: testInfo.outputPath('selected-event-qr.pdf'), preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(4);
    await testInfo.attach('Selected event QR sheets', { path: testInfo.outputPath('selected-event-qr.pdf'), contentType: 'application/pdf' });
  }
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(page.getByRole('heading', { name: 'Organizer console', exact: true })).toBeVisible();
  await expect(sheet.locator('svg')).toHaveCount(0);
});

test('organizer resolves help, enables recovery, and retries a score correction once after reload', async ({ page }) => {
  const id = `rescue-${randomUUID()}`; created.add(id);
  const teamName = `Rescue team ${id.slice(-6)}`;
  const definition: HuntDefinition = { schemaVersion: 1, id, version: 1, title: `Rescue hunt ${id.slice(-6)}`, checkpoints: [{ id: 'landmark', title: 'The old bridge', basePoints: 20, hints: [], flow: { startNodeId: 'gps', nodes: [
    { id: 'gps', type: 'verify_gps', prompt: 'Find the bridge.', latitude: 19.24, longitude: 73.13, radiusMeters: 100, maxAccuracyMeters: 50, next: 'done', fallback: { nodeId: 'backup', label: 'Use organizer backup', enabled: false } },
    { id: 'backup', type: 'verify_code', prompt: 'Enter the rescue code.', code: 'BRIDGE', next: 'done' }, { id: 'done', type: 'complete' },
  ] } }] };
  const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { Origin: 'http://127.0.0.1:3100' } });
  expect((await post('/api/v2/admin/session', { password: 'browser-test-password-only' })).ok()).toBeTruthy();
  expect((await post('/api/v2/admin/hunts', { definition })).ok()).toBeTruthy();
  const joined = await post('/api/v2/session', { mode: 'create', huntId: id, teamName, playerName: 'Explorer', pin: '123456' });
  expect(joined.ok(), await joined.text()).toBeTruthy();
  const { view } = await joined.json();
  expect((await post('/api/v2/help', { teamId: view.teamId, requestId: randomUUID(), kind: 'gps', message: 'Our location permission is blocked.', checkpointId: 'landmark', nodeId: 'gps' })).ok()).toBeTruthy();
  await page.goto('/v2/admin');
  await page.getByRole('button', { name: /^Live control/ }).click();
  await page.getByLabel(`Reply to ${teamName}`, { exact: true }).fill('Use the bridge code BRIDGE.');
  await page.getByRole('button', { name: 'Reply & resolve', exact: true }).click();
  await expect(page.getByText(`Reply sent to ${teamName}; the request is resolved.`, { exact: true })).toBeVisible();
  const team = page.locator('article').filter({ has: page.getByRole('heading', { name: teamName, exact: true }) });
  await team.getByLabel('Organizer action', { exact: true }).selectOption('enable_fallback');
  await team.getByLabel('Reason for organizer action', { exact: true }).fill('GPS permission failed at the landmark.');
  await team.getByRole('button', { name: 'Change recovery route availability', exact: true }).click();
  await expect(page.getByText(`Change recovery route availability saved for ${teamName}. The reason was recorded.`, { exact: true })).toBeVisible();
  expect((await (await page.request.get('/api/v2/session')).json()).view.node.fallback.enabled).toBe(true);
  await team.getByLabel('Organizer action', { exact: true }).selectOption('adjust_score');
  await team.getByLabel('Points to add or deduct', { exact: true }).fill('7');
  await team.getByLabel('Reason for organizer action', { exact: true }).fill('Restore seven points after event equipment failure.');
  await team.getByRole('button', { name: 'Adjust team score', exact: true }).click();
  let original: { teamId: string; requestId: string; control: OrganizerControl } | undefined;
  await page.route('**/api/v2/admin/control', async route => { original = route.request().postDataJSON(); await route.fetch(); await route.abort(); });
  await team.getByRole('button', { name: 'Confirm change', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'The server could not be reached' })).toBeVisible();
  await expect(team.getByRole('button', { name: 'Retry pending organizer action', exact: true })).toBeEnabled();
  await page.reload();
  await page.unroute('**/api/v2/admin/control');
  await page.getByRole('button', { name: /^Live control/ }).click();
  await expect(team.getByRole('button', { name: 'Retry pending organizer action', exact: true })).toBeEnabled();
  await expect(team.getByRole('button', { name: 'Discard pending action', exact: true })).toBeDisabled();
  const retryRequest = page.waitForRequest(request => request.url().endsWith('/api/v2/admin/control') && request.method() === 'POST');
  await team.getByRole('button', { name: 'Retry pending organizer action', exact: true }).click();
  expect((await retryRequest).postDataJSON()).toEqual(original);
  await expect(page.getByText(`Adjust team score saved for ${teamName}. The reason was recorded.`, { exact: true })).toBeVisible();
  await team.getByText('Score breakdown & recent activity', { exact: true }).click();
  await expect(team.getByText(/GPS permission failed at the landmark/)).toBeVisible();
  const dashboard = await (await page.request.get('/api/v2/admin')).json();
  const result = dashboard.teams.find((candidate: { id: string }) => candidate.id === view.teamId);
  expect(result.view.score).toBe(7);
  expect(result.ledger.filter((entry: { kind: string }) => entry.kind === 'organizer_adjustment')).toHaveLength(1);
  expect(dashboard.help.find((help: { team_id: string }) => help.team_id === view.teamId).response).toBe('Use the bridge code BRIDGE.');
});
