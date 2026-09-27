-- アイデアにジャンルを追加（モデラー募集中一覧の絞り込み・ソート用）
alter table public.ideas add column if not exists genre text not null default 'その他';