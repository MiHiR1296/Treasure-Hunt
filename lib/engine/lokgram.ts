import type { HuntDefinition, FlowNode } from './types'

const finish = (id = 'done'): FlowNode => ({ id, type: 'complete' })
const text = (id: string, value: string, next: string): FlowNode => ({ id, type: 'show_text', text: value, next })
const answer = (id: string, prompt: string, answers: string[], next: string): FlowNode => ({ id, type: 'verify_answer', prompt, answers, next })

const wordSearches = [
  { id: 'words-0', words: ['IMAGINATION','VOCABULARY','NOTEBOOK','LESSON','STUDY','MENTOR','HISTORY','FICTION','POETRY','REFERENCE','CHAPTER','ARCHIVE'], grid: [['I','N','O','S','S','E','L','Y','Y','L','Z','Y'],['F','M','V','S','X','V','D','Y','B','P','R','L'],['I','B','A','A','Z','U','M','K','I','T','W','H'],['C','U','Y','G','T','I','O','O','E','L','E','C'],['T','E','B','S','I','G','C','O','E','K','H','U'],['I','H','V','N','W','N','P','B','M','A','J','R'],['O','M','L','I','W','A','A','E','P','K','K','R'],['N','Q','R','E','H','I','S','T','O','R','Y','O'],['X','N','E','D','Z','C','E','O','I','M','V','T'],['O','F','E','L','J','R','R','N','G','O','M','N'],['V','O','C','A','B','U','L','A','R','Y','N','E'],['R','E','F','E','R','E','N','C','E','R','C','M']] },
  { id: 'words-1', words: ['OBSERVATION','COOPERATION','DISCUSSION','INQUIRY','LISTENING','RESPECT','TEAMWORK','COMMUNITY','REASONING','EVIDENCE','QUESTION','DISCOVERY'], grid: [['E','W','M','D','I','S','C','O','V','E','R','Y'],['C','N','O','C','R','T','K','C','T','M','N','I'],['O','N','O','I','T','A','R','E','P','O','O','C'],['M','Q','D','I','Z','C','A','H','I','G','R','E'],['M','S','U','N','T','M','L','S','O','N','E','V'],['U','P','V','E','W','A','S','C','F','I','S','I'],['N','K','L','O','S','U','V','M','U','N','P','D'],['I','N','R','P','C','T','H','R','Z','E','E','E'],['T','K','N','S','L','U','I','E','E','T','C','N'],['Y','R','I','U','Q','N','I','O','G','S','T','C'],['H','D','K','X','L','M','P','R','N','I','B','E'],['G','N','I','N','O','S','A','E','R','L','C','O']] },
  { id: 'words-2', words: ['KNOWLEDGE','CURIOSITY','RESEARCH','DISCOVERY','CHAPTER','JOURNAL','AUTHOR','LIBRARY','QUESTION','EVIDENCE','READING','SHELF'], grid: [['W','G','H','J','Y','R','A','R','B','I','L','A'],['H','A','A','R','E','S','E','A','R','C','H','F'],['A','O','Y','A','L','T','P','R','F','E','H','E'],['K','H','N','R','P','A','A','K','G','C','E','C'],['F','K','C','A','E','U','N','D','X','U','C','N'],['L','R','H','Y','T','V','E','R','D','R','O','E'],['E','C','E','H','M','L','O','C','U','I','R','D'],['H','M','O','A','W','V','L','C','T','O','L','I'],['S','R','I','O','D','Y','E','S','S','S','J','V'],['C','R','N','Z','D','I','E','R','L','I','U','E'],['N','K','I','U','H','U','N','Y','Z','T','D','A'],['T','Y','V','X','Q','T','C','G','D','Y','T','D']] },
  { id: 'words-3', words: ['SCHOOLHOUSE','CLASSROOM','TEACHER','STUDENT','LEARNING','TEXTBOOK','BLACKBOARD','HOMEWORK','FRIENDSHIP','KINDNESS','COURAGE','FUTURE'], grid: [['R','F','R','I','E','N','D','S','H','I','P','I'],['R','S','S','E','N','D','N','I','K','B','H','M'],['W','X','A','S','L','S','H','Z','L','T','O','O'],['F','X','K','U','L','I','B','A','K','W','M','O'],['U','A','B','O','Q','E','C','V','J','C','E','R'],['T','P','B','H','O','K','A','T','J','T','W','S'],['U','S','G','L','B','B','E','R','N','E','O','S'],['R','F','I','O','Z','A','T','E','N','N','R','A'],['E','T','A','O','C','Q','D','X','F','I','K','L'],['N','R','K','H','B','U','S','T','E','Y','N','C'],['D','H','E','C','T','P','N','J','J','T','Y','G'],['R','R','Z','S','K','E','G','A','R','U','O','C']] },
]

