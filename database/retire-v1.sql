-- Optional legacy retirement. Review/backup first; run ONLY against the old V1
-- database after exporting its content. This is never part of v2-migrate.
-- Existing privileged owners/service accounts retain access for migration.
begin;
do $$
declare legacy_table text; legacy_role text;
begin
  foreach legacy_table in array array['hunts','checkpoints','teams','team_members','progress','hint_requests','puzzle_steps','puzzle_progress','puzzle_hints','puzzle_hint_state','dud_qr_scans'] loop
    if to_regclass(format('public.%I',legacy_table)) is not null then
      execute format('revoke all on table public.%I from public',legacy_table);
      foreach legacy_role in array array['anon','authenticated'] loop
        if exists(select 1 from pg_roles where rolname=legacy_role) then
          execute format('revoke all on table public.%I from %I',legacy_table,legacy_role);
        end if;
      end loop;
    end if;
  end loop;
end $$;
commit;
