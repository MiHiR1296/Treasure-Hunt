-- Teams (anonymous, just name)
create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz default now()
);

-- Treasure hunts
create table hunts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text default 'draft' check (status in ('draft','live','completed')),
  created_at timestamptz default now()
);

-- Checkpoints (locations with clues)
create table checkpoints (
  id uuid primary key default gen_random_uuid(),
  hunt_id uuid references hunts(id) on delete cascade,
  title text not null,
  description text,
  order_index int not null,
  clue_text text not null,  -- The clue/riddle shown after unlocking
  hint_text text,  -- Optional hint if team is stuck
  
  -- Location data
  lat double precision,
  lng double precision,
  radius_m integer default 50,  -- For GPS-based checkpoints
  
  -- Unlock methods
  unlock_method text not null check (unlock_method in ('qr_code','gps','manual_code')),
  qr_code_value text,  -- For QR code method
  manual_code text,  -- For manual code entry
  
  created_at timestamptz default now()
);

create index on checkpoints (hunt_id, order_index);

-- Team progress
create table progress (
  team_id uuid references teams(id) on delete cascade,
  checkpoint_id uuid references checkpoints(id) on delete cascade,
  unlocked_at timestamptz default now(),
  completed_at timestamptz,
  hints_used int default 0,
  primary key (team_id, checkpoint_id)
);

create index on progress (team_id);
create index on progress (checkpoint_id);

-- Hints requested (tracking)
create table hint_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  checkpoint_id uuid references checkpoints(id) on delete cascade,
  requested_at timestamptz default now()
);

create index on hint_requests (team_id, checkpoint_id);

-- Row Level Security Policies

-- Teams: anyone can read, anyone can insert
alter table teams enable row level security;
create policy "Teams are viewable by everyone" on teams for select using (true);
create policy "Teams can be created by anyone" on teams for insert with check (true);

-- Hunts: anyone can read, anyone can insert (for admin panel)
alter table hunts enable row level security;
create policy "Hunts are viewable by everyone" on hunts for select using (true);
create policy "Anyone can create hunts" on hunts for insert with check (true);

-- Checkpoints: anyone can read
alter table checkpoints enable row level security;
create policy "Checkpoints are viewable by everyone" on checkpoints for select using (true);

-- Progress: teams can see their own progress
alter table progress enable row level security;
create policy "Teams can view their own progress" on progress for select using (true);
create policy "Teams can insert their own progress" on progress for insert with check (true);
create policy "Teams can update their own progress" on progress for update using (true);

-- Hint requests: teams can insert their own
alter table hint_requests enable row level security;
create policy "Teams can insert hint requests" on hint_requests for insert with check (true);
create policy "Teams can view their own hint requests" on hint_requests for select using (true);
