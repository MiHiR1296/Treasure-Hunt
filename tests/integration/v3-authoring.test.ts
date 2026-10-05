import '../isolated-database';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getPool } from '../../lib/server/db';
import {
  importV3Draft,
  organizerQrPack,
  previewV3Draft,
  publishV3Draft,
} from '../../lib/server/v3/authoring';

const enabled = Boolean(process.env.DATABASE_URL);

before(async () => {
  if (!enabled) return;
  await getPool().query(await readFile(new URL('../../database/v3.sql', import.meta.url), 'utf8'));
});

after(async () => {
  if (enabled) await getPool().end();
});

test('PostgreSQL V3 authoring: server preview receipt and versioned private QR print manifest', { skip: !enabled }, async () => {
  const definition = JSON.parse(await readFile(new URL('../../public/authoring/treasure-hunt-v3.starter.json', import.meta.url), 'utf8'));
  definition.id = `v3-qr-${randomUUID()}`;
  definition.title = 'QR publication integration';
  definition.checkpoints[0].flow = {
    startNodeId: 'scan-start',
    nodes: [
      {
        id: 'scan-start', type: 'verify_qr', prompt: 'Scan the private start marker.',
        token: '@server:generate:start-marker', backupCode: '@server:generate:start-backup', next: 'finish-start',
      },
      { id: 'finish-start', type: 'complete' },
    ],
  };
  const draft = await importV3Draft(definition) as any;
  const sessionHash = 'a'.repeat(64);
  await assert.rejects(
    publishV3Draft({ draftId: draft.id, revision: draft.revision, generation: draft.generation, adminSessionHash: sessionHash }),
    /Preview and acknowledge/i,
  );
  await previewV3Draft({ draftId: draft.id, revision: draft.revision, generation: draft.generation, adminSessionHash: sessionHash });
  const published = await publishV3Draft({ draftId: draft.id, revision: draft.revision, generation: draft.generation, adminSessionHash: sessionHash });
  assert.equal((published.definition as any).checkpoints[0].flow.nodes[0].token, '@server:generate:start-marker', 'admin draft response retains logical directives');

  const versionRow = (await getPool().query(
    'select definition from hunt_v3.hunt_versions where hunt_id=$1 and version=1',
    [definition.id],
  )).rows[0];
  const liveNode = versionRow.definition.checkpoints[0].flow.nodes[0];
  assert.match(liveNode.token, /^v3_[A-Za-z0-9_-]{40,}$/);
  assert.match(liveNode.backupCode, /^V3-[A-Z0-9_-]{8,}$/);
  assert.notEqual(liveNode.token, liveNode.backupCode);

  const pack = await organizerQrPack({ huntId: definition.id, version: 1, actor: 'Integration organizer' });
  assert.equal(pack.joinPath, `/v3?hunt=${encodeURIComponent(definition.id)}`, 'the printed join QR targets the immutable hunt ID');
  assert.equal(pack.items.length, 2);
  assert.deepEqual(new Set(pack.items.map(item => item.value)), new Set([liveNode.token, liveNode.backupCode]));
  assert.ok(pack.items.every(item => !item.value.startsWith('@server:')));
  const savedDraft = (await getPool().query('select definition from hunt_v3.drafts where id=$1', [draft.id])).rows[0].definition;
  assert.equal(savedDraft.checkpoints[0].flow.nodes[0].token, '@server:generate:start-marker');
});
