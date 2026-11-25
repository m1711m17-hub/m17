-- NEXORA / M17 — أساس قاعدة بيانات المجموعات
-- شغّل هذا الملف مرة واحدة من Supabase Dashboard > SQL Editor.
-- رسائل المجموعات مستقلة عن جدول الرسائل الخاصة.

begin;

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  description text not null default '' check (char_length(description) <= 160),
  avatar_url text,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.group_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 2000),
  media_url text,
  media_type text check (media_type is null or media_type in ('image', 'video')),
  created_at timestamptz not null default now(),
  constraint group_message_has_content check (length(btrim(body)) > 0 or media_url is not null)
);

create index if not exists group_members_user_idx on public.group_members(user_id, joined_at desc);
create index if not exists group_messages_group_created_idx on public.group_messages(group_id, created_at desc);

create or replace function public.is_group_member(p_group_id uuid, p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members gm where gm.group_id = p_group_id and gm.user_id = p_user_id);
$$;

create or replace function public.is_group_admin(p_group_id uuid, p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members gm where gm.group_id = p_group_id and gm.user_id = p_user_id and gm.role = 'admin');
$$;

create or replace function public.create_group(p_name text, p_description text default '', p_member_ids uuid[] default '{}'::uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
begin
  if v_user is null then raise exception 'يجب تسجيل الدخول لإنشاء مجموعة'; end if;
  if char_length(v_name) < 1 or char_length(v_name) > 60 then raise exception 'اسم المجموعة يجب أن يكون بين 1 و60 حرفاً'; end if;
  if char_length(coalesce(p_description, '')) > 160 then raise exception 'وصف المجموعة أطول من المسموح'; end if;
  if coalesce(cardinality(p_member_ids), 0) > 100 then raise exception 'الحد الأقصى 100 عضو عند إنشاء المجموعة'; end if;

  insert into public.groups (name, description, created_by) values (v_name, btrim(coalesce(p_description, '')), v_user) returning id into v_id;
  insert into public.group_members (group_id, user_id, role) values (v_id, v_user, 'admin');
  insert into public.group_members (group_id, user_id, role)
  select v_id, p.id, 'member' from public.profiles p
  where p.id = any(coalesce(p_member_ids, '{}'::uuid[])) and p.id <> v_user
  on conflict (group_id, user_id) do nothing;
  return v_id;
end;
$$;

create or replace function public.add_group_members(p_group_id uuid, p_member_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if auth.uid() is null or not public.is_group_admin(p_group_id, auth.uid()) then raise exception 'إضافة الأعضاء متاحة لمشرفي المجموعة فقط'; end if;
  if coalesce(cardinality(p_member_ids), 0) > 100 then raise exception 'يمكن إضافة 100 عضو كحد أقصى في المرة الواحدة'; end if;
  insert into public.group_members (group_id, user_id, role)
  select p_group_id, p.id, 'member' from public.profiles p
  where p.id = any(coalesce(p_member_ids, '{}'::uuid[]))
  on conflict (group_id, user_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.leave_group(p_group_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_was_admin boolean;
begin
  if v_user is null then raise exception 'يجب تسجيل الدخول'; end if;
  select gm.role = 'admin' into v_was_admin from public.group_members gm where gm.group_id = p_group_id and gm.user_id = v_user;
  if not found then return false; end if;
  delete from public.group_members where group_id = p_group_id and user_id = v_user;
  if not exists (select 1 from public.group_members where group_id = p_group_id) then
    delete from public.groups where id = p_group_id;
  elsif v_was_admin and not exists (select 1 from public.group_members where group_id = p_group_id and role = 'admin') then
    update public.group_members set role = 'admin'
    where group_id = p_group_id and user_id = (
      select user_id from public.group_members where group_id = p_group_id order by joined_at asc limit 1
    );
  end if;
  return true;
end;
$$;

create or replace function public.touch_group_last_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.groups set last_message_at = new.created_at, updated_at = now() where id = new.group_id;
  return new;
end;
$$;

drop trigger if exists group_messages_touch_group on public.group_messages;
create trigger group_messages_touch_group after insert on public.group_messages
for each row execute function public.touch_group_last_message();

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_messages enable row level security;

drop policy if exists groups_read_members on public.groups;
create policy groups_read_members on public.groups for select to authenticated using (public.is_group_member(id));
drop policy if exists groups_create_self on public.groups;
create policy groups_create_self on public.groups for insert to authenticated with check (created_by = auth.uid());
drop policy if exists groups_update_admin on public.groups;
create policy groups_update_admin on public.groups for update to authenticated using (public.is_group_admin(id)) with check (public.is_group_admin(id));
drop policy if exists groups_delete_creator on public.groups;
create policy groups_delete_creator on public.groups for delete to authenticated using (created_by = auth.uid());

drop policy if exists group_members_read_members on public.group_members;
create policy group_members_read_members on public.group_members for select to authenticated using (public.is_group_member(group_id));
drop policy if exists group_members_add_admin on public.group_members;
create policy group_members_add_admin on public.group_members for insert to authenticated with check (public.is_group_admin(group_id));
drop policy if exists group_members_remove_self_or_admin on public.group_members;
create policy group_members_remove_self_or_admin on public.group_members for delete to authenticated using (user_id = auth.uid() or public.is_group_admin(group_id));

drop policy if exists group_messages_read_members on public.group_messages;
create policy group_messages_read_members on public.group_messages for select to authenticated using (public.is_group_member(group_id));
drop policy if exists group_messages_send_members on public.group_messages;
create policy group_messages_send_members on public.group_messages for insert to authenticated with check (sender_id = auth.uid() and public.is_group_member(group_id));
drop policy if exists group_messages_delete_own_or_admin on public.group_messages;
create policy group_messages_delete_own_or_admin on public.group_messages for delete to authenticated using (sender_id = auth.uid() or public.is_group_admin(group_id));

grant select, insert, update, delete on public.groups to authenticated;
grant select, insert, update, delete on public.group_members to authenticated;
grant select, insert, delete on public.group_messages to authenticated;

revoke all on function public.is_group_member(uuid, uuid) from public;
revoke all on function public.is_group_admin(uuid, uuid) from public;
revoke all on function public.create_group(text, text, uuid[]) from public;
revoke all on function public.add_group_members(uuid, uuid[]) from public;
revoke all on function public.leave_group(uuid) from public;
grant execute on function public.is_group_member(uuid, uuid) to authenticated;
grant execute on function public.is_group_admin(uuid, uuid) to authenticated;
grant execute on function public.create_group(text, text, uuid[]) to authenticated;
grant execute on function public.add_group_members(uuid, uuid[]) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'group_messages') then
    execute 'alter publication supabase_realtime add table public.group_messages';
  end if;
end;
$$;

commit;
