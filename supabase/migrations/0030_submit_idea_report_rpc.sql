create or replace function public.submit_idea_report(
  p_idea_id bigint,
  p_reason text
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_title text;
  v_report_id bigint;
begin
  if p_idea_id is null or p_idea_id <= 0 then
    raise exception 'アイデアIDが不正です' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 2000 then
    raise exception '通報内容を入力してください（2000文字以内）' using errcode = '22023';
  end if;

  select title into v_title
  from public.ideas
  where id = p_idea_id and not is_hidden;
  if not found then
    raise exception '対象の商品が見つかりません' using errcode = 'P0002';
  end if;

  insert into public.idea_reports (idea_id, idea_title, reporter_id, reason)
  values (p_idea_id, v_title, auth.uid(), btrim(p_reason))
  returning id into v_report_id;

  return v_report_id;
end;
$$;

revoke all on function public.submit_idea_report(bigint, text) from public;
grant execute on function public.submit_idea_report(bigint, text) to anon, authenticated, service_role;
