# 9router

**9router** is a self-hosted OpenAI-compatible LLM API gateway.

It fronts one or more upstream providers, issues buyer API keys with quotas + rate limits, meters usage 1:1 with upstream token counts, and exposes both an admin dashboard and a public read-only panel.

Current release: **v1.3.0**

---

## Features

- OpenAI-compatible proxy: `POST /v1/chat/completions`, `GET /v1/models`
- Multi-upstream load balancing with weighted round-robin, failover, and on/off toggle
- Per-model upstream pinning (`models.upstream_id`) for preferred routing
- Branded catalog IDs with prefix `routers9/` (example: `routers9/grok/grok-4.5`)
- API key lifecycle: create, extend, add quota, VIP/Super Admin, soft-delete, bulk RPM/request limits
- Create-key defaults: token quota **100M / 250M / 500M**, fixed **50 RPM**
- VIP: token quota enforced (typically 500M); request quota skipped
- Super Admin: purple UI styling, unlimited token quota preserved on VIP toggle
- Token billing multiplier = **1** (matches upstream usage; no 2x)
- Public dashboard: Leaderboard (search `?q=`), Live, Usage (success-only 200), Models, Prices
- Admin dashboard: Overview, Keys, Leaderboard, Live, Usage, Models, Sales, Settings
- Daily token reset at 00:00 WIB for keys with `daily_reset = true`
- Admin session tracking + remote revoke
- Chart/time labels in `Asia/Jakarta` (WIB)

---

## Production deployment

| Role | URL |
|------|-----|
| Public dashboard | https://routers9.web.id |
| Admin panel + API | http://43.128.67.88 |
| OpenAI base URL | `http://43.128.67.88/v1` |
| Telegram orders | https://t.me/routers9 |

Stack in production:
- Backend: Node.js + TypeScript + Fastify (`src/server/`)
- Frontend: React 18 + Vite + Tailwind (`src/client/`)
- DB: PostgreSQL 16 (`9router`)
- Reverse proxy: Caddy
- Process manager: systemd unit `9router`

---

## Quick start (self-host)

### Prerequisites
- Node.js 20+
- PostgreSQL 16
- npm

### 1. Clone
```bash
git clone https://github.com/kevinnft/9router.git
cd 9router
```

### 2. Install
```bash
npm install
```

### 3. Environment
Create `.env` in the repo root (never commit this file):

```env
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

DATABASE_URL=postgresql://postgres:PASSWORD@localhost:5432/9router

JWT_SECRET=change-me-to-a-long-random-string
COOKIE_SECURE=false

# Fallback defaults when a key has no per-key RPM
BUYER_CHAT_RPM=60
HIDDEN_KEY_CHAT_RPM=100

# Optional legacy single-upstream seed (multi-upstream is preferred via admin UI / upstreams table)
UPSTREAM_BASE_URL=https://api.example.com/v1
UPSTREAM_API_KEY=sk-...
```

### 4. Database
```bash
createdb 9router
psql -d 9router -f schema.sql
```

Apply any later ops migrations as needed (VIP, Super Admin, `upstreams`, `usage_rollups`, brand rebrand, etc.). Production may already be ahead of the base `schema.sql`.

### 5. Build & run
```bash
npm run build
npm start
# dev: npm run dev
```

Frontend rebuild alone is zero-downtime:
```bash
npm run build
```
Backend code changes need a process restart (do not restart production without explicit approval).

---

## Project structure

```text
9router/
├── src/
│   ├── client/                 # Admin React app
│   │   └── src/pages/          # Overview, Keys, Leaderboard, Live, Usage, Models, Sales, Settings
│   ├── server/
│   │   ├── index.ts            # Fastify app, public HTML dashboard, static admin
│   │   ├── proxy-routes.ts     # /v1/* OpenAI proxy + metering
│   │   ├── admin-routes.ts     # Admin API
│   │   ├── public-routes.ts    # /public/* read-only API
│   │   ├── upstream.ts         # Multi-upstream RR / pin / failover
│   │   ├── model-alias.ts      # BRAND_PREFIX = routers9/
│   │   ├── repositories.ts     # API key cache + usability checks
│   │   ├── rate-limiter.ts     # Per-key fixed-window RPM
│   │   └── daily-reset.ts      # 00:00 WIB token reset
│   └── shared/
├── schema.sql
├── package.json                # version 1.3.0
├── tsconfig.json
└── vite.config.ts
```

---

## Model IDs

Public catalog IDs are branded:

```text
routers9/<upstream-model-path>
```

Examples:
- `routers9/grok/grok-4.5`
- `routers9/claude-sonnet-4.6`

Breaking change in v1.3.0: old `9router/...` IDs no longer match the brand allowlist. Clients must use `routers9/...`.

---

## API overview

### Public
| Method | Path | Notes |
|--------|------|-------|
| GET | `/` | Public dashboard HTML |
| GET | `/health` | Health check |
| GET | `/public/overview` | Global stats |
| GET | `/public/leaderboard?q=` | Top keys; optional name/key search; used/quota |
| GET | `/public/live` | Active buyers (last 5 min) |
| GET | `/public/usage` | Recent events, **success-only** (`success=true`, `status_code=200`) |
| GET | `/public/usage/chart?range=` | `15m` `1h` `6h` `12h` `1d` `3d` `7d` `1M` |
| GET | `/public/models` | Active branded models |

