import type { FlowNode, HintContent, HuntDefinition, HuntTheme, PuzzleDefinition } from '../engine/types';
import { validateHunt } from '../engine';
import { validatePuzzle } from '../engine/puzzles';
import { HttpError } from './security';

type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];
const object = (value: unknown): Row | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : undefined;
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const number = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const settingSources = (hunt: Row): Row[] => [hunt.settings, hunt.config, hunt.options, hunt]
  .map(object)
  .filter((value): value is Row => Boolean(value));

function settingValue(sources: Row[], keys: string[]) {
  for (const source of sources) for (const key of keys) if (source[key] !== undefined) return source[key];
  return undefined;
}

function importedSettings(hunt: Row, warnings: string[]): HuntDefinition['settings'] {
  const sources = settingSources(hunt);
  const settings: HuntDefinition['settings'] = { mode: 'sequential', leaderboard: 'live', registrationOpen: true };
  const choice = <T extends string>(name: string, keys: string[], allowed: readonly T[]) => {
    const value = settingValue(sources, keys);
    if (value === undefined) return;
    if (typeof value === 'string' && allowed.includes(value as T)) (settings as Record<string, unknown>)[name] = value;
    else warnings.push(`Legacy ${name} setting was not imported because it is not supported: ${String(value)}.`);
  };
  const boundedNumber = (name: string, keys: string[], minimum: number, maximum: number) => {
    const value = settingValue(sources, keys);
    if (value === undefined) return;
    const parsed = finite(value);
    if (parsed === undefined || parsed < minimum || parsed > maximum || !Number.isInteger(parsed)) {
      warnings.push(`Legacy ${name} setting was not imported because it must be an integer from ${minimum} to ${maximum}.`);
      return;
    }
    (settings as Record<string, unknown>)[name] = parsed;
  };
  const optionalText = (name: string, keys: string[]) => {
    const value = settingValue(sources, keys);
    if (value !== undefined) {
      if (typeof value === 'string') (settings as Record<string, unknown>)[name] = value;
      else warnings.push(`Legacy ${name} setting was not imported because it is not text.`);
    }
  };
  const optionalBoolean = (name: string, keys: string[]) => {
    const value = settingValue(sources, keys);
    if (value !== undefined) {
      if (typeof value === 'boolean') (settings as Record<string, unknown>)[name] = value;
      else warnings.push(`Legacy ${name} setting was not imported because it must be true or false.`);
    }
  };

  // V1 exports used several spellings over time. Preserve valid values instead
  // of silently replacing them with the importer defaults.
  boundedNumber('minTeamSize', ['minTeamSize', 'min_team_size', 'minimumTeamSize', 'minimum_team_size', 'min_players', 'minimum_players'], 1, 1000);
  boundedNumber('maxTeamSize', ['maxTeamSize', 'max_team_size', 'maximumTeamSize', 'maximum_team_size', 'max_players', 'maximum_players'], 1, 1000);
  boundedNumber('sessionDurationSeconds', ['sessionDurationSeconds', 'session_duration_seconds', 'durationSeconds', 'duration_seconds'], 1, 31536000);
  boundedNumber('assignmentVersion', ['assignmentVersion', 'assignment_version'], 2, 2);
  choice('mode', ['mode'], ['sequential', 'open', 'dependency']);
  choice('leaderboard', ['leaderboard'], ['live', 'hidden', 'finish']);
  choice('ranking', ['ranking'], ['points', 'progress', 'points_time']);
  choice('map', ['map'], ['none', 'all', 'visited']);
  choice('photoRetention', ['photoRetention', 'photo_retention'], ['after_verification', 'after_event', 'retain']);
  optionalText('rules', ['rules']);
  optionalText('startsAt', ['startsAt', 'starts_at']);
  optionalText('endsAt', ['endsAt', 'ends_at']);
  optionalText('completionMessage', ['completionMessage', 'completion_message']);
  optionalBoolean('registrationOpen', ['registrationOpen', 'registration_open']);
  return settings;
}

function importedTheme(hunt: Row): HuntTheme | undefined {
  const config = object(hunt.config);
  const source = object(hunt.theme) ?? object(object(hunt.settings)?.theme) ?? object(config?.theme);
  if (!source) return undefined;
  const theme: HuntTheme = {};
  const values: Array<[keyof HuntTheme, string[]]> = [
    ['primaryColor', ['primaryColor', 'primary_color']], ['logoUrl', ['logoUrl', 'logo_url']],
    ['coverUrl', ['coverUrl', 'cover_url']], ['backgroundUrl', ['backgroundUrl', 'background_url']],
    ['font', ['font']], ['feedback', ['feedback']], ['buttonShape', ['buttonShape', 'button_shape']],
    ['checkpointIconStyle', ['checkpointIconStyle', 'checkpoint_icon_style']], ['successAnimation', ['successAnimation', 'success_animation']],
  ];
  for (const [key, keys] of values) {
    const value = keys.map(candidate => source[candidate]).find(candidate => candidate !== undefined);
    if (value !== undefined) (theme as Record<string, unknown>)[key] = value;
  }
  return Object.keys(theme).length ? theme : undefined;
}

