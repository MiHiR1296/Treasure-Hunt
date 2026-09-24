import { expect, test, type Locator, type Page, type Route } from '@playwright/test'
import { createInitialState, executeCommand, getPlayerView } from '../../lib/engine'
import type { GameCommand, GameState, HuntDefinition } from '../../lib/engine/types'

const crosswordDefinition: HuntDefinition = {
  schemaVersion: 1,
  id: 'mock-crossword-cells',
  version: 1,
  title: 'Crossword cell entry check',
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

const denseCrosswordAnswer = 'ABCDEFGHIJKLMNO'
const denseCrosswordDefinition: HuntDefinition = {
  schemaVersion: 1,
  id: 'mock-dense-crossword',
  version: 1,
  title: 'Dense crossword check',
  settings: { leaderboard: 'hidden' },
  checkpoints: [{ id: 'crossword', title: 'Large crossword', basePoints: 20, hints: [], flow: { startNodeId: 'grid', nodes: [
    { id: 'grid', type: 'puzzle', prompt: 'Fill the long word.', puzzle: { type: 'crossword', rows: 2, columns: 15, entries: [
      { id: 'long', clue: 'The alphabet from A to O', answer: denseCrosswordAnswer, row: 0, column: 0, direction: 'across' },
    ] }, next: 'done' },
    { id: 'done', type: 'complete' },
  ] } }],
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

async function installMockGame(page: Page, definition: HuntDefinition, teamId: string, prepare?: (state: GameState) => GameState) {
  let state = prepare?.(createInitialState(definition, teamId, '2026-09-24T08:00:00.000Z')) ?? createInitialState(definition, teamId, '2026-09-24T08:00:00.000Z')
  let clock = 1
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
    try {
      const result = executeCommand(definition, state, body.command, now())
      state = result.state
      await json(route, { view: view(), feedback: result.feedback })
    } catch (error) {
      const failure = error as Error & { code?: string }
      await json(route, { error: failure.message, code: failure.code }, failure.code === 'puzzle_conflict' ? 409 : 400)
    }
  })

  return { delayNext(milliseconds: number) { delay = milliseconds } }
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

async function fillCell(cell: Locator, value: string, grid: Locator) {
  await cell.fill(value)
  await expect(grid).toHaveAttribute('aria-busy', 'false')
  await expect(cell).toHaveValue(value)
}

test('main and hint crosswords use simple individual cells and preserve saved positions', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await installMockGame(page, crosswordDefinition, 'cell-team', state => preparedCrossword(state, true))
  await openGame(page, crosswordDefinition)

  const main = page.locator('section[aria-labelledby="current-question"]')
  const hints = page.locator('section[aria-label="Hints"]')
  const mainGrid = main.getByRole('group', { name: 'Crossword puzzle grid', exact: true })
  const hintGrid = hints.getByRole('group', { name: 'Crossword puzzle grid', exact: true })
  await expect(mainGrid).toBeVisible()
  await expect(hintGrid).toBeVisible()
  await expect(page.getByRole('textbox', { name: /Answer for/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Place .* in grid/ })).toHaveCount(0)
  await expect(main.getByText(/A pet that purrs \(3\)/)).toBeVisible()
  await expect(hints.getByText(/US city written without a space \(7\)/)).toBeVisible()
  await expect(mainGrid.getByRole('textbox', { name: 'Row 1, column 1, clue 1', exact: true })).toHaveValue('C')
  await expect(mainGrid.getByRole('textbox', { name: 'Row 2, column 1', exact: true })).toHaveValue('')
  await expect(mainGrid.getByRole('textbox', { name: 'Row 3, column 1', exact: true })).toHaveValue('R')
  await expect(hintGrid.getByRole('textbox', { name: 'Row 1, column 1, clue 1', exact: true })).toHaveValue('')
  const headingIds = await page.getByRole('heading', { name: 'across', exact: true }).evaluateAll(headings => headings.map(heading => heading.id))
  expect(headingIds.every(Boolean)).toBe(true)
  expect(new Set(headingIds).size).toBe(headingIds.length)
  await testInfo.attach('Simple crossword cell entry', { body: await page.screenshot({ fullPage: true, animations: 'disabled' }), contentType: 'image/png' })
})

