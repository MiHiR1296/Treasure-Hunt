import '../isolated-database';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getPool } from '../../lib/server/db';
import { validateFairness } from '../../lib/v3/fairness';
import type { V3Definition } from '../../lib/v3/types';

const origin = 'http://127.0.0.1:3100';
const suffix = randomUUID().slice(0, 8);
const huntId = `v3-mobile-${suffix}`;
const boardSlug = `${huntId}-board`;
const huntTitle = `Mobile replay hunt ${suffix}`;
const boardTitle = `Mobile replay board ${suffix}`;
const teamName = `Mobile Falcons ${suffix}`;
const organizerRateLimitKeys = [
  'organizer-signin:source:unavailable',
  'organizer-signin:target:admin',
].map(value => createHash('sha256').update(value).digest('hex'));

const definition: V3Definition = {
  schemaVersion: 3,
  id: huntId,
  version: 1,
  title: huntTitle,
  description: 'A short browser journey for the complete V3 replay and recognition flow.',
  settings: {
    mode: 'sequential',
    map: 'none',
    rules: 'Stay together and celebrate the crew.',
    minTeamSize: 2,
    maxTeamSize: 4,
    sessionDurationSeconds: 3600,
    registrationOpen: true,
    completionMessage: 'Great run. Celebrate the crew, then try to beat your best.',
    photoRetention: 'after_verification',
    registrationMode: 'self-serve',
    runPolicy: { mode: 'unlimited' },
    leaderboardPolicy: {
      bestRunRule: 'score_then_time_then_completion',
      mainBoardEnabled: true,
      replayBoardEnabled: true,
      replayBoardPublic: true,
      timeVisibility: 'after_second_eligible_run',
      showProgress: true,
    },
    publicBoard: {
      enabled: true,
      slug: boardSlug,
      title: boardTitle,
      status: 'live',
      teamIdentity: 'code_and_name',
      columns: ['rank', 'team_code', 'team_name', 'points', 'runs', 'time', 'completion_status'],
    },
    socialShare: {
      enabled: true,
      organizerHandle: '@mobilehunt',
      campaignHashtag: '#MobileReplay',
      allowPersonalTitle: true,
    },
    recognition: {
      enabled: true,
      peerVotingEnabled: true,
      votingWindowMinutes: 60,
      dataWeight: 0.7,
      peerWeight: 0.3,
    },
    routePlan: {
      startCheckpointId: 'start',
      finaleCheckpointId: 'finale',
      requiredCheckpointIds: [],
      choose: { count: 0, fromCheckpointIds: [] },
      shuffleSelectedCheckpoints: false,
      avoidTransitions: [],
      checkpointEstimates: {
        start: { durationMinutes: 1 },
        finale: { durationMinutes: 1 },
      },
      travelEstimates: [{ from: 'start', to: 'finale', durationMinutes: 0 }],
    },
    challengePools: {},
    variableGenerators: {},
    fairnessPolicy: {
      minimumDistinctPlans: 1,
      durationToleranceMinutes: 0,
      maxResolvedRoutes: 10,
      requireTravelEstimates: true,
      walkingSpeedMetersPerMinute: 72,
      minutesPerDifficultyPoint: 1.5,
    },
    parallelMechanics: [],
  },
  checkpoints: [
    {
      id: 'start',
      title: 'Opening trail',
      basePoints: 10,
      required: true,
      flow: {
        startNodeId: 'open-trail',
        nodes: [
          { id: 'open-trail', type: 'show_text', text: 'Alice opens the first trail for the crew.', next: 'start-done' },
          { id: 'start-done', type: 'complete' },
        ],
      },
      hints: [],
    },
    {
      id: 'finale',
      title: 'Crew finish',
      basePoints: 10,
      required: true,
      flow: {
        startNodeId: 'finish-together',
        nodes: [
          { id: 'finish-together', type: 'show_text', text: 'Bring the whole crew across the finish.', next: 'finish-done' },
          { id: 'finish-done', type: 'complete' },
        ],
      },
      hints: [],
    },
  ],
};

