-- ほしいものリスト（ユーザーごとの商品お気に入り）
create table if not exists public.idea_favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  idea_id bigint not null references public.ideas(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, idea_id)
);

alter table public.idea_favorites enable row level security;

drop policy if exists idea_favorites_select_own on public.idea_favorites;
create policy idea_favorites_select_own on public.idea_favorites
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists idea_favorites_insert_own on public.idea_favorites;
create policy idea_favorites_insert_own on public.idea_favorites
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists idea_favorites_delete_own on public.idea_favorites;
create policy idea_favorites_delete_own on public.idea_favorites
  for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, delete on public.idea_favorites to authenticated;

-- マイページ統計: 受け取った評価の件数・平均 ＋ 自分の商品の合計売上高
create or replace function public.my_profile_stats()
returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_rating_count bigint;
  v_rating_avg numeric;
  v_total_sales bigint;
begin
  if auth.uid() is null then
    return json_build_object('rating_count', 0, 'rating_avg', 0, 'total_sales', 0);
  end if;

  select count(*), round(avg(r.stars)::numeric, 1)
    into v_rating_count, v_rating_avg
    from public.idea_ratings r
    join public.ideas i on i.id = r.idea_id
    where i.creator_id = auth.uid() or i.modeler_id = auth.uid();

  select coalesce(sum(o.price), 0)
    into v_total_sales
    from public.orders o
    join public.ideas i on i.id = o.idea_id
    where i.creator_id = auth.uid() or i.modeler_id = auth.uid();

  return json_build_object(
    'rating_count', coalesce(v_rating_count, 0),
    'rating_avg', coalesce(v_rating_avg, 0),
    'total_sales', coalesce(v_total_sales, 0)
  );
end $$;
