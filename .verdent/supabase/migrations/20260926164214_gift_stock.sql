-- デジタルギフト交換の半自動化（コード在庫プール方式）
-- 運営が事前に購入したギフトコードを在庫として登録し、
-- 交換申請時に同種・同額の在庫があれば即時（自動）発行する。
-- 在庫がなければ従来どおり「未処理」申請となり、管理画面で手動発行する。

create table if not exists public.gift_code_stock (
  id bigint generated always as identity primary key,
  exchange_type text not null,
  amount integer not null check (amount > 0),
  code text not null,
  used_by uuid references public.profiles(id),
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- 同一コードの二重登録を防止
create unique index if not exists gift_code_stock_code_unique on public.gift_code_stock (code);

alter table public.gift_code_stock enable row level security;

-- 管理者のみアクセス可能（ユーザーには available_gift_amounts 経由でのみ在庫集計を公開）
drop policy if exists gift_code_stock_admin_all on public.gift_code_stock;
create policy gift_code_stock_admin_all on public.gift_code_stock
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete on public.gift_code_stock to authenticated;

-- ユーザー向け: 自動発行可能なギフトの種類・金額・在庫数（コード本体は返さない）
create or replace function public.available_gift_amounts()
returns table (exchange_type text, amount integer, stock integer)
language sql
security definer
set search_path = public
as $$
  select s.exchange_type, s.amount, count(*)::int
  from public.gift_code_stock s
  where s.used_by is null
  group by s.exchange_type, s.amount
  order by s.exchange_type, s.amount;
$$;

grant execute on function public.available_gift_amounts() to authenticated;

-- 交換申請 RPC を自動発行対応に置き換え
create or replace function public.request_exchange(p_exchange_type text, p_amount integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_code record;
begin
  perform public.expire_balance_entries();

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

  -- 在庫コードがあれば自動発行（同時申請の二重割当てを防止）
  select id, code into v_code from public.gift_code_stock
    where exchange_type = p_exchange_type
      and amount = p_amount
      and used_by is null
    order by id
    for update skip locked
    limit 1;

  if v_code is not null then
    update public.gift_code_stock
      set used_by = auth.uid(), used_at = now()
      where id = v_code.id;
    update public.profiles set balance = balance - p_amount where id = auth.uid();
    insert into public.exchange_requests (user_id, exchange_type, amount, status, gift_code)
    values (auth.uid(), p_exchange_type, p_amount, '完了', v_code.code);
    insert into public.balance_history (user_id, amount, type)
    values (auth.uid(), -p_amount, p_exchange_type || '交換');
    return 'ギフトコードを発行しました！下の交換履歴にコードを表示しました。';
  end if;

  -- 在庫がなければ従来どおりの未処理申請（管理画面で手動発行）
  update public.profiles set balance = balance - p_amount where id = auth.uid();
  insert into public.exchange_requests (user_id, exchange_type, amount)
  values (auth.uid(), p_exchange_type, p_amount);
  insert into public.balance_history (user_id, amount, type)
  values (auth.uid(), -p_amount, p_exchange_type || '交換申請');

  return '交換申請を受け付けました。在庫の準備ができ次第（通常数日以内）、履歴にギフトコードを表示します。';
end $$;