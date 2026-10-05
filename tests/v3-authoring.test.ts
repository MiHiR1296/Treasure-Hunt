import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GET as authoringKit } from '../app/api/v3/authoring-kit/route';
import { validateV3Definition } from '../lib/server/v3/authoring';

async function starter() {
  return JSON.parse(await readFile(new URL('../public/authoring/treasure-hunt-v3.starter.json', import.meta.url), 'utf8')) as Record<string, any>;
}

test('V3 authoring executes the strict nested JSON Schema with field paths', async () => {
  const valid = await starter();
  assert.deepEqual(validateV3Definition(valid).issues, []);

  const invalid = await starter();
  invalid.settings.publicBoard.enabled = 'yes';
  invalid.settings.publicBoard.columns = ['rank', 'not-a-column'];
  invalid.settings.recognition.votingWindowMinutes = 'later';
  invalid.settings.leaderboardPolicy.timeVisibility = 'leak';
  const issues = validateV3Definition(invalid).issues;
  assert.ok(issues.some(issue => issue.path === 'hunt.settings.publicBoard.enabled'));
  assert.ok(issues.some(issue => issue.path === 'hunt.settings.publicBoard.columns[1]'));
  assert.ok(issues.some(issue => issue.path === 'hunt.settings.recognition.votingWindowMinutes'));
  assert.ok(issues.some(issue => issue.path === 'hunt.settings.leaderboardPolicy.timeVisibility'));
});

test('V3 authoring rejects progression controls that runtime route plans replace', async () => {
  const nonSequential = await starter();
  nonSequential.settings.mode = 'open';
  assert.ok(validateV3Definition(nonSequential, { externalAuthoring: false }).issues.some(issue =>
    issue.path === 'hunt.settings.mode' && issue.message.includes('sequential')));

  const optionalCheckpoint = await starter();
  optionalCheckpoint.checkpoints[1].required = false;
  assert.ok(validateV3Definition(optionalCheckpoint, { externalAuthoring: false }).issues.some(issue =>
    issue.path === 'hunt.checkpoints[1].required'));

  const authoredDependency = await starter();
  authoredDependency.checkpoints[1].prerequisites = ['start'];
  assert.ok(validateV3Definition(authoredDependency, { externalAuthoring: false }).issues.some(issue =>
    issue.path === 'hunt.checkpoints[1].prerequisites'));
});

test('V3 publication bounds capped official attempts but preserves unlimited official replay', async () => {
  const oversizedCap = await starter();
  oversizedCap.settings.runPolicy = { mode: 'capped', maxOfficialRuns: 999 };
  assert.ok(validateV3Definition(oversizedCap).issues.some(issue =>
    issue.path === 'hunt.settings.runPolicy.maxOfficialRuns' && issue.message.includes('validated structural plan')));

  const unlimited = await starter();
  unlimited.settings.runPolicy = { mode: 'unlimited' };
  assert.deepEqual(validateV3Definition(unlimited).issues, [], 'unlimited official replay remains a supported organizer choice');
});

test('V3 publication binds ranking impact to score sources and rejects duplicate resolved checkpoints', async () => {
  const bonus = await starter();
  bonus.checkpoints[0].timeBonus = { withinSeconds: 30, points: 5, rankingImpact: 'excluded' };
  assert.deepEqual(validateV3Definition(bonus).issues, []);

  bonus.settings.fairnessPolicy.competitiveBonuses = [];
  assert.ok(validateV3Definition(bonus).issues.some(issue => issue.path === 'hunt.settings.fairnessPolicy.competitiveBonuses'));

  const duplicate = await starter();
  duplicate.settings.challengePools.library.variants[0].checkpointId = 'start';
  duplicate.settings.challengePools.library.variants[0].scoreCeiling = 0;
  assert.ok(validateV3Definition(duplicate).issues.some(issue => issue.message.includes('reuses engine checkpoint')));
});

