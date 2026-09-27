-- ステータス「提出中」を ideas の CHECK 制約に追加
alter table public.ideas drop constraint if exists ideas_status_check;
alter table public.ideas add constraint ideas_status_check
  check (status in ('アイデア募集', '制作中', '提出中', '販売中'));