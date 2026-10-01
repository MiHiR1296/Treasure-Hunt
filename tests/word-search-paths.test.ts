import test from 'node:test'
import assert from 'node:assert/strict'
import { displayWordOrder, findWordPath, lineBetween, wordForPath } from '../components/v2/puzzles/word-search-paths'

test('word-search drag paths snap small pointer wobble to a straight line', () => {
  assert.deepEqual(lineBetween({ row: 2, column: 1 }, { row: 3, column: 5 }, true), [
    { row: 2, column: 1 }, { row: 2, column: 2 }, { row: 2, column: 3 }, { row: 2, column: 4 }, { row: 2, column: 5 },
  ])
  assert.deepEqual(lineBetween({ row: 1, column: 1 }, { row: 4, column: 3 }, true), [
    { row: 1, column: 1 }, { row: 2, column: 2 }, { row: 3, column: 3 }, { row: 4, column: 4 },
  ])
})

test('word-search display paths restore found words and accept reverse selections', () => {
  const grid = [['C', 'A', 'T'], ['X', 'X', 'O'], ['X', 'X', 'W']]
  assert.deepEqual(findWordPath(grid, 'CAT'), [{ row: 0, column: 0 }, { row: 0, column: 1 }, { row: 0, column: 2 }])
  assert.equal(wordForPath(grid, [{ row: 0, column: 2 }, { row: 0, column: 1 }, { row: 0, column: 0 }], ['CAT']), 'CAT')
})

test('word-search display keeps remaining targets first and moves found words below them', () => {
  assert.deepEqual(displayWordOrder(['CAT', 'DOG', 'OWL', 'EMU'], ['DOG', 'CAT']), ['OWL', 'EMU', 'CAT', 'DOG'])
})
