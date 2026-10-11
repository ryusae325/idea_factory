-- アレンジ依頼（選択式・半オーダー）機能
-- 販売中の商品に対し、カラー変更・パーツ追加などのオプションを定義して、
-- それをベースに新しいアイデアを投稿できるようにする。
-- 既存テーブル ideas のカラムは一切変更せず、新規テーブルで拡張する。

create table if not exists public.idea_arrangement_options (
  id bigint generated always as identity primary key,
  idea_id bigint not null references public.ideas(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  choices jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.idea_arrangement_options is '販売中商品ごとのアレンジオプション（カラー変更・パーツ追加など）';
comment on column public.idea_arrangement_options.choices is '[{ label: string, price: number }, ...]';

create index if not exists idea_arrangement_options_idea_idx
  on public.idea_arrangement_options (idea_id, id);

alter table public.idea_arrangement_options enable row level security;

revoke all on public.idea_arrangement_options from anon, authenticated;
grant select on public.idea_arrangement_options to anon, authenticated;
grant insert, update, delete on public.idea_arrangement_options to authenticated;

drop policy if exists arrangement_select_visible on public.idea_arrangement_options;
create policy arrangement_select_visible on public.idea_arrangement_options
  for select to public
  using (
    exists (
      select 1 from public.ideas i
      where i.id = idea_arrangement_options.idea_id
        and not i.is_hidden
    )
  );

drop policy if exists arrangement_manage_own on public.idea_arrangement_options;
create policy arrangement_manage_own on public.idea_arrangement_options
  for all to authenticated
  using (
    exists (
      select 1 from public.ideas i
      where i.id = idea_arrangement_options.idea_id
        and (i.creator_id = auth.uid() or public.is_admin())
    )
  )
  with check (
    exists (
      select 1 from public.ideas i
      where i.id = idea_arrangement_options.idea_id
        and (i.creator_id = auth.uid() or public.is_admin())
    )
  );

-- choices の構造を保証する単純なトリガー（自由すぎるJSONを防ぐ）
create or replace function public.check_arrangement_choices_shape()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  i integer;
  item jsonb;
  v_label text;
  v_price numeric;
begin
  if jsonb_typeof(NEW.choices) <> 'array' then
    raise exception 'choices は配列である必要があります' using errcode = '22023';
  end if;
  if jsonb_array_length(NEW.choices) = 0 then
    return NEW;
  end if;
  for i in 0 .. jsonb_array_length(NEW.choices) - 1 loop
    item := NEW.choices -> i;
    if jsonb_typeof(item) <> 'object' then
      raise exception 'choices[%] はオブジェクトである必要があります', i using errcode = '22023';
    end if;
    if not (item ? 'label' and item ? 'price') then
      raise exception 'choices[%] は label と price を含む必要があります', i using errcode = '22023';
    end if;
    v_label := item ->> 'label';
    v_price := (item ->> 'price')::numeric;
    if v_label is null or char_length(btrim(v_label)) not between 1 and 120 then
      raise exception 'choices[%].label は1〜120文字である必要があります', i using errcode = '22023';
    end if;
    if v_price < 0 or v_price > 999999 then
      raise exception 'choices[%].price は0〜999999円である必要があります', i using errcode = '22023';
    end if;
  end loop;
  return NEW;
end;
$$;

drop trigger if exists trg_check_arrangement_choices on public.idea_arrangement_options;
create trigger trg_check_arrangement_choices
  before insert or update on public.idea_arrangement_options
  for each row execute function public.check_arrangement_choices_shape();

-- 出品者が商品ごとのアレンジオプションを一括更新するための RPC
create or replace function public.upsert_arrangement_options(
  p_idea_id bigint,
  p_options jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  i integer;
  item jsonb;
  v_name text;
  v_choices jsonb;
begin
  if auth.uid() is null then
    raise exception 'ログインしてください' using errcode = '42501';
  end if;
  if p_idea_id is null or p_idea_id <= 0 then
    raise exception 'アイデアIDが不正です' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.ideas where id = p_idea_id and (creator_id = auth.uid() or public.is_admin())
  ) then
    raise exception 'この商品のアレンジオプションを編集する権限がありません' using errcode = '42501';
  end if;
  if jsonb_typeof(p_options) <> 'array' then
    raise exception 'p_options は配列である必要があります' using errcode = '22023';
  end if;

  delete from public.idea_arrangement_options where idea_id = p_idea_id;

  for i in 0 .. jsonb_array_length(p_options) - 1 loop
    item := p_options -> i;
    v_name := btrim(item ->> 'name');
    v_choices := item -> 'choices';
    if char_length(v_name) not between 1 and 120 then
      raise exception 'オプション名は1〜120文字である必要があります' using errcode = '22023';
    end if;
    if v_choices is null or jsonb_typeof(v_choices) <> 'array' then
      raise exception 'choices は配列である必要があります' using errcode = '22023';
    end if;
    insert into public.idea_arrangement_options (idea_id, name, choices)
    values (p_idea_id, v_name, v_choices);
  end loop;
end;
$$;

revoke all on function public.upsert_arrangement_options(bigint, jsonb) from public, anon;
grant execute on function public.upsert_arrangement_options(bigint, jsonb) to authenticated;
