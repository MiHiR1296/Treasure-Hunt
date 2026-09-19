-- Apply with the server database owner. Never expose this schema through a public API.
begin;
create schema if not exists hunt_v2;
revoke all on schema hunt_v2 from public;

create table if not exists hunt_v2.hunts (
  id text primary key,
  title text not null,
  version integer not null check (version > 0),
  definition jsonb not null,
  status text not null default 'live' check (status in ('live','paused')),
  created_at timestamptz not null default now()
);
create table if not exists hunt_v2.teams (
  id uuid primary key,
  hunt_id text not null references hunt_v2.hunts(id) on delete cascade,
  name text not null,
  name_key text not null,
  pin_hash text not null,
  state jsonb not null,
  last_activity timestamptz not null default now(),
  unique (hunt_id, name_key)
);
create table if not exists hunt_v2.sessions (
  token_hash text primary key,
  role text not null check (role in ('team','admin')),
  team_id uuid references hunt_v2.teams(id) on delete cascade,
  player_name text,
  expires_at timestamptz not null,
  check ((role = 'team' and team_id is not null) or (role = 'admin' and team_id is null))
);
create index if not exists sessions_expiry on hunt_v2.sessions(expires_at);
create table if not exists hunt_v2.command_receipts (
  team_id uuid not null references hunt_v2.teams(id) on delete cascade,
  request_id uuid not null,
  payload_hash text not null,
  feedback jsonb not null,
  created_at timestamptz not null default now(),
  primary key (team_id, request_id)
);
create table if not exists hunt_v2.rate_limits (
  key text primary key,
  attempts integer not null,
  window_start timestamptz not null default now()
);
create table if not exists hunt_v2.admin_events (
  id bigint generated always as identity primary key,
  action text not null,
  hunt_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
-- Deny direct API/browser access, including if schema exposure changes later.
alter table hunt_v2.hunts enable row level security;
alter table hunt_v2.teams enable row level security;
alter table hunt_v2.sessions enable row level security;
alter table hunt_v2.command_receipts enable row level security;
alter table hunt_v2.rate_limits enable row level security;
alter table hunt_v2.admin_events enable row level security;
revoke all on all tables in schema hunt_v2 from public;
revoke all on all sequences in schema hunt_v2 from public;

-- Additive upgrade: published versions stay immutable for teams already playing.
alter table hunt_v2.hunts add column if not exists is_preview boolean not null default false;
alter table hunt_v2.hunts drop constraint if exists hunts_status_check;
alter table hunt_v2.hunts add constraint hunts_status_check check (status in ('ready','live','paused','ended','archived'));
alter table hunt_v2.teams add column if not exists is_preview boolean not null default false;
alter table hunt_v2.teams add column if not exists created_at timestamptz not null default now();
create table if not exists hunt_v2.hunt_versions (
  hunt_id text not null references hunt_v2.hunts(id) on delete cascade,
  version integer not null,
  definition jsonb not null,
  published_at timestamptz not null default now(),
  primary key (hunt_id,version)
);
insert into hunt_v2.hunt_versions(hunt_id,version,definition)
  select id,version,definition from hunt_v2.hunts on conflict do nothing;
create table if not exists hunt_v2.drafts (
  id text primary key,
  definition jsonb not null,
  revision integer not null default 1,
  updated_at timestamptz not null default now()
);
create table if not exists hunt_v2.members (
  id uuid primary key,
  team_id uuid not null references hunt_v2.teams(id) on delete cascade,
  name text not null,
  name_key text not null,
  joined_at timestamptz not null default now(),
  unique(team_id,name_key)
);
create table if not exists hunt_v2.help_requests (
  id uuid primary key,
  team_id uuid not null references hunt_v2.teams(id) on delete cascade,
  checkpoint_id text,
  node_id text,
  kind text not null check(kind in ('help','camera','gps','network','puzzle','photo')),
  message text not null,
  status text not null default 'open' check(status in ('open','resolved')),
  response text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique(team_id,id)
);
create index if not exists help_open on hunt_v2.help_requests(status,created_at);
create table if not exists hunt_v2.messages (
  id uuid primary key,
  hunt_id text not null references hunt_v2.hunts(id) on delete cascade,
  team_id uuid references hunt_v2.teams(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);
create table if not exists hunt_v2.media (
  id uuid primary key,
  hunt_id text references hunt_v2.hunts(id) on delete cascade,
  team_id uuid references hunt_v2.teams(id) on delete cascade,
  checkpoint_id text,
  node_id text,
  kind text not null check(kind in ('asset','photo')),
  content_type text not null,
  bytes integer not null,
  content_hash text not null,
  storage_key text not null unique,
  retention text not null default 'after_review' check(retention in ('after_review','after_event','keep')),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
alter table hunt_v2.media add column if not exists content_hash text not null default '';
-- Deletions survive provider outages and cascading event/team deletions.
create table if not exists hunt_v2.media_deletions (
  storage_key text primary key,
  created_at timestamptz not null default now()
);
-- Temporary uploads are never referenced by published/player media URLs.
-- Keep the receipt past the provider's two-hour upload-token lifetime, even
-- after deleting the raw file, so a late token replay is cleaned up as well.
create table if not exists hunt_v2.media_uploads (
  id uuid primary key,
  owner_key text not null,
  kind text not null check (kind in ('asset','photo')),
  storage_key text not null unique,
  payload_hash text not null,
  metadata jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '15 minutes',
  cleanup_after timestamptz not null default now()+interval '125 minutes',
  completed_at timestamptz
);
create index if not exists media_upload_cleanup on hunt_v2.media_uploads(cleanup_after);
create or replace function hunt_v2.queue_media_deletion() returns trigger
language plpgsql set search_path = hunt_v2, pg_temp as $$
begin
  insert into hunt_v2.media_deletions(storage_key) values (old.storage_key) on conflict do nothing;
  return old;
end;
$$;
drop trigger if exists queue_media_deletion on hunt_v2.media;
create trigger queue_media_deletion after delete on hunt_v2.media
  for each row execute function hunt_v2.queue_media_deletion();
create table if not exists hunt_v2.preview_commands (
  team_id uuid not null references hunt_v2.teams(id) on delete cascade,
  request_id uuid not null,
  payload_hash text not null,
  command jsonb not null,
  is_control boolean not null,
  primary key(team_id,request_id)
);
alter table hunt_v2.preview_commands enable row level security;
alter table hunt_v2.hunt_versions enable row level security;
alter table hunt_v2.drafts enable row level security;
alter table hunt_v2.members enable row level security;
alter table hunt_v2.help_requests enable row level security;
alter table hunt_v2.messages enable row level security;
alter table hunt_v2.media enable row level security;
alter table hunt_v2.media_deletions enable row level security;
alter table hunt_v2.media_uploads enable row level security;
revoke all on function hunt_v2.queue_media_deletion() from public;
revoke all on all tables in schema hunt_v2 from public;
revoke all on all sequences in schema hunt_v2 from public;
commit;
