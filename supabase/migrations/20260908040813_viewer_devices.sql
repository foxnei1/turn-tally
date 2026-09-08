-- Access records are deliberately outside snapshots and the exposed API schema.
create table turntally_private.viewer_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  household_id uuid not null references public.turntally_households(id),
  person_id text,
  name text not null check (length(trim(name)) between 1 and 80),
  kind text not null check (kind in ('personal', 'shared')),
  enrolled_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  check ((kind = 'personal' and person_id is not null) or (kind = 'shared' and person_id is null))
);
create index viewer_devices_household_idx on turntally_private.viewer_devices(household_id);

create table turntally_private.pairing_requests (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  proof_hash text not null check (proof_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  state text not null default 'pending' check (state in ('pending','approved','provisioning','issued','claimed','canceled','expired','denied')),
  approved_by uuid references auth.users(id) on delete set null,
  household_id uuid references public.turntally_households(id),
  person_id text,
  kind text,
  name text,
  -- Reserve the Auth UUID before the external operation, so even a lost create
  -- response can be cleaned up. This UUID is not an account until approval.
  provision_user_id uuid not null unique default gen_random_uuid(),
  lease_until timestamptz,
  polled_at timestamptz,
  cleanup_at timestamptz,
  cleanup_succeeded boolean not null default false
);
create index pairing_requests_expiry_idx on turntally_private.pairing_requests(expires_at);
create index pairing_requests_household_idx on turntally_private.pairing_requests(household_id);
create index pairing_requests_approver_idx on turntally_private.pairing_requests(approved_by);
create table turntally_private.pairing_limits (
  bucket text primary key,
  started_at timestamptz not null default now(),
  attempts integer not null default 1
);
alter table turntally_private.viewer_devices enable row level security;
alter table turntally_private.pairing_requests enable row level security;
alter table turntally_private.pairing_limits enable row level security;
revoke all on all tables in schema turntally_private from public, anon, authenticated;
grant usage on schema turntally_private to service_role;
grant all on all tables in schema turntally_private to service_role;

create function turntally_private.pairing_limit(key text, maximum integer) returns boolean
language plpgsql set search_path = '' as $$
declare total integer;
begin
  insert into turntally_private.pairing_limits as limits(bucket) values(key)
  on conflict (bucket) do update set
    attempts = case when limits.started_at < now() - interval '15 minutes' then 1 else limits.attempts + 1 end,
    started_at = case when limits.started_at < now() - interval '15 minutes' then now() else limits.started_at end
  returning attempts into total;
  return total <= maximum;
end;
$$;

create function turntally_private.device_administrator(actor uuid) returns uuid
language plpgsql set search_path = '' as $$
declare family_id uuid;
begin
  select m.household_id into family_id from public.turntally_memberships m
    where m.user_id = actor and m.revoked_at is null and not m.viewer_only;
  -- Same lock order as snapshot saves. Recheck membership after locking family.
  perform 1 from public.turntally_households where id = family_id for update;
  perform 1 from public.turntally_memberships where user_id = actor for share;
  if not exists (select 1 from public.turntally_memberships m
    join public.turntally_households h on h.id = m.household_id
    cross join lateral jsonb_array_elements(h.snapshot->'configuration'->'people') p
    where m.user_id = actor and h.id = family_id and m.revoked_at is null and not m.viewer_only
      and p->>'id' = m.person_id and p->>'role' = 'administrator' and p->'active' is distinct from 'false'::jsonb
      and not exists (select 1 from turntally_private.viewer_devices d where d.user_id = actor)) then
    raise exception 'Only a current family administrator can manage devices' using errcode = '42501';
  end if;
  return family_id;
end;
$$;

-- Only the Edge Function's service client can invoke this coordinator. actor_id
-- comes from Auth getUser(token), never from the request body or user metadata.
create function public.turntally_device_command(operation text, actor_id uuid default null, payload jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare req turntally_private.pairing_requests; family_id uuid; result jsonb; device turntally_private.viewer_devices;
begin
  -- Pairing is infrequent in the pilot. One transaction lock makes quotas,
  -- approval, cancellation, and claiming atomic across Edge instances.
  perform pg_advisory_xact_lock(842173091);
  if operation = 'cleanup_done' then
    update turntally_private.pairing_requests set cleanup_succeeded = true
      where provision_user_id = (payload->>'user_id')::uuid and state in ('expired','canceled','denied')
      and coalesce(lease_until,expires_at) < now();
    return jsonb_build_object('state','ok');
  end if;
  if operation = 'cleanup' then
    update turntally_private.pairing_requests set state = 'expired'
      where state in ('pending','approved','provisioning','issued')
        and (expires_at <= now() or (lease_until is not null and lease_until <= now()));
    with candidates as (
      select id from turntally_private.pairing_requests
      where state in ('expired','canceled','denied') and coalesce(lease_until, expires_at) < now()
        and (cleanup_at is null or cleanup_at < now() - interval '30 minutes')
      order by cleanup_at nulls first, expires_at limit 5
    ), marked as (
      update turntally_private.pairing_requests r set cleanup_at = now() from candidates c
      where r.id = c.id returning r.provision_user_id
    ) select coalesce(jsonb_agg(provision_user_id), '[]'::jsonb) into result from marked;
    delete from turntally_private.pairing_requests where id in (
      select id from turntally_private.pairing_requests where expires_at < now() - interval '7 days'
      and (state = 'claimed' or cleanup_succeeded) limit 100);
    delete from turntally_private.pairing_limits where bucket in (
      select bucket from turntally_private.pairing_limits where started_at < now() - interval '1 day' limit 100);
    return jsonb_build_object('users', result);
  end if;
  if operation = 'start' then
    if not turntally_private.pairing_limit('global:start', 100)
      or not turntally_private.pairing_limit('ip:' || coalesce(payload->>'ip_hash', 'unknown'), 10)
      or (select count(*) from turntally_private.pairing_requests where expires_at > now() and state in ('pending','approved','provisioning','issued')) >= 100
      or (select count(*) from turntally_private.pairing_requests) >= 5000 then
      return jsonb_build_object('error','Too many pairing requests. Try again in 15 minutes.', 'code',429);
    end if;
    insert into turntally_private.pairing_requests(code_hash, proof_hash)
      values(payload->>'code_hash', payload->>'proof_hash') returning * into req;
    return jsonb_build_object('id',req.id, 'expires_at',req.expires_at, 'state',req.state);
  end if;
  if operation in ('list','lookup','approve','deny','rename','revoke') then
    family_id := turntally_private.device_administrator(actor_id);
    if operation = 'list' then
      select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'kind',d.kind,'person_id',d.person_id,
        'enrolled_at',d.enrolled_at,'last_seen_at',d.last_seen_at,'revoked_at',d.revoked_at) order by d.enrolled_at desc),'[]'::jsonb)
        into result from turntally_private.viewer_devices d where d.household_id = family_id;
      return jsonb_build_object('devices',result);
    end if;
    if operation in ('rename','revoke') then
      select * into device from turntally_private.viewer_devices where id = (payload->>'id')::uuid and household_id = family_id;
      if not found then return jsonb_build_object('error','Device not found.', 'code',404); end if;
      if operation = 'rename' then
        update turntally_private.viewer_devices set name = trim(payload->>'name') where id = device.id;
      else
        update public.turntally_memberships set revoked_at = coalesce(revoked_at,now()) where user_id = device.user_id;
        update turntally_private.viewer_devices set revoked_at = coalesce(revoked_at,now()) where id = device.id;
      end if;
      return jsonb_build_object('state','ok');
    end if;
    -- Count unsuccessful lookups too: return errors instead of rolling back.
    if not turntally_private.pairing_limit('lookup:' || actor_id::text,10) then
      return jsonb_build_object('error','Too many code attempts. Try again in 15 minutes.','code',429);
    end if;
    select * into req from turntally_private.pairing_requests where code_hash = payload->>'code_hash';
    if not found or req.state <> 'pending' or req.expires_at <= now() then
      return jsonb_build_object('error','Code unavailable or expired. Get a new code on the viewer device.','code',410);
    end if;
    if operation = 'lookup' then return jsonb_build_object('state','pending','expires_at',req.expires_at); end if;
    if operation = 'deny' then
      update turntally_private.pairing_requests set state = 'denied' where id = req.id;
      return jsonb_build_object('state','denied');
    end if;
    if coalesce(payload->>'kind','') not in ('personal','shared') or length(trim(coalesce(payload->>'name',''))) not between 1 and 80
      or (payload->>'kind' = 'personal' and not exists (
        select 1 from public.turntally_households h cross join lateral jsonb_array_elements(h.snapshot->'configuration'->'people') p
        where h.id = family_id and p->>'id' = payload->>'person_id' and p->'active' is distinct from 'false'::jsonb)) then
      return jsonb_build_object('error','Choose a name, device purpose, and an active family member for a personal device.','code',400);
    end if;
    update turntally_private.pairing_requests set state = 'approved', household_id = family_id,
      approved_by = actor_id, kind = payload->>'kind', name = trim(payload->>'name'),
      person_id = case when payload->>'kind' = 'personal' then payload->>'person_id' else null end where id = req.id;
    return jsonb_build_object('state','approved');
  end if;
  if operation = 'disconnect' then
    select * into device from turntally_private.viewer_devices where user_id = actor_id;
    if not found then return jsonb_build_object('error','Viewer device not found.','code',403); end if;
    update public.turntally_memberships set revoked_at = coalesce(revoked_at,now()) where user_id = actor_id;
    update turntally_private.viewer_devices set revoked_at = coalesce(revoked_at,now()) where id = device.id;
    return jsonb_build_object('state','disconnected');
  end if;
  if operation not in ('poll','issued','activate','cancel') then
    return jsonb_build_object('error','Unknown device operation.','code',400);
  end if;
  select * into req from turntally_private.pairing_requests where id = (payload->>'id')::uuid and proof_hash = payload->>'proof_hash';
  if not found then return jsonb_build_object('error','Pairing request unavailable. Get a new code.','code',410); end if;
  if req.state = 'claimed' and operation = 'activate' and actor_id is distinct from req.provision_user_id then
    return jsonb_build_object('error','This session cannot claim that request.','code',403);
  end if;
  if req.state in ('claimed','canceled','expired','denied') then return jsonb_build_object('state',req.state); end if;
  if operation = 'cancel' then
    update turntally_private.pairing_requests set state = 'canceled' where id = req.id;
    return jsonb_build_object('state','canceled');
  end if;
  if req.expires_at <= now() or (req.lease_until is not null and req.lease_until <= now()) then
    update turntally_private.pairing_requests set state = 'expired' where id = req.id;
    return jsonb_build_object('state','expired');
  end if;
  if operation = 'poll' then
    if req.polled_at > now() - interval '5 seconds' then
      return jsonb_build_object('error','Please wait before checking the code again.','code',429);
    end if;
    update turntally_private.pairing_requests set polled_at = now() where id = req.id;
    if req.state <> 'approved' then return jsonb_build_object('state',req.state); end if;
  elsif (operation = 'issued' and req.state <> 'provisioning') or
    (operation = 'activate' and (req.state <> 'issued' or actor_id is distinct from req.provision_user_id)) then
    return jsonb_build_object('error','Pairing cannot be completed. Get a new code.','code',410);
  end if;
  family_id := turntally_private.device_administrator(req.approved_by);
  if family_id is distinct from req.household_id or (req.kind = 'personal' and not exists (
    select 1 from public.turntally_households h cross join lateral jsonb_array_elements(h.snapshot->'configuration'->'people') p
    where h.id = family_id and p->>'id' = req.person_id and p->'active' is distinct from 'false'::jsonb)) then
    update turntally_private.pairing_requests set state = 'canceled' where id = req.id;
    return jsonb_build_object('state','canceled');
  end if;
  if operation = 'poll' then
    update turntally_private.pairing_requests set state = 'provisioning', lease_until = now() + interval '60 seconds' where id = req.id;
    return jsonb_build_object('state','provision', 'user_id',req.provision_user_id);
  elsif operation = 'issued' then
    update turntally_private.pairing_requests set state = 'issued' where id = req.id;
    return jsonb_build_object('state','issued');
  end if;
  -- The requester must possess the new Auth session AND the original proof.
  -- There is no active membership while a session response may be lost.
  insert into public.turntally_memberships(user_id,household_id,person_id,viewer_only)
    values(req.provision_user_id,family_id,req.person_id,true);
  insert into turntally_private.viewer_devices(user_id,household_id,person_id,name,kind)
    values(req.provision_user_id,family_id,req.person_id,req.name,req.kind);
  update turntally_private.pairing_requests set state = 'claimed' where id = req.id;
  return jsonb_build_object('state','claimed');
