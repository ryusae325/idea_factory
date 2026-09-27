-- request_idea_delete / confirm_idea_delete のUUID比較バグ修正:
--   coalesce(modeler_id, '') は modeler_id が NULL のとき '' → uuid キャストで
--   「invalid input syntax for type uuid」エラーになるため is distinct from に置換。
--   あわせて未ログイン (auth.uid() is null) の呼び出しを拒否。

create or replace function public.request_idea_delete(p_idea_id bigint)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_idea public.ideas%rowtype;
  v_requester_name text;
begin
  if auth.uid() is null then
    raise exception 'ログインしてください';
  end if;

  select * into v_idea from public.ideas where id = p_idea_id for update;
  if not found then
    raise exception '対象のアイデアが存在しません';
  end if;
  if v_idea.creator_id <> auth.uid() and v_idea.modeler_id is distinct from auth.uid() then
    raise exception '削除リクエストはプランナーまたは担当モデラーのみ可能です';
  end if;

  select display_name, username into v_requester_name from public.profiles where id = auth.uid();

  -- モデラー未定の場合はプランナーが単独で削除
  if v_idea.modeler_id is null then
    if v_idea.creator_id <> auth.uid() and not public.is_admin() then
      raise exception 'モデラー未定の案件はプランナーのみ削除できます';
    end if;
    delete from public.ideas where id = p_idea_id;
    return '削除しました';
  end if;

  -- 相手の承認が必要
  update public.ideas
    set delete_requested_by = auth.uid(), delete_requested_at = now()
    where id = p_idea_id;

  perform public.notify(
    case when auth.uid() = v_idea.creator_id then v_idea.modeler_id else v_idea.creator_id end,
    '🗑 削除の承認依頼',
    coalesce(v_requester_name, 'ユーザー') || ' さんが「' || v_idea.title || '」の削除をリクエストしました。詳細画面から承認または確認をお願いします。'
  );
  return '削除の承認依頼を送信しました。相手が承認すると削除されます';
end $$;

create or replace function public.confirm_idea_delete(p_idea_id bigint)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_idea public.ideas%rowtype;
  v_confirmer_name text;
begin
  if auth.uid() is null then
    raise exception 'ログインしてください';
  end if;

  select * into v_idea from public.ideas where id = p_idea_id for update;
  if not found then
    raise exception '対象のアイデアが存在しません';
  end if;

  if not public.is_admin() then
    -- 相手側（リクエスト者以外のプランナー/モデラー）のみ承認できる
    if v_idea.delete_requested_by is null then
      raise exception '削除リクエストされていません';
    end if;
    if auth.uid() <> v_idea.creator_id and v_idea.modeler_id is distinct from auth.uid() then
      raise exception '削除の承認権限がありません';
    end if;
    if auth.uid() = v_idea.delete_requested_by then
      raise exception '自分のリクエストは自分で承認できません';
    end if;
  end if;

  select display_name, username into v_confirmer_name from public.profiles where id = auth.uid();

  perform public.notify(
    v_idea.delete_requested_by,
    '🗑 アイデアが削除されました',
    coalesce(v_confirmer_name, '相手') || ' さんの承認により「' || v_idea.title || '」が削除されました。'
  );

  delete from public.ideas where id = p_idea_id;
  return '承認しました。アイデアを削除しました';
end $$;