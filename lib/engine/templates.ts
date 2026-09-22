import { randomUUID } from 'node:crypto'
import type { HuntDefinition } from './types'
import { exampleHunt } from './example'

export interface HuntTemplate { id: string; title: string; description: string; definition: HuntDefinition }

/** Server-only starter content; never import these private configurations into player bundles. */
export const huntTemplates: HuntTemplate[] = [
  {
    id: 'frankie-code-hunt', title: 'Frankie challenge', description: 'An eight-stage shop game showcasing riddles, a photo jigsaw, bonus word search, QR phrase, matching, crossword, branching and a final campaign phrase.',
    definition: {
      schemaVersion: 1, id: 'template-frankie-code-hunt', version: 1, title: 'The Frankie Challenge',
      description: 'Eight quick challenges. Each of the first seven unlocks a word. Save them for the final phrase.\n\nFind more ingredients in the word search to earn bonus points.',
      settings: {
        mode: 'sequential', leaderboard: 'live', ranking: 'points_time', map: 'none',
        rules: 'Solve one screen at a time. Hints are shared and cost points. Filled dots above let you revisit stages your team has already unlocked.',
        completionMessage: '🌯 GOOD FOOD TURNS STRANGERS INTO A TEAM. You completed the Frankie Challenge—show this screen at the counter.',
      },
      theme: { primaryColor: '#b45309', feedback: true, buttonShape: 'pill', checkpointIconStyle: 'none', successAnimation: 'celebrate' },
      checkpoints: [
        {
          id: 'name-the-snack', title: 'Name the snack', basePoints: 20, timeBonus: { withinSeconds: 60, points: 5 },
          flow: { startNodeId: 'answer', nodes: [
            { id: 'answer', type: 'verify_answer', prompt: 'Wrapped tight, filled just right—Mumbai’s grab-and-go bite. What am I?', answers: ['frankie', 'a frankie', 'frankie roll', 'roll', 'a roll', 'wrap', 'a wrap', 'kathi roll'], recapAnswer: 'Frankie, roll, or wrap', next: 'word' },
            { id: 'word', type: 'show_text', text: '🔓 GOOD\n\nRemember this word for the final challenge.', next: 'done' },
            { id: 'done', type: 'complete' },
          ] },
          hints: [{ id: 'snack-hint', title: 'Another name', cost: 2, content: { type: 'text', text: 'Some people simply call it a roll or a wrap.' } }],
        },
        {
          id: 'frankie-picture', title: 'Rebuild the Frankie', basePoints: 20, timeBonus: { withinSeconds: 180, points: 5 },
          flow: { startNodeId: 'puzzle', nodes: [
            { id: 'puzzle', type: 'puzzle', prompt: 'Swap the nine tiles until the Frankie photo is whole.', puzzle: {
              type: 'jigsaw', rows: 3, columns: 3,
              pieces: [
                { id: 'mint', imageUrl: '/v2/demo/frankie-jigsaw-1.webp', alt: 'Stone tabletop and upper plate edge' },
                { id: 'copper', imageUrl: '/v2/demo/frankie-jigsaw-2.webp', alt: 'Pale plate behind the wrap' },
                { id: 'sesame', imageUrl: '/v2/demo/frankie-jigsaw-3.webp', alt: 'Toasted end of the wrap' },
                { id: 'amber', imageUrl: '/v2/demo/frankie-jigsaw-4.webp', alt: 'Plate edge and open Frankie' },
                { id: 'paneer', imageUrl: '/v2/demo/frankie-jigsaw-5.webp', alt: 'Colorful paneer Frankie filling' },
                { id: 'chilli', imageUrl: '/v2/demo/frankie-jigsaw-6.webp', alt: 'Toasted middle of the wrap' },
                { id: 'onion', imageUrl: '/v2/demo/frankie-jigsaw-7.webp', alt: 'Lower plate and Frankie filling' },
                { id: 'roti', imageUrl: '/v2/demo/frankie-jigsaw-8.webp', alt: 'White plate below the wrap' },
                { id: 'plate', imageUrl: '/v2/demo/frankie-jigsaw-9.webp', alt: 'Plate edge and stone tabletop' },
              ],
              solution: ['mint', 'copper', 'sesame', 'amber', 'paneer', 'chilli', 'onion', 'roti', 'plate'],
            }, next: 'word' },
            { id: 'word', type: 'show_text', text: '🔓 FOOD\n\nRemember this word for the final challenge.', next: 'done' },
            { id: 'done', type: 'complete' },
          ] },
          hints: [{ id: 'picture-hint', title: 'Peek at the whole picture', cost: 4, content: { type: 'image', url: '/v2/demo/frankie-puzzle-source.webp', alt: 'A paneer Frankie on a pale ceramic plate' } }],
        },
        {
          id: 'ingredient-search', title: 'Find the ingredients', basePoints: 20, timeBonus: { withinSeconds: 240, points: 5 },
          flow: { startNodeId: 'puzzle', nodes: [
            { id: 'puzzle', type: 'puzzle', prompt: 'Eight Frankie ingredients are hidden here. Find any three to continue—or keep searching for bonus points.', puzzle: {
              type: 'word_search', minimumWords: 3, bonusPerExtraWord: 2,
              grid: [
                ['K', 'R', 'V', 'C', 'T', 'A', 'S', 'P'],
                ['Q', 'E', 'P', 'U', 'L', 'Z', 'A', 'T'],
                ['O', 'E', 'G', 'A', 'B', 'B', 'A', 'C'],
                ['W', 'N', 'S', 'A', 'U', 'C', 'E', 'H'],
                ['R', 'A', 'I', 'E', 'R', 'S', 'J', 'I'],
                ['M', 'P', 'E', 'O', 'E', 'O', 'F', 'L'],
                ['S', 'J', 'O', 'V', 'N', 'H', 'T', 'L'],
                ['E', 'F', 'K', 'Z', 'C', 'X', 'C', 'I'],
              ],
              words: ['PANEER', 'CABBAGE', 'CHILLI', 'ONION', 'SAUCE', 'CHEESE', 'MASALA', 'ROTI'],
            }, next: 'word' },
            { id: 'word', type: 'show_text', text: '🔓 TURNS\n\nRemember this word for the final challenge.', next: 'done' },
            { id: 'done', type: 'complete' },
          ] },
          hints: [{ id: 'ingredient-hint', title: 'Search tip', cost: 3, content: { type: 'text', text: 'PANEER runs upward in the second column. Other words may be backwards or diagonal.' } }],
        },
        {
          id: 'coldest-door', title: 'Find the coldest door', basePoints: 20, timeBonus: { withinSeconds: 120, points: 5 },
          flow: { startNodeId: 'scan', nodes: [
            { id: 'scan', type: 'verify_qr', prompt: 'Tall, cold, and full of ingredients. Find me in the shop, then scan the marker attached to me.\n\nIf the camera struggles, type the phrase printed under the QR.', token: 'template-fridge-marker', backupCode: 'KEEP IT COOL', next: 'word', fallback: { nodeId: 'staff', label: 'Ask staff to verify the fridge', enabled: false } },
            { id: 'staff', type: 'verify_organizer', prompt: 'Show the fridge marker to a staff member for approval.', next: 'word' },
            { id: 'word', type: 'show_text', text: '🔓 STRANGERS\n\nRemember this word for the final challenge.', next: 'done' },
            { id: 'done', type: 'complete' },
          ] },
          hints: [{ id: 'fridge-hint', title: 'Look for the appliance', cost: 3, content: { type: 'text', text: 'Find the shop’s largest appliance that keeps ingredients and drinks cold.' } }],
        },
        {
          id: 'match-the-parts', title: 'Match the Frankie parts', basePoints: 20, timeBonus: { withinSeconds: 120, points: 5 },
          flow: { startNodeId: 'puzzle', nodes: [
            { id: 'puzzle', type: 'puzzle', prompt: 'Match each Frankie part to what it brings to the bite.', puzzle: {
              type: 'matching',
              left: [{ id: 'roti', label: 'Roti' }, { id: 'paneer', label: 'Paneer' }, { id: 'onion', label: 'Onion' }, { id: 'sauce', label: 'Sauce' }],
              right: [{ id: 'wrap', label: 'The wrap' }, { id: 'filling', label: 'The filling' }, { id: 'crunch', label: 'Fresh crunch' }, { id: 'tang', label: 'Tangy flavour' }],
              solution: [{ leftId: 'roti', rightId: 'wrap' }, { leftId: 'paneer', rightId: 'filling' }, { leftId: 'onion', rightId: 'crunch' }, { leftId: 'sauce', rightId: 'tang' }],
            }, next: 'word' },
            { id: 'word', type: 'show_text', text: '🔓 INTO\n\nRemember this word for the final challenge.', next: 'done' },
            { id: 'done', type: 'complete' },
          ] },
          hints: [{ id: 'matching-hint', title: 'Think about texture', cost: 2, content: { type: 'text', text: 'Roti holds everything. Onion supplies the crunch.' } }],
        },
        {
          id: 'ingredient-crossword', title: 'Fill the ingredient crossword', basePoints: 20, timeBonus: { withinSeconds: 180, points: 5 },
          flow: { startNodeId: 'puzzle', nodes: [
            { id: 'puzzle', type: 'puzzle', prompt: 'Three Frankie ingredients cross here. Use the clues to complete the grid.', puzzle: {
              type: 'crossword', rows: 6, columns: 6,
              entries: [
                { id: 'paneer', clue: 'Soft Indian cheese often used as the filling', answer: 'PANEER', row: 2, column: 0, direction: 'across' },
                { id: 'onion', clue: 'Layered vegetable that adds crunch', answer: 'ONION', row: 1, column: 2, direction: 'down' },
                { id: 'chilli', clue: 'Ingredient that brings the heat', answer: 'CHILLI', row: 3, column: 0, direction: 'across' },
              ],
            }, next: 'word' },
            { id: 'word', type: 'show_text', text: '🔓 A\n\nRemember this word for the final challenge.', next: 'done' },
            { id: 'done', type: 'complete' },
          ] },
          hints: [{ id: 'crossword-hint', title: 'First answer', cost: 4, content: { type: 'text', text: 'The six-letter cheese across is PANEER.' } }],
        },
        {
          id: 'choose-the-flavour', title: 'Choose your Frankie mood', basePoints: 20, timeBonus: { withinSeconds: 120, points: 5 },
          flow: { startNodeId: 'route', nodes: [
            { id: 'route', type: 'choose_path', prompt: 'How would your team order its Frankie today?', choices: [{ id: 'spicy', label: 'Turn up the heat', next: 'spicy' }, { id: 'crunchy', label: 'Keep it crunchy', next: 'crunchy' }] },
            { id: 'spicy', type: 'puzzle', prompt: 'Choose the ingredient that brings the heat.', puzzle: { type: 'multiple_choice', prompt: 'Which ingredient makes a Frankie hottest?', options: [{ id: 'chilli', label: 'Chilli' }, { id: 'onion', label: 'Onion' }, { id: 'cheese', label: 'Cheese' }], correctOptionId: 'chilli' }, next: 'word' },
            { id: 'crunchy', type: 'verify_answer', prompt: 'Which fresh, layered ingredient adds a crisp crunch?', answers: ['onion', 'onions', 'cabbage'], recapAnswer: 'Onion or cabbage', next: 'word' },
            { id: 'word', type: 'show_text', text: '🔓 TEAM\n\nYou now have every word.', next: 'done' },
            { id: 'done', type: 'complete' },
          ] },
          hints: [{ id: 'flavour-hint', title: 'Heat or crunch', cost: 3, content: { type: 'text', text: 'Chilli brings the heat. Onion or cabbage can bring the crunch.' } }],
        },
        {
          id: 'campaign-phrase', title: 'Build the final phrase', basePoints: 20, timeBonus: { withinSeconds: 180, points: 10 },
          flow: { startNodeId: 'puzzle', nodes: [
            { id: 'puzzle', type: 'puzzle', prompt: 'Arrange every word you unlocked to reveal the campaign line.', puzzle: {
              type: 'sequence',
              items: [{ id: 'good', label: 'GOOD' }, { id: 'food', label: 'FOOD' }, { id: 'turns', label: 'TURNS' }, { id: 'strangers', label: 'STRANGERS' }, { id: 'into', label: 'INTO' }, { id: 'a', label: 'A' }, { id: 'team', label: 'TEAM' }],
              solution: ['good', 'food', 'turns', 'strangers', 'into', 'a', 'team'],
            }, next: 'done' },
            { id: 'done', type: 'complete' },
          ] },
          hints: [{ id: 'phrase-hint', title: 'The ending', cost: 5, content: { type: 'text', text: 'The phrase ends with INTO A TEAM.' } }],
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
    // Short recovery codes are unique per copied hunt. Deliberate printed phrases
    // (identified by their spaces) remain human-readable campaign material.
    if (node.backupCode !== undefined && !/\s/.test(node.backupCode.trim())) node.backupCode = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()
  }
  return definition
}
