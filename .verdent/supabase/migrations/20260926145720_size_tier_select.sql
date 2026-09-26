-- ============================================================
-- Size tier selection + leaner minimum prices (migration 0009)
-- Tiers (選択式) and break-even floors (JLC3DP cost x 3.8):
--   S  (〜60mm×60mm×60mm)       : ¥2,700  (covers ~¥700)
--   M  (〜120mm×120mm×120mm)    : ¥5,000  (covers ~¥1,300)
--   L  (〜200mm×200mm×200mm)    : ¥9,500  (covers ~¥2,500)
--   XL (200mm超)                : ¥19,000 (covers ~¥5,000)
-- JLC3DP quote (mfg_cost) still overrides with a 4x rule.
-- ============================================================

alter table public.ideas add column if not exists size_tier text not null default 'S';

alter table public.ideas drop column if exists size_w;
alter table public.ideas drop column if exists size_d;
alter table public.ideas drop column if exists size_h;

create or replace function public.min_physical_price_tier(p_tier text, p_mfg integer)
returns integer
language sql
immutable
as $$
  select greatest(
    case coalesce(p_tier,'S')
      when 'M' then 5000
      when 'L' then 9500
      when 'XL' then 19000
      else 2700
    end,
    coalesce(p_mfg,0) * 4
  );
$$;

drop function if exists public.min_physical_price(integer, integer, integer, integer);

-- 既存商品を新しい最低価格（S相当）に引き上げ
update public.ideas set price_physical = 2700 where price_physical < 2700;

alter table public.ideas drop constraint if exists ideas_size_price_guard;
alter table public.ideas
  add constraint ideas_size_price_guard
  check (price_physical >= public.min_physical_price_tier(size_tier, mfg_cost));