import type { PoolClient } from 'pg';
import { parseHuntDefinition, validateHunt } from '../engine';
import type { HuntDefinition } from '../engine/types';
import { getPool, transaction } from './db';
import { HttpError } from './security';
import { assertPublishedMedia, lockMediaReferences } from './media-references';

export type HuntStatus = 'ready' | 'live' | 'paused' | 'ended' | 'archived';
export interface Draft { id: string; definition: HuntDefinition; revision: number; updatedAt: string; issues: ReturnType<typeof validateHunt> }
export const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value);

export function validatedDefinition(input: unknown) {
  const issues = validateHunt(input);
  if (issues.length) throw new HttpError(400, `This hunt has ${issues.length} configuration issue${issues.length === 1 ? '' : 's'}.`, { issues });
  return parseHuntDefinition(input);
}

export async function listHunts() {
  const { rows } = await getPool().query("select id,title,definition,status from hunt_v2.hunts where status in ('ready','live','paused') and not is_preview order by created_at");
  return rows.map(row => {
    const definition = row.definition as HuntDefinition;
    return { id: row.id, title: row.title, status: row.status, description: definition.description,
      rules: definition.settings?.rules, startsAt: definition.settings?.startsAt, endsAt: definition.settings?.endsAt,
      registrationOpen: definition.settings?.registrationOpen !== false, coverUrl: definition.theme?.coverUrl };
  });
}

export async function saveDraft(input: unknown, expectedRevision: number | null): Promise<Draft> {
  if (!input || typeof input !== 'object' || !validId((input as { id?: unknown }).id)) throw new HttpError(400, 'Give this hunt a valid ID before saving.');
  if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) throw new HttpError(400, 'A valid draft revision is required.');
  const definition = JSON.parse(JSON.stringify(input)) as HuntDefinition;
  const result = await transaction(async client => {
    await assertPublishedMedia(client, definition);
    const query = expectedRevision === null
      ? await client.query('insert into hunt_v2.drafts(id,definition) values($1,$2) on conflict do nothing returning *', [definition.id, definition])
      : await client.query('update hunt_v2.drafts set definition=$1,revision=revision+1,updated_at=now() where id=$2 and revision=$3 returning *', [definition, definition.id, expectedRevision]);
    if (!query.rows[0]) throw new HttpError(409, 'This draft changed in another window. Load its latest version before saving your changes.');
    return query.rows[0];
  });
  return { id: result.id, definition: result.definition, revision: result.revision, updatedAt: result.updated_at, issues: validateHunt(result.definition) };
}

export async function listDrafts(): Promise<Draft[]> {
  const { rows } = await getPool().query('select * from hunt_v2.drafts order by updated_at desc');
  return rows.map(row => ({ id: row.id, definition: row.definition, revision: row.revision, updatedAt: row.updated_at, issues: validateHunt(row.definition) }));
}

export async function publishInTransaction(client: PoolClient, input: unknown, options: { expectedVersion?: number; status?: HuntStatus; preview?: boolean } = {}) {
  let definition = validatedDefinition(input);
  await assertPublishedMedia(client, definition);
  const status = options.status || 'live';
  const inserted = await client.query(`insert into hunt_v2.hunts(id,title,version,definition,status,is_preview)
    values($1,$2,$3,$4,$5,$6) on conflict do nothing returning id`, [definition.id, definition.title, definition.version, definition, status, options.preview === true]);
  if (!inserted.rowCount) {
    const { rows } = await client.query('select version,is_preview from hunt_v2.hunts where id=$1 for update', [definition.id]);
    if (options.expectedVersion === undefined || rows[0].version !== options.expectedVersion || rows[0].is_preview) {
      throw new HttpError(409, 'A published hunt with this ID already exists or changed. Edit its draft and publish against the latest version.');
    }
    definition = { ...definition, version: rows[0].version + 1 };
    await client.query('update hunt_v2.hunts set title=$1,version=$2,definition=$3,status=$4 where id=$5', [definition.title, definition.version, definition, status, definition.id]);
  }
  await client.query('insert into hunt_v2.hunt_versions(hunt_id,version,definition) values($1,$2,$3)', [definition.id, definition.version, definition]);
  await client.query('insert into hunt_v2.admin_events(action,hunt_id,details) values($1,$2,$3)', ['hunt_published', definition.id, { version: definition.version, status, preview: options.preview === true }]);
  return definition;
}

export async function publishHunt(input: unknown, options: { expectedVersion?: number; status?: HuntStatus } = {}) {
  return transaction(client => publishInTransaction(client, input, options));
}

export async function publishDraft(id: string, revision: number, options: { expectedVersion?: number; status?: HuntStatus } = {}) {
  return transaction(async client => {
    await lockMediaReferences(client);
    const { rows } = await client.query('select definition,revision from hunt_v2.drafts where id=$1 for update', [id]);
    if (!rows[0] || rows[0].revision !== revision) throw new HttpError(409, 'Save and load the latest draft before publishing.');
    const definition = await publishInTransaction(client, rows[0].definition, options);
    await client.query('update hunt_v2.drafts set definition=$1,revision=revision+1,updated_at=now() where id=$2', [definition, id]);
    return definition;
  });
}

export async function setHuntStatus(huntId: string, status: HuntStatus) {
  const transitions: Record<HuntStatus, HuntStatus[]> = {
    ready: ['live', 'archived'], live: ['paused', 'ended'], paused: ['live', 'ended', 'archived'],
    ended: ['live', 'archived'], archived: ['ready'],
  };
  if (!Object.hasOwn(transitions, status)) throw new HttpError(400, 'Choose a supported event status.');
  await transaction(async client => {
    const { rows } = await client.query('select status from hunt_v2.hunts where id=$1 for update', [huntId]);
    if (!rows[0]) throw new HttpError(404, 'Hunt not found.');
    if (rows[0].status === status) return;
    if (!transitions[rows[0].status as HuntStatus].includes(status)) throw new HttpError(409, `Cannot move directly from ${rows[0].status} to ${status}.`);
    await client.query('update hunt_v2.hunts set status=$1 where id=$2', [status, huntId]);
    await client.query('insert into hunt_v2.admin_events(action,hunt_id) values($1,$2)', [`hunt_${status}`, huntId]);
  });
}

export function assertPlayable(status: HuntStatus, definition: HuntDefinition, registration = false, now = Date.now()) {
  if (status !== 'live') throw new HttpError(409, status === 'paused' ? 'The organizer has paused this hunt. Your progress is saved.' : 'This hunt is not currently open for play.');
  if (definition.settings?.startsAt && now < Date.parse(definition.settings.startsAt)) throw new HttpError(409, 'This hunt has not started yet.');
  if (definition.settings?.endsAt && now > Date.parse(definition.settings.endsAt)) throw new HttpError(409, 'This hunt has ended. Your progress is saved.');
  if (registration && definition.settings?.registrationOpen === false) throw new HttpError(409, 'Registration is closed for this hunt. Existing teams can still continue.');
}
