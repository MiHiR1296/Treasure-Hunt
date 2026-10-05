import { HttpError } from '../security';

const reserved = new Set([
  'admin', 'administrator', 'organiser', 'organizer', 'staff', 'support',
  'test', 'testing', 'demo', 'sample', 'null', 'undefined', 'team', 'treasure hunt',
]);
const keyboardRuns = ['asdf', 'qwer', 'zxcv', 'hjkl', '1234', 'abcd'];

export function normalizedKey(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

export function validateMemberName(input: unknown): string {
  if (typeof input !== 'string') throw new HttpError(400, 'Enter your name.');
  const name = input.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 60 || /[\p{Cc}\p{Cf}]/u.test(name)) throw new HttpError(400, 'Use a visible name of at most 60 characters without formatting controls.');
  return name;
}

/** Canonical team codes remain the authoritative identity; nicknames are optional. */
export function validateOptionalTeamName(input: unknown): string | null {
  if (input === undefined || input === null || input === '') return null;
  if (typeof input !== 'string') throw new HttpError(400, 'Enter a team nickname or leave it blank.');
  const name = input.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!name) return null;
  if (name.length < 2 || name.length > 40 || /[\p{Cc}\p{Cf}]/u.test(name)) {
    throw new HttpError(400, 'Team nicknames must be 2 to 40 visible characters without formatting controls.');
  }
  const key = normalizedKey(name).replace(/[\s_-]+/g, ' ');
  const compact = key.replace(/[^\p{L}\p{N}]/gu, '');
  const obviousPlaceholder = reserved.has(key)
    || /^test\s*[-_#]?\s*\d*$/i.test(key)
    || /^team\s*[-_#]?\s*\d+$/i.test(key)
    || keyboardRuns.some(run => compact.includes(run))
    || /(.)\1{4,}/u.test(compact)
    // The vowel heuristic is intentionally ASCII-only. Applying it to every
    // script would reject legitimate Marathi, Arabic, CJK, and other names.
    || (/^[a-z]+$/i.test(compact) && compact.length >= 7 && !/[aeiouy]/i.test(compact));
  if (obviousPlaceholder) {
    throw new HttpError(400, 'Choose a recognizable team nickname, or leave it blank and use your team code.');
  }
  return name;
}

export function formatTeamCode(number: number) {
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('A positive team number is required.');
  return `T-${String(number).padStart(3, '0')}`;
}
