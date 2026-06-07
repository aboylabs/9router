import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import { config, isProduction } from "./config.js";
import { registerAdminRoutes, seedInitialAdmin } from "./admin-routes.js";
import { registerProxyRoutes } from "./proxy-routes.js";
import { startDailyResetCron } from "./daily-reset.js";
import { CREATABLE_PACKAGE_LABELS } from "../shared/package-catalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function buildApp() {
  const app = Fastify({
    logger: true,
    bodyLimit: 10 * 1024 * 1024,
    keepAliveTimeout: 72000,
    requestTimeout: 0,
    connectionTimeout: 300000
  });

  // Allow empty body for JSON content-type (e.g. logout)
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    try {
      const str = (body as string).trim();
      done(null, str ? JSON.parse(str) : {});
    } catch (err: any) {
      done(err, undefined);
    }
  });

  await app.register(fastifyCors, {
    origin: true,
    credentials: true
  });
  await app.register(fastifyCookie);
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: `${config.PUBLIC_BRAND_NAME} API`,
        version: "0.1.0"
      }
    }
  });
  await app.register(fastifySwaggerUi, { routePrefix: "/docs" });

  app.get("/health", async () => ({ ok: true, brand: config.PUBLIC_BRAND_NAME }));

  // Public models API (no auth required, for landing page)
  app.get("/public/models", async () => {
    const { query: dbQuery } = await import("./db.js");
    const result = await dbQuery<{ id: string; display_name: string }>(
      `SELECT id, display_name FROM models WHERE active = true AND id LIKE '9router/%' ORDER BY id`
    );
    return { models: result.rows };
  });

  // --- Customer Panel API ---
  app.post("/panel/auth/login", async (request, reply) => {
    const { query: dbQuery } = await import("./db.js");
    const body = request.body as { email?: string; password?: string };
    if (!body.email || !body.password) return reply.code(400).send({ error: "Email and password required" });

    const result = await dbQuery<{ id: string; name: string; email: string; password_plain: string }>(
      `SELECT id, name, email, password_plain FROM buyers WHERE email = $1 ORDER BY created_at DESC LIMIT 1`,
      [body.email.trim().toLowerCase()]
    );
    if (!result.rows[0]) return reply.code(401).send({ error: "Invalid email or password" });
    const buyer = result.rows[0];
    if (buyer.password_plain !== body.password) return reply.code(401).send({ error: "Invalid email or password" });

    // Get all keys for this buyer
    const keys = await dbQuery<{
      id: string; key_prefix: string; key_plain: string | null; label: string; expires_at: string | null;
      quota_tokens: string; used_tokens: string; created_at: string; revoked_at: string | null;
      daily_reset: boolean; daily_quota_tokens: string | null; package_id: string | null;
    }>(
      `SELECT id, key_prefix, key_plain, label, expires_at, quota_tokens, used_tokens, created_at, revoked_at, daily_reset, daily_quota_tokens, package_id
       FROM api_keys WHERE buyer_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [buyer.id]
    );

    // Get models for first active key
    const activeKey = keys.rows.find(k => !k.revoked_at);
    let models: { id: string; display_name: string }[] = [];
    if (activeKey) {
      const modelsResult = await dbQuery<{ id: string; display_name: string }>(
        `SELECT m.id, m.display_name FROM models m
         JOIN buyer_model_access bma ON bma.model_id = m.id
         WHERE bma.api_key_id = $1 AND m.active = true ORDER BY m.id`,
        [activeKey.id]
      );
      models = modelsResult.rows;
    }

    return {
      buyer: { id: buyer.id, name: buyer.name, email: buyer.email },
      keys: keys.rows,
      models
    };
  });

  await registerAdminRoutes(app);
  await registerProxyRoutes(app);

  if (isProduction) {
    const clientDir = config.CLIENT_DIR || path.resolve(__dirname, "../../dist/client");
    await app.register(fastifyStatic, {
      root: clientDir,
      prefix: "/admin/",
      wildcard: false
    });
    app.get("/admin", async (_request, reply) => reply.sendFile("index.html"));
    app.get("/admin/*", async (request, reply) => {
      const url = new URL(request.url, "http://localhost");
      const filePath = url.pathname.replace(/^\/admin\//, "");
      if (filePath.includes(".")) {
        return reply.sendFile(filePath);
      }
      return reply.sendFile("index.html");
    });
    app.get("/panel", async (_request, reply) => {
      return reply.type("text/html").send(customerPanelPage());
    });
    app.get("/panel/*", async (_request, reply) => {
      return reply.type("text/html").send(customerPanelPage());
    });
    app.get("/models", async (_request, reply) => {
      return reply.type("text/html").send(modelsLandingPage());
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/admin/") || request.url.startsWith("/v1/")) {
        return reply.code(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}

async function main() {
  await seedInitialAdmin();
  const app = await buildApp();
  startDailyResetCron();
  await app.listen({ port: config.PORT, host: config.HOST });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

function customerPanelPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>9router - My Dashboard</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
      padding: 2rem 1rem;
    }
    .container { max-width: 700px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 2rem; }
    .header h1 { font-size: 1.75rem; font-weight: 700; color: #f8fafc; margin-bottom: 0.25rem; }
    .header p { color: #94a3b8; font-size: 0.9rem; }

    /* Login */
    .login-card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 2rem;
      max-width: 400px;
      margin: 0 auto;
    }
    .login-card h2 { font-size: 1.1rem; margin-bottom: 1.25rem; color: #f1f5f9; }
    .form-group { margin-bottom: 1rem; }
    .form-group label { display: block; font-size: 0.75rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.35rem; }
    .form-group input {
      width: 100%;
      padding: 0.65rem 0.85rem;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      color: #e2e8f0;
      font-size: 0.9rem;
      outline: none;
      transition: border-color 0.2s;
    }
    .form-group input:focus { border-color: #3b82f6; }
    .btn {
      width: 100%;
      padding: 0.7rem;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s;
      margin-top: 0.5rem;
    }
    .btn:hover { background: #2563eb; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .error-msg { color: #f87171; font-size: 0.8rem; margin-top: 0.75rem; text-align: center; }

    /* Dashboard */
    .dashboard { display: none; }
    .dashboard.active { display: block; }
    .login-section.hidden { display: none; }
    .welcome-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.5rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid #1e293b;
    }
    .welcome-bar .name { font-weight: 600; color: #f1f5f9; }
    .welcome-bar .email { font-size: 0.8rem; color: #64748b; }
    .logout-btn {
      background: none;
      border: 1px solid #334155;
      color: #94a3b8;
      padding: 0.4rem 0.85rem;
      border-radius: 6px;
      font-size: 0.75rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    .logout-btn:hover { border-color: #f87171; color: #f87171; }

    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 1.25rem 1.5rem;
      margin-bottom: 1rem;
    }
    .card-title { font-size: 0.7rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.75rem; }
    .card-value { font-size: 1.1rem; font-weight: 600; color: #f1f5f9; }
    .card-value.mono { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.85rem; word-break: break-all; }

    .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 1rem; }
    .stat-card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 1rem 1.25rem;
    }
    .stat-label { font-size: 0.7rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.35rem; }
    .stat-value { font-size: 1.25rem; font-weight: 700; color: #f1f5f9; }
    .stat-value.green { color: #4ade80; }
    .stat-value.yellow { color: #fbbf24; }
    .stat-value.red { color: #f87171; }

    .progress-bar {
      width: 100%;
      height: 8px;
      background: #0f172a;
      border-radius: 4px;
      margin-top: 0.75rem;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.5s ease;
    }

    .copy-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .copy-btn {
      background: #334155;
      color: #94a3b8;
      border: none;
      border-radius: 6px;
      padding: 0.35rem 0.75rem;
      font-size: 0.7rem;
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
    }
    .copy-btn:hover { background: #3b82f6; color: white; }
    .copy-btn.copied { background: #10b981; color: white; }

    .models-list { margin-top: 0.5rem; }
    .model-tag {
      display: inline-block;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 0.3rem 0.6rem;
      font-size: 0.7rem;
      font-family: 'SF Mono', 'Fira Code', monospace;
      color: #60a5fa;
      margin: 0.2rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    .model-tag:hover { border-color: #3b82f6; background: #1e293b; }
    .model-tag.copied { border-color: #10b981; color: #4ade80; }

    .key-status {
      display: inline-block;
      font-size: 0.65rem;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      font-weight: 500;
      text-transform: uppercase;
    }
    .key-status.active { background: #052e16; color: #4ade80; }
    .key-status.expired { background: #451a03; color: #fbbf24; }
    .key-status.revoked { background: #450a0a; color: #f87171; }

    .footer { text-align: center; margin-top: 2rem; color: #475569; font-size: 0.75rem; }
    @media (max-width: 640px) {
      .stats-grid { grid-template-columns: 1fr; }
      .copy-row { flex-direction: column; align-items: flex-start; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>9router Dashboard</h1>
      <p>Manage your API key and track usage</p>
    </div>

    <!-- Login -->
    <div class="login-section" id="login-section">
      <div class="login-card">
        <h2>Sign In</h2>
        <form id="login-form">
          <div class="form-group">
            <label>Email</label>
            <input type="email" id="email" placeholder="your@email.com" required />
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" id="password" placeholder="Your password" required />
          </div>
          <button type="submit" class="btn" id="login-btn">Sign In</button>
          <div class="error-msg" id="error-msg"></div>
        </form>
      </div>
    </div>

    <!-- Dashboard -->
    <div class="dashboard" id="dashboard">
      <div class="welcome-bar">
        <div>
          <div class="name" id="buyer-name"></div>
          <div class="email" id="buyer-email"></div>
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <button class="logout-btn" id="refresh-btn" onclick="refreshData()" style="border-color: #3b82f6; color: #3b82f6;">Refresh</button>
          <button class="logout-btn" onclick="logout()">Logout</button>
        </div>
      </div>

      <!-- Base URL -->
      <div class="card">
        <div class="card-title">Base URL</div>
        <div class="copy-row">
          <div class="card-value mono">https://routers9.my.id/v1</div>
          <button class="copy-btn" onclick="copyText(this, 'base-url')">Copy</button>
        </div>
      </div>

      <!-- Keys Container (rendered dynamically) -->
      <div id="keys-container"></div>

      <!-- Models -->
      <div class="card">
        <div class="card-title">Available Models</div>
        <div class="models-list" id="models-list"></div>
      </div>

      <div class="footer">
        <p>9router API &mdash; <a href="/models" style="color: #3b82f6; text-decoration: none;">View all models</a></p>
      </div>
    </div>
  </div>

  <script>
    const loginForm = document.getElementById('login-form');
    const loginSection = document.getElementById('login-section');
    const dashboard = document.getElementById('dashboard');
    const errorMsg = document.getElementById('error-msg');

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorMsg.textContent = '';
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      const btn = document.getElementById('login-btn');
      btn.disabled = true;
      btn.textContent = 'Signing in...';

      try {
        const res = await fetch('/panel/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) {
          errorMsg.textContent = data.error || 'Login failed';
          btn.disabled = false;
          btn.textContent = 'Sign In';
          return;
        }
        sessionStorage.setItem('panel_data', JSON.stringify(data));
        sessionStorage.setItem('panel_creds', JSON.stringify({ email, password }));
        renderDashboard(data);
      } catch (err) {
        errorMsg.textContent = 'Network error. Try again.';
        btn.disabled = false;
        btn.textContent = 'Sign In';
      }
    });

    function renderDashboard(data) {
      loginSection.classList.add('hidden');
      dashboard.classList.add('active');

      document.getElementById('buyer-name').textContent = data.buyer.name;
      document.getElementById('buyer-email').textContent = data.buyer.email;

      const pkgLabels = ${JSON.stringify(CREATABLE_PACKAGE_LABELS)};

      const container = document.getElementById('keys-container');
      if (!data.keys || data.keys.length === 0) {
        container.innerHTML = '<div class="card"><div class="card-value" style="color:#94a3b8;">No API keys found</div></div>';
      } else {
        container.innerHTML = data.keys.map((key, idx) => {
          const now = new Date();
          const expires = key.expires_at ? new Date(key.expires_at) : null;
          const fullKey = key.key_plain || key.key_prefix + '...';

          // Status
          let statusClass = 'active';
          let statusText = 'Active';
          if (key.revoked_at) { statusClass = 'revoked'; statusText = 'Revoked'; }
          else if (expires && expires <= now) { statusClass = 'expired'; statusText = 'Expired'; }

          // Tokens
          const used = Number(key.used_tokens);
          const isDailyReset = key.daily_reset;
          const dailyQuota = Number(key.daily_quota_tokens) || 0;
          const totalQuota = Number(key.quota_tokens) || 0;
          const effectiveQuota = isDailyReset ? dailyQuota : totalQuota;
          const remaining = Math.max(0, effectiveQuota - used);
          const percent = effectiveQuota > 0 ? Math.min(100, (used / effectiveQuota) * 100) : 0;

          // Progress bar color
          let barColor = '#3b82f6';
          let remainColor = 'green';
          if (percent > 90) { barColor = '#f87171'; remainColor = 'red'; }
          else if (percent > 70) { barColor = '#fbbf24'; remainColor = 'yellow'; }

          // Package label
          const pkgLabel = pkgLabels[key.package_id] || key.label || 'Standard';

          // Usage label
          const usageLabel = isDailyReset ? "Today's Usage" : 'Tokens Used';
          const quotaLabel = isDailyReset ? 'Daily Quota' : 'Total Quota';

          // Expiry text
          let expiryText = 'No expiry';
          let expiryClass = '';
          if (expires) {
            expiryText = formatDateMY(expires);
            if (expires <= now) expiryClass = 'red';
          }

          // Daily reset notice
          const dailyResetHtml = isDailyReset ? '<div style="margin-top:0.75rem;padding:0.6rem 0.75rem;background:#1e3a5f;border:1px solid #2563eb;border-radius:8px;display:flex;align-items:center;gap:0.5rem;"><span style="font-size:1rem;">&#x1f504;</span><div><div style="font-size:0.75rem;font-weight:600;color:#93c5fd;">Daily Reset Active</div><div style="font-size:0.65rem;color:#94a3b8;">Resets at 00:00 WIB</div></div></div>' : '';

          return '<div class="card" style="border-left:3px solid ' + (statusClass === 'active' ? '#4ade80' : statusClass === 'expired' ? '#fbbf24' : '#f87171') + ';">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">' +
              '<div style="display:flex;align-items:center;gap:0.5rem;">' +
                '<span style="font-size:0.7rem;color:#64748b;font-weight:600;">KEY ' + (idx + 1) + '</span>' +
                '<span class="key-status ' + statusClass + '">' + statusText + '</span>' +
              '</div>' +
              '<span style="font-size:0.65rem;color:#64748b;background:#0f172a;padding:0.2rem 0.5rem;border-radius:4px;">' + pkgLabel + '</span>' +
            '</div>' +
            '<div class="copy-row" style="margin-bottom:0.75rem;">' +
              '<div class="card-value mono" id="key-display-' + idx + '">' + key.key_prefix + '...</div>' +
              '<div style="display:flex;gap:0.35rem;">' +
                '<button class="copy-btn" onclick="toggleKey(this,' + idx + ')">Show</button>' +
                '<button class="copy-btn" onclick="copyKey(this,' + idx + ')">Copy</button>' +
              '</div>' +
            '</div>' +
            '<input type="hidden" id="key-full-' + idx + '" value="' + fullKey.replace(/"/g, '&quot;') + '" />' +
            '<div class="stats-grid" style="margin-bottom:0.75rem;">' +
              '<div class="stat-card"><div class="stat-label">' + usageLabel + '</div><div class="stat-value">' + formatNum(used) + '</div></div>' +
              '<div class="stat-card"><div class="stat-label">' + quotaLabel + '</div><div class="stat-value">' + formatNum(effectiveQuota) + '</div></div>' +
              '<div class="stat-card"><div class="stat-label">Remaining</div><div class="stat-value ' + remainColor + '">' + formatNum(remaining) + '</div></div>' +
              '<div class="stat-card"><div class="stat-label">Expires</div><div class="stat-value ' + expiryClass + '">' + expiryText + '</div></div>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;font-size:0.8rem;color:#94a3b8;">' +
              '<span>' + percent.toFixed(1) + '%</span>' +
              '<span>' + formatNum(used) + ' / ' + formatNum(effectiveQuota) + '</span>' +
            '</div>' +
            '<div class="progress-bar"><div class="progress-fill" style="width:' + percent + '%;background:' + barColor + ';"></div></div>' +
            dailyResetHtml +
          '</div>';
        }).join('');
      }

      // Models
      const modelsList = document.getElementById('models-list');
      modelsList.innerHTML = data.models.map(m =>
        '<span class="model-tag" onclick="copyModel(this, \\'' + m.id + '\\')">' + m.id + '</span>'
      ).join('');
    }

    function formatNum(n) {
      if (n >= 1000000000) return (n / 1000000000).toFixed(1) + 'B';
      if (n >= 1000000) return (n / 1000000).toFixed(0) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
      return n.toLocaleString();
    }

    function formatDateMY(date) {
      return date.toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      }) + ' (WIB)';
    }

    function copyText(btn, type) {
      let text = '';
      if (type === 'base-url') text = 'https://routers9.my.id/v1';
      navigator.clipboard.writeText(text);
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
    }

    function toggleKey(btn, idx) {
      const display = document.getElementById('key-display-' + idx);
      const full = document.getElementById('key-full-' + idx).value;
      if (btn.textContent === 'Show') {
        display.textContent = full;
        btn.textContent = 'Hide';
      } else {
        display.textContent = full.substring(0, 12) + '...';
        btn.textContent = 'Show';
      }
    }

    function copyKey(btn, idx) {
      const full = document.getElementById('key-full-' + idx).value;
      navigator.clipboard.writeText(full);
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
    }

    function copyModel(el, id) {
      navigator.clipboard.writeText(id);
      el.classList.add('copied');
      const orig = el.textContent;
      el.textContent = 'Copied!';
      setTimeout(() => { el.textContent = orig; el.classList.remove('copied'); }, 1500);
    }

    function logout() {
      sessionStorage.removeItem('panel_data');
      sessionStorage.removeItem('panel_creds');
      loginSection.classList.remove('hidden');
      dashboard.classList.remove('active');
      document.getElementById('email').value = '';
      document.getElementById('password').value = '';
    }

    async function refreshData() {
      const creds = sessionStorage.getItem('panel_creds');
      if (!creds) { logout(); return; }
      const { email, password } = JSON.parse(creds);
      const btn = document.getElementById('refresh-btn');
      btn.textContent = 'Refreshing...';
      btn.disabled = true;
      try {
        const res = await fetch('/panel/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (res.ok) {
          sessionStorage.setItem('panel_data', JSON.stringify(data));
          renderDashboard(data);
        }
      } catch (e) {}
      btn.textContent = 'Refresh';
      btn.disabled = false;
    }

    // Auto-refresh on tab focus
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && dashboard.classList.contains('active')) {
        refreshData();
      }
    });

    // Auto-restore session
    const saved = sessionStorage.getItem('panel_data');
    if (saved) {
      try { renderDashboard(JSON.parse(saved)); } catch(e) { sessionStorage.removeItem('panel_data'); }
    }
  </script>
</body>
</html>`;
}

function modelsLandingPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>9router Models</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
    }
    .layout { display: flex; min-height: 100vh; }

    /* Sidebar */
    .sidebar {
      width: 200px;
      background: #1e293b;
      border-right: 1px solid #334155;
      padding: 1.5rem 0;
      flex-shrink: 0;
      position: sticky;
      top: 0;
      height: 100vh;
    }
    .sidebar-brand {
      padding: 0 1.25rem 1.25rem;
      border-bottom: 1px solid #334155;
      margin-bottom: 1rem;
    }
    .sidebar-brand h1 { font-size: 1.1rem; font-weight: 700; color: #f8fafc; }
    .sidebar-brand p { font-size: 0.7rem; color: #64748b; margin-top: 0.2rem; }
    .nav-item {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.7rem 1.25rem;
      font-size: 0.8rem;
      color: #94a3b8;
      cursor: pointer;
      border-left: 3px solid transparent;
      transition: all 0.2s;
      user-select: none;
    }
    .nav-item:hover { background: #0f172a; color: #e2e8f0; }
    .nav-item.active { background: #0f172a; color: #60a5fa; border-left-color: #3b82f6; font-weight: 500; }
    .nav-item svg { width: 16px; height: 16px; flex-shrink: 0; }

    /* Content */
    .content { flex: 1; padding: 2rem; overflow-y: auto; }
    .content-inner { max-width: 800px; margin: 0 auto; }
    .page { display: none; }
    .page.active { display: block; }

    /* Page header */
    .page-header { margin-bottom: 2rem; }
    .page-header h2 { font-size: 1.5rem; font-weight: 700; color: #f8fafc; margin-bottom: 0.25rem; }
    .page-header p { color: #94a3b8; font-size: 0.85rem; }

    /* Cards */
    .base-url-card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 1.25rem 1.5rem;
      margin-bottom: 1.5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    .base-url-card .label { font-size: 0.7rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem; }
    .base-url-card .url { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.9rem; color: #60a5fa; }
    .copy-btn {
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 8px;
      padding: 0.45rem 0.9rem;
      font-size: 0.75rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s;
      white-space: nowrap;
    }
    .copy-btn:hover { background: #2563eb; }
    .copy-btn.copied { background: #10b981; }

    /* Models */
    .models-grid { display: grid; gap: 0.5rem; }
    .model-item {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 0.875rem 1.25rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      transition: border-color 0.2s;
    }
    .model-item:hover { border-color: #3b82f6; }
    .model-name { font-weight: 500; color: #f1f5f9; font-size: 0.85rem; }
    .model-id {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.72rem;
      color: #64748b;
      cursor: pointer;
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
      transition: background 0.2s, color 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }
    .model-id:hover { background: #334155; color: #94a3b8; }
    .model-id.copied { background: #064e3b; color: #6ee7b7; }
    .model-id svg { width: 12px; height: 12px; opacity: 0.5; }
    .model-id:hover svg { opacity: 1; }
    .badge { font-size: 0.6rem; padding: 0.2rem 0.45rem; border-radius: 4px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.03em; }
    .badge-thinking { background: #1e1b4b; color: #a78bfa; }
    .badge-agentic { background: #052e16; color: #4ade80; }
    .badge-base { background: #172554; color: #60a5fa; }
    .badges { display: flex; gap: 0.35rem; }
    .section-title { font-size: 0.75rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.75rem; margin-top: 1.5rem; }

    /* Pro Tips */
    .pro-tips {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 1.25rem 1.5rem;
      margin-bottom: 1.5rem;
    }
    .pro-tips h3 { font-size: 0.8rem; color: #f1f5f9; margin-bottom: 0.75rem; font-weight: 600; }
    .pro-tips ul { list-style: none; padding: 0; }
    .pro-tips li {
      font-size: 0.78rem;
      color: #94a3b8;
      padding: 0.35rem 0;
      border-bottom: 1px solid #0f172a;
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
    }
    .pro-tips li:last-child { border-bottom: none; }
    .pro-tips .tip-icon { color: #3b82f6; flex-shrink: 0; margin-top: 0.1rem; }
    .pro-tips code { background: #0f172a; padding: 0.15rem 0.4rem; border-radius: 3px; font-size: 0.72rem; color: #60a5fa; }

    /* API Section */
    .api-card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 1.25rem 1.5rem;
      margin-bottom: 1rem;
    }
    .api-card-title { font-size: 0.7rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.75rem; }
    .endpoint-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      margin-bottom: 0.5rem;
      transition: border-color 0.2s;
    }
    .endpoint-item:hover { border-color: #475569; }
    .method-badge {
      font-size: 0.6rem;
      font-weight: 700;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      flex-shrink: 0;
    }
    .method-get { background: #052e16; color: #4ade80; }
    .method-post { background: #172554; color: #60a5fa; }
    .endpoint-path {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.8rem;
      color: #e2e8f0;
      font-weight: 500;
    }
    .endpoint-desc { font-size: 0.72rem; color: #64748b; margin-top: 0.15rem; }
    .code-block {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 1rem 1.25rem;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.72rem;
      color: #e2e8f0;
      overflow-x: auto;
      line-height: 1.6;
      margin-top: 0.75rem;
      position: relative;
      white-space: pre;
    }
    .code-block .comment { color: #64748b; }
    .code-block .string { color: #4ade80; }
    .code-block .key { color: #60a5fa; }
    .code-copy {
      position: absolute;
      top: 0.5rem;
      right: 0.5rem;
      background: #334155;
      color: #94a3b8;
      border: none;
      border-radius: 4px;
      padding: 0.25rem 0.5rem;
      font-size: 0.6rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    .code-copy:hover { background: #3b82f6; color: white; }
    .code-copy.copied { background: #10b981; color: white; }
    .auth-value {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.8rem;
      color: #fbbf24;
      background: #0f172a;
      padding: 0.4rem 0.75rem;
      border-radius: 6px;
      border: 1px solid #334155;
      display: inline-block;
    }

    .footer { text-align: center; margin-top: 2.5rem; color: #475569; font-size: 0.75rem; }
    .loading { text-align: center; padding: 2rem; color: #64748b; }

    @media (max-width: 768px) {
      .layout { flex-direction: column; }
      .sidebar {
        width: 100%;
        height: auto;
        position: static;
        display: flex;
        flex-wrap: wrap;
        padding: 0.75rem;
        gap: 0;
        border-right: none;
        border-bottom: 1px solid #334155;
      }
      .sidebar-brand { border-bottom: none; padding: 0.5rem 0.75rem; margin-bottom: 0; width: 100%; }
      .nav-item { border-left: none; border-bottom: 2px solid transparent; padding: 0.5rem 1rem; }
      .nav-item.active { border-left: none; border-bottom-color: #3b82f6; }
      .content { padding: 1.5rem 1rem; }
      .model-item { flex-direction: column; align-items: flex-start; gap: 0.5rem; }
      .base-url-card { flex-direction: column; align-items: flex-start; }
    }
  </style>
</head>
<body>
  <div class="layout">
    <!-- Sidebar -->
    <nav class="sidebar">
      <div class="sidebar-brand">
        <h1>9router</h1>
        <p>API Documentation</p>
      </div>
      <div class="nav-item active" data-page="models" onclick="switchPage('models', this)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        Models
      </div>
      <div class="nav-item" data-page="api" onclick="switchPage('api', this)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        OpenAI Compatible
      </div>
    </nav>

    <!-- Content -->
    <main class="content">
      <div class="content-inner">

        <!-- Models Page -->
        <div class="page active" id="page-models">
          <div class="page-header">
            <h2>Available Models</h2>
            <p>All models available for your API key. Click any model ID to copy.</p>
          </div>

          <div class="base-url-card">
            <div>
              <div class="label">Base URL</div>
              <div class="url">https://routers9.my.id/v1</div>
            </div>
            <button class="copy-btn" onclick="copyToClip(this, 'https://routers9.my.id/v1')">Copy</button>
          </div>

          <div class="pro-tips">
            <h3>Pro Tips</h3>
            <ul>
              <li><span class="tip-icon">&#9679;</span>Your API key starts with <code>9r-xxxx</code></li>
              <li><span class="tip-icon">&#9679;</span>Base URL: <code>https://routers9.my.id/v1</code></li>
              <li><span class="tip-icon">&#9679;</span>Click any model ID to copy it to clipboard</li>
              <li><span class="tip-icon">&#9679;</span>Works with any OpenAI-compatible client (Cursor, Continue, OpenRouter, etc.)</li>
              <li><span class="tip-icon">&#9679;</span>Supports streaming, function calling, and vision</li>
            </ul>
          </div>

          <div id="models-list">
            <div class="loading">Loading models...</div>
          </div>
        </div>

        <!-- OpenAI Compatible Page -->
        <div class="page" id="page-api">
          <div class="page-header">
            <h2>OpenAI Compatible API</h2>
            <p>Use any OpenAI-compatible client with 9router. Drop-in replacement.</p>
          </div>

          <!-- Auth -->
          <div class="api-card">
            <div class="api-card-title">Authentication</div>
            <p style="font-size: 0.8rem; color: #94a3b8; margin-bottom: 0.75rem;">Include your API key in the Authorization header:</p>
            <div class="auth-value">Authorization: Bearer 9r-xxxx</div>
          </div>

          <!-- Base URL -->
          <div class="api-card">
            <div class="api-card-title">Base URL</div>
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 1rem;">
              <div class="url" style="font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.9rem; color: #60a5fa;">https://routers9.my.id/v1</div>
              <button class="copy-btn" onclick="copyToClip(this, 'https://routers9.my.id/v1')">Copy</button>
            </div>
          </div>

          <!-- Endpoints -->
          <div class="api-card">
            <div class="api-card-title">Endpoints</div>
            <div class="endpoint-item">
              <span class="method-badge method-get">GET</span>
              <div>
                <div class="endpoint-path">/v1/models</div>
                <div class="endpoint-desc">List all models available to your API key</div>
              </div>
            </div>
            <div class="endpoint-item">
              <span class="method-badge method-post">POST</span>
              <div>
                <div class="endpoint-path">/v1/chat/completions</div>
                <div class="endpoint-desc">Create a chat completion (streaming &amp; non-streaming)</div>
              </div>
            </div>
          </div>

          <!-- Example -->
          <div class="api-card">
            <div class="api-card-title">Example: Chat Completion</div>
            <div class="code-block" id="code-nonstream"><button class="code-copy" onclick="copyCurl(this, 'nonstream')">Copy</button><span class="comment"># Non-streaming</span>
curl https://routers9.my.id/v1/chat/completions \
  -H <span class="string">"Authorization: Bearer 9r-xxxx"</span> \
  -H <span class="string">"Content-Type: application/json"</span> \
  -d <span class="string">'{
  "model": "9router/claude-sonnet-4.6",
  "messages": [{"role": "user", "content": "Hello!"}]
}'</span></div>
            <div class="code-block" id="code-stream"><button class="code-copy" onclick="copyCurl(this, 'stream')">Copy</button><span class="comment"># Streaming</span>
curl https://routers9.my.id/v1/chat/completions \
  -H <span class="string">"Authorization: Bearer 9r-xxxx"</span> \
  -H <span class="string">"Content-Type: application/json"</span> \
  -d <span class="string">'{
  "model": "9router/claude-sonnet-4.6",
  "messages": [{"role": "user", "content": "Hello!"}],
  "stream": true
}'</span></div>
          </div>

          <!-- Compatible Clients -->
          <div class="api-card">
            <div class="api-card-title">Compatible Clients</div>
            <div style="display: flex; flex-wrap: wrap; gap: 0.4rem;">
              <span style="background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 0.3rem 0.7rem; font-size: 0.72rem; color: #e2e8f0;">Cursor</span>
              <span style="background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 0.3rem 0.7rem; font-size: 0.72rem; color: #e2e8f0;">Continue</span>
              <span style="background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 0.3rem 0.7rem; font-size: 0.72rem; color: #e2e8f0;">OpenCode</span>
              <span style="background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 0.3rem 0.7rem; font-size: 0.72rem; color: #e2e8f0;">Cline</span>
              <span style="background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 0.3rem 0.7rem; font-size: 0.72rem; color: #e2e8f0;">OpenRouter</span>
              <span style="background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 0.3rem 0.7rem; font-size: 0.72rem; color: #e2e8f0;">Any OpenAI SDK</span>
            </div>
          </div>
        </div>

        <div class="footer">
          <p>9router API &mdash; OpenAI-compatible inference</p>
        </div>
      </div>
    </main>
  </div>

  <script>
    function switchPage(page, el) {
      document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
      document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
      document.getElementById('page-' + page).classList.add('active');
      el.classList.add('active');
    }

    async function loadModels() {
      try {
        var res = await fetch('/public/models');
        var data = await res.json();
        renderModels(data.models);
      } catch (e) {
        document.getElementById('models-list').innerHTML = '<p class="loading">Failed to load models</p>';
      }
    }

    function renderModels(models) {
      var grouped = {};
      for (var i = 0; i < models.length; i++) {
        var m = models[i];
        var base = m.id.replace(/-(?:agentic|thinking|thinking-agentic)$/, '');
        if (!grouped[base]) grouped[base] = [];
        grouped[base].push(m);
      }

      var html = '';
      var keys = Object.keys(grouped);
      for (var k = 0; k < keys.length; k++) {
        var base = keys[k];
        var variants = grouped[base];
        var baseName = '';
        for (var j = 0; j < variants.length; j++) {
          if (variants[j].id === base) { baseName = variants[j].display_name; break; }
        }
        if (!baseName) baseName = base.replace('9router/', '');
        html += '<div class="section-title">' + baseName + '</div>';
        html += '<div class="models-grid">';
        for (var v = 0; v < variants.length; v++) {
          var model = variants[v];
          var badges = getBadges(model.id, base);
          html += '<div class="model-item">' +
            '<div><div class="model-name">' + model.display_name + '</div>' +
            '<div class="model-id" data-id="' + model.id + '" onclick="copyModelId(this)"><span>' + model.id + '</span><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></div></div>' +
            '<div class="badges">' + badges + '</div>' +
            '</div>';
        }
        html += '</div>';
      }
      document.getElementById('models-list').innerHTML = html;
    }

    function getBadges(id, base) {
      if (id === base) return '<span class="badge badge-base">base</span>';
      var parts = [];
      if (id.indexOf('thinking') !== -1) parts.push('<span class="badge badge-thinking">thinking</span>');
      if (id.indexOf('agentic') !== -1) parts.push('<span class="badge badge-agentic">agentic</span>');
      return parts.join('');
    }

    function copyToClip(btn, text) {
      navigator.clipboard.writeText(text);
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
    }

    function copyModelId(el) {
      var id = el.getAttribute('data-id');
      navigator.clipboard.writeText(id);
      var span = el.querySelector('span');
      var original = span.textContent;
      span.textContent = 'Copied!';
      el.classList.add('copied');
      setTimeout(function() { span.textContent = original; el.classList.remove('copied'); }, 1500);
    }

    function copyCurl(btn, type) {
      var text = '';
      if (type === 'nonstream') {
        text = "curl https://routers9.my.id/v1/chat/completions \\\\n  -H \\"Authorization: Bearer 9r-xxxx\\" \\\\n  -H \\"Content-Type: application/json\\" \\\\n  -d '{\\n  \\"model\\": \\"9router/claude-sonnet-4.6\\",\\n  \\"messages\\": [{\\"role\\": \\"user\\", \\"content\\": \\"Hello!\\"}]\\n}'";
      } else {
        text = "curl https://routers9.my.id/v1/chat/completions \\\\n  -H \\"Authorization: Bearer 9r-xxxx\\" \\\\n  -H \\"Content-Type: application/json\\" \\\\n  -d '{\\n  \\"model\\": \\"9router/claude-sonnet-4.6\\",\\n  \\"messages\\": [{\\"role\\": \\"user\\", \\"content\\": \\"Hello!\\"}],\\n  \\"stream\\": true\\n}'";
      }
      navigator.clipboard.writeText(text);
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
    }

    loadModels();
  </script>
</body>
</html>`;
}
