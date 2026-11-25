-- NEXORA groups v2: owner, invite code, join approval, member permissions, voice/sticker/reply messages
alter table public.groups
  add column if not exists owner_id uuid references public.profiles(id) on delete set null,
  add column if not exists invite_code text,
  add column if not exists join_by_link boolean not null default true,
  add column if not exists require_approval boolean not null default false,
  add column if not exists members_can_add boolean not null default true;
update public.groups set owner_id = created_by where owner_id is null;
update public.groups set invite_code = substr(md5(random()::text || clock_timestamp()::text || id::text), 1, 10) where invite_code is null;
alter table public.groups alter column invite_code set default substr(md5(random()::text || clock_timestamp()::text), 1, 10);
alter table public.groups alter column invite_code set not null;
create unique index if not exists groups_invite_code_key on public.groups(invite_code);

alter table public.group_members
  add column if not exists muted boolean not null default false,
  add column if not exists pinned boolean not null default false;

alter table public.group_messages
  add column if not exists reply_to uuid references public.group_messages(id) on delete set null,
  add column if not exists audio_url text,
  add column if not exists audio_ms integer,
  add column if not exists audio_wave text,
  add column if not exists sticker text;
alter table public.group_messages drop constraint if exists group_message_has_content;
alter table public.group_messages add constraint group_message_has_content
  check (length(btrim(body)) > 0 or media_url is not null or audio_url is not null or sticker is not null);

create table if not exists public.group_join_requests (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
alter table public.group_join_requests enable row level security;
drop policy if exists gjr_read on public.group_join_requests;
create policy gjr_read on public.group_join_requests for select to authenticated
  using (user_id = auth.uid() or public.is_group_admin(group_id));
grant select on public.group_join_requests to authenticated;

-- direct writes are replaced by RPCs (so roles/owner/invite cannot be forged from the client)
drop policy if exists groups_create_self on public.groups;
drop policy if exists groups_delete_creator on public.groups;
drop policy if exists group_members_add_admin on public.group_members;
drop policy if exists group_members_remove_self_or_admin on public.group_members;
drop policy if exists group_members_update_self on public.group_members;
revoke insert, delete, update on public.groups from authenticated;
revoke insert, delete, update on public.group_members from authenticated;
grant update (name, description, avatar_url) on public.groups to authenticated;
grant update (muted, pinned) on public.group_members to authenticated;
create policy group_members_update_self on public.group_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists group_messages_send_members on public.group_messages;
create policy group_messages_send_members on public.group_messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_group_member(group_id)
    and (reply_to is null or exists (select 1 from public.group_messages r where r.id = reply_to and r.group_id = group_messages.group_id)));

create or replace function public.is_group_owner(p_group_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.groups g where g.id = p_group_id and g.owner_id = auth.uid());
$$;

