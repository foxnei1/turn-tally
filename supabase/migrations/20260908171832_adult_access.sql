-- Account access is independent of the family snapshot and backup format.
alter table public.turntally_memberships add column session_cutoff timestamptz;
alter table public.turntally_memberships add column access_generation bigint not null default 0;
alter table turntally_private.pairing_requests add column approved_session_id uuid;

create table turntally_private.adult_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  code_hash text not null unique,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp() + interval '10 minutes',
  state text not null default 'pending' check (state in ('pending','approved','canceled','expired','denied')),
  household_id uuid references public.turntally_households(id),
  person_id text,
  approved_by uuid references auth.users(id) on delete set null,
  access_generation bigint,
  polled_at timestamptz
);
create index adult_requests_user_idx on turntally_private.adult_requests(user_id);
create index adult_requests_expiry_idx on turntally_private.adult_requests(expires_at);
create index adult_requests_household_idx on turntally_private.adult_requests(household_id);
create index adult_requests_approver_idx on turntally_private.adult_requests(approved_by);
create unique index adult_requests_pending_idx on turntally_private.adult_requests(user_id) where state = 'pending';
alter table turntally_private.adult_requests enable row level security;
revoke all on turntally_private.adult_requests from public, anon, authenticated;
grant all on turntally_private.adult_requests to service_role;

