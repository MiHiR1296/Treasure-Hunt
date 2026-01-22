// Puzzle answer validation utilities

export function validateAnswer(submitted: string, expected: string): boolean {
  const normalizedSubmitted = submitted.trim().toLowerCase();
  const normalizedExpected = expected.trim().toLowerCase();
  return normalizedSubmitted === normalizedExpected;
}

export function validateQRCode(scanned: string, expected: string): boolean {
  return scanned === expected;
}
