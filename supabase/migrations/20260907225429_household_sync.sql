-- Pilot admission is provisioned by the operator, never by client signup.
create table public.turntally_households (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id),
  snapshot jsonb,
  revision integer not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);

create table public.turntally_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null references public.turntally_households(id),
  person_id text,
  viewer_only boolean not null default false,
  revoked_at timestamptz
);

create index turntally_households_owner_user_id_idx
  on public.turntally_households (owner_user_id);
create index turntally_memberships_household_id_idx
  on public.turntally_memberships (household_id);

alter table public.turntally_households enable row level security;
alter table public.turntally_memberships enable row level security;
-- No direct client table access. The RPCs below are the entire client surface.
revoke all on public.turntally_households, public.turntally_memberships from public, anon, authenticated;
grant all on public.turntally_households, public.turntally_memberships to service_role;

create schema if not exists turntally_private;
revoke all on schema turntally_private from public, anon, authenticated;

create function turntally_private.validate_snapshot(value jsonb) returns void
language plpgsql set search_path = '' as $$
declare config jsonb; person jsonb;
begin
  if value is null or jsonb_typeof(value) <> 'object'
     or octet_length(value::text) > 10485760
     or (value - 'configuration' - 'events') <> '{}'::jsonb
     or jsonb_typeof(value->'configuration') is distinct from 'object'
     or jsonb_typeof(value->'events') is distinct from 'array' then
    raise exception 'Invalid family snapshot' using errcode = '22023';
  end if;
  config := value->'configuration';
  if config->'rolesInitialized' is distinct from 'true'::jsonb
     or jsonb_typeof(config->'people') is distinct from 'array'
     or jsonb_typeof(config->'rotation') is distinct from 'object'
     or jsonb_typeof(config->'startDate') is distinct from 'string' then
    raise exception 'Set up family roles before migration' using errcode = '22023';
  end if;
  if jsonb_array_length(config->'people') not between 1 and 1000 then
    raise exception 'Invalid family size' using errcode = '22023';
  end if;
  for person in select * from jsonb_array_elements(config->'people') loop
    if jsonb_typeof(person) <> 'object'
       or jsonb_typeof(person->'id') is distinct from 'string'
       or length(person->>'id') not between 1 and 200
       or jsonb_typeof(person->'name') is distinct from 'string'
       or length(trim(person->>'name')) not between 1 and 500
       or coalesce(person->>'role', '') not in ('administrator', 'editor', 'viewer')
       or (person ? 'active' and jsonb_typeof(person->'active') <> 'boolean') then
      raise exception 'Invalid family member' using errcode = '22023';
    end if;
  end loop;
  if (select count(distinct p->>'id') from jsonb_array_elements(config->'people') p) <> jsonb_array_length(config->'people') then
    raise exception 'Duplicate family member' using errcode = '22023';
  end if;
  if not exists (select 1 from jsonb_array_elements(config->'people') p
    where p->>'role' = 'administrator' and p->'active' is distinct from 'false'::jsonb) then
    raise exception 'Keep an active administrator' using errcode = '22023';
  end if;
  if jsonb_array_length(value->'events') > 100000 or exists (
    select 1 from jsonb_array_elements(value->'events') e
    where jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'eventId') is distinct from 'string'
      or coalesce(e->>'type', '') not in ('assignment-recorded', 'outcome-recorded')
  ) or (select count(distinct e->>'eventId') from jsonb_array_elements(value->'events') e) <> jsonb_array_length(value->'events') then
    raise exception 'Invalid history' using errcode = '22023';
  end if;
end;
$$;

create function public.turntally_load() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member public.turntally_memberships; family public.turntally_households; person jsonb;
begin
  select * into member from public.turntally_memberships where user_id = auth.uid() and revoked_at is null;
  if not found then raise exception 'Family access is not available' using errcode = '42501'; end if;
  select * into strict family from public.turntally_households where id = member.household_id;
  if family.snapshot is null then
    if family.owner_user_id <> auth.uid() or member.viewer_only then
      raise exception 'The family owner needs to complete setup' using errcode = '42501';
    end if;
  else
    select p into person from jsonb_array_elements(family.snapshot->'configuration'->'people') p
      where p->>'id' = member.person_id and p->'active' is distinct from 'false'::jsonb;
    if person is null then raise exception 'Family access is not available' using errcode = '42501'; end if;
  end if;
  return jsonb_build_object('household_id', family.id, 'snapshot', family.snapshot,
    'revision', family.revision, 'person_id', member.person_id,
    'role', case when member.viewer_only then 'viewer' else person->>'role' end);
