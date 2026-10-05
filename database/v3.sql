-- Treasure Hunt V3 schema.
--
-- Apply this file with the server database owner. The schema is deliberately
-- private: browsers and public database roles must never receive direct access.
-- V3 is isolated from hunt_v2 so rollout and rollback do not rewrite V2 data.

begin;

create schema if not exists hunt_v3;
revoke all on schema hunt_v3 from public;

-- Shared trigger helpers ----------------------------------------------------

create or replace function hunt_v3.touch_updated_at() returns trigger
language plpgsql
set search_path = hunt_v3, pg_temp
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create or replace function hunt_v3.reject_immutable_mutation() returns trigger
language plpgsql
set search_path = hunt_v3, pg_temp
as $$
begin
  raise exception '% is append-only; % is not allowed', tg_table_name, tg_op
    using errcode = '55000';
end;
$$;

-- Hunts and immutable published versions ----------------------------------

create table if not exists hunt_v3.hunts (
  id text primary key,
  title text not null check (length(title) between 1 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  status text not null default 'ready'
    check (status in ('ready', 'live', 'paused', 'ended', 'archived')),
  registration_mode text not null default 'self_serve'
    check (registration_mode in ('self_serve', 'organizer_assigned', 'rostered')),
  registration_open boolean not null default true,
  latest_version integer not null default 0 check (latest_version >= 0),
  lifecycle_revision integer not null default 1 check (lifecycle_revision > 0),
  -- Registration locks this row, consumes this value, then increments it.
  -- This avoids count/max races when allocating T-001, T-002, ... codes.
  next_team_number integer not null default 1 check (next_team_number > 0),
  settings jsonb not null default '{}'::jsonb
    check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists hunt_v3.hunt_versions (
  hunt_id text not null references hunt_v3.hunts(id),
  version integer not null check (version > 0),
  definition jsonb not null
    check (
      jsonb_typeof(definition) = 'object'
      and definition ->> 'schemaVersion' = '3'
    ),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  validation_report jsonb not null default '{}'::jsonb
    check (jsonb_typeof(validation_report) = 'object'),
  fairness_report jsonb not null
    check (
      jsonb_typeof(fairness_report) = 'object'
      and fairness_report @> '{"valid": true}'::jsonb
    ),
  published_by text,
  published_at timestamptz not null default now(),
  primary key (hunt_id, version),
  unique (hunt_id, content_hash)
);

-- V3 intentionally does not execute pre-integrity-policy publications. The
-- resolver still renders legacy summaries conservatively, but every version
-- that can own a run must carry a complete, validated policy explicitly.
create or replace function hunt_v3.has_complete_integrity_policy(definition jsonb) returns boolean
language sql
immutable
set search_path = hunt_v3, pg_temp
as $$
  select coalesce(
    jsonb_typeof(definition #> '{settings,integrityPolicy}')='object'
    and definition #>> '{settings,integrityPolicy,locationVerification}' in ('gps_only','gps_photo','gps_organizer','strict')
    and definition #>> '{settings,integrityPolicy,selfServeApproval}' in ('automatic','organizer')
    and definition #>> '{settings,integrityPolicy,rosterParticipation}' in ('flexible','freeze_at_run_start','flexible_fixed_scoring'),
    false
  )
$$;

create or replace function hunt_v3.require_complete_integrity_policy() returns trigger
language plpgsql
set search_path = hunt_v3, pg_temp
as $$
begin
  if not hunt_v3.has_complete_integrity_policy(new.definition) then
    raise exception 'Published V3 hunt versions require a complete integrityPolicy; create a clean V3 draft and republish'
      using errcode='23514', constraint='hunt_versions_integrity_policy_required';
  end if;
  return new;
end;
$$;

create or replace function hunt_v3.assert_run_integrity_policy_cutover() returns void
language plpgsql
set search_path = hunt_v3, pg_temp
as $$
declare
  affected_runs bigint;
begin
  select count(*) into affected_runs
  from hunt_v3.runs run
  join hunt_v3.hunt_versions version
    on version.hunt_id=run.hunt_id and version.version=run.hunt_version
  where not hunt_v3.has_complete_integrity_policy(version.definition);
  if affected_runs > 0 then
    raise exception 'V3 integrity-policy cutover blocked: % existing run(s) use a legacy or malformed published version. Back up the database, then clean-reimport and republish instead of rewriting immutable run history.', affected_runs
      using errcode='55000';
  end if;
end;
$$;

-- Generated QR and backup-code material is separated from authoring drafts so
-- external AI tooling never receives production secrets. Organizers may read
-- this immutable, version-scoped print manifest through an authenticated API.
create table if not exists hunt_v3.hunt_version_qr_secrets (
  hunt_id text not null,
  hunt_version integer not null,
  field_path text not null check (length(field_path) between 1 and 1000),
  group_path text not null check (length(group_path) between 1 and 1000),
  logical_name text not null check (length(logical_name) between 1 and 100),
  secret_kind text not null check (secret_kind in ('qr_token','backup_code')),
  secret_value text not null check (length(secret_value) between 8 and 500),
  created_at timestamptz not null default now(),
  primary key (hunt_id,hunt_version,field_path),
  foreign key (hunt_id,hunt_version) references hunt_v3.hunt_versions(hunt_id,version)
);

-- Imported or AI-assisted content always lands in an editable draft. A draft
-- is not a published version and may contain validation failures.
create table if not exists hunt_v3.drafts (
  id uuid primary key,
  hunt_id text references hunt_v3.hunts(id),
  title text not null check (length(title) between 1 and 160),
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  source text not null default 'builder'
    check (source in ('builder', 'json_import', 'template')),
  revision integer not null default 1 check (revision > 0),
  generation uuid not null,
  validation_report jsonb not null default '{}'::jsonb
    check (jsonb_typeof(validation_report) = 'object'),
  previewed_revision integer,
  previewed_generation uuid,
  previewed_session_hash text,
  previewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drafts_preview_receipt_complete check (
    (previewed_revision is null and previewed_generation is null and previewed_session_hash is null and previewed_at is null)
    or (previewed_revision = revision and previewed_generation = generation and previewed_session_hash ~ '^[0-9a-f]{64}$' and previewed_at is not null)
  )
);

-- Repeatable hardening for databases initialized from an earlier V3 draft.
alter table hunt_v3.drafts add column if not exists previewed_revision integer;
alter table hunt_v3.drafts add column if not exists previewed_generation uuid;
alter table hunt_v3.drafts add column if not exists previewed_session_hash text;
alter table hunt_v3.drafts add column if not exists previewed_at timestamptz;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='hunt_v3.drafts'::regclass and conname='drafts_preview_receipt_complete'
  ) then
    alter table hunt_v3.drafts add constraint drafts_preview_receipt_complete check (
      (previewed_revision is null and previewed_generation is null and previewed_session_hash is null and previewed_at is null)
      or (previewed_revision = revision and previewed_generation = generation and previewed_session_hash ~ '^[0-9a-f]{64}$' and previewed_at is not null)
    );
  end if;
end;
$$;

-- Persistent teams, members, claims, and sessions --------------------------

create table if not exists hunt_v3.teams (
  id uuid primary key,
  hunt_id text not null references hunt_v3.hunts(id),
  canonical_code text not null check (canonical_code ~ '^T-[0-9]{3,}$'),
  display_name text check (display_name is null or length(display_name) between 1 and 80),
  name_key text,
  name_status text not null default 'code_only'
    check (name_status in ('code_only', 'pending', 'approved', 'renamed', 'rejected')),
  pin_hash text not null check (length(pin_hash) >= 32),
  registration_source text not null
    check (registration_source in ('self_serve', 'organizer_assigned', 'roster_import')),
  -- Self-serve crews remain visible and may finish joining while awaiting an
  -- explicit competition approval. Operational suspension/disqualification is
  -- kept in status so restoring a team never silently changes its approval.
  approval_status text not null default 'approved'
    constraint teams_approval_status_valid check (approval_status in ('pending', 'approved')),
  -- Records whether self-serve approval was granted by policy or by a named
  -- organizer decision. This makes tightening a hunt from automatic to
  -- organizer approval fail closed for teams that have not been reviewed.
  approval_method text default 'organizer'
    constraint teams_approval_method_valid check (approval_method in ('automatic', 'organizer')),
  status text not null default 'active'
    check (status in ('active', 'disabled', 'disqualified', 'archived')),
  competition_revision integer not null default 1
    constraint teams_competition_revision_positive check (competition_revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hunt_id, canonical_code),
  unique (id, hunt_id),
  constraint teams_approval_state_consistent check (
    (approval_status='pending' and approval_method is null)
    or (approval_status='approved' and approval_method in ('automatic','organizer'))
  ),
  check (
    (display_name is null and name_key is null)
    or (display_name is not null and name_key is not null)
  )
);

-- Repeatable hardening for databases initialized before competition approval
-- became explicit. Existing organizer-approved V3 teams remain approved.
alter table hunt_v3.teams add column if not exists approval_status text not null default 'approved';
alter table hunt_v3.teams add column if not exists approval_method text default 'organizer';
alter table hunt_v3.teams add column if not exists competition_revision integer not null default 1;
update hunt_v3.teams set approval_method=null
where approval_status='pending' and approval_method is not null;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='hunt_v3.teams'::regclass and conname='teams_approval_method_valid'
  ) then
    alter table hunt_v3.teams add constraint teams_approval_method_valid
      check (approval_method in ('automatic', 'organizer'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='hunt_v3.teams'::regclass and conname='teams_approval_status_valid'
  ) then
    alter table hunt_v3.teams add constraint teams_approval_status_valid
      check (approval_status in ('pending', 'approved'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='hunt_v3.teams'::regclass and conname='teams_approval_state_consistent'
  ) then
    alter table hunt_v3.teams add constraint teams_approval_state_consistent check (
      (approval_status='pending' and approval_method is null)
      or (approval_status='approved' and approval_method in ('automatic','organizer'))
    );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='hunt_v3.teams'::regclass and conname='teams_competition_revision_positive'
  ) then
    alter table hunt_v3.teams add constraint teams_competition_revision_positive
      check (competition_revision > 0);
  end if;
end;
$$;

create unique index if not exists teams_hunt_name_key
  on hunt_v3.teams(hunt_id, name_key)
  where name_key is not null and name_status <> 'rejected';
create index if not exists teams_hunt_status
  on hunt_v3.teams(hunt_id, status, canonical_code);

create table if not exists hunt_v3.team_members (
  id uuid primary key,
  team_id uuid not null references hunt_v3.teams(id),
  name text not null check (length(name) between 1 and 100),
  name_key text not null,
  roster_key text,
  -- Individual proof protects contribution attribution. A self-serve member
  -- declared by someone else receives this hash on their first personal join.
  claim_pin_hash text check (claim_pin_hash is null or length(claim_pin_hash) >= 32),
  status text not null default 'active'
    check (status in ('rostered', 'active', 'inactive', 'removed')),
  claimed_at timestamptz,
  checked_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, name_key),
  unique (team_id, roster_key),
  unique (team_id, id)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'team_members_rostered_claim_pin_required'
      and conrelid = 'hunt_v3.team_members'::regclass
  ) then
    alter table hunt_v3.team_members
      add constraint team_members_rostered_claim_pin_required
      check (status <> 'rostered' or claim_pin_hash is not null);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'team_members_claimed_pin_required'
      and conrelid = 'hunt_v3.team_members'::regclass
  ) then
    alter table hunt_v3.team_members
      add constraint team_members_claimed_pin_required
      check (claimed_at is null or claim_pin_hash is not null);
  end if;
