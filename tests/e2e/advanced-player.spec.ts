import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import sharp from 'sharp'
import type { HuntDefinition } from '../../lib/engine/types'

const origin = 'http://127.0.0.1:3100'
const huntId = `advanced-${randomUUID()}`
const definition: HuntDefinition = {
  schemaVersion: 1, id: huntId, version: 1, title: `Advanced adventure ${huntId.slice(-6)}`,
  settings: { leaderboard: 'finish', ranking: 'points_time', rules: 'Play together and ask for help when technology gets in the way.' },
  checkpoints: [
    { id: 'puzzles', title: 'Shared Sudoku', basePoints: 20, flow: { startNodeId: 'sudoku', nodes: [
      { id: 'sudoku', type: 'puzzle', prompt: 'Finish this small shared Sudoku.', puzzle: { type: 'sudoku', size: 4, givens: [[1, 0, 0, 4], [3, 4, 1, 2], [2, 1, 4, 3], [4, 3, 2, 1]] }, next: 'done' },
      { id: 'done', type: 'complete' },
    ] }, hints: [{ id: 'puzzle-hint', title: 'A puzzle clue', cost: 3, content: { type: 'puzzle', puzzle: { type: 'multiple_choice', prompt: 'Which direction does a compass show?', options: [{ id: 'north', label: 'North' }, { id: 'up', label: 'Up' }], correctOptionId: 'north' }, reveal: { type: 'text', text: 'The next landmark is the east arch.' } } }] },
    { id: 'location', title: 'Location Rescue', basePoints: 20, flow: { startNodeId: 'gps', nodes: [
      { id: 'gps', type: 'verify_gps', prompt: 'Check the landmark area.', latitude: 19.24, longitude: 73.13, radiusMeters: 100, maxAccuracyMeters: 50, next: 'done', fallback: { nodeId: 'backup', label: 'Use organizer backup', enabled: false } },
      { id: 'backup', type: 'verify_code', prompt: 'Enter the backup from your organizer.', code: 'BRIDGE', next: 'done' },
      { id: 'done', type: 'complete' },
    ] }, hints: [] },
    { id: 'photo', title: 'Landmark Review', basePoints: 20, flow: { startNodeId: 'photo', nodes: [
      { id: 'photo', type: 'verify_image', prompt: 'Photograph the landmark for the organizer.', referenceImages: ['/private-landmark-reference.png'], next: 'done' },
      { id: 'done', type: 'complete' },
    ] }, hints: [] },
  ],
}

