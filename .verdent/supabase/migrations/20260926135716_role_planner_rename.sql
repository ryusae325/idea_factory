-- ============================================================
-- Rename role 考案者 -> プランナー (migration 0006)
-- 1) profiles.role: update rows + refresh check constraint
-- 2) perform_buy message wording
-- ============================================================

-- ---------- 1) role値の変更 ----------
alter table public.profiles drop constraint if exists profiles_role_check;

update public.profiles set role = 'プランナー' where role = '考案者';

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('プランナー','モデラー','購入者','運営者'));

-- ---------- 2) 購入完了メッセージの表記更新 ----------
create or replace function public.perform_buy(p_buyer uuid, p_idea_id bigint, p_item_type text, p_shipping jsonb default null)
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

  insert into public.orders (user_id, idea_id, item_type, price, shipping_status)
  values (p_buyer, p_idea_id, p_item_type, v_price,
          case when p_item_type = 'physical' then '手配中' else '完了' end)
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