end;
$$;

create index if not exists team_members_team_status
  on hunt_v3.team_members(team_id, status);

create table if not exists hunt_v3.sessions (
  token_hash text primary key check (length(token_hash) >= 32),
  role text not null check (role in ('team', 'admin')),
  team_id uuid,
  member_id uuid,
  organizer_name text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  foreign key (team_id, member_id)
    references hunt_v3.team_members(team_id, id),
  constraint sessions_identity_unique unique (token_hash, team_id, member_id),
  check (
    (role = 'team' and team_id is not null and member_id is not null and organizer_name is null)
    or (role = 'admin' and team_id is null and member_id is null)
  )
);

create index if not exists sessions_expiry
  on hunt_v3.sessions(expires_at)
  where revoked_at is null;
create index if not exists sessions_member
  on hunt_v3.sessions(member_id)
  where member_id is not null and revoked_at is null;

create or replace function hunt_v3.revoke_disabled_team_sessions() returns trigger
language plpgsql
set search_path = hunt_v3, pg_temp
as $$
begin
  if old.status = 'active' and new.status <> 'active' then
    update hunt_v3.sessions
      set revoked_at = coalesce(revoked_at, clock_timestamp())
      where team_id = new.id and revoked_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists teams_revoke_sessions_on_status on hunt_v3.teams;
create trigger teams_revoke_sessions_on_status
after update of status on hunt_v3.teams
for each row execute function hunt_v3.revoke_disabled_team_sessions();

create table if not exists hunt_v3.roster_claims (
  id uuid primary key,
  team_id uuid not null,
  member_id uuid not null,
  session_token_hash text,
  claim_method text not null
    check (claim_method in ('team_pin', 'member_pin', 'organizer', 'import')),
  status text not null default 'active'
    check (status in ('active', 'released', 'revoked')),
  claimed_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by text,
  reason text,
  foreign key (team_id, member_id)
    references hunt_v3.team_members(team_id, id),
  constraint roster_claims_session_identity_fk foreign key (session_token_hash, team_id, member_id)
    references hunt_v3.sessions(token_hash, team_id, member_id) on delete set null (session_token_hash),
  check ((status = 'active' and ended_at is null) or status <> 'active')
);

create unique index if not exists roster_claims_one_active
  on hunt_v3.roster_claims(member_id)
  where status = 'active';

-- Registration/claim actions are recorded separately from the current claim
-- row so organizer audits never depend on mutable current-state fields.
create table if not exists hunt_v3.roster_claim_events (
  id bigint generated always as identity primary key,
  team_id uuid not null,
  member_id uuid not null,
  action text not null check (action in ('claimed', 'released', 'revoked')),
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (team_id, member_id)
    references hunt_v3.team_members(team_id, id)
);

create index if not exists roster_claim_events_member_time
  on hunt_v3.roster_claim_events(member_id, created_at desc);

-- Check-in history is append-only. team_members.checked_in_at is a live-query
-- cache populated by the trigger below and does not replace this audit trail.
create table if not exists hunt_v3.member_checkins (
  id bigint generated always as identity primary key,
  team_id uuid not null,
  member_id uuid not null,
  action text not null check (action in ('check_in', 'check_out')),
  actor_kind text not null check (actor_kind in ('member', 'organizer', 'system')),
  actor_member_id uuid,
  method text not null default 'manual'
    check (method in ('manual', 'claim', 'import', 'scan')),
  reason text,
  occurred_at timestamptz not null default now(),
  foreign key (team_id, member_id)
    references hunt_v3.team_members(team_id, id),
  foreign key (team_id, actor_member_id)
    references hunt_v3.team_members(team_id, id),
  check (
    (actor_kind = 'member' and actor_member_id is not null)
    or (actor_kind <> 'member' and actor_member_id is null)
  )
);

create index if not exists member_checkins_member_time
  on hunt_v3.member_checkins(member_id, occurred_at desc);

create table if not exists hunt_v3.messages (
  id uuid primary key,
  hunt_id text not null references hunt_v3.hunts(id),
  team_id uuid,
  message text not null check (length(message) between 1 and 2000),
  created_by text not null check (length(created_by) between 1 and 120),
  created_at timestamptz not null default now(),
  foreign key (team_id, hunt_id) references hunt_v3.teams(id, hunt_id)
);

create index if not exists messages_hunt_team_time
  on hunt_v3.messages(hunt_id, team_id, created_at desc);

-- A run is an immutable seeded attempt around a mutable authoritative engine
-- state. A replay inserts a new row; it never resets an earlier run.
create table if not exists hunt_v3.runs (
  id uuid primary key,
  team_id uuid not null,
  hunt_id text not null,
  hunt_version integer not null,
  run_number integer not null check (run_number > 0),
  private_seed text not null check (length(private_seed) between 32 and 512),
  seed_commitment text not null check (seed_commitment ~ '^[0-9a-f]{64}$'),
  -- Private structural-plan identity used by the balanced allocator. It is not
  -- included in player/public projections.
  plan_key text not null default (md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text))
    constraint runs_plan_key_digest check (plan_key ~ '^[0-9a-f]{64}$'),
  allocation_cycle integer not null default 0 constraint runs_allocation_cycle_nonnegative check (allocation_cycle >= 0),
  route_plan jsonb not null check (jsonb_typeof(route_plan) = 'object'),
  resolved_variables jsonb not null default '{}'::jsonb
    check (jsonb_typeof(resolved_variables) = 'object'),
  engine_state jsonb not null check (jsonb_typeof(engine_state) = 'object'),
  status text not null default 'waiting'
    check (status in ('waiting', 'active', 'completed', 'abandoned', 'disqualified')),
  practice boolean not null default false,
  eligible boolean not null default true,
  ineligibility_reason text,
  score integer not null default 0,
  bonus_score integer not null default 0,
  progress numeric(7,4) not null default 0 check (progress between 0 and 1),
  current_checkpoint_id text,
  recognition_closes_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  elapsed_ms bigint check (elapsed_ms is null or elapsed_ms >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (team_id, hunt_id)
    references hunt_v3.teams(id, hunt_id),
  foreign key (hunt_id, hunt_version)
    references hunt_v3.hunt_versions(hunt_id, version),
  unique (team_id, run_number),
  constraint runs_hunt_seed_commitment_unique unique (hunt_id, seed_commitment),
  -- Historical official and practice allocations occupy separate namespaces
  -- so migrated rows cannot collide. The service treats practice as a
  -- one-way boundary and never creates a later official row for that team.
  constraint runs_team_plan_cycle_unique unique (team_id, hunt_version, plan_key, allocation_cycle, practice),
  unique (team_id, id),
  unique (hunt_id, id),
  check (not (practice and eligible)),
  check ((eligible and ineligibility_reason is null) or not eligible),
  check (completed_at is null or (started_at is not null and completed_at >= started_at)),
  constraint runs_completed_timing_required
    check (status <> 'completed' or (completed_at is not null and elapsed_ms is not null))
);

