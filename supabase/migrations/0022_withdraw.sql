-- 販売中の商品を取り下げてモデリング中に戻す（プランナーまたは運営）
create or replace function public.update_idea_status(p_idea_id bigint, p_new_status text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_idea public.ideas%rowtype;
begin
  if p_new_status not in ('アイデア募集','制作中','提出中','販売中','修正依頼','取り下げ') then
    raise exception '不正なステータスです';
  end if;

  select * into v_idea from public.ideas where id = p_idea_id for update;
  if not found then
    raise exception '対象のアイデアが存在しません';
  end if;

  if p_new_status = '制作中' then
    if v_idea.status <> 'アイデア募集' then
      raise exception 'この案件は現在募集を受け付けていません';
    end if;
    update public.ideas
      set status = '制作中', modeler_id = auth.uid()
      where id = p_idea_id;
    return 'モデリングを引き受けました';
  end if;

  -- モデラーがSTLをプランナーへ提出
  if p_new_status = '提出中' then
    if v_idea.status <> '制作中' then
      raise exception '制作中の案件のみ提出できます';
    end if;
    if v_idea.modeler_id is null or v_idea.modeler_id <> auth.uid() then
      raise exception 'モデラーのみ提出できます';
    end if;
    if coalesce(v_idea.stl_path, '') = '' then
      raise exception '3Dデータ（STL）をアップロードしてから提出してください';
    end if;
    update public.ideas set status = '提出中' where id = p_idea_id;
    return '3Dデータをプランナーへ提出しました。確認をお待ちください';
  end if;

  -- プランナーが承認して販売開始
  if p_new_status = '販売中' then
    if v_idea.status <> '提出中' then
      raise exception '提出中の案件のみ販売開始できます';
    end if;
    if v_idea.creator_id <> auth.uid() and v_idea.modeler_id <> auth.uid() and not public.is_admin() then
      raise exception '承認・販売開始の権限がありません';
    end if;
    update public.ideas set status = '販売中' where id = p_idea_id;
    return '承認しました。商品を販売中にしました';
  end if;

  -- プランナーが修正を依頼（制作中へ差し戻し）
  if p_new_status = '修正依頼' then
    if v_idea.status <> '提出中' then
      raise exception '提出中の案件のみ修正依頼できます';
    end if;
    if v_idea.creator_id <> auth.uid() and not public.is_admin() then
      raise exception '修正依頼はプランナー（または運営）のみ可能です';
    end if;
    update public.ideas set status = '制作中' where id = p_idea_id;
    insert into public.comments (idea_id, user_id, content)
    values (p_idea_id, v_idea.creator_id,
      '✏️ プランナーが修正を依頼しました。このコメント欄で内容を摺り合わせて、修正版のSTLを再提出してください。');
    return '修正を依頼しました。案件を制作中に戻しました';
  end if;

  -- 販売取り下げ（モデリング中へ戻す）
  if p_new_status = '取り下げ' then
    if v_idea.status <> '販売中' then
      raise exception '販売中の案件のみ取り下げできます';
    end if;
    if v_idea.creator_id <> auth.uid() and not public.is_admin() then
      raise exception '取り下げはプランナー（または運営）のみ可能です';
    end if;
    update public.ideas set status = '制作中' where id = p_idea_id;
    return '販売を取り下げ、モデリング中に戻しました';
  end if;

  raise exception '不正なステータス遷移です';
end $$;
