-- 0004: 交換申請時に失効処理を先に実行
create or replace function public.request_exchange(p_exchange_type text, p_amount integer)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_balance integer;
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

  update public.profiles set balance = balance - p_amount where id = auth.uid();
  insert into public.exchange_requests (user_id, exchange_type, amount)
  values (auth.uid(), p_exchange_type, p_amount);
  insert into public.balance_history (user_id, amount, type)
  values (auth.uid(), -p_amount, p_exchange_type || '交換申請');

  return '交換申請を受け付けました';
end $$;