-- A refreshed token retains its original session ID. JWT iat is insufficient.
create function turntally_private.adult_session_valid(actor uuid, sid uuid, require_session boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select actor is not null and (
    (not require_session and not exists (select 1 from public.turntally_memberships m where m.user_id = actor and m.session_cutoff is not null))
    or exists (select 1 from auth.sessions s left join public.turntally_memberships m on m.user_id = s.user_id
      where s.id = sid and s.user_id = actor and (m.session_cutoff is null or s.created_at > m.session_cutoff))
  )
$$;
create function turntally_private.current_session_id() returns uuid language sql stable set search_path = '' as $$
  select nullif(auth.jwt()->>'session_id','')::uuid
$$;

alter function turntally_private.adult_load() rename to legacy_adult_load;
create function turntally_private.adult_load() returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not turntally_private.adult_session_valid(auth.uid(),turntally_private.current_session_id()) then
    raise exception 'Sign in again to check family access.' using errcode = '42501';
  end if;
  return turntally_private.legacy_adult_load();
end;
$$;

alter function public.turntally_save(integer,jsonb,text,text) set schema turntally_private;
alter function turntally_private.turntally_save(integer,jsonb,text,text) rename to snapshot_save;
create function turntally_private.authorized_save(expected_revision integer, proposed_snapshot jsonb, operation text, administrator_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  -- Serialize with revocation before checking the cutoff, then retain the
  -- existing revision, role, last-administrator, and snapshot validation.
  perform 1 from public.turntally_households where id = (select household_id from public.turntally_memberships where user_id = auth.uid()) for update;
  if not turntally_private.adult_session_valid(auth.uid(),turntally_private.current_session_id()) then
    raise exception 'Sign in again to check family access.' using errcode = '42501';
  end if;
  return turntally_private.snapshot_save(expected_revision,proposed_snapshot,operation,administrator_id);
end;
$$;
create function public.turntally_save(expected_revision integer, proposed_snapshot jsonb, operation text default 'edit', administrator_id text default null)
returns jsonb language sql security invoker set search_path = '' as $$
  select turntally_private.authorized_save(expected_revision,proposed_snapshot,operation,administrator_id)
$$;

create function turntally_private.revoke_inactive_adults() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.snapshot is null then return new; end if;
  update public.turntally_memberships m set revoked_at = clock_timestamp(), session_cutoff = clock_timestamp(), access_generation = access_generation + 1
  where m.household_id = new.id and not m.viewer_only and m.revoked_at is null
    and not exists (select 1 from jsonb_array_elements(new.snapshot->'configuration'->'people') p
      where p->>'id' = m.person_id and p->'active' is distinct from 'false'::jsonb);
  return new;
end;
$$;
create trigger revoke_inactive_adults after update of snapshot on public.turntally_households
  for each row execute function turntally_private.revoke_inactive_adults();

-- Preserve the viewer coordinator, but bind management and outstanding
-- approvals to the verified administrator session. Acquire the family lock
-- before its request rows, matching save/deactivation lock ordering.
alter function public.turntally_device_command(text,uuid,jsonb) set schema turntally_private;
alter function turntally_private.turntally_device_command(text,uuid,jsonb) rename to legacy_device_command;
create function public.turntally_device_command(operation text, actor_id uuid default null, payload jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare family_id uuid; req turntally_private.pairing_requests; result jsonb; sid uuid;
begin
  perform pg_advisory_xact_lock(842173091);
  if operation in ('list','lookup','approve','deny','rename','revoke') then
    family_id := turntally_private.device_administrator(actor_id);
    sid := nullif(payload->>'actor_session_id','')::uuid;
    if not turntally_private.adult_session_valid(actor_id,sid) then raise exception 'Sign in again.' using errcode = '42501'; end if;
  elsif operation in ('poll','issued','activate') then
    select * into req from turntally_private.pairing_requests where id = (payload->>'id')::uuid and proof_hash = payload->>'proof_hash';
    if req.household_id is not null then
      perform 1 from public.turntally_households where id = req.household_id for update;
      if not turntally_private.adult_session_valid(req.approved_by,req.approved_session_id) then
        update turntally_private.pairing_requests set state = 'canceled' where id = req.id and state in ('approved','provisioning','issued');
        return jsonb_build_object('state','canceled');
      end if;
    end if;
  end if;
  result := turntally_private.legacy_device_command(operation,actor_id,payload);
  if operation = 'approve' and result->>'state' = 'approved' then
    update turntally_private.pairing_requests set approved_session_id = sid where code_hash = payload->>'code_hash';
  end if;
  return result;
end;
$$;

create function turntally_private.adult_command(operation text, payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); sid uuid := turntally_private.current_session_id(); family_id uuid;
  req turntally_private.adult_requests; member public.turntally_memberships; target public.turntally_memberships;
  result jsonb; person jsonb; code text := ''; bytes bytea; i integer; duplicates integer;
begin
  perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
  if actor is null or not exists (select 1 from auth.sessions where id = sid and user_id = actor) then
    raise exception 'Sign in again to continue.' using errcode = '42501';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' or octet_length(payload::text) > 2048 then
    return jsonb_build_object('error','Invalid access request.','code',400);
  end if;
  if exists (select 1 from turntally_private.viewer_devices where user_id = actor)
    or exists (select 1 from public.turntally_memberships where user_id = actor and viewer_only)
    or exists (select 1 from auth.users where id = actor and raw_app_meta_data->'turntally_viewer' = 'true'::jsonb) then
    raise exception 'Viewer devices cannot link adult accounts.' using errcode = '42501';
  end if;
  -- Same shared lock as viewer operations; avoids two households concurrently
  -- admitting the same previously unlinked identity. Saves use household locks.
  perform pg_advisory_xact_lock(842173091);
  select * into member from public.turntally_memberships where user_id = actor;
  if operation = 'eligibility' then
    return jsonb_build_object('state',case
      when not turntally_private.adult_session_valid(actor,sid,true) then 'signin_required'
      when member.user_id is null or member.revoked_at is not null then 'eligible' else 'linked' end);
  end if;
  if not turntally_private.adult_session_valid(actor,sid,true) then
    raise exception 'Sign in again before requesting access.' using errcode = '42501';
  end if;
  if operation in ('list','lookup','approve','deny','revoke') then
    family_id := turntally_private.device_administrator(actor);
    -- Revocation may have committed while waiting for the family lock.
    if not turntally_private.adult_session_valid(actor,sid,true) then raise exception 'Sign in again.' using errcode = '42501'; end if;
  end if;
  if operation = 'start' then
    if member.user_id is not null and member.revoked_at is null then return jsonb_build_object('error','This account is already linked.','code',409); end if;
    delete from turntally_private.adult_requests where id in (select id from turntally_private.adult_requests where expires_at < now() - interval '7 days' limit 100);
    delete from turntally_private.pairing_limits where bucket in (select bucket from turntally_private.pairing_limits where started_at < now() - interval '1 day' limit 100);
    update turntally_private.adult_requests set state = 'expired' where state = 'pending' and expires_at <= now();
    if not turntally_private.pairing_limit('adult:start:' || actor::text,5)
      or (select count(*) from turntally_private.adult_requests where state = 'pending') >= 100
      or (select count(*) from turntally_private.adult_requests) >= 5000 then
      return jsonb_build_object('error','Too many linking requests. Try again in 15 minutes.','code',429);
    end if;
    update turntally_private.adult_requests set state = 'canceled' where user_id = actor and state = 'pending';
    bytes := sha256(convert_to(gen_random_uuid()::text,'UTF8'));
    for i in 0..7 loop code := code || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',(get_byte(bytes,i) % 32)+1,1); end loop;
    insert into turntally_private.adult_requests(user_id,session_id,code_hash)
      values(actor,sid,encode(sha256(convert_to(code,'UTF8')),'hex')) returning * into req;
    return jsonb_build_object('id',req.id,'code',substr(code,1,4)||'-'||substr(code,5),'state',req.state,'expires_at',req.expires_at);
  end if;
  if operation in ('status','cancel') then
    select * into req from turntally_private.adult_requests where id = (payload->>'id')::uuid and user_id = actor and session_id = sid;
    if not found then return jsonb_build_object('error','Linking request unavailable. Get a new code.','code',410); end if;
    if req.state = 'pending' and (operation = 'cancel' or req.expires_at <= now()) then
      update turntally_private.adult_requests set state = case when operation = 'cancel' then 'canceled' else 'expired' end where id = req.id returning * into req;
    end if;
    if req.state = 'approved' and not exists (select 1 from public.turntally_memberships m where m.user_id = actor and m.revoked_at is null and m.access_generation = req.access_generation) then
      return jsonb_build_object('state','canceled');
    end if;
    if operation = 'status' and req.state = 'pending' then
      if req.polled_at > now() - interval '5 seconds' then return jsonb_build_object('error','Please wait before checking again.','code',429); end if;
      update turntally_private.adult_requests set polled_at = now() where id = req.id;
    end if;
    return jsonb_build_object('state',req.state);
  end if;
  if operation = 'list' then
    select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'person_id',m.person_id,'person_name',p->>'name','email',u.email,
      'role',p->>'role','revoked_at',m.revoked_at,'protected',m.user_id = actor or m.user_id = h.owner_user_id) order by u.email),'[]'::jsonb)
      into result from public.turntally_memberships m join auth.users u on u.id = m.user_id
      join public.turntally_households h on h.id = m.household_id
      left join lateral jsonb_array_elements(h.snapshot->'configuration'->'people') p on p->>'id' = m.person_id
      where m.household_id = family_id and not m.viewer_only and not exists (select 1 from turntally_private.viewer_devices d where d.user_id = m.user_id);
    return jsonb_build_object('accounts',result,'people',(select coalesce(jsonb_agg(p),'[]'::jsonb) from public.turntally_households h cross join lateral jsonb_array_elements(h.snapshot->'configuration'->'people') p where h.id = family_id and p->'active' is distinct from 'false'::jsonb and p->>'role' in ('editor','administrator')));
  end if;
  if operation = 'revoke' then
    select * into target from public.turntally_memberships where user_id = (payload->>'user_id')::uuid and household_id = family_id and not viewer_only;
    if not found or target.user_id = actor or target.user_id = (select owner_user_id from public.turntally_households where id = family_id) then
      return jsonb_build_object('error','This login cannot be revoked here. Keep another administrator with a linked sign-in.','code',409);
    end if;
    if not exists (select 1 from public.turntally_memberships m join public.turntally_households h on h.id = m.household_id
      cross join lateral jsonb_array_elements(h.snapshot->'configuration'->'people') p
      where h.id = family_id and m.user_id <> target.user_id and m.revoked_at is null and not m.viewer_only
      and p->>'id' = m.person_id and p->>'role' = 'administrator' and p->'active' is distinct from 'false'::jsonb) then
      return jsonb_build_object('error','Keep an active administrator with a linked sign-in.','code',409);
    end if;
    update public.turntally_memberships set revoked_at = clock_timestamp(), session_cutoff = clock_timestamp(), access_generation = access_generation + 1 where user_id = target.user_id and revoked_at is null;
    return jsonb_build_object('state','revoked');
  end if;
  if operation not in ('lookup','approve','deny') then return jsonb_build_object('error','Unknown access operation.','code',400); end if;
  if not turntally_private.pairing_limit('adult:lookup:' || actor::text,10) then return jsonb_build_object('error','Too many code attempts. Try again in 15 minutes.','code',429); end if;
  code := upper(regexp_replace(coalesce(payload->>'code',''),'[[:space:]-]','','g'));
  select * into req from turntally_private.adult_requests where code_hash = encode(sha256(convert_to(code,'UTF8')),'hex');
  if not found then return jsonb_build_object('error','Code unavailable or expired. Get a new code.','code',410); end if;
  select * into target from public.turntally_memberships where user_id = req.user_id;
  if operation = 'approve' and req.state = 'approved' and req.household_id = family_id and req.person_id = payload->>'person_id'
    and target.revoked_at is null and target.access_generation = req.access_generation then return jsonb_build_object('state','approved'); end if;
  if req.state <> 'pending' or req.expires_at <= now() or not turntally_private.adult_session_valid(req.user_id,req.session_id,true)
    or (target.user_id is not null and (target.household_id <> family_id or target.revoked_at is null))
    or target.viewer_only or exists (select 1 from turntally_private.viewer_devices where user_id = req.user_id)
    or exists (select 1 from auth.users where id = req.user_id and raw_app_meta_data->'turntally_viewer' = 'true'::jsonb) then
    return jsonb_build_object('error','Code unavailable or account ineligible. Get a new code.','code',410);
  end if;
  if operation = 'lookup' then return jsonb_build_object('email',(select email from auth.users where id = req.user_id),'expires_at',req.expires_at); end if;
  if operation = 'deny' then update turntally_private.adult_requests set state = 'denied' where id = req.id; return jsonb_build_object('state','denied'); end if;
  select p into person from public.turntally_households h cross join lateral jsonb_array_elements(h.snapshot->'configuration'->'people') p
    where h.id = family_id and p->>'id' = payload->>'person_id' and p->>'role' in ('editor','administrator') and p->'active' is distinct from 'false'::jsonb;
  if person is null then return jsonb_build_object('error','Choose an active editor or administrator.','code',400); end if;
  select count(*) into duplicates from public.turntally_memberships where household_id = family_id and person_id = person->>'id' and revoked_at is null and not viewer_only;
  if duplicates > 0 and payload->'confirm_additional' is distinct from 'true'::jsonb then return jsonb_build_object('error','Confirm adding another login for this person.','code',409); end if;
  insert into public.turntally_memberships(user_id,household_id,person_id,access_generation)
    values(req.user_id,family_id,person->>'id',1)
    on conflict (user_id) do update set person_id = excluded.person_id, revoked_at = null, access_generation = public.turntally_memberships.access_generation + 1
    returning * into target;
  update turntally_private.adult_requests set state = 'approved', household_id = family_id, person_id = target.person_id,
    approved_by = actor, access_generation = target.access_generation where id = req.id;
  return jsonb_build_object('state','approved');
