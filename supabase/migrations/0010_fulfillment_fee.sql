-- ============================================================
-- Fulfillment fee + leaner product minimums (migration 0010)
-- 製造・配送費（購入者負担・サイズ階級別固定額）を導入し、
-- 商品価格の最低額を引き下げる。
--   fulfillment fee : S ¥900 / M ¥1,600 / L ¥2,900 / XL ¥5,500
--   product minimum : S ¥1,000 / M ¥2,000 / L ¥4,000 / XL ¥8,000
-- 分配は商品価格ベース（製造・配送費は運営の原価回収）。
-- ============================================================

alter table public.payment_sessions add column if not exists fulfillment_fee integer not null default 0;
alter table public.orders add column if not exists fulfillment_fee integer not null default 0;

-- ---------- 最低価格（階級別・損益分岐ベースに引き下げ） ----------
create or replace function public.min_physical_price_tier(p_tier text, p_mfg integer)
returns integer
language sql
immutable
as $$
  select greatest(
    case coalesce(p_tier,'S')
      when 'M' then 2000
      when 'L' then 4000
      when 'XL' then 8000
      else 1000
    end,
    coalesce(p_mfg,0) * 4
  );
$$;

alter table public.ideas drop constraint if exists ideas_size_price_guard;
alter table public.ideas
  add constraint ideas_size_price_guard
  check (price_physical >= public.min_physical_price_tier(size_tier, mfg_cost));

-- ---------- 購入コア処理（製造・配送費を注文に記録） ----------
create or replace function public.perform_buy(
  p_buyer uuid, p_idea_id bigint, p_item_type text,
  p_shipping jsonb default null, p_ffee integer default 0
)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_idea public.ideas%rowtype;
  v_price integer;
  v_fee integer;
  v_rem integer;
  v_c integer;
  v_m integer;
  v_order_id bigint;
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

  insert into public.orders (user_id, idea_id, item_type, price, shipping_status, fulfillment_fee)
  values (p_buyer, p_idea_id, p_item_type, v_price,
          case when p_item_type = 'physical' then '手配中' else '完了' end,
          case when p_item_type = 'physical' then greatest(coalesce(p_ffee,0),0) else 0 end)
  returning id into v_order_id;

  if v_order_id is not null and p_shipping is not null then
    update public.orders set
      shipping_name = coalesce(trim(p_shipping->>'name'), ''),
      shipping_postal = coalesce(trim(p_shipping->>'postal'), ''),
      shipping_address = coalesce(trim(p_shipping->>'address'), ''),
      shipping_phone = coalesce(trim(p_shipping->>'phone'), '')
    where id = v_order_id;
  end if;

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

  return format('商品（%s）を購入しました。プランナーとモデラーへ売上が分配されました。',
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
create or replace function public.complete_purchase(p_session_id text, p_shipping jsonb default null)
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
  return public.perform_buy(v_ps.user_id, v_ps.idea_id, v_ps.item_type, p_shipping, v_ps.fulfillment_fee);
end $$;

-- ---------- Webhook経由の確定処理（冪等・HMAC保護） ----------
create or replace function public.complete_purchase_webhook(p_session_id text, p_sig text, p_shipping jsonb default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_key text;
  v_ps public.payment_sessions%rowtype;
begin
  select value into v_key from public.app_config where key = 'webhook_hmac_key';
  if v_key is null or p_sig is null
     or p_sig <> encode(hmac(p_session_id, v_key, 'sha256'), 'hex') then
    raise exception 'invalid signature';
  end if;

  select * into v_ps from public.payment_sessions where id = p_session_id for update;
  if not found then
    return 'session_not_found';
  end if;
  if v_ps.processed then
    return 'already_processed';
  end if;

  update public.payment_sessions set processed = true where id = p_session_id;
  return public.perform_buy(v_ps.user_id, v_ps.idea_id, v_ps.item_type, p_shipping, v_ps.fulfillment_fee);
end $$;

grant execute on function public.complete_purchase_webhook(text, text, jsonb) to anon;
