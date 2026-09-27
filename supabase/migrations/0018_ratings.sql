-- アイデア評価（★1〜5）。1ユーザーあたり1アイデアに1票（上書き可）
create table if not exists public.idea_ratings (
  id bigint generated always as identity primary key,
  idea_id bigint not null references public.ideas(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  stars integer not null check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (idea_id, user_id)
);

alter table public.idea_ratings enable row level security;

-- 全ユーザー: 評価の読み取り（平均・件数の集計用）
drop policy if exists idea_ratings_select_all on public.idea_ratings;
create policy idea_ratings_select_all on public.idea_ratings
  for select to authenticated
  using (true);

-- 自分の評価のみ投稿・変更・削除
drop policy if exists idea_ratings_write_own on public.idea_ratings;
create policy idea_ratings_write_own on public.idea_ratings
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists idea_ratings_update_own on public.idea_ratings;
create policy idea_ratings_update_own on public.idea_ratings
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists idea_ratings_delete_own on public.idea_ratings;
create policy idea_ratings_delete_own on public.idea_ratings
  for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.idea_ratings to authenticated;