end;
$$;

create function public.turntally_save(expected_revision integer, proposed_snapshot jsonb, operation text default 'edit', administrator_id text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member public.turntally_memberships; family public.turntally_households; person jsonb; actor_role text;
begin
  select * into member from public.turntally_memberships where user_id = auth.uid() and revoked_at is null;
  if not found or member.viewer_only then raise exception 'This account cannot make changes' using errcode = '42501'; end if;
  -- Serialize edits before checking revision and the current role.
  select * into strict family from public.turntally_households where id = member.household_id for update;
  select * into member from public.turntally_memberships
    where user_id = auth.uid() and household_id = family.id and revoked_at is null for share;
  if not found or member.viewer_only then raise exception 'This account cannot make changes' using errcode = '42501'; end if;
  if expected_revision is distinct from family.revision then
    raise exception 'Another device changed this family. Review the latest version before saving.' using errcode = '40001';
  end if;
  if operation is null or operation not in ('edit', 'restore', 'initialize') then
    raise exception 'Unsupported operation' using errcode = '22023';
  end if;
  perform turntally_private.validate_snapshot(proposed_snapshot);
  if family.snapshot is null then
    if family.owner_user_id <> auth.uid() or operation <> 'initialize' then
      raise exception 'Only the provisioned owner can migrate the family' using errcode = '42501';
    end if;
    if not exists (select 1 from jsonb_array_elements(proposed_snapshot->'configuration'->'people') p
      where p->>'id' = administrator_id and p->>'role' = 'administrator' and p->'active' is distinct from 'false'::jsonb) then
      raise exception 'Choose an active administrator from this family' using errcode = '22023';
    end if;
    update public.turntally_memberships set person_id = administrator_id where user_id = auth.uid();
  else
    select p into person from jsonb_array_elements(family.snapshot->'configuration'->'people') p
      where p->>'id' = member.person_id and p->'active' is distinct from 'false'::jsonb;
    actor_role := person->>'role';
    if actor_role is null or actor_role not in ('administrator', 'editor') then
      raise exception 'This account cannot make changes' using errcode = '42501';
    end if;
    if operation = 'initialize' or (operation = 'restore' and actor_role <> 'administrator') then
      raise exception 'Only an administrator can replace family data' using errcode = '42501';
    end if;
    if actor_role = 'editor' and (
      proposed_snapshot->'configuration'->'people' is distinct from family.snapshot->'configuration'->'people'
      or proposed_snapshot->'configuration'->'rolesInitialized' is distinct from family.snapshot->'configuration'->'rolesInitialized'
    ) then raise exception 'Only an administrator can manage family membership' using errcode = '42501'; end if;
    if operation <> 'restore' and exists (
      select 1 from jsonb_array_elements(family.snapshot->'events') old_event
      where not exists (select 1 from jsonb_array_elements(proposed_snapshot->'events') new_event where old_event = new_event)
    ) then raise exception 'Recorded history must be preserved; append a correction' using errcode = '42501'; end if;
  end if;
  -- A backup cannot silently remap existing logins or remove their identities.
  if exists (select 1 from public.turntally_memberships m where m.household_id = family.id and m.revoked_at is null
    and m.person_id is not null and not exists (select 1 from jsonb_array_elements(proposed_snapshot->'configuration'->'people') p where p->>'id' = m.person_id)) then
    raise exception 'Preserve linked family identities; deactivate members instead' using errcode = '22023';
  end if;
  if not exists (select 1 from public.turntally_memberships m
    join jsonb_array_elements(proposed_snapshot->'configuration'->'people') p on p->>'id' = m.person_id
    where m.household_id = family.id and m.revoked_at is null and not m.viewer_only
      and p->>'role' = 'administrator' and p->'active' is distinct from 'false'::jsonb) then
    raise exception 'Keep an active administrator with a linked sign-in' using errcode = '22023';
  end if;
  update public.turntally_households set snapshot = proposed_snapshot, revision = revision + 1, updated_at = now() where id = family.id;
  -- Return no data through a revoked/deactivated actor. Self-deactivation is
  -- allowed only with a replacement admin; the next read will reject access.
  return jsonb_build_object('revision', family.revision + 1);
end;
$$;

revoke all on all functions in schema turntally_private from public, anon, authenticated;
revoke all on function public.turntally_load() from public, anon;
revoke all on function public.turntally_save(integer, jsonb, text, text) from public, anon;
grant execute on function public.turntally_load() to authenticated;
grant execute on function public.turntally_save(integer, jsonb, text, text) to authenticated;
