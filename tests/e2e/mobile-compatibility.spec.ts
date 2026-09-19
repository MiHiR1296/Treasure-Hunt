import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { HuntDefinition } from '../../lib/engine/types';

const origin = 'http://127.0.0.1:3100';
const huntId = `mobile-${randomUUID()}`;
const definition: HuntDefinition = {
  schemaVersion: 1, id: huntId, version: 1, title: 'Keyboard and camera adventure', settings: { leaderboard: 'hidden' }, theme: { primaryColor: '#00aa00', feedback: true },
  checkpoints: [{ id: 'shared', title: 'Accessible puzzles', basePoints: 20, hints: [], flow: { startNodeId: 'sudoku', nodes: [
    { id: 'sudoku', type: 'puzzle', prompt: 'Complete two squares.', puzzle: { type: 'sudoku', size: 4, givens: [[1, 0, 0, 4], [3, 4, 1, 2], [2, 1, 4, 3], [4, 3, 2, 1]] }, next: 'crossword' },
    { id: 'crossword', type: 'puzzle', prompt: 'Complete the crossing words.', puzzle: { type: 'crossword', rows: 3, columns: 3, entries: [
      { id: 'cat', row: 0, column: 0, direction: 'across', answer: 'CAT', clue: 'A pet that purrs' },
      { id: 'car', row: 0, column: 0, direction: 'down', answer: 'CAR', clue: 'A road vehicle' },
    ] }, next: 'camera' },
    { id: 'camera', type: 'camera_guide', prompt: 'Compare the landmark by eye.', referenceImageUrl: '/v2/demo/gate-outline.svg', next: 'done' },
    { id: 'done', type: 'complete' },
  ] } }],
};
const post = (request: APIRequestContext, route: string, data: unknown) => request.post(route, { headers: { Origin: origin }, data });

async function join(page: Page) {
  const response = await post(page.request, '/api/v2/session', { huntId, mode: 'create', teamName: `Mobile ${randomUUID().slice(0, 8)}`, playerName: 'Keyboard explorer', pin: '123456' });
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.goto(`/v2?hunt=${huntId}`);
  await expect(page.getByRole('group', { name: 'Sudoku puzzle grid' })).toBeVisible();
}
async function fillAndSave(page: Page, cell: Locator, value: string, grid: Locator) {
  const response = page.waitForResponse(result => result.url().endsWith('/api/v2/command') && result.request().method() === 'POST');
  await cell.fill(value);
  expect((await response).ok()).toBeTruthy();
  await expect(grid).toHaveAttribute('aria-busy', 'false');
}

test.beforeAll(async ({ request }) => {
  expect((await post(request, '/api/v2/admin/session', { password: 'browser-test-password-only' })).ok()).toBeTruthy();
  const result = await post(request, '/api/v2/admin/hunts', { definition });
  expect(result.ok(), await result.text()).toBeTruthy();
});
test.afterAll(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try { await pool.query('delete from hunt_v2.hunts where id=$1', [huntId]); } finally { await pool.end(); }
});