/** Content conversion only: legacy client-authoritative progress is not trusted. */
export function importLegacy(source: unknown, huntId?: string) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new HttpError(400, 'Choose a JSON export containing hunts and checkpoints arrays.');
  const exportData = source as Row;
  const hunts = rows(exportData.hunts);
  const hunt = huntId ? hunts.find(item => item.id === huntId) : hunts.length === 1 ? hunts[0] : undefined;
  if (!hunt) throw new HttpError(400, 'Choose one hunt ID when the export contains more than one hunt.');
  const warnings = ['This imports content into a new draft. Existing teams, sessions, scores and progress are preserved in the original export and are not imported.'];
  if (rows(exportData.progress).some(item => number(item.hints_used, 0) > 0)) warnings.push('Legacy hints_used counts do not identify which hints were bought. No hint identities or charges have been invented; reconcile old results separately.');
  const id = text(hunt.id);
  const steps = rows(exportData.puzzle_steps);
  const puzzleHints = rows(exportData.puzzle_hints);
  function puzzle(row: Row): PuzzleDefinition {
    const config = row.puzzle_config && typeof row.puzzle_config === 'object' ? row.puzzle_config as Row : {};
    const type = text(row.puzzle_type);
    let value: unknown = { ...config, type };
    if (type === 'sudoku') {
      const givens = config.givens ?? config.grid;
      value = { type, size: Array.isArray(givens) ? givens.length : 9, givens };
    }
    if (type === 'text') value = { type, prompt: text(row.description, text(row.title, 'Solve the clue')), answers: [text(row.answer_value)] };
    if (type === 'circular_rotate') value = { ...config, type: 'rotation' };
    if (validatePuzzle(value).length) warnings.push(`Rebuild ${text(row.title, text(row.id, 'legacy puzzle'))}: its ${type} configuration lacks the structured data required for reliable server validation. The draft cannot publish until it is fixed.`);
    return value as PuzzleDefinition;
  }
  const checkpointRows = rows(exportData.checkpoints).filter(cp => cp.hunt_id === hunt.id).sort((a,b) => number(a.order_index,0)-number(b.order_index,0));
  const theme = importedTheme(hunt);
  const definition: HuntDefinition = {
    schemaVersion: 1, id: `import-${id}`, version: 1, title: text(hunt.name, 'Imported hunt'), ...(hunt.description ? { description: text(hunt.description) } : {}),
    settings: importedSettings(hunt, warnings),
    ...(theme ? { theme } : {}),
    dudQrs: checkpointRows.filter(cp => cp.is_dud_qr === true).map(cp => ({ token: text(cp.qr_code_value), message: text(cp.dud_message, 'Keep looking!') })),
    checkpoints: checkpointRows.filter(cp => cp.is_dud_qr !== true).map(cp => {
      const cpId = text(cp.id);
      const nodes: FlowNode[] = [];
      const add = (node: FlowNode) => {
        const previous = nodes.at(-1);
        if (previous && 'next' in previous) previous.next = node.id;
        nodes.push(node);
      };
      if (cp.clue_text || cp.description) add({ id: 'clue', type: 'show_text', text: text(cp.clue_text, text(cp.description)), next: 'done' });
      const prompt = text(cp.title, 'Find this checkpoint');
      if (cp.unlock_method === 'qr_code') add({ id: 'verify', type: 'verify_qr', prompt, token: text(cp.qr_code_value), ...(cp.manual_code ? { backupCode: text(cp.manual_code) } : {}), next: 'done' });
      else if (cp.unlock_method === 'gps') add({ id: 'verify', type: 'verify_gps', prompt, latitude: number(cp.lat, NaN), longitude: number(cp.lng, NaN), radiusMeters: number(cp.radius_m,50), maxAccuracyMeters: 100, next: 'done' });
      else if (cp.unlock_method === 'manual_code') add({ id: 'verify', type: 'verify_code', prompt, code: text(cp.manual_code), next: 'done' });
      else { warnings.push(`${prompt}: choose a verification method before publication.`); add({ id: 'verify', type: 'verify_code', prompt, code: '', next: 'done' }); }
      if (cp.use_puzzle_chain) for (const step of steps.filter(item => item.checkpoint_id === cp.id).sort((a,b) => number(a.step_order,0)-number(b.step_order,0))) {
        const stepId = `puzzle-${text(step.id)}`;
        add({ id: stepId, type: 'puzzle', prompt: text(step.description, text(step.title, 'Solve the puzzle')), puzzle: puzzle(step), next: 'done' });
        if (step.answer_type === 'qr_code') add({ id: `${stepId}-qr`, type: 'verify_qr', prompt: 'Find and scan the code revealed by the puzzle.', token: text(step.answer_value), next: 'done' });
        else if (step.puzzle_type !== 'text' && step.answer_value) add({ id: `${stepId}-answer`, type: 'verify_answer', prompt: 'What answer did you uncover?', answers: [text(step.answer_value)], next: 'done' });
      }
      add({ id: 'done', type: 'complete' });
      const hints = [1,2,3].flatMap(slot => {
        const replacement = puzzleHints.find(item => item.checkpoint_id === cp.id && item.hint_slot === slot);
        const content = text(cp[`hint_${slot}`], slot === 1 ? text(cp.hint_text) : '');
        if (!replacement && !content) return [];
        const hintContent: HintContent = replacement ? { type: 'puzzle', puzzle: puzzle(replacement), reveal: { type: 'text', text: text(replacement.completion_message, content || 'Hint puzzle solved.') } } : { type: 'text', text: content };
        return [{ id: `${cpId}-hint-${slot}`, title: text(replacement?.title, `Hint ${slot}`), cost: number(replacement?.points_cost,number(cp.hint_cost,5)), content: hintContent }];
      });
      return { id: cpId, title: prompt, basePoints: number(cp.points,20), flow: { startNodeId: nodes[0].id, nodes }, hints };
    }),
  };
  return { definition, issues: validateHunt(definition), warnings };
}