async function post(request: APIRequestContext, path: string, data: unknown) { return request.post(path, { headers: { Origin: origin }, data }) }
async function join(page: Page, name: string, mode: 'create' | 'join') {
  await page.goto(`/v2?hunt=${huntId}`)
  await page.getByRole('button', { name: mode === 'create' ? 'Create a team' : 'Join a team', exact: true }).click()
  await page.getByLabel('Your hunt').selectOption(huntId)
  await page.getByLabel('Team name', { exact: true }).fill(name)
  await page.getByLabel('Team PIN').fill('123456')
  await page.getByLabel('Your name', { exact: true }).fill(mode === 'create' ? 'Alice' : 'Bob')
  await page.getByRole('button', { name: mode === 'create' ? 'Start our adventure' : 'Join the adventure', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Shared Sudoku', exact: true })).toBeVisible()
}
async function playerView(page: Page) { return (await (await page.request.get('/api/v2/session')).json()).view }

test.beforeAll(async ({ request }) => {
  expect((await post(request, '/api/v2/admin/session', { password: 'browser-test-password-only' })).ok()).toBeTruthy()
  const result = await post(request, '/api/v2/admin/hunts', { definition })
  expect(result.ok(), await result.text()).toBeTruthy()
})
test.beforeEach(async ({ request }) => {
  expect((await post(request, '/api/v2/admin/session', { password: 'browser-test-password-only' })).ok()).toBeTruthy()
})
test.afterAll(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try { await pool.query('delete from hunt_v2.hunts where id=$1', [huntId]) } finally { await pool.end() }
})

test('shared puzzles survive reload, reveal hint puzzles, recover GPS failure and review uploaded photos', async ({ page, browser, request }) => {
  test.setTimeout(120000)
  const teamName = `Advanced-${randomUUID().slice(0, 8)}`
  await join(page, teamName, 'create')
  const teammateContext = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: origin })
  const teammate = await teammateContext.newPage()
  await join(teammate, teamName, 'join')
  const staleTeammateView = await playerView(teammate)
  await teammate.route('**/api/v2/session', route => route.fulfill({ json: { view: staleTeammateView } }))
  expect((await (await page.request.get('/api/v2/leaderboard')).json()).visible).toBe(false)
  expect(JSON.stringify(await playerView(page))).not.toContain('east arch')
  await page.getByRole('button', { name: 'Choose hint: A puzzle clue (3 points)', exact: true }).click()
  await page.getByRole('button', { name: 'Reveal hint: A puzzle clue (3 points)', exact: true }).click()
  await page.getByRole('button', { name: 'North', exact: true }).click()
  await expect(page.getByText('The next landmark is the east arch.', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/advanced-player-puzzle-mobile.png', fullPage: true })

  await page.getByRole('textbox', { name: 'Row 1, column 2', exact: true }).fill('2')
  await expect(page.getByRole('textbox', { name: 'Row 1, column 2', exact: true })).toHaveValue('2')
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Row 1, column 2', exact: true })).toHaveValue('2')
  await teammate.route('**/api/v2/command', async route => {
    await teammate.unroute('**/api/v2/session')
    await route.continue()
  })
  await teammate.getByRole('textbox', { name: 'Row 1, column 3', exact: true }).fill('3')
  await expect(teammate.getByText(/Your earlier move was not applied/)).toBeVisible()
  await expect(teammate.getByRole('textbox', { name: 'Row 1, column 2', exact: true })).toHaveValue('2')
  await teammate.getByRole('textbox', { name: 'Row 1, column 3', exact: true }).fill('3')
  await expect(teammate.getByRole('heading', { name: 'Location Rescue', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Location Rescue', exact: true })).toBeVisible()
  await page.evaluate(() => Object.defineProperty(navigator.geolocation, 'getCurrentPosition', { configurable: true, value: (_success: unknown, failure: (value: unknown) => void) => failure({ code: 1, message: 'Permission denied' }) }))
  await page.getByRole('button', { name: 'I’m here — check location', exact: true }).click()
  await expect(page.getByText(/Location permission is blocked/)).toBeVisible()
  await page.getByText('Need help? Contact your organizer', { exact: true }).click()
  await page.getByLabel('What went wrong?').selectOption('gps')
  await page.getByLabel('Tell the organizer').fill('Location permission is blocked. Please enable our backup.')
  await page.getByRole('button', { name: 'Send help request', exact: true }).click()
  await expect(page.getByText('Your organizer has your request. Their reply will appear here.')).toBeVisible()
  const help = await (await page.request.get('/api/v2/help')).json()
  expect((await post(request, '/api/v2/admin/help', { helpId: help.help[0].id, message: 'Use the backup code BRIDGE.' })).ok()).toBeTruthy()
  let current = await playerView(page)
  expect((await post(request, '/api/v2/admin/control', { teamId: current.teamId, requestId: randomUUID(), control: { type: 'enable_fallback', checkpointId: 'location', nodeId: 'gps', enabled: true, expectedRevision: current.revision, reason: 'GPS permission failed during the event.' } })).ok()).toBeTruthy()
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await page.getByRole('button', { name: 'Use organizer backup', exact: true }).click()
  await page.getByLabel('Your code', { exact: true }).fill('BRIDGE')
  await page.getByRole('button', { name: 'Check code', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Landmark Review', exact: true })).toBeVisible()
  expect(JSON.stringify(await playerView(page))).not.toContain('private-landmark-reference')
  const image = await sharp({ create: { width: 200, height: 120, channels: 3, background: '#678876' } }).png().toBuffer()
  await page.getByLabel('Take or choose a photo').setInputFiles({ name: 'landmark.png', mimeType: 'image/png', buffer: image })
  await page.getByRole('button', { name: 'Send photo for review', exact: true }).click()
  await expect(page.getByText(/Your photo is waiting for organizer review/)).toBeVisible()
  await page.reload()
  await expect(page.getByText(/Your photo is waiting for organizer review/)).toBeVisible()
  current = await playerView(page)
  const approve = await post(request, '/api/v2/admin/control', { teamId: current.teamId, requestId: randomUUID(), control: { type: 'approve_action', checkpointId: 'photo', nodeId: 'photo', expectedRevision: current.revision, reason: 'The photo shows the correct landmark.' } })
  expect(approve.ok(), await approve.text()).toBeTruthy()
  // Remote approval must propagate automatically without a manual refresh.
  await expect(page.getByRole('heading', { name: 'You found your finish.', exact: true })).toBeVisible({ timeout: 20000 })
  await expect(page.getByRole('heading', { name: 'Leaderboard', exact: true })).toBeVisible()
  expect((await playerView(page)).score).toBe(57)
  await teammateContext.close()
})

test('preview keeps the normal team cookie and storage separate from test actions', async ({ page }) => {
  test.setTimeout(90000)
  await join(page, `Preview-check-${randomUUID().slice(0, 8)}`, 'create')
  const real = await playerView(page)
  const forbiddenJoin = await page.request.post('/api/v2/session', { headers: { Origin: origin, 'X-Hunt-Preview': '1' }, data: { huntId, mode: 'create', teamName: 'Must not replace live team', playerName: 'Tester', pin: '123456' } })
  expect(forbiddenJoin.status()).toBe(400)
  expect((await playerView(page)).teamId).toBe(real.teamId)
  expect((await post(page.request, '/api/v2/admin/session', { password: 'browser-test-password-only' })).ok()).toBeTruthy()
  const response = await post(page.request, '/api/v2/admin/preview', { huntId })
  expect(response.ok(), await response.text()).toBeTruthy()
  const preview = await response.json()
  await page.goto(preview.url)
  await expect(page.getByRole('heading', { name: 'Organizer preview · test team', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Simulate success', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Location Rescue', exact: true })).toBeVisible()
  expect((await playerView(page)).teamId).toBe(real.teamId)
  expect((await playerView(page)).node.type).toBe('puzzle')
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('hunt-v2-preview-last-view') || 'null')?.teamId)).toBe(preview.view.teamId)
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('hunt-v2-last-view') || 'null')?.teamId)).toBe(real.teamId)
  await page.goto(`/v2?hunt=${huntId}`)
  await expect(page.getByRole('heading', { name: 'Shared Sudoku', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Organizer preview · test team', exact: true })).not.toBeVisible()
})
