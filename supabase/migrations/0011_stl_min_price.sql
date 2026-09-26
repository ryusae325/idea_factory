-- ============================================================
-- STL minimum price (migration 0011)
-- STL販売は製造原価ゼロのため赤字リスクはないが、
-- 価格崩壊防止として有料の場合は最低 ¥300 に制限（無料0円は許容）。
-- ============================================================

alter table public.ideas drop constraint if exists ideas_digital_price_guard;
alter table public.ideas
  add constraint ideas_digital_price_guard
  check (price_digital = 0 or price_digital >= 300);
