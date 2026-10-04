drop policy if exists idea_reports_admin_select on public.idea_reports;
create policy idea_reports_admin_select on public.idea_reports
  for select to authenticated
  using (public.is_admin());

grant select on public.idea_reports to authenticated;
revoke insert, update, delete on public.idea_reports from anon, authenticated;

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
  v_idea_id bigint;
begin
  if not public.is_admin() then
    raise exception '管理者権限が必要です' using errcode = '42501';
  end if;
  if p_action not in ('confirm', 'hide', 'publish', 'delete') then
    raise exception '操作内容が不正です' using errcode = '22023';
  end if;

  if p_action = 'delete' then
    delete from public.idea_reports where id = p_report_id;
    if not found then
      raise exception '通報が見つかりません' using errcode = 'P0002';
    end if;
    return;
  end if;

  select idea_id into v_idea_id
  from public.idea_reports
  where id = p_report_id
  for update;
  if not found then
    raise exception '通報が見つかりません' using errcode = 'P0002';
  end if;

  if p_action = 'confirm' then
    update public.idea_reports set status = '確認済み', updated_at = now() where id = p_report_id;
  elsif p_action = 'hide' then
    if v_idea_id is not null then
      update public.ideas set is_hidden = true where id = v_idea_id;
    end if;
    update public.idea_reports set status = '対処済み', updated_at = now() where id = p_report_id;
  elsif p_action = 'publish' and v_idea_id is not null then
    update public.ideas set is_hidden = false where id = v_idea_id;
  end if;
end;
$$;

revoke all on function public.manage_idea_report_admin(bigint, text) from public, anon;
grant execute on function public.manage_idea_report_admin(bigint, text) to authenticated;