const quizQuestions = [
  ['vote', 'What is the fairest way to choose one team representative?', ['Let everyone have an equal vote.', 'Let the fastest person decide.', 'Let one person decide without asking.']],
  ['source', 'If you do not know whether a message is true, what should you do first?', ['Check a reliable source.', 'Forward it immediately.', 'Guess.']],
  ['listen', 'What does it mean to listen respectfully?', ['Give someone attention even when you disagree.', 'Interrupt quickly.', 'Ignore the speaker.']],
  ['park', 'Which action helps keep a shared park pleasant?', ['Put waste in a bin.', 'Leave waste under a bench.', 'Move it somewhere hidden.']],
  ['ideas', 'If two teammates have different ideas, what is a good next step?', ['Discuss both ideas and agree together.', 'Stop listening.', 'Choose randomly.']],
  ['rule', 'Why should a team follow a clearly stated rule?', ['So the same standard is fair to everyone.', 'So nobody can ask questions.', 'So the fastest team wins automatically.']],
  ['mistake', 'What should you do when you make a mistake in a team puzzle?', ['Say so and help the team correct it.', 'Hide it.', 'Blame another teammate.']],
  ['space', 'Which is an example of civic responsibility?', ['Taking care of shared spaces.', 'Damaging a public sign.', 'Blocking a public path.']],
  ['evidence', 'What makes information more trustworthy?', ['Evidence that can be checked.', 'A dramatic headline.', 'A secret source nobody can inspect.']],
  ['team', 'What is the strongest team advantage in this hunt?', ['Cooperation.', 'Silence.', 'Rushing.']],
] as const

const truthQuiz = {
  type: 'quiz' as const,
  minimumCorrect: 3,
  bonusPerAdditionalCorrect: 2,
  questions: quizQuestions.map(([id, prompt, labels]) => ({
    id,
    prompt,
    options: labels.map((label, optionIndex) => ({ id: `${id}-${optionIndex}`, label })),
    correctOptionId: `${id}-0`,
  })),
}

const crosswordHintPlans = [
  { nodeId: 'variant-a', label: 'a', entries: [
    ['book', 'BOOK', 'Something with pages'], ['class', 'CLASS', 'A group learning together'], ['bell', 'BELL', 'A sound that can begin a school day'],
    ['teach', 'TEACH', 'Help someone learn'], ['learn', 'LEARN', 'Gain knowledge'], ['friend', 'FRIEND', 'A person who stands by you'],
  ] },
  { nodeId: 'variant-b', label: 'b', entries: [
    ['page', 'PAGE', 'One side of a book'], ['lesson', 'LESSON', 'Something taught in class'], ['ring', 'RING', 'A circular shape or a bell sound'],
    ['guide', 'GUIDE', 'A person or thing that shows the way'], ['study', 'STUDY', 'Spend time learning'], ['team', 'TEAM', 'A group working together'],
  ] },
  { nodeId: 'variant-c', label: 'c', entries: [
    ['novel', 'NOVEL', 'A long fictional story'], ['school', 'SCHOOL', 'A place where people learn'], ['chime', 'CHIME', 'A clear ringing sound'],
    ['mentor', 'MENTOR', 'An experienced person who guides you'], ['read', 'READ', 'Look at and understand written words'], ['ally', 'ALLY', 'A helpful friend or supporter'],
  ] },
  { nodeId: 'variant-d', label: 'd', entries: [
    ['story', 'STORY', 'A tale that is told or written'], ['pupil', 'PUPIL', 'A student'], ['tone', 'TONE', 'The quality or character of a sound'],
    ['coach', 'COACH', 'Someone who trains or guides a team'], ['know', 'KNOW', 'Understand or be aware of'], ['partner', 'PARTNER', 'A person who works with you'],
  ] },
] as const

