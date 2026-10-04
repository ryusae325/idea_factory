revoke all on function public.notify(uuid, text, text) from public, anon, authenticated;
grant execute on function public.notify(uuid, text, text) to postgre_admin, service_role;

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

  perform public.notify(
    auth.uid(),
    '📢 通報を受け付けました',
    '「' || v_title || '」についての情報提供を受け付けました。運営が内容を確認します。'
  );

  return v_report_id;
end;
$$;

revoke all on function public.submit_idea_report(bigint, text) from public;
grant execute on function public.submit_idea_report(bigint, text) to anon, authenticated, service_role;

create or replace function public.manage_idea_report_admin(
  p_report_id bigint,
  p_action text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_report public.idea_reports%rowtype;
  v_idea public.ideas%rowtype;
  v_rows integer;
begin
  if not public.is_admin() then
    raise exception '管理者権限が必要です' using errcode = '42501';
  end if;
  if p_action not in ('confirm', 'hide', 'publish', 'delete') then
    raise exception '操作内容が不正です' using errcode = '22023';
  end if;

  select * into v_report
  from public.idea_reports
  where id = p_report_id
  for update;
  if not found then
    raise exception '通報が見つかりません' using errcode = 'P0002';
  end if;

  if p_action = 'delete' then
    perform public.notify(
      v_report.reporter_id,
      '📢 通報の確認結果',
      '「' || v_report.idea_title || '」について確認しました。今回は対応不要と判断し、通報を整理しました。情報提供ありがとうございました。'
    );
    delete from public.idea_reports where id = p_report_id;
    return;
  end if;

  if p_action = 'confirm' then
    update public.idea_reports
    set status = '確認済み', updated_at = now()
    where id = p_report_id and status is distinct from '確認済み';
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      perform public.notify(
        v_report.reporter_id,
        '📢 通報の確認を開始しました',
        '「' || v_report.idea_title || '」についての情報を確認しています。対応状況が更新された際は、改めてお知らせします。'
      );
    end if;
    return;
  end if;

  if p_action = 'hide' then
    if v_report.idea_id is not null then
      select * into v_idea
      from public.ideas
      where id = v_report.idea_id
      for update;
    end if;

    if found and v_idea.id is not null then
      update public.ideas
      set is_hidden = true
      where id = v_idea.id and not is_hidden;
      get diagnostics v_rows = row_count;

      if v_rows > 0 then
        perform public.notify(
          v_idea.creator_id,
          '📢 商品公開停止のお知らせ',
          '「' || v_idea.title || '」は運営による確認のため、一時的に公開を停止しました。'
        );
        if v_idea.modeler_id is distinct from v_idea.creator_id then
          perform public.notify(
            v_idea.modeler_id,
            '📢 商品公開停止のお知らせ',
            '「' || v_idea.title || '」は運営による確認のため、一時的に公開を停止しました。'
          );
        end if;
      end if;
    end if;

    update public.idea_reports
    set status = '対処済み', updated_at = now()
    where id = p_report_id and status is distinct from '対処済み';
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      perform public.notify(
        v_report.reporter_id,
        '📢 通報への対応が完了しました',
        '「' || v_report.idea_title || '」について確認し、対象商品を一時的に非公開にしました。情報提供ありがとうございました。'
      );
    end if;
    return;
  end if;

  if p_action = 'publish' then
    if v_report.idea_id is not null then
      update public.ideas set is_hidden = false where id = v_report.idea_id;
    end if;
    return;
  end if;
end;
$$;

revoke all on function public.manage_idea_report_admin(bigint, text) from public, anon;
grant execute on function public.manage_idea_report_admin(bigint, text) to authenticated;

create or replace function public.request_idea_delete(p_idea_id bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
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

  if v_idea.modeler_id is null then
    if v_idea.creator_id <> auth.uid() and not public.is_admin() then
      raise exception 'モデラー未定の案件はプランナーのみ削除できます';
    end if;
    perform public.notify(
      v_idea.creator_id,
      '🗑 アイデアが削除されました',
      '「' || v_idea.title || '」が削除されました。'
    );
    delete from public.ideas where id = p_idea_id;
    return '削除しました';
  end if;

  update public.ideas
    set delete_requested_by = auth.uid(), delete_requested_at = now()
    where id = p_idea_id;

  perform public.notify(
    case when auth.uid() = v_idea.creator_id then v_idea.modeler_id else v_idea.creator_id end,
    '🗑 削除の承認依頼',
    coalesce(v_requester_name, 'ユーザー') || ' さんが「' || v_idea.title || '」の削除をリクエストしました。詳細画面から承認または確認をお願いします。'
  );
  return '削除の承認依頼を送信しました。相手が承認すると削除されます';
end;
$$;

create or replace function public.confirm_idea_delete(p_idea_id bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
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
    v_idea.creator_id,
    '🗑 アイデアが削除されました',
    coalesce(v_confirmer_name, '相手') || ' さんの承認により「' || v_idea.title || '」が削除されました。'
  );
  if v_idea.modeler_id is distinct from v_idea.creator_id then
    perform public.notify(
      v_idea.modeler_id,
      '🗑 アイデアが削除されました',
      coalesce(v_confirmer_name, '相手') || ' さんの承認により「' || v_idea.title || '」が削除されました。'
    );
  end if;

  delete from public.ideas where id = p_idea_id;
  return '承認しました。アイデアを削除しました';
end;
$$;