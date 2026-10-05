import { randomBytes, randomUUID } from 'node:crypto';
import Ajv, { type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import { validateHunt } from '../../engine';
import type { PuzzleDefinition } from '../../engine/puzzles';
import type { HuntDefinition, ValidationIssue } from '../../engine/types';
import { validateFairness } from '../../v3/fairness';
import { validateParallelMechanics } from '../../v3/planning';
import {
  CASUAL_INTEGRITY_POLICY,
  type FairnessReport,
  type FairnessRouteResult,
  type ResolvedRunPlan,
  type V3Definition,
  type VariableGenerator,
} from '../../v3/types';
import {
  generatedCodeEntropyBits,
  MINIMUM_GENERATED_CODE_ENTROPY_BITS,
  renderVariableTemplate,
  resolveVariables,
} from '../../v3/variables';
import { transaction } from '../db';
import { canonicalJson, digest, HttpError } from '../security';
import { materializeRunDefinition, materializeRunParallelMechanics } from './runtime';
import { isV3Uuid } from './security';
import v3AuthoringSchema from '../../../public/authoring/treasure-hunt-v3.schema.json';

type ObjectValue = Record<string, unknown>;
const isObject = (value: unknown): value is ObjectValue => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const topLevelKeys = new Set(['schemaVersion', 'id', 'version', 'title', 'description', 'theme', 'checkpoints', 'dudQrs', 'settings']);
const settingKeys = new Set([
  'mode', 'map', 'rules', 'maxTeamSize', 'minTeamSize', 'sessionDurationSeconds', 'registrationOpen', 'startsAt', 'endsAt',
  'completionMessage', 'photoRetention', 'registrationMode', 'runPolicy', 'leaderboardPolicy', 'publicBoard', 'socialShare',
  'recognition', 'routePlan', 'challengePools', 'variableGenerators', 'fairnessPolicy', 'parallelMechanics', 'integrityPolicy',
]);

/**
 * Upgrade only editable/imported draft JSON. Published definitions remain
 * immutable and must be migrated deliberately instead of silently inheriting
 * a less restrictive posture.
 */
export function normalizeV3DraftInput(input: unknown): unknown {
  if (!isObject(input) || input.schemaVersion !== 3 || !isObject(input.settings) || 'integrityPolicy' in input.settings) return input;
  return {
    ...input,
    settings: {
      ...input.settings,
      integrityPolicy: { ...CASUAL_INTEGRITY_POLICY },
    },
  };
}

const schemaValidator = (() => {
  const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
  addFormats(ajv);
  return ajv.compile(v3AuthoringSchema);
})();

function schemaIssuePath(error: ErrorObject) {
  const segments = error.instancePath.split('/').filter(Boolean).map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
  if (error.keyword === 'required' && typeof error.params.missingProperty === 'string') segments.push(error.params.missingProperty);
  if (error.keyword === 'additionalProperties' && typeof error.params.additionalProperty === 'string') segments.push(error.params.additionalProperty);
  return `hunt${segments.map(segment => /^\d+$/.test(segment) ? `[${segment}]` : `.${segment}`).join('')}`;
}

function engineProjection(value: ObjectValue): HuntDefinition {
  const settings = isObject(value.settings) ? value.settings : {};
  return {
    schemaVersion: 1,
    id: value.id as string,
    version: value.version as number,
    title: value.title as string,
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    checkpoints: value.checkpoints as HuntDefinition['checkpoints'],
    ...(Array.isArray(value.dudQrs) ? { dudQrs: value.dudQrs as HuntDefinition['dudQrs'] } : {}),
    ...(isObject(value.theme) ? { theme: value.theme } : {}),
    settings: {
      mode: settings.mode as HuntDefinition['settings'] extends infer T ? T extends { mode?: infer M } ? M : never : never,
      map: settings.map as 'none' | 'all' | 'visited' | undefined,
      rules: settings.rules as string | undefined,
      maxTeamSize: settings.maxTeamSize as number | undefined,
      minTeamSize: settings.minTeamSize as number | undefined,
      sessionDurationSeconds: settings.sessionDurationSeconds as number | undefined,
      registrationOpen: settings.registrationOpen as boolean | undefined,
      startsAt: settings.startsAt as string | undefined,
      endsAt: settings.endsAt as string | undefined,
      completionMessage: settings.completionMessage as string | undefined,
      photoRetention: settings.photoRetention as 'after_verification' | 'after_event' | 'retain' | undefined,
      assignmentVersion: 2,
      leaderboard: 'hidden',
    },
  };
}

const TEMPLATE_REFERENCE = /{{\s*([A-Za-z][A-Za-z0-9_]*)\s*}}/g;
const TEMPLATE_PROOF_LIMIT = 100_000;
const structuralTemplateKeys = new Set([
  'id', 'type', 'next', 'ifTrue', 'ifFalse', 'startNodeId', 'checkpointId', 'nodeId',
  'hintId', 'puzzleItemId', 'key', 'direction', 'kind', 'rankingImpact', 'bonusRankingImpact',
]);
const urlTemplateKeys = new Set(['url', 'imageUrl', 'referenceImageUrl', 'referenceImages', 'logoUrl', 'coverUrl', 'backgroundUrl']);
const simplePuzzleTextKeys = new Set(['prompt', 'clue', 'label', 'alt', 'answers']);

type TemplateUse = { path: string; key: string; template: string; variableKeys: string[]; complex: boolean };

const runTemplateRoots = [
  'hunt.description',
  'hunt.theme',
  'hunt.dudQrs',
  'hunt.checkpoints',
  'hunt.settings.rules',
  'hunt.settings.completionMessage',
  'hunt.settings.parallelMechanics',
];

function rejectUnsupportedTemplatePlacements(value: unknown, path: string, issues: ValidationIssue[]) {
  if (typeof value === 'string') {
    if ((value.includes('{{') || value.includes('}}')) && !runTemplateRoots.some(root => path === root || path.startsWith(`${root}.`) || path.startsWith(`${root}[`))) {
      issues.push({ path, message: 'Run-variable placeholders are not supported in this field. Use them only in run description/theme, checkpoint content, run messages, dud-QR content, or parallel mechanics.' });
    }
    return;
  }
  if (Array.isArray(value)) value.forEach((item, index) => rejectUnsupportedTemplatePlacements(item, `${path}[${index}]`, issues));
  else if (isObject(value)) for (const [key, child] of Object.entries(value)) rejectUnsupportedTemplatePlacements(child, `${path}.${key}`, issues);
}

function complexTemplateTarget(path: string, key: string) {
  if (urlTemplateKeys.has(key) || key === 'token' || key === 'primaryColor') return true;
  return path.includes('.puzzle.') && !simplePuzzleTextKeys.has(key);
}

function collectTemplates(
  value: unknown,
  variables: Record<string, string | number | boolean>,
  path: string,
  key: string,
  uses: TemplateUse[],
  issues: ValidationIssue[],
) {
  if (typeof value === 'string') {
    if (!value.includes('{{') && !value.includes('}}')) return;
    if (structuralTemplateKeys.has(key)) {
      issues.push({ path, message: 'Run variables cannot replace structural IDs or routing fields.' });
      return;
    }
    try {
      renderVariableTemplate(value, variables);
      const variableKeys = [...value.matchAll(TEMPLATE_REFERENCE)].map(match => match[1]);
      uses.push({ path, key, template: value, variableKeys: [...new Set(variableKeys)], complex: complexTemplateTarget(path, key) });
    } catch (error) {
      issues.push({ path, message: error instanceof Error ? error.message : 'Invalid variable placeholder.' });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectTemplates(item, variables, `${path}[${index}]`, key, uses, issues));
  } else if (isObject(value)) {
    for (const [childKey, child] of Object.entries(value)) {
      collectTemplates(child, variables, `${path}.${childKey}`, childKey, uses, issues);
    }
  }
}

function runTemplateUses(definition: V3Definition, variables: Record<string, string | number | boolean>, issues: ValidationIssue[]) {
  const uses: TemplateUse[] = [];
  if (definition.description !== undefined) collectTemplates(definition.description, variables, 'hunt.description', 'description', uses, issues);
  if (definition.theme !== undefined) collectTemplates(definition.theme, variables, 'hunt.theme', 'theme', uses, issues);
  if (definition.dudQrs !== undefined) collectTemplates(definition.dudQrs, variables, 'hunt.dudQrs', 'dudQrs', uses, issues);
  collectTemplates(definition.checkpoints, variables, 'hunt.checkpoints', 'checkpoints', uses, issues);
  if (definition.settings.rules !== undefined) collectTemplates(definition.settings.rules, variables, 'hunt.settings.rules', 'rules', uses, issues);
  if (definition.settings.completionMessage !== undefined) {
    collectTemplates(definition.settings.completionMessage, variables, 'hunt.settings.completionMessage', 'completionMessage', uses, issues);
  }
  if (definition.settings.parallelMechanics !== undefined) {
    collectTemplates(definition.settings.parallelMechanics, variables, 'hunt.settings.parallelMechanics', 'parallelMechanics', uses, issues);
  }
  return uses;
}

type TextBounds = { minimumLength: number; maximumLength: number; alwaysNonWhitespace: boolean };

function valueTextBounds(value: string | number | boolean): TextBounds {
  const text = String(value);
  return { minimumLength: text.length, maximumLength: text.length, alwaysNonWhitespace: Boolean(text.trim()) };
}

function integerTextBounds(generator: Extract<VariableGenerator, { type: 'integer' }>): TextBounds {
  const step = generator.step ?? 1;
  const count = Math.floor((generator.maximum - generator.minimum) / step) + 1;
  const last = generator.minimum + (count - 1) * step;
  const indices = new Set([0, count - 1]);
  if (generator.minimum <= 0 && last >= 0) {
    const aroundZero = (0 - generator.minimum) / step;
    indices.add(Math.max(0, Math.min(count - 1, Math.floor(aroundZero))));
    indices.add(Math.max(0, Math.min(count - 1, Math.ceil(aroundZero))));
  }
  const lengths = [...indices].map(index => String(generator.minimum + index * step).length);
  return { minimumLength: Math.min(...lengths), maximumLength: Math.max(...lengths), alwaysNonWhitespace: true };
}

function generatorTextBounds(generator: VariableGenerator): TextBounds {
  if (generator.type === 'literal') return valueTextBounds(generator.value);
  if (generator.type === 'choice') {
    const values = generator.values.map(valueTextBounds);
    return {
      minimumLength: Math.min(...values.map(value => value.minimumLength)),
      maximumLength: Math.max(...values.map(value => value.maximumLength)),
      alwaysNonWhitespace: values.every(value => value.alwaysNonWhitespace),
    };
  }
  if (generator.type === 'integer') return integerTextBounds(generator);
  const alphabet = Array.from(generator.alphabet);
  const characterLengths = alphabet.map(character => character.length);
  return {
    minimumLength: generator.length * Math.min(...characterLengths),
    maximumLength: generator.length * Math.max(...characterLengths),
    // If even one whitespace character is available, an all-whitespace code is
    // a possible generated outcome and cannot satisfy a required text field.
    alwaysNonWhitespace: alphabet.every(character => Boolean(character.trim())),
  };
}

function simpleTemplateConstraint(use: TemplateUse) {
  const inPuzzle = use.path.includes('.puzzle.');
  const maxByKey: Record<string, number> = {
    title: 200,
    group: 200,
    label: inPuzzle ? 500 : 200,
    prompt: inPuzzle ? 2_000 : 20_000,
    clue: inPuzzle ? 2_000 : 4_000,
    text: 20_000,
    alt: inPuzzle ? 500 : 1_000,
    transcript: 20_000,
    description: 20_000,
    message: 1_000,
    code: 2_048,
    backupCode: 200,
    recapAnswer: 500,
    answers: 2_048,
    rules: 20_000,
    completionMessage: 20_000,
    value: 1_000,
    equals: 1_000,
  };
  return {
    maximumLength: maxByKey[use.key] ?? 20_000,
    minimumLength: use.key === 'code' ? 4 : use.key === 'value' || use.key === 'equals' ? 0 : 1,
    requireNonWhitespace: use.key !== 'value' && use.key !== 'equals',
  };
}

function validateSimpleTemplateOutcomes(
  use: TemplateUse,
  generators: Readonly<Record<string, VariableGenerator>>,
  issues: ValidationIssue[],
) {
  if (use.complex) return;
  const staticText = use.template.replace(TEMPLATE_REFERENCE, '');
  const references = [...use.template.matchAll(TEMPLATE_REFERENCE)].map(match => match[1]);
  let minimumLength = staticText.length;
  let maximumLength = staticText.length;
  let alwaysNonWhitespace = Boolean(staticText.trim());
  for (const key of references) {
    const generator = generators[key];
    if (!generator) continue;
    const bounds = generatorTextBounds(generator);
    minimumLength += bounds.minimumLength;
    maximumLength += bounds.maximumLength;
    alwaysNonWhitespace ||= bounds.alwaysNonWhitespace;
  }
  const constraint = simpleTemplateConstraint(use);
  if (maximumLength > constraint.maximumLength) {
    issues.push({ path: use.path, message: `A possible generated value is ${maximumLength} characters; this field allows at most ${constraint.maximumLength}.` });
  }
  if (minimumLength < constraint.minimumLength) {
    issues.push({ path: use.path, message: `A possible generated value is shorter than this field's ${constraint.minimumLength}-character minimum.` });
  }
  if (constraint.requireNonWhitespace && !alwaysNonWhitespace) {
    issues.push({ path: use.path, message: 'A possible generated value is empty or whitespace-only.' });
  }
}

function exactGeneratorValues(generator: VariableGenerator, limit: number): Array<string | number | boolean> | null {
  if (generator.type === 'literal') return [generator.value];
  if (generator.type === 'choice') return generator.values.length <= limit ? [...generator.values] : null;
  if (generator.type === 'integer') {
    const step = generator.step ?? 1;
    const count = Math.floor((generator.maximum - generator.minimum) / step) + 1;
    if (!Number.isSafeInteger(count) || count > limit) return null;
    return Array.from({ length: count }, (_, index) => generator.minimum + index * step);
  }
  const alphabet = Array.from(generator.alphabet);
  const count = alphabet.length ** generator.length;
  if (!Number.isSafeInteger(count) || count > limit) return null;
  const values: string[] = [];
  const build = (prefix: string, remaining: number) => {
    if (!remaining) { values.push(prefix); return; }
    for (const character of alphabet) build(prefix + character, remaining - 1);
  };
  build('', generator.length);
  return values;
}

function enumerateVariableAssignments(
  representative: Record<string, string | number | boolean>,
  generators: Readonly<Record<string, VariableGenerator>>,
  complexUses: readonly TemplateUse[],
  routeCount: number,
  issues: ValidationIssue[],
) {
  const variableKeys = [...new Set(complexUses.flatMap(use => use.variableKeys))].sort();
  if (!variableKeys.length) return [representative];
  const maximumAssignments = Math.max(1, Math.floor(TEMPLATE_PROOF_LIMIT / Math.max(1, routeCount)));
  const values = new Map<string, Array<string | number | boolean>>();
  let combinations = 1;
  for (const key of variableKeys) {
    const generator = generators[key];
    if (!generator) continue;
    const outcomes = exactGeneratorValues(generator, maximumAssignments);
    if (!outcomes || combinations > Math.floor(maximumAssignments / outcomes.length)) {
      for (const use of complexUses.filter(candidate => candidate.variableKeys.includes(key))) {
        issues.push({
          path: use.path,
          message: `Publication cannot exhaustively prove every outcome of variable "${key}" in a URL, puzzle-semantic, colour, or unique-token field within the ${TEMPLATE_PROOF_LIMIT.toLocaleString('en-US')}-case safety limit. Use a smaller choice generator or move the placeholder to ordinary text/code content.`,
        });
      }
      return null;
    }
    combinations *= outcomes.length;
    values.set(key, outcomes);
  }
  const assignments: Array<Record<string, string | number | boolean>> = [];
  const visit = (index: number, current: Record<string, string | number | boolean>) => {
    if (index === variableKeys.length) { assignments.push({ ...representative, ...current }); return; }
    const key = variableKeys[index];
    for (const value of values.get(key) ?? [representative[key]]) {
      current[key] = value;
      visit(index + 1, current);
    }
  };
  visit(0, {});
  return assignments;
}

function planForFairnessRoute(route: FairnessRouteResult, variables: Record<string, string | number | boolean>): ResolvedRunPlan {
  return {
    routeCheckpointIds: [...route.routeCheckpointIds],
    checkpointIds: [...route.checkpointIds],
    challenges: route.routeCheckpointIds.map((routeCheckpointId, index) => ({
      routeCheckpointId,
      checkpointId: route.checkpointIds[index],
    })),
    variables,
  };
}

function authoredEnginePath(definition: V3Definition, selectedCheckpointIds: readonly string[], path: string) {
  const indexed = /^hunt\.checkpoints\[(\d+)\](.*)$/.exec(path);
  if (indexed) {
    const checkpointId = selectedCheckpointIds[Number(indexed[1])];
    const originalIndex = definition.checkpoints.findIndex(checkpoint => checkpoint.id === checkpointId);
    return originalIndex >= 0 ? `hunt.checkpoints[${originalIndex}]${indexed[2]}` : path;
  }
  const semantic = /^checkpoint:([A-Za-z0-9_-]+)(.*)$/.exec(path);
  if (semantic) {
    const checkpointIndex = definition.checkpoints.findIndex(checkpoint => checkpoint.id === semantic[1]);
    if (checkpointIndex < 0) return path;
    const node = /^\.node:([A-Za-z0-9_-]+)(.*)$/.exec(semantic[2]);
    if (node) {
      const nodeIndex = definition.checkpoints[checkpointIndex].flow.nodes.findIndex(candidate => candidate.id === node[1]);
      if (nodeIndex >= 0) return `hunt.checkpoints[${checkpointIndex}].flow.nodes[${nodeIndex}]${node[2]}`;
    }
    return `hunt.checkpoints[${checkpointIndex}]${semantic[2]}`;
  }
  const hinted = /^hint:([A-Za-z0-9_-]+)(.*)$/.exec(path);
  if (hinted) {
    for (const [checkpointIndex, checkpoint] of definition.checkpoints.entries()) {
      const hintIndex = checkpoint.hints.findIndex(hint => hint.id === hinted[1]);
      if (hintIndex >= 0) return `hunt.checkpoints[${checkpointIndex}].hints[${hintIndex}]${hinted[2]}`;
    }
  }
  const globalNode = /^node:([A-Za-z0-9_-]+)(.*)$/.exec(path);
  if (globalNode) {
    const matches = definition.checkpoints.flatMap((checkpoint, checkpointIndex) =>
      selectedCheckpointIds.includes(checkpoint.id)
        ? checkpoint.flow.nodes.map((node, nodeIndex) => ({ checkpointIndex, nodeIndex, id: node.id }))
        : [])
      .filter(node => node.id === globalNode[1]);
    if (matches.length === 1) {
      return `hunt.checkpoints[${matches[0].checkpointIndex}].flow.nodes[${matches[0].nodeIndex}]${globalNode[2]}`;
    }
  }
  return path;
}

function validateEveryMaterialization(
  definition: V3Definition,
  fairness: FairnessReport,
  issues: ValidationIssue[],
) {
  const representative = resolveVariables('v3-publication-validation-seed', definition.settings.variableGenerators);
  rejectUnsupportedTemplatePlacements(definition, 'hunt', issues);
  const uses = runTemplateUses(definition, representative, issues);
  for (const use of uses) validateSimpleTemplateOutcomes(use, definition.settings.variableGenerators, issues);
  const assignments = enumerateVariableAssignments(
    representative,
    definition.settings.variableGenerators,
    uses.filter(use => use.complex),
    fairness.routes.length,
    issues,
  );
  if (!assignments) return;
  const seen = new Set(issues.map(item => `${item.path}\u0000${item.message}`));
  const add = (path: string, message: string) => {
    const key = `${path}\u0000${message}`;
    if (!seen.has(key)) { seen.add(key); issues.push({ path, message }); }
  };
  for (const variables of assignments) {
    const parallelDefinition: V3Definition = {
      ...definition,
      settings: {
        ...definition.settings,
        parallelMechanics: materializeRunParallelMechanics(definition, { variables }),
      },
    };
    for (const parallelIssue of validateParallelMechanics(parallelDefinition, definition)) {
      add(`hunt.${parallelIssue.path}`, `A possible generated value is invalid: ${parallelIssue.message}`);
    }
    for (const route of fairness.routes) {
      const plan = planForFairnessRoute(route, variables);
      let materialized: HuntDefinition;
      try {
        materialized = materializeRunDefinition(definition, plan);
      } catch (error) {
        add('hunt.settings.variableGenerators', error instanceof Error ? error.message : 'A run definition could not be materialized.');
        continue;
      }
      for (const engineIssue of validateHunt(materialized)) {
        const path = authoredEnginePath(definition, route.checkpointIds, engineIssue.path);
        add(path, `A possible generated value on eligible route "${route.routeKey}" is invalid: ${engineIssue.message}`);
      }
    }
  }
}

const MINIMUM_STATIC_CODE_LENGTH = 8;

function validateVerifierStrength(definition: V3Definition, issues: ValidationIssue[]) {
  const weakGeneratorKeys = new Set<string>();
  for (const [key, generator] of Object.entries(definition.settings.variableGenerators)) {
    if (generator.type !== 'code') continue;
    const entropyBits = generatedCodeEntropyBits(generator);
    if (!Number.isFinite(entropyBits) || entropyBits < MINIMUM_GENERATED_CODE_ENTROPY_BITS) {
      weakGeneratorKeys.add(key);
      issues.push({
        path: `hunt.settings.variableGenerators.${key}`,
        message: `Generated verifier codes need at least ${MINIMUM_GENERATED_CODE_ENTROPY_BITS} bits of comparison-stable outcome space; this generator provides ${Number.isFinite(entropyBits) ? entropyBits.toFixed(1) : '0'} bits. Use unique ASCII letters/digits (counting case-insensitively) and increase the alphabet or length.`,
      });
    }
  }

  const verifyCode = (value: string, path: string, allowServerGeneratedDirective = false) => {
    const references = [...value.matchAll(TEMPLATE_REFERENCE)].map(match => match[1]);
    if (references.length) {
      for (const key of references) {
        const generator = definition.settings.variableGenerators[key];
        if (!generator || generator.type !== 'code') {
          issues.push({ path, message: `Verifier code placeholder "${key}" must use a code generator, not a small literal or choice set.` });
        } else if (weakGeneratorKeys.has(key)) {
          issues.push({ path, message: `Verifier code placeholder "${key}" does not have enough generated outcome entropy.` });
        }
      }
      return;
    }
    if (value.startsWith('@server:generate:')) {
      if (!allowServerGeneratedDirective) {
        issues.push({ path, message: 'Server-generated directives are supported only for QR tokens and QR backup codes. Use a run-scoped code variable here.' });
      }
      return;
    }
    if (Array.from(value.trim()).length < MINIMUM_STATIC_CODE_LENGTH) {
      issues.push({ path, message: `Static verifier codes need at least ${MINIMUM_STATIC_CODE_LENGTH} characters. Prefer a server-generated QR or a run-scoped code variable.` });
    }
  };

  definition.checkpoints.forEach((checkpoint, checkpointIndex) => {
    checkpoint.flow.nodes.forEach((node, nodeIndex) => {
      const path = `hunt.checkpoints[${checkpointIndex}].flow.nodes[${nodeIndex}]`;
      if (node.type === 'verify_code') verifyCode(node.code, `${path}.code`);
      if (node.type === 'verify_qr') {
        if (node.backupCode) verifyCode(node.backupCode, `${path}.backupCode`, true);
        if (!node.token.startsWith('@server:generate:') && Array.from(node.token).length < 16) {
          issues.push({ path: `${path}.token`, message: 'Static QR verifier tokens need at least 16 characters. Prefer a server-generated QR directive.' });
        }
      }
    });
  });
  (definition.settings.parallelMechanics ?? []).forEach((mechanic, mechanicIndex) => {
    mechanic.lanes.forEach((lane, laneIndex) => {
      const path = `hunt.settings.parallelMechanics[${mechanicIndex}].lanes[${laneIndex}]`;
      if (lane.type === 'code') verifyCode(lane.code, `${path}.code`);
      if (lane.type === 'qr' && !lane.token.startsWith('@server:generate:') && Array.from(lane.token).length < 16) {
        issues.push({ path: `${path}.token`, message: 'Static QR verifier tokens need at least 16 characters. Prefer a server-generated QR directive.' });
      }
    });
  });
}

function validatePuzzleSearchStrength(definition: V3Definition, issues: ValidationIssue[]) {
  const inspect = (puzzle: PuzzleDefinition, path: string) => {
    if (puzzle.type === 'jigsaw' && puzzle.pieces.length < 6) {
      issues.push({ path, message: 'Competitive jigsaws need at least 6 pieces so the official move budget cannot enumerate a material share of all layouts.' });
    }
    if (puzzle.type === 'matching' && puzzle.left.length < 5) {
      issues.push({ path, message: 'Competitive matching puzzles need at least 5 pairs so the official move budget covers less than 10% of all pairings.' });
    }
    if (puzzle.type === 'sequence' && puzzle.items.length < 6) {
      issues.push({ path, message: 'Competitive sequence puzzles need at least 6 items so the official move budget covers less than 3% of all orders.' });
    }
    if (puzzle.type === 'rotation') {
      const rotated = puzzle.tiles.filter(tile => tile.correctRotation !== 0).length;
      if (puzzle.tiles.length < 6 || rotated < 5) {
        issues.push({ path, message: 'Competitive rotation puzzles need at least 6 tiles with at least 5 non-zero target rotations so the official move budget cannot sweep the meaningful states.' });
      }
    }
  };
  definition.checkpoints.forEach((checkpoint, checkpointIndex) => {
    checkpoint.flow.nodes.forEach((node, nodeIndex) => {
      if (node.type === 'puzzle') inspect(node.puzzle, `hunt.checkpoints[${checkpointIndex}].flow.nodes[${nodeIndex}].puzzle`);
    });
    checkpoint.hints.forEach((hint, hintIndex) => {
      if (hint.content.type === 'puzzle') inspect(hint.content.puzzle, `hunt.checkpoints[${checkpointIndex}].hints[${hintIndex}].content.puzzle`);
    });
  });
}

export function validateV3Definition(input: unknown, options: { externalAuthoring?: boolean } = {}): { definition?: V3Definition; issues: ValidationIssue[]; fairness?: FairnessReport } {
  const issues: ValidationIssue[] = [];
  const issue = (path: string, message: string) => issues.push({ path, message });
  if (!isObject(input)) return { issues: [{ path: 'hunt', message: 'Hunt JSON must be an object.' }] };
  if (options.externalAuthoring !== false && !schemaValidator(input)) {
    for (const error of schemaValidator.errors ?? []) {
      issue(schemaIssuePath(error), error.message ? `Schema: ${error.message}.` : 'Schema validation failed.');
    }
    return { issues };
  }
  for (const key of Object.keys(input)) if (!topLevelKeys.has(key)) issue(`hunt.${key}`, 'Unsupported V3 field.');
  if (input.schemaVersion !== 3) issue('hunt.schemaVersion', 'V3 definitions must use schemaVersion 3.');
  if (!isObject(input.settings)) issue('hunt.settings', 'V3 settings are required.');
  else {
    for (const key of Object.keys(input.settings)) if (!settingKeys.has(key)) issue(`hunt.settings.${key}`, 'Unsupported V3 setting.');
    if (input.settings.mode !== undefined && input.settings.mode !== 'sequential') {
      issue('hunt.settings.mode', 'V3 route plans execute sequentially. Use "sequential" or omit mode; open and dependency modes are not supported.');
    }
    if (!['self-serve', 'organizer-assigned', 'rostered'].includes(String(input.settings.registrationMode))) issue('hunt.settings.registrationMode', 'Choose self-serve, organizer-assigned, or rostered.');
    const integrityPolicy = input.settings.integrityPolicy;
    if (!isObject(integrityPolicy)) issue('hunt.settings.integrityPolicy', 'Choose the hunt integrity settings.');
    else {
      if (!['gps_only', 'gps_photo', 'gps_organizer', 'strict'].includes(String(integrityPolicy.locationVerification))) {
        issue('hunt.settings.integrityPolicy.locationVerification', 'Choose GPS only, GPS plus photo, GPS plus organizer approval, or strict verification.');
      }
      if (!['automatic', 'organizer'].includes(String(integrityPolicy.selfServeApproval))) {
        issue('hunt.settings.integrityPolicy.selfServeApproval', 'Choose automatic or organizer approval for self-serve teams.');
      }
      if (!['flexible', 'freeze_at_run_start', 'flexible_fixed_scoring'].includes(String(integrityPolicy.rosterParticipation))) {
        issue('hunt.settings.integrityPolicy.rosterParticipation', 'Choose flexible, freeze at run start, or flexible participation with fixed scoring.');
      }
    }
    const runPolicy = input.settings.runPolicy;
    if (!isObject(runPolicy) || !['disabled', 'capped', 'unlimited', 'practice-only'].includes(String(runPolicy.mode))) issue('hunt.settings.runPolicy', 'Choose a supported replay policy.');
    else if (runPolicy.mode === 'capped' && (!Number.isSafeInteger(runPolicy.maxOfficialRuns) || Number(runPolicy.maxOfficialRuns) < 1)) issue('hunt.settings.runPolicy.maxOfficialRuns', 'Capped replay policies need a positive official-run limit.');
    for (const required of ['leaderboardPolicy', 'publicBoard', 'socialShare', 'recognition', 'routePlan', 'challengePools', 'variableGenerators', 'fairnessPolicy']) {
      if (!isObject(input.settings[required])) issue(`hunt.settings.${required}`, `${required} must be an object.`);
    }
    if (isObject(input.settings.recognition)) {
      const data = Number(input.settings.recognition.dataWeight), peer = Number(input.settings.recognition.peerWeight);
      if (![data, peer].every(Number.isFinite) || data < 0 || peer < 0 || Math.abs(data + peer - 1) > 1e-9) issue('hunt.settings.recognition', 'Recognition dataWeight and peerWeight must be non-negative and total 1.');
    }
  }
  if (Array.isArray(input.checkpoints)) input.checkpoints.forEach((checkpoint, checkpointIndex) => {
    if (!isObject(checkpoint)) return;
    if (checkpoint.required === false) {
      issue(`hunt.checkpoints[${checkpointIndex}].required`, 'Every checkpoint selected by a V3 route is required. Remove this field or set it to true.');
    }
    if (Array.isArray(checkpoint.prerequisites) && checkpoint.prerequisites.length) {
      issue(`hunt.checkpoints[${checkpointIndex}].prerequisites`, 'V3 derives checkpoint prerequisites from the private sequential route. Remove authored prerequisites.');
    }
  });

  // The existing engine validator remains authoritative for every checkpoint,
  // action, puzzle, private answer, hint, and graph edge.
  try {
    for (const engineIssue of validateHunt(engineProjection(input))) issues.push({ path: engineIssue.path.replace(/^hunt/, 'hunt'), message: engineIssue.message });
  } catch (error) {
    issue('hunt', error instanceof Error ? error.message : 'The engine-compatible portion is invalid.');
  }
  if (issues.length) return { issues };

  const definition = JSON.parse(JSON.stringify(input)) as V3Definition;
  validateVerifierStrength(definition, issues);
  validatePuzzleSearchStrength(definition, issues);
  let fairness: FairnessReport | undefined;
  try {
    fairness = validateFairness(definition);
    issues.push(...fairness.issues.map(item => ({ path: `hunt.${item.path}`, message: item.message })));
    if (definition.settings.runPolicy.mode === 'capped' &&
      (definition.settings.runPolicy.maxOfficialRuns ?? 1) > fairness.routes.length) {
      issue(
        'hunt.settings.runPolicy.maxOfficialRuns',
        `This hunt has ${fairness.routes.length} validated structural plan${fairness.routes.length === 1 ? '' : 's'}; official attempts cannot exceed that deck because repeats create a rehearsal advantage.`,
      );
    }
  } catch (error) {
    issue('hunt.settings.fairnessPolicy', error instanceof Error ? error.message : 'Fairness validation failed.');
  }
  issues.push(...validateParallelMechanics(definition).map(item => ({ path: `hunt.${item.path}`, message: item.message })));
  try {
    if (fairness) validateEveryMaterialization(definition, fairness, issues);
    else resolveVariables('v3-publication-validation-seed', definition.settings.variableGenerators);
  } catch (error) {
    issue('hunt.settings', error instanceof Error ? error.message : 'Run planning failed.');
  }
  return { definition, issues, fairness };
}

export function assertValidV3Definition(input: unknown, options?: { externalAuthoring?: boolean }) {
  const result = validateV3Definition(input, options);
  if (result.issues.length || !result.definition || !result.fairness?.valid) {
    throw new HttpError(400, `This hunt has ${result.issues.length} V3 configuration issue${result.issues.length === 1 ? '' : 's'}.`, { issues: result.issues });
  }
  return { definition: result.definition, fairness: result.fairness };
}

function draftView(row: Record<string, unknown>) {
  return {
    id: row.id,
    huntId: row.hunt_id,
    title: row.title,
    definition: row.definition,
    source: row.source,
    revision: row.revision,
    generation: row.generation,
    validation: row.validation_report,
    updatedAt: row.updated_at,
  };
}

export async function importV3Draft(input: unknown) {
  if (!isObject(input)) throw new HttpError(400, 'Import a JSON object.');
  const normalizedInput = normalizeV3DraftInput(input) as ObjectValue;
  const validation = validateV3Definition(normalizedInput);
  const id = randomUUID(), generation = randomUUID();
  const title = typeof normalizedInput.title === 'string' && normalizedInput.title.trim() ? normalizedInput.title.trim().slice(0, 160) : 'Imported V3 hunt';
  const result = await transaction(async client => {
    const huntId = typeof normalizedInput.id === 'string' && (await client.query('select 1 from hunt_v3.hunts where id=$1', [normalizedInput.id])).rowCount
      ? normalizedInput.id : null;
    return (await client.query(
      `insert into hunt_v3.drafts(id,hunt_id,title,definition,source,generation,validation_report)
        values($1,$2,$3,$4,'json_import',$5,$6) returning *`,
      [id, huntId, title, normalizedInput, generation, { valid: validation.issues.length === 0, issues: validation.issues, fairness: validation.fairness }],
    )).rows[0];
  });
  return draftView(result);
}

export async function listV3Drafts() {
  const { getPool } = await import('../db');
  const { rows } = await getPool().query('select * from hunt_v3.drafts order by updated_at desc');
  return rows.map(draftView);
}

export async function saveV3Draft(input: unknown, draftId: string, revision: number, generation: string) {
  if (!isV3Uuid(draftId) || !Number.isSafeInteger(revision) || revision < 1 || !isV3Uuid(generation)) throw new HttpError(400, 'Load the current draft before saving.');
  if (!isObject(input)) throw new HttpError(400, 'Draft JSON must be an object.');
  const normalizedInput = normalizeV3DraftInput(input) as ObjectValue;
  const validation = validateV3Definition(normalizedInput);
  const row = (await transaction(async client => client.query(
    `update hunt_v3.drafts set title=$1,definition=$2,validation_report=$3,revision=revision+1,
      previewed_revision=null,previewed_generation=null,previewed_session_hash=null,previewed_at=null
      where id=$4 and revision=$5 and generation=$6 returning *`,
    [typeof normalizedInput.title === 'string' ? normalizedInput.title.slice(0, 160) : 'V3 hunt', normalizedInput,
      { valid: validation.issues.length === 0, issues: validation.issues, fairness: validation.fairness }, draftId, revision, generation],
  ))).rows[0];
  if (!row) throw new HttpError(409, 'This draft changed in another window. Reload before saving.');
  return draftView(row);
}

export async function previewV3Draft(input: { draftId: string; revision: number; generation: string; adminSessionHash: string }) {
  if (!isV3Uuid(input.draftId) || !Number.isSafeInteger(input.revision) || input.revision < 1 ||
    !isV3Uuid(input.generation) || !/^[0-9a-f]{64}$/i.test(input.adminSessionHash)) {
    throw new HttpError(400, 'Load the current draft before previewing.');
  }
  return transaction(async client => {
    const draft = (await client.query(
      'select * from hunt_v3.drafts where id=$1 and revision=$2 and generation=$3 for update',
      [input.draftId, input.revision, input.generation],
    )).rows[0];
    if (!draft) throw new HttpError(409, 'This draft changed. Reload and preview the latest revision.');
    assertValidV3Definition(draft.definition);
    await client.query(
      `update hunt_v3.drafts set previewed_revision=revision,previewed_generation=generation,
        previewed_session_hash=$1,previewed_at=now() where id=$2`,
      [input.adminSessionHash, input.draftId],
    );
    return { previewed: true, revision: input.revision, generation: input.generation };
  });
}

function slug(value: string) {
  const result = value.normalize('NFKD').toLocaleLowerCase('en').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  return result || `hunt-${randomUUID().slice(0, 8)}`;
}

type QrSecretArtifact = { fieldPath: string; groupPath: string; logicalName: string; kind: 'qr_token' | 'backup_code'; value: string };

/** External kits carry logical markers; only the server writes production QR secrets. */
function materializeServerSecrets<T>(value: T): { value: T; artifacts: QrSecretArtifact[] } {
  const artifacts: QrSecretArtifact[] = [];
  const visit = (item: unknown, key = '', path = 'hunt'): unknown => {
    if (typeof item === 'string' && (key === 'token' || key === 'backupCode') && item.startsWith('@server:generate:')) {
      if (!/^@server:generate:[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(item)) throw new HttpError(400, 'Server-generated QR markers must use @server:generate:<safe-name>.');
      const secret = key === 'backupCode'
        ? `V3-${randomBytes(8).toString('base64url').toUpperCase()}`
        : `v3_${randomBytes(32).toString('base64url')}`;
      artifacts.push({
        fieldPath: path,
        groupPath: path.replace(/\.(?:token|backupCode)$/, ''),
        logicalName: item.slice('@server:generate:'.length),
        kind: key === 'backupCode' ? 'backup_code' : 'qr_token',
        value: secret,
      });
      return secret;
    }
    if (Array.isArray(item)) return item.map((child, index) => visit(child, key, `${path}[${index}]`));
    if (isObject(item)) return Object.fromEntries(Object.entries(item).map(([childKey, child]) => [childKey, visit(child, childKey, `${path}.${childKey}`)]));
    return item;
  };
  return { value: visit(value) as T, artifacts };
}

export async function publishV3Draft(input: { draftId: string; revision: number; generation: string; expectedVersion?: number; adminSessionHash: string }) {
  if (!isV3Uuid(input.draftId) || !isV3Uuid(input.generation) || !Number.isSafeInteger(input.revision) || input.revision < 1 ||
    !/^[0-9a-f]{64}$/i.test(input.adminSessionHash) ||
    (input.expectedVersion !== undefined && (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1))) {
    throw new HttpError(400, 'Load, save, and preview a valid current draft before publishing.');
  }
  return transaction(async client => {
    const draft = (await client.query('select * from hunt_v3.drafts where id=$1 for update', [input.draftId])).rows[0];
    if (!draft || draft.revision !== input.revision || draft.generation !== input.generation) throw new HttpError(409, 'Save and load the latest draft before publishing.');
    if (draft.previewed_revision !== draft.revision || draft.previewed_generation !== draft.generation ||
      draft.previewed_session_hash !== input.adminSessionHash || !draft.previewed_at) {
      throw new HttpError(409, 'Preview and acknowledge this exact draft revision before publishing.');
    }
    const source = draft.definition as ObjectValue;
    if (typeof source.id !== 'string') throw new HttpError(400, 'Give this hunt a stable ID before publishing.');
    const existing = (await client.query('select * from hunt_v3.hunts where id=$1 for update', [source.id])).rows[0];
    if (existing && input.expectedVersion !== existing.latest_version) throw new HttpError(409, 'This published hunt changed. Reload its latest version before publishing.');
    if (existing && (await client.query('select 1 from hunt_v3.runs where hunt_id=$1 limit 1', [source.id])).rowCount) {
      throw new HttpError(409, 'This hunt already has run history. Publish scoring or route changes under a new hunt ID so one leaderboard never mixes incompatible versions.');
    }
    const version = existing ? existing.latest_version + 1 : 1;
    const authored = assertValidV3Definition({ ...source, version });
    const materialized = materializeServerSecrets(authored.definition);
    const { definition, fairness } = assertValidV3Definition(materialized.value, { externalAuthoring: false });
    const huntSlug = existing?.slug ?? slug(definition.settings.publicBoard.slug || definition.id);
    const registrationMode = definition.settings.registrationMode.replaceAll('-', '_');
    if (existing && existing.registration_mode !== registrationMode) {
      const hasTeams = Boolean((await client.query('select 1 from hunt_v3.teams where hunt_id=$1 limit 1', [definition.id])).rowCount);
      if (hasTeams) throw new HttpError(409, 'Registration mode cannot change after teams exist. Create a new hunt or perform an explicit roster migration.');
    }
    const existingBoard = existing
      ? (await client.query('select slug from hunt_v3.public_boards where hunt_id=$1', [definition.id])).rows[0]
      : undefined;
    const boardSlug = existingBoard?.slug ?? definition.settings.publicBoard.slug ?? huntSlug;
    definition.settings.publicBoard.slug = boardSlug;
    if (!existing) {
      await client.query(
        `insert into hunt_v3.hunts(id,title,slug,status,registration_mode,registration_open,latest_version,settings)
          values($1,$2,$3,'ready',$4,$5,$6,$7)`,
        [definition.id, definition.title, huntSlug, registrationMode, definition.settings.registrationOpen !== false, version, definition.settings],
      );
    } else {
      await client.query(
        `update hunt_v3.hunts set title=$1,registration_mode=$2,registration_open=$3,latest_version=$4,settings=$5,
          lifecycle_revision=lifecycle_revision+1 where id=$6`,
        [definition.title, registrationMode, definition.settings.registrationOpen !== false, version, definition.settings, definition.id],
      );
    }
    const contentHash = digest(canonicalJson(definition));
    await client.query(
      `insert into hunt_v3.hunt_versions(hunt_id,version,definition,content_hash,validation_report,fairness_report)
        values($1,$2,$3,$4,$5,$6)`,
      [definition.id, version, definition, contentHash, { valid: true, issues: [] }, fairness],
    );
    for (const artifact of materialized.artifacts) await client.query(
      `insert into hunt_v3.hunt_version_qr_secrets(
        hunt_id,hunt_version,field_path,group_path,logical_name,secret_kind,secret_value)
        values($1,$2,$3,$4,$5,$6,$7)`,
      [definition.id, version, artifact.fieldPath, artifact.groupPath, artifact.logicalName, artifact.kind, artifact.value],
    );
    const board = definition.settings.publicBoard;
    const storedBoard = (await client.query(
      `insert into hunt_v3.public_boards(
        hunt_id,slug,enabled,title,cover_ref,event_status,visible_columns,main_board_visible,replay_board_visible,team_name_mode)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        on conflict(hunt_id) do update set enabled=excluded.enabled,title=excluded.title,cover_ref=excluded.cover_ref,
          visible_columns=excluded.visible_columns,main_board_visible=excluded.main_board_visible,
          replay_board_visible=excluded.replay_board_visible,team_name_mode=excluded.team_name_mode,
          event_status='live',current_snapshot_id=null,frozen_at=null
        returning slug`,
      [definition.id, boardSlug, board.enabled, board.title || definition.title, board.coverUrl ?? null,
        'live', board.columns, definition.settings.leaderboardPolicy.mainBoardEnabled,
        definition.settings.leaderboardPolicy.replayBoardPublic, board.teamIdentity === 'code_only' ? 'code_only' : 'display_name'],
    )).rows[0];
    const draftDefinition = JSON.parse(JSON.stringify({ ...source, version })) as ObjectValue;
    if (isObject(draftDefinition.settings) && isObject(draftDefinition.settings.publicBoard)) {
      draftDefinition.settings.publicBoard.slug = storedBoard.slug;
    }
    await client.query(
      `update hunt_v3.drafts set hunt_id=$1,definition=$2,validation_report=$3,revision=revision+1,
        previewed_revision=null,previewed_generation=null,previewed_session_hash=null,previewed_at=null where id=$4`,
      [definition.id, draftDefinition, { valid: true, issues: [], fairness: authored.fairness }, draft.id],
    );
    await client.query(
      `insert into hunt_v3.admin_events(action,hunt_id,details) values('hunt_published',$1,$2)`,
      [definition.id, { version, contentHash, draftId: draft.id }],
    );
    return { definition: draftDefinition, fairness, status: existing?.status ?? 'ready', publicBoardUrl: board.enabled ? `/board/${storedBoard.slug}` : null };
  });
}

export async function organizerQrPack(input: { huntId: string; version?: number; actor: string }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(input.huntId) ||
    (input.version !== undefined && (!Number.isSafeInteger(input.version) || input.version < 1))) {
    throw new HttpError(400, 'Choose a valid published hunt version.');
  }
  return transaction(async client => {
    const hunt = (await client.query(
      `select id,title,slug,latest_version from hunt_v3.hunts where id=$1`,
      [input.huntId],
    )).rows[0];
    if (!hunt) throw new HttpError(404, 'Published hunt not found.');
    const version = input.version ?? Number(hunt.latest_version);
    const published = (await client.query(
      'select published_at from hunt_v3.hunt_versions where hunt_id=$1 and version=$2',
      [input.huntId, version],
    )).rows[0];
    if (!published) throw new HttpError(404, 'Published hunt version not found.');
    const { rows } = await client.query(
      `select field_path,group_path,logical_name,secret_kind,secret_value
        from hunt_v3.hunt_version_qr_secrets where hunt_id=$1 and hunt_version=$2
        order by group_path,secret_kind desc,field_path`,
      [input.huntId, version],
    );
    await client.query(
      `insert into hunt_v3.admin_events(action,actor,hunt_id,details)
        values('qr_pack_opened',$1,$2,$3)`,
      [input.actor, input.huntId, { version, itemCount: rows.length }],
    );
    return {
      hunt: { id: hunt.id, title: hunt.title, slug: hunt.slug, version, publishedAt: published.published_at },
      // Registration resolves this value as the immutable hunt ID. Do not use
      // the mutable/public slug here: a stale or colliding slug must never send
      // a player into a different open event.
      joinPath: `/v3?hunt=${encodeURIComponent(hunt.id)}`,
      items: rows.map(row => ({
        fieldPath: row.field_path,
        groupPath: row.group_path,
        logicalName: row.logical_name,
        kind: row.secret_kind,
        value: row.secret_value,
      })),
      warning: 'This pack contains private production QR values for one immutable version. Reprint it after every republish and do not share the raw file publicly.',
    };
  });
}
