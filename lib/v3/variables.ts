import type { VariableGenerator } from './types'
import type { VariableValue } from '../engine/types'
import { deterministicIndex, deterministicPick } from './seed'

const VARIABLE_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const PLACEHOLDER = /{{\s*([A-Za-z][A-Za-z0-9_]*)\s*}}/g

export class VariableResolutionError extends Error {
  constructor(public readonly code: 'invalid_generator' | 'unknown_variable' | 'invalid_template', message: string) {
    super(message)
    this.name = 'VariableResolutionError'
  }
}

function invalid(message: string): never {
  throw new VariableResolutionError('invalid_generator', message)
}

function resolveGenerator(privateSeed: string, key: string, generator: VariableGenerator): VariableValue {
  if (generator.type === 'literal') return generator.value
  if (generator.type === 'choice') {
    if (!generator.values.length || generator.values.length > 10_000) invalid(`Variable "${key}" needs between 1 and 10,000 choices.`)
    return deterministicPick(privateSeed, 'variable-choice', generator.values, key)
  }
  if (generator.type === 'integer') {
    const step = generator.step ?? 1
    if (![generator.minimum, generator.maximum, step].every(Number.isSafeInteger) || step < 1 || generator.maximum < generator.minimum) {
      invalid(`Variable "${key}" has an invalid integer range.`)
    }
    const optionCount = Math.floor((generator.maximum - generator.minimum) / step) + 1
    if (!Number.isSafeInteger(optionCount) || optionCount < 1 || optionCount > 1_000_000) invalid(`Variable "${key}" has too many integer values.`)
    return generator.minimum + deterministicIndex(privateSeed, 'variable-integer', optionCount, key) * step
  }
  const alphabet = Array.from(generator.alphabet)
  if (alphabet.length < 2 || alphabet.length > 128 || new Set(alphabet).size !== alphabet.length) {
    invalid(`Variable "${key}" needs 2 to 128 unique code characters.`)
  }
  if (!Number.isSafeInteger(generator.length) || generator.length < 1 || generator.length > 64) {
    invalid(`Variable "${key}" needs a code length from 1 to 64.`)
  }
  return Array.from({ length: generator.length }, (_, position) =>
    deterministicPick(privateSeed, 'variable-code-character', alphabet, key, position),
  ).join('')
}

export function resolveVariables(
  privateSeed: string,
  generators: Readonly<Record<string, VariableGenerator>>,
): Record<string, VariableValue> {
  const resolved: Record<string, VariableValue> = {}
  for (const key of Object.keys(generators).sort()) {
    if (!VARIABLE_KEY.test(key)) invalid(`"${key}" is not a safe variable name.`)
    resolved[key] = resolveGenerator(privateSeed, key, generators[key])
  }
  return resolved
}

/** Replaces only bounded {{name}} placeholders. It never evaluates expressions. */
export function renderVariableTemplate(template: string, variables: Readonly<Record<string, VariableValue>>): string {
  if (template.length > 100_000) throw new VariableResolutionError('invalid_template', 'Template text is too long.')
  if (/{{|}}/.test(template.replace(PLACEHOLDER, ''))) {
    throw new VariableResolutionError('invalid_template', 'Template contains a malformed placeholder.')
  }
  const unresolved = new Set<string>()
  const rendered = template.replace(PLACEHOLDER, (_match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(variables, key)) {
      unresolved.add(key)
      return _match
    }
    return String(variables[key])
  })
  if (unresolved.size) throw new VariableResolutionError('unknown_variable', `Unknown variable${unresolved.size === 1 ? '' : 's'}: ${[...unresolved].join(', ')}.`)
  return rendered
}
