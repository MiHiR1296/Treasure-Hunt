import { createHmac } from 'node:crypto'

export type SeedPart = string | number | boolean

function assertSeed(privateSeed: string) {
  if (!privateSeed || privateSeed.length > 1024) throw new RangeError('A bounded, non-empty private run seed is required.')
}

function fraction(privateSeed: string, namespace: string, parts: readonly SeedPart[]): number {
  assertSeed(privateSeed)
  if (!namespace || namespace.length > 100) throw new RangeError('A bounded seed namespace is required.')
  const digest = createHmac('sha256', privateSeed)
    .update(JSON.stringify(['treasure-hunt-v3', 3, namespace, ...parts]))
    .digest()
  // Six bytes fit exactly in JavaScript's safe integer range and provide a
  // stable [0, 1) fraction without exposing the private seed to the client.
  return digest.readUIntBE(0, 6) / 281474976710656
}

export function deterministicIndex(
  privateSeed: string,
  namespace: string,
  length: number,
  ...parts: SeedPart[]
): number {
  if (!Number.isSafeInteger(length) || length < 1) throw new RangeError('A deterministic choice needs at least one bounded option.')
  return Math.floor(fraction(privateSeed, namespace, parts) * length)
}

export function deterministicPick<T>(
  privateSeed: string,
  namespace: string,
  values: readonly T[],
  ...parts: SeedPart[]
): T {
  return values[deterministicIndex(privateSeed, namespace, values.length, ...parts)]
}

export function deterministicShuffle<T>(
  privateSeed: string,
  namespace: string,
  values: readonly T[],
  ...parts: SeedPart[]
): T[] {
  const shuffled = [...values]
  for (let index = shuffled.length - 1; index > 0; index--) {
    const selected = deterministicIndex(privateSeed, namespace, index + 1, ...parts, index)
    ;[shuffled[index], shuffled[selected]] = [shuffled[selected], shuffled[index]]
  }
  return shuffled
}

export function deterministicWeightedIndex(
  privateSeed: string,
  namespace: string,
  weights: readonly number[],
  ...parts: SeedPart[]
): number {
  if (!weights.length || weights.some(weight => !Number.isFinite(weight) || weight <= 0)) {
    throw new RangeError('Deterministic weights must be finite positive numbers.')
  }
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (!Number.isFinite(total)) throw new RangeError('The total deterministic weight is too large.')
  let position = fraction(privateSeed, namespace, parts) * total
  for (let index = 0; index < weights.length; index++) {
    position -= weights[index]
    if (position < 0) return index
  }
  return weights.length - 1
}