test('serial grid saves retain keyboard focus, skip printed cells and fit portrait and landscape', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 568 });
  await join(page);
  const sudoku = page.getByRole('group', { name: 'Sudoku puzzle grid' });
  const first = sudoku.getByRole('textbox', { name: 'Row 1, column 2', exact: true });
  const second = sudoku.getByRole('textbox', { name: 'Row 1, column 3', exact: true });
  await first.focus();
  await page.keyboard.press('Tab');
  await expect(second).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(first).toBeFocused();
  await expect(sudoku.getByRole('textbox', { name: 'Row 1, column 1, printed number', exact: true })).toHaveAttribute('tabindex', '-1');
  let release: (() => void) | undefined;
  await page.route('**/api/v2/command', async route => { await new Promise<void>(resolve => { release = resolve; }); await route.continue(); });
  await first.fill('2');
  await expect(sudoku).toHaveAttribute('aria-busy', 'true');
  await expect(first).toBeFocused();
  await expect(first).not.toBeDisabled();
  await expect(first).toHaveAttribute('readonly', '');
  await expect.poll(() => typeof release).toBe('function');
  release!();
  await expect(sudoku).toHaveAttribute('aria-busy', 'false');
  await page.unroute('**/api/v2/command');
  await expect(first).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(second).toBeFocused();
  await second.fill('3');

  const crossword = page.getByRole('group', { name: 'Crossword puzzle grid' });
  await expect(crossword).toBeVisible();
  const corner = crossword.getByRole('textbox', { name: 'Row 1, column 1, clue 1', exact: true });
  await fillAndSave(page, corner, 'X', crossword);
  await expect(corner).toBeFocused();
  await page.keyboard.press('ArrowRight');
  const across = crossword.getByRole('textbox', { name: 'Row 1, column 2', exact: true });
  await expect(across).toBeFocused();
  await fillAndSave(page, across, 'A', crossword);
  await page.keyboard.press('ArrowLeft');
  await expect(corner).toBeFocused();
  const selection = await corner.evaluate(input => ({ start: (input as HTMLInputElement).selectionStart, end: (input as HTMLInputElement).selectionEnd }));
  expect(selection).toEqual({ start: 0, end: 1 });
  await page.keyboard.press('ArrowDown');
  const down = crossword.getByRole('textbox', { name: 'Row 2, column 1', exact: true });
  await expect(down).toBeFocused();
  await fillAndSave(page, down, 'A', crossword);
  for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(crossword).toBeVisible();
  }
  await page.reload();
  await expect(crossword.getByRole('textbox', { name: 'Row 2, column 1', exact: true })).toHaveValue('A');
});

test('camera playback failures release acquired tracks, and leaving a live guide stops its camera', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await join(page);
  expect((await post(request, '/api/v2/admin/session', { password: 'browser-test-password-only' })).ok()).toBeTruthy();
  for (let step = 0; step < 2; step++) {
    const { view } = await (await page.request.get('/api/v2/session')).json();
    const result = await post(request, '/api/v2/admin/control', { teamId: view.teamId, requestId: randomUUID(), control: { type: 'approve_action', checkpointId: 'shared', nodeId: view.node.id, expectedRevision: view.revision, reason: 'Set up camera lifecycle compatibility verification.' } });
    expect(result.ok(), await result.text()).toBeTruthy();
  }
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open camera guide', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const state = { acquired: 0, stopped: 0, failPlayback: true, vibrations: 0 };
    Object.assign(window, { cameraTest: state });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { state.acquired++; return { getTracks: () => [{ stop: () => { state.stopped++; } }] }; } });
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, set() {}, get() { return null; } });
    Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: async () => { if (state.failPlayback) throw new DOMException('Playback blocked', 'NotAllowedError'); } });
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: () => { state.vibrations++; return true; } });
  });
  await page.getByRole('button', { name: 'Open camera guide', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /Camera permission is blocked/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open camera guide', exact: true })).toBeVisible();
  const cameraState = () => page.evaluate(() => (window as unknown as { cameraTest: { acquired: number; stopped: number; vibrations: number } }).cameraTest);
  expect(await cameraState()).toMatchObject({ acquired: 1, stopped: 1 });
  await page.evaluate(() => { (window as unknown as { cameraTest: { failPlayback: boolean } }).cameraTest.failPlayback = false; });
  await page.getByRole('button', { name: 'Open camera guide', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close camera', exact: true })).toBeVisible();
  expect(await cameraState()).toMatchObject({ acquired: 2, stopped: 1 });
  const continueButton = page.getByRole('button', { name: 'Continue after finding the landmark', exact: true });
  await expect(continueButton).toHaveCSS('color', 'rgb(28, 25, 23)');
  await expect(continueButton).toHaveCSS('background-color', 'rgb(0, 170, 0)');
  await continueButton.hover();
  await expect(continueButton).toHaveCSS('filter', 'none');
  await expect(continueButton).toHaveCSS('transition-property', 'none');
  expect(await continueButton.evaluate(button => button.getAnimations().length)).toBe(0);
  await continueButton.click();
  await expect(page.getByRole('heading', { name: 'You found your finish.', exact: true })).toBeVisible();
  expect(await cameraState()).toMatchObject({ acquired: 2, stopped: 2, vibrations: 0 });
});
