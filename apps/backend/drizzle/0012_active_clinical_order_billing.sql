-- 0012_active_clinical_order_billing.sql
-- One clinical order may belong to only one active bill at a time.
--
-- A partial unique index cannot express this rule because activity lives on
-- the parent transactions row. A permanent unique index on clinical_order_id
-- would also be wrong: a properly Voided/Refunded bill must release the order
-- for corrected rebilling while the old immutable item remains in history.
--
-- The clinical_orders row is the concurrency key. Locking it serializes two
-- inserts for the same order without scanning or rewriting transaction_items,
-- so this is safe to add on a populated database and does not reject legacy
-- duplicates during deployment. The first new write for any duplicated legacy
-- order fails closed until the old records are resolved explicitly.

SET LOCAL lock_timeout = '5s';

-- Enforce tenant ownership on the relationship itself. NOT VALID keeps the
-- short ADD CONSTRAINT lock independent from the existing-row scan; the
-- subsequent VALIDATE uses PostgreSQL's online FK-validation lock level and
-- still makes deployment fail closed if legacy cross-tenant rows exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transaction_items_tenant_clinical_order_fk'
      AND conrelid = 'public.transaction_items'::regclass
  ) THEN
    ALTER TABLE public.transaction_items
      ADD CONSTRAINT transaction_items_tenant_clinical_order_fk
      FOREIGN KEY (tenant_id, clinical_order_id)
      REFERENCES public.clinical_orders (tenant_id, id)
      NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.transaction_items
  VALIDATE CONSTRAINT transaction_items_tenant_clinical_order_fk;

CREATE OR REPLACE FUNCTION enforce_one_active_bill_per_clinical_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  new_transaction_active boolean;
  conflicting_transaction text;
BEGIN
  IF NEW.clinical_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Serialize every contender for this tenant/order pair. The composite
  -- tenant predicate also makes a malformed cross-tenant item fall through to
  -- its FK/tenant constraint instead of locking another tenant's row.
  PERFORM 1
  FROM public.clinical_orders co
  WHERE co.tenant_id = NEW.tenant_id
    AND co.id = NEW.clinical_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'clinical order does not belong to transaction-item tenant'
      USING
        ERRCODE = 'foreign_key_violation',
        CONSTRAINT = 'transaction_items_tenant_clinical_order_fk';
  END IF;

  SELECT t.deleted_at IS NULL AND t.status NOT IN ('Voided', 'Refunded')
  INTO new_transaction_active
  FROM public.transactions t
  WHERE t.tenant_id = NEW.tenant_id
    AND t.id = NEW.transaction_id;

  -- Historical writes against an already-inactive parent do not claim the
  -- order. The normal FK still rejects a missing/mismatched parent.
  IF new_transaction_active IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  SELECT t.display_id
  INTO conflicting_transaction
  FROM public.transaction_items ti
  JOIN public.transactions t
    ON t.tenant_id = ti.tenant_id
   AND t.id = ti.transaction_id
  WHERE ti.tenant_id = NEW.tenant_id
    AND ti.clinical_order_id = NEW.clinical_order_id
    AND ti.id IS DISTINCT FROM NEW.id
    AND t.deleted_at IS NULL
    AND t.status NOT IN ('Voided', 'Refunded')
  ORDER BY ti.id
  LIMIT 1;

  IF conflicting_transaction IS NOT NULL THEN
    RAISE EXCEPTION
      'clinical order is already billed on active transaction %',
      conflicting_transaction
      USING
        ERRCODE = 'unique_violation',
        CONSTRAINT = 'transaction_items_one_active_clinical_order';
  END IF;

  RETURN NEW;
END;
$$;

-- Item triggers cannot see a later transaction UPDATE. Guard every transition
-- from inactive to active as well, including restoration of a soft-deleted
-- Draft/Pending transaction. Voided and Refunded are terminal accounting
-- states and may never be reactivated.
CREATE OR REPLACE FUNCTION enforce_active_transaction_order_claims()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  conflicting_transaction text;
BEGIN
  IF NEW.deleted_at IS NOT NULL
     OR NEW.status IN ('Voided', 'Refunded')
     OR (OLD.deleted_at IS NULL AND OLD.status NOT IN ('Voided', 'Refunded'))
  THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('Voided', 'Refunded') THEN
    RAISE EXCEPTION 'voided/refunded transactions cannot be reactivated'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Acquire every order lock in a stable order before checking claims. This
  -- matches the item trigger's concurrency key and avoids multi-item deadlocks.
  PERFORM 1
  FROM public.clinical_orders co
  JOIN public.transaction_items ti
    ON ti.tenant_id = co.tenant_id
   AND ti.clinical_order_id = co.id
  WHERE ti.tenant_id = NEW.tenant_id
    AND ti.transaction_id = NEW.id
  ORDER BY co.id
  FOR UPDATE OF co;

  SELECT conflict.display_id
  INTO conflicting_transaction
  FROM public.transaction_items own_item
  JOIN public.transaction_items other_item
    ON other_item.tenant_id = own_item.tenant_id
   AND other_item.clinical_order_id = own_item.clinical_order_id
   AND other_item.transaction_id <> own_item.transaction_id
  JOIN public.transactions conflict
    ON conflict.tenant_id = other_item.tenant_id
   AND conflict.id = other_item.transaction_id
  WHERE own_item.tenant_id = NEW.tenant_id
    AND own_item.transaction_id = NEW.id
    AND conflict.deleted_at IS NULL
    AND conflict.status NOT IN ('Voided', 'Refunded')
  ORDER BY other_item.id
  LIMIT 1;

  IF conflicting_transaction IS NOT NULL THEN
    RAISE EXCEPTION
      'clinical order is already billed on active transaction %',
      conflicting_transaction
      USING
        ERRCODE = 'unique_violation',
        CONSTRAINT = 'transaction_items_one_active_clinical_order';
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_transaction_items_one_active_clinical_order'
      AND tgrelid = 'public.transaction_items'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER trg_transaction_items_one_active_clinical_order
      BEFORE INSERT OR UPDATE OF tenant_id, transaction_id, clinical_order_id
      ON public.transaction_items
      FOR EACH ROW
      EXECUTE FUNCTION enforce_one_active_bill_per_clinical_order();
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_transactions_active_order_claims ON public.transactions;
CREATE TRIGGER trg_transactions_active_order_claims
  BEFORE UPDATE OF status, deleted_at
  ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION enforce_active_transaction_order_claims();
