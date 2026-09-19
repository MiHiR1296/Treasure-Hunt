import type { Feedback, GameCommand, PlayerView } from '@/lib/engine/types';
import type { ActionNotice } from './ActionFeedback';
import type { FeedbackCue } from './FeedbackToast';

/** Describe confirmed changes only. Saving a puzzle cell is not solving a puzzle. */
export function describeActionFeedback(id: string, command: GameCommand, before: PlayerView, next: PlayerView, feedback: Feedback): { notice: ActionNotice; cue: FeedbackCue | null; celebrate: boolean } {
  const changed = next.revision > before.revision;
  const advanced = next.node?.id !== before.node?.id || next.checkpoint?.id !== before.checkpoint?.id || next.status !== before.status;
  const hintId = 'hintId' in command ? command.hintId : undefined;
  const oldHint = before.hints.find(hint => hint.id === hintId)?.content;
  const newHint = next.hints.find(hint => hint.id === hintId)?.content;
  const hintSolved = command.type === 'submit_hint_puzzle' && newHint?.type === 'puzzle' && newHint.progress.completed;
  const puzzle = command.type === 'submit_hint_puzzle' ? oldHint?.type === 'puzzle' ? oldHint.puzzle : undefined : before.node?.type === 'puzzle' ? before.node.puzzle : undefined;
  const puzzleSubmission = command.type === 'submit_puzzle' || command.type === 'submit_hint_puzzle';
  const unfinishedAnswer = changed && feedback.status === 'accepted' && puzzleSubmission && !advanced && !hintSolved && (puzzle?.type === 'text' || puzzle?.type === 'multiple_choice');
  const kind = feedback.status === 'rejected' || unfinishedAnswer ? 'error' : feedback.status === 'accepted' ? 'success' : 'info';
  const message = unfinishedAnswer ? 'Not quite. Try another answer.' : feedback.message;
  const notice: ActionNotice = { id: `action-feedback-${id}`, kind, message };
  const points = changed ? next.score - before.score : 0;
  const celebrate = kind === 'success' && changed && (advanced || hintSolved || points > 0);

  // Grid moves and partial arrangements retain nearby confirmation without
  // interrupting every keystroke with a banner, sound or celebration.
  if (puzzleSubmission && kind === 'success' && !celebrate) return { notice: { ...notice, kind: 'info' }, cue: null, celebrate: false };

  const completedCheckpoint = next.progress.completed > before.progress.completed;
  const title = kind === 'error' ? command.type === 'verify_gps' ? 'Check your location' : 'Try again'
    : celebrate ? next.status === 'completed' ? 'Adventure complete!' : completedCheckpoint ? 'Checkpoint complete!' : hintSolved ? 'Hint puzzle solved!' : 'Next clue unlocked!'
    : feedback.status === 'dud' ? 'Keep exploring'
    : command.type === 'use_hint' ? 'Clue revealed'
    : command.type === 'submit_photo' ? 'Photo sent for review' : 'Progress updated';
  const cueMessage = advanced ? next.status === 'completed' ? `Your team finished with ${next.score} points.` : message : undefined;
  return { notice, celebrate, cue: { id, kind: celebrate ? 'success' : kind === 'error' ? 'error' : 'info', title, ...(cueMessage ? { message: cueMessage } : {}), ...(points ? { points } : {}) } };
}
