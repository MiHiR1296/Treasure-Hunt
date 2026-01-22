-- Team members table
create table team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  name text not null,
  order_index int not null,
  created_at timestamptz default now()
);

create index on team_members (team_id);

-- Add constraint: teams must have 4-6 members
-- This will be enforced in the application layer

-- RLS policies
alter table team_members enable row level security;
create policy "Team members are viewable by everyone" on team_members for select using (true);
create policy "Anyone can create team members" on team_members for insert with check (true);
create policy "Anyone can update team members" on team_members for update using (true);
create policy "Anyone can delete team members" on team_members for delete using (true);
