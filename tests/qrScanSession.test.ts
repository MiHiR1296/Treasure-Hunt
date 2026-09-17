import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraErrorMessage, QRScanSession } from '../lib/utils/qrScanSession';

test('wrong and dud codes keep a session open until an accepted code', async () => {
  const session = new QRScanSession();
  assert.deepEqual(await session.scan('wrong', () => false), { status: 'rejected', message: undefined });
  assert.deepEqual(await session.scan('dud', () => ({ accepted: false, message: 'Try the other tree!' })), { status: 'rejected', message: 'Try the other tree!' });
  assert.equal((await session.scan('right', async () => ({ accepted: true }))).status, 'accepted');
  assert.equal((await session.scan('right-again', () => { throw new Error('Must not validate twice'); })).status, 'ignored');
});

test('consecutive frames and rapid rescans cannot submit parallel requests', async () => {
  let release!: (accepted: boolean) => void;
  let calls = 0;
  const session = new QRScanSession();
  const first = session.scan('one', () => { calls += 1; return new Promise<boolean>((resolve) => { release = resolve; }); });
  assert.equal((await session.scan('one', () => { calls += 1; return true; })).status, 'ignored');
  assert.equal((await session.scan('two', () => { calls += 1; return true; })).status, 'ignored');
  release(false);
  assert.equal((await first).status, 'rejected');
  assert.equal(calls, 1);
  assert.equal((await session.scan('two', () => true)).status, 'accepted');
});

test('rejected duplicate is throttled after validation completes and can be retried later', async () => {
  let clock = 100;
  const session = new QRScanSession(1500, () => clock);
  await session.scan('wrong', () => { clock = 5000; return false; });
  clock = 6000;
  assert.equal((await session.scan('wrong', () => true)).status, 'ignored');
  clock = 6500;
  assert.equal((await session.scan('wrong', () => true)).status, 'accepted');
});

test('network failure releases the validation guard without closing the session', async () => {
  const session = new QRScanSession(0);
  await assert.rejects(() => session.scan('valid', async () => { throw new Error('offline'); }), /offline/);
  assert.equal((await session.scan('valid', async () => true)).status, 'accepted');
});

test('unmount during validation ignores the eventual result', async () => {
  const session = new QRScanSession();
  let release!: (accepted: boolean) => void;
  const pending = session.scan('valid', () => new Promise<boolean>((resolve) => { release = resolve; }));
  session.dispose();
  release(true);
  assert.equal((await pending).status, 'ignored');
  assert.equal((await session.scan('another', () => true)).status, 'ignored');
});

test('legacy callbacks returning void still accept a scan', async () => {
  assert.equal((await new QRScanSession().scan('legacy', () => undefined)).status, 'accepted');
});

test('camera failures are translated into actionable messages without exception text', () => {
  assert.match(cameraErrorMessage({ name: 'NotAllowedError' }), /browser settings/);
  assert.match(cameraErrorMessage({ name: 'NotFoundError' }), /No camera/);
  assert.match(cameraErrorMessage({ name: 'NotReadableError' }), /another app/);
  assert.equal(cameraErrorMessage(new Error('Private device internals')), 'The camera could not start. Try again or use the backup code.');
});