Emails are masked. Full API keys / key prefixes are not exposed on public endpoints.

### OpenAI-compatible proxy
| Method | Path | Auth |
|--------|------|------|
| GET | `/v1/models` | Bearer API key |
| POST | `/v1/chat/completions` | Bearer API key |

Example:
```bash
curl http://43.128.67.88/v1/chat/completions \
  -H "Authorization: Bearer 9r-YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "routers9/grok/grok-4.5",
    "messages": [{"role":"user","content":"Hello!"}]
  }'
```

### Admin (session cookie after login)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/admin/auth/login` | Login (rate-limited) |
| GET | `/admin/overview` | Dashboard metrics |
| GET | `/admin/keys` | List keys |
| POST | `/admin/create-key` | Create buyer + key (`quotaTokens`, fixed 50 RPM) |
| PATCH | `/admin/keys/:keyId/rate-limit` | Per-key RPM |
| PATCH | `/admin/keys/:keyId/vip` | Toggle VIP (+ quota tier, Super Admin exempt) |
| PATCH | `/admin/keys/bulk-rate-limit` | Bulk RPM |
| PATCH | `/admin/keys/bulk-request-limit` | Bulk request quota |
| GET/POST/PATCH/DELETE | `/admin/upstreams` | Multi-upstream CRUD |
| POST | `/admin/upstreams/:id/sync` | Sync models for one upstream (scoped delete) |
| POST | `/admin/models/sync` | Global free-tier sync (scoped) |
| GET/PUT | `/admin/settings/round-robin` | RR on/off flag |
| GET | `/admin/sessions` | Active admin sessions |
| DELETE | `/admin/sessions/:id` | Revoke session |

---

## Quotas & VIP

| Kind | Default / behavior |
|------|--------------------|
| New key token quota | 100M (choices: 100M / 250M / 500M) |
| New key RPM | 50 (fixed on create; editable later) |
| Non-VIP | Enforces `quota_tokens` + optional `quota_requests` |
| VIP | Enforces `quota_tokens` (typically 500M); skips `quota_requests` |
| Super Admin buyer | Unlimited token quota; VIP toggle does not overwrite to 100M/500M |

Billing: `TOKEN_MULTIPLIER = 1` — logged/charged tokens match upstream usage.

---

## Multi-upstream routing

1. If the requested model has `upstream_id`, route to that upstream first.
2. Else if round-robin is **on** (default): weighted RR across active upstreams.
3. Else: always primary (first active by `created_at`).
4. On retriable failure (429 / 5xx / timeout / connection): failover to next active upstream.

Response header `x-9router-upstream` shows which upstream handled the request.

**Sync safety:** per-upstream and global sync DELETEs are scoped — they do not wipe models belonging to other upstreams.

---

## Security notes

1. Never commit `.env`, production dumps, or `backup/config.json` secrets.
2. Prefer HTTPS + `COOKIE_SECURE=true` behind Caddy/Nginx when serving public domains.
3. Public panel strips key material server-side; do not reintroduce `key_prefix` in `/public/*`.
4. Review admin sessions periodically and revoke unknown devices.
5. This repository may contain operational history — treat it as private production code.

---

## Changelog

### v1.3.0 (2026-07-19)
- **feat**: Model brand prefix rebrand `9router/` → `routers9/`
- **feat**: Per-model upstream pinning with preferred-upstream proxy routing
- **feat**: Round-robin on/off toggle (`system_settings.round_robin_enabled` + Settings UI)
- **feat**: Create-key token quota choices 100M / 250M / 500M; fixed default RPM = 50
- **feat**: Super Admin special-case (purple UI, unlimited quota preserved on VIP toggle)
- **feat**: VIP enforces token quota (typically 500M) while still skipping request quota
- **feat**: Public leaderboard search (`?q=`) by buyer name / API key; shows used/quota
- **fix**: Public Usage is success-only (`success=true` and `status_code=200`)
- **fix**: Token billing multiplier set to `1` (match upstream, no 2x)
- **chore**: Ignore local backup dumps; drop obsolete tracked `.json.gz` backups

### v1.2.0 (2026-06-11)
- **feat**: Public dashboard at `routers9.web.id` (Leaderboard, Live, Usage, Models)
- **fix**: Admin/public request totals exclude `status_code = 400`
- **fix**: Chart queries use `AT TIME ZONE 'Asia/Jakarta'`
- **feat**: Caddy gzip compression
- **feat**: Inline data labels on public usage chart

### v1.1.0 (2026-06-09)
- **feat**: Multi-upstream weighted round-robin + failover
- **feat**: Leaderboard page (top requests/tokens)
- **fix**: Model sync auto-removes models missing from upstream
- **feat**: Daily token quota reset at 00:00 WIB
- **feat**: Admin session tracking with remote revoke
- **fix**: Rate limiter auto-cleanup

---

## License

Private / proprietary unless otherwise stated by the owner.

> Operational note: production restarts of the `9router` systemd service require explicit approval (zero-downtime preference).
