-- Supporter role: cap metered-model usage at 5B tokens per key.
--
-- Behavior:
--  - Existing supporter-only keys get quota_tokens = 5,000,000,000
--    (only raises NULL or lowers values above 5B; lower custom caps are preserved).
--  - New keys / role assignments auto-apply the cap via trigger.
--  - dev / ultra / pro roles stay unlimited (higher tier wins).
--  - quota_exempt ("Free/Unlimited") models never count toward this quota;
--    the proxy skips both the deny check and used_tokens billing for them.
--
-- Zero-downtime: DB-only, no service restart. API key cache (30s TTL)
-- picks up the new quota automatically.

BEGIN;

CREATE OR REPLACE FUNCTION enforce_supporter_token_cap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  supporter_cap CONSTANT bigint := 5000000000;
BEGIN
  IF 'supporter' = ANY(COALESCE(NEW.access_roles, '{}'::text[]))
     AND NOT (
       'dev' = ANY(COALESCE(NEW.access_roles, '{}'::text[]))
       OR 'ultra' = ANY(COALESCE(NEW.access_roles, '{}'::text[]))
       OR 'pro' = ANY(COALESCE(NEW.access_roles, '{}'::text[]))
     )
     AND (NEW.quota_tokens IS NULL OR NEW.quota_tokens > supporter_cap)
  THEN
    NEW.quota_tokens := supporter_cap;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_supporter_token_cap ON api_keys;
CREATE TRIGGER trg_enforce_supporter_token_cap
BEFORE INSERT OR UPDATE OF access_roles ON api_keys
FOR EACH ROW
EXECUTE FUNCTION enforce_supporter_token_cap();

UPDATE api_keys
SET quota_tokens = 5000000000
WHERE 'supporter' = ANY(COALESCE(access_roles, '{}'::text[]))
  AND NOT (
    'dev' = ANY(COALESCE(access_roles, '{}'::text[]))
    OR 'ultra' = ANY(COALESCE(access_roles, '{}'::text[]))
    OR 'pro' = ANY(COALESCE(access_roles, '{}'::text[]))
  )
  AND (quota_tokens IS NULL OR quota_tokens > 5000000000);

COMMIT;
