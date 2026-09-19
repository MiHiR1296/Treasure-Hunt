import type { PoolClient } from 'pg';
import { HttpError } from './security';
import type { DisplayContent, PlayerView, PublicHintContent, PuzzlePublicDefinition } from '../engine/types';

/** Authorize actual rendered media fields, never player-entered labels/text. */
export function visibleMediaUrls(view: PlayerView): Set<string> {
  const urls = new Set<string>();
  const add = (url?: string) => { if (url) urls.add(url); };
  const puzzle = (definition: PuzzlePublicDefinition) => {
    if (definition.type === 'jigsaw') definition.pieces.forEach(piece => add(piece.imageUrl));
    if (definition.type === 'rotation') definition.tiles.forEach(tile => add(tile.imageUrl));
  };
  const content = (value: DisplayContent | PublicHintContent) => {
    if (value.type === 'image' || value.type === 'audio' || value.type === 'video') add(value.url);
    if (value.type === 'camera') add(value.referenceImageUrl);
    if (value.type === 'puzzle') { puzzle(value.puzzle); if (value.reveal) content(value.reveal); }
  };
  add(view.hunt.theme?.logoUrl); add(view.hunt.theme?.coverUrl); add(view.hunt.theme?.backgroundUrl);
  if (view.node?.type === 'show_media') content(view.node.content);
  if (view.node?.type === 'camera_guide') add(view.node.referenceImageUrl);
  if (view.node?.type === 'puzzle') puzzle(view.node.puzzle);
  view.hints.forEach(hint => { if (hint.status === 'used' && hint.content) content(hint.content); });
  return urls;
}

export async function lockMediaReferences(client: PoolClient) {
  // Serialize publication against asset removal; player traffic is unaffected.
  await client.query('select pg_advisory_xact_lock(193706,1)');
}
export async function assertPublishedMedia(client: PoolClient, definition: unknown) {
  await lockMediaReferences(client);
  const ids = new Set<string>();
  const inspect = (value: unknown) => {
    if (typeof value === 'string') {
      const match = /^\/api\/v2\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(value);
      if (match) ids.add(match[1]);
    } else if (Array.isArray(value)) value.forEach(inspect);
    else if (value && typeof value === 'object') Object.values(value).forEach(inspect);
  };
  inspect(definition);
  if (!ids.size) return;
  const { rows } = await client.query("select id from hunt_v2.media where id=any($1::uuid[]) and kind='asset' and (expires_at is null or expires_at>now())", [[...ids]]);
  if (rows.length !== ids.size) throw new HttpError(400, 'One or more uploaded media items are missing. Choose available media in the builder before publishing.');
}