test('incorrect crossword letters save cell by cell, retain focus, survive reload, and can be corrected', async ({ page }) => {
  const game = await installMockGame(page, crosswordDefinition, 'wrong-answer-team', state => preparedCrossword(state))
  await openGame(page, crosswordDefinition)
  const main = page.locator('section[aria-labelledby="current-question"]')
  const grid = main.getByRole('group', { name: 'Crossword puzzle grid', exact: true })
  const first = grid.getByRole('textbox', { name: 'Row 1, column 1, clue 1', exact: true })
  const second = grid.getByRole('textbox', { name: 'Row 1, column 2', exact: true })
  const third = grid.getByRole('textbox', { name: 'Row 1, column 3', exact: true })

  await fillCell(first, 'D', grid)
  await fillCell(second, 'O', grid)
  game.delayNext(300)
  await third.focus()
  await third.fill('G')
  await expect(grid).toHaveAttribute('aria-busy', 'true')
  await expect(third).toBeFocused()
  await expect(third).not.toBeDisabled()
  await expect(third).toHaveAttribute('readonly', '')
  await expect(grid).toHaveAttribute('aria-busy', 'false')
  await expect(third).toHaveValue('G')
  await expect(page.getByRole('heading', { name: 'Shared crosswords', exact: true })).toBeVisible()

  await page.reload()
  await expect(first).toHaveValue('D')
  await expect(second).toHaveValue('O')
  await expect(third).toHaveValue('G')

  await fillCell(first, 'C', grid)
  await fillCell(second, 'A', grid)
  await fillCell(third, 'T', grid)
  await fillCell(grid.getByRole('textbox', { name: 'Row 2, column 1', exact: true }), 'A', grid)
  await grid.getByRole('textbox', { name: 'Row 3, column 1', exact: true }).fill('R')
  await expect(page.getByRole('heading', { name: 'You found your finish.', exact: true })).toBeVisible()
})

test('dense crosswords keep full-size pannable cells and can fit the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await installMockGame(page, denseCrosswordDefinition, 'dense-crossword-team')
  await openGame(page, denseCrosswordDefinition)

  await expect(page.getByText(/Large crossword: swipe inside the grid/)).toBeVisible()
  const viewport = page.getByRole('region', { name: 'Scrollable crossword grid', exact: true })
  const grid = page.getByRole('group', { name: 'Crossword puzzle grid', exact: true })
  expect(await viewport.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
  const first = grid.getByRole('textbox', { name: 'Row 1, column 1, clue 1', exact: true })
  const firstBox = await first.boundingBox()
  expect(firstBox).not.toBeNull()
  expect(firstBox!.width).toBeGreaterThanOrEqual(43)
  expect(Math.abs(firstBox!.width - firstBox!.height)).toBeLessThanOrEqual(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  await page.getByRole('button', { name: 'Fit whole grid', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Enlarge grid', exact: true })).toBeVisible()
  const fittedBox = await grid.boundingBox()
  expect(fittedBox).not.toBeNull()
  expect(fittedBox!.x + fittedBox!.width).toBeLessThanOrEqual(320)
})

test('word search highlights one instruction and replaces checking text only after confirmation', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 700 })
  const game = await installMockGame(page, denseWordSearchDefinition, 'word-team')
  await openGame(page, denseWordSearchDefinition)

  const instruction = page.getByRole('note')
  await expect(instruction).toHaveText('How to play: Tap the first letter of a word, then tap its last letter to select it.')
  await expect(instruction).toHaveCSS('background-color', 'rgb(255, 251, 235)')
  await expect(instruction).toHaveCSS('border-top-width', '2px')
  await expect(page.getByRole('heading', { name: 'How to select a word' })).toHaveCount(0)
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
  await testInfo.attach('Highlighted word-search instruction', { body: await page.screenshot({ fullPage: true, animations: 'disabled' }), contentType: 'image/png' })

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
