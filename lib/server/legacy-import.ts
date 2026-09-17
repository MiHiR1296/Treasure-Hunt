import type { FlowNode, HintContent, HuntDefinition, PuzzleDefinition } from '../engine/types';
import { validateHunt } from '../engine';
import { validatePuzzle } from '../engine/puzzles';
import { HttpError } from './security';

type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const number = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

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
  const definition: HuntDefinition = {
    schemaVersion: 1, id: `import-${id}`, version: 1, title: text(hunt.name, 'Imported hunt'), ...(hunt.description ? { description: text(hunt.description) } : {}),
    settings: { mode: 'sequential', leaderboard: 'live', registrationOpen: true },
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
