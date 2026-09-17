import test from 'node:test'
import assert from 'node:assert/strict'
import { isPreviewSession, playerRequest, savedCommand, savedDraft, savedPlayerView, storeCommand, storeDraft, storePlayerView, type ClientPlayerView } from '../components/v2/sessionClient'

const view: ClientPlayerView = { hunt: { id: 'test', title: 'Adventure' }, teamId: 'team-a', revision: 3, status: 'active', score: 0, progress: { completed: 0, total: 1 }, checkpoint: { id: 'first', title: 'First', basePoints: 20, startedAt: '2026-01-01T00:00:00Z' }, node: { id: 'puzzle', type: 'puzzle', prompt: 'Find the answer', puzzle: { type: 'text', prompt: 'What next?' }, progress: { revision: 1, completed: false, state: { type: 'text', value: 'draft answer' } } }, hints: [], teamName: 'Explorers', members: ['Alice'], isPreview: false, eventStatus: 'live' }

test('preview namespaces isolate pending commands, cached views and input drafts', () => {
  const data = new Map<string, string>()
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  const location = { search: '' }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location } })
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) } })
  try {
    const command = { requestId: 'same-retry-key', teamId: 'team-a', command: { type: 'submit_puzzle' as const, checkpointId: 'first', nodeId: 'puzzle', expectedRevision: 1, value: { value: 'answer' } } }
    storeCommand('team-a', command); storePlayerView(view); storeDraft('text', 'unsubmitted text')
    assert.deepEqual(savedCommand('team-a'), command)
    assert.equal(savedPlayerView()?.node?.type, 'puzzle')
    location.search = '?preview=1'
    assert.equal(isPreviewSession(), true)
    assert.equal(savedCommand('team-a'), null); assert.equal(savedPlayerView(), null); assert.equal(savedDraft('text'), null)
    storePlayerView({ ...view, teamId: 'preview-team', isPreview: true }); storeDraft('text', 'preview text')
    location.search = ''
    assert.equal(savedPlayerView()?.teamId, 'team-a'); assert.equal(savedDraft('text'), 'unsubmitted text')
    assert.equal(savedCommand('team-a')?.requestId, 'same-retry-key')
    storeCommand('team-a', null)
    assert.equal(savedCommand('team-a'), null)
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window')
    if (previousStorage) Object.defineProperty(globalThis, 'sessionStorage', previousStorage); else Reflect.deleteProperty(globalThis, 'sessionStorage')
  }
})

test('every preview API request carries the preview header without breaking multipart uploads', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousFetch = globalThis.fetch
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { search: '?preview=1' }, setTimeout, clearTimeout } })
  const seen: Headers[] = []
  globalThis.fetch = async (_input, init) => { seen.push(new Headers(init?.headers)); return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }) }
  try {
    await playerRequest('/api/v2/session')
    const form = new FormData(); form.append('file', new Blob(['image']), 'photo.jpg')
    await playerRequest('/api/v2/media', { method: 'POST', body: form })
    assert.equal(seen[0].get('X-Hunt-Preview'), '1')
    assert.equal(seen[1].get('X-Hunt-Preview'), '1')
    assert.equal(seen[0].get('Content-Type'), 'application/json')
    assert.equal(seen[1].has('Content-Type'), false, 'browser must generate multipart boundary')
  } finally {
    globalThis.fetch = previousFetch
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window')
  }
})
