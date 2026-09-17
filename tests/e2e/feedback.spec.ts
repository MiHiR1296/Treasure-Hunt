import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { HuntDefinition } from '../../lib/engine/types';

const origin = 'http://127.0.0.1:3100';
const huntId = `feedback-${randomUUID()}`;
const longClue = Array.from({ length: 10 }, (_, index) => `Trail note ${index + 1}: Follow the winding garden path past the old gate. Look closely at the signs, compare your ideas with your team, and keep your direction in mind before answering the clue.`).join('\n\n');
const definition: HuntDefinition = {
  schemaVersion: 1, id: huntId, version: 1, title: 'Visible feedback adventure',
  settings: { leaderboard: 'hidden' }, theme: { feedback: true, successAnimation: 'celebrate' },
  checkpoints: [
    { id: 'riddle', title: 'The long garden clue', basePoints: 20, hints: [], flow: { startNodeId: 'answer', nodes: [
      { id: 'answer', type: 'verify_answer', prompt: `${longClue}\n\nWhat instrument points north?`, answers: ['compass'], next: 'done' },
      { id: 'done', type: 'complete' },
    ] } },
    { id: 'next', title: 'The next garden clue', basePoints: 10, hints: [], flow: { startNodeId: 'clue', nodes: [
      { id: 'clue', type: 'show_text', text: 'Your next destination is the old oak tree.', next: 'done' },
      { id: 'done', type: 'complete' },
    ] } },
  ],
};
const post = (request: APIRequestContext, path: string, data: unknown) => request.post(path, { headers: { Origin: origin }, data });

async function join(page: Page) {
  const response = await post(page.request, '/api/v2/session', { huntId, mode: 'create', teamName: `Feedback ${randomUUID().slice(0, 8)}`, playerName: 'Garden explorer', pin: '123456' });
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.goto(`/v2?hunt=${huntId}`);
  await expect(page.getByRole('heading', { name: 'The long garden clue', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sound off', exact: true })).toBeVisible();
}

async function observeCues(page: Page) {
  await page.addInitScript(() => {
    const cues = { oscillatorStarts: 0, vibrations: 0 };
    Object.assign(window, { feedbackCues: cues });
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      const createOscillator = AudioContextClass.prototype.createOscillator;
      AudioContextClass.prototype.createOscillator = function () {
        const oscillator = createOscillator.call(this);
        const start = oscillator.start.bind(oscillator);
        oscillator.start = (when?: number) => { cues.oscillatorStarts++; start(when); };
        return oscillator;
      };
    }
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: () => { cues.vibrations++; return true; } });
  });
}

const cues = (page: Page) => page.evaluate(() => (window as unknown as { feedbackCues: { oscillatorStarts: number; vibrations: number } }).feedbackCues);

async function answer(page: Page, value: string) {
  const input = page.getByRole('textbox', { name: 'Your answer', exact: true });
  await input.fill(value);
  const response = page.waitForResponse(result => result.url().endsWith('/api/v2/command') && result.request().method() === 'POST');
  // Submitting from the field exercises the same form path used by a keyboard's return key.
  // Browser emulation cannot reproduce a physical phone's soft keyboard.
  await input.press('Enter');
  const result = await response;
  expect(result.ok(), await result.text()).toBeTruthy();
  return result;
}

async function expectInViewport(locator: Locator, page: Page) {
  await expect(locator).toBeInViewport({ ratio: 1 });
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
}

test.beforeAll(async ({ request }) => {
  expect((await post(request, '/api/v2/admin/session', { password: 'browser-test-password-only' })).ok()).toBeTruthy();
  const response = await post(request, '/api/v2/admin/hunts', { definition });
  expect(response.ok(), await response.text()).toBeTruthy();
});
test.afterAll(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try { await pool.query('delete from hunt_v2.hunts where id=$1', [huntId]); } finally { await pool.end(); }
});