const crosswordHints = crosswordHintPlans.flatMap(plan => [
  { id: `crossword-${plan.label}-strategy`, title: 'How to work this crossword', cost: 1, content: { type: 'text' as const, text: 'Start with the shortest clues, enter any letters you know, and use crossing letters to confirm longer answers. This hint is available as soon as this crossword opens.' }, relevance: { nodeId: plan.nodeId, unlockAfterSeconds: 0, expireWhenSolved: false }, enabled: true, showWhenLocked: false },
  ...plan.entries.flatMap(([id, answer, clue]) => [
    { id: `crossword-${plan.label}-${id}-gentle`, title: 'A gentle clue for this word', cost: 2, content: { type: 'text' as const, text: `This is a ${answer.length}-letter answer. Clue: ${clue}. The first letter is ${answer[0]}.` }, relevance: { nodeId: plan.nodeId, puzzleItemId: id, unlockAfterSeconds: 0, expireWhenSolved: true }, enabled: true, showWhenLocked: false },
    { id: `crossword-${plan.label}-${id}-direct`, title: 'A stronger clue for this word', cost: 4, content: { type: 'text' as const, text: `The answer is ${answer}. Enter it using the crossing squares, then continue with the remaining unsolved words.` }, relevance: { nodeId: plan.nodeId, puzzleItemId: id, unlockAfterSeconds: 60, expireWhenSolved: true }, enabled: true, showWhenLocked: false },
  ]),
])

