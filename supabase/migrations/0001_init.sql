-- ============================================================
-- Idea Factory: schema + RLS + RPC functions (migration 0001)
-- ============================================================

-- ---------- Tables ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null default ('user_' || substr(md5(random()::text), 1, 8)),
  display_name text default '',
  role text not null default '購入者' check (role in ('考案者','モデラー','購入者','運営者')),
  balance integer not null default 0,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.ideas (
  id bigint generated always as identity primary key,
  title text not null,
  description text default '',
  image_url text default '',
  status text not null default 'アイデア募集' check (status in ('アイデア募集','制作中','販売中')),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  modeler_id uuid references public.profiles(id) on delete set null,
  creator_share integer not null default 50 check (creator_share between 0 and 100),
  modeler_share integer not null default 50 check (modeler_share between 0 and 100),
  price_physical integer not null default 3000 check (price_physical >= 0),
  price_digital integer not null default 1000 check (price_digital >= 0),
  total_sales integer not null default 0,
  platform_fee integer not null default 0,
  creator_reward integer not null default 0,
  modeler_reward integer not null default 0,
  created_at timestamptz not null default now(),
  constraint creator_share_sum check (creator_share + modeler_share = 100)
);

create table if not exists public.orders (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  idea_id bigint not null references public.ideas(id) on delete cascade,
  item_type text not null check (item_type in ('physical','digital')),
  price integer not null default 0,
  shipping_status text not null default '手配中',
  tracking_number text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.balance_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null,
  type text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.exchange_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  exchange_type text not null,
  amount integer not null check (amount > 0),
  status text not null default '未処理' check (status in ('未処理','完了')),
  gift_code text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.comments (
  id bigint generated always as identity primary key,
  idea_id bigint not null references public.ideas(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.ideas enable row level security;
alter table public.orders enable row level security;
alter table public.balance_history enable row level security;
alter table public.exchange_requests enable row level security;
alter table public.comments enable row level security;

-- ---------- Helpers ----------
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin);
$$;

-- ---------- RLS: profiles ----------
drop policy if exists profiles_select_all on public.profiles;
create policy profiles_select_all on public.profiles
  for select using (true);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and is_admin = (select p.is_admin from public.profiles p where p.id = auth.uid()));

-- ---------- RLS: ideas ----------
drop policy if exists ideas_select_all on public.ideas;
create policy ideas_select_all on public.ideas
  for select using (true);

drop policy if exists ideas_insert_own on public.ideas;
create policy ideas_insert_own on public.ideas
  for insert to authenticated
  with check (creator_id = auth.uid());

drop policy if exists ideas_update_participants on public.ideas;
create policy ideas_update_participants on public.ideas
  for update to authenticated
  using (creator_id = auth.uid() or modeler_id = auth.uid() or public.is_admin());

drop policy if exists ideas_delete_own on public.ideas;
create policy ideas_delete_own on public.ideas
  for delete to authenticated
  using (creator_id = auth.uid() or public.is_admin());

-- ---------- RLS: orders ----------
drop policy if exists orders_select_own on public.orders;
create policy orders_select_own on public.orders
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ---------- RLS: balance_history ----------
drop policy if exists balance_history_select_own on public.balance_history;
create policy balance_history_select_own on public.balance_history
  for select to authenticated
  using (user_id = auth.uid());

-- ---------- RLS: exchange_requests ----------
drop policy if exists exchange_requests_select_own on public.exchange_requests;
create policy exchange_requests_select_own on public.exchange_requests
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ---------- RLS: comments ----------
drop policy if exists comments_select_all on public.comments;
create policy comments_select_all on public.comments
  for select using (true);

drop policy if exists comments_insert_auth on public.comments;
create policy comments_insert_auth on public.comments
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists comments_delete_own on public.comments;
create policy comments_delete_own on public.comments
  for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ---------- Auth user → profile trigger ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    coalesce(nullif(left(split_part(new.email, '@', 1), 20), ''), 'user') || '_' || substr(md5(random()::text), 1, 4),
    split_part(new.email, '@', 1)
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- RPC: ステータス更新 ----------
create or replace function public.update_idea_status(p_idea_id bigint, p_new_status text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_idea public.ideas%rowtype;
begin
  if p_new_status not in ('アイデア募集','制作中','販売中') then
    raise exception '不正なステータスです';
  end if;

  select * into v_idea from public.ideas where id = p_idea_id for update;
  if not found then
    raise exception '対象のアイデアが存在しません';
  end if;

  if p_new_status = '制作中' then
    if v_idea.status <> 'アイデア募集' then
      raise exception 'この案件は現在募集を受け付けていません';
    end if;
    if v_idea.creator_id = auth.uid() then
      raise exception '自分のアイデアは自分で引き受けられません';
    end if;
    update public.ideas
      set status = '制作中', modeler_id = auth.uid()
      where id = p_idea_id;
    return 'モデリングを引き受けました';
  end if;

  if p_new_status = '販売中' then
    if v_idea.status <> '制作中' then
      raise exception '制作中の案件のみ販売開始できます';
    end if;
    if v_idea.modeler_id is null or (v_idea.modeler_id <> auth.uid() and v_idea.creator_id <> auth.uid() and not public.is_admin()) then
      raise exception '3Dデータ完成・販売開始の権限がありません';
    end if;
    update public.ideas set status = '販売中' where id = p_idea_id;
    return '3Dデータが完成し、販売を開始しました';
  end if;

  raise exception '不正なステータス遷移です';
end $$;

-- ---------- RPC: 購入 & 売上分配 ----------
create or replace function public.buy_item(p_idea_id bigint, p_item_type text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_idea public.ideas%rowtype;
  v_price integer;
  v_fee integer;
  v_rem integer;
  v_c integer;
  v_m integer;
begin
  if p_item_type not in ('physical','digital') then
    raise exception '不正な商品種別です';
  end if;

  select * into v_idea from public.ideas where id = p_idea_id for update;
  if not found then
    raise exception '商品が見つかりません';
  end if;
  if v_idea.status <> '販売中' then
    raise exception '販売中の商品のみ購入できます';
  end if;

  v_price := case when p_item_type = 'physical' then v_idea.price_physical else v_idea.price_digital end;
  v_fee := floor(v_price * 0.30);
  v_rem := v_price - v_fee;
  v_c := floor(v_rem * v_idea.creator_share / 100.0);
  v_m := v_rem - v_c;

  insert into public.orders (user_id, idea_id, item_type, price, shipping_status)
  values (auth.uid(), p_idea_id, p_item_type, v_price,
          case when p_item_type = 'physical' then '手配中' else '完了' end);

  update public.ideas
    set total_sales = total_sales + v_price,
        platform_fee = platform_fee + v_fee,
        creator_reward = creator_reward + v_c,
        modeler_reward = modeler_reward + v_m
    where id = p_idea_id;

  if v_c > 0 then
    update public.profiles set balance = balance + v_c where id = v_idea.creator_id;
    insert into public.balance_history (user_id, amount, type, expires_at)
    values (v_idea.creator_id, v_c, '売上分配', now() + interval '180 days');
  end if;

  if v_m > 0 and v_idea.modeler_id is not null then
    update public.profiles set balance = balance + v_m where id = v_idea.modeler_id;
    insert into public.balance_history (user_id, amount, type, expires_at)
    values (v_idea.modeler_id, v_m, '売上分配', now() + interval '180 days');
  end if;

  return format('商品（%s）を購入しました。考案者とモデラーへ売上が分配されました。',
    case when p_item_type = 'physical' then '物理プリント' else 'STLデータ' end);
end $$;

-- ---------- RPC: ギフト交換申請 ----------
create or replace function public.request_exchange(p_exchange_type text, p_amount integer)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_balance integer;
begin
  if p_amount < 1000 then
    raise exception '最低交換金額は1,000円です';
  end if;

  select balance into v_balance from public.profiles where id = auth.uid() for update;
  if v_balance is null then
    raise exception 'プロフィールが存在しません';
  end if;
  if v_balance < p_amount then
    raise exception '残高が不足しています';
  end if;

  update public.profiles set balance = balance - p_amount where id = auth.uid();
  insert into public.exchange_requests (user_id, exchange_type, amount)
  values (auth.uid(), p_exchange_type, p_amount);
  insert into public.balance_history (user_id, amount, type)
  values (auth.uid(), -p_amount, p_exchange_type || '交換申請');

  return '交換申請を受け付けました';
end $$;

-- ---------- RPC: 運営: 交換申請処理 ----------
create or replace function public.process_exchange(p_req_id bigint, p_gift_code text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_req public.exchange_requests%rowtype;
begin
  if not public.is_admin() then
    raise exception '管理者権限が必要です';
  end if;
  if p_gift_code is null or length(trim(p_gift_code)) = 0 then
    raise exception 'ギフトコードを入力してください';
  end if;

  select * into v_req from public.exchange_requests where id = p_req_id for update;
  if not found then
    raise exception '対象の申請が存在しません';
  end if;
  if v_req.status = '完了' then
    raise exception 'すでに処理済みの申請です';
  end if;

  update public.exchange_requests
    set status = '完了', gift_code = trim(p_gift_code)
    where id = p_req_id;

  return '申請を処理し、ギフトコードを発行しました';
end $$;

-- ---------- RPC: 運営: 配送ステータス更新 ----------
create or replace function public.update_shipping(p_order_id bigint, p_status text, p_tracking text)
returns text
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception '管理者権限が必要です';
  end if;

  update public.orders
    set shipping_status = coalesce(p_status, '手配中'),
        tracking_number = coalesce(p_tracking, '')
    where id = p_order_id;

  if not found then
    raise exception '対象の注文が存在しません';
  end if;

  return '配送ステータスを更新しました';
end $$;

-- ---------- Storage bucket & policies ----------
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', true)
on conflict (id) do nothing;

drop policy if exists uploads_public_read on storage.objects;
create policy uploads_public_read on storage.objects
  for select using (bucket_id = 'uploads');

drop policy if exists uploads_auth_insert_own on storage.objects;
create policy uploads_auth_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Grants ----------
grant usage on schema public to anon, authenticated;
grant select on public.ideas, public.comments, public.profiles to anon, authenticated;
grant select, insert, update, delete on public.comments to authenticated;
grant insert on public.ideas to authenticated;
grant update, delete on public.ideas to authenticated;
grant select on public.orders, public.balance_history, public.exchange_requests to authenticated;