test('320px answer feedback stays beside a scrolled field, repeats accessibly, and success awards points once', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await observeCues(page);
  await join(page);
  const input = page.getByRole('textbox', { name: 'Your answer', exact: true });
  await input.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(600);
  const feedback = page.getByTestId('task-feedback');
  for (let attempt = 0; attempt < 2; attempt++) {
    await answer(page, 'needle');
    await expect(input).toBeEnabled();
    await expect(feedback).toContainText('Not quite. Give it another try.');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(await page.getByTestId('feedback-toast').evaluate(element => element.closest('[role]')?.getAttribute('role'))).toBe('alert');
    const feedbackId = await feedback.getAttribute('id');
    expect(feedbackId).toBeTruthy();
    expect((await input.getAttribute('aria-describedby'))?.split(/\s+/)).toContain(feedbackId);
    await expectInViewport(input, page);
    await expectInViewport(feedback, page);
    const inputBox = (await input.boundingBox())!;
    const feedbackBox = (await feedback.boundingBox())!;
    expect(feedbackBox.y).toBeGreaterThanOrEqual(inputBox.y + inputBox.height - 1);
    expect(feedbackBox.y - inputBox.y - inputBox.height).toBeLessThan(120);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(600);
  }
  await page.screenshot({ path: testInfo.outputPath('repeated-wrong-answer-320px.png'), fullPage: false, animations: 'disabled' });
  const accepted = await answer(page, 'compass');
  const acceptedBody = await accepted.json();
  expect(acceptedBody.view.score).toBe(20);
  await expect(page.getByRole('heading', { name: 'The next garden clue', exact: true })).toBeVisible();
  const toast = page.getByTestId('feedback-toast');
  await expect(toast).toContainText('Correct answer!');
  expect(await toast.evaluate(element => element.closest('[role]')?.getAttribute('role'))).toBe('status');
  await expectInViewport(toast, page);
  expect(await toast.evaluate(element => {
    for (let node: Element | null = element; node; node = node.parentElement) if (getComputedStyle(node).position === 'fixed') return true;
    return false;
  })).toBe(true);
  await expect(page.getByTestId('score-change')).toContainText(/\+20/);
  await expect(page.getByRole('region', { name: 'Team progress' })).toContainText('20');
  expect((await cues(page)).oscillatorStarts).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('successful-answer-320px.png'), fullPage: false, animations: 'disabled' });

  const retry = await post(page.request, '/api/v2/command', accepted.request().postDataJSON());
  expect(retry.ok(), await retry.text()).toBeTruthy();
  const retriedBody = await retry.json();
  expect(retriedBody.view.score).toBe(20);
  expect(retriedBody.view.revision).toBe(acceptedBody.view.revision);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  const refreshed = (await (await page.request.get('/api/v2/session')).json()).view;
  expect(refreshed.score).toBe(20);
  expect(refreshed.progress.completed).toBe(1);
  expect(refreshed.revision).toBe(acceptedBody.view.revision);
});

test('390px sound is opt-in, survives reload and never plays from restored state or polling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await observeCues(page);
  await join(page);
  expect((await cues(page)).oscillatorStarts).toBe(0);
  await page.getByRole('button', { name: 'Sound off', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sound on', exact: true })).toBeVisible();
  const enabledCount = (await cues(page)).oscillatorStarts;
  await answer(page, 'compass');
  await expect(page.getByTestId('feedback-toast')).toContainText('Correct answer!');
  await expect.poll(async () => (await cues(page)).oscillatorStarts).toBeGreaterThan(enabledCount);
  const restored = page.waitForResponse(response => response.url().endsWith('/api/v2/session') && response.request().method() === 'GET');
  await page.reload();
  expect((await restored).ok()).toBeTruthy();
  await expect(page.getByRole('heading', { name: 'The next garden clue', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sound on', exact: true })).toBeVisible();
  expect((await cues(page)).oscillatorStarts).toBe(0);
  // Observe a real timer-driven read rather than synthesizing a command or focus event.
  const poll = await page.waitForResponse(response => response.url().endsWith('/api/v2/session') && response.request().method() === 'GET', { timeout: 12_000 });
  expect(poll.ok()).toBeTruthy();
  expect((await cues(page)).oscillatorStarts).toBe(0);
  await page.getByRole('button', { name: 'Sound on', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sound off', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sound off', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'You found your finish.', exact: true })).toBeVisible();
  expect((await cues(page)).oscillatorStarts).toBe(0);
});

test('reduced motion retains clear error and success messages without animations or vibration', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await observeCues(page);
  await join(page);
  await answer(page, 'needle');
  const error = page.getByTestId('task-feedback');
  await expect(error).toContainText('Not quite. Give it another try.');
  await expect(page.getByRole('textbox', { name: 'Your answer', exact: true })).toHaveAttribute('aria-invalid', 'true');
  expect(await error.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
  await answer(page, 'compass');
  const toast = page.getByTestId('feedback-toast');
  await expect(toast).toContainText('Correct answer!');
  await expectInViewport(toast, page);
  expect(await toast.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
  await expect(page.getByTestId('score-change')).toContainText(/\+20/);
  expect(await cues(page)).toEqual({ oscillatorStarts: 0, vibrations: 0 });
});
