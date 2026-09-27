-- 工程進捗のパーソナル通知 + 修正依頼・取り下げ時のコメント必須化

-- ---------- 通知テーブル（🔔に表示する進捗通知） ----------
create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications (user_id, id desc);

alter table public.notifications enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

grant select on public.notifications to authenticated;

-- 通知作成ヘルパー（RPC 内からのみ使用）
create or replace function public.notify(p_user uuid, p_title text, p_body text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, title, body)
  select p_user, p_title, p_body
  where p_user is not null;
$$;

-- ---------- ステータス遷移 RPC（コメント必須化 + 通知） ----------
create or replace function public.update_idea_status(p_idea_id bigint, p_new_status text, p_comment text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_idea public.ideas%rowtype;
  v_actor_name text;
begin
  if p_new_status not in ('アイデア募集','制作中','提出中','販売中','修正依頼','取り下げ') then
    raise exception '不正なステータスです';
  end if;

  select display_name, username into v_actor_name
    from public.profiles where id = auth.uid();

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
    perform public.notify(
      v_idea.creator_id,
      '🔨 モデリング開始',
      'あなたのアイデア「' || v_idea.title || '」を ' || coalesce(v_actor_name, 'モデラー') || ' さんがモデリング開始しました。'
    );
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
    perform public.notify(
      v_idea.creator_id,
      '📤 3Dデータが提出されました',
      '「' || v_idea.title || '」に3Dデータが提出されました。確認して承認または修正依頼をお願いします。'
    );
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
    perform public.notify(
      v_idea.modeler_id,
      '🎉 販売開始',
      '「' || v_idea.title || '」が承認され、商品カタログに掲載されました。'
    );
    perform public.notify(
      case when v_idea.creator_id <> auth.uid() then v_idea.creator_id end,
      '🎉 販売開始',
      '「' || v_idea.title || '」が承認され、商品カタログに掲載されました。'
    );
    return '承認しました。商品を販売中にしました';
  end if;

  -- プランナーが修正を依頼（コメント必須・制作中へ差し戻し）
  if p_new_status = '修正依頼' then
    if v_idea.status <> '提出中' then
      raise exception '提出中の案件のみ修正依頼できます';
    end if;
    if v_idea.creator_id <> auth.uid() and not public.is_admin() then
      raise exception '修正依頼はプランナー（または運営）のみ可能です';
    end if;
    if coalesce(trim(p_comment), '') = '' then
      raise exception '修正依頼の内容をコメントとして入力してください';
    end if;
    insert into public.comments (idea_id, user_id, content)
    values (p_idea_id, auth.uid(), '✏️【修正依頼】 ' || trim(p_comment));
    update public.ideas set status = '制作中' where id = p_idea_id;
    perform public.notify(
      v_idea.modeler_id,
      '✏️ 修正依頼が届きました',
      '「' || v_idea.title || '」に修正依頼のコメントが届きました。コメント欄を確認してください。'
    );
    return '修正を依頼しました。案件を制作中に戻しました';
  end if;

  -- 販売取り下げ（コメント必須・モデリング中へ戻す）
  if p_new_status = '取り下げ' then
    if v_idea.status <> '販売中' then
      raise exception '販売中の案件のみ取り下げできます';
    end if;
    if v_idea.creator_id <> auth.uid() and not public.is_admin() then
      raise exception '取り下げはプランナー（または運営）のみ可能です';
    end if;
    if coalesce(trim(p_comment), '') = '' then
      raise exception '取り下げの理由をコメントとして入力してください';
    end if;
    insert into public.comments (idea_id, user_id, content)
    values (p_idea_id, auth.uid(), '↩️【販売取り下げ】 ' || trim(p_comment));
    update public.ideas set status = '制作中' where id = p_idea_id;
    perform public.notify(
      v_idea.modeler_id,
      '↩️ 販売が取り下げられました',
      '「' || v_idea.title || '」がモデリング中に戻されました。コメント欄を確認してください。'
    );
    return '販売を取り下げ、モデリング中に戻しました';
  end if;

  raise exception '不正なステータス遷移です';
end $$;
