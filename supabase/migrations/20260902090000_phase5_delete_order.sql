-- ================================================================
-- Phase 5 — permanent order deletion
--
-- Distinct from ORDER_STATUS = 'cancelled', which keeps the row (and its
-- tracking history) intact. This removes the record entirely, for test
-- orders and accidental records.
--
-- order_items already cascade: order_items.order_id references
-- orders(order_id) ON DELETE CASCADE, so a single DELETE on orders removes
-- the children in the same statement. This function exists to make that one
-- atomic call that also hands back the slip reference the caller needs for
-- best-effort Drive cleanup — without a second round trip that could race.
--
-- Products and product_images are untouched. OrderItems are historical
-- snapshots and reference no product row.
-- ================================================================

create or replace function public.delete_order_by_order_id(p_order_id text)
returns table (
  -- Deliberately not named order_id/slip_file_id: distinct OUT names keep
  -- them unambiguous against public.orders columns inside the body.
  deleted_order_id text,
  deleted_slip_file_id text,
  deleted_item_count integer
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_match_count integer;
  v_item_count integer;
  v_order public.orders%rowtype;
begin
  if p_order_id is null or length(btrim(p_order_id)) = 0 then
    raise exception 'order_id_required' using errcode = '22023';
  end if;

  -- orders.order_id carries a UNIQUE constraint, so this can only ever be
  -- 0 or 1. Checked anyway so corruption fails loudly instead of silently
  -- deleting an arbitrary row.
  select count(*) into v_match_count
  from public.orders as o
  where o.order_id = p_order_id;

  if v_match_count > 1 then
    raise exception 'duplicate_order_id' using errcode = '23505';
  end if;

  select count(*) into v_item_count
  from public.order_items as oi
  where oi.order_id = p_order_id;

  delete from public.orders as o
  where o.order_id = p_order_id
  returning * into v_order;

  -- Nothing matched: return zero rows so the caller reports "not found".
  if not found then
    return;
  end if;

  deleted_order_id := v_order.order_id;
  deleted_slip_file_id := v_order.slip_file_id;
  deleted_item_count := v_item_count;
  return next;
end;
$$;

-- Same posture as create_order_with_items: server-side service role only,
-- never reachable from the browser.
revoke all on function public.delete_order_by_order_id(text)
  from public, anon, authenticated;
grant execute on function public.delete_order_by_order_id(text)
  to service_role;
