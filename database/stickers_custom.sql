-- NEXORA custom stickers (applied as migration nexora_custom_stickers)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stickers','stickers', true, 2097152, array['image/gif','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/gif','image/png','image/webp'];
create policy "nexora stickers upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'stickers' and (storage.foldername(name))[1] = (auth.uid())::text and public.is_active());
create policy "nexora stickers delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'stickers' and (storage.foldername(name))[1] = (auth.uid())::text);
create table public.saved_stickers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  url text not null, animated boolean not null default false, made_by_me boolean not null default false,
  created_at timestamptz not null default now(), unique (user_id, url),
  check (url like '%/storage/v1/object/public/stickers/%' and length(url) < 600));
alter table public.saved_stickers enable row level security;
create policy "saved_stickers own select" on public.saved_stickers for select to authenticated using (user_id = auth.uid());
create policy "saved_stickers own insert" on public.saved_stickers for insert to authenticated with check (user_id = auth.uid() and public.is_active());
create policy "saved_stickers own delete" on public.saved_stickers for delete to authenticated using (user_id = auth.uid());
revoke all on public.saved_stickers from anon;
grant select, insert, delete on public.saved_stickers to authenticated;
