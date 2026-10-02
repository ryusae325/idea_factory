-- ============================================================
-- Security hardening: webhook permissions and app_config isolation
-- ============================================================

-- app_config はサーバー専用の設定テーブル。一般ユーザーからは読み書き不可。
revoke all on public.app_config from anon, authenticated;

-- complete_purchase_webhook は Stripe Webhook 経由のサーバー専用処理。
-- anon からの直接呼び出しを禁止し、サービスロールキーによるサーバーからの呼び出しに限定。
-- （service_role は PUBLIC 経由で実行権限を保持するため、追加 grant は不要）
revoke execute on function public.complete_purchase_webhook(text, text, jsonb) from anon;

-- ユーザー自身の決済確定用 complete_purchase は authenticated が利用可能なまま維持。

-- 互換性のため、関数シグネチャを整理して最新の perform_buy に合わせる。
create or replace function public.complete_purchase_webhook(
  p_session_id text,
  p_sig text,
  p_shipping jsonb default null
)
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

-- authenticated ユーザーが自身の決済を確定できる complete_purchase の権限を明示的に維持
grant execute on function public.complete_purchase(text, jsonb) to authenticated;