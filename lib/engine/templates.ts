import { randomUUID } from 'node:crypto'
import type { HuntDefinition } from './types'
import { exampleHunt } from './example'

export interface HuntTemplate { id: string; title: string; description: string; definition: HuntDefinition }

/** Server-only starter content; never import these private configurations into player bundles. */
export const huntTemplates: HuntTemplate[] = [
  {
    id: 'frankie-code-hunt', title: 'Frankie code hunt', description: 'A five-round, 10-minute shop game built around tiny riddles, codes and a word search. Includes clear player instructions, shared hints and a live leaderboard.',
    definition: {
      schemaVersion: 1, id: 'template-frankie-code-hunt', version: 1, title: 'Crack the Frankie Code',
      description: '🌯 5 quick rounds. Work as a team, solve each clue, and type the answer.\n\n👀 Look for the card called “YOUR TASK”.\n💡 Stuck? Use a hint — it costs points, so save them for when you need them.\n🏁 The fastest high-score team wins the Frankie reward.',
      settings: {
        mode: 'sequential', leaderboard: 'live', ranking: 'points_time', map: 'none',
        rules: 'Each round has one task. Read the card, solve it together, then enter the answer. Hints are shared by your team and reduce your score. Please do not spoil answers for another team.',
        completionMessage: '🌯 Frankie Code cracked! Show this finish screen to the counter to claim your reward.',
      },
      theme: { primaryColor: '#b45309', feedback: true, buttonShape: 'pill', checkpointIconStyle: 'symbols', successAnimation: 'celebrate' },
      checkpoints: [
        {
          id: 'shared-wrap', title: 'Round 1 · The shared wrap', basePoints: 20, timeBonus: { withinSeconds: 45, points: 5 },
          flow: { startNodeId: 'brief', nodes: [
            { id: 'brief', type: 'show_text', text: 'YOUR TASK ①\n\nBoth veg and non-veg frankies need this outer wrap. It is baked, soft, and you can use it to make a sandwich too.\n\nType one word.', next: 'answer' },
            { id: 'answer', type: 'verify_answer', prompt: '🔐 Enter the ingredient', answers: ['bread', 'roti', 'wrap'], next: 'done' },
            { id: 'done', type: 'complete' },
          ] },
          hints: [{ id: 'shared-wrap-hint', title: 'Think outside', cost: 2, content: { type: 'text', text: 'It is the edible layer around the filling.' } }],
        },
        {
          id: 'cold-case', title: 'Round 2 · Cold case', basePoints: 20, timeBonus: { withinSeconds: 60, points: 5 },
          flow: { startNodeId: 'brief', nodes: [
            { id: 'brief', type: 'show_text', text: 'YOUR TASK ②\n\nFind the tall object in this shop.\n\n🧊 It is cold.\n🚪 It has a door.\n🥤 It keeps drinks and ingredients fresh.\n\nType its name — no photo needed.', next: 'answer' },
            { id: 'answer', type: 'verify_answer', prompt: '🔐 What is it?', answers: ['fridge', 'refrigerator'], next: 'done' },
            { id: 'done', type: 'complete' },
          ] },
          hints: [{ id: 'cold-case-hint', title: 'Look around', cost: 3, content: { type: 'text', text: 'It is the largest cold appliance behind or near the counter.' } }],
        },
        {
          id: 'spice-code', title: 'Round 3 · Number spice', basePoints: 20, timeBonus: { withinSeconds: 75, points: 5 },
          flow: { startNodeId: 'brief', nodes: [
            { id: 'brief', type: 'show_text', text: 'YOUR TASK ③\n\nUse A=1, B=2, C=3 … Z=26.\n\n19 – 1 – 21 – 3 – 5\n\nDecode the tangy Frankie ingredient and type the word.', next: 'answer' },
            { id: 'answer', type: 'verify_answer', prompt: '🔐 Decoded word', answers: ['sauce'], next: 'done' },
            { id: 'done', type: 'complete' },
          ] },
          hints: [{ id: 'spice-code-hint', title: 'Start the code', cost: 3, content: { type: 'text', text: '19=S and 1=A. The word is something you spread or drizzle.' } }],
        },
        {
          id: 'word-grid', title: 'Round 4 · Hidden ingredient', basePoints: 20, timeBonus: { withinSeconds: 90, points: 5 },
          flow: { startNodeId: 'puzzle', nodes: [
            { id: 'puzzle', type: 'puzzle', prompt: 'YOUR TASK ④\n\nFind CHILLI in the letter grid. It may run across, down, or diagonally. Tap its first letter, then its last letter.', puzzle: { type: 'word_search', grid: [
              ['C', 'A', 'P', 'S', 'I', 'X'], ['O', 'H', 'N', 'I', 'O', 'N'], ['S', 'P', 'I', 'C', 'E', 'T'],
              ['S', 'A', 'U', 'L', 'E', 'S'], ['T', 'O', 'M', 'A', 'L', 'O'], ['G', 'A', 'R', 'L', 'I', 'I'],
            ], words: ['CHILLI'] }, next: 'done' },
            { id: 'done', type: 'complete' },
          ] },
          hints: [{ id: 'word-grid-hint', title: 'Choose a direction', cost: 4, content: { type: 'text', text: 'Start at the top-left C and travel diagonally down and right ↘.' } }],
        },
        {
          id: 'final-order', title: 'Round 5 · The final order', basePoints: 20, timeBonus: { withinSeconds: 60, points: 5 },
          flow: { startNodeId: 'brief', nodes: [
            { id: 'brief', type: 'show_text', text: 'YOUR TASK ⑤\n\nThink back to your answers:\n\n1. The shared wrap\n2. The cold keeper\n3. The decoded sauce\n4. The hidden chilli\n\nWhat are you here to win? Type one word.', next: 'answer' },
            { id: 'answer', type: 'verify_answer', prompt: '🏁 Final answer', answers: ['frankie', 'a frankie'], next: 'done' },
            { id: 'done', type: 'complete' },
          ] },
          hints: [{ id: 'final-order-hint', title: 'The prize', cost: 5, content: { type: 'text', text: 'It is the shop item promised at the start of the game.' } }],
        },
      ],
    },
  },
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
