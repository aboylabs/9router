# 9router

**9router** is a high-performance, self-hosted LLM API Gateway and Router. It allows you to manage API keys, enforce quotas, apply rate limits, and route requests to various upstream AI providers (Qwen, DeepSeek, MiniMax, GLM, etc.) through a single, unified OpenAI-compatible endpoint.

Built for reliability, scalability, and ease of use, 9router provides a modern admin dashboard to manage buyers, monitor live usage, and control model access.

---

## ✨ Features

- **Unified API Gateway**: Single OpenAI-compatible endpoint (`/v1/chat/completions`) for all upstream models.
- **API Key Management**: Create, manage, extend, and revoke API keys for individual buyers.
- **Quota Management**: 
  - Total token quotas per key.
  - **Daily Reset**: Automatic token quota reset at 00:00 WIB for specific packages.
- **Advanced Rate Limiting**: 
  - Per-key RPM (Requests Per Minute) rate limiting.
  - Bulk update capabilities to apply rate/request limits to all active keys simultaneously.
- **Usage Tracking**: Detailed logging of prompt/completion tokens, latency, cost estimates, and success/failure rates.
- **Admin Session Tracking**: Monitor active admin sessions with device, IP, and browser information, with the ability to revoke specific sessions remotely.
- **Model Catalog**: Dynamic model management with input/output cost configuration per million tokens.
- **Modern Dashboard**: Responsive, dark-mode-ready React admin panel with real-time live usage monitoring and usage charts.

---

## 🛠️ Tech Stack

- **Backend**: Node.js, TypeScript, Fastify
- **Frontend**: React 18, Vite, TailwindCSS, Radix UI, Recharts
- **Database**: PostgreSQL 16 (with `pgcrypto` extension)
- **Reverse Proxy**: Caddy (recommended for TLS/HTTPS)
- **Authentication**: JWT (JSON Web Tokens) + bcrypt

---

## 📦 Prerequisites

- Node.js 20.x or higher
- PostgreSQL 16
- npm or pnpm

---

## 🚀 Installation & Setup

### 1. Clone the Repository
```bash
git clone https://github.com/kevinnft/9router.git
cd 9router
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Configuration
Create a `.env` file in the root directory:
```env
# Server Configuration
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

# Database Configuration
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/9router

# Security
JWT_SECRET=your-super-secret-jwt-key-change-this
COOKIE_SECURE=false # Set to true if using HTTPS

# Rate Limiting Defaults
BUYER_CHAT_RPM=60
HIDDEN_KEY_CHAT_RPM=100

# Upstream Configuration (Example)
UPSTREAM_BASE_URL=https://api.upstream-provider.com/v1
UPSTREAM_API_KEY=your-upstream-api-key
```

### 4. Database Setup
Create the database and apply the schema:
```bash
# Create database (via psql)
createdb 9router

# Apply schema (enables pgcrypto and creates tables)
psql -d 9router -f schema.sql
```

### 5. Build and Start
```bash
# Build frontend and backend
npm run build

# Start the production server
npm start
```
*(For development, use `npm run dev`)*

---

## 📁 Project Structure

```text
9router/
├── src/
│   ├── client/       # React frontend (Vite + Tailwind)
│   ├── server/       # Fastify backend (routes, db, security)
│   └── shared/       # Shared types and constants
├── schema.sql        # PostgreSQL database schema
├── package.json      # Dependencies and scripts
├── tsconfig.json     # TypeScript configuration
└── vite.config.ts    # Vite build configuration
```

---

## 🔌 API Endpoints Overview

### Public / Proxy
- `GET /health` - Health check endpoint.
- `GET /public/models` - List available white-label models.
- `POST /v1/chat/completions` - OpenAI-compatible chat completion endpoint (requires Bearer API key).

### Admin (Requires Authentication)
- `POST /admin/auth/login` - Admin authentication.
- `GET /admin/overview` - Dashboard metrics.
- `GET /admin/keys` - List all active API keys.
- `POST /admin/create-key` - Create a new buyer and API key.
- `PATCH /admin/keys/:keyId/rate-limit` - Update RPM limit for a specific key.
- `PATCH /admin/keys/bulk-rate-limit` - Apply RPM limit to all active keys.
- `PATCH /admin/keys/bulk-request-limit` - Apply request limit to all active keys.
- `GET /admin/sessions` - List active admin sessions.
- `DELETE /admin/sessions/:id` - Revoke a specific admin session.

---

## 🛡️ Security & Best Practices

1. **Never commit `.env`**: The `.env` file is ignored by git. Keep your `JWT_SECRET` and `UPSTREAM_API_KEY` secure.
2. **Use HTTPS**: Always set `COOKIE_SECURE=true` and run behind a reverse proxy like Caddy or Nginx with valid SSL certificates.
3. **Session Management**: Regularly review the "Active Sessions" in the admin settings and revoke any unrecognized devices.
4. **Database Backups**: Schedule regular PostgreSQL dumps (`pg_dump`) to prevent data loss.

---

## 📋 Changelog

### v1.1.0 (2026-06-09)
- **feat**: Multi-upstream support with weighted round-robin and failover (`upstreams` table, per-upstream sync)
- **feat**: Leaderboard page — top API keys ranked by request count and token usage, with sortable columns and summary cards
- **fix**: Model sync now auto-removes models that no longer exist in upstream (prevents stale/ghost models in admin panel)
- **fix**: Removed `MiniMax-M2.1` from `ALWAYS_AVAILABLE_MODELS` (no longer available upstream)
- **feat**: Daily token quota reset at 00:00 WIB for configured packages
- **feat**: Admin session tracking with device/IP info and remote revoke
- **fix**: Rate limiter auto-cleanup to prevent memory leaks

---

## 📝 License

MIT License. See [LICENSE](LICENSE) for details.

---

> **Note**: This project is actively maintained. For issues or feature requests, please open an issue in the repository.