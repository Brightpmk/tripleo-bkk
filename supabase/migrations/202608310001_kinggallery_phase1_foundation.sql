-- KingGallery.Studio Phase 1 Supabase/PostgreSQL foundation.
-- This migration runs in parallel with the current Google Sheets production path.

create extension if not exists pgcrypto;

create or replace function public.kg_normalize_tracking_name(value text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(btrim(coalesce(value, '')), '[[:space:]]+', ' ', 'g'));
$$;

create or replace function public.kg_normalize_tracking_phone(value text)
returns text
language sql
immutable
as $$
  with digits as (
    select regexp_replace(coalesce(value, ''), '[^0-9]+', '', 'g') as value
  )
  select case
    when value like '66%' and length(value) >= 10 then '0' || substr(value, 3)
    else value
  end
  from digits;
$$;

create or replace function public.kg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  product_id text not null unique,
  university text not null,
  shirt_color text not null,
  base_price_thb integer not null,
  image_url text,
  available_sizes text[] not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_product_id_format check (product_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$'),
  constraint products_university_known check (
    university in (
      'MAHASARAKHAM',
      'BANGKOK THONBURI',
      'RAMKHAMHAENG',
      'MAE FAH LUANG',
      'MAEJO',
      'BANGMOD',
      'NORTH BANGKOK',
      'LADKRABANG'
    )
  ),
  constraint products_shirt_color_present check (length(btrim(shirt_color)) > 0),
  constraint products_base_price_positive check (base_price_thb > 0),
  constraint products_available_sizes_present check (array_length(available_sizes, 1) > 0),
  constraint products_available_sizes_known check (
    available_sizes <@ array['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL']::text[]
  ),
  constraint products_sort_order_non_negative check (sort_order >= 0)
);

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row
execute function public.kg_set_updated_at();

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_id text not null unique,
  created_at timestamptz not null,
  full_name text not null,
  full_name_search text generated always as (public.kg_normalize_tracking_name(full_name)) stored,
  phone text not null,
  phone_search text generated always as (public.kg_normalize_tracking_phone(phone)) stored,
  university text not null,
  delivery_method text not null,
  shipping_address text,
  shipping_fee_thb integer not null default 0,
  subtotal_thb integer not null default 0,
  total_thb integer not null default 0,
  payment_status text not null default 'pending',
  slip_file_id text,
  order_status text not null default 'new',
  shipping_provider text,
  tracking_number text,
  notes text,
  updated_at timestamptz not null default now(),
  constraint orders_order_id_format check (order_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$'),
  constraint orders_full_name_present check (length(btrim(full_name)) > 0),
  constraint orders_phone_present check (length(btrim(phone)) > 0),
  constraint orders_university_known check (
    university in (
      'MAHASARAKHAM',
      'BANGKOK THONBURI',
      'RAMKHAMHAENG',
      'MAE FAH LUANG',
      'MAEJO',
      'BANGMOD',
      'NORTH BANGKOK',
      'LADKRABANG'
    )
  ),
  constraint orders_delivery_method_known check (delivery_method in ('pickup', 'shipping')),
  constraint orders_payment_status_known check (
    payment_status in ('pending', 'verified', 'review_required', 'rejected')
  ),
  constraint orders_order_status_known check (
    order_status in ('new', 'preparing', 'shipped', 'completed', 'cancelled')
  ),
  constraint orders_shipping_fee_non_negative check (shipping_fee_thb >= 0),
  constraint orders_subtotal_non_negative check (subtotal_thb >= 0),
  constraint orders_total_non_negative check (total_thb >= 0),
  constraint orders_shipping_address_required check (
    delivery_method <> 'shipping' or length(btrim(coalesce(shipping_address, ''))) > 0
  )
);

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row
execute function public.kg_set_updated_at();

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders(order_id) on update cascade on delete cascade,
  item_id text not null,
  product_id text not null,
  shirt_color text not null,
  size text not null,
  quantity integer not null,
  unit_price_thb integer not null,
  line_total_thb integer not null,
  created_at timestamptz not null default now(),
  constraint order_items_unique_item_id unique (item_id),
  constraint order_items_unique_order_item unique (order_id, item_id),
  constraint order_items_item_id_format check (item_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,80}$'),
  constraint order_items_product_id_present check (length(btrim(product_id)) > 0),
  constraint order_items_shirt_color_present check (length(btrim(shirt_color)) > 0),
  constraint order_items_size_known check (size in ('XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL')),
  constraint order_items_quantity_positive check (quantity > 0),
  constraint order_items_unit_price_positive check (unit_price_thb > 0),
  constraint order_items_line_total_non_negative check (line_total_thb >= 0)
);

create index if not exists products_university_active_sort_idx
  on public.products (university, active, sort_order);

create index if not exists orders_created_at_idx
  on public.orders (created_at desc);

create index if not exists orders_payment_status_idx
  on public.orders (payment_status);

create index if not exists orders_order_status_idx
  on public.orders (order_status);

create index if not exists orders_university_idx
  on public.orders (university);

create index if not exists orders_full_name_search_idx
  on public.orders (full_name_search);

create index if not exists orders_phone_search_idx
  on public.orders (phone_search);

create index if not exists order_items_order_id_idx
  on public.order_items (order_id);

alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "No direct browser access to products" on public.products;
drop policy if exists "No direct browser access to orders" on public.orders;
drop policy if exists "No direct browser access to order_items" on public.order_items;

create policy "No direct browser access to products"
on public.products
for all
using (false)
with check (false);

create policy "No direct browser access to orders"
on public.orders
for all
using (false)
with check (false);

create policy "No direct browser access to order_items"
on public.order_items
for all
using (false)
with check (false);
