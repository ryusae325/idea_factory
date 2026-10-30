-- プランナー本人も自分の案件に立候補してモデラーを兼任できるようにする
create or replace function public.apply_for_idea(p_idea_id bigint, p_message text default '')
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_idea public.ideas%rowtype;
begin
  if auth.uid() is null then
    raise exception 'ログインしてください' using errcode = '42501';
  end if;
  if p_idea_id is null or p_idea_id <= 0 then
    raise exception 'アイデアIDが不正です' using errcode = '22023';
  end if;
  if coalesce(p_message, '') <> '' and char_length(btrim(p_message)) > 1000 then
    raise exception '応募メッセージは1000文字以内で入力してください' using errcode = '22023';
  end if;

  select * into v_idea from public.ideas where id = p_idea_id for update;
  if not found then
    raise exception '対象のアイデアが存在しません' using errcode = 'P0002';
  end if;
  if v_idea.status <> 'アイデア募集' then
    raise exception 'この案件は現在モデラーを募集していません' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.idea_applications where idea_id = p_idea_id and modeler_id = auth.uid()) then
    raise exception 'すでにこの案件に立候補しています' using errcode = '23505';
  end if;

  insert into public.idea_applications (idea_id, modeler_id, message)
  values (p_idea_id, auth.uid(), btrim(coalesce(p_message, '')));

  if v_idea.creator_id <> auth.uid() then
    perform public.notify(
      v_idea.creator_id,
      '🙋 新しい立候補',
      '「' || v_idea.title || '」にモデラーから立候補がありました。詳細画面から応募者を確認し、指名してください。'
    );
  end if;
  return '立候補を受け付けました。プランナーの指名をお待ちください';
end;
$$;

revoke all on function public.apply_for_idea(bigint, text) from public, anon;
grant execute on function public.apply_for_idea(bigint, text) to authenticated;