const crosswordPuzzles: { id: string; prompt: string; entries: { id: string; clue: string; answer: string; row: number; column: number; direction: 'across' | 'down' }[] }[] = [
  { id: 'variant-a', prompt: 'Variant A — solve the learning-themed crossword.', entries: [
    { id: 'book', clue: 'Something with pages', answer: 'BOOK', row: 1, column: 3, direction: 'down' },
    { id: 'class', clue: 'A group learning together', answer: 'CLASS', row: 0, column: 6, direction: 'down' },
    { id: 'bell', clue: 'A sound that can begin a school day', answer: 'BELL', row: 1, column: 3, direction: 'across' },
    { id: 'teach', clue: 'Help someone learn', answer: 'TEACH', row: 2, column: 4, direction: 'across' },
    { id: 'learn', clue: 'Gain knowledge', answer: 'LEARN', row: 1, column: 5, direction: 'down' },
    { id: 'friend', clue: 'A person who stands by you', answer: 'FRIEND', row: 0, column: 0, direction: 'across' },
  ] },
  { id: 'variant-b', prompt: 'Variant B — solve the learning-themed crossword.', entries: [
    { id: 'page', clue: 'One side of a book', answer: 'PAGE', row: 0, column: 0, direction: 'down' },
    { id: 'lesson', clue: 'Something taught in class', answer: 'LESSON', row: 1, column: 4, direction: 'down' },
    { id: 'ring', clue: 'A circular shape or a bell sound', answer: 'RING', row: 1, column: 2, direction: 'down' },
    { id: 'guide', clue: 'A person or thing that shows the way', answer: 'GUIDE', row: 2, column: 0, direction: 'across' },
    { id: 'study', clue: 'Spend time learning', answer: 'STUDY', row: 3, column: 4, direction: 'across' },
    { id: 'team', clue: 'A group working together', answer: 'TEAM', row: 3, column: 5, direction: 'down' },
  ] },
  { id: 'variant-c', prompt: 'Variant C — solve the learning-themed crossword.', entries: [
    { id: 'novel', clue: 'A long fictional story', answer: 'NOVEL', row: 4, column: 6, direction: 'across' },
    { id: 'school', clue: 'A place where people learn', answer: 'SCHOOL', row: 0, column: 7, direction: 'down' },
    { id: 'chime', clue: 'A clear ringing sound', answer: 'CHIME', row: 3, column: 0, direction: 'across' },
    { id: 'mentor', clue: 'An experienced person who guides you', answer: 'MENTOR', row: 3, column: 3, direction: 'across' },
    { id: 'read', clue: 'Look at and understand written words', answer: 'READ', row: 3, column: 8, direction: 'across' },
    { id: 'ally', clue: 'A helpful friend or supporter', answer: 'ALLY', row: 3, column: 10, direction: 'down' },
  ] },
  { id: 'variant-d', prompt: 'Variant D — solve the learning-themed crossword.', entries: [
    { id: 'story', clue: 'A tale that is told or written', answer: 'STORY', row: 6, column: 0, direction: 'across' },
    { id: 'pupil', clue: 'A student', answer: 'PUPIL', row: 0, column: 1, direction: 'across' },
    { id: 'tone', clue: 'The quality or character of a sound', answer: 'TONE', row: 5, column: 0, direction: 'across' },
    { id: 'coach', clue: 'Someone who trains or guides a team', answer: 'COACH', row: 1, column: 1, direction: 'across' },
    { id: 'know', clue: 'Understand or be aware of', answer: 'KNOW', row: 4, column: 2, direction: 'down' },
    { id: 'partner', clue: 'A person who works with you', answer: 'PARTNER', row: 0, column: 3, direction: 'down' },
  ] },
]