-- V3 is not runtime-compatible with pre-cutover attempts, but keep migration
-- repeatable for disposable databases created from an earlier V3 draft.
alter table hunt_v3.runs add column if not exists plan_key text;
alter table hunt_v3.runs add column if not exists allocation_cycle integer not null default 0;
alter table hunt_v3.runs alter column plan_key set default (md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text));
update hunt_v3.runs
set plan_key = md5(route_plan::text || id::text) || md5(id::text || route_plan::text)
where plan_key is null;
alter table hunt_v3.runs alter column plan_key set not null;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='hunt_v3.runs'::regclass and conname='runs_plan_key_digest'
  ) then
    alter table hunt_v3.runs add constraint runs_plan_key_digest check(plan_key ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='hunt_v3.runs'::regclass and conname='runs_allocation_cycle_nonnegative'
  ) then
    alter table hunt_v3.runs add constraint runs_allocation_cycle_nonnegative check(allocation_cycle >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='hunt_v3.runs'::regclass and conname='runs_hunt_seed_commitment_unique'
  ) then
    alter table hunt_v3.runs add constraint runs_hunt_seed_commitment_unique
      unique(hunt_id,seed_commitment);
  end if;
  if exists (
    select 1 from pg_constraint
    where conrelid='hunt_v3.runs'::regclass
      and conname='runs_team_plan_cycle_unique'
      and position('practice' in lower(pg_get_constraintdef(oid)))=0
  ) then
    alter table hunt_v3.runs drop constraint runs_team_plan_cycle_unique;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='hunt_v3.runs'::regclass and conname='runs_team_plan_cycle_unique'
  ) then
    alter table hunt_v3.runs add constraint runs_team_plan_cycle_unique
      unique(team_id,hunt_version,plan_key,allocation_cycle,practice);
  end if;
end;
$$;

-- Fail the migration before the application can serve any pre-policy run.
-- This is deliberately a clean cutover: old V3 attempts and leaderboards are
-- not silently reinterpreted under new organizer choices.
select hunt_v3.assert_run_integrity_policy_cutover();

create unique index if not exists runs_one_open_per_team
  on hunt_v3.runs(team_id)
  where status in ('waiting', 'active');
create index if not exists runs_hunt_live
  on hunt_v3.runs(hunt_id, status, updated_at desc);
create index if not exists runs_team_history
  on hunt_v3.runs(team_id, run_number desc);
create index if not exists runs_plan_allocation
  on hunt_v3.runs(hunt_id, hunt_version, plan_key, created_at);
create index if not exists runs_official_leaderboard
  on hunt_v3.runs(hunt_id, score desc, elapsed_ms asc, completed_at asc)
  where status = 'completed' and eligible and not practice;
create index if not exists runs_official_team_best
  on hunt_v3.runs(hunt_id, team_id, score desc, elapsed_ms asc, completed_at asc, id asc)
  include (run_number, progress)
  where status = 'completed' and eligible and not practice;
create index if not exists runs_official_team_first
  on hunt_v3.runs(hunt_id, team_id, run_number asc, completed_at asc, id asc)
  include (score, elapsed_ms)
  where status = 'completed' and eligible and not practice;

-- Live event support -------------------------------------------------------

create table if not exists hunt_v3.help_requests (
  id uuid primary key,
  hunt_id text not null references hunt_v3.hunts(id),
  team_id uuid not null,
  run_id uuid,
  member_id uuid not null,
  checkpoint_id text,
  node_id text,
  kind text not null check (kind in ('help', 'camera', 'gps', 'network', 'puzzle', 'photo')),
  message text not null check (length(message) between 1 and 1000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  response text check (response is null or length(response) <= 2000),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  foreign key (team_id, hunt_id) references hunt_v3.teams(id, hunt_id),
  foreign key (team_id, run_id) references hunt_v3.runs(team_id, id),
  foreign key (team_id, member_id) references hunt_v3.team_members(team_id, id),
  check ((status = 'open' and resolved_at is null) or status = 'resolved')
);

create index if not exists help_requests_live
  on hunt_v3.help_requests(hunt_id, status, created_at);

-- Run participants include the starting roster plus late participants when
-- the pinned hunt policy permits them. Fixed-scoring late participants can
-- play and celebrate an eligible teammate, but cannot receive contribution
-- credit, a peer vote, or a recognition result for that attempt. This
-- table is included in the append-only trigger set below, so its snapshot
-- identity, joined time, and contribution eligibility cannot be promoted or
-- rewritten after insertion.
create table if not exists hunt_v3.run_members (
  run_id uuid not null,
  team_id uuid not null,
  member_id uuid not null,
  member_name_snapshot text not null check (length(member_name_snapshot) between 1 and 100),
  contribution_eligible boolean not null default true,
  joined_run_at timestamptz not null default now(),
  primary key (run_id, member_id),
  foreign key (team_id, run_id)
    references hunt_v3.runs(team_id, id),
  foreign key (team_id, member_id)
    references hunt_v3.team_members(team_id, id)
);

alter table hunt_v3.run_members
  add column if not exists contribution_eligible boolean not null default true;

-- Accepted actions and scoring ---------------------------------------------

create table if not exists hunt_v3.run_events (
  id bigint generated always as identity primary key,
  run_id uuid not null,
  team_id uuid not null,
  revision integer not null check (revision >= 0),
  ordinal integer not null check (ordinal > 0),
  request_id uuid,
  actor_kind text not null check (actor_kind in ('member', 'organizer', 'system')),
  actor_member_id uuid,
  event_type text not null check (length(event_type) between 1 and 100),
  checkpoint_id text,
  node_id text,
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  foreign key (team_id, run_id)
    references hunt_v3.runs(team_id, id),
  foreign key (team_id, actor_member_id)
    references hunt_v3.team_members(team_id, id),
  foreign key (run_id, actor_member_id)
    references hunt_v3.run_members(run_id, member_id),
  unique (run_id, revision, ordinal),
  unique (run_id, id),
  check (
    (actor_kind = 'member' and actor_member_id is not null)
    or (actor_kind <> 'member' and actor_member_id is null)
  )
);

create index if not exists run_events_type_time
  on hunt_v3.run_events(run_id, event_type, occurred_at);
create index if not exists run_events_actor_time
  on hunt_v3.run_events(actor_member_id, occurred_at)
  where actor_member_id is not null;
create index if not exists run_events_request
  on hunt_v3.run_events(run_id, request_id, revision, ordinal)
  where request_id is not null;

create table if not exists hunt_v3.score_ledger (
  id bigint generated always as identity primary key,
  run_id uuid not null,
  team_id uuid not null,
  source_event_id bigint,
  source_key text not null,
  category text not null check (length(category) between 1 and 80),
  amount integer not null check (amount <> 0),
  counts_for_ranking boolean not null default true,
  reason text not null,
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (team_id, run_id)
    references hunt_v3.runs(team_id, id),
  foreign key (run_id, source_event_id)
    references hunt_v3.run_events(run_id, id),
  unique (run_id, source_key),
  constraint score_ledger_source_key_length check (length(source_key) between 1 and 512),
  constraint score_ledger_reason_length check (length(reason) between 1 and 1000)
);

create index if not exists score_ledger_run_time
  on hunt_v3.score_ledger(run_id, created_at, id);

-- Earlier V3 drafts used limits below the engine's valid maximum semantic key
-- and organizer/dud reason lengths. Preserve complete keys: truncation would
-- break append-only idempotency and could merge distinct score sources.
alter table hunt_v3.score_ledger drop constraint if exists score_ledger_source_key_check;
alter table hunt_v3.score_ledger drop constraint if exists score_ledger_reason_check;
alter table hunt_v3.score_ledger drop constraint if exists score_ledger_source_key_length;
alter table hunt_v3.score_ledger drop constraint if exists score_ledger_reason_length;
alter table hunt_v3.score_ledger
  add constraint score_ledger_source_key_length check (length(source_key) between 1 and 512) not valid;
alter table hunt_v3.score_ledger
  add constraint score_ledger_reason_length check (length(reason) between 1 and 1000) not valid;
alter table hunt_v3.score_ledger validate constraint score_ledger_source_key_length;
alter table hunt_v3.score_ledger validate constraint score_ledger_reason_length;

-- Positive-only, server-calculated credit. Failed attempts remain available
-- in private run_events but cannot become a negative member label.
create table if not exists hunt_v3.run_contributions (
  id bigint generated always as identity primary key,
  run_id uuid not null,
  team_id uuid not null,
  member_id uuid not null,
  source_event_id bigint,
  source_key text not null check (length(source_key) between 1 and 180),
  category text not null check (length(category) between 1 and 80),
  credit numeric(12,3) not null check (credit > 0),
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (team_id, run_id)
    references hunt_v3.runs(team_id, id),
  foreign key (team_id, member_id)
    references hunt_v3.team_members(team_id, id),
  foreign key (run_id, member_id)
    references hunt_v3.run_members(run_id, member_id),
  foreign key (run_id, source_event_id)
    references hunt_v3.run_events(run_id, id),
  unique (run_id, member_id, source_key)
);

create index if not exists run_contributions_member_category
  on hunt_v3.run_contributions(run_id, member_id, category);

-- Media evidence -----------------------------------------------------------

-- Assets are hunt-scoped; player photos are bound to the authenticated run
-- participant who uploaded them. Approval/rejection is organizer-controlled
-- and should also append a run/admin event for the human-readable audit.
create table if not exists hunt_v3.media (
  id uuid primary key,
  hunt_id text not null references hunt_v3.hunts(id),
  team_id uuid,
  run_id uuid,
  member_id uuid,
  checkpoint_id text,
  node_id text,
  parallel_mechanic_id text,
  parallel_lane_id text,
  kind text not null check (kind in ('asset', 'photo')),
  content_type text not null check (length(content_type) between 3 and 120),
  bytes integer not null check (bytes > 0),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  storage_key text not null unique check (length(storage_key) between 1 and 500),
  review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'rejected')),
  review_reason text,
  retention text not null default 'after_review'
    check (retention in ('after_review', 'after_event', 'keep')),
  created_at timestamptz not null default now(),
  -- Upload time is not gameplay time. This is set only when the engine accepts
  -- submit_photo or a parallel lane first enters pending review.
  submitted_at timestamptz,
  reviewed_at timestamptz,
  expires_at timestamptz,
  -- Immutable epoch of the exact action instance that accepted this evidence.
  -- Resetting the same authored node creates a new epoch, so bytes prepared
  -- before the reset cannot be attached to the replacement task.
  task_started_at timestamptz,
  foreign key (team_id, hunt_id)
    references hunt_v3.teams(id, hunt_id),
  foreign key (team_id, run_id)
    references hunt_v3.runs(team_id, id),
  foreign key (team_id, member_id)
    references hunt_v3.team_members(team_id, id),
  foreign key (run_id, member_id)
    references hunt_v3.run_members(run_id, member_id),
  check (
    (kind = 'asset' and team_id is null and run_id is null and member_id is null and task_started_at is null)
    or (kind = 'photo' and team_id is not null and run_id is not null and member_id is not null and task_started_at is not null)
  ),
  check (
    (parallel_mechanic_id is null and parallel_lane_id is null)
    or (kind = 'photo' and parallel_mechanic_id is not null and parallel_lane_id is not null)
  ),
  check (
    (review_status = 'pending' and reviewed_at is null)
    or (review_status <> 'pending' and reviewed_at is not null)
  )
);

