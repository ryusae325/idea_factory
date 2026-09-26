-- ロール廃止: すべてのユーザーがプランナー・モデラー・購入者になりうるため、
-- 役割の区分は不要。profiles.role 列を削除する（is_admin は運営管理用に残す）。
alter table public.profiles drop column if exists role;