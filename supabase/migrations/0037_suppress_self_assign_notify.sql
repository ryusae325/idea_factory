-- 自己指名（プランナー自身への指名）時は自分宛ての「指名されました」通知を送らない
create or replace function public.assign_modeler(p_idea_id bigint, p_modeler_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_idea public.ideas%rowtype;
  v_assignee_name text;
begin
  if auth.uid() is null then
    raise exception 'ログインしてください' using errcode = '42501';
  end if;
  if p_idea_id is null or p_idea_id <= 0 then
    raise exception 'アイデアIDが不正です' using errcode = '22023';
  end if;

  select * into v_idea from public.ideas where id = p_idea_id for update;
  if not found then
    raise exception '対象のアイデアが存在しません' using errcode = 'P0002';
  end if;
  if v_idea.creator_id <> auth.uid() and not public.is_admin() then
    raise exception '指名はプランナー（または運営）のみ可能です' using errcode = '42501';
  end if;
  if v_idea.status <> 'アイデア募集' then
    raise exception 'この案件は現在指名を受け付けていません' using errcode = 'P0002';
  end if;
  if p_modeler_id is null then
    raise exception '指名するモデラーを選択してください' using errcode = '22023';
  end if;
  if not exists (select 1 from public.idea_applications where idea_id = p_idea_id and modeler_id = p_modeler_id) then
    raise exception '指名できるのは立候補者の中からのみです' using errcode = 'P0002';
  end if;

  update public.idea_applications
  set status = case when modeler_id = p_modeler_id then '選定済' else '見送り' end
  where idea_id = p_idea_id;

  update public.ideas
  set status = '制作中', modeler_id = p_modeler_id
  where id = p_idea_id;

  select display_name, username into v_assignee_name
  from public.profiles where id = p_modeler_id;

  if p_modeler_id <> auth.uid() then
    perform public.notify(
      p_modeler_id,
      '🔨 指名されました',
      '「' || v_idea.title || '」のモデリングを ' || coalesce(v_assignee_name, 'モデラー') || ' さんに指名しました。案件チャットで進捗報告をお願いします。'
    );
  end if;

  perform public.notify(
    a.modeler_id,
    '📢 立候補の結果',
    '「' || v_idea.title || '」のモデリング担当には他のモデラーが選ばれました。次の機会もよろしくお願いします。'
  )
  from public.idea_applications a
  where a.idea_id = p_idea_id
    and a.modeler_id <> p_modeler_id
    and a.status = '見送り';

  return coalesce(v_assignee_name, 'モデラー') || ' さんを指名しました。モデリングを開始します';
end;
$$;

revoke all on function public.assign_modeler(bigint, uuid) from public, anon;
grant execute on function public.assign_modeler(bigint, uuid) to authenticated;
