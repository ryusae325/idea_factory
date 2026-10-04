alter table public.ideas
  add column if not exists is_hidden boolean not null default false;

create table if not exists public.idea_reports (
  id bigint generated always as identity primary key,
  idea_id bigint references public.ideas(id) on delete set null,
  idea_title text not null,
  reporter_id uuid references public.profiles(id) on delete set null,
  reason text not null check (char_length(reason) between 1 and 2000),
  status text not null default '未対応' check (status in ('未対応', '確認済み', '対処済み')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idea_reports_status_created_idx
  on public.idea_reports (status, created_at desc);

alter table public.idea_reports enable row level security;
revoke all on public.idea_reports from anon, authenticated;
grant all on public.idea_reports to service_role;
grant usage, select on sequence public.idea_reports_id_seq to service_role;

drop policy if exists ideas_select_all on public.ideas;
create policy ideas_select_public_or_participant on public.ideas
  for select using (
    not is_hidden
    or creator_id = auth.uid()
    or modeler_id = auth.uid()
    or public.is_admin()
  );

create or replace function public.manage_idea_report(
  p_report_id bigint,
  p_status text default null,
  p_hide_idea boolean default false,
  p_show_idea boolean default false,
  p_delete boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_idea_id bigint;
begin
  if p_delete then
    delete from public.idea_reports where id = p_report_id;
    if not found then
      raise exception '通報が見つかりません';
    end if;
    return;
  end if;

  if p_status not in ('未対応', '確認済み', '対処済み') then
    raise exception '通報ステータスが不正です';
  end if;

  select idea_id into v_idea_id
  from public.idea_reports
  where id = p_report_id
  for update;
  if not found then
    raise exception '通報が見つかりません';
  end if;

  if p_hide_idea and p_show_idea then
    raise exception '公開状態の指定が不正です';
  end if;

  if p_hide_idea and v_idea_id is not null then
    update public.ideas set is_hidden = true where id = v_idea_id;
    p_status := '対処済み';
  elsif p_show_idea and v_idea_id is not null then
    update public.ideas set is_hidden = false where id = v_idea_id;
  end if;

  update public.idea_reports
  set status = p_status, updated_at = now()
  where id = p_report_id;
end;
$$;

revoke all on function public.manage_idea_report(bigint, text, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.manage_idea_report(bigint, text, boolean, boolean, boolean) to service_role;
