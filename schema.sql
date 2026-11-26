CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES admins(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  ip_address VARCHAR(64),
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  last_active_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions(admin_id);

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
  -- Ultra tier role flag (independent of quota_tokens; quota may be NULL/unlimited).
  is_ultra BOOLEAN NOT NULL DEFAULT FALSE,
  -- Per-key role assignments (additive to name-match logic).
  -- Values: 'dev', 'supporter', 'ultra'. Empty = no explicit roles.
  access_roles TEXT[] NOT NULL DEFAULT '{}',
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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  upstream_id TEXT,
  -- When true: requests are logged but do not consume api_keys.used_tokens;
  -- token-quota checks are skipped for this model (RPM/request-quota still apply).
  quota_exempt BOOLEAN NOT NULL DEFAULT FALSE,
  -- Legacy mirror: true when access_roles is non-empty.
  privileged_only BOOLEAN NOT NULL DEFAULT FALSE,
  -- Role allowlist for this model (empty = all keys). Independent toggles:
  -- 'dev' (Super Admin), 'supporter' (name roster), 'ultra' (is_ultra flag).
  access_roles TEXT[] NOT NULL DEFAULT '{}'
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
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_created ON usage_events(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_api_key ON usage_events(api_key_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_buyer ON usage_events(buyer_id);

-- Admin request inspector: last user prompt only (max 1KB), pruned after 7 days.
CREATE TABLE IF NOT EXISTS request_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id UUID REFERENCES buyers(id) ON DELETE SET NULL,
  api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  model_id VARCHAR(128),
  status_code INTEGER NOT NULL,
  success BOOLEAN NOT NULL,
  prompt_tokens BIGINT DEFAULT 0,
  completion_tokens BIGINT DEFAULT 0,
  total_tokens BIGINT DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  error_code VARCHAR(64),
  ip_address VARCHAR(45),
  user_prompt TEXT,
  prompt_truncated BOOLEAN NOT NULL DEFAULT FALSE,
  ai_response TEXT,
  response_truncated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_request_logs_created ON request_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_logs_buyer ON request_logs(buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_logs_api_key ON request_logs(api_key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_logs_ip ON request_logs(ip_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_logs_model ON request_logs(model_id, created_at DESC);

CREATE TABLE IF NOT EXISTS upstreams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  base_url VARCHAR(1024) NOT NULL,
  api_key TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  weight INTEGER NOT NULL DEFAULT 1, -- dormant: RR/weight removed; column retained for compat
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS upstream_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upstream_id UUID NOT NULL REFERENCES upstreams(id) ON DELETE CASCADE,
  label VARCHAR(255) NOT NULL DEFAULT '',
  api_key TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_upstream_api_keys_upstream ON upstream_api_keys(upstream_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_upstream_api_keys_upstream_key ON upstream_api_keys(upstream_id, api_key);

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