end;
$$;

-- Keep the original adult checks; wrap them with explicit device identity.
alter function public.turntally_load() set schema turntally_private;
alter function turntally_private.turntally_load() rename to adult_load;
revoke all on function turntally_private.adult_load() from authenticated;
create function turntally_private.authorized_load(include_snapshot boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare device turntally_private.viewer_devices; member public.turntally_memberships; family public.turntally_households; result jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into device from turntally_private.viewer_devices where user_id = auth.uid();
  if not found then
    result := turntally_private.adult_load();
  else
    select * into member from public.turntally_memberships where user_id = auth.uid() and revoked_at is null and viewer_only;
    select * into family from public.turntally_households where id = device.household_id;
    if member.user_id is null or device.revoked_at is not null or family.snapshot is null
      or member.household_id is distinct from device.household_id or member.person_id is distinct from device.person_id
      or (device.kind = 'personal' and not exists (select 1 from jsonb_array_elements(family.snapshot->'configuration'->'people') p
        where p->>'id' = device.person_id and p->'active' is distinct from 'false'::jsonb)) then
      raise exception 'This viewer device no longer has family access. Pair it again.' using errcode = '42501';
    end if;
    update turntally_private.viewer_devices set last_seen_at = now() where id = device.id and last_seen_at < now() - interval '1 minute';
    result := jsonb_build_object('household_id',family.id,'snapshot',family.snapshot,'revision',family.revision,
      'person_id',device.person_id,'role','viewer','device',jsonb_build_object('id',device.id,'name',device.name,'kind',device.kind));
  end if;
  return case when include_snapshot then result else result - 'snapshot' end;
end;
$$;
create function public.turntally_load() returns jsonb language sql security invoker set search_path = ''
  as $$ select turntally_private.authorized_load(true) $$;
create function public.turntally_access() returns jsonb language sql security invoker set search_path = ''
  as $$ select turntally_private.authorized_load(false) $$;

create function turntally_private.revoke_inactive_devices() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.turntally_memberships m set revoked_at = now()
    from turntally_private.viewer_devices d where d.user_id = m.user_id and d.household_id = new.id
    and d.kind = 'personal' and m.revoked_at is null and not exists (
      select 1 from jsonb_array_elements(new.snapshot->'configuration'->'people') p
      where p->>'id' = d.person_id and p->'active' is distinct from 'false'::jsonb);
  update turntally_private.viewer_devices d set revoked_at = m.revoked_at
    from public.turntally_memberships m where m.user_id = d.user_id and d.household_id = new.id
    and d.revoked_at is null and m.revoked_at is not null;
  return new;
end;
$$;
create trigger revoke_inactive_devices after update of snapshot on public.turntally_households
  for each row execute function turntally_private.revoke_inactive_devices();

revoke all on all functions in schema turntally_private from public, anon, authenticated;
grant execute on all functions in schema turntally_private to service_role;
grant usage on schema turntally_private to authenticated;
grant execute on function turntally_private.authorized_load(boolean) to authenticated;
revoke all on function public.turntally_device_command(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.turntally_device_command(text,uuid,jsonb) to service_role;
revoke all on function public.turntally_load(), public.turntally_access() from public,anon;
grant execute on function public.turntally_load(), public.turntally_access() to authenticated;