alter table hunt_v3.media add column if not exists submitted_at timestamptz;
alter table hunt_v3.media add column if not exists task_started_at timestamptz;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'media_submission_after_upload'
      and conrelid = 'hunt_v3.media'::regclass
  ) then
    alter table hunt_v3.media add constraint media_submission_after_upload
      check (submitted_at is null or submitted_at >= created_at);
  end if;
end;
$$;

create index if not exists media_run_review
  on hunt_v3.media(run_id, review_status, created_at)
  where kind = 'photo';
create index if not exists media_submitted_review
  on hunt_v3.media(hunt_id, submitted_at)
  where kind = 'photo' and review_status = 'pending' and submitted_at is not null;
create index if not exists media_expiry
  on hunt_v3.media(expires_at)
  where expires_at is not null;

-- Keep only the non-reversible digest and ownership coordinates after media
-- retention deletes the underlying photo. This prevents the same exact file
-- from being recycled by another team or run later in the event.
create table if not exists hunt_v3.photo_evidence_hashes (
  hunt_id text not null references hunt_v3.hunts(id),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  media_id uuid not null,
  team_id uuid not null,
  run_id uuid not null,
  created_at timestamptz not null default now(),
  constraint photo_evidence_hashes_hunt_content_key primary key (hunt_id, content_hash),
  constraint photo_evidence_hashes_media_key unique (media_id)
);

-- Upgrade existing V3 databases before the insert trigger is installed. If an
-- early database already contains duplicate evidence, the oldest row owns the
-- durable digest and every future reuse is rejected.
insert into hunt_v3.photo_evidence_hashes(hunt_id,content_hash,media_id,team_id,run_id,created_at)
select distinct on (hunt_id,content_hash) hunt_id,content_hash,id,team_id,run_id,created_at
from hunt_v3.media
where kind='photo'
order by hunt_id,content_hash,created_at,id
on conflict do nothing;

create or replace function hunt_v3.reserve_photo_evidence_hash() returns trigger
language plpgsql
set search_path = hunt_v3, pg_temp
as $$
declare
  reserved_media_id uuid;
  reserved_team_id uuid;
  reserved_run_id uuid;
begin
  if new.kind <> 'photo' then
    return new;
  end if;
  insert into hunt_v3.photo_evidence_hashes(hunt_id,content_hash,media_id,team_id,run_id,created_at)
  values(new.hunt_id,new.content_hash,new.id,new.team_id,new.run_id,new.created_at)
  on conflict do nothing;
  select media_id,team_id,run_id into reserved_media_id,reserved_team_id,reserved_run_id
  from hunt_v3.photo_evidence_hashes
  where hunt_id=new.hunt_id and content_hash=new.content_hash;
  if reserved_media_id is distinct from new.id
    or reserved_team_id is distinct from new.team_id
    or reserved_run_id is distinct from new.run_id then
    raise exception 'This exact photo was already used in this hunt'
      using errcode='23505', constraint='photo_evidence_hashes_hunt_content_key';
  end if;
  return new;
end;
$$;

drop trigger if exists media_reserve_photo_evidence_hash on hunt_v3.media;
create trigger media_reserve_photo_evidence_hash
after insert on hunt_v3.media
for each row execute function hunt_v3.reserve_photo_evidence_hash();

-- Deletion work survives removal of the metadata row and transient storage
-- provider failures. Maintenance deletes queue rows only after object removal.
create table if not exists hunt_v3.media_deletions (
  storage_key text primary key,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Direct-upload receipts outlive short-lived provider upload tokens so a late
-- replay can be recognized and its temporary object cleaned up safely.
create table if not exists hunt_v3.media_uploads (
  id uuid primary key,
  owner_key text not null check (length(owner_key) between 1 and 240),
  hunt_id text not null references hunt_v3.hunts(id),
  team_id uuid,
  run_id uuid,
  member_id uuid,
  kind text not null check (kind in ('asset', 'photo')),
  storage_key text not null unique check (length(storage_key) between 1 and 500),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null check (jsonb_typeof(metadata) = 'object'),
  media_id uuid references hunt_v3.media(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  cleanup_after timestamptz not null default now() + interval '125 minutes',
  completed_at timestamptz,
  foreign key (team_id, hunt_id)
    references hunt_v3.teams(id, hunt_id),
  foreign key (team_id, run_id)
    references hunt_v3.runs(team_id, id),
  foreign key (team_id, member_id)
    references hunt_v3.team_members(team_id, id),
  foreign key (run_id, member_id)
    references hunt_v3.run_members(run_id, member_id),
  check (cleanup_after >= expires_at),
  constraint media_uploads_media_identity check (media_id is null or media_id = id),
  constraint media_uploads_completion_timestamp check (media_id is null or completed_at is not null),
  check (
    (kind = 'asset' and team_id is null and run_id is null and member_id is null)
    or (kind = 'photo' and team_id is not null and run_id is not null and member_id is not null)
  )
);

-- V3 is not a compatibility runtime, but keep the additive schema repeatable
-- for development databases created before task epochs were persisted. Direct
-- receipts retain the exact epoch; older multipart rows use their immutable
-- upload time and remain subject to the normal active-task checks on submit.
update hunt_v3.media media
set task_started_at=coalesce(
  (
    select (upload.metadata->>'taskStartedAt')::timestamptz
    from hunt_v3.media_uploads upload
    where upload.id=media.id
      and upload.metadata->>'taskStartedAt' is not null
    limit 1
  ),
  media.created_at
)
where media.kind='photo' and media.task_started_at is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'media_task_started_at_required'
      and conrelid = 'hunt_v3.media'::regclass
  ) then
    alter table hunt_v3.media add constraint media_task_started_at_required
      check (
        (kind='asset' and task_started_at is null)
        or (kind='photo' and task_started_at is not null)
      );
  end if;
end;
$$;

create index if not exists media_uploads_cleanup
  on hunt_v3.media_uploads(cleanup_after);

create or replace function hunt_v3.queue_media_deletion() returns trigger
language plpgsql
set search_path = hunt_v3, pg_temp
as $$
begin
  insert into hunt_v3.media_deletions(storage_key)
  values (old.storage_key)
  on conflict (storage_key) do nothing;
  return old;
end;
$$;

drop trigger if exists queue_media_deletion on hunt_v3.media;
create trigger queue_media_deletion
after delete on hunt_v3.media
for each row execute function hunt_v3.queue_media_deletion();

-- Private recognition ------------------------------------------------------

-- Ballot edits append a new revision that points at the prior revision. Raw
-- ballots are never updated, so the organizer retains a named audit trail.
create table if not exists hunt_v3.recognition_votes (
  id bigint generated always as identity primary key,
  run_id uuid not null,
  team_id uuid not null,
  voter_member_id uuid not null,
  recipient_member_id uuid not null,
  revision integer not null check (revision > 0),
  supersedes_vote_id bigint,
  category text,
  subtype text,
  answer_path jsonb not null default '[]'::jsonb
    check (jsonb_typeof(answer_path) = 'array'),
  is_withdrawal boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (team_id, run_id)
    references hunt_v3.runs(team_id, id),
  foreign key (team_id, voter_member_id)
    references hunt_v3.team_members(team_id, id),
  foreign key (team_id, recipient_member_id)
    references hunt_v3.team_members(team_id, id),
  foreign key (run_id, voter_member_id)
    references hunt_v3.run_members(run_id, member_id),
  foreign key (run_id, recipient_member_id)
    references hunt_v3.run_members(run_id, member_id),
  unique (run_id, voter_member_id, revision),
  unique (run_id, voter_member_id, id),
  foreign key (run_id, voter_member_id, supersedes_vote_id)
    references hunt_v3.recognition_votes(run_id, voter_member_id, id),
  check (voter_member_id <> recipient_member_id),
  check (
    (is_withdrawal and category is null and subtype is null)
    or (
      not is_withdrawal
      and category is not null and length(category) between 1 and 80
      and subtype is not null and length(subtype) between 1 and 80
    )
  )
);

create index if not exists recognition_votes_recipient
  on hunt_v3.recognition_votes(run_id, recipient_member_id, created_at);

-- Results are versioned instead of overwritten. The latest revision is the
-- calculated result before applying the latest organizer override.
create table if not exists hunt_v3.recognition_results (
  id bigint generated always as identity primary key,
  run_id uuid not null,
  team_id uuid not null,
  member_id uuid not null,
  revision integer not null check (revision > 0),
  headline_title text not null check (length(headline_title) between 1 and 100),
  data_title text not null check (length(data_title) between 1 and 100),
  peer_title text check (peer_title is null or length(peer_title) between 1 and 100),
  evidence_summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence_summary) = 'object'),
  peer_summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(peer_summary) = 'object'),
  contribution_score numeric(12,3) not null default 0 check (contribution_score >= 0),
  peer_score numeric(12,3) not null default 0 check (peer_score >= 0),
  server_weight numeric(4,3) not null default 0.700
    check (server_weight between 0 and 1),
  peer_weight numeric(4,3) not null default 0.300
    check (peer_weight between 0 and 1),
  calculation_version text not null check (length(calculation_version) between 1 and 40),
  created_at timestamptz not null default now(),
  foreign key (team_id, run_id)
    references hunt_v3.runs(team_id, id),
  foreign key (team_id, member_id)
    references hunt_v3.team_members(team_id, id),
  foreign key (run_id, member_id)
    references hunt_v3.run_members(run_id, member_id),
  unique (run_id, member_id, revision),
  unique (run_id, member_id, id),
  check (server_weight + peer_weight = 1.000)
);

