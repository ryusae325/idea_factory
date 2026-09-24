-- ============================================================
-- Stripe Checkout integration (migration 0002)
-- ============================================================

create table if not exists public.payment_sessions (
  id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  idea_id bigint not null references public.ideas(id) on delete cascade,
  item_type text not null check (item_type in ('physical','digital')),
  amount integer not null check (amount >= 0),
  processed boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.payment_sessions enable row level security;

drop policy if exists payment_sessions_select_own on public.payment_sessions;
create policy payment_sessions_select_own on public.payment_sessions
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists payment_sessions_insert_own on public.payment_sessions;
create policy payment_sessions_insert_own on public.payment_sessions
  for insert to authenticated
  with check (user_id = auth.uid());

-- ---------- 内部共通: 購入・売上分配コア処理 ----------
create or replace function public.perform_buy(p_buyer uuid, p_idea_id bigint, p_item_type text)
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
  values (p_buyer, p_idea_id, p_item_type, v_price,
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

-- ---------- 既存RPCを共通処理経由に変更 ----------
create or replace function public.buy_item(p_idea_id bigint, p_item_type text)
returns text
language plpgsql security definer set search_path = public as $$
begin
  return public.perform_buy(auth.uid(), p_idea_id, p_item_type);
end $$;

-- ---------- Stripe決済完了後の確定処理（冪等） ----------
create or replace function public.complete_purchase(p_session_id text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_ps public.payment_sessions%rowtype;
begin
  select * into v_ps from public.payment_sessions where id = p_session_id for update;
  if not found then
    raise exception '決済セッションが見つかりません';
  end if;
  if v_ps.user_id <> auth.uid() then
    raise exception 'この決済を確定する権限がありません';
  end if;
  if v_ps.processed then
    return 'すでに処理済みの決済です';
  end if;

  update public.payment_sessions set processed = true where id = p_session_id;
  return public.perform_buy(v_ps.user_id, v_ps.idea_id, v_ps.item_type);
end $$;