test('V3 publication rejects optional competitive rewards it cannot prove route-neutral', async () => {
  const dud = await starter();
  dud.dudQrs = [{ token: '@server:generate:dud-bonus', message: 'A fun extra find.', points: 5 }];
  assert.ok(validateV3Definition(dud).issues.some(issue =>
    issue.path === 'hunt.dudQrs[0].rankingImpact' && issue.message.includes('Set rankingImpact to "excluded"')));

  const hint = await starter();
  hint.checkpoints[0].hints = [{
    id: 'optional-puzzle-bonus',
    title: 'Optional puzzle',
    cost: 0,
    enabled: false,
    content: {
      type: 'puzzle',
      puzzle: {
        type: 'word_search',
        grid: [['A', 'B'], ['B', 'A']],
        words: ['AB', 'BA'],
        minimumWords: 1,
        bonusPerExtraWord: 5,
      },
      reveal: { type: 'text', text: 'Well spotted.' },
    },
  }];
  assert.ok(validateV3Definition(hint).issues.some(issue =>
    issue.path === 'hunt.checkpoints[0].hints[0].content.puzzle.bonusRankingImpact' &&
    issue.message.includes('Set bonusRankingImpact to "excluded"')));

  hint.checkpoints[0].hints[0].content.puzzle.bonusRankingImpact = 'excluded';
  assert.deepEqual(validateV3Definition(hint).issues, []);
});

test('V3 verifier authoring rejects low-entropy code fields', async () => {
  const invalid = await starter();
  invalid.settings.variableGenerators.code.length = 2;
  assert.ok(validateV3Definition(invalid).issues.some(issue => issue.path === 'hunt.settings.variableGenerators.code.length'));

  const tinyOutcomeSpace = await starter();
  tinyOutcomeSpace.settings.variableGenerators.code = { type: 'code', alphabet: '01', length: 6 };
  assert.ok(validateV3Definition(tinyOutcomeSpace).issues.some(issue =>
    issue.path === 'hunt.settings.variableGenerators.code' && issue.message.includes('outcome space')));

  const normalizedHomoglyphs = await starter();
  normalizedHomoglyphs.settings.variableGenerators.code = { type: 'code', alphabet: 'AＡ𝐀𝔸', length: 12 };
  assert.ok(validateV3Definition(normalizedHomoglyphs).issues.some(issue =>
    issue.path === 'hunt.settings.variableGenerators.code' && issue.message.includes('outcome space')),
  'Unicode lookalikes that NFKC collapses cannot contribute fake entropy');

  const foldedCase = await starter();
  foldedCase.settings.variableGenerators.code = {
    type: 'code', alphabet: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', length: 5,
  };
  assert.ok(validateV3Definition(foldedCase).issues.some(issue =>
    issue.path === 'hunt.settings.variableGenerators.code' && issue.message.includes('outcome space')),
  'default case-insensitive comparison counts upper/lowercase pairs once');

  const unevenFoldedCase = await starter();
  unevenFoldedCase.settings.variableGenerators.code = { type: 'code', alphabet: 'AaB', length: 32 };
  assert.ok(validateV3Definition(unevenFoldedCase).issues.some(issue =>
    issue.path === 'hunt.settings.variableGenerators.code' && issue.message.includes('outcome space')),
  'comparison-colliding symbols cannot overstate min-entropy through a biased folded alphabet');

  const staticCode = await starter();
  const codeNode = staticCode.checkpoints.find((checkpoint: any) => checkpoint.id === 'park-code').flow.nodes
    .find((node: any) => node.type === 'verify_code');
  codeNode.code = '1234';
  assert.ok(validateV3Definition(staticCode).issues.some(issue =>
    issue.path.endsWith('.code') && issue.message.includes('at least 8')));

  const shareableCode = await starter();
  const shareableNode = shareableCode.checkpoints.find((checkpoint: any) => checkpoint.id === 'park-code').flow.nodes
    .find((node: any) => node.type === 'verify_code');
  shareableNode.code = 'LONG-BUT-SHAREABLE';
  assert.ok(validateV3Definition(shareableCode).issues.some(issue =>
    issue.message.includes('can be shared across teams')),
  'length prevents guessing but does not prevent a solved code being forwarded to another team');

  const fakeDirective = await starter();
  const fakeDirectiveNode = fakeDirective.checkpoints.find((checkpoint: any) => checkpoint.id === 'park-code').flow.nodes
    .find((node: any) => node.type === 'verify_code');
  fakeDirectiveNode.code = '@server:generate:not-a-qr-field';
  assert.ok(validateV3Definition(fakeDirective).issues.some(issue =>
    issue.path.endsWith('.code') && issue.message.includes('only for QR tokens')));
});

