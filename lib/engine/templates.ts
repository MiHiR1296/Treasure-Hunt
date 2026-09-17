import { randomUUID } from 'node:crypto'
import type { HuntDefinition } from './types'
import { exampleHunt } from './example'

export interface HuntTemplate { id: string; title: string; description: string; definition: HuntDefinition }

/** Server-only starter content; never import these private configurations into player bundles. */
export const huntTemplates: HuntTemplate[] = [
  {
    id: 'simple-qr', title: 'Simple QR hunt', description: 'A quick three-stop trail with printable QR codes, backup codes, hints and a finish.',
    definition: {
      schemaVersion: 1, id: 'template-simple-qr', version: 1, title: 'Our QR Adventure',
      description: 'Find three hidden markers together. Each marker has a backup code if the camera fails.',
      settings: { mode: 'sequential', leaderboard: 'live', ranking: 'points', map: 'none', completionMessage: 'You found every marker. Congratulations, explorers!' },
      checkpoints: [1, 2, 3].map(number => ({
        id: `marker-${number}`, title: `Marker ${number}`, basePoints: 20,
        flow: { startNodeId: 'clue', nodes: [
          { id: 'clue', type: 'show_text', text: `Replace this text with the clue for marker ${number}.`, next: 'scan' },
          { id: 'scan', type: 'verify_qr', prompt: 'Scan the marker or enter the printed recovery code.', token: `template-marker-${number}-${randomUUID()}`, backupCode: randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase(), next: 'done', fallback: { nodeId: 'help', label: 'Organizer verification', enabled: false } },
          { id: 'help', type: 'verify_organizer', prompt: 'Request organizer help to verify the missing marker.', next: 'done' },
          { id: 'done', type: 'complete' },
        ] },
        hints: [{ id: `marker-${number}-hint`, title: 'A little help', cost: 2, content: { type: 'text', text: 'Replace this with a helpful detail about the marker location.' } }],
      })),
    },
  },
  {
    id: 'puzzle-trail', title: 'Puzzle trail', description: 'Jigsaw, word search and a final answer, with a puzzle hint. Suitable for a room or a remote workshop.',
    definition: {
      schemaVersion: 1, id: 'template-puzzle-trail', version: 1, title: 'The Puzzle Room',
      description: 'Combine a picture, hidden words and a final answer. All puzzle progress is shared with your team.',
      settings: { mode: 'sequential', leaderboard: 'finish', ranking: 'points_time', map: 'none', completionMessage: 'You solved the room together!' },
      checkpoints: [
        { ...structuredClone(exampleHunt.checkpoints[3]), title: 'Picture and words', flow: { startNodeId: 'jigsaw', nodes: exampleHunt.checkpoints[3].flow.nodes.filter(node => !['fragment', 'remember'].includes(node.id)).map(node => node.type === 'verify_answer' ? { ...node, next: 'done' } : structuredClone(node)) } },
        { id: 'final-answer', title: 'One last question', basePoints: 20, flow: { startNodeId: 'puzzle', nodes: [
          { id: 'puzzle', type: 'puzzle', prompt: 'What did the picture and hidden words have in common?', puzzle: { type: 'text', prompt: 'The object you discovered', answers: ['gate', 'a gate', 'the gate'] }, next: 'done' },
          { id: 'done', type: 'complete' },
        ] }, hints: [{ id: 'final-answer-hint', title: 'Solve for a clue', cost: 3, content: { type: 'puzzle', puzzle: { type: 'text', prompt: 'How many sides does a square have?', answers: ['4', 'four'] }, reveal: { type: 'text', text: 'The answer is an entrance with two pillars and an arch.' } } }] },
      ],
    },
  },
  {
    id: 'landmark', title: 'Landmark exploration', description: 'Open-world locations followed by a hub finale. Includes maps, camera guidance, photo review and QR alternatives.',
    definition: {
      schemaVersion: 1, id: 'template-landmark', version: 1, title: 'Explore Our Neighborhood',
      description: 'Visit the two starting locations in either order, then bring your discoveries back to the final hub.',
      settings: { mode: 'dependency', leaderboard: 'hidden', ranking: 'progress', map: 'visited', photoRetention: 'after_verification', completionMessage: 'Your team discovered both landmarks. Thanks for exploring!' },
      theme: { primaryColor: '#065f46', font: 'serif', feedback: true },
      checkpoints: [
        { ...structuredClone(exampleHunt.checkpoints[2]), title: 'Find the gate', group: 'Explore', prerequisites: [] },
        { ...structuredClone(exampleHunt.checkpoints[4]), title: 'Find the trail marker', group: 'Explore', prerequisites: [] },
        { id: 'hub', title: 'Return to the hub', group: 'Finish', prerequisites: ['landmark', 'alternate'], basePoints: 20, flow: { startNodeId: 'question', nodes: [
          { id: 'question', type: 'verify_answer', prompt: 'Which landmark has two pillars joined by an arch?', answers: ['gate', 'a gate', 'the gate'], next: 'done' },
          { id: 'done', type: 'complete' },
        ] }, hints: [] },
      ],
    },
  },
]

/** Duplicate starter configuration without carrying teams, receipts or reusable QR secrets. */
export function instantiateTemplate(templateId: string, huntId = `hunt-${randomUUID()}`): HuntDefinition {
  const template = huntTemplates.find(item => item.id === templateId)
  if (!template) throw new Error('Unknown hunt template.')
  const definition = structuredClone(template.definition)
  definition.id = huntId; definition.version = 1
  for (const checkpoint of definition.checkpoints) for (const node of checkpoint.flow.nodes) if (node.type === 'verify_qr') {
    node.token = randomUUID()
    if (node.backupCode !== undefined) node.backupCode = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()
  }
  return definition
}
