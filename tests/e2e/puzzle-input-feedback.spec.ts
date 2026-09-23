import { expect, test, type Locator, type Page, type Route } from '@playwright/test'
import { createInitialState, executeCommand, getPlayerView } from '../../lib/engine'
import type { GameCommand, GameState, HuntDefinition } from '../../lib/engine/types'

const crosswordDefinition: HuntDefinition = {
  schemaVersion: 1,
  id: 'mock-crossword-recovery',
  version: 1,
  title: 'Crossword recovery check',
  settings: { leaderboard: 'hidden' },
  checkpoints: [{
    id: 'crosswords',
    title: 'Shared crosswords',
    basePoints: 20,
    flow: { startNodeId: 'main', nodes: [
      { id: 'main', type: 'puzzle', prompt: 'Complete the shared crossword.', puzzle: { type: 'crossword', rows: 3, columns: 3, entries: [
        { id: 'shared', clue: 'A pet that purrs', answer: 'CAT', row: 0, column: 0, direction: 'across' },
        { id: 'down', clue: 'A road vehicle', answer: 'CAR', row: 0, column: 0, direction: 'down' },
      ] }, next: 'done' },
      { id: 'done', type: 'complete' },
    ] },
    hints: [{ id: 'city-hint', title: 'City spelling practice', cost: 0, content: { type: 'puzzle', puzzle: { type: 'crossword', rows: 2, columns: 7, entries: [
      { id: 'shared', clue: 'US city written without a space', answer: 'NEWYORK', row: 0, column: 0, direction: 'across' },
    ] }, reveal: { type: 'text', text: 'The hint is revealed.' } } }],
  }],
}

const denseGrid = Array.from({ length: 25 }, (_, row) => Array.from({ length: 25 }, (_, column) => String.fromCharCode(65 + (row * 7 + column * 11) % 26)))
denseGrid[0][0] = 'C'; denseGrid[0][1] = 'A'; denseGrid[0][2] = 'T'
denseGrid[1][0] = 'D'; denseGrid[1][1] = 'O'; denseGrid[1][2] = 'G'
const denseWordSearchDefinition: HuntDefinition = {
  schemaVersion: 1,
  id: 'mock-dense-word-search',
  version: 1,
  title: 'Dense word search check',
  settings: { leaderboard: 'hidden' },
  checkpoints: [{ id: 'words', title: 'Find the words', basePoints: 20, hints: [], flow: { startNodeId: 'search', nodes: [
    { id: 'search', type: 'puzzle', prompt: 'Find both hidden words.', puzzle: { type: 'word_search', grid: denseGrid, words: ['CAT', 'DOG'] }, next: 'done' },
    { id: 'done', type: 'complete' },
  ] } }],
}

type Rejection = { status: number; code: string; error: string }

async function installMockGame(page: Page, definition: HuntDefinition, teamId: string, prepare?: (state: GameState) => GameState) {
  let state = prepare?.(createInitialState(definition, teamId, '2026-09-24T08:00:00.000Z')) ?? createInitialState(definition, teamId, '2026-09-24T08:00:00.000Z')
  let clock = 1
  let rejection: Rejection | null = null
  let conflictValue: unknown
  let delay = 0
  const now = () => `2026-09-24T08:00:${String(clock++).padStart(2, '0')}.000Z`
  const view = () => ({ ...getPlayerView(definition, state, now()), teamName: 'Mock team', members: ['Mira'], isPreview: false, eventStatus: 'live' as const })
  const json = (route: Route, value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })

  await page.route('**/api/v2/session', route => json(route, { view: view() }))
  await page.route('**/api/v2/hunts', route => json(route, { hunts: [{ id: definition.id, title: definition.title }] }))
  await page.route('**/api/v2/help', route => json(route, { help: [], messages: [] }))
  await page.route('**/api/v2/command', async route => {
    const body = route.request().postDataJSON() as { command: GameCommand }
    if (delay) { const wait = delay; delay = 0; await new Promise(resolve => setTimeout(resolve, wait)) }
    if (rejection) { const failure = rejection; rejection = null; await json(route, failure, failure.status); return }
    if (conflictValue !== undefined && (body.command.type === 'submit_puzzle' || body.command.type === 'submit_hint_puzzle')) {
      const teammate = { ...body.command, value: conflictValue } as GameCommand
      conflictValue = undefined
      state = executeCommand(definition, state, teammate, now()).state
      await json(route, { error: 'A teammate updated this puzzle. Refresh to see their work before making another move.', code: 'puzzle_conflict' }, 409)
      return
    }
    try {
      const result = executeCommand(definition, state, body.command, now())
      state = result.state
      await json(route, { view: view(), feedback: result.feedback })
    } catch (error) {
      const failure = error as Error & { code?: string }
      await json(route, { error: failure.message, code: failure.code }, failure.code === 'puzzle_conflict' ? 409 : 400)
    }
  })

  return {
    rejectNext(value: Rejection) { rejection = value },
    conflictNext(value: unknown) { conflictValue = value },
    delayNext(milliseconds: number) { delay = milliseconds },
    replaceTeam(nextTeamId: string, nextPrepare?: (value: GameState) => GameState) {
      const fresh = createInitialState(definition, nextTeamId, now())
      state = nextPrepare?.(fresh) ?? fresh
    },
  }
}

