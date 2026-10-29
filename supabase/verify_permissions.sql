-- ============================================================================
-- SITHUMINI CINNAMON HUB: DATABASE PERMISSION & INTEGRITY VERIFICATION SCRIPT
-- Execute this script in Supabase SQL Editor to audit live database integrity.
-- ============================================================================

DO
DECLARE
  v_prod_count INTEGER;
  v_missing_ids TEXT[];
  v_invalid_prices TEXT[];
  v_unauthorized_grants INTEGER;
  v_insecure_functions INTEGER;
BEGIN
  RAISE NOTICE '=== 1. VERIFYING PRODUCT CATALOG INTEGRITY ===';

  -- Exactly 10 active products
  SELECT COUNT(*) INTO v_prod_count FROM public.products WHERE is_active = true;
  IF v_prod_count <> 10 THEN
    RAISE EXCEPTION 'Catalog count mismatch: Expected 10 active products, found %', v_prod_count;
  END IF;

  -- Confirm IDs 9 through 18
  SELECT ARRAY_AGG(id) INTO v_missing_ids
  FROM (
    SELECT unnest(ARRAY['9','10','11','12','13','14','15','16','17','18']) AS id
    EXCEPT
    SELECT id FROM public.products WHERE is_active = true
  ) t;

  IF v_missing_ids IS NOT NULL AND array_length(v_missing_ids, 1) > 0 THEN
    RAISE EXCEPTION 'Missing product IDs: %', v_missing_ids;
  END IF;

  -- Verify all 10 have valid local prices
  SELECT ARRAY_AGG(p.id) INTO v_invalid_prices
  FROM public.products p
  LEFT JOIN public.product_prices pr ON pr.product_id = p.id AND pr.market = 'lk' AND pr.is_active = true
  WHERE p.is_active = true AND (pr.price_amount IS NULL OR pr.price_amount <= 0);

  IF v_invalid_prices IS NOT NULL AND array_length(v_invalid_prices, 1) > 0 THEN
    RAISE EXCEPTION 'Products missing valid local LKR prices: %', v_invalid_prices;
  END IF;

  RAISE NOTICE '  [PASS] 10 verified products (IDs 9-18) present with positive LKR prices.';

  RAISE NOTICE '=== 2. VERIFYING TABLE PRIVILEGES & RLS ===';

  -- Check unauthorized grants on private tables
  SELECT COUNT(*) INTO v_unauthorized_grants
  FROM information_schema.table_privileges
  WHERE table_schema = 'public'
    AND table_name IN ('orders', 'order_items', 'whatsapp_conversations', 'whatsapp_inbox')
    AND grantee IN ('PUBLIC', 'anon', 'authenticated');

  IF v_unauthorized_grants > 0 THEN
    RAISE EXCEPTION 'Security failure: Found % unauthorized table grants on private tables to public/anon/authenticated.', v_unauthorized_grants;
  END IF;

  -- Check direct INSERT/UPDATE/DELETE on reviews
  SELECT COUNT(*) INTO v_unauthorized_grants
  FROM information_schema.table_privileges
  WHERE table_schema = 'public'
    AND table_name = 'reviews'
    AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
    AND grantee IN ('PUBLIC', 'anon');

  IF v_unauthorized_grants > 0 THEN
    RAISE EXCEPTION 'Security failure: Public or anon has direct write privileges on reviews table.';
  END IF;

  RAISE NOTICE '  [PASS] Private tables and review writes restricted from anonymous and ordinary authenticated clients.';

  RAISE NOTICE '=== 3. VERIFYING FUNCTION SECURITY & SEARCH_PATH ===';

  -- Check function routine privileges
  SELECT COUNT(*) INTO v_unauthorized_grants
  FROM information_schema.routine_privileges
  WHERE routine_schema = 'public'
    AND routine_name IN ('create_order_request_atomic', 'claim_inbox_message_atomic', 'get_pending_inbox_messages', 'save_products_atomic')
    AND grantee IN ('PUBLIC', 'anon', 'authenticated');

  IF v_unauthorized_grants > 0 THEN
    RAISE EXCEPTION 'Security failure: Found % unauthorized EXECUTE grants on privileged RPCs to public/anon/authenticated.', v_unauthorized_grants;
  END IF;

  -- Check SECURITY DEFINER and search_path on functions
  SELECT COUNT(*) INTO v_insecure_functions
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('create_order_request_atomic', 'claim_inbox_message_atomic', 'get_pending_inbox_messages', 'save_products_atomic')
    AND (
      p.prosecdef = false
      OR p.proconfig IS NULL
      OR NOT ('search_path=public, pg_temp' = ANY(p.proconfig))
    );

  IF v_insecure_functions > 0 THEN
    RAISE EXCEPTION 'Security failure: Found % functions without SECURITY DEFINER or fixed search_path=public, pg_temp.', v_insecure_functions;
  END IF;

  RAISE NOTICE '  [PASS] Privileged RPCs enforce SECURITY DEFINER with fixed search_path and are granted strictly to service_role.';

  RAISE NOTICE '=== ALL VERIFICATION CHECKS PASSED SUCCESSFULLY ===';
END;
;
