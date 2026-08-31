-- KingGallery.Studio Phase 2 runtime cutover support.
-- Supabase becomes the operational data source, while Google Sheets remains
-- rollback/reference infrastructure.

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.products to service_role;
grant select, insert, update on table public.orders to service_role;
grant select, insert on table public.order_items to service_role;
grant execute on function public.kg_normalize_tracking_name(text) to service_role;
grant execute on function public.kg_normalize_tracking_phone(text) to service_role;

create or replace function public.create_order_with_items(
  p_order jsonb,
  p_items jsonb
)
returns public.orders
language plpgsql
security invoker
set search_path = public
as $$
declare
  inserted_order public.orders%rowtype;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'order_items_required' using errcode = '23514';
  end if;

  insert into public.orders (
    order_id,
    created_at,
    full_name,
    phone,
    university,
    delivery_method,
    shipping_address,
    shipping_fee_thb,
    subtotal_thb,
    total_thb,
    payment_status,
    slip_file_id,
    order_status,
    shipping_provider,
    tracking_number,
    notes
  )
  values (
    p_order->>'order_id',
    (p_order->>'created_at')::timestamptz,
    p_order->>'full_name',
    p_order->>'phone',
    p_order->>'university',
    p_order->>'delivery_method',
    nullif(p_order->>'shipping_address', ''),
    (p_order->>'shipping_fee_thb')::integer,
    (p_order->>'subtotal_thb')::integer,
    (p_order->>'total_thb')::integer,
    p_order->>'payment_status',
    nullif(p_order->>'slip_file_id', ''),
    p_order->>'order_status',
    nullif(p_order->>'shipping_provider', ''),
    nullif(p_order->>'tracking_number', ''),
    nullif(p_order->>'notes', '')
  )
  returning * into inserted_order;

  insert into public.order_items (
    order_id,
    item_id,
    product_id,
    shirt_color,
    size,
    quantity,
    unit_price_thb,
    line_total_thb,
    created_at
  )
  select
    inserted_order.order_id,
    item.item_id,
    item.product_id,
    item.shirt_color,
    item.size,
    item.quantity,
    item.unit_price_thb,
    item.line_total_thb,
    inserted_order.created_at
  from jsonb_to_recordset(p_items) as item(
    item_id text,
    product_id text,
    shirt_color text,
    size text,
    quantity integer,
    unit_price_thb integer,
    line_total_thb integer
  );

  return inserted_order;
end;
$$;

revoke all on function public.create_order_with_items(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_order_with_items(jsonb, jsonb)
  to service_role;