create table if not exists hunt_v3.recognition_overrides (
  id bigint generated always as identity primary key,
  run_id uuid not null,
  team_id uuid not null,
  member_id uuid not null,
  result_id bigint not null,
  replaces_override_id bigint,
  headline_title text check (headline_title is null or length(headline_title) between 1 and 100),
  data_title text check (data_title is null or length(data_title) between 1 and 100),
  peer_title text check (peer_title is null or length(peer_title) between 1 and 100),
  explanation text,
  reason text not null check (length(reason) between 3 and 500),
  organizer_actor text not null check (length(organizer_actor) between 1 and 120),
  created_at timestamptz not null default now(),
  foreign key (team_id, run_id)
    references hunt_v3.runs(team_id, id),
  foreign key (team_id, member_id)
    references hunt_v3.team_members(team_id, id),
  foreign key (run_id, member_id, result_id)
    references hunt_v3.recognition_results(run_id, member_id, id),
  constraint recognition_overrides_identity_unique unique (run_id, member_id, id),
  constraint recognition_overrides_chain_fk foreign key (run_id, member_id, replaces_override_id)
    references hunt_v3.recognition_overrides(run_id, member_id, id),
  check (
    headline_title is not null
    or data_title is not null
    or peer_title is not null
    or explanation is not null
  )
);

create index if not exists recognition_overrides_latest
  on hunt_v3.recognition_overrides(run_id, member_id, created_at desc, id desc);

-- Idempotency, public board, operations, and analytics ---------------------

-- scope_key examples: team:<uuid>, run:<uuid>, member:<uuid>, admin:<hash>.
-- One table covers registration, run creation, commands, votes, and overrides.
create table if not exists hunt_v3.command_receipts (
  scope_key text not null check (length(scope_key) between 3 and 200),
  request_id uuid not null,
  operation text not null check (length(operation) between 1 and 100),
  team_id uuid references hunt_v3.teams(id),
  run_id uuid references hunt_v3.runs(id),
  member_id uuid references hunt_v3.team_members(id),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  created_at timestamptz not null default now(),
  primary key (scope_key, request_id),
  foreign key (team_id, run_id)
    references hunt_v3.runs(team_id, id),
  foreign key (team_id, member_id)
    references hunt_v3.team_members(team_id, id),
  constraint command_receipts_run_owner_required check (run_id is null or team_id is not null),
  constraint command_receipts_member_owner_required check (member_id is null or team_id is not null)
);

create index if not exists command_receipts_created
  on hunt_v3.command_receipts(created_at);

create table if not exists hunt_v3.public_boards (
  hunt_id text primary key references hunt_v3.hunts(id),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  enabled boolean not null default false,
  title text not null check (length(title) between 1 and 160),
  cover_ref text,
  event_status text not null default 'live'
    check (event_status in ('live', 'frozen', 'final')),
  visible_columns text[] not null default array['rank', 'team_code', 'team_name', 'points']::text[],
  main_board_visible boolean not null default true,
  replay_board_visible boolean not null default false,
  team_name_mode text not null default 'display_name'
    check (team_name_mode in ('code_only', 'display_name')),
  current_snapshot_id bigint,
  frozen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    visible_columns <@ array[
      'rank', 'team_code', 'team_name', 'points', 'progress',
      'completion_status', 'runs', 'time'
    ]::text[]
  )
);

-- Snapshots contain already-redacted team-level rows only. Player names,
-- contribution evidence, recognition votes, and private titles never belong
-- in this payload; that redaction remains enforced by the server projection.
create table if not exists hunt_v3.public_board_snapshots (
  id bigint generated always as identity primary key,
  hunt_id text not null references hunt_v3.public_boards(hunt_id),
  board_kind text not null check (board_kind in ('main', 'replay', 'combined')),
  rows jsonb not null check (jsonb_typeof(rows) = 'array'),
  source_cutoff timestamptz not null,
  generated_at timestamptz not null default now(),
  generated_by text not null,
  unique (hunt_id, id)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'public_boards_current_snapshot_fk'
      and conrelid = 'hunt_v3.public_boards'::regclass
  ) then
    alter table hunt_v3.public_boards
      add constraint public_boards_current_snapshot_fk
      foreign key (hunt_id, current_snapshot_id)
      references hunt_v3.public_board_snapshots(hunt_id, id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'public_boards_snapshot_required'
      and conrelid = 'hunt_v3.public_boards'::regclass
  ) then
    alter table hunt_v3.public_boards
      add constraint public_boards_snapshot_required
      check (event_status = 'live' or current_snapshot_id is not null);
  end if;
end;
$$;

-- Private aggregates for live operations and exports. scope_key is a stable
-- dimension identifier such as run:<uuid>, team:<uuid>, checkpoint:<id>, or
-- variant:<id>. Raw evidence remains in append-only tables above.
create table if not exists hunt_v3.analytics_rollups (
  hunt_id text not null references hunt_v3.hunts(id),
  rollup_kind text not null
    check (rollup_kind in (
      'hunt', 'registration', 'team', 'run', 'checkpoint', 'challenge',
      'puzzle', 'route', 'variant', 'contribution', 'recognition', 'ties'
    )),
  scope_key text not null check (length(scope_key) between 1 and 240),
  bucket_key text not null default 'all' check (length(bucket_key) between 1 and 80),
  hunt_version integer,
  team_id uuid,
  run_id uuid,
  checkpoint_id text,
  variant_id text,
  metrics jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metrics) = 'object'),
  source_cutoff timestamptz not null,
  refreshed_at timestamptz not null default now(),
  primary key (hunt_id, rollup_kind, scope_key, bucket_key),
  foreign key (hunt_id, hunt_version)
    references hunt_v3.hunt_versions(hunt_id, version),
  constraint analytics_rollups_team_hunt_fk foreign key (team_id, hunt_id)
    references hunt_v3.teams(id, hunt_id),
  constraint analytics_rollups_hunt_run_fk foreign key (hunt_id, run_id)
    references hunt_v3.runs(hunt_id, id),
  constraint analytics_rollups_team_run_fk foreign key (team_id, run_id)
    references hunt_v3.runs(team_id, id),
  constraint analytics_rollups_run_team_required check (run_id is null or team_id is not null)
);

create index if not exists analytics_rollups_refresh
  on hunt_v3.analytics_rollups(hunt_id, rollup_kind, refreshed_at desc);

