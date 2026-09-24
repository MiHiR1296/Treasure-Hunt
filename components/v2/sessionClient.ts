import type { GameCommand, PlayerView } from '@/lib/engine/types';

export type ClientPlayerView = PlayerView & {
  teamName?: string;
  members?: Array<string | { name?: string; playerName?: string }>;
  isPreview?: boolean;
  eventStatus?: string;
};

export function isPreviewSession(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('preview') === '1';
}

function storageKey(suffix: string): string { return `${isPreviewSession() ? 'hunt-v2-preview' : 'hunt-v2'}-${suffix}`; }

export class PlayerRequestError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) {
    super(message);
    this.name = 'PlayerRequestError';
  }
}

export async function playerRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), url === '/api/v2/media' ? 120000 : 15000);
  try {
    const headers = new Headers(init.headers);
    if (!(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    if (isPreviewSession()) headers.set('X-Hunt-Preview', '1');
    const response = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store', credentials: 'same-origin', headers });
    const body = await response.json();
    if (!response.ok) throw new PlayerRequestError(response.status, typeof body.error === 'string' ? body.error : 'We could not complete that request. Please try again.', body.code);
    return body as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

export interface PendingCommand { requestId: string; teamId: string; command: GameCommand }

export function newRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function savedCommand(teamId: string): PendingCommand | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey(`pending:${teamId}`)) || 'null');
    return value && value.teamId === teamId && typeof value.requestId === 'string' && typeof value.command?.type === 'string' ? value : null;
  } catch { return null; }
}

export function storeCommand(teamId: string, pending: PendingCommand | null) {
  try {
    if (pending) sessionStorage.setItem(storageKey(`pending:${teamId}`), JSON.stringify(pending));
    else sessionStorage.removeItem(storageKey(`pending:${teamId}`));
  } catch { /* The in-memory receipt still protects retries if browser storage is blocked. */ }
}

/** A display-only snapshot. The server must authenticate before any mutation. */
export function savedPlayerView(): ClientPlayerView | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey('last-view')) || 'null');
    if (!value || typeof value.teamId !== 'string' || !Number.isFinite(value.revision) ||
        typeof value.hunt?.title !== 'string' || typeof value.hunt?.id !== 'string' ||
        !Number.isFinite(value.score) || !Number.isFinite(value.progress?.completed) ||
        !Number.isFinite(value.progress?.total) || !Array.isArray(value.hints) ||
        !value.hints.every((hint: { id?: unknown; title?: unknown } | null) => hint && typeof hint.id === 'string' && typeof hint.title === 'string') ||
        !['active', 'completed'].includes(value.status) ||
        (value.checkpoint !== null && (typeof value.checkpoint?.id !== 'string' || typeof value.checkpoint?.title !== 'string')) ||
        (value.node !== null && (typeof value.node?.id !== 'string' ||
          !['show_text', 'show_media', 'verify_qr', 'verify_code', 'verify_answer', 'verify_gps', 'choose_path', 'puzzle', 'camera_guide', 'verify_image', 'verify_organizer'].includes(value.node?.type) ||
          (value.node.type === 'choose_path' && !Array.isArray(value.node.choices))))) return null;
    return value as ClientPlayerView;
  } catch { return null; }
}

export function storePlayerView(view: ClientPlayerView | null) {
  try {
    if (view) sessionStorage.setItem(storageKey('last-view'), JSON.stringify(view));
    else sessionStorage.removeItem(storageKey('last-view'));
  } catch { /* Network state remains authoritative when storage is unavailable. */ }
}

export function savedDraft<T>(key: string): T | null {
  try { return JSON.parse(sessionStorage.getItem(storageKey(`draft:${key}`)) || 'null') as T | null; } catch { return null; }
}

export function storeDraft(key: string, value: unknown): boolean {
  try {
    if (value === null) sessionStorage.removeItem(storageKey(`draft:${key}`));
    else sessionStorage.setItem(storageKey(`draft:${key}`), JSON.stringify(value));
    return true;
  } catch {
    // Inputs remain usable when device storage is blocked.
    return false;
  }
}
