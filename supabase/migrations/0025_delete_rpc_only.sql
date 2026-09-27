-- 削除は必ず相互承認 RPC (request_idea_delete / confirm_idea_delete) 経由に限定する。
-- クライアントからの直接 DELETE（旧キャッシュ含む）を禁止し、
-- サーバー側で削除フローを強制する。

drop policy if exists "ideas_delete_own" on public.ideas;

revoke delete on table public.ideas from authenticated;
revoke delete on table public.ideas from anon;

-- 注: request_idea_delete / confirm_idea_delete は SECURITY DEFINER なので
--     関数オーナー権限で削除でき、RPC 経由のフローは影響を受けない。
