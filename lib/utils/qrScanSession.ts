export type ScanAcceptance = void | boolean | { accepted: boolean; message?: string };
export type ScanHandler = (value: string) => ScanAcceptance | Promise<ScanAcceptance>;
export type ScanOutcome = { status: 'ignored' | 'accepted' | 'rejected'; message?: string };

/** Decoding a QR is not the same as accepting it. Owns one camera session. */
export class QRScanSession {
  private busy = false;
  private finished = false;
  private disposed = false;
  private lastValue: string | null = null;
  private retryAfter = 0;

  constructor(private readonly duplicateDelayMs = 1800, private readonly now = Date.now) {}

  dispose() { this.disposed = true; }

  async scan(value: string, validate: ScanHandler): Promise<ScanOutcome> {
    if (this.disposed || this.finished || this.busy ||
        (value === this.lastValue && this.now() < this.retryAfter)) return { status: 'ignored' };
    this.busy = true;
    this.lastValue = value;
    try {
      const result = await validate(value);
      if (this.disposed) return { status: 'ignored' };
      // Existing V1 callbacks return void. V2 callers explicitly accept or reject.
      const accepted = typeof result === 'object' ? result.accepted : result !== false;
      this.finished = accepted;
      return { status: accepted ? 'accepted' : 'rejected', message: typeof result === 'object' ? result.message : undefined };
    } finally {
      this.busy = false;
      this.retryAfter = this.now() + this.duplicateDelayMs;
    }
  }
}

export function cameraErrorMessage(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (/NotAllowed|PermissionDenied|permission|denied/i.test(`${name} ${message}`)) {
    return 'Camera permission is blocked. Enable camera access in your browser settings, then try again or use the backup code.';
  }
  if (/NotFound|DevicesNotFound|Requested device not found/i.test(`${name} ${message}`)) {
    return 'No camera was found on this device. Use another device or the backup code.';
  }
  if (/NotReadable|TrackStart|in use/i.test(`${name} ${message}`)) {
    return 'Your camera is being used by another app. Close that app and try again.';
  }
  return 'The camera could not start. Try again or use the backup code.';
}