test('V3 parallel publication requires photo evidence for shareable static codes', async () => {
  const invalid = await starter();
  invalid.settings.minTeamSize = 3;
  invalid.checkpoints[0].flow.nodes[0] = {
    id: 'welcome', type: 'verify_organizer', prompt: 'Complete both lanes.', next: 'finish-start',
  };
  invalid.settings.parallelMechanics = [{
    id: 'opening-split', checkpointId: 'start', nodeId: 'welcome', timeWindowSeconds: 60,
    lanes: [
      { id: 'one', label: 'First code', type: 'code', code: 'STATIC-CODE-ONE' },
      { id: 'two', label: 'Second code', type: 'code', code: 'STATIC-CODE-TWO' },
    ],
  }];
  assert.ok(validateV3Definition(invalid).issues.some(issue =>
    issue.path === 'hunt.settings.parallelMechanics[0].lanes' && issue.message.includes('can be shared')));

  invalid.settings.parallelMechanics[0].lanes.push({ id: 'proof', label: 'Fresh proof', type: 'photo' });
  assert.deepEqual(validateV3Definition(invalid).issues, []);

  const generated = await starter();
  generated.checkpoints[0].flow.nodes[0] = {
    id: 'welcome', type: 'verify_organizer', prompt: 'Complete both lanes.', next: 'finish-start',
  };
  generated.settings.parallelMechanics = [{
    id: 'opening-split', checkpointId: 'start', nodeId: 'welcome', timeWindowSeconds: 60,
    lanes: [
      { id: 'one', label: 'First run code', type: 'code', code: '{{code}}' },
      { id: 'two', label: 'Second run code', type: 'code', code: 'SECOND-{{code}}' },
    ],
  }];
  assert.deepEqual(validateV3Definition(generated).issues, [],
    'materializing a generated code must not reclassify it as a reusable static lane');
});

test('V3 publication rejects puzzle spaces that normal UI moves can exhaust', async () => {
  const cases = [
    {
      type: 'jigsaw', rows: 2, columns: 2,
      pieces: ['a', 'b', 'c', 'd'].map(id => ({ id, imageUrl: `/images/${id}.png` })),
      solution: ['a', 'b', 'c', 'd'],
    },
    {
      type: 'matching',
      left: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      right: [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }],
      solution: [{ leftId: 'a', rightId: 'one' }, { leftId: 'b', rightId: 'two' }],
    },
    {
      type: 'sequence',
      items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      solution: ['a', 'b'],
    },
    {
      type: 'rotation', columns: 1,
      tiles: [{ id: 'only', imageUrl: '/images/only.png', correctRotation: 90 }],
    },
  ];
  for (const puzzle of cases) {
    const invalid = await starter();
    invalid.checkpoints[0].flow.nodes[0] = {
      id: 'welcome', type: 'puzzle', prompt: 'Solve carefully.', puzzle, next: 'finish-start',
    };
    assert.ok(validateV3Definition(invalid).issues.some(issue =>
      issue.path.startsWith('hunt.checkpoints[0].flow.nodes[0].puzzle')),
    `${puzzle.type} should not publish with an exhaustible search space`);
    assert.ok(validateV3Definition(invalid, { externalAuthoring: false }).issues.some(issue =>
      issue.path === 'hunt.checkpoints[0].flow.nodes[0].puzzle' && issue.message.includes('need at least')));
  }
});

