-- Phase 3.5 data backfill. NOT part of any migration. Run only after the schema change is applied,
-- with explicit approval, on a backup first.
--
-- Every payment confirmed before Phase 3.5 was confirmed by a person (no provider was ever called),
-- so marking them MANUAL is accurate. Rows already decided by a provider would be left alone.
-- Expected effect: the count of CONFIRMED rows with NULL verificationMethod becomes zero.

BEGIN;

SELECT COUNT(*) AS rows_to_backfill
FROM "Payment"
WHERE status = 'CONFIRMED' AND "verificationMethod" IS NULL;

UPDATE "Payment"
SET "verificationMethod" = 'MANUAL'
WHERE status = 'CONFIRMED' AND "verificationMethod" IS NULL;

-- Review the counts above. If they look right, replace ROLLBACK with COMMIT.
ROLLBACK;