function preparedCrossword(state: GameState, partial = false): GameState {
  const started = Date.parse(state.startedAt!)
  let next = executeCommand(crosswordDefinition, state, { type: 'use_hint', checkpointId: 'crosswords', hintId: 'city-hint' }, new Date(started + 1000).toISOString()).state
  if (partial) next = executeCommand(crosswordDefinition, next, { type: 'submit_puzzle', checkpointId: 'crosswords', nodeId: 'main', expectedRevision: 0, value: { grid: [['C', '', ''], ['', '', ''], ['R', '', '']] } }, new Date(started + 2000).toISOString()).state
  return next
}

async function openGame(page: Page, definition: HuntDefinition) {
  await page.goto(`/v2?hunt=${definition.id}`)
  await expect(page.getByRole('heading', { name: definition.checkpoints[0].title, exact: true })).toBeVisible()
}

async function paste(input: Locator, value: string) {
  await input.focus()
  await input.evaluate((element, text) => {
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } })
    element.dispatchEvent(event)
  }, value)
}

test('crossword drafts survive other moves, failures, conflicts and reload without losing positions or puzzle scope', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 700 })
  const game = await installMockGame(page, crosswordDefinition, 'draft-team', state => preparedCrossword(state, true))
  await openGame(page, crosswordDefinition)

  const main = page.locator('section[aria-labelledby="current-question"]')
  const hints = page.locator('section[aria-label="Hints"]')
  const across = main.getByRole('textbox', { name: 'Answer for 1 across', exact: true })
  const down = main.getByRole('textbox', { name: 'Answer for 1 down', exact: true })
  const hint = hints.getByRole('textbox', { name: 'Answer for 1 across', exact: true })
  await expect(main.getByLabel('Shared boxes: C, blank, R')).toBeVisible()
  await expect(main.getByRole('button', { name: 'Place 1 down in grid', exact: true })).toBeDisabled()

  await across.fill('CAT')
  await down.fill('CAR')
  await paste(hint, 'New York!')
  await expect(hint).toHaveValue('NEWYORK')
  await expect(page.getByText(/Draft saved on this device/)).toHaveCount(3)
  const ids = await page.getByRole('textbox', { name: 'Answer for 1 across', exact: true }).evaluateAll(inputs => inputs.map(input => input.id))
  expect(new Set(ids).size).toBe(ids.length)
  await hints.locator('label').filter({ hasText: 'US city written without a space' }).click()
  await expect(hint).toBeFocused()
  await testInfo.attach('Crossword drafts and shared progress', { body: await page.screenshot({ fullPage: true, animations: 'disabled' }), contentType: 'image/png' })

  await page.reload()
  await expect(across).toHaveValue('CAT')
  await expect(down).toHaveValue('CAR')
  await expect(hint).toHaveValue('NEWYORK')

  await main.getByRole('button', { name: 'Place 1 across in grid', exact: true }).click()
  await expect(across).toHaveValue('')
  await expect(down).toHaveValue('CAR')
  await expect(hint).toHaveValue('NEWYORK')
  await expect(main.getByLabel('Shared boxes: C, A, T')).toBeVisible()
  await expect(main.getByLabel('Shared boxes: C, blank, R')).toBeVisible()

  const middleAcrossCell = main.getByRole('textbox', { name: 'Row 1, column 2', exact: true })
  await middleAcrossCell.fill('X')
  await expect(down).toHaveValue('CAR')
  await expect(hint).toHaveValue('NEWYORK')

  game.rejectNext({ status: 422, code: 'invalid_submission', error: 'The move was not stored.' })
  await main.getByRole('button', { name: 'Place 1 down in grid', exact: true }).click()
  await expect(down).toHaveValue('CAR')
  await expect(page.getByText('The move was not stored.', { exact: true })).toBeVisible()
  await page.reload()
  await expect(down).toHaveValue('CAR')
  await expect(hint).toHaveValue('NEWYORK')

  game.conflictNext({ grid: [['C', 'A', 'T'], ['', '', ''], ['R', '', '']] })
  await main.getByRole('button', { name: 'Place 1 down in grid', exact: true }).click()
  await expect(page.getByText(/Your teammate’s latest puzzle is shown below/)).toBeVisible()
  await expect(down).toHaveValue('CAR')
  await expect(hint).toHaveValue('NEWYORK')
  await expect(main.getByLabel('Shared boxes: C, A, T')).toBeVisible()

  await main.getByRole('button', { name: 'Place 1 down in grid', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'You found your finish.', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('hunt-v2-draft:draft-team:crosswords:main:main-puzzle'))).toBeNull()
  expect(JSON.parse(await page.evaluate(() => sessionStorage.getItem('hunt-v2-draft:draft-team:crosswords:city-hint:hint-puzzle')) || '{}')).toEqual({ shared: 'NEWYORK' })
})