end;
$$;
create function public.turntally_adult_command(operation text, payload jsonb default '{}') returns jsonb
language sql security invoker set search_path = '' as $$ select turntally_private.adult_command(operation,payload) $$;

revoke all on function turntally_private.legacy_adult_load(), turntally_private.adult_load(), turntally_private.adult_session_valid(uuid,uuid,boolean), turntally_private.current_session_id(), turntally_private.snapshot_save(integer,jsonb,text,text), turntally_private.authorized_save(integer,jsonb,text,text), turntally_private.revoke_inactive_adults(), turntally_private.legacy_device_command(text,uuid,jsonb), turntally_private.adult_command(text,jsonb) from public,anon,authenticated;
grant execute on function turntally_private.adult_session_valid(uuid,uuid,boolean), turntally_private.legacy_device_command(text,uuid,jsonb) to service_role;
grant execute on function turntally_private.authorized_save(integer,jsonb,text,text), turntally_private.adult_command(text,jsonb) to authenticated;
revoke all on function public.turntally_save(integer,jsonb,text,text), public.turntally_adult_command(text,jsonb) from public,anon;
grant execute on function public.turntally_save(integer,jsonb,text,text), public.turntally_adult_command(text,jsonb) to authenticated;
revoke all on function public.turntally_device_command(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.turntally_device_command(text,uuid,jsonb) to service_role;
