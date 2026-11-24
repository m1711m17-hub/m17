-- Owner-only account verification for M17
-- Apply manually in Supabase SQL Editor after reviewing this migration.
begin;

alter table public.profiles
  add column if not exists is_verified boolean not null default false;

create or replace function public.m17_guard_verified_flag()
returns trigger
language plpgsql
as $$
begin
  if new.is_verified is distinct from old.is_verified and current_user <> 'postgres' then
    raise exception 'Only the account owner can change verification status';
  end if;
  return new;
end;
$$;

drop trigger if exists m17_guard_verified_flag on public.profiles;
create trigger m17_guard_verified_flag
before update of is_verified on public.profiles
for each row execute function public.m17_guard_verified_flag();

create table if not exists public.verification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null default '' check (char_length(reason) <= 500),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_note text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create unique index if not exists verification_requests_one_pending_per_user
  on public.verification_requests(user_id) where status = 'pending';
create index if not exists verification_requests_status_created
  on public.verification_requests(status, created_at desc);

alter table public.verification_requests enable row level security;
revoke all on public.verification_requests from anon, authenticated;

create or replace function public.m17_require_owner()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'OWNER'
  ) then
    raise exception 'Only the account owner can perform this action' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.request_verification(p_reason text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and is_verified) then
    return jsonb_build_object('ok', false, 'status', 'approved', 'message', 'الحساب موثّق بالفعل');
  end if;
  insert into public.verification_requests(user_id, reason)
  values (auth.uid(), left(coalesce(p_reason, ''), 500))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'status', 'pending');
exception when unique_violation then
  return jsonb_build_object('ok', false, 'status', 'pending', 'message', 'لديك طلب توثيق قيد المراجعة');
end;
$$;

create or replace function public.my_verification_request()
returns table(request_id uuid, status text, reason text, review_note text, created_at timestamptz, reviewed_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  return query
    select r.id, r.status, r.reason, r.review_note, r.created_at, r.reviewed_at
    from public.verification_requests r
    where r.user_id = auth.uid()
    order by r.created_at desc limit 1;
end;
$$;

create or replace function public.owner_list_verification_requests()
returns table(request_id uuid, user_id uuid, username text, display_name text, avatar_url text, reason text, status text, created_at timestamptz, review_note text)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.m17_require_owner();
  return query
    select r.id, r.user_id, p.username, p.display_name, p.avatar_url, r.reason, r.status, r.created_at, r.review_note
    from public.verification_requests r
    join public.profiles p on p.id = r.user_id
    order by case when r.status = 'pending' then 0 else 1 end, r.created_at desc
    limit 200;
end;
$$;

create or replace function public.owner_list_verified_accounts()
returns table(user_id uuid, username text, display_name text, avatar_url text)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.m17_require_owner();
  return query
    select p.id, p.username, p.display_name, p.avatar_url
    from public.profiles p where p.is_verified
    order by p.username limit 500;
end;
$$;

create or replace function public.owner_review_verification(p_request_id uuid, p_approve boolean, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid; v_status text;
begin
  perform public.m17_require_owner();
  select r.user_id, r.status into v_user, v_status
    from public.verification_requests r where r.id = p_request_id for update;
  if v_user is null then raise exception 'Verification request not found'; end if;
  if v_status <> 'pending' then raise exception 'This request has already been reviewed'; end if;
  update public.verification_requests
    set status = case when p_approve then 'approved' else 'rejected' end,
        review_note = left(coalesce(p_note, ''), 500),
        reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_request_id;
  if p_approve then update public.profiles set is_verified = true where id = v_user; end if;
  return jsonb_build_object('ok', true, 'status', case when p_approve then 'approved' else 'rejected' end);
end;
$$;

create or replace function public.owner_set_verified(p_user_id uuid, p_verified boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.m17_require_owner();
  update public.profiles set is_verified = coalesce(p_verified, false) where id = p_user_id;
  if not found then raise exception 'User not found'; end if;
  return jsonb_build_object('ok', true, 'is_verified', p_verified);
end;
$$;

revoke all on function public.m17_require_owner() from public, anon, authenticated;
revoke all on function public.request_verification(text) from public, anon;
revoke all on function public.my_verification_request() from public, anon;
revoke all on function public.owner_list_verification_requests() from public, anon;
revoke all on function public.owner_list_verified_accounts() from public, anon;
revoke all on function public.owner_review_verification(uuid, boolean, text) from public, anon;
revoke all on function public.owner_set_verified(uuid, boolean) from public, anon;

grant execute on function public.request_verification(text) to authenticated;
grant execute on function public.my_verification_request() to authenticated;
grant execute on function public.owner_list_verification_requests() to authenticated;
grant execute on function public.owner_list_verified_accounts() to authenticated;
grant execute on function public.owner_review_verification(uuid, boolean, text) to authenticated;
grant execute on function public.owner_set_verified(uuid, boolean) to authenticated;

commit;
