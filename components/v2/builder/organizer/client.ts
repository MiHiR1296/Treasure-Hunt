import type { GameEvent, GameState, HuntDefinition, PlayerView, ScoreEntry, ValidationIssue } from '@/lib/engine/types';

export type HuntStatus = 'ready' | 'live' | 'paused' | 'ended' | 'archived';
export interface PublishedHunt { id: string; title: string; version: number; status: HuntStatus; definition: HuntDefinition }
export interface Draft { id: string; definition: HuntDefinition; revision: number; updatedAt: string; issues: ValidationIssue[] }
export interface OrganizerTeam { id: string; name: string; huntId: string; version: number; isPreview: boolean; view: PlayerView; lastActivity: string; ledger: ScoreEntry[]; events: GameEvent[]; checkpoints: GameState['checkpoints'] }
export interface HelpRequest { id: string; team_id: string; team_name: string; hunt_id: string; checkpoint_id: string; node_id: string; kind: string; message: string; status: 'open' | 'resolved'; response?: string; created_at: string }
export interface PhotoRequest { id: string; team_id: string; checkpoint_id: string; node_id: string; created_at: string; team_name: string; hunt_id: string; referenceImages: string[] }
export interface Dashboard { hunts: PublishedHunt[]; drafts: Draft[]; teams: OrganizerTeam[]; help: HelpRequest[]; photos: PhotoRequest[]; example: HuntDefinition; templates?: { id: string; title: string; description: string; definition: HuntDefinition }[] }
export interface Asset { id: string; url: string; contentType: string; bytes: number }
export type RunOperation = (key: string, operation: () => Promise<void>) => Promise<void>;
export interface OperationProps { dashboard: Dashboard; pending: string; run: RunOperation; refresh: () => Promise<void>; notify: (message: string) => void }

export class AdminRequestError extends Error {
  constructor(message: string, readonly status: number, readonly issues: ValidationIssue[] = []) { super(message); }
}

export async function adminRequest<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), body instanceof FormData ? 60000 : 20000);
  try {
    const response = await fetch(url, { method, cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
      headers: body === undefined || body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new AdminRequestError(typeof data.error === 'string' ? data.error : 'This request could not be completed. Please try again.', response.status, Array.isArray(data.issues) ? data.issues : []);
    return data as T;
  } catch (error) {
    if (error instanceof AdminRequestError) throw error;
    throw new AdminRequestError('The server could not be reached. Your unsent changes remain here. Check your connection and try again.', 0);
  } finally { window.clearTimeout(timer); }
}

export function requestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export const eventLabels: Record<GameEvent['type'], string> = {
  checkpoint_started: 'Checkpoint started', action_completed: 'Step completed', verification_failed: 'Verification did not match',
  dud_qr_scanned: 'Decoy QR scanned', hint_used: 'Hint revealed', checkpoint_completed: 'Checkpoint completed',
  hunt_completed: 'Hunt finished', organizer_override: 'Organizer intervention', checkpoint_selected: 'Checkpoint selected',
  checkpoint_skipped: 'Checkpoint skipped', puzzle_saved: 'Puzzle progress saved', puzzle_completed: 'Puzzle solved',
  photo_submitted: 'Photo awaiting review', photo_rejected: 'Photo needs another attempt', fallback_used: 'Recovery route used', points_changed: 'Score changed',
};
export const scoreLabels: Record<ScoreEntry['kind'], string> = {
  checkpoint_completed: 'Checkpoint points', hint_used: 'Hint cost', wrong_attempt: 'Wrong-attempt penalty', skip_penalty: 'Skip penalty',
  time_bonus: 'Time bonus', action_points: 'Action points', organizer_adjustment: 'Organizer adjustment', refund: 'Refund', dud_discovery: 'Decoy discovery',
};