test('complete incorrect crossword answers save normally, keep focus, and can be corrected to finish', async ({ page }) => {
  const game = await installMockGame(page, crosswordDefinition, 'wrong-answer-team', state => preparedCrossword(state))
  await openGame(page, crosswordDefinition)
  const main = page.locator('section[aria-labelledby="current-question"]')
  const across = main.getByRole('textbox', { name: 'Answer for 1 across', exact: true })

  await across.fill('DOG')
  game.delayNext(400)
  await across.press('Enter')
  await expect(across).toBeFocused()
  await expect(across).not.toBeDisabled()
  await expect(across).toHaveAttribute('readonly', '')
  await expect(main.getByLabel('Shared boxes: D, O, G')).toBeVisible()
  await expect(across).toHaveValue('')
  await expect(across).toBeFocused()
  await expect(page.getByRole('heading', { name: 'Shared crosswords', exact: true })).toBeVisible()

  await paste(across, 'C-A-T')
  await expect(across).toHaveValue('CAT')
  await main.getByRole('button', { name: 'Place 1 across in grid', exact: true }).click()
  const down = main.getByRole('textbox', { name: 'Answer for 1 down', exact: true })
  await down.fill('CAR')
  await main.getByRole('button', { name: 'Place 1 down in grid', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'You found your finish.', exact: true })).toBeVisible()
})

test('draft storage is isolated when the active team changes', async ({ page }) => {
  const game = await installMockGame(page, crosswordDefinition, 'first-team', state => preparedCrossword(state))
  await openGame(page, crosswordDefinition)
  const answer = page.locator('section[aria-labelledby="current-question"]').getByRole('textbox', { name: 'Answer for 1 across', exact: true })
  await answer.fill('CAT')
  await expect(answer).toHaveValue('CAT')

  game.replaceTeam('second-team', state => preparedCrossword(state))
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(answer).toHaveValue('')
  expect(JSON.parse(await page.evaluate(() => sessionStorage.getItem('hunt-v2-draft:first-team:crosswords:main:main-puzzle')) || '{}')).toEqual({ shared: 'CAT' })
  expect(await page.evaluate(() => sessionStorage.getItem('hunt-v2-draft:second-team:crosswords:main:main-puzzle'))).toBeNull()
})

test('dense word searches open enlarged for panning and replace checking text only after confirmation', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 700 })
  const game = await installMockGame(page, denseWordSearchDefinition, 'word-team')
  await openGame(page, denseWordSearchDefinition)

  await expect(page.getByText(/Large grid mode: swipe inside the grid/)).toBeVisible()
  const viewport = page.getByRole('region', { name: 'Scrollable word search', exact: true })
  const grid = page.getByRole('group', { name: 'Word search puzzle grid', exact: true })
  expect(await viewport.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
  const first = grid.getByRole('button', { name: 'C, row 1, column 1', exact: true })
  const firstBox = await first.boundingBox()
  expect(firstBox).not.toBeNull()
  expect(firstBox!.width).toBeGreaterThanOrEqual(43)
  expect(Math.abs(firstBox!.width - firstBox!.height)).toBeLessThanOrEqual(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await testInfo.attach('Dense word-search enlarged view', { body: await page.screenshot({ fullPage: true, animations: 'disabled' }), contentType: 'image/png' })

  game.delayNext(300)
  await first.click()
  await grid.getByRole('button', { name: 'T, row 1, column 3', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Checking CAT…' })).toBeVisible()
  await expect(page.getByText('✓ CAT found', { exact: true })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'CAT found!' })).toBeVisible()
  await expect(page.getByText('Checking CAT…', { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Fit whole grid', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Enlarge letters', exact: true })).toBeVisible()
  const fittedBox = await grid.boundingBox()
  expect(fittedBox).not.toBeNull()
  expect(fittedBox!.x + fittedBox!.width).toBeLessThanOrEqual(320)
  const fittedCell = await first.boundingBox()
  expect(fittedCell).not.toBeNull()
  expect(Math.abs(fittedCell!.width - fittedCell!.height)).toBeLessThanOrEqual(1)
})