create or replace function public.create_group(p_name text, p_description text default '', p_member_ids uuid[] default '{}'::uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_user uuid := auth.uid(); v_name text := btrim(coalesce(p_name, ''));
begin
  if v_user is null then raise exception 'يجب تسجيل الدخول لإنشاء مجموعة'; end if;
  if char_length(v_name) < 1 or char_length(v_name) > 60 then raise exception 'اسم المجموعة يجب أن يكون بين 1 و60 حرفاً'; end if;
  if char_length(coalesce(p_description, '')) > 160 then raise exception 'وصف المجموعة أطول من المسموح'; end if;
  if coalesce(cardinality(p_member_ids), 0) > 100 then raise exception 'الحد الأقصى 100 عضو عند إنشاء المجموعة'; end if;
  insert into public.groups (name, description, created_by, owner_id) values (v_name, btrim(coalesce(p_description, '')), v_user, v_user) returning id into v_id;
  insert into public.group_members (group_id, user_id, role) values (v_id, v_user, 'admin');
  insert into public.group_members (group_id, user_id, role)
  select v_id, p.id, 'member' from public.profiles p
  where p.id = any(coalesce(p_member_ids, '{}'::uuid[])) and p.id <> v_user on conflict do nothing;
  return v_id;
end $$;

create or replace function public.add_group_members(p_group_id uuid, p_member_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer := 0; v_g public.groups; v_admin boolean;
begin
  if auth.uid() is null or not public.is_group_member(p_group_id) then raise exception 'يجب أن تكون عضواً في المجموعة'; end if;
  select * into v_g from public.groups where id = p_group_id;
  v_admin := public.is_group_admin(p_group_id);
  if not v_admin and not v_g.members_can_add then raise exception 'إضافة الأعضاء متاحة للمشرفين فقط في هذه المجموعة'; end if;
  if coalesce(cardinality(p_member_ids), 0) > 100 then raise exception 'يمكن إضافة 100 عضو كحد أقصى في المرة الواحدة'; end if;
  if (select count(*) from public.group_members where group_id = p_group_id) >= 1000 then raise exception 'المجموعة وصلت للحد الأقصى (1000 عضو)'; end if;
  if v_admin or not v_g.require_approval then
    insert into public.group_members (group_id, user_id, role)
    select p_group_id, p.id, 'member' from public.profiles p where p.id = any(coalesce(p_member_ids, '{}'::uuid[])) on conflict do nothing;
    get diagnostics v_count = row_count;
    delete from public.group_join_requests where group_id = p_group_id and user_id = any(coalesce(p_member_ids, '{}'::uuid[]));
  else
    insert into public.group_join_requests (group_id, user_id, invited_by)
    select p_group_id, p.id, auth.uid() from public.profiles p
    where p.id = any(coalesce(p_member_ids, '{}'::uuid[]))
      and not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = p.id) on conflict do nothing;
    get diagnostics v_count = row_count;
  end if;
  return v_count;
end $$;

create or replace function public.join_group_by_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_g public.groups;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول'; end if;
  select * into v_g from public.groups where invite_code = lower(btrim(coalesce(p_code, '')));
  if not found or not v_g.join_by_link then raise exception 'رمز الدعوة غير صالح أو معطّل'; end if;
  if exists (select 1 from public.group_members where group_id = v_g.id and user_id = auth.uid()) then
    return jsonb_build_object('status', 'already', 'group_id', v_g.id, 'name', v_g.name);
  end if;
  if (select count(*) from public.group_members where group_id = v_g.id) >= 1000 then raise exception 'المجموعة ممتلئة'; end if;
  if v_g.require_approval then
    insert into public.group_join_requests (group_id, user_id) values (v_g.id, auth.uid()) on conflict do nothing;
    return jsonb_build_object('status', 'pending', 'group_id', v_g.id, 'name', v_g.name);
  end if;
  insert into public.group_members (group_id, user_id, role) values (v_g.id, auth.uid(), 'member') on conflict do nothing;
  return jsonb_build_object('status', 'joined', 'group_id', v_g.id, 'name', v_g.name);
end $$;

create or replace function public.review_join_request(p_group_id uuid, p_user_id uuid, p_approve boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_group_admin(p_group_id) then raise exception 'متاح لمشرفي المجموعة فقط'; end if;
  if not exists (select 1 from public.group_join_requests where group_id = p_group_id and user_id = p_user_id) then return false; end if;
  if p_approve then insert into public.group_members (group_id, user_id, role) values (p_group_id, p_user_id, 'member') on conflict do nothing; end if;
  delete from public.group_join_requests where group_id = p_group_id and user_id = p_user_id;
  return true;
end $$;

create or replace function public.update_group_settings(p_group_id uuid, p_join_by_link boolean, p_require_approval boolean, p_members_can_add boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_group_admin(p_group_id) then raise exception 'متاح لمشرفي المجموعة فقط'; end if;
  update public.groups set join_by_link = coalesce(p_join_by_link, join_by_link), require_approval = coalesce(p_require_approval, require_approval),
    members_can_add = coalesce(p_members_can_add, members_can_add), updated_at = now() where id = p_group_id;
end $$;

create or replace function public.regenerate_group_invite(p_group_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v text := substr(md5(random()::text || clock_timestamp()::text), 1, 10);
begin
  if auth.uid() is null or not public.is_group_admin(p_group_id) then raise exception 'متاح لمشرفي المجموعة فقط'; end if;
  update public.groups set invite_code = v where id = p_group_id;
  return v;
end $$;

create or replace function public.set_group_role(p_group_id uuid, p_user_id uuid, p_role text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  if auth.uid() is null or not public.is_group_admin(p_group_id) then raise exception 'متاح لمشرفي المجموعة فقط'; end if;
  if p_role not in ('admin','member') then raise exception 'دور غير صالح'; end if;
  select owner_id into v_owner from public.groups where id = p_group_id;
  if p_user_id = v_owner then raise exception 'لا يمكن تغيير صلاحية مالك المجموعة'; end if;
  if p_role = 'member' and not public.is_group_owner(p_group_id) then raise exception 'إزالة المشرفين متاحة لمالك المجموعة فقط'; end if;
  if p_role = 'admin' and (select count(*) from public.group_members where group_id = p_group_id and role = 'admin' and user_id <> v_owner) >= 5 then
    raise exception 'الحد الأقصى 5 مسؤولين'; end if;
  update public.group_members set role = p_role where group_id = p_group_id and user_id = p_user_id;
  return found;
end $$;

create or replace function public.remove_group_member(p_group_id uuid, p_user_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_role text;
begin
  if auth.uid() is null or not public.is_group_admin(p_group_id) then raise exception 'متاح لمشرفي المجموعة فقط'; end if;
  select owner_id into v_owner from public.groups where id = p_group_id;
  if p_user_id = v_owner then raise exception 'لا يمكن إزالة مالك المجموعة'; end if;
  select role into v_role from public.group_members where group_id = p_group_id and user_id = p_user_id;
  if v_role = 'admin' and not public.is_group_owner(p_group_id) then raise exception 'إزالة المشرفين متاحة لمالك المجموعة فقط'; end if;
  delete from public.group_members where group_id = p_group_id and user_id = p_user_id;
  return found;
end $$;

create or replace function public.transfer_group_owner(p_group_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_group_owner(p_group_id) then raise exception 'متاح لمالك المجموعة فقط'; end if;
  if not exists (select 1 from public.group_members where group_id = p_group_id and user_id = p_user_id) then raise exception 'العضو غير موجود في المجموعة'; end if;
  update public.group_members set role = 'admin' where group_id = p_group_id and user_id = p_user_id;
  update public.groups set owner_id = p_user_id, updated_at = now() where id = p_group_id;
end $$;

create or replace function public.delete_group(p_group_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_group_owner(p_group_id) then raise exception 'متاح لمالك المجموعة فقط'; end if;
  delete from public.groups where id = p_group_id;
end $$;

drop function if exists public.leave_group(uuid);
create or replace function public.leave_group(p_group_id uuid, p_new_owner uuid default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_next uuid;
begin
  if v_user is null then raise exception 'يجب تسجيل الدخول'; end if;
  if not exists (select 1 from public.group_members where group_id = p_group_id and user_id = v_user) then return false; end if;
  if public.is_group_owner(p_group_id) then
    select user_id into v_next from public.group_members where group_id = p_group_id and user_id = p_new_owner and user_id <> v_user;
    if v_next is null then
      select user_id into v_next from public.group_members where group_id = p_group_id and user_id <> v_user order by (role = 'admin') desc, joined_at asc limit 1;
    end if;
    if v_next is null then
      delete from public.groups where id = p_group_id; return true;
    end if;
    update public.group_members set role = 'admin' where group_id = p_group_id and user_id = v_next;
    update public.groups set owner_id = v_next where id = p_group_id;
  end if;
  delete from public.group_members where group_id = p_group_id and user_id = v_user;
  if not exists (select 1 from public.group_members where group_id = p_group_id) then delete from public.groups where id = p_group_id; end if;
  return true;
end $$;

do $$
declare f text;
begin
  foreach f in array array['is_group_owner(uuid)','join_group_by_code(text)','review_join_request(uuid,uuid,boolean)','update_group_settings(uuid,boolean,boolean,boolean)',
    'regenerate_group_invite(uuid)','remove_group_member(uuid,uuid)','transfer_group_owner(uuid,uuid)','delete_group(uuid)','leave_group(uuid,uuid)',
    'set_group_role(uuid,uuid,text)','add_group_members(uuid,uuid[])','create_group(text,text,uuid[])'] loop
    execute format('revoke execute on function public.%s from anon, public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

do $$ begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') and not exists (
    select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='group_members') then
    execute 'alter publication supabase_realtime add table public.group_members';
  end if;
end $$;