test('V3 publication proves every generated value used by text, URLs, and parallel codes', async () => {
  const emptyAnswer = await starter();
  emptyAnswer.settings.variableGenerators.colour.values.push('');
  const answerIssues = validateV3Definition(emptyAnswer).issues;
  assert.ok(answerIssues.some(issue =>
    issue.path === 'hunt.checkpoints[1].flow.nodes[0].answers[0]' && issue.message.includes('empty')));

  const oversizedGroup = await starter();
  oversizedGroup.settings.variableGenerators.groupName = { type: 'choice', values: ['A', 'X'.repeat(300)] };
  oversizedGroup.checkpoints[0].group = '{{groupName}}';
  assert.ok(validateV3Definition(oversizedGroup).issues.some(issue =>
    issue.path === 'hunt.checkpoints[0].group' && issue.message.includes('at most 200')));

  const unsafeUrl = await starter();
  unsafeUrl.settings.variableGenerators.asset = { type: 'choice', values: ['safe-logo', 'bad logo'] };
  unsafeUrl.theme.logoUrl = '/images/{{asset}}.svg';
  const urlIssues = validateV3Definition(unsafeUrl).issues;
  assert.ok(urlIssues.some(issue => issue.path === 'hunt.theme.logoUrl' && issue.message.includes('possible generated value')));

  const parallel = await starter();
  parallel.checkpoints[0].flow.nodes[0] = {
    id: 'welcome', type: 'verify_organizer', prompt: 'Complete both lanes.', next: 'finish-start',
  };
  parallel.settings.variableGenerators.laneCode = { type: 'choice', values: ['GOOD', ''] };
  parallel.settings.parallelMechanics = [{
    id: 'opening-split', checkpointId: 'start', nodeId: 'welcome', timeWindowSeconds: 60,
    lanes: [
      { id: 'one', label: 'First code', type: 'code', code: '{{laneCode}}' },
      { id: 'two', label: 'Second code', type: 'code', code: 'SAFE' },
    ],
  }];
  const parallelIssues = validateV3Definition(parallel).issues;
  assert.ok(parallelIssues.some(issue =>
    issue.path === 'hunt.settings.parallelMechanics[0].lanes[0].code' && issue.message.includes('shorter')));
});

test('V3 publication validates every eligible challenge-pool materialization', async () => {
  const invalid = await starter();
  const riddle = invalid.checkpoints.find((checkpoint: any) => checkpoint.id === 'library-riddle');
  riddle.flow.startNodeId = 'route-only-reference';
  riddle.flow.nodes.unshift({
    id: 'route-only-reference',
    type: 'branch',
    condition: { type: 'checkpoint_completed', checkpointId: 'park-code' },
    ifTrue: 'solve-word',
    ifFalse: 'solve-word',
  });
  const issues = validateV3Definition(invalid).issues;
  assert.ok(issues.some(issue =>
    issue.path === 'hunt.checkpoints[2].flow.nodes[0].condition' && issue.message.includes('does not exist')),
  JSON.stringify(issues));
});

test('V3 authoring rejects placeholders outside the run-scoped materialization allowlist', async () => {
  const invalid = await starter();
  invalid.title = '{{colour}} Hunt';
  invalid.settings.publicBoard.title = 'Live board for {{colour}}';
  const issues = validateV3Definition(invalid).issues;
  assert.ok(issues.some(issue => issue.path === 'hunt.title' && issue.message.includes('not supported')), JSON.stringify(issues));
  assert.ok(issues.some(issue =>
    issue.path === 'hunt.settings.publicBoard.title' && issue.message.includes('not supported')),
  JSON.stringify(issues));

  const supported = await starter();
  supported.checkpoints[0].title = '{{colour}} Start';
  assert.deepEqual(validateV3Definition(supported).issues, []);
});

test('V3 authoring-kit endpoint returns the full provider-independent guide', async () => {
  const response = await authoringKit();
  assert.equal(response.status, 200);
  const kit = await response.json() as { version: number; prompt: string; schemaUrl: string; workflow: string[] };
  assert.equal(kit.version, 3);
  assert.equal(kit.schemaUrl, '/authoring/treasure-hunt-v3.schema.json');
  assert.ok(kit.prompt.length > 5_000, 'the deployed endpoint should not fall back to its one-line emergency prompt');
  assert.match(kit.prompt, /Treasure Hunt V3 external-AI authoring kit/);
  assert.deepEqual(kit.workflow.slice(-2), ['Preview', 'Publish explicitly']);
});
