import type { PendingRunCommand, SessionRunSummary } from './types';

export class V3RequestError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) {
    super(message);
    this.name = 'V3RequestError';
  }
}

export async function v3Request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), url === '/api/v3/media' ? 120_000 : 20_000);
  try {
    const headers = new Headers(init.headers);
    if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      credentials: 'same-origin',
      headers,
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({})) as { error?: unknown; code?: unknown };
    if (!response.ok) {
      throw new V3RequestError(
        response.status,
        typeof body.error === 'string' ? body.error : 'We could not complete that request. Please try again.',
        typeof body.code === 'string' ? body.code : undefined,
      );
    }
    return body as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new V3RequestError(408, 'The connection took too long. Check your signal and try again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function newRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const pendingKey = (runId: string) => `hunt-v3-pending:${runId}`;

export function readPendingCommand(runId: string): PendingRunCommand | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(pendingKey(runId)) || 'null') as PendingRunCommand | null;
    return value?.runId === runId && typeof value.requestId === 'string' && typeof value.command?.type === 'string' ? value : null;
  } catch {
    return null;
  }
}

export function writePendingCommand(runId: string, value: PendingRunCommand | null) {
  try {
    if (value) sessionStorage.setItem(pendingKey(runId), JSON.stringify(value));
    else sessionStorage.removeItem(pendingKey(runId));
  } catch {
    // The server receipt still protects duplicate commands when storage is unavailable.
  }
}

/** Accept both the initial SQL-row response and the preferred camel-cased API response. */
export function normalizeRunSummary(value: unknown): SessionRunSummary | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string') return null;
  const status = String(row.status ?? 'active') as SessionRunSummary['status'];
  return {
    id: row.id,
    runNumber: Number(row.runNumber ?? row.run_number ?? 1),
    status,
    practice: Boolean(row.practice),
    eligible: row.eligible !== false,
    score: Number(row.score ?? 0),
    elapsedMilliseconds: row.elapsedMilliseconds == null && row.elapsed_ms == null
      ? null
      : Number(row.elapsedMilliseconds ?? row.elapsed_ms),
    ...(row.progress === undefined ? {} : { progress: Number(row.progress) }),
    currentCheckpointId: typeof (row.currentCheckpointId ?? row.current_checkpoint_id) === 'string'
      ? String(row.currentCheckpointId ?? row.current_checkpoint_id)
      : null,
    ...(row.startedAt || row.started_at ? { startedAt: String(row.startedAt ?? row.started_at) } : {}),
    completedAt: row.completedAt || row.completed_at ? String(row.completedAt ?? row.completed_at) : null,
  };
}

export function formatDuration(milliseconds: number | null | undefined): string {
  if (!Number.isFinite(milliseconds)) return '—';
  const totalSeconds = Math.max(0, Math.round(Number(milliseconds) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${minutes}:${String(seconds).padStart(2, '0')}`;
}
