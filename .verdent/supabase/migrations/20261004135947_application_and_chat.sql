-- モデラー立候補・プランナー指名制 + 案件別クローズドチャット
-- 1) idea_applications: 立候補（エントリー）管理
-- 2) idea_messages: 指名済みプランナー/モデラーのみ参加できる1対1チャット
-- 3) update_idea_status から早い者勝ちの「制作中」引き受けを廃止

-- ---------- 立候補テーブル ----------
create table if not exists public.idea_applications (
  id bigint generated always as identity primary key,
  idea_id bigint not null references public.ideas(id) on delete cascade,
  modeler_id uuid not null references public.profiles(id) on delete cascade,
  message text not null default '' check (char_length(message) <= 1000),
  status text not null default '応募中' check (status in ('応募中', '選定済', '見送り')),
  created_at timestamptz not null default now()
);

create unique index if not exists idea_applications_idea_modeler_key
  on public.idea_applications (idea_id, modeler_id);
create index if not exists idea_applications_idea_idx
  on public.idea_applications (idea_id, id);
create index if not exists idea_applications_modeler_idx
  on public.idea_applications (modeler_id, id desc);

alter table public.idea_applications enable row level security;

revoke all on public.idea_applications from anon, authenticated;
grant select on public.idea_applications to authenticated;

drop policy if exists idea_applications_select_participant on public.idea_applications;
create policy idea_applications_select_participant on public.idea_applications
  for select to authenticated
  using (
    modeler_id = auth.uid()
    or exists (
      select 1 from public.ideas i
      where i.id = idea_applications.idea_id
        and (i.creator_id = auth.uid() or public.is_admin())
    )
  );

-- ---------- 案件チャットテーブル ----------
create table if not exists public.idea_messages (
  id bigint generated always as identity primary key,
  idea_id bigint not null references public.ideas(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists idea_messages_idea_idx on public.idea_messages (idea_id, id);

alter table public.idea_messages enable row level security;

revoke all on public.idea_messages from anon, authenticated;
grant select on public.idea_messages to authenticated;

drop policy if exists idea_messages_select_participant on public.idea_messages;
create policy idea_messages_select_participant on public.idea_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.ideas i
      where i.id = idea_messages.idea_id
        and (i.creator_id = auth.uid() or i.modeler_id = auth.uid() or public.is_admin())
    )
  );

-- Realtime 配信
alter publication supabase_realtime add table public.idea_messages;

-- ---------- 立候補 RPC ----------
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
  if v_idea.creator_id = auth.uid() then
    raise exception '自分のアイデアには立候補できません' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.idea_applications where idea_id = p_idea_id and modeler_id = auth.uid()) then
    raise exception 'すでにこの案件に立候補しています' using errcode = '23505';
  end if;

  insert into public.idea_applications (idea_id, modeler_id, message)
  values (p_idea_id, auth.uid(), btrim(coalesce(p_message, '')));

  perform public.notify(
    v_idea.creator_id,
    '🙋 新しい立候補',
    '「' || v_idea.title || '」にモデラーから立候補がありました。詳細画面から応募者を確認し、指名してください。'
  );
  return '立候補を受け付けました。プランナーの指名をお待ちください';
end;
$$;

revoke all on function public.apply_for_idea(bigint, text) from public, anon;
grant execute on function public.apply_for_idea(bigint, text) to authenticated;

create or replace function public.withdraw_application(p_idea_id bigint)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'ログインしてください' using errcode = '42501';
  end if;
  delete from public.idea_applications
  where idea_id = p_idea_id and modeler_id = auth.uid() and status = '応募中';
  if not found then
    raise exception '取り下げられる立候補がありません' using errcode = 'P0002';
  end if;
  return '立候補を取り下げました';
end;
$$;

revoke all on function public.withdraw_application(bigint) from public, anon;
grant execute on function public.withdraw_application(bigint) to authenticated;

-- ---------- 指名 RPC ----------
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

  perform public.notify(
    p_modeler_id,
    '🔨 指名されました',
    '「' || v_idea.title || '」のモデリングを ' || coalesce(v_assignee_name, 'モデラー') || ' さんに指名しました。案件チャットで進捗報告をお願いします。'
  );

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

-- ---------- 案件チャット RPC ----------
create or replace function public.send_idea_message(p_idea_id bigint, p_body text)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_idea public.ideas%rowtype;
  v_msg_id bigint;
begin
  if auth.uid() is null then
    raise exception 'ログインしてください' using errcode = '42501';
  end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 2000 then
    raise exception 'メッセージを入力してください（2000文字以内）' using errcode = '22023';
  end if;

  select * into v_idea from public.ideas where id = p_idea_id;
  if not found then
    raise exception '対象のアイデアが存在しません' using errcode = 'P0002';
  end if;
  if auth.uid() <> v_idea.creator_id
     and v_idea.modeler_id is distinct from auth.uid()
     and not public.is_admin() then
    raise exception 'この案件のチャットには参加できません' using errcode = '42501';
  end if;

  insert into public.idea_messages (idea_id, sender_id, body)
  values (p_idea_id, auth.uid(), btrim(p_body))
  returning id into v_msg_id;

  perform public.notify(
    case when auth.uid() = v_idea.creator_id then v_idea.modeler_id else v_idea.creator_id end,
    '💬 新しいチャットメッセージ',
    '「' || v_idea.title || '」の案件チャットに新しいメッセージが届きました。'
  );

  return v_msg_id;
end;
$$;

revoke all on function public.send_idea_message(bigint, text) from public, anon;
grant execute on function public.send_idea_message(bigint, text) to authenticated;

-- ---------- 既存ステータスRPCから早い者勝ち引き受けを廃止 ----------
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

  -- モデラーの決定は立候補・指名制（assign_modeler）に一本化
  if p_new_status = '制作中' then
    raise exception 'モデラーの決定は立候補者の中から指名してください';
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