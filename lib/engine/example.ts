import type { HuntDefinition } from './types'

/** Server/organizer content. These intentionally public workshop answers are not event secrets. */
export const exampleHunt: HuntDefinition = {
  schemaVersion: 1,
  id: 'kalyan-demo',
  version: 2,
  title: 'Kalyan: The Five Fragments',
  description: 'Six connected challenges: a riddle, a hidden QR, a landmark, two puzzles, alternative verification, and one final discovery. Collect a word at each of the first five checkpoints.',
  settings: {
    mode: 'sequential', leaderboard: 'live', ranking: 'points_time', map: 'visited', maxTeamSize: 6,
    registrationOpen: true, photoRetention: 'after_verification',
    rules: 'Play together and stay on public paths. Collect the five word fragments in order. Every checkpoint is worth 20 points; choosing a hint subtracts its displayed cost once for your whole team. Use Need help whenever technology gets in the way. This workshop uses an illustrative Kalyan search area; follow the organizer’s onsite route instructions.',
    completionMessage: 'LOOK BEYOND THE OLD GATE. You connected the clues, helped your team, and found the adventure. Thank you for exploring together!',
  },
  theme: { primaryColor: '#065f46', coverUrl: '/v2/demo/cover.svg', font: 'system', feedback: true },
  dudQrs: [
    { token: 'demo-coffee-stash', message: 'You found the secret coffee stash. Your checkpoint is still out there!' },
    { token: 'demo-sleeping-dragon', message: 'The dragon is sleeping. Try another code without closing your camera.' },
  ],
  checkpoints: [
    {
      id: 'beginning', title: '1 · Find Your Bearings', basePoints: 20,
      flow: { startNodeId: 'clue', nodes: [
        { id: 'clue', type: 'show_text', text: 'Welcome, explorers. Five places hold five fragments. Keep each word in checkpoint order; together they will unlock the final puzzle.', next: 'riddle' },
        { id: 'riddle', type: 'verify_answer', prompt: 'I have a needle, but I cannot sew. I help you find north. What am I?', answers: ['compass', 'a compass'], next: 'fragment' },
        { id: 'fragment', type: 'show_text', text: 'Your first fragment is LOOK. Keep it safe. The next clue is hidden in a code.', next: 'remember' },
        { id: 'remember', type: 'set_variable', key: 'fragment_look', value: true, next: 'done' },
        { id: 'done', type: 'complete' },
      ] },
      hints: [
        { id: 'beginning-text', title: 'A gentle nudge', cost: 2, content: { type: 'text', text: 'Explorers use this tool to find their direction.' } },
        { id: 'beginning-letters', title: 'First letters', cost: 4, content: { type: 'text', text: 'The answer begins with COMP…' } },
      ],
    },
    {
      id: 'hidden-qr', title: '2 · The Hidden QR', basePoints: 20,
      flow: { startNodeId: 'find', nodes: [
        { id: 'find', type: 'show_text', text: 'I speak without sound in a square of light and dark. Find the printed checkpoint QR your organizer placed nearby. A wrong code or playful decoy will keep your camera open.', next: 'scan' },
        { id: 'scan', type: 'verify_qr', prompt: 'Scan the checkpoint QR. If your camera is unavailable, enter the recovery code printed below it.', token: 'demo-clock-tower-8cde79a2', backupCode: 'K7DM2Q', next: 'fragment', fallback: { nodeId: 'rescue', label: 'The QR is missing — request verification', enabled: false } },
        { id: 'rescue', type: 'verify_organizer', prompt: 'Your organizer can confirm that you found the checkpoint. Use Need help to tell them where you are.', next: 'fragment' },
        { id: 'fragment', type: 'show_text', text: 'Your second fragment is BEYOND. The first two words now read LOOK BEYOND.', next: 'remember' },
        { id: 'remember', type: 'set_variable', key: 'fragment_beyond', value: true, next: 'done' },
        { id: 'done', type: 'complete' },
      ] },
      hints: [{ id: 'qr-recovery', title: 'Workshop recovery code', cost: 4, content: { type: 'text', text: 'For this demonstration, the printed backup code is K7DM2Q.' } }],
    },
    {
      id: 'landmark', title: '3 · The Landmark', basePoints: 20,
      location: { latitude: 19.2403, longitude: 73.1305, radiusMeters: 250 },
      flow: { startNodeId: 'clue', nodes: [
        { id: 'clue', type: 'show_text', text: 'Two pillars hold a curve against the sky. I am a passage, not a room. Find the gate on your organizer’s route. Start with the riddle or choose any hint you need.', next: 'nearby' },
        { id: 'nearby', type: 'verify_gps', prompt: 'When you reach the search area, check your approximate location. For a tabletop workshop, the demonstration code lets you try the next steps from anywhere.', latitude: 19.2403, longitude: 73.1305, radiusMeters: 250, maxAccuracyMeters: 100, next: 'camera', fallback: { nodeId: 'workshop', label: 'I am trying the tabletop demonstration', enabled: true } },
        { id: 'workshop', type: 'verify_code', prompt: 'Enter the tabletop demonstration code from the organizer guide.', code: 'KALYAN', next: 'camera' },
        { id: 'camera', type: 'camera_guide', prompt: 'Look for the two upright pillars and curved arch. Open the guide to compare the reference over your camera, or study the reference without camera access. Continue when you are ready.', referenceImageUrl: '/v2/demo/gate-outline.svg', next: 'verification' },
        { id: 'verification', type: 'choose_path', prompt: 'How would you like to finish the landmark challenge?', choices: [
          { id: 'photo', label: 'Send a landmark photo for organizer review', next: 'photo' },
          { id: 'observation', label: 'Answer the workshop observation question', next: 'question' },
        ] },
        { id: 'photo', type: 'verify_image', prompt: 'Take a photo showing the whole gate, or upload a workshop reference. Your organizer will confirm it. This demonstration uses human review.', referenceImages: ['/v2/demo/gate-reference.svg', '/v2/demo/gate-outline.svg'], next: 'fragment', fallback: { nodeId: 'question', label: 'Use the observation question instead', enabled: true } },
        { id: 'question', type: 'verify_answer', prompt: 'In the illustrated reference, what curved shape joins the two pillars?', answers: ['arch', 'an arch', 'the arch'], next: 'fragment' },
        { id: 'fragment', type: 'show_text', text: 'Your third fragment is THE. You have LOOK BEYOND THE. Next, bring a broken picture together.', next: 'remember' },
        { id: 'remember', type: 'set_variable', key: 'fragment_the', value: true, next: 'done' },
        { id: 'done', type: 'complete' },
      ] },
      hints: [
        { id: 'landmark-text', title: 'Hint 1 · Riddle nudge', cost: 2, content: { type: 'text', text: 'Look for an entrance: two pillars, one curved arch, and a path through the middle.' } },
        { id: 'landmark-map', title: 'Hint 2 · Rough search area', cost: 4, content: { type: 'map', latitude: 19.2403, longitude: 73.1305, radiusMeters: 400 } },
        { id: 'landmark-navigation', title: 'Hint 3 · Distance and direction', cost: 5, content: { type: 'camera', description: 'Check distance and direction to the approximate search area. GPS can drift; use the riddle to identify the gate.', latitude: 19.2403, longitude: 73.1305 } },
        { id: 'landmark-camera', title: 'Hint 4 · Camera landmark guide', cost: 6, content: { type: 'camera', description: 'Match the outline to a broad arch supported by two pillars. This is guidance; it does not automatically verify a landmark.', referenceImageUrl: '/v2/demo/gate-outline.svg' } },
        { id: 'landmark-image', title: 'Reference image', cost: 3, content: { type: 'image', url: '/v2/demo/gate-reference.svg', alt: 'Illustrated workshop gate with a rounded arch, two stone pillars and a path between them.' } },
      ],
    },
    {
      id: 'puzzle-chain', title: '4 · Picture, Words, Answer', basePoints: 20,
      flow: { startNodeId: 'jigsaw', nodes: [
        { id: 'jigsaw', type: 'puzzle', prompt: 'Put the gate picture together. Tap two tiles to swap them. Your team’s arrangement is saved after each move.', puzzle: { type: 'jigsaw', rows: 2, columns: 2, pieces: [
          { id: 'copper', imageUrl: '/v2/demo/tile-copper.svg', alt: 'Gate picture piece with sky and a curved stone edge.' },
          { id: 'fern', imageUrl: '/v2/demo/tile-fern.svg', alt: 'Gate picture piece with a pillar and plants.' },
          { id: 'sky', imageUrl: '/v2/demo/tile-sky.svg', alt: 'Gate picture piece with sky and a curved stone edge.' },
          { id: 'stone', imageUrl: '/v2/demo/tile-stone.svg', alt: 'Gate picture piece with a pillar and plants.' },
        ], solution: ['sky', 'copper', 'fern', 'stone'] }, next: 'words' },
        { id: 'words', type: 'puzzle', prompt: 'Find GATE and OLD. Tap the first and last letters of a straight word.', puzzle: { type: 'word_search', grid: [['G', 'A', 'T', 'E', 'S'], ['R', 'I', 'V', 'E', 'R'], ['O', 'L', 'D', 'X', 'Y'], ['S', 'T', 'O', 'N', 'E'], ['P', 'A', 'T', 'H', 'S']], words: ['GATE', 'OLD'] }, next: 'answer' },
        { id: 'answer', type: 'verify_answer', prompt: 'Which object appears in the picture and the word search?', answers: ['gate', 'a gate', 'the gate'], next: 'fragment' },
        { id: 'fragment', type: 'show_text', text: 'Your fourth fragment is OLD. The message now reads LOOK BEYOND THE OLD.', next: 'remember' },
        { id: 'remember', type: 'set_variable', key: 'fragment_old', value: true, next: 'done' },
        { id: 'done', type: 'complete' },
      ] },
      hints: [
        { id: 'puzzle-reference', title: 'See the complete picture', cost: 4, content: { type: 'image', url: '/v2/demo/gate-reference.svg', alt: 'Complete gate picture: sky at the top, two pillars and a path below.' } },
        { id: 'puzzle-word-row', title: 'A word-search nudge', cost: 2, content: { type: 'text', text: 'One word runs left to right along the top row. The other starts at the left of the third row.' } },
      ],
    },
    {
      id: 'alternate', title: '5 · Two Ways Through', basePoints: 20,
      location: { latitude: 19.2403, longitude: 73.1305, radiusMeters: 300 },
      flow: { startNodeId: 'route', nodes: [
        { id: 'route', type: 'choose_path', prompt: 'Find the final trail marker. You can verify it with the printed QR or use your approximate location plus the code on the marker.', choices: [
          { id: 'qr', label: 'Scan the trail marker', next: 'scan' },
          { id: 'gps', label: 'Use location and the marker code', next: 'nearby' },
        ] },
        { id: 'scan', type: 'verify_qr', prompt: 'Scan the trail-marker QR or enter its printed recovery code.', token: 'demo-trail-marker-649b7e20', backupCode: 'CROSSING', next: 'fragment', fallback: { nodeId: 'nearby', label: 'QR missing — use location and code', enabled: true } },
        { id: 'nearby', type: 'verify_gps', prompt: 'Check that you are in the approximate marker area. If GPS fails, request organizer help.', latitude: 19.2403, longitude: 73.1305, radiusMeters: 300, maxAccuracyMeters: 100, next: 'code', fallback: { nodeId: 'code', label: 'Organizer-enabled GPS recovery', enabled: false } },
        { id: 'code', type: 'verify_code', prompt: 'Enter the word printed on the trail marker.', code: 'ADVENTURE', next: 'fragment' },
        { id: 'fragment', type: 'show_text', text: 'Your fifth fragment is GATE. You now have all five words. Bring them to the final challenge in checkpoint order.', next: 'remember' },
        { id: 'remember', type: 'set_variable', key: 'fragment_gate', value: true, next: 'done' },
        { id: 'done', type: 'complete' },
      ] },
      hints: [{ id: 'alternate-print', title: 'Workshop marker code', cost: 4, content: { type: 'text', text: 'On the workshop marker the word is ADVENTURE. The printed QR recovery code is CROSSING.' } }],
    },
    {
      id: 'finale', title: '6 · The Five Fragments', basePoints: 20,
      flow: { startNodeId: 'final-puzzle', nodes: [
        { id: 'final-puzzle', type: 'puzzle', prompt: 'Type the five fragments you collected, in checkpoint order. Together they form one sentence.', puzzle: { type: 'text', prompt: 'Your five-word sentence', answers: ['look beyond the old gate', 'look beyond the old gate.'] }, next: 'celebrate' },
        { id: 'celebrate', type: 'show_media', content: { type: 'image', url: '/v2/demo/finish.svg', alt: 'An open gate under a bright sky: the adventure continues.' }, next: 'done' },
        { id: 'done', type: 'complete' },
      ] },
      hints: [
        { id: 'final-memory', title: 'Unlock a memory clue', cost: 3, content: { type: 'puzzle', puzzle: { type: 'text', prompt: 'How many word fragments did you collect?', answers: ['5', 'five'] }, reveal: { type: 'text', text: 'The first word is LOOK. The next four are BEYOND, THE, OLD, and GATE. Keep checkpoint order.' } } },
      ],
    },
  ],
}
