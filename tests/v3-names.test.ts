import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTeamCode, normalizedKey, validateMemberName, validateOptionalTeamName } from '../lib/server/v3/names';
import { HttpError } from '../lib/server/security';

test('V3 canonical team codes are stable and human-scannable', () => {
  assert.equal(formatTeamCode(1), 'T-001');
  assert.equal(formatTeamCode(14), 'T-014');
  assert.equal(formatTeamCode(1_204), 'T-1204');
});

test('V3 team nicknames normalize useful names and reject disposable placeholders', () => {
  assert.equal(validateOptionalTeamName('  The   Falcons  '), 'The Falcons');
  assert.equal(validateOptionalTeamName('शिवशक्ती'), 'शिवशक्ती');
  assert.equal(validateOptionalTeamName(''), null);
  assert.equal(normalizedKey('  Świft  Crew '), 'świft crew');
  assert.equal(normalizedKey('Ｆａｌｃｏｎｓ'), normalizedKey('Falcons'));
  for (const value of ['Test 1', 'test-2', 'asdf squad', 'Vznzgnzfn', 'AAAAAA']) {
    assert.throws(() => validateOptionalTeamName(value), (error: unknown) => error instanceof HttpError && error.status === 400);
  }
});

test('V3 member names remain Unicode-friendly and bounded', () => {
  assert.equal(validateMemberName('  Aarav   Patil '), 'Aarav Patil');
  assert.equal(validateMemberName('प्रिया'), 'प्रिया');
  assert.throws(() => validateMemberName(''));
  for (const spoofed of ['Falcons\u202EliamE', 'Falcons\u200B', 'Aarav\u2066']) {
    assert.throws(() => validateMemberName(spoofed), (error: unknown) => error instanceof HttpError && error.status === 400);
    assert.throws(() => validateOptionalTeamName(spoofed), (error: unknown) => error instanceof HttpError && error.status === 400);
  }
});