export const lokgramPilotHunt: HuntDefinition = {
  schemaVersion: 1,
  id: 'lokgram-pilot',
  version: 1,
  title: 'Lokgram: The Learning Trail',
  description: 'A nine-checkpoint family treasure hunt through Lokgram, combining outdoor discovery with friendly puzzles.',
  settings: {
    mode: 'sequential', leaderboard: 'live', ranking: 'points_time', map: 'visited', assignmentVersion: 2,
    maxTeamSize: 6, minTeamSize: 2, sessionDurationSeconds: 5400, registrationOpen: true,
    rules: 'Stay together on public paths. Do not enter the school or library unless it is open and the organizer has confirmed access. No running is required. Hints cost points and are shared by the team. Ask the organizer for help if GPS or a puzzle misbehaves.',
    completionMessage: 'You completed the Lokgram Learning Trail. Show this screen to the organizer at the confirmed prize stop.',
  },
  theme: { primaryColor: '#0f766e', font: 'system', feedback: true, buttonShape: 'pill', checkpointIconStyle: 'numbers', successAnimation: 'celebrate' },
  checkpoints: [
    { id: 'mango-garden', title: '1 · The Green Beginning', basePoints: 10, flow: { startNodeId: 'arrival', nodes: [
      { id: 'arrival', type: 'verify_gps', clue: 'Your first destination is a leafy outdoor space in Lokgram, with trees, open paths, shaded corners, and room to pause. It carries the name of a tropical summer favourite—the fruit known for golden flesh, a sweet fragrance, and a taste people wait for all year. Find this refreshing green retreat, then let the map confirm when you are nearby.', prompt: 'When you have arrived, tap “I’m here — check location”.', latitude: 19.229060298879688, longitude: 73.12851504111595, radiusMeters: 125, maxAccuracyMeters: 100, next: 'done' }, finish(),
    ] }, hints: [{ id: 'mango-nudge', title: 'A little nudge', cost: 2, content: { type: 'text', text: 'Think of the fruit that many people wait for in summer.' } }] },
    { id: 'library-word-search', title: '2 · The Thinking Hunt', basePoints: 10, flow: { startNodeId: 'intro', nodes: [
      text('intro', 'Find all words in your grid. Your team receives one fixed variant; it will not change after a refresh. Once you submit, you will be locked out, so think well before submitting ', 'route'),
      { id: 'route', type: 'random_branch', choices: wordSearches.map((_, index) => ({ next: `variant-${index}`, weight: 1 })) },
      ...wordSearches.map((puzzle, index) => ({ id: `variant-${index}`, type: 'puzzle', prompt: `Find all six hidden words.\n\n${index === 2 ? '\n' : ''}(Players may continue after the required number. Every additional hidden word can award the configured bonus.)`, puzzle: { type: 'word_search', grid: puzzle.grid, words: puzzle.words, minimumWords: 6, bonusPerExtraWord: 2 }, next: 'reveal' } as FlowNode)),
      text('reveal', 'Books, pages, quiet corners, and curious minds point you toward the Satyamev Jayate Public Library area.', 'done'), finish(),
    ] }, hints: [{ id: 'word-search-help', title: 'Help ME!!!', cost: 0, content: { type: 'text', text: 'Start with the shortest word in your list and scan across each row.' } }] },
    { id: 'truth-in-action', title: '3 · Truth in Action', basePoints: 10, flow: { startNodeId: 'quiz', nodes: [
      { id: 'quiz', type: 'puzzle', clue: '“Satyamev Jayate” means “Truth alone triumphs.” Work together and choose the fairest, most evidence-based response.', prompt: 'Answer any three questions correctly to continue. You may skip the others without losing points.', puzzle: truthQuiz, next: 'done' },
      finish(),
    ] }, hints: [{ id: 'truth-nudge', title: 'A gentle nudge', cost: 2, content: { type: 'text', text: 'Choose the answer that is fair, evidence-based, and considerate of others.' } }] },
    { id: 'satyamev-library', title: '4 · The Quiet Corner', basePoints: 10, flow: { startNodeId: 'arrival', nodes: [
      { id: 'arrival', type: 'verify_gps', clue: 'I am full of chapters, tales, and facts, yet I am not a single book. I ask you to keep your voice down while you explore worlds without leaving your chair. You are looking for a place where pages turn, questions are welcome, and a neighbourhood can learn together.', prompt: 'When you are at the public approach, tap “I’m here — check location”.', latitude: 19.226288449138696, longitude: 73.12952504158153, radiusMeters: 120, maxAccuracyMeters: 100, next: 'done' }, finish(),
    ] }, hints: [{ id: 'library-nudge', title: 'A location nudge', cost: 4, content: { type: 'text', text: 'Use the broad map area and look for the public library reference in the event briefing.' } }] },
    { id: 'picture-next-place', title: '5 · Picture the Next Place', basePoints: 10, flow: { startNodeId: 'jigsaw', nodes: [
      { id: 'jigsaw', type: 'puzzle', prompt: 'Assemble the artwork to discover the next landmark. Tap two tiles to swap them.', puzzle: { type: 'jigsaw', rows: 3, columns: 3, pieces: [
        { id: 'tile-1', imageUrl: '/v2/lokgram/jigsaw-1.png', alt: 'Top-left section of the blue and gold artwork' },
        { id: 'tile-2', imageUrl: '/v2/lokgram/jigsaw-2.png', alt: 'Top-center section of the blue and gold artwork' },
        { id: 'tile-3', imageUrl: '/v2/lokgram/jigsaw-3.png', alt: 'Top-right section of the blue and gold artwork' },
        { id: 'tile-4', imageUrl: '/v2/lokgram/jigsaw-4.png', alt: 'Middle-left section of the blue and gold artwork' },
        { id: 'tile-5', imageUrl: '/v2/lokgram/jigsaw-5.png', alt: 'Middle-center section of the blue and gold artwork' },
        { id: 'tile-6', imageUrl: '/v2/lokgram/jigsaw-6.png', alt: 'Middle-right section of the blue and gold artwork' },
        { id: 'tile-7', imageUrl: '/v2/lokgram/jigsaw-7.png', alt: 'Bottom-left section of the blue and gold artwork' },
        { id: 'tile-8', imageUrl: '/v2/lokgram/jigsaw-8.png', alt: 'Bottom-center section of the blue and gold artwork' },
        { id: 'tile-9', imageUrl: '/v2/lokgram/jigsaw-9.png', alt: 'Bottom-right section of the blue and gold artwork' }
      ], solution: ['tile-1', 'tile-2', 'tile-3', 'tile-4', 'tile-5', 'tile-6', 'tile-7', 'tile-8', 'tile-9'] }, next: 'reveal' },
      text('reveal', 'The picture is complete. Look for the place of bells, books, and bright minds.', 'done'), finish(),
    ] }, hints: [{ id: 'picture-help', title: 'See the reference', cost: 4, content: { type: 'image', url: '/v2/lokgram/jigsaw-source.png', alt: 'The complete blue and gold artwork.' } }] },
    { id: 'school-crossword', title: '6 · Bells, Books, Belonging', basePoints: 10, flow: { startNodeId: 'intro', nodes: [
      text('intro', 'Complete this small crossword. ', 'variant-route'),
      { id: 'variant-route', type: 'random_branch', choices: crosswordPuzzles.map(variant => ({ next: variant.id, weight: 1 })) },
      ...crosswordPuzzles.map(variant => ({ id: variant.id, type: 'puzzle', prompt: variant.prompt, puzzle: { type: 'crossword', rows: 10, columns: 12, entries: variant.entries }, next: 'reveal' } as FlowNode)),
      text('reveal', 'Bells, books, learning, and friendship point toward the Lok Kalyan Public School vicinity. Stay outside on the public road.', 'done'), finish(),
    ] }, hints: crosswordHints },
    { id: 'lok-kalyan-school', title: '7 · Where Learning Begins', basePoints: 10, flow: { startNodeId: 'verify-gps-1', nodes: [
      finish(), { id: 'verify-gps-1', type: 'verify_gps', clue: 'Your next destination is where mornings begin with bells, backpacks, and bright minds heading toward new lessons. Look for the place where learning brings the neighbourhood together. Stay on the public road outside. The exact safe public-road GPS pin is still a field-test setting.', prompt: 'Check your location when you have arrived.\n\n19.229773042896714, 73.12943794958892', latitude: 19.229773042896714, longitude: 73.12943794958892, radiusMeters: 100, maxAccuracyMeters: 100, next: 'done' },
    ] }, hints: [{ id: 'school-nudge', title: 'A stronger nudge', cost: 6, content: { type: 'text', text: 'You are looking for a school whose name begins with “Lok.”' } }] },
    { id: 'one-last-thought', title: '8 · One Last Thought', basePoints: 10, flow: { startNodeId: 'sudoku', nodes: [
      { id: 'sudoku', type: 'puzzle', prompt: 'Fill the one missing number.', puzzle: { type: 'sudoku', size: 4, givens: [[0, 0, 1, 0], [0, 2, 4, 3], [0, 4, 0, 0], [0, 1, 3, 0]] }, next: 'done' }, finish(),
    ] }, hints: [{ id: 'sudoku-help', title: 'Check the row', cost: 2, content: { type: 'text', text: 'The missing row already contains 2, 1, and 4.' } }] },
    { id: 'prize-stop', title: '9 · The Prize Stop', basePoints: 10, flow: { startNodeId: 'arrival', nodes: [
      text('arrival', 'You made it through the trail. Field-test placeholder: show this screen to the organizer at the confirmed public prize stop.', 'confirm'),
      answer('confirm', 'Enter the final handoff code from the organizer.', ['FIELDTEST'], 'done'), finish(),
    ] }, hints: [] },
  ],
}