-- Slim cached rows power five-second organizer polling without transferring
-- engine state or event histories.
create table if not exists hunt_v3.live_team_rollups (
  team_id uuid primary key,
  hunt_id text not null,
  active_run_id uuid,
  best_run_id uuid,
  run_number integer check (run_number is null or run_number > 0),
  member_count integer not null default 0 check (member_count >= 0),
  checked_in_count integer not null default 0 check (checked_in_count >= 0),
  run_count integer not null default 0 check (run_count >= 0),
  current_checkpoint_id text,
  score integer not null default 0,
  elapsed_ms bigint check (elapsed_ms is null or elapsed_ms >= 0),
  progress numeric(7,4) not null default 0 check (progress between 0 and 1),
  run_status text,
  route_variant text,
  challenge_variant text,
  alerts jsonb not null default '[]'::jsonb check (jsonb_typeof(alerts) = 'array'),
  last_activity_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (team_id, hunt_id)
    references hunt_v3.teams(id, hunt_id),
  foreign key (team_id, active_run_id)
    references hunt_v3.runs(team_id, id),
  foreign key (team_id, best_run_id)
    references hunt_v3.runs(team_id, id),
  check (checked_in_count <= member_count)
);

create index if not exists live_team_rollups_hunt
  on hunt_v3.live_team_rollups(hunt_id, updated_at desc);

create table if not exists hunt_v3.admin_events (
  id bigint generated always as identity primary key,
  action text not null check (length(action) between 1 and 120),
  actor text not null default 'system' check (length(actor) between 1 and 120),
  -- Retained as an audit identifier without a foreign key, so expired session
  -- rows can be cleaned up without mutating this append-only event.
  session_token_hash text,
  hunt_id text references hunt_v3.hunts(id),
  team_id uuid references hunt_v3.teams(id),
  run_id uuid references hunt_v3.runs(id),
  member_id uuid references hunt_v3.team_members(id),
  reason text,
  before_state jsonb,
  after_state jsonb,
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (team_id, hunt_id)
    references hunt_v3.teams(id, hunt_id),
  foreign key (team_id, run_id)
    references hunt_v3.runs(team_id, id),
  foreign key (team_id, member_id)
    references hunt_v3.team_members(team_id, id),
  check (before_state is null or jsonb_typeof(before_state) = 'object'),
  check (after_state is null or jsonb_typeof(after_state) = 'object'),
  check (run_id is null or (team_id is not null and hunt_id is not null)),
  check (member_id is null or team_id is not null)
);

create index if not exists admin_events_hunt_time
  on hunt_v3.admin_events(hunt_id, created_at desc);
create index if not exists admin_events_run_time
  on hunt_v3.admin_events(run_id, created_at desc)
  where run_id is not null;

create table if not exists hunt_v3.rate_limits (
  key text primary key,
  attempts integer not null check (attempts >= 0),
  window_start timestamptz not null default now()
);

-- Competitive answer budgets last for the whole run, unlike ordinary
-- 15-minute abuse windows. A reservation is keyed by the idempotency request
-- so simultaneous retries consume one slot while new guesses consume another.
create table if not exists hunt_v3.run_attempt_reservations (
  scope_key text not null check (scope_key ~ '^[0-9a-f]{64}$'),
  request_id uuid not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  run_id uuid not null,
  team_id uuid not null,
  ordinal integer not null check (ordinal > 0),
  created_at timestamptz not null default now(),
  primary key (scope_key, request_id),
  unique (scope_key, ordinal),
  foreign key (team_id, run_id) references hunt_v3.runs(team_id, id)
);

create index if not exists run_attempt_reservations_run
  on hunt_v3.run_attempt_reservations(run_id, scope_key);

-- An organizer may recover a team that exhausted a legitimate task budget,
-- but the original guesses remain immutable. Each row increases one exact
-- run/task scope by a bounded amount and is tied to both the idempotent
-- organizer request and its named audit event.
create table if not exists hunt_v3.run_attempt_allowances (
  id bigint generated always as identity primary key,
  scope_key text not null check (scope_key ~ '^[0-9a-f]{64}$'),
  request_id uuid not null,
  hunt_id text not null,
  team_id uuid not null,
  run_id uuid not null,
  checkpoint_id text not null check (length(checkpoint_id) between 1 and 160),
  node_id text not null check (length(node_id) between 1 and 160),
  additional_attempts integer not null check (additional_attempts between 1 and 1000),
  reason text not null check (length(reason) between 1 and 500),
  organizer_actor text not null check (length(organizer_actor) between 1 and 120),
  admin_event_id bigint not null references hunt_v3.admin_events(id),
  created_at timestamptz not null default now(),
  unique (scope_key, request_id),
  unique (admin_event_id, scope_key),
  foreign key (team_id, hunt_id) references hunt_v3.teams(id, hunt_id),
  foreign key (team_id, run_id) references hunt_v3.runs(team_id, id),
  foreign key (hunt_id, run_id) references hunt_v3.runs(hunt_id, id)
);

create index if not exists run_attempt_allowances_run
  on hunt_v3.run_attempt_allowances(run_id, scope_key, created_at);

