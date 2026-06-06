CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS buyers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  notes TEXT,
  password_plain TEXT,
  password_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id UUID REFERENCES buyers(id) ON DELETE CASCADE,
  label VARCHAR(255) NOT NULL,
  key_prefix VARCHAR(32) NOT NULL,
  key_hash VARCHAR(64) NOT NULL UNIQUE,
  key_plain TEXT,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  quota_tokens BIGINT,
  quota_requests BIGINT,
  used_tokens BIGINT DEFAULT 0,
  used_requests BIGINT DEFAULT 0,
  daily_reset BOOLEAN DEFAULT FALSE,
  daily_quota_tokens BIGINT,
  package_id VARCHAR(64),
  is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  rate_limit_rpm INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_buyer ON api_keys(buyer_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);


CREATE TABLE IF NOT EXISTS models (
  id VARCHAR(128) PRIMARY KEY,
  upstream_model VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  input_cost_per_million NUMERIC,
  output_cost_per_million NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS buyer_model_access (
  api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  model_id VARCHAR(128) NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  PRIMARY KEY (api_key_id, model_id)
);

CREATE TABLE IF NOT EXISTS usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id UUID REFERENCES buyers(id) ON DELETE SET NULL,
  api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  agent_id VARCHAR(255) NOT NULL,
  endpoint VARCHAR(255) NOT NULL,
  model_id VARCHAR(128),
  upstream_model VARCHAR(255),
  status_code INTEGER NOT NULL,
  success BOOLEAN NOT NULL,
  prompt_tokens BIGINT DEFAULT 0,
  completion_tokens BIGINT DEFAULT 0,
  total_tokens BIGINT DEFAULT 0,
  estimated BOOLEAN DEFAULT FALSE,
  cost_estimate NUMERIC DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  error_code VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_created ON usage_events(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_api_key ON usage_events(api_key_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_buyer ON usage_events(buyer_id);

CREATE TABLE IF NOT EXISTS usage_rollups (
  day DATE NOT NULL,
  buyer_id UUID REFERENCES buyers(id) ON DELETE SET NULL,
  api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  model_id VARCHAR(128),
  agent_id VARCHAR(255) NOT NULL,
  request_count BIGINT DEFAULT 0,
  prompt_tokens BIGINT DEFAULT 0,
  completion_tokens BIGINT DEFAULT 0,
  total_tokens BIGINT DEFAULT 0,
  cost_estimate NUMERIC DEFAULT 0,
  PRIMARY KEY (day, buyer_id, api_key_id, model_id, agent_id)
);