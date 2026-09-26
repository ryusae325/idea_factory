-- 運営からのお知らせ（🔔通知パネル用）
create table if not exists public.announcements (
  id bigint generated always as identity primary key,
  title text not null,
  body text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.announcements enable row level security;

-- 全ユーザー: 有効なお知らせを読み取り可能
drop policy if exists announcements_select_all on public.announcements;
create policy announcements_select_all on public.announcements
  for select to authenticated
  using (is_active = true);

-- 管理者のみ投稿・編集・削除（非公開化）
drop policy if exists announcements_admin_write on public.announcements;
create policy announcements_admin_write on public.announcements
  for all to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

grant select on public.announcements to authenticated;