-- Repeatable hardening for databases that applied an earlier V3 draft. These
-- ownership constraints prevent nullable or single-column foreign keys from
-- binding an audit row to an object from another team, run, or hunt.
do $$
begin
  if not exists (select 1 from pg_constraint where conname='sessions_identity_unique' and conrelid='hunt_v3.sessions'::regclass) then
    alter table hunt_v3.sessions add constraint sessions_identity_unique unique(token_hash,team_id,member_id);
  end if;
  if not exists (select 1 from pg_constraint where conname='roster_claims_session_identity_fk' and conrelid='hunt_v3.roster_claims'::regclass) then
    alter table hunt_v3.roster_claims add constraint roster_claims_session_identity_fk
      foreign key(session_token_hash,team_id,member_id) references hunt_v3.sessions(token_hash,team_id,member_id)
      on delete set null (session_token_hash);
  end if;
  if not exists (select 1 from pg_constraint where conname='runs_completed_timing_required' and conrelid='hunt_v3.runs'::regclass) then
    alter table hunt_v3.runs add constraint runs_completed_timing_required
      check(status<>'completed' or (completed_at is not null and elapsed_ms is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname='media_uploads_media_identity' and conrelid='hunt_v3.media_uploads'::regclass) then
    alter table hunt_v3.media_uploads add constraint media_uploads_media_identity check(media_id is null or media_id=id);
  end if;
  if not exists (select 1 from pg_constraint where conname='media_uploads_completion_timestamp' and conrelid='hunt_v3.media_uploads'::regclass) then
    alter table hunt_v3.media_uploads add constraint media_uploads_completion_timestamp check(media_id is null or completed_at is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname='recognition_overrides_identity_unique' and conrelid='hunt_v3.recognition_overrides'::regclass) then
    alter table hunt_v3.recognition_overrides add constraint recognition_overrides_identity_unique unique(run_id,member_id,id);
  end if;
  if not exists (select 1 from pg_constraint where conname='recognition_overrides_chain_fk' and conrelid='hunt_v3.recognition_overrides'::regclass) then
    alter table hunt_v3.recognition_overrides add constraint recognition_overrides_chain_fk
      foreign key(run_id,member_id,replaces_override_id) references hunt_v3.recognition_overrides(run_id,member_id,id);
  end if;
  if not exists (select 1 from pg_constraint where conname='command_receipts_run_owner_required' and conrelid='hunt_v3.command_receipts'::regclass) then
    alter table hunt_v3.command_receipts add constraint command_receipts_run_owner_required check(run_id is null or team_id is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname='command_receipts_member_owner_required' and conrelid='hunt_v3.command_receipts'::regclass) then
    alter table hunt_v3.command_receipts add constraint command_receipts_member_owner_required check(member_id is null or team_id is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname='analytics_rollups_team_hunt_fk' and conrelid='hunt_v3.analytics_rollups'::regclass) then
    alter table hunt_v3.analytics_rollups add constraint analytics_rollups_team_hunt_fk
      foreign key(team_id,hunt_id) references hunt_v3.teams(id,hunt_id);
  end if;
  if not exists (select 1 from pg_constraint where conname='analytics_rollups_hunt_run_fk' and conrelid='hunt_v3.analytics_rollups'::regclass) then
    alter table hunt_v3.analytics_rollups add constraint analytics_rollups_hunt_run_fk
      foreign key(hunt_id,run_id) references hunt_v3.runs(hunt_id,id);
  end if;
  if not exists (select 1 from pg_constraint where conname='analytics_rollups_team_run_fk' and conrelid='hunt_v3.analytics_rollups'::regclass) then
    alter table hunt_v3.analytics_rollups add constraint analytics_rollups_team_run_fk
      foreign key(team_id,run_id) references hunt_v3.runs(team_id,id);
  end if;
  if not exists (select 1 from pg_constraint where conname='analytics_rollups_run_team_required' and conrelid='hunt_v3.analytics_rollups'::regclass) then
    alter table hunt_v3.analytics_rollups add constraint analytics_rollups_run_team_required check(run_id is null or team_id is not null);
  end if;
end;
$$;

-- Integrity triggers -------------------------------------------------------

create or replace function hunt_v3.protect_run_identity() returns trigger
language plpgsql
set search_path = hunt_v3, pg_temp
as $$
begin
  if (new.engine_state -> 'routeAssignments') is distinct from (old.engine_state -> 'routeAssignments') then
    raise exception 'Seeded engine route assignments are immutable'
      using errcode = '55000';
  end if;
  if row(
    new.id,
    new.team_id,
    new.hunt_id,
    new.hunt_version,
    new.run_number,
    new.private_seed,
    new.seed_commitment,
    new.plan_key,
    new.allocation_cycle,
    new.practice,
    new.route_plan,
    new.resolved_variables,
    new.created_at
  ) is distinct from row(
    old.id,
    old.team_id,
    old.hunt_id,
    old.hunt_version,
    old.run_number,
    old.private_seed,
    old.seed_commitment,
    old.plan_key,
    old.allocation_cycle,
    old.practice,
    old.route_plan,
    old.resolved_variables,
    old.created_at
  ) then
    raise exception 'Run identity, seed, route, variables, and pinned hunt version are immutable'
      using errcode = '55000';
  end if;
  if row(new.score,new.bonus_score) is distinct from row(old.score,old.bonus_score)
    and coalesce(current_setting('hunt_v3.allow_score_cache_update', true),'') <> '1' then
    raise exception 'Run score caches may change only through the append-only score ledger'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function hunt_v3.reject_late_run_member() returns trigger
language plpgsql
set search_path = hunt_v3, pg_temp
as $$
declare
  run_status text;
  roster_participation text;
begin
  if exists(select 1 from hunt_v3.run_events event where event.run_id = new.run_id) then
    select run.status,
      coalesce(version.definition #>> '{settings,integrityPolicy,rosterParticipation}', 'freeze_at_run_start')
      into run_status,roster_participation
      from hunt_v3.runs run
      join hunt_v3.hunt_versions version
        on version.hunt_id=run.hunt_id and version.version=run.hunt_version
      where run.id=new.run_id and run.team_id=new.team_id;
    if run_status is null or run_status <> 'active' then
      raise exception 'Members can join only an active run'
        using errcode = '55000';
    end if;
    if roster_participation not in ('flexible', 'flexible_fixed_scoring') then
      raise exception 'Run membership is frozen after the starting roster is recorded'
        using errcode = '55000';
    end if;
    if not exists(
      select 1 from hunt_v3.team_members member
      where member.team_id=new.team_id and member.id=new.member_id
        and member.status='active' and member.checked_in_at is not null
    ) then
      raise exception 'A late run participant must be an active checked-in team member'
        using errcode = '55000';
    end if;
    new.contribution_eligible := roster_participation = 'flexible';
  else
    -- Starting-roster members always retain normal contribution eligibility.
    new.contribution_eligible := true;
  end if;
  return new;
end;
$$;

create or replace function hunt_v3.require_contribution_eligible_member() returns trigger
language plpgsql
set search_path = hunt_v3, pg_temp
as $$
begin
  if not exists(
    select 1 from hunt_v3.run_members participant
    where participant.run_id=new.run_id and participant.member_id=new.member_id
      and participant.contribution_eligible
  ) then
    raise exception 'This run participant is not eligible for contribution recognition'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function hunt_v3.require_recognition_eligible_recipient() returns trigger
language plpgsql
set search_path = hunt_v3, pg_temp
as $$
begin
  if not exists(
    select 1 from hunt_v3.run_members participant
    where participant.run_id=new.run_id and participant.member_id=new.recipient_member_id
      and participant.contribution_eligible
  ) then
    raise exception 'This run participant cannot receive recognition for this attempt'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function hunt_v3.protect_media_identity() returns trigger
language plpgsql
set search_path = hunt_v3, pg_temp
as $$
begin
  if row(
    new.id,
    new.hunt_id,
    new.team_id,
    new.run_id,
    new.member_id,
    new.checkpoint_id,
    new.node_id,
    new.parallel_mechanic_id,
    new.parallel_lane_id,
    new.kind,
    new.content_type,
    new.bytes,
    new.content_hash,
    new.storage_key,
    new.created_at,
    new.task_started_at
  ) is distinct from row(
    old.id,
    old.hunt_id,
    old.team_id,
    old.run_id,
    old.member_id,
    old.checkpoint_id,
    old.node_id,
    old.parallel_mechanic_id,
    old.parallel_lane_id,
    old.kind,
    old.content_type,
    old.bytes,
    old.content_hash,
    old.storage_key,
    old.created_at,
    old.task_started_at
  ) then
    raise exception 'Media ownership, evidence identity, and stored object metadata are immutable'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

-- Every player photo is tied to one immutable activation of one run action.
-- The shared row lock is deliberate: it conflicts with the organizer reset's
-- FOR UPDATE lock. Whichever statement commits second must observe the first,
-- so there is no validation/insert gap for multipart filesystem uploads.
create or replace function hunt_v3.validate_media_task_epoch() returns trigger
language plpgsql
set search_path = hunt_v3, pg_temp
as $$
begin
  if new.kind <> 'photo' then
    return new;
  end if;
  if new.task_started_at is null then
    raise exception 'Photo evidence must identify its exact task activation'
      using errcode='23514', constraint='media_task_epoch_binding';
  end if;
  -- Global competition lock order is hunt -> team -> run -> member.
  -- Lifecycle operations begin at the hunt, while disqualification takes the
  -- team before invalidating runs, so media materialization must explicitly do
  -- both instead of row-marking all joins in planner order.
  perform 1
  from hunt_v3.hunts hunt
  where hunt.id=new.hunt_id
  for share of hunt;
  if not found then
    raise exception 'Photo evidence no longer belongs to an existing hunt'
      using errcode='55000', constraint='media_task_epoch_binding';
  end if;
  perform 1
  from hunt_v3.teams team
  where team.id=new.team_id and team.hunt_id=new.hunt_id and team.status='active'
  for share of team;
  if not found then
    raise exception 'Photo evidence no longer belongs to an active team'
      using errcode='55000', constraint='media_task_epoch_binding';
  end if;
  perform 1
  from hunt_v3.runs run
  join hunt_v3.run_members participant
    on participant.run_id=run.id and participant.team_id=run.team_id and participant.member_id=new.member_id
  join hunt_v3.team_members member
    on member.id=participant.member_id and member.team_id=participant.team_id and member.status='active'
  where run.id=new.run_id and run.team_id=new.team_id and run.hunt_id=new.hunt_id
    and run.status='active'
    and run.engine_state->>'status'='active'
    and run.engine_state->>'activeCheckpointId'=new.checkpoint_id
    and run.engine_state #>> array['checkpoints',new.checkpoint_id,'activeNodeId']=new.node_id
    and (run.engine_state #>> array['checkpoints',new.checkpoint_id,'nodes',new.node_id,'startedAt'])::timestamptz=new.task_started_at
  for share of run,member;
  if not found then
    raise exception 'Photo evidence no longer matches the active task activation'
      using errcode='55000', constraint='media_task_epoch_binding';
  end if;
  return new;
end;
$$;

create or replace function hunt_v3.protect_media_upload_identity() returns trigger
language plpgsql
set search_path = hunt_v3, pg_temp
as $$
begin
  if row(
    new.id,
    new.owner_key,
    new.hunt_id,
    new.team_id,
    new.run_id,
    new.member_id,
    new.kind,
    new.storage_key,
    new.payload_hash,
    new.metadata,
    new.created_at,
    new.expires_at
  ) is distinct from row(
    old.id,
    old.owner_key,
    old.hunt_id,
    old.team_id,
    old.run_id,
    old.member_id,
    old.kind,
    old.storage_key,
    old.payload_hash,
    old.metadata,
    old.created_at,
    old.expires_at
  ) then
    raise exception 'Direct-upload ownership, task, file metadata, hash, and expiry are immutable'
      using errcode='55000', constraint='media_upload_ticket_binding';
  end if;
  if old.completed_at is null then
    if (new.completed_at is null) is distinct from (new.media_id is null) then
      raise exception 'Direct-upload completion must record media and time together'
        using errcode='55000', constraint='media_upload_ticket_binding';
    end if;
  elsif new.completed_at is distinct from old.completed_at
    or (old.media_id is not null and new.media_id is distinct from old.media_id and new.media_id is not null) then
    raise exception 'A completed direct-upload receipt cannot be rewritten'
      using errcode='55000', constraint='media_upload_ticket_binding';
  end if;
  return new;
end;
$$;

-- A direct upload uses the same UUID for its receipt and final media row. This
-- trigger is the final fail-closed boundary: materialization and receipt
-- completion happen in one statement, using the database clock and the exact
-- active run/node snapshot recorded when the signed write was prepared.
create or replace function hunt_v3.complete_direct_upload_ticket() returns trigger
language plpgsql
set search_path = hunt_v3, pg_temp
as $$
declare
  upload hunt_v3.media_uploads%rowtype;
begin
  select * into upload from hunt_v3.media_uploads where id=new.id for update;
  if not found then
    return new;
  end if;
  if upload.completed_at is not null then
    if upload.media_id is distinct from new.id then
      raise exception 'Direct-upload receipt is already bound to different media'
        using errcode='55000', constraint='media_upload_ticket_binding';
    end if;
    return new;
  end if;
  if upload.expires_at <= clock_timestamp() then
    raise exception 'Direct-upload receipt expired before media materialization'
      using errcode='23514', constraint='media_upload_ticket_expired';
  end if;
  if new.kind <> 'photo'
    or upload.kind <> 'photo'
    or upload.owner_key is distinct from format('team:%s:member:%s',new.team_id,new.member_id)
    or upload.hunt_id is distinct from new.hunt_id
    or upload.team_id is distinct from new.team_id
    or upload.run_id is distinct from new.run_id
    or upload.member_id is distinct from new.member_id
    or upload.metadata->>'checkpointId' is distinct from new.checkpoint_id
    or upload.metadata->>'nodeId' is distinct from new.node_id
    or (upload.metadata->>'taskStartedAt')::timestamptz is distinct from new.task_started_at
    or nullif(upload.metadata->>'mechanicId','') is distinct from new.parallel_mechanic_id
    or nullif(upload.metadata->>'laneId','') is distinct from new.parallel_lane_id then
    raise exception 'Direct-upload receipt no longer matches its active starting-roster task'
      using errcode='55000', constraint='media_upload_ticket_binding';
  end if;
  perform 1
  from hunt_v3.runs run
  join hunt_v3.run_members participant
    on participant.run_id=run.id and participant.team_id=run.team_id and participant.member_id=upload.member_id
  join hunt_v3.team_members member
    on member.id=participant.member_id and member.team_id=participant.team_id and member.status='active'
  where run.id=upload.run_id and run.team_id=upload.team_id and run.hunt_id=upload.hunt_id
    and run.status='active'
    and run.engine_state->>'activeCheckpointId'=upload.metadata->>'checkpointId'
    and run.engine_state #>> array['checkpoints',upload.metadata->>'checkpointId','activeNodeId']=upload.metadata->>'nodeId'
    and run.engine_state #>> array['checkpoints',upload.metadata->>'checkpointId','nodes',upload.metadata->>'nodeId','startedAt']=upload.metadata->>'taskStartedAt'
  for share of run,member;
  if not found then
    raise exception 'Direct-upload receipt no longer matches its active starting-roster task'
      using errcode='55000', constraint='media_upload_ticket_binding';
  end if;
  update hunt_v3.media_uploads
  set media_id=new.id,completed_at=clock_timestamp()
  where id=upload.id;
  return new;
end;
$$;

create or replace function hunt_v3.apply_score_ledger_entry() returns trigger
language plpgsql
set search_path = hunt_v3, pg_temp
as $$
begin
  perform set_config('hunt_v3.allow_score_cache_update', '1', true);
  update hunt_v3.runs
  set score = score + case when new.counts_for_ranking then new.amount else 0 end,
      bonus_score = bonus_score + case when new.counts_for_ranking then 0 else new.amount end
  where id = new.run_id and team_id = new.team_id;

  if not found then
    raise exception 'Run % is missing while applying score entry', new.run_id
      using errcode = '23503';
  end if;
  perform set_config('hunt_v3.allow_score_cache_update', '', true);
  return new;
end;
$$;

create or replace function hunt_v3.apply_member_checkin() returns trigger
language plpgsql
set search_path = hunt_v3, pg_temp
as $$
begin
  update hunt_v3.team_members
  set checked_in_at = case
        when new.action = 'check_in' then new.occurred_at
        else null
      end
  where id = new.member_id and team_id = new.team_id;

  if not found then
    raise exception 'Member % is missing while applying check-in', new.member_id
      using errcode = '23503';
  end if;
  return new;
end;
$$;

create or replace function hunt_v3.apply_roster_claim() returns trigger
language plpgsql
set search_path = hunt_v3, pg_temp
as $$
begin
  if new.status = 'active' then
    update hunt_v3.team_members
    set claimed_at = coalesce(claimed_at, new.claimed_at),
        status = case when status = 'rostered' then 'active' else status end
    where id = new.member_id and team_id = new.team_id;
  end if;
  return new;
end;
$$;

drop trigger if exists hunts_touch_updated_at on hunt_v3.hunts;
create trigger hunts_touch_updated_at
before update on hunt_v3.hunts
for each row execute function hunt_v3.touch_updated_at();

drop trigger if exists hunt_versions_require_integrity_policy on hunt_v3.hunt_versions;
create trigger hunt_versions_require_integrity_policy
before insert on hunt_v3.hunt_versions
for each row execute function hunt_v3.require_complete_integrity_policy();

drop trigger if exists drafts_touch_updated_at on hunt_v3.drafts;
create trigger drafts_touch_updated_at
before update on hunt_v3.drafts
for each row execute function hunt_v3.touch_updated_at();

drop trigger if exists teams_touch_updated_at on hunt_v3.teams;
create trigger teams_touch_updated_at
before update on hunt_v3.teams
for each row execute function hunt_v3.touch_updated_at();

drop trigger if exists team_members_touch_updated_at on hunt_v3.team_members;
create trigger team_members_touch_updated_at
before update on hunt_v3.team_members
for each row execute function hunt_v3.touch_updated_at();

drop trigger if exists runs_protect_identity on hunt_v3.runs;
create trigger runs_protect_identity
before update on hunt_v3.runs
for each row execute function hunt_v3.protect_run_identity();

drop trigger if exists runs_touch_updated_at on hunt_v3.runs;
create trigger runs_touch_updated_at
before update on hunt_v3.runs
for each row execute function hunt_v3.touch_updated_at();

drop trigger if exists run_members_reject_late_insert on hunt_v3.run_members;
create trigger run_members_reject_late_insert
before insert on hunt_v3.run_members
for each row execute function hunt_v3.reject_late_run_member();

drop trigger if exists run_contributions_require_eligible_member on hunt_v3.run_contributions;
create trigger run_contributions_require_eligible_member
before insert on hunt_v3.run_contributions
for each row execute function hunt_v3.require_contribution_eligible_member();

drop trigger if exists recognition_votes_require_eligible_recipient on hunt_v3.recognition_votes;
create trigger recognition_votes_require_eligible_recipient
before insert on hunt_v3.recognition_votes
for each row execute function hunt_v3.require_recognition_eligible_recipient();

drop trigger if exists recognition_results_require_eligible_member on hunt_v3.recognition_results;
create trigger recognition_results_require_eligible_member
before insert on hunt_v3.recognition_results
for each row execute function hunt_v3.require_contribution_eligible_member();

drop trigger if exists recognition_overrides_require_eligible_member on hunt_v3.recognition_overrides;
create trigger recognition_overrides_require_eligible_member
before insert on hunt_v3.recognition_overrides
for each row execute function hunt_v3.require_contribution_eligible_member();

drop trigger if exists public_boards_touch_updated_at on hunt_v3.public_boards;
create trigger public_boards_touch_updated_at
before update on hunt_v3.public_boards
for each row execute function hunt_v3.touch_updated_at();

drop trigger if exists media_protect_identity on hunt_v3.media;
create trigger media_protect_identity
before update on hunt_v3.media
for each row execute function hunt_v3.protect_media_identity();

drop trigger if exists media_validate_task_epoch on hunt_v3.media;
create trigger media_validate_task_epoch
before insert on hunt_v3.media
for each row execute function hunt_v3.validate_media_task_epoch();

drop trigger if exists media_uploads_protect_identity on hunt_v3.media_uploads;
create trigger media_uploads_protect_identity
before update on hunt_v3.media_uploads
for each row execute function hunt_v3.protect_media_upload_identity();

drop trigger if exists media_complete_direct_upload_ticket on hunt_v3.media;
create trigger media_complete_direct_upload_ticket
after insert on hunt_v3.media
for each row execute function hunt_v3.complete_direct_upload_ticket();

drop trigger if exists score_ledger_apply on hunt_v3.score_ledger;
create trigger score_ledger_apply
after insert on hunt_v3.score_ledger
for each row execute function hunt_v3.apply_score_ledger_entry();

drop trigger if exists member_checkins_apply on hunt_v3.member_checkins;
create trigger member_checkins_apply
after insert on hunt_v3.member_checkins
for each row execute function hunt_v3.apply_member_checkin();

drop trigger if exists roster_claims_apply on hunt_v3.roster_claims;
create trigger roster_claims_apply
after insert on hunt_v3.roster_claims
for each row execute function hunt_v3.apply_roster_claim();

-- Raw history, receipts, calculated result versions, and public freeze
-- snapshots are append-only. Corrections append compensating/audit records.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'hunt_versions',
    'hunt_version_qr_secrets',
    'roster_claim_events',
    'member_checkins',
    'run_members',
    'run_events',
    'score_ledger',
    'run_contributions',
    'photo_evidence_hashes',
    'run_attempt_reservations',
    'run_attempt_allowances',
    'recognition_votes',
    'recognition_results',
    'recognition_overrides',
    'command_receipts',
    'public_board_snapshots',
    'messages',
    'admin_events'
  ]
  loop
    execute format('drop trigger if exists reject_immutable_mutation on hunt_v3.%I', table_name);
    execute format(
      'create trigger reject_immutable_mutation before update or delete on hunt_v3.%I '
      'for each row execute function hunt_v3.reject_immutable_mutation()',
      table_name
    );
  end loop;
end;
$$;

-- Defense in depth: no policies are created, so direct API/browser roles see
-- no rows even if this schema is accidentally exposed. The server owner role
-- remains the only intended database principal and bypasses RLS as owner.
do $$
declare
  table_name text;
begin
  for table_name in
    select tablename from pg_tables where schemaname = 'hunt_v3'
  loop
    execute format('alter table hunt_v3.%I enable row level security', table_name);
  end loop;
end;
$$;

revoke all on all tables in schema hunt_v3 from public;
revoke all on all sequences in schema hunt_v3 from public;
revoke all on all functions in schema hunt_v3 from public;
alter default privileges in schema hunt_v3 revoke all on tables from public;
alter default privileges in schema hunt_v3 revoke all on sequences from public;
alter default privileges in schema hunt_v3 revoke all on functions from public;

commit;