async function seedHunt() {
  const schema = await readFile(resolve(process.cwd(), 'database/v3.sql'), 'utf8');
  await getPool().query(schema);
  // This suite deliberately exercises several independent organizer browser
  // sessions. Clear only its known global login buckets in the disposable
  // database so repeated local runs cannot inherit an earlier run's throttle.
  await getPool().query('delete from hunt_v3.rate_limits where key=any($1::text[])', [organizerRateLimitKeys]);
  const fairness = validateFairness(definition);
  expect(fairness.valid, JSON.stringify(fairness.issues)).toBeTruthy();
  const contentHash = createHash('sha256').update(JSON.stringify(definition)).digest('hex');
  await getPool().query(
    `insert into hunt_v3.hunts(
      id,title,slug,status,registration_mode,registration_open,latest_version,settings)
      values($1,$2,$3,'live','self_serve',true,1,$4)`,
    [huntId, huntTitle, huntId, definition.settings],
  );
  await getPool().query(
    `insert into hunt_v3.hunt_versions(
      hunt_id,version,definition,content_hash,validation_report,fairness_report,published_by)
      values($1,1,$2,$3,$4,$5,'Playwright')`,
    [huntId, definition, contentHash, { valid: true, issues: [] }, fairness],
  );
  await getPool().query(
    `insert into hunt_v3.public_boards(
      hunt_id,slug,enabled,title,event_status,visible_columns,
      main_board_visible,replay_board_visible,team_name_mode)
      values($1,$2,true,$3,'live',$4,true,true,'display_name')`,
    [huntId, boardSlug, boardTitle, definition.settings.publicBoard.columns],
  );
}

async function removeSeededHunt() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('begin');
    // V3 history is intentionally append-only in production. This scoped test
    // teardown runs only against the disposable database guarded by the
    // Playwright configuration and temporarily suppresses those triggers.
    await client.query('set local session_replication_role = replica');
    const teamIds = (await client.query<{ id: string }>('select id from hunt_v3.teams where hunt_id=$1', [huntId])).rows.map(row => row.id);
    const runIds = (await client.query<{ id: string }>('select id from hunt_v3.runs where hunt_id=$1', [huntId])).rows.map(row => row.id);
    const memberIds = teamIds.length
      ? (await client.query<{ id: string }>('select id from hunt_v3.team_members where team_id=any($1::uuid[])', [teamIds])).rows.map(row => row.id)
      : [];

    if (runIds.length) {
      for (const table of [
        'recognition_overrides', 'recognition_results', 'recognition_votes',
        'run_contributions', 'score_ledger', 'run_events', 'run_members',
      ]) {
        await client.query(`delete from hunt_v3.${table} where run_id=any($1::uuid[])`, [runIds]);
      }
    }
    await client.query('delete from hunt_v3.media_uploads where hunt_id=$1', [huntId]);
    await client.query('delete from hunt_v3.media where hunt_id=$1', [huntId]);
    await client.query('delete from hunt_v3.help_requests where hunt_id=$1', [huntId]);
    await client.query('delete from hunt_v3.analytics_rollups where hunt_id=$1', [huntId]);
    await client.query('delete from hunt_v3.live_team_rollups where hunt_id=$1', [huntId]);
    await client.query('delete from hunt_v3.command_receipts where team_id=any($1::uuid[])', [teamIds]);
    await client.query('delete from hunt_v3.admin_events where hunt_id=$1', [huntId]);
    await client.query('delete from hunt_v3.messages where hunt_id=$1', [huntId]);
    if (teamIds.length) {
      await client.query('delete from hunt_v3.sessions where team_id=any($1::uuid[])', [teamIds]);
      await client.query('delete from hunt_v3.roster_claims where team_id=any($1::uuid[])', [teamIds]);
      await client.query('delete from hunt_v3.roster_claim_events where team_id=any($1::uuid[])', [teamIds]);
      await client.query('delete from hunt_v3.member_checkins where team_id=any($1::uuid[])', [teamIds]);
    }
    await client.query('delete from hunt_v3.runs where hunt_id=$1', [huntId]);
    if (memberIds.length) await client.query('delete from hunt_v3.team_members where id=any($1::uuid[])', [memberIds]);
    await client.query('delete from hunt_v3.teams where hunt_id=$1', [huntId]);
    await client.query('delete from hunt_v3.public_board_snapshots where hunt_id=$1', [huntId]);
    await client.query('delete from hunt_v3.public_boards where hunt_id=$1', [huntId]);
    await client.query('delete from hunt_v3.hunt_version_qr_secrets where hunt_id=$1', [huntId]);
    await client.query('delete from hunt_v3.drafts where hunt_id=$1', [huntId]);
    await client.query('delete from hunt_v3.hunt_versions where hunt_id=$1', [huntId]);
    await client.query('delete from hunt_v3.hunts where id=$1', [huntId]);
    await client.query('delete from hunt_v3.rate_limits where key like $1', [`%${huntId}%`]);
    await client.query('delete from hunt_v3.rate_limits where key=any($1::text[])', [organizerRateLimitKeys]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function disableNativeShareAndCaptureClipboard(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (globalThis as typeof globalThis & { __v3CopiedCaption?: string }).__v3CopiedCaption = value;
        },
      },
    });
  });
}

