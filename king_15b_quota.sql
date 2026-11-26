-- KING (dev) role: hard token cap per key = 15B (15,000,000,000).
--
-- Policy (confirmed 2026-11-15):
--  - Every key whose access_roles contains 'dev' (panel label "KING") is capped
--    at 15B metered tokens. Applies to existing keys (backfill) and new keys.
--  - Exception: buyer name "Tars" (buyer_id a938a40e-0ab3-4a1a-b3dd-f6d26e2fbcaf)
--    stays unlimited (quota_tokens NULL). Exception is name-based so it survives
--    key rotation / re-issue.
--  - Lower custom caps are preserved (only NULL or > 15B is clamped).
--  - is_hidden infra keys are never touched.
--  - Supports the quota edit endpoints too: trigger also fires on UPDATE OF
--    quota_tokens / daily_quota_tokens so the panel cannot silently bypass the
--    cap (setting "unlimited" on a KING key re-clamps to 15B).
--  - quota_exempt ("Free/Unlimited") models still never count toward the quota;
--    the proxy skips both the deny check and used_tokens billing for them.
--
-- Zero-downtime: DB-only, no service restart. The 30s API key cache picks up
-- the new quota automatically. Supporter 5B cap (enforce_supporter_token_cap)
-- is untouched and independent.

BEGIN;

CREATE OR REPLACE FUNCTION enforce_king_token_cap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  king_cap CONSTANT bigint := 15000000000;
  v_buyer  text;
BEGIN
  IF NOT ('dev' = ANY(COALESCE(NEW.access_roles, '{}'::text[]))) THEN
    RETURN NEW;
  END IF;

  -- Exception: Tars keeps unlimited quota.
  SELECT lower(btrim(b.name)) INTO v_buyer FROM buyers b WHERE b.id = NEW.buyer_id;
  IF v_buyer = 'tars' THEN
    RETURN NEW;
  END IF;

  IF NEW.quota_tokens IS NULL OR NEW.quota_tokens > king_cap THEN
    NEW.quota_tokens := king_cap;
  END IF;

  -- Daily-reset keys are checked against daily_quota_tokens, so cap that too.
  IF NEW.daily_quota_tokens IS NOT NULL AND NEW.daily_quota_tokens > king_cap THEN
    NEW.daily_quota_tokens := king_cap;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_king_token_cap ON api_keys;
CREATE TRIGGER trg_enforce_king_token_cap
BEFORE INSERT OR UPDATE OF access_roles, quota_tokens, daily_quota_tokens ON api_keys
FOR EACH ROW
EXECUTE FUNCTION enforce_king_token_cap();

-- Backfill existing KING keys (including soft-deleted ones so restored keys
-- cannot come back unlimited).
UPDATE api_keys k
SET quota_tokens = 15000000000
WHERE 'dev' = ANY(COALESCE(k.access_roles, '{}'::text[]))
  AND NOT k.is_hidden
  AND COALESCE((SELECT lower(btrim(b.name)) FROM buyers b WHERE b.id = k.buyer_id), '') <> 'tars'
  AND (k.quota_tokens IS NULL OR k.quota_tokens > 15000000000);

UPDATE api_keys k
SET daily_quota_tokens = 15000000000
WHERE 'dev' = ANY(COALESCE(k.access_roles, '{}'::text[]))
  AND NOT k.is_hidden
  AND COALESCE((SELECT lower(btrim(b.name)) FROM buyers b WHERE b.id = k.buyer_id), '') <> 'tars'
  AND k.daily_quota_tokens IS NOT NULL
  AND k.daily_quota_tokens > 15000000000;

COMMIT;
