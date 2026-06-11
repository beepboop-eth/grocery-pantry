-- Pantry inventory. One row per distinct item acquisition; raw Open Food Facts
-- payload kept in `raw` so future features (nutrition, expiry, etc.) don't need
-- a schema change.
create table public.pantry_items (
  id uuid primary key default gen_random_uuid(),
  barcode text,
  name text,
  brand text,
  category text,
  quantity numeric not null default 1,
  unit text,
  image_url text,
  raw jsonb,
  source text not null default 'scan', -- 'scan' | 'manual'
  added_at timestamptz not null default now(),
  consumed_at timestamptz -- null = currently in the pantry
);

create index pantry_items_barcode_idx on public.pantry_items (barcode);
create index pantry_items_in_stock_idx on public.pantry_items (added_at) where consumed_at is null;

alter table public.pantry_items enable row level security;

-- Single-user pantry: the anon key (embedded in the scanner page) gets full
-- access. Low stakes data; revisit with Supabase Auth if that ever changes.
create policy "anon full access" on public.pantry_items
  for all to anon using (true) with check (true);