async function completeShortRun(page: Page, runNumber: number) {
  await expect(page.getByText(`Run ${runNumber}`, { exact: true }).first()).toBeVisible();
  await expect(page.locator('#current-task-heading')).toHaveText('Opening trail');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('#current-task-heading')).toHaveText('Crew finish');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'You found the finish.', exact: true })).toBeVisible();
}

test.beforeAll(async () => {
  await seedHunt();
});

test.afterAll(async () => {
  await removeSeededHunt();
});

test('mobile crew registers, replays, celebrates, shares, and stays private on the public board', async ({ page, browser }, testInfo) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(10_000);
  await disableNativeShareAndCaptureClipboard(page);

  await page.goto(`/v3?hunt=${huntId}`);
  await expect(page.getByLabel('Choose your hunt')).toHaveValue(huntId);
  await page.getByLabel('Team nickname').fill(teamName);
  await page.getByLabel('Your name', { exact: true }).fill('Alice');
  await page.getByLabel('Other crew members').fill('Bob');
  await page.locator('#v3-pin').fill('246824');
  await page.locator('#v3-member-pin').fill('111111');
  await page.getByRole('button', { name: 'Create crew', exact: true }).click();

  await expect(page.getByRole('heading', { name: new RegExp(`^T-\\d{3,} · ${teamName}$`) })).toBeVisible();
  await expect(page.getByText('Awaiting organizer approval', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your team is waiting for approval.', exact: true })).toBeVisible();
  await expect(page.getByText(/^(?:Alice, Bob|Bob, Alice)$/)).toBeVisible();
  await expect(page.getByText('1/2 checked in', { exact: true })).toBeVisible();
  const sessionResponse = await page.request.get('/api/v3/session');
  expect(sessionResponse.ok(), await sessionResponse.text()).toBeTruthy();
  const session = await sessionResponse.json();
  const teamCode = session.summary.team.code as string;

  const teammateContext: BrowserContext = await browser.newContext({ baseURL: origin });
  const teammate = await teammateContext.newPage();
  teammate.setDefaultTimeout(10_000);
  try {
    await teammate.goto(`/v3?hunt=${huntId}`);
    await teammate.getByRole('button', { name: 'Join a team', exact: true }).click();
    await teammate.getByLabel('Official team code').fill(teamCode);
    await teammate.getByLabel('Your name', { exact: true }).fill('Bob');
    await teammate.locator('#v3-pin').fill('246824');
    await teammate.locator('#v3-member-pin').fill('222222');
    await teammate.getByRole('button', { name: 'Join this crew', exact: true }).click();
    await expect(teammate.getByText('Playing as Bob', { exact: false })).toBeVisible();
    await expect(teammate.getByText('2/2 checked in', { exact: true })).toBeVisible();
  } finally {
    await teammateContext.close();
  }

  const approvalContext: BrowserContext = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } });
  const approvalPage = await approvalContext.newPage();
  approvalPage.setDefaultTimeout(10_000);
  try {
    await approvalPage.goto('/v3/admin');
    await approvalPage.getByLabel('Organizer password').fill('browser-test-password-only');
    await approvalPage.getByRole('button', { name: 'Open command centre', exact: true }).click();
    await approvalPage.getByLabel('Event').selectOption(huntId);
    await expect(approvalPage.getByText(/self-serve registration proves a team PIN, not one human per team/i)).toBeVisible();
    const teamRow = approvalPage.getByRole('row').filter({ hasText: teamCode });
    await expect(teamRow.getByText('Approval pending', { exact: true })).toBeVisible();
    await teamRow.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(approvalPage.getByRole('heading', { name: 'Approve this team?', exact: true })).toBeVisible();
    await approvalPage.getByLabel('Required audit reason').fill('Roster and identity confirmed in the mobile journey');
    await approvalPage.getByRole('button', { name: 'Approve team', exact: true }).click();
    await expect(approvalPage.getByText(`${teamCode} approved for competition.`, { exact: true })).toBeVisible();
  } finally {
    await approvalContext.close();
  }

  await page.reload();
  await expect(page.getByText('2/2 checked in', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start Run 1', exact: true }).click();

  const recoveryContext: BrowserContext = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } });
  const recoveryPage = await recoveryContext.newPage();
  recoveryPage.setDefaultTimeout(10_000);
  try {
    await recoveryPage.goto('/v3/admin');
    await recoveryPage.getByLabel('Organizer password').fill('browser-test-password-only');
    await recoveryPage.getByRole('button', { name: 'Open command centre', exact: true }).click();
    await recoveryPage.getByLabel('Event').selectOption(huntId);
    const activeTeamRow = recoveryPage.getByRole('row').filter({ hasText: teamCode });
    await expect(activeTeamRow.getByText('Run 1', { exact: true })).toBeVisible();
    await activeTeamRow.getByRole('button', { name: 'Recover', exact: true }).click();
    const recoveryDialog = recoveryPage.getByRole('dialog', { name: 'Audited run recovery' });
    await expect(recoveryDialog).toBeVisible();
    await expect(recoveryDialog).toContainText('open-trail');
    await expect(recoveryDialog.getByRole('button', { name: 'Add 5 minutes', exact: true })).toBeVisible();
    await expect(recoveryDialog.getByRole('button', { name: 'Reset current task', exact: true })).toHaveCount(0);
    await expect(recoveryDialog.getByRole('button', { name: 'Approve organizer gate', exact: true })).toHaveCount(0);
    await recoveryDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  } finally {
    await recoveryContext.close();
  }

  await completeShortRun(page, 1);

  await expect(page.getByRole('heading', { name: 'Want to beat your best?', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start another run', exact: true })).toBeVisible();
  const crewBoard = page.getByRole('region', { name: 'Crew Contribution Board' });
  await expect(crewBoard).toBeVisible();
  await expect(crewBoard.getByRole('button', { name: 'Alice', exact: true })).toHaveCount(0);
  await crewBoard.getByRole('button', { name: /Crew Energy/ }).click();
  await crewBoard.getByRole('button', { name: 'Bob', exact: true }).click();
  await crewBoard.getByRole('button', { name: 'Helping Hand', exact: true }).click();
  await crewBoard.getByRole('button', { name: 'Save private kudos', exact: true }).click();
  await expect(crewBoard.getByText('Your crew kudos is saved.', { exact: true })).toBeVisible();
  await expect(crewBoard.getByText(/Bob · Helping Hand/)).toBeVisible();
  const captureScreenshots = process.env.V3_CAPTURE_SCREENSHOTS === '1' && testInfo.project.name === 'android-chrome';
  const screenshotDirectory = resolve(process.cwd(), 'docs/screenshots');
  if (captureScreenshots) {
    await mkdir(screenshotDirectory, { recursive: true });
    await page.locator('nextjs-portal').evaluateAll(elements => elements.forEach(element => element.remove()));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: resolve(screenshotDirectory, 'v3-player-finish-mobile.png') });
    await crewBoard.evaluate(element => window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 24 }));
    await page.screenshot({ path: resolve(screenshotDirectory, 'v3-player-crew-board-mobile.png') });
  }

  await page.getByRole('button', { name: 'Share story', exact: true }).click();
  await expect(page.getByText('Sharing is not available in this browser. Use Download image or Copy caption below.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Copy caption', exact: true }).click();
  await expect(page.getByText('Caption copied.', { exact: true })).toBeVisible();
  const copiedCaption = await page.evaluate(() =>
    (globalThis as typeof globalThis & { __v3CopiedCaption?: string }).__v3CopiedCaption,
  );
  expect(copiedCaption).toContain(`${teamCode} · ${teamName} finished ${huntTitle} with 20 points at rank #1.`);
  expect(copiedCaption).toContain('@mobilehunt');
  expect(copiedCaption).toContain('#MobileReplay');
  expect(copiedCaption).toContain(`${origin}/board/${boardSlug}`);

  await page.getByRole('button', { name: 'Start another run', exact: true }).click();
  await completeShortRun(page, 2);
  await page.getByRole('button', { name: 'Replay board', exact: true }).click();
  await expect(page.getByText('Replay board locked.', { exact: true })).toHaveCount(0);
  await expect(page.getByText('2 runs', { exact: true })).toBeVisible();

  const publicContext = await browser.newContext({ baseURL: origin });
  const publicPage = await publicContext.newPage();
  publicPage.setDefaultTimeout(10_000);
  try {
    const response = await publicContext.request.get(`/api/v3/public-board/${boardSlug}`);
    expect(response.ok(), await response.text()).toBeTruthy();
    const publicJson = await response.text();
    expect(publicJson).toContain(teamCode);
    expect(publicJson).toContain(teamName);
    expect(publicJson).not.toContain('Alice');
    expect(publicJson).not.toContain('Bob');
    expect(publicJson).not.toContain('Helping Hand');
    expect(publicJson).not.toContain('helping_hand');
    expect(publicJson).not.toContain('memberId');
    expect(publicJson).not.toContain('recognition');

    await publicPage.goto(`/board/${boardSlug}`);
    await expect(publicPage.getByRole('heading', { name: boardTitle, exact: true })).toBeVisible();
    const teamResult = publicPage.getByRole('article', { name: new RegExp(teamCode) });
    await expect(teamResult).toBeVisible();
    await expect(teamResult).toContainText(teamName);
    await expect(teamResult.getByText('Points', { exact: true })).toBeVisible();
    await expect(teamResult.getByText('20', { exact: true })).toBeVisible();
    await expect(teamResult.getByText('Runs', { exact: true })).toBeVisible();
    await expect(teamResult.getByText('2', { exact: true })).toBeVisible();
    await expect(teamResult.getByText('Time', { exact: true })).toBeVisible();
    await expect(teamResult.getByText(/^completed$/i)).toBeVisible();
    await expect(publicPage.getByText('Alice', { exact: true })).toHaveCount(0);
    await expect(publicPage.getByText('Bob', { exact: true })).toHaveCount(0);
    await expect(publicPage.getByText('Helping Hand', { exact: true })).toHaveCount(0);
    await expect(publicPage.getByText('Team results only · player names and private recognition stay private', { exact: true })).toBeVisible();
    if (captureScreenshots) {
      await publicPage.locator('nextjs-portal').evaluateAll(elements => elements.forEach(element => element.remove()));
      await publicPage.screenshot({ path: resolve(screenshotDirectory, 'v3-public-board.png'), fullPage: true });
    }
  } finally {
    await publicContext.close();
  }

  if (captureScreenshots) {
    const adminContext = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } });
    const adminPage = await adminContext.newPage();
    try {
      await adminPage.goto('/v3/admin');
      await adminPage.getByLabel('Organizer password').fill('browser-test-password-only');
      await adminPage.getByRole('button', { name: 'Open command centre', exact: true }).click();
      await expect(adminPage.getByRole('heading', { name: 'Live operations', exact: true })).toBeVisible();
      await expect(adminPage.getByText(new RegExp(teamName)).first()).toBeVisible();
      await adminPage.locator('nextjs-portal').evaluateAll(elements => elements.forEach(element => element.remove()));
      await adminPage.screenshot({ path: resolve(screenshotDirectory, 'v3-organizer-live-console.png'), fullPage: true });
    } finally {
      await adminContext.close();
    }
  }
});
