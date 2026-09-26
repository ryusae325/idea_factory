-- 退会（アカウント削除）
-- profiles を削除すると orders / balance_history / exchange_requests / comments /
-- 投稿済み ideas が外部キーの on delete cascade で連鎖削除される。
-- 認証レコード（auth.users）は DB からは操作できないため、クライアント側でサインアウトし、
-- プロフィール不在のアカウントはフロントエンドで退会済みとして扱う。
create or replace function public.delete_my_account()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'ログインが必要です';
  end if;
  if exists (select 1 from public.profiles where id = v_uid and is_admin) then
    raise exception '運営者アカウントはこの操作では削除できません';
  end if;
  delete from public.profiles where id = v_uid;
  return '退会処理が完了しました。ご利用ありがとうございました。';
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
