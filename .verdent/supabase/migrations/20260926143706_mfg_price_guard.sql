-- ============================================================
-- Physical print price guard (migration 0007)
-- Red-ink prevention: physical price must be >= 2x the JLC3DP
-- quote (manufacturing cost estimate) whenever a quote is set.
-- ============================================================

alter table public.ideas add column if not exists mfg_cost integer not null default 0;

alter table public.ideas drop constraint if exists ideas_mfg_cost_check;
alter table public.ideas
  add constraint ideas_mfg_cost_check check (mfg_cost >= 0);

alter table public.ideas drop constraint if exists ideas_mfg_price_guard;
alter table public.ideas
  add constraint ideas_mfg_price_guard
  check (mfg_cost = 0 or price_physical >= mfg_cost * 2);