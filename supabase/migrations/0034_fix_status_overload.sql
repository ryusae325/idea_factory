-- 旧 update_idea_status(bigint, text) オーバーロードの早い者勝ち引き受けを無効化し、
-- 3引数版（立候補・指名制対応）へ委譲する。
create or replace function public.update_idea_status(p_idea_id bigint, p_new_status text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.update_idea_status(p_idea_id, p_new_status, null);
end;
$$;
