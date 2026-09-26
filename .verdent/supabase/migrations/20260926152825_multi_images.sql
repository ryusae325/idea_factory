-- ============================================================
-- Multiple reference images (migration 0012)
-- プランナーが角度違いの参考画像（正面・横・上面など）を
-- 複数枚投稿できるようにする。image_url は先頭画像（カバー）を維持。
-- ============================================================

alter table public.ideas add column if not exists images jsonb not null default '[]';