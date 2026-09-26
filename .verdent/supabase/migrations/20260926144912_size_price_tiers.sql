-- ============================================================
-- Tiered minimum physical price by size (migration 0008)
-- W/D/H (mm) -> tiered floor price, auto-enforced by CHECK.
-- Tiers (longest side):
--   〜60mm  (S)  : ¥4,000
--   〜120mm (M)  : ¥7,000
--   〜200mm (L)  : ¥12,000
--   200mm超 (XL) : ¥20,000
--   未入力        : ¥4,000
-- A JLC3DP quote (mfg_cost) still overrides with a 4x rule
-- when it demands a higher floor.
-- ============================================================

alter table public.ideas add column if not exists size_w integer not null default 0;
alter table public.ideas add column if not exists size_d integer not null default 0;
alter table public.ideas add column if not exists size_h integer not null default 0;

create or replace function public.min_physical_price(p_w integer, p_d integer, p_h integer, p_mfg integer)
returns integer
language sql
immutable
as $$
  select greatest(
    case
      when greatest(coalesce(p_w,0), coalesce(p_d,0), coalesce(p_h,0)) <= 60 then 4000
      when greatest(coalesce(p_w,0), coalesce(p_d,0), coalesce(p_h,0)) <= 120 then 7000
      when greatest(coalesce(p_w,0), coalesce(p_d,0), coalesce(p_h,0)) <= 200 then 12000
      else 20000
    end,
    coalesce(p_mfg,0) * 4
  );
$$;

-- 既存商品を新しい最低価格（S相当）に引き上げ
update public.ideas set price_physical = 4000 where price_physical < 4000;

alter table public.ideas drop constraint if exists ideas_mfg_price_guard;
alter table public.ideas drop constraint if exists ideas_size_price_guard;
alter table public.ideas
  add constraint ideas_size_price_guard
  check (price_physical >= public.min_physical_price(size_w, size_d, size_h, mfg_cost));