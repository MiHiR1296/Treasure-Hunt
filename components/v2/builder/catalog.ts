import type { FlowNode } from '@/lib/engine/types';
import { defaultPuzzle } from './puzzleDefaults';

export type NodeCategory = 'content' | 'verification' | 'gameplay' | 'logic';

export interface NodeDescriptor {
  label: string;
  shortLabel: string;
  description: string;
  category: NodeCategory;
  advanced?: boolean;
  create: (id: string, next: string) => FlowNode;
}

/**
 * The builder's canonical node catalogue. Palette entries, labels and safe
 * defaults all come from this registry so newly supported engine nodes cannot
 * silently disappear from one part of the authoring UI.
 */
export const nodeCatalog: Record<FlowNode['type'], NodeDescriptor> = {
  show_text: {
    label: 'Clue or text', shortLabel: 'Clue', category: 'content',
    description: 'Show instructions or story text.',
    create: (id, next) => ({ id, type: 'show_text', text: '', next }),
  },
  show_media: {
    label: 'Image, audio, or video', shortLabel: 'Media', category: 'content',
    description: 'Show a visual, audio clip, video, map, or camera guide.',
    create: (id, next) => ({ id, type: 'show_media', content: { type: 'image', url: '', alt: '' }, next }),
  },
  verify_answer: {
    label: 'Answer a question', shortLabel: 'Question', category: 'verification',
    description: 'Accept one or more private answers.',
    create: (id, next) => ({ id, type: 'verify_answer', prompt: '', answers: [''], next }),
  },
  verify_code: {
    label: 'Enter a code', shortLabel: 'Code', category: 'verification',
    description: 'Require a private written code.',
    create: (id, next) => ({ id, type: 'verify_code', prompt: 'Enter the code you found.', code: '', next }),
  },
  verify_qr: {
    label: 'Scan a QR', shortLabel: 'QR', category: 'verification',
    description: 'Verify a private QR token or backup code.',
    create: (id, next) => ({ id, type: 'verify_qr', prompt: 'Find and scan the checkpoint QR.', token: '', next }),
  },
  verify_gps: {
    label: 'Reach a GPS region', shortLabel: 'Location', category: 'verification',
    description: 'Check that the team reached an approximate area.',
    create: (id, next) => ({ id, type: 'verify_gps', prompt: 'Check your location when you have arrived.', latitude: 0, longitude: 0, radiusMeters: 75, maxAccuracyMeters: 100, next }),
  },
  puzzle: {
    label: 'Solve a puzzle', shortLabel: 'Puzzle', category: 'gameplay',
    description: 'Add one of the supported interactive puzzles.',
    create: (id, next) => ({ id, type: 'puzzle', prompt: 'Solve the puzzle to continue.', puzzle: defaultPuzzle('text'), next }),
  },
  verify_image: {
    label: 'Photograph review', shortLabel: 'Photo', category: 'verification',
    description: 'Collect a photo for organizer review.',
    create: (id, next) => ({ id, type: 'verify_image', prompt: 'Photograph the landmark for organizer review.', referenceImages: [], next }),
  },
  camera_guide: {
    label: 'Camera guidance', shortLabel: 'Camera guide', category: 'content', advanced: true,
    description: 'Help players compare a live scene with a reference.',
    create: (id, next) => ({ id, type: 'camera_guide', prompt: 'Match the reference with the landmark in front of you.', next }),
  },
  verify_organizer: {
    label: 'Organizer approval', shortLabel: 'Approval', category: 'verification', advanced: true,
    description: 'Pause until an organizer approves the team.',
    create: (id, next) => ({ id, type: 'verify_organizer', prompt: 'Show the organizer what you found. They will approve this step.', next }),
  },
  choose_path: {
    label: 'Choose a path', shortLabel: 'Player choice', category: 'gameplay', advanced: true,
    description: 'Let the player choose between named routes.',
    create: (id, next) => ({ id, type: 'choose_path', prompt: 'How would you like to continue?', choices: [{ id: 'primary', label: 'Main route', next }, { id: 'alternative', label: 'Alternative route', next }] }),
  },
  branch: {
    label: 'Conditional route', shortLabel: 'Condition', category: 'logic', advanced: true,
    description: 'Choose a route from a variable, checkpoint, hint, or time.',
    create: (id, next) => ({ id, type: 'branch', condition: { type: 'variable', key: 'discovery', equals: true }, ifTrue: next, ifFalse: next }),
  },
  random_branch: {
    label: 'Random route', shortLabel: 'Random', category: 'logic', advanced: true,
    description: 'Choose deterministically from weighted routes.',
    create: (id, next) => ({ id, type: 'random_branch', choices: [{ next, weight: 1 }, { next, weight: 1 }] }),
  },
  set_variable: {
    label: 'Remember a value', shortLabel: 'Set value', category: 'logic', advanced: true,
    description: 'Store a typed value for a later condition.',
    create: (id, next) => ({ id, type: 'set_variable', key: 'discovery', value: true, next }),
  },
  add_points: {
    label: 'Award or deduct points', shortLabel: 'Points', category: 'gameplay', advanced: true,
    description: 'Record a one-time score adjustment on this route.',
    create: (id, next) => ({ id, type: 'add_points', amount: 5, label: 'Bonus', next }),
  },
  complete: {
    label: 'Finish checkpoint', shortLabel: 'Finish', category: 'gameplay',
    description: 'Complete the checkpoint and award its base points.',
    create: id => ({ id, type: 'complete' }),
  },
};

const unsupportedNodeDescriptor: Omit<NodeDescriptor, 'create' | 'category'> = {
  label: 'Unsupported step',
  shortLabel: 'Unsupported',
  description: 'This step type is not supported by the visual builder.',
};

export function isSupportedNodeType(type: unknown): type is FlowNode['type'] {
  return typeof type === 'string' && Object.hasOwn(nodeCatalog, type);
}

export function nodeDescriptor(type: unknown): Pick<NodeDescriptor, 'label' | 'shortLabel' | 'description'> {
  return isSupportedNodeType(type) ? nodeCatalog[type] : unsupportedNodeDescriptor;
}

export const nodeLabels: Record<FlowNode['type'], string> = Object.fromEntries(
  Object.entries(nodeCatalog).map(([type, descriptor]) => [type, descriptor.label]),
) as Record<FlowNode['type'], string>;

export function createNode(type: FlowNode['type'], id: string, next = ''): FlowNode {
  return nodeCatalog[type].create(id, next);
}
