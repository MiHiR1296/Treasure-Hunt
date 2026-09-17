import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QRCodeSVG } from 'qrcode.react'
import { Pool } from 'pg'
import type { HuntDefinition } from '../../lib/engine/types'

const origin = 'http://127.0.0.1:3100'
const huntId = `camera-${randomUUID()}`
const definition: HuntDefinition = {
  schemaVersion: 1, id: huntId, version: 1, title: 'Camera recovery check',
  dudQrs: [{ token: 'virtual-coffee', message: 'Only coffee here. Keep scanning!' }],
  checkpoints: [{ id: 'marker', title: 'Find the marker', basePoints: 20, hints: [], flow: {
    startNodeId: 'scan', nodes: [
      { id: 'scan', type: 'verify_qr', prompt: 'Scan the marker to finish.', token: 'virtual-correct-marker', next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  } }],
}

// The browser receives a real video MediaStream; the production QR decoder is
// untouched. This verifies decoding/lifecycle, not a physical phone's camera.
type CameraHarness = { canvas: HTMLCanvasElement; stream: MediaStream; track: MediaStreamTrack; opens: number }
type CameraWindow = Window & { qrTestCamera: CameraHarness }
const qrImage = (value: string) => `data:image/svg+xml;base64,${Buffer.from(renderToStaticMarkup(createElement(QRCodeSVG, { value, size: 400, marginSize: 4, level: 'M', xmlns: 'http://www.w3.org/2000/svg' }))).toString('base64')}`

test.beforeAll(async ({ request }) => {
  expect((await request.post('/api/v2/admin/session', { headers: { Origin: origin }, data: { password: 'browser-test-password-only' } })).ok()).toBeTruthy()
  expect((await request.post('/api/v2/admin/hunts', { headers: { Origin: origin }, data: { definition } })).ok()).toBeTruthy()
})
test.afterAll(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try { await pool.query('delete from hunt_v2.hunts where id=$1', [huntId]) } finally { await pool.end() }
})

test('real QR decoder keeps one virtual camera open through wrong and dud codes, then releases it on success', async ({ page }) => {
  await page.goto(`/v2?hunt=${huntId}`)
  await page.getByRole('button', { name: 'Create a team', exact: true }).click()
  await page.getByLabel('Team name', { exact: true }).fill(`Camera-${randomUUID().slice(0, 8)}`)
  await page.getByLabel('Team PIN').fill('123456')
  await page.getByLabel('Your name', { exact: true }).fill('Camera tester')
  await page.getByRole('button', { name: 'Start our adventure', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Find the marker', exact: true })).toBeVisible()
  await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 640; canvas.height = 640
    const context = canvas.getContext('2d')!
    context.fillStyle = 'white'; context.fillRect(0, 0, 640, 640)
    const stream = canvas.captureStream(10)
    const harness: CameraHarness = { canvas, stream, track: stream.getVideoTracks()[0], opens: 0 }
    ;(window as unknown as CameraWindow).qrTestCamera = harness
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      harness.opens += 1
      return harness.stream
    } })
  })
  let concurrent = 0
  let maxConcurrent = 0
  let acceptedPosts = 0
  await page.route('**/api/v2/command', async route => {
    concurrent += 1; maxConcurrent = Math.max(maxConcurrent, concurrent)
    if (route.request().postDataJSON().command.value === 'virtual-correct-marker') acceptedPosts += 1
    try {
      // Hold several camera frames to exercise the in-flight validation guard.
      await new Promise(resolve => setTimeout(resolve, 650))
      await route.continue()
    } finally { concurrent -= 1 }
  })
  await page.getByRole('button', { name: 'Start QR scanner', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop scanner', exact: true })).toBeVisible()
  const show = async (value: string) => page.evaluate(async url => {
    const image = new Image(); image.src = url
    await image.decode()
    const context = (window as unknown as CameraWindow).qrTestCamera.canvas.getContext('2d')!
    context.fillStyle = 'white'; context.fillRect(0, 0, 640, 640)
    context.drawImage(image, 120, 120, 400, 400)
  }, qrImage(value))
  const camera = () => page.evaluate(() => {
    const harness = (window as unknown as CameraWindow).qrTestCamera
    return { opens: harness.opens, state: harness.track.readyState }
  })
  await show('virtual-wrong-marker')
  await expect(page.getByText('That is not the code for this task. Keep looking and try again.').first()).toBeVisible()
  expect(await camera()).toEqual({ opens: 1, state: 'live' })
  await show('virtual-coffee')
  await expect(page.getByText('Only coffee here. Keep scanning!').first()).toBeVisible()
  expect(await camera()).toEqual({ opens: 1, state: 'live' })
  await show('virtual-correct-marker')
  await expect(page.getByRole('heading', { name: 'You found your finish.', exact: true })).toBeVisible()
  await expect.poll(camera).toEqual({ opens: 1, state: 'ended' })
  expect(maxConcurrent).toBe(1)
  expect(acceptedPosts).toBe(1)
  const { view } = await (await page.request.get('/api/v2/session')).json()
  expect(view.score).toBe(20)
})
