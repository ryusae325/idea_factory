-- ============================================================
-- Production readiness (migration 0003)
-- 1) STL file management (private models bucket + RLS)
-- 2) Stripe webhook completion RPC (HMAC-protected)
-- 3) Revenue expiry (180 days) processing
-- ============================================================

-- ---------- 1) STL file management ----------
alter table public.ideas add column if not exists stl_path text;

insert into storage.buckets (id, name, public)
values ('models', 'models', false)
on conflict (id) do update set public = false;

drop policy if exists models_insert_owner on storage.objects;
create policy models_insert_owner on storage.objects
  for insert to authenticated
  with check (bucket_id = 'models' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists models_select_entitled on storage.objects;
create policy models_select_entitled on storage.objects
  for select to authenticated
  using (
    bucket_id = 'models' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.ideas i
        where i.stl_path = name
          and (i.creator_id = auth.uid() or i.modeler_id = auth.uid())
      )
      or exists (
        select 1 from public.orders o
        join public.ideas i on i.id = o.idea_id
        where o.user_id = auth.uid() and o.item_type = 'digital' and i.stl_path = name
      )
      or public.is_admin()
    )
  );

-- STLパス設定（本人フォルダ配下のみ許可。モデラー/考案者/管理者のみ）
create or replace function public.set_idea_stl(p_idea_id bigint, p_path text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_idea public.ideas%rowtype;
begin
  select * into v_idea from public.ideas where id = p_idea_id;
  if not found then
    raise exception 'アイデアが見つかりません';
  end if;
  if not (v_idea.creator_id = auth.uid() or v_idea.modeler_id = auth.uid() or public.is_admin()) then
    raise exception 'STLファイルを設定する権限がありません';
  end if;
  if p_path is null or position(auth.uid()::text || '/' in p_path) <> 1 then
    raise exception '不正なファイルパスです';
  end if;

  update public.ideas set stl_path = p_path where id = p_idea_id;
  return 'STLファイルを設定しました';
end $$;

-- ---------- 2) Stripe webhook completion ----------
create table if not exists public.app_config (
  key text primary key,
  value text not null
);

revoke all on public.app_config from anon, authenticated;

insert into public.app_config (key, value)
values ('webhook_hmac_key', gen_random_uuid()::text)
on conflict (key) do nothing;

create or replace function public.complete_purchase_webhook(p_session_id text, p_sig text)
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
  return public.perform_buy(v_ps.user_id, v_ps.idea_id, v_ps.item_type);
end $$;

grant execute on function public.complete_purchase_webhook(text, text) to anon;

-- ---------- 3) Revenue expiry (180 days) ----------
alter table public.balance_history add column if not exists expired boolean not null default false;

create or replace function public.expire_balance_entries()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_row public.balance_history%rowtype;
  v_count integer := 0;
begin
  for v_row in
    select * from public.balance_history
    where user_id = auth.uid()
      and amount > 0
      and expired = false
      and expires_at is not null
      and expires_at < now()
    for update
  loop
    update public.balance_history set expired = true where id = v_row.id;
    update public.profiles set balance = balance - v_row.amount where id = v_row.user_id;
    insert into public.balance_history (user_id, amount, type)
    values (v_row.user_id, -v_row.amount, '売上失効（180日経過）');
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;