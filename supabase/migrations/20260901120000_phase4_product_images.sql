-- ================================================================
-- Phase 4 — relational product images
--
-- A product may now have zero, one, or many images. Order is explicit
-- (sort_order), the lowest-ordered row is the primary/cover image, and
-- deleting a product removes its image rows via ON DELETE CASCADE.
--
-- products.image_url is RETAINED for now as a denormalised mirror of the
-- primary image so any reader not yet migrated keeps working. The server
-- keeps it in sync whenever images change. It can be dropped in a later
-- phase once nothing reads it.
--
-- OrderItems are historical snapshots and reference nothing here.
-- ================================================================

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  -- Keyed on the stable public PRODUCT_ID, matching every other join in
  -- this schema. Cascade keeps image rows from outliving their product.
  product_id text not null
    references public.products (product_id)
    on update cascade
    on delete cascade,
  image_url text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_images_url_present check (length(btrim(image_url)) > 0),
  constraint product_images_sort_order_non_negative check (sort_order >= 0)
);

-- Primary lookup: every gallery read is "images for one product, in order".
create index if not exists product_images_product_id_sort_order_idx
  on public.product_images (product_id, sort_order, created_at, id);

-- The same URL must not be attached to one product twice.
create unique index if not exists product_images_product_id_image_url_key
  on public.product_images (product_id, image_url);

drop trigger if exists product_images_set_updated_at on public.product_images;
create trigger product_images_set_updated_at
before update on public.product_images
for each row
execute function public.kg_set_updated_at();

-- ── Backfill ────────────────────────────────────────────────────
-- Every existing product with an image becomes sort_order 1. Idempotent:
-- re-running will not duplicate rows.
insert into public.product_images (product_id, image_url, sort_order)
select p.product_id, btrim(p.image_url), 1
from public.products as p
where p.image_url is not null
  and length(btrim(p.image_url)) > 0
on conflict (product_id, image_url) do nothing;

-- ── Security ────────────────────────────────────────────────────
-- Same posture as every other table: no direct browser access. All reads
-- and writes go through the server using the service role.
alter table public.product_images enable row level security;

drop policy if exists "No direct browser access to product_images"
  on public.product_images;

create policy "No direct browser access to product_images"
on public.product_images
for all
using (false)
with check (false);

-- ── Ordered replace helper ──────────────────────────────────────
-- Reordering a gallery is a set operation, not N updates. Rewriting the
-- whole ordering in one statement inside a function keeps it atomic and
-- avoids transient duplicate sort_order values.
create or replace function public.set_product_image_order(
  p_product_id text,
  p_image_urls text[]
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_image_urls is null or array_length(p_image_urls, 1) is null then
    return;
  end if;

  update public.product_images as pi
  set sort_order = ordered.position
  from (
    select url, ordinality as position
    from unnest(p_image_urls) with ordinality as t(url, ordinality)
  ) as ordered
  where pi.product_id = p_product_id
    and pi.image_url = ordered.url;

  -- Keep the denormalised cover in step with the new first image.
  update public.products as p
  set image_url = (
    select pi.image_url
    from public.product_images as pi
    where pi.product_id = p_product_id
    order by pi.sort_order, pi.created_at, pi.id
    limit 1
  )
  where p.product_id = p_product_id;
end;
$$;

revoke all on function public.set_product_image_order(text, text[])
  from public, anon, authenticated;
grant execute on function public.set_product_image_order(text, text[])
  to service_role;
