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
import { registerPublicRoutes } from "./public-routes.js";
import { startDailyResetCron } from "./daily-reset.js";
import { CREATABLE_PACKAGE_LABELS } from "../shared/package-catalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function buildApp() {
  const app = Fastify({
    logger: true,
    trustProxy: true,
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

  // Production CORS: allowlist only. No-origin requests (curl/server) stay allowed.
  const corsAllowlist = new Set(
    [
      "https://routers9.web.id",
      "http://43.128.67.88",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      config.PUBLIC_BASE_URL
    ].filter(Boolean)
  );
  await app.register(fastifyCors, {
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (corsAllowlist.has(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true
  });
  await app.register(fastifyCookie);

  // Swagger only in non-production (reduces public recon surface)
  if (!isProduction) {
    await app.register(fastifySwagger, {
      openapi: {
        info: {
          title: `${config.PUBLIC_BRAND_NAME} API`,
          version: "0.1.0"
        }
      }
    });
    await app.register(fastifySwaggerUi, { routePrefix: "/docs" });
  }

  app.get("/health", async () => ({ ok: true, brand: config.PUBLIC_BRAND_NAME }));

  // Public models API (no auth required, for landing page + public dashboard)
  app.get("/public/models", async () => {
    const { query: dbQuery } = await import("./db.js");
    const result = await dbQuery<{
      id: string;
      display_name: string;
      quota_exempt: boolean;
      privileged_only: boolean;
      access_roles: string[] | null;
    }>(
      // Restricted models are VISIBLE publicly with role badges, but only
      // matching roles can call them (buyer_model_access).
      `SELECT id, display_name,
              coalesce(quota_exempt, false) as quota_exempt,
              coalesce(privileged_only, false) as privileged_only,
              coalesce(access_roles, '{}'::text[]) as access_roles
       FROM models
       WHERE active = true
         AND id LIKE 'routers9/%'
       ORDER BY cardinality(coalesce(access_roles, '{}'::text[])) DESC,
                coalesce(quota_exempt, false) DESC,
                display_name ASC, id ASC`
    );
    return {
      models: result.rows.map((row) => ({
        ...row,
        access_roles: Array.isArray(row.access_roles) ? row.access_roles : [],
        privileged_only:
          row.privileged_only ||
          (Array.isArray(row.access_roles) && row.access_roles.length > 0),
      })),
    };
  });

  await registerPublicRoutes(app);
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
    app.get("/models", async (_request, reply) => {
      return reply.type("text/html").send(modelsLandingPage());
    });
    app.get("/", async (_request, reply) => {
      return reply.type("text/html").send(publicDashboardPage());
    });
    app.setNotFoundHandler((request, reply) => {
      // Admin SPA deep-links (no file extension) still serve index.html
      if (request.url === "/admin" || request.url.startsWith("/admin/")) {
        const url = new URL(request.url, "http://localhost");
        const filePath = url.pathname.replace(/^\/admin\/?/, "");
        if (filePath && filePath.includes(".")) {
          return reply.code(404).send({ error: "Not found" });
        }
        return reply.sendFile("index.html");
      }
      if (request.url.startsWith("/v1/") || request.url.startsWith("/public/")) {
        return reply.code(404).send({ error: "Not found" });
      }
      // Do not leak admin SPA HTML for random recon paths (/.env, /package.json, etc.)
      return reply.code(404).type("text/plain").send("Not found");
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
              <div class="url">https://routers9.web.id/v1</div>
            </div>
            <button class="copy-btn" onclick="copyToClip(this, 'https://routers9.web.id/v1')">Copy</button>
          </div>

          <div class="pro-tips">
            <h3>Pro Tips</h3>
            <ul>
              <li><span class="tip-icon">&#9679;</span>Your API key starts with <code>9r-xxxx</code></li>
              <li><span class="tip-icon">&#9679;</span>Base URL: <code>https://routers9.web.id/v1</code></li>
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
              <div class="url" style="font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.9rem; color: #60a5fa;">https://routers9.web.id/v1</div>
              <button class="copy-btn" onclick="copyToClip(this, 'https://routers9.web.id/v1')">Copy</button>
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
curl https://routers9.web.id/v1/chat/completions \
  -H <span class="string">"Authorization: Bearer ***"</span> \
  -H <span class="string">"Content-Type: application/json"</span> \
  -d <span class="string">'{
  "model": "routers9/grok-4.5",
  "messages": [{"role": "user", "content": "Hello!"}]
}'</span></div>
            <div class="code-block" id="code-stream"><button class="code-copy" onclick="copyCurl(this, 'stream')">Copy</button><span class="comment"># Streaming</span>
curl https://routers9.web.id/v1/chat/completions \
  -H <span class="string">"Authorization: Bearer ***"</span> \
  -H <span class="string">"Content-Type: application/json"</span> \
  -d <span class="string">'{
  "model": "routers9/grok-4.5",
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
        if (!baseName) baseName = base.replace('routers9/', '');
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
        text = "curl https://routers9.web.id/v1/chat/completions \\\\n  -H \\"Authorization: Bearer 9r-xxxx\\" \\\\n  -H \\"Content-Type: application/json\\" \\\\n  -d '{\\n  \\"model\\": \\"routers9/grok-4.5\\",\\n  \\"messages\\": [{\\"role\\": \\"user\\", \\"content\\": \\"Hello!\\"}]\\n}'";
      } else {
        text = "curl https://routers9.web.id/v1/chat/completions \\\\n  -H \\"Authorization: Bearer 9r-xxxx\\" \\\\n  -H \\"Content-Type: application/json\\" \\\\n  -d '{\\n  \\"model\\": \\"routers9/grok-4.5\\",\\n  \\"messages\\": [{\\"role\\": \\"user\\", \\"content\\": \\"Hello!\\"}],\\n  \\"stream\\": true\\n}'";
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

function publicDashboardPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Routers9 — Public Dashboard · LLM API Gateway</title>
  <meta name="description" content="Routers9 public dashboard — live leaderboard, usage stats, and model catalog for the Routers9 LLM API gateway. Grok, Claude, and more via one OpenAI-compatible endpoint.">
  <meta name="theme-color" content="#070b16">
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0%25' stop-color='%237c3aed'/%3E%3Cstop offset='100%25' stop-color='%232563eb'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='64' height='64' rx='14' fill='url(%23g)'/%3E%3Ctext x='32' y='42' text-anchor='middle' font-family='Arial,sans-serif' font-size='26' font-weight='800' fill='white'%3ER9%3C/text%3E%3C/svg%3E">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Routers9">
  <meta property="og:title" content="Routers9 — Public Dashboard">
  <meta property="og:description" content="Live leaderboard, usage stats, and model catalog. Grok, Claude, and more via one OpenAI-compatible API.">
  <meta property="og:url" content="https://routers9.web.id/">
  <meta name="twitter:card" content="summary">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { -webkit-tap-highlight-color: transparent; scroll-behavior: smooth; }
    body {
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background:
        radial-gradient(1200px 600px at 10% -10%, rgba(124,58,237,0.18), transparent 55%),
        radial-gradient(900px 500px at 100% 0%, rgba(37,99,235,0.16), transparent 50%),
        radial-gradient(800px 500px at 50% 100%, rgba(16,185,129,0.08), transparent 55%),
        #070b16;
      color: #e2e8f0;
      min-height: 100vh;
      overflow-x: hidden;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      text-rendering: optimizeLegibility;
    }
    ::selection { background: rgba(124,58,237,0.35); color: #f8fafc; }

    /* === CUSTOM SCROLLBAR (dark, thin) === */
    * { scrollbar-width: thin; scrollbar-color: rgba(148,163,184,0.28) transparent; }
    ::-webkit-scrollbar { width: 9px; height: 9px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb {
      background: rgba(148,163,184,0.22);
      border-radius: 999px;
      border: 2px solid #070b16;
    }
    ::-webkit-scrollbar-thumb:hover { background: rgba(167,139,250,0.4); }

    /* === SKELETON LOADING === */
    .skeleton-wrap { display: flex; flex-direction: column; gap: 0.6rem; padding: 0.4rem 0; }
    .skeleton {
      position: relative; overflow: hidden;
      background: rgba(148,163,184,0.08);
      border-radius: 10px; height: 44px;
    }
    .skeleton.sk-lg { height: 92px; border-radius: 16px; }
    .skeleton::after {
      content: ''; position: absolute; inset: 0;
      background: linear-gradient(90deg, transparent, rgba(148,163,184,0.10), transparent);
      transform: translateX(-100%);
      animation: skShimmer 1.4s ease-in-out infinite;
    }
    @keyframes skShimmer { 100% { transform: translateX(100%); } }
    @media (prefers-reduced-motion: reduce) { .skeleton::after { animation: none; } }

    /* === NUMERIC ALIGNMENT === */
    td, .stat-value, .podium-stat { font-variant-numeric: tabular-nums; }

    /* === PUBLIC FOOTER === */
    .pub-footer {
      margin-top: 2.6rem; padding-top: 1.15rem;
      border-top: 1px solid rgba(148,163,184,0.1);
      display: flex; align-items: center; justify-content: space-between;
      gap: 0.8rem; flex-wrap: wrap;
      font-size: 0.78rem; color: #64748b;
    }
    .pub-footer a { color: #94a3b8; text-decoration: none; font-weight: 600; }
    .pub-footer a:hover { color: #c4b5fd; }
    .status-pill {
      display: inline-flex; align-items: center; gap: 0.4rem;
      font-weight: 700; color: #86efac;
      background: rgba(22,163,74,0.1); border: 1px solid rgba(74,222,128,0.2);
      padding: 0.28rem 0.65rem; border-radius: 999px;
    }
    .status-pill::before {
      content: ''; width: 7px; height: 7px; border-radius: 999px; background: #4ade80;
      box-shadow: 0 0 0 0 rgba(74,222,128,0.55); animation: livePulse 1.6s infinite;
    }
    .status-pill.down { color: #fca5a5; background: rgba(220,38,38,0.1); border-color: rgba(248,113,113,0.25); }
    .status-pill.down::before { background: #f87171; animation: none; }

    /* === EMPTY STATE ICON === */
    .empty svg { width: 34px; height: 34px; display: block; margin: 0 auto 0.7rem; color: #475569; }
    .layout { display: flex; min-height: 100vh; position: relative; }

    /* === DESKTOP SIDEBAR === */
    .sidebar {
      width: 232px;
      background: linear-gradient(180deg, rgba(15,23,42,0.95) 0%, rgba(15,23,42,0.82) 100%);
      backdrop-filter: blur(16px);
      border-right: 1px solid rgba(148,163,184,0.12);
      padding: 1.25rem 0.85rem 1.5rem;
      position: fixed;
      height: 100vh;
      overflow-y: auto;
      z-index: 100;
      box-shadow: 8px 0 40px rgba(0,0,0,0.18);
    }
    .sidebar-header {
      padding: 0.35rem 0.55rem 1.15rem;
      border-bottom: 1px solid rgba(148,163,184,0.12);
      margin-bottom: 0.9rem;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
    }
    .brand-wrap { display: flex; align-items: center; gap: 0.7rem; margin-right: auto; }
    .brand-mark {
      width: 40px; height: 40px; border-radius: 12px;
      position: relative;
      display: grid; place-items: center;
      background:
        linear-gradient(135deg, rgba(255,255,255,0.18), transparent 40%),
        linear-gradient(145deg, #7c3aed 0%, #4f46e5 42%, #2563eb 72%, #06b6d4 100%);
      color: #fff;
      font-weight: 900;
      font-size: 0.92rem;
      letter-spacing: -0.04em;
      box-shadow:
        0 10px 24px rgba(124,58,237,0.38),
        inset 0 1px 0 rgba(255,255,255,0.28),
        inset 0 -8px 16px rgba(15,23,42,0.18);
      overflow: hidden;
    }
    .brand-mark::before {
      content: '';
      position: absolute;
      inset: 1px;
      border-radius: 11px;
      border: 1px solid rgba(255,255,255,0.18);
      pointer-events: none;
    }
    .brand-mark::after {
      content: '';
      position: absolute;
      top: -40%; left: -30%;
      width: 70%; height: 70%;
      background: radial-gradient(circle, rgba(255,255,255,0.35), transparent 70%);
      pointer-events: none;
    }
    .brand-mark span {
      position: relative;
      z-index: 1;
      text-shadow: 0 1px 8px rgba(15,23,42,0.35);
      font-variant-numeric: tabular-nums;
    }
    .sidebar-header h1 {
      font-size: 1.2rem; font-weight: 900; letter-spacing: -0.03em;
      background: linear-gradient(90deg, #f8fafc 0%, #c4b5fd 45%, #67e8f9 100%);
      -webkit-background-clip: text; background-clip: text; color: transparent;
      line-height: 1.1;
    }
    .sidebar-header p { font-size: 0.72rem; color: #64748b; margin-top: 0.18rem; width: 100%; padding-left: 0.15rem; }
    .tg-link {
      color: #94a3b8; transition: all 0.2s; text-decoration: none;
      display: flex; align-items: center; justify-content: center;
      width: 34px; height: 34px; border-radius: 10px;
      border: 1px solid rgba(148,163,184,0.14);
      background: rgba(15,23,42,0.55);
    }
    .tg-link:hover { color: #60a5fa; border-color: rgba(96,165,250,0.45); background: rgba(37,99,235,0.12); transform: translateY(-1px); }
    .nav-item {
      display: flex;
      align-items: center;
      gap: 0.7rem;
      padding: 0.72rem 0.85rem;
      margin: 0.18rem 0;
      font-size: 0.9rem;
      color: #94a3b8;
      cursor: pointer;
      transition: all 0.18s ease;
      border-left: none;
      border-radius: 12px;
      font-weight: 500;
    }
    .nav-item:hover { background: rgba(148,163,184,0.08); color: #e2e8f0; }
    .nav-item.active {
      background: linear-gradient(90deg, rgba(124,58,237,0.22), rgba(37,99,235,0.12));
      color: #f8fafc;
      box-shadow: inset 0 0 0 1px rgba(167,139,250,0.25);
    }
    .nav-item.active .nav-icon { color: #c4b5fd; }
    .nav-icon { width: 18px; height: 18px; flex-shrink: 0; }

    /* === MAIN CONTENT === */
    .content {
      flex: 1;
      margin-left: 232px;
      padding: 2rem 2.5rem 3rem;
      max-width: 1480px;
      width: 100%;
      position: relative;
      z-index: 1;
    }
    .page { display: none; animation: pageIn 0.28s ease; }
    .page.active { display: block; }
    @keyframes pageIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .page-header {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 1rem; flex-wrap: wrap; margin-bottom: 1.4rem;
      padding-bottom: 0.15rem;
    }
    .page-title {
      font-size: 1.7rem; font-weight: 800; letter-spacing: -0.035em;
      color: #f8fafc; margin-bottom: 0.4rem;
    }
    .page-title span.grad {
      background: linear-gradient(90deg, #c4b5fd, #818cf8, #60a5fa);
      -webkit-background-clip: text; background-clip: text; color: transparent;
    }
    .page-desc { font-size: 0.92rem; color: #94a3b8; margin-bottom: 0; line-height: 1.55; max-width: 48rem; }
    .live-dot {
      display: inline-flex; align-items: center; gap: 0.45rem;
      font-size: 0.75rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
      color: #86efac; background: rgba(22,163,74,0.12); border: 1px solid rgba(74,222,128,0.25);
      padding: 0.35rem 0.7rem; border-radius: 999px;
    }
    .live-dot::before {
      content: ''; width: 8px; height: 8px; border-radius: 999px; background: #4ade80;
      box-shadow: 0 0 0 0 rgba(74,222,128,0.55); animation: livePulse 1.6s infinite;
    }
    @keyframes livePulse {
      0% { box-shadow: 0 0 0 0 rgba(74,222,128,0.55); }
      70% { box-shadow: 0 0 0 8px rgba(74,222,128,0); }
      100% { box-shadow: 0 0 0 0 rgba(74,222,128,0); }
    }

    /* === STATS GRID === */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .stat-card {
      background: linear-gradient(180deg, rgba(30,41,59,0.9), rgba(15,23,42,0.75));
      border: 1px solid rgba(148,163,184,0.14);
      border-radius: 16px;
      padding: 1.15rem 1.25rem;
      transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s;
      position: relative;
      overflow: hidden;
    }
    .stat-card::after {
      content: ''; position: absolute; inset: auto -20% -40% auto; width: 120px; height: 120px;
      background: radial-gradient(circle, rgba(96,165,250,0.18), transparent 70%);
      pointer-events: none;
    }
    .stat-card:hover { transform: translateY(-3px); border-color: rgba(96,165,250,0.35); box-shadow: 0 14px 30px rgba(0,0,0,0.22); }
    .stat-label { font-size: 0.72rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.45rem; font-weight: 600; }
    .stat-value { font-size: 1.7rem; font-weight: 800; color: #f8fafc; letter-spacing: -0.02em; }
    .stat-value.blue { color: #60a5fa; }
    .stat-value.green { color: #4ade80; }
    .stat-value.yellow { color: #fbbf24; }

    /* === TABLES === */
    .table-wrapper {
      overflow-x: auto; -webkit-overflow-scrolling: touch;
      background: linear-gradient(180deg, rgba(15,23,42,0.72), rgba(15,23,42,0.55));
      border: 1px solid rgba(148,163,184,0.12);
      border-radius: 18px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.18);
    }
    table { width: 100%; border-collapse: collapse; min-width: 700px; }
    th {
      text-align: left;
      font-size: 0.72rem;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding: 0.95rem 1.05rem;
      border-bottom: 1px solid rgba(148,163,184,0.12);
      position: sticky;
      top: 0;
      background: rgba(11,16,32,0.96);
      backdrop-filter: blur(10px);
      z-index: 10;
      font-weight: 700;
      white-space: nowrap;
    }
    td {
      font-size: 0.875rem;
      padding: 0.95rem 1.05rem;
      border-bottom: 1px solid rgba(148,163,184,0.07);
      vertical-align: middle;
    }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: rgba(96,165,250,0.05); }

    /* === BADGES === */
    .badge {
      display: inline-block;
      font-size: 0.72rem;
      padding: 0.28rem 0.65rem;
      border-radius: 999px;
      font-weight: 700;
      border: 1px solid transparent;
    }
    .badge-green { background: rgba(22,163,74,0.15); color: #4ade80; border-color: rgba(74,222,128,0.2); }
    .badge-blue { background: rgba(37,99,235,0.15); color: #60a5fa; border-color: rgba(96,165,250,0.2); }
    .badge-yellow { background: rgba(202,138,4,0.15); color: #fbbf24; border-color: rgba(251,191,36,0.2); }
    .badge-red { background: rgba(220,38,38,0.15); color: #f87171; border-color: rgba(248,113,113,0.2); }

    /* Super Admin developer badge */
    .sa-name {
      font-weight: 700;
      background: linear-gradient(90deg, #d8b4fe 0%, #f0abfc 50%, #f9a8d4 100%);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      text-shadow: 0 0 14px rgba(192,132,252,0.45);
      filter: drop-shadow(0 0 8px rgba(192,132,252,0.35));
    }
    .sa-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.28rem;
      margin-left: 0.4rem;
      vertical-align: middle;
      padding: 0.12rem 0.45rem 0.12rem 0.32rem;
      border-radius: 0.375rem;
      font-size: 0.62rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      line-height: 1;
      color: #f5d0fe;
      border: 1px solid rgba(232, 121, 249, 0.42);
      background: linear-gradient(90deg, rgba(168,85,247,0.28), rgba(217,70,239,0.18), rgba(236,72,153,0.22));
      box-shadow: 0 0 12px rgba(192,132,252,0.35);
      white-space: nowrap;
    }
    .sa-badge svg {
      width: 11px;
      height: 11px;
      flex-shrink: 0;
      color: #e9d5ff;
      stroke: currentColor;
    }
    .sa-badge .sa-dev {
      background: linear-gradient(90deg, #d8b4fe, #f0abfc, #f9a8d4);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }

    /* Supporter / donatur badge — bright yellow */
    .sp-name {
      font-weight: 700;
      background: linear-gradient(90deg, #fef9c3 0%, #fde047 45%, #fbbf24 100%);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      text-shadow: 0 0 16px rgba(250,204,21,0.65);
      filter: drop-shadow(0 0 10px rgba(250,204,21,0.55));
    }
    .sp-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.28rem;
      margin-left: 0.4rem;
      vertical-align: middle;
      padding: 0.12rem 0.45rem 0.12rem 0.32rem;
      border-radius: 0.375rem;
      font-size: 0.62rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      line-height: 1;
      color: #fef08a;
      border: 1px solid rgba(250, 204, 21, 0.5);
      background: linear-gradient(90deg, rgba(250,204,21,0.32), rgba(251,191,36,0.22), rgba(245,158,11,0.28));
      box-shadow: 0 0 14px rgba(250,204,21,0.55);
      white-space: nowrap;
    }
    .sp-badge svg {
      width: 11px;
      height: 11px;
      flex-shrink: 0;
      color: #fef08a;
      stroke: currentColor;
    }
    .sp-badge .sp-label {
      background: linear-gradient(90deg, #fef9c3, #fde047, #fbbf24);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }

    /* Helper / Builder badge — emerald */
    .hp-name {
      font-weight: 700;
      background: linear-gradient(90deg, #a7f3d0 0%, #34d399 45%, #10b981 100%);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      text-shadow: 0 0 16px rgba(52,211,153,0.55);
      filter: drop-shadow(0 0 10px rgba(52,211,153,0.45));
    }
    .hp-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.28rem;
      margin-left: 0.4rem;
      vertical-align: middle;
      padding: 0.12rem 0.45rem 0.12rem 0.32rem;
      border-radius: 0.375rem;
      font-size: 0.62rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      line-height: 1;
      color: #a7f3d0;
      border: 1px solid rgba(52, 211, 153, 0.5);
      background: linear-gradient(90deg, rgba(16,185,129,0.28), rgba(45,212,191,0.18), rgba(34,197,94,0.24));
      box-shadow: 0 0 14px rgba(52,211,153,0.45);
      white-space: nowrap;
    }
    .hp-badge svg {
      width: 11px;
      height: 11px;
      flex-shrink: 0;
      color: #6ee7b7;
      stroke: currentColor;
    }
    .hp-badge .hp-label {
      background: linear-gradient(90deg, #a7f3d0, #34d399, #10b981);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }

    /* Ultra 500M badge — cyan/electric */
    .ul-name {
      font-weight: 700;
      background: linear-gradient(90deg, #bae6fd 0%, #22d3ee 45%, #60a5fa 100%);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      text-shadow: 0 0 16px rgba(34,211,238,0.55);
      filter: drop-shadow(0 0 10px rgba(34,211,238,0.45));
    }
    .ul-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.28rem;
      margin-left: 0.4rem;
      vertical-align: middle;
      padding: 0.12rem 0.45rem 0.12rem 0.32rem;
      border-radius: 0.375rem;
      font-size: 0.62rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      line-height: 1;
      color: #a5f3fc;
      border: 1px solid rgba(34, 211, 238, 0.5);
      background: linear-gradient(90deg, rgba(14,165,233,0.28), rgba(34,211,238,0.2), rgba(59,130,246,0.26));
      box-shadow: 0 0 14px rgba(34,211,238,0.5), 0 0 28px rgba(14,165,233,0.18);
      white-space: nowrap;
      animation: ultraPulse 2.4s ease-in-out infinite;
    }
    .ul-badge svg {
      width: 11px;
      height: 11px;
      flex-shrink: 0;
      color: #67e8f9;
      stroke: currentColor;
      fill: currentColor;
    }
    .ul-badge .ul-label {
      background: linear-gradient(90deg, #bae6fd, #22d3ee, #60a5fa);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    @keyframes ultraPulse {
      0%, 100% { box-shadow: 0 0 12px rgba(34,211,238,0.4), 0 0 22px rgba(14,165,233,0.12); }
      50% { box-shadow: 0 0 18px rgba(34,211,238,0.7), 0 0 32px rgba(14,165,233,0.28); }
    }
    @media (prefers-reduced-motion: reduce) {
      .ul-badge { animation: none !important; }
    }

    /* === RANK === */
    .rank { font-weight: 800; color: #64748b; font-size: 0.9rem; }
    .rank-1, .rank-2, .rank-3 {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1.75rem;
      height: 1.75rem;
      border-radius: 999px;
      font-weight: 800;
      font-size: 0.85rem;
      letter-spacing: -0.02em;
    }
    .rank-1 {
      color: #fef3c7;
      background: linear-gradient(135deg, rgba(251,191,36,0.28), rgba(245,158,11,0.12));
      border: 1px solid rgba(251,191,36,0.35);
      box-shadow: 0 0 0 0 rgba(251,191,36,0.35);
      animation: rankGoldPulse 2.4s ease-in-out infinite;
    }
    .rank-2 {
      color: #f8fafc;
      background: linear-gradient(135deg, rgba(226,232,240,0.22), rgba(148,163,184,0.1));
      border: 1px solid rgba(226,232,240,0.28);
      animation: rankSilverShimmer 3s ease-in-out infinite;
    }
    .rank-3 {
      color: #ffedd5;
      background: linear-gradient(135deg, rgba(251,146,60,0.25), rgba(217,119,6,0.1));
      border: 1px solid rgba(251,146,60,0.3);
      animation: rankBronzeGlow 2.8s ease-in-out infinite;
    }
    @keyframes rankGoldPulse {
      0%, 100% {
        transform: translateY(0) scale(1);
        box-shadow: 0 0 0 0 rgba(251,191,36,0.0), 0 0 14px rgba(251,191,36,0.28);
        text-shadow: 0 0 10px rgba(251,191,36,0.35);
      }
      50% {
        transform: translateY(-1px) scale(1.05);
        box-shadow: 0 0 0 5px rgba(251,191,36,0.08), 0 0 22px rgba(251,191,36,0.45);
        text-shadow: 0 0 16px rgba(251,191,36,0.55);
      }
    }
    @keyframes rankSilverShimmer {
      0%, 100% {
        transform: translateY(0);
        box-shadow: 0 0 10px rgba(226,232,240,0.12);
        filter: brightness(1);
      }
      50% {
        transform: translateY(-1px);
        box-shadow: 0 0 16px rgba(226,232,240,0.28);
        filter: brightness(1.08);
      }
    }
    @keyframes rankBronzeGlow {
      0%, 100% {
        transform: translateY(0);
        box-shadow: 0 0 10px rgba(251,146,60,0.14);
      }
      50% {
        transform: translateY(-1px);
        box-shadow: 0 0 18px rgba(251,146,60,0.32);
      }
    }
    tr.top-row td {
      background: transparent;
      transition: background 0.25s ease;
    }
    tr.top-1 td {
      background: linear-gradient(90deg, rgba(251,191,36,0.10), rgba(251,191,36,0.02) 55%, transparent);
      animation: topRowGold 3.2s ease-in-out infinite;
    }
    tr.top-2 td {
      background: linear-gradient(90deg, rgba(226,232,240,0.08), rgba(226,232,240,0.015) 55%, transparent);
      animation: topRowSilver 3.6s ease-in-out infinite;
    }
    tr.top-3 td {
      background: linear-gradient(90deg, rgba(251,146,60,0.09), rgba(251,146,60,0.015) 55%, transparent);
      animation: topRowBronze 3.4s ease-in-out infinite;
    }
    tr.top-1:hover td { background: linear-gradient(90deg, rgba(251,191,36,0.16), rgba(251,191,36,0.04) 60%, transparent); }
    tr.top-2:hover td { background: linear-gradient(90deg, rgba(226,232,240,0.12), rgba(226,232,240,0.03) 60%, transparent); }
    tr.top-3:hover td { background: linear-gradient(90deg, rgba(251,146,60,0.14), rgba(251,146,60,0.03) 60%, transparent); }
    @keyframes topRowGold {
      0%, 100% { box-shadow: inset 3px 0 0 rgba(251,191,36,0.35); }
      50% { box-shadow: inset 3px 0 0 rgba(251,191,36,0.75); }
    }
    @keyframes topRowSilver {
      0%, 100% { box-shadow: inset 3px 0 0 rgba(226,232,240,0.25); }
      50% { box-shadow: inset 3px 0 0 rgba(226,232,240,0.55); }
    }
    @keyframes topRowBronze {
      0%, 100% { box-shadow: inset 3px 0 0 rgba(251,146,60,0.28); }
      50% { box-shadow: inset 3px 0 0 rgba(251,146,60,0.6); }
    }
    @media (prefers-reduced-motion: reduce) {
      .rank-1, .rank-2, .rank-3,
      tr.top-1 td, tr.top-2 td, tr.top-3 td {
        animation: none !important;
      }
    }

    /* === KEY PREFIX === */
    .key-prefix {
      font-family: 'SF Mono', 'Fira Code', ui-monospace, monospace;
      font-size: 0.85rem;
      color: #93c5fd;
      font-weight: 600;
    }

    /* === CHART === */
    .chart-container {
      background: linear-gradient(180deg, rgba(30,41,59,0.85), rgba(15,23,42,0.7));
      border: 1px solid rgba(148,163,184,0.14);
      border-radius: 18px;
      padding: 1.35rem 1.4rem;
      margin-bottom: 1.5rem;
      box-shadow: 0 12px 30px rgba(0,0,0,0.18);
    }
    .chart-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.1rem;
      flex-wrap: wrap;
      gap: 0.75rem;
    }
    .chart-title { font-size: 1rem; font-weight: 700; color: #f8fafc; }
    .range-selector { display: flex; gap: 0.4rem; flex-wrap: wrap; }
    .range-btn {
      font-size: 0.8rem;
      padding: 0.42rem 0.8rem;
      border-radius: 999px;
      background: rgba(15,23,42,0.7);
      border: 1px solid rgba(148,163,184,0.14);
      color: #94a3b8;
      cursor: pointer;
      transition: all 0.2s;
      font-weight: 600;
    }
    .range-btn:hover { border-color: rgba(96,165,250,0.4); color: #e2e8f0; }
    .range-btn.active {
      background: linear-gradient(90deg, #7c3aed, #2563eb);
      border-color: transparent;
      color: white;
      box-shadow: 0 6px 16px rgba(37,99,235,0.28);
    }
    .chart-svg { width: 100%; height: 320px; }
    .chart-legend {
      display: flex;
      gap: 1.25rem;
      margin-top: 0.9rem;
      font-size: 0.85rem;
      color: #94a3b8;
    }
    .chart-legend-item { display: flex; align-items: center; gap: 0.45rem; font-weight: 600; }
    .chart-dot { width: 10px; height: 10px; border-radius: 50%; box-shadow: 0 0 10px currentColor; }

    /* === LOADING & EMPTY === */
    .loading { text-align: center; padding: 3rem; color: #94a3b8; font-size: 0.95rem; }
    .pulse { animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .empty {
      text-align: center; padding: 3.5rem 1.5rem; color: #94a3b8; font-size: 0.95rem;
      border: 1px dashed rgba(148,163,184,0.18); border-radius: 16px; background: rgba(15,23,42,0.35);
    }
    .updated-at {
      font-size: 0.75rem; color: #94a3b8; font-weight: 600;
      background: rgba(15,23,42,0.55); border: 1px solid rgba(148,163,184,0.12);
      padding: 0.35rem 0.7rem; border-radius: 999px;
    }

    /* === MODEL TAG === */
    .model-tag {
      display: inline-block;
      background: rgba(15,23,42,0.7);
      border: 1px solid rgba(148,163,184,0.16);
      border-radius: 10px;
      padding: 0.45rem 0.8rem;
      font-size: 0.85rem;
      font-family: 'SF Mono', 'Fira Code', ui-monospace, monospace;
      color: #93c5fd;
      margin: 0.25rem;
      transition: all 0.2s;
      box-shadow: 0 4px 12px rgba(0,0,0,0.12);
    }
    .model-tag:hover {
      border-color: rgba(167,139,250,0.45);
      background: rgba(124,58,237,0.12);
      color: #c4b5fd;
      transform: translateY(-1px);
    }

    /* === CLAUDE MODEL TAG (glow pulse + shimmer sweep) === */
    .model-tag.claude {
      position: relative;
      overflow: hidden;
      color: #fbbf24;
      border-color: rgba(245,158,11,0.45);
      background: linear-gradient(135deg, rgba(120,53,15,0.35), rgba(15,23,42,0.7));
      animation: claudeGlow 2.4s ease-in-out infinite;
    }
    .model-tag.claude::after {
      content: '';
      position: absolute;
      top: 0; left: -150%;
      width: 60%; height: 100%;
      background: linear-gradient(105deg, transparent, rgba(255,236,179,0.32), transparent);
      animation: claudeShimmer 2.8s ease-in-out infinite;
      pointer-events: none;
    }
    .model-tag.claude .claude-spark {
      color: #fcd34d;
      margin-right: 0.3rem;
      display: inline-block;
      animation: claudeSpark 2.4s ease-in-out infinite;
    }
    .model-tag.claude:hover {
      border-color: rgba(245,158,11,0.75);
      background: linear-gradient(135deg, rgba(146,64,14,0.45), rgba(15,23,42,0.7));
      color: #fde68a;
      transform: translateY(-1px);
    }
    @keyframes claudeGlow {
      0%, 100% { box-shadow: 0 0 6px rgba(245,158,11,0.22), 0 4px 12px rgba(0,0,0,0.12); }
      50% { box-shadow: 0 0 16px rgba(245,158,11,0.55), 0 0 30px rgba(245,158,11,0.18), 0 4px 12px rgba(0,0,0,0.12); }
    }
    @keyframes claudeShimmer {
      0% { left: -150%; }
      55% { left: 150%; }
      100% { left: 150%; }
    }
    @keyframes claudeSpark {
      0%, 100% { transform: scale(1); opacity: 0.85; }
      50% { transform: scale(1.25); opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      .model-tag.claude, .model-tag.claude::after, .model-tag.claude .claude-spark { animation: none; }
    }

    /* === PODIUM TOP 3 === */
    .podium {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 0.85rem;
      align-items: end;
      margin-bottom: 1.4rem;
    }
    .podium-card {
      position: relative;
      overflow: hidden;
      text-align: center;
      border-radius: 18px;
      padding: 1.15rem 0.85rem 1rem;
      background: linear-gradient(180deg, rgba(30,41,59,0.85), rgba(15,23,42,0.7));
      border: 1px solid rgba(148,163,184,0.16);
      animation: podiumRise 0.55s ease-out both;
    }
    .podium-card.p-1 { order: 2; padding-top: 1.6rem; padding-bottom: 1.35rem; animation-delay: 0.05s; }
    .podium-card.p-2 { order: 1; animation-delay: 0.15s; }
    .podium-card.p-3 { order: 3; animation-delay: 0.25s; }
    @keyframes podiumRise {
      from { opacity: 0; transform: translateY(18px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .podium-card.p-1 {
      border-color: rgba(250,204,21,0.45);
      background:
        radial-gradient(130% 100% at 50% 0%, rgba(250,204,21,0.16), transparent 60%),
        linear-gradient(180deg, rgba(30,41,59,0.9), rgba(15,23,42,0.72));
      box-shadow: 0 0 24px rgba(250,204,21,0.12);
    }
    .podium-card.p-2 {
      border-color: rgba(203,213,225,0.38);
      background:
        radial-gradient(130% 100% at 50% 0%, rgba(203,213,225,0.12), transparent 60%),
        linear-gradient(180deg, rgba(30,41,59,0.88), rgba(15,23,42,0.7));
    }
    .podium-card.p-3 {
      border-color: rgba(217,119,6,0.4);
      background:
        radial-gradient(130% 100% at 50% 0%, rgba(217,119,6,0.14), transparent 60%),
        linear-gradient(180deg, rgba(30,41,59,0.88), rgba(15,23,42,0.7));
    }
    .podium-medal {
      font-size: 1.5rem; line-height: 1; margin-bottom: 0.4rem;
      display: inline-block;
    }
    .podium-card.p-1 .podium-medal { font-size: 1.9rem; animation: crownFloat 2.6s ease-in-out infinite; }
    @keyframes crownFloat {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-4px); }
    }
    .podium-name { font-weight: 800; font-size: 0.92rem; margin-bottom: 0.35rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .podium-stat { font-size: 0.78rem; color: #94a3b8; font-variant-numeric: tabular-nums; }
    .podium-stat strong { color: #e2e8f0; font-weight: 800; }
    @media (max-width: 640px) {
      .podium { grid-template-columns: 1fr; align-items: stretch; }
      .podium-card.p-1 { order: 1; }
      .podium-card.p-2 { order: 2; }
      .podium-card.p-3 { order: 3; }
    }

    /* === ZEBRA + ROW HOVER === */
    tbody tr:nth-child(even):not(.top-row) td { background: rgba(148,163,184,0.035); }
    tbody tr:not(.top-row):hover td { background: rgba(124,58,237,0.08); transition: background 0.15s; }

    /* === STAT CARD ICON + POLISH === */
    .stat-card { position: relative; overflow: hidden; }
    .stat-card .stat-icon {
      position: absolute; top: 0.8rem; right: 0.9rem;
      width: 30px; height: 30px; border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      background: rgba(124,58,237,0.14);
      border: 1px solid rgba(167,139,250,0.25);
      color: #c4b5fd;
    }
    .stat-card .stat-icon svg { width: 16px; height: 16px; }
    .stat-card .stat-icon.blue { background: rgba(37,99,235,0.14); border-color: rgba(96,165,250,0.25); color: #93c5fd; }
    .stat-card .stat-icon.amber { background: rgba(202,138,4,0.14); border-color: rgba(251,191,36,0.25); color: #fcd34d; }
    .stat-card .stat-icon.green { background: rgba(22,163,74,0.14); border-color: rgba(74,222,128,0.25); color: #86efac; }

    /* === SHOW INACTIVE TOGGLE === */
    .lb-inactive-toggle {
      display: block; width: 100%; text-align: center;
      margin-top: 0.6rem; padding: 0.65rem 1rem;
      background: rgba(15,23,42,0.55);
      border: 1px dashed rgba(148,163,184,0.25);
      border-radius: 12px;
      color: #94a3b8; font-size: 0.85rem; font-weight: 700;
      cursor: pointer; transition: all 0.2s;
      font-family: inherit;
    }
    .lb-inactive-toggle:hover { color: #c4b5fd; border-color: rgba(167,139,250,0.4); background: rgba(124,58,237,0.08); }

    /* === LIVE / USAGE ROW ANIMATIONS === */
    @keyframes rowSlideIn {
      from { opacity: 0; transform: translateX(-10px); background: rgba(74,222,128,0.14); }
      to { opacity: 1; transform: translateX(0); background: transparent; }
    }
    tr.row-new td { animation: rowFlash 1.6s ease-out; }
    @keyframes rowFlash {
      0% { background: rgba(74,222,128,0.18); }
      100% { background: transparent; }
    }
    tr.row-enter { animation: rowSlideIn 0.45s ease-out; }

    /* === CHART DRAW ANIMATION === */
    .chart-line-anim {
      stroke-dasharray: 2400;
      stroke-dashoffset: 2400;
      animation: chartDraw 1.2s ease-out forwards;
    }
    @keyframes chartDraw { to { stroke-dashoffset: 0; } }
    .chart-fade-in { animation: chartFade 0.9s ease-out both; }
    @keyframes chartFade { from { opacity: 0; } to { opacity: 1; } }

    /* === MODELS: CLAUDE CARD === */
    .model-card.claude-card {
      border-color: rgba(245,158,11,0.45);
      background:
        radial-gradient(120% 90% at 100% 0%, rgba(245,158,11,0.16), transparent 55%),
        linear-gradient(180deg, rgba(30,41,59,0.75), rgba(15,23,42,0.6));
      animation: claudeGlow 2.8s ease-in-out infinite;
    }
    .model-card.claude-card:hover { border-color: rgba(245,158,11,0.7); }
    .claude-badge {
      display: inline-flex; align-items: center; gap: 0.3rem;
      font-size: 0.68rem; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase;
      color: #fcd34d; background: rgba(202,138,4,0.14);
      border: 1px solid rgba(251,191,36,0.35);
      padding: 0.22rem 0.55rem; border-radius: 999px;
    }
    @media (prefers-reduced-motion: reduce) {
      .podium-card, .podium-card.p-1 .podium-medal, tr.row-new td, tr.row-enter,
      .chart-line-anim, .chart-fade-in, .model-card.claude-card { animation: none !important; }
      .chart-line-anim { stroke-dashoffset: 0; }
    }

    /* Public Models page cards */
    .models-grid-public {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 0.85rem;
    }
    .model-card {
      position: relative;
      overflow: hidden;
      background: rgba(15,23,42,0.55);
      border: 1px solid rgba(148,163,184,0.14);
      border-radius: 16px;
      padding: 1rem 1.05rem;
      transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s;
      cursor: pointer;
    }
    .model-card:hover {
      transform: translateY(-2px);
      border-color: rgba(167,139,250,0.35);
      box-shadow: 0 10px 28px rgba(0,0,0,0.22);
    }
    .model-card.free {
      border-color: rgba(56,189,248,0.45);
      background:
        radial-gradient(120% 90% at 100% 0%, rgba(56,189,248,0.18), transparent 55%),
        radial-gradient(90% 80% at 0% 100%, rgba(167,139,250,0.14), transparent 50%),
        rgba(15,23,42,0.72);
      box-shadow: 0 0 0 1px rgba(56,189,248,0.12), 0 12px 32px rgba(14,165,233,0.12);
      animation: freeCardGlow 2.8s ease-in-out infinite;
    }
    .model-card.free:hover {
      border-color: rgba(125,211,252,0.7);
      box-shadow: 0 0 0 1px rgba(56,189,248,0.28), 0 16px 40px rgba(14,165,233,0.22);
    }
    .model-card.privileged {
      border-color: rgba(251,191,36,0.5);
      background:
        radial-gradient(120% 90% at 100% 0%, rgba(251,191,36,0.16), transparent 55%),
        radial-gradient(90% 80% at 0% 100%, rgba(244,114,182,0.12), transparent 50%),
        rgba(15,23,42,0.75);
      box-shadow: 0 0 0 1px rgba(251,191,36,0.14), 0 12px 32px rgba(245,158,11,0.12);
    }
    .model-card.privileged:hover {
      border-color: rgba(252,211,77,0.75);
      box-shadow: 0 0 0 1px rgba(251,191,36,0.3), 0 16px 40px rgba(245,158,11,0.2);
    }
    @keyframes freeCardGlow {
      0%, 100% { box-shadow: 0 0 0 1px rgba(56,189,248,0.12), 0 12px 32px rgba(14,165,233,0.10); }
      50% { box-shadow: 0 0 0 1px rgba(56,189,248,0.28), 0 14px 36px rgba(167,139,250,0.16); }
    }
    .model-card-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.6rem;
      margin-bottom: 0.55rem;
    }
    .model-card-name {
      font-weight: 700;
      color: #f1f5f9;
      font-size: 0.95rem;
      line-height: 1.25;
    }
    .model-card-id {
      font-family: 'SF Mono', 'Fira Code', ui-monospace, monospace;
      font-size: 0.72rem;
      color: #93c5fd;
      word-break: break-all;
      line-height: 1.4;
    }
    .model-card.free .model-card-id { color: #7dd3fc; }
    .model-card.privileged .model-card-id { color: #fcd34d; }
    .model-card-meta {
      margin-top: 0.7rem;
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      align-items: center;
    }
    .free-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.22rem 0.55rem;
      border-radius: 999px;
      font-size: 0.65rem;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #082f49;
      background: linear-gradient(135deg, #7dd3fc 0%, #a78bfa 55%, #f0abfc 100%);
      box-shadow: 0 0 16px rgba(56,189,248,0.35);
      animation: freeBadgePulse 2.2s ease-in-out infinite;
      white-space: nowrap;
    }
    .free-badge svg { width: 11px; height: 11px; }
    .free-badge span[aria-hidden="true"] { font-size: 0.9rem; line-height: 1; font-weight: 900; }
    @keyframes freeBadgePulse {
      0%, 100% { filter: brightness(1); transform: scale(1); }
      50% { filter: brightness(1.08); transform: scale(1.03); }
    }
    .privileged-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.28rem;
      padding: 0.22rem 0.55rem;
      border-radius: 999px;
      font-size: 0.62rem;
      font-weight: 800;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: #422006;
      background: linear-gradient(135deg, #fde047 0%, #fbbf24 45%, #f472b6 100%);
      box-shadow: 0 0 16px rgba(251,191,36,0.35);
      white-space: nowrap;
    }
    .metered-badge {
      display: inline-flex;
      align-items: center;
      padding: 0.22rem 0.55rem;
      border-radius: 999px;
      font-size: 0.65rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #cbd5e1;
      background: rgba(148,163,184,0.12);
      border: 1px solid rgba(148,163,184,0.18);
    }
    .model-hint {
      margin-top: 0.85rem;
      font-size: 0.78rem;
      color: #94a3b8;
    }
    .model-hint strong { color: #7dd3fc; }
    .model-hint .priv-strong { color: #fbbf24; }
    .model-card.copied {
      border-color: rgba(52,211,153,0.55) !important;
      box-shadow: 0 0 0 1px rgba(52,211,153,0.25), 0 12px 28px rgba(16,185,129,0.15) !important;
    }
    @media (prefers-reduced-motion: reduce) {
      .model-card.free, .free-badge { animation: none !important; }
    }

    /* === SEARCH === */
    .search-box {
      margin: 0 0 1.1rem 0;
      display: flex;
      gap: 0.55rem;
      align-items: center;
      flex-wrap: wrap;
      background: linear-gradient(180deg, rgba(15,23,42,0.62), rgba(15,23,42,0.42));
      border: 1px solid rgba(148,163,184,0.12);
      border-radius: 16px;
      padding: 0.6rem;
      box-shadow: 0 8px 22px rgba(0,0,0,0.12);
    }
    .search-box input {
      flex: 1; min-width: 220px;
      padding: 0.72rem 0.95rem;
      border-radius: 12px;
      border: 1px solid rgba(148,163,184,0.14);
      background: rgba(7,11,22,0.8);
      color: #f8fafc;
      font-size: 0.9rem;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .search-box input:focus {
      border-color: rgba(124,58,237,0.55);
      box-shadow: 0 0 0 3px rgba(124,58,237,0.15);
    }
    .search-box button {
      padding: 0.72rem 1.05rem;
      border-radius: 12px;
      border: 1px solid rgba(148,163,184,0.14);
      background: rgba(30,41,59,0.85);
      color: #e2e8f0;
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 700;
      transition: all 0.2s;
    }
    .search-box button:hover { border-color: rgba(96,165,250,0.4); color: #fff; }
    .search-box button.primary {
      background: linear-gradient(90deg, #7c3aed, #2563eb);
      border-color: transparent;
      color: #fff;
      box-shadow: 0 6px 16px rgba(37,99,235,0.22);
    }
    .search-box button.primary:hover { filter: brightness(1.08); }

    /* === MOBILE (< 768px) === */
    @media (max-width: 768px) {
      .layout { flex-direction: column; }
      .sidebar {
        width: 100%;
        height: auto;
        position: relative;
        padding: 0;
        border-right: none;
        border-bottom: 1px solid rgba(148,163,184,0.12);
        box-shadow: none;
        backdrop-filter: blur(12px);
      }
      .sidebar-header {
        padding: 0.9rem 1rem;
        margin-bottom: 0;
        border-bottom: 1px solid rgba(148,163,184,0.12);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
      }
      .sidebar-header h1 { font-size: 1.1rem; }
      .sidebar-header p { display: none; }
      .brand-mark { width: 34px; height: 34px; border-radius: 10px; font-size: 0.8rem; }
      nav {
        display: flex;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        padding: 0.25rem 0.35rem 0.45rem;
        gap: 0.15rem;
      }
      nav::-webkit-scrollbar { display: none; }
      .tg-link svg { width: 18px; height: 18px; }
      .nav-item {
        flex: 1;
        min-width: 72px;
        padding: 0.7rem 0.4rem;
        font-size: 0.7rem;
        flex-direction: column;
        gap: 0.3rem;
        border-left: none;
        border-bottom: none;
        text-align: center;
        margin: 0;
        border-radius: 12px;
      }
      .nav-item.active {
        border-bottom: none;
        background: linear-gradient(180deg, rgba(124,58,237,0.22), rgba(37,99,235,0.12));
      }
      .nav-item:hover { background: transparent; }
      .nav-item.active:hover { background: linear-gradient(180deg, rgba(124,58,237,0.22), rgba(37,99,235,0.12)); }
      .nav-icon { width: 18px; height: 18px; }
      .content { margin-left: 0; padding: 1.15rem 0.9rem 2rem; }
      .page-title { font-size: 1.3rem; }
      .page-desc { font-size: 0.85rem; }
      .stats-grid { grid-template-columns: repeat(2, 1fr); gap: 0.75rem; }
      .stat-card { padding: 1rem; border-radius: 14px; }
      .stat-label { font-size: 0.68rem; }
      .stat-value { font-size: 1.25rem; }
      th, td { padding: 0.65rem 0.75rem; }
      th { font-size: 0.68rem; }
      td { font-size: 0.8rem; }
      .chart-container { padding: 1rem; border-radius: 14px; }
      .chart-title { font-size: 0.875rem; }
      .range-btn { font-size: 0.72rem; padding: 0.35rem 0.65rem; }
      .chart-svg { height: 180px; }
      .search-box { padding: 0.45rem; border-radius: 12px; }
    }

    /* === TABLET (769px - 1024px) === */
    @media (min-width: 769px) and (max-width: 1024px) {
      .sidebar { width: 196px; padding: 1rem 0.65rem 1.25rem; }
      .content { margin-left: 196px; padding: 1.5rem 1.5rem; }
      .stats-grid { grid-template-columns: repeat(3, 1fr); }
    }

    /* === LARGE DESKTOP (> 1440px) === */
    @media (min-width: 1441px) {
      .sidebar { width: 248px; }
      .content { margin-left: 248px; padding: 2.5rem 3rem 3.5rem; }
      .page-title { font-size: 1.85rem; }
    }

    /* === OVERVIEW STATS & SORTABLE === */
    .overview-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 0.85rem;
      margin-bottom: 1.25rem;
    }
    .overview-stats .stat-card {
      text-align: left;
      min-width: 0;
      padding: 1.05rem 1.15rem;
    }
    .overview-stats .stat-value {
      font-size: 1.55rem;
      background: linear-gradient(90deg, #f8fafc, #93c5fd);
      -webkit-background-clip: text; background-clip: text; color: transparent;
    }
    .overview-stats .stat-label { margin-top: 0.35rem; margin-bottom: 0; }
    .sortable { cursor: pointer; user-select: none; white-space: nowrap; }
    .sortable:hover { color: #e2e8f0; }
    .sort-arrow { font-size: 0.65rem; margin-left: 2px; }
    .sort-arrow.inactive { opacity: 0.3; }

    /* === PRICES === */
    .prices-hero {
          background:
            radial-gradient(420px 180px at 100% 0%, rgba(124,58,237,0.22), transparent 60%),
            radial-gradient(320px 160px at 0% 100%, rgba(37,99,235,0.16), transparent 55%),
            linear-gradient(135deg, rgba(30,41,59,0.95) 0%, rgba(15,23,42,0.92) 55%, rgba(30,27,75,0.9) 100%);
          border: 1px solid rgba(148,163,184,0.14);
          border-radius: 18px;
          padding: 1.5rem 1.75rem;
          margin-bottom: 1.5rem;
          position: relative;
          overflow: hidden;
          box-shadow: 0 12px 32px rgba(0,0,0,0.16);
        }
        .prices-hero::before {
          content: '';
          position: absolute;
          top: -40px; right: -30px;
          width: 160px; height: 160px;
          background: radial-gradient(circle, rgba(168,85,247,0.25), transparent 70%);
          pointer-events: none;
        }
        .prices-hero-title {
          font-size: 1.2rem;
          font-weight: 800;
          letter-spacing: -0.02em;
          color: #f8fafc;
          margin-bottom: 0.4rem;
        }
        .prices-hero-sub {
          font-size: 0.92rem;
          color: #94a3b8;
          line-height: 1.6;
          max-width: 760px;
        }
        .prices-pills {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          margin-top: 1.05rem;
        }
        .price-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          padding: 0.4rem 0.8rem;
          border-radius: 999px;
          font-size: 0.78rem;
          font-weight: 700;
          border: 1px solid rgba(148,163,184,0.16);
          background: rgba(15, 23, 42, 0.72);
          color: #e2e8f0;
        }
        .price-pill.purple { border-color: rgba(124,58,237,0.45); color: #c4b5fd; background: rgba(124, 58, 237, 0.15); }
        .price-pill.blue { border-color: rgba(37,99,235,0.45); color: #93c5fd; background: rgba(37, 99, 235, 0.15); }
        .price-pill.green { border-color: rgba(22,163,74,0.45); color: #86efac; background: rgba(22, 163, 74, 0.15); }
        .price-pill.yellow { border-color: rgba(202,138,4,0.45); color: #fde68a; background: rgba(202, 138, 4, 0.15); }

        .pricing-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 1.1rem;
          margin-bottom: 1.5rem;
          max-width: 980px;
        }
        @media (min-width: 1280px) {
          .pricing-grid {
            grid-template-columns: repeat(5, minmax(0, 1fr));
            max-width: none;
            gap: 0.9rem;
          }
        }
        .price-card {
          background: linear-gradient(180deg, rgba(30,41,59,0.95), rgba(15,23,42,0.88));
          border: 1px solid rgba(148,163,184,0.14);
          border-radius: 18px;
          padding: 1.45rem 1.25rem 1.25rem;
          display: flex;
          flex-direction: column;
          position: relative;
          transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s;
          min-height: 100%;
          box-shadow: 0 10px 28px rgba(0,0,0,0.14);
        }
        .price-card:hover {
          transform: translateY(-4px);
          border-color: rgba(148,163,184,0.28);
          box-shadow: 0 16px 36px rgba(0,0,0,0.24);
        }
        .price-card.featured {
          border-color: rgba(124,58,237,0.55);
          background: linear-gradient(180deg, rgba(124,58,237,0.2) 0%, rgba(30,41,59,0.95) 42%, rgba(15,23,42,0.9) 100%);
          box-shadow: 0 0 0 1px rgba(124,58,237,0.22), 0 16px 40px rgba(124,58,237,0.14);
        }
        .price-card.featured:hover { border-color: #a78bfa; }
        .price-card.ultra {
          border-color: rgba(34,211,238,0.5);
          background: linear-gradient(180deg, rgba(14,165,233,0.18) 0%, rgba(30,41,59,0.95) 42%, rgba(15,23,42,0.9) 100%);
          box-shadow: 0 0 0 1px rgba(34,211,238,0.18), 0 16px 40px rgba(14,165,233,0.12);
        }
        .price-card.ultra:hover { border-color: #67e8f9; }
        .price-card.ultra .price-badge {
          background: linear-gradient(90deg, #0ea5e9, #22d3ee);
          color: #082f49;
        }
        .price-card.ultra .price-cta {
          border-color: rgba(34,211,238,0.55);
          color: #a5f3fc;
          background: rgba(14,165,233,0.1);
        }
        .price-card.ultra .price-cta:hover {
          border-color: #67e8f9;
          color: #fff;
          background: rgba(14,165,233,0.22);
        }
        .price-card.supporter {
          border-color: rgba(234,179,8,0.5);
          background: linear-gradient(180deg, rgba(234,179,8,0.16) 0%, rgba(30,41,59,0.95) 42%, rgba(15,23,42,0.9) 100%);
          box-shadow: 0 0 0 1px rgba(234,179,8,0.18), 0 16px 40px rgba(234,179,8,0.10);
        }
        .price-card.supporter:hover { border-color: #fde047; }
        .price-card.supporter .price-badge {
          background: linear-gradient(90deg, #ca8a04, #eab308);
          color: #1c1917;
        }
        .price-card.supporter .price-cta {
          border-color: rgba(202,138,4,0.55);
          color: #fde68a;
          background: rgba(202,138,4,0.08);
        }
        .price-card.supporter .price-cta:hover {
          border-color: #facc15;
          color: #fff;
          background: rgba(202,138,4,0.2);
        }
        .price-badge {
          position: absolute;
          top: -11px;
          left: 50%;
          transform: translateX(-50%);
          background: linear-gradient(90deg, #7c3aed, #2563eb);
          color: white;
          font-size: 0.7rem;
          font-weight: 800;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          padding: 0.3rem 0.75rem;
          border-radius: 999px;
          white-space: nowrap;
          box-shadow: 0 8px 18px rgba(37,99,235,0.25);
        }
        .price-tier {
          font-size: 0.78rem;
          font-weight: 800;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          margin-bottom: 0.55rem;
        }
        .price-amount {
          font-size: 1.9rem;
          font-weight: 800;
          color: #f8fafc;
          line-height: 1.1;
          margin-bottom: 0.25rem;
          letter-spacing: -0.03em;
        }
        .price-amount span {
          font-size: 0.95rem;
          font-weight: 700;
          color: #94a3b8;
          margin-right: 0.2rem;
        }
        .price-amount.contact {
          font-size: 1.55rem;
          letter-spacing: -0.02em;
          color: #fde68a;
        }
        .price-amount.contact span {
          font-size: 0.85rem;
          margin-right: 0.35rem;
          color: #fde68a;
        }
        .price-period {
          font-size: 0.82rem;
          color: #94a3b8;
          margin-bottom: 1.05rem;
          min-height: 1.2em;
        }
        .price-features {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 0.68rem;
          margin: 0 0 1.3rem;
          flex: 1;
        }
        .price-features li {
          display: flex;
          align-items: flex-start;
          gap: 0.55rem;
          font-size: 0.88rem;
          color: #e2e8f0;
          line-height: 1.4;
        }
        .price-check {
          width: 18px;
          height: 18px;
          border-radius: 999px;
          background: rgba(74, 222, 128, 0.15);
          color: #4ade80;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          font-size: 0.7rem;
          font-weight: 700;
          margin-top: 1px;
        }
        .price-cta {
          display: block;
          text-align: center;
          text-decoration: none;
          padding: 0.85rem 1rem;
          border-radius: 12px;
          font-weight: 700;
          font-size: 0.9rem;
          transition: all 0.2s;
          border: 1px solid rgba(148,163,184,0.18);
          background: rgba(7,11,22,0.7);
          color: #e2e8f0;
        }
        .price-cta:hover { border-color: #3b82f6; color: #fff; background: #1e293b; }
        .price-cta.primary {
          background: linear-gradient(90deg, #7c3aed, #2563eb);
          border-color: transparent;
          color: #fff;
          box-shadow: 0 8px 18px rgba(124,58,237,0.22);
        }
        .price-cta.primary:hover {
          filter: brightness(1.08);
          box-shadow: 0 10px 22px rgba(124,58,237,0.32);
        }
        .prices-note {
          background: linear-gradient(180deg, rgba(30,41,59,0.88), rgba(15,23,42,0.78));
          border: 1px solid rgba(148,163,184,0.14);
          border-radius: 16px;
          padding: 1.25rem 1.35rem;
          color: #94a3b8;
          font-size: 0.9rem;
          line-height: 1.65;
          box-shadow: 0 10px 28px rgba(0,0,0,0.12);
          max-width: 980px;
        }
        .prices-note strong { color: #f1f5f9; }
        .prices-note a { color: #60a5fa; text-decoration: none; font-weight: 700; }
        .prices-note a:hover { text-decoration: underline; }
        .prices-note-title {
          display: flex;
          align-items: center;
          gap: 0.45rem;
          font-size: 0.95rem;
          font-weight: 800;
          color: #f8fafc;
          margin-bottom: 0.85rem;
          letter-spacing: -0.01em;
        }
        .prices-note p {
          margin: 0 0 0.75rem;
          color: #94a3b8;
        }
        .prices-note p:last-child { margin-bottom: 0; }
        .prices-note .warn {
          color: #fde68a;
          background: rgba(202,138,4,0.1);
          border: 1px solid rgba(234,179,8,0.22);
          border-radius: 12px;
          padding: 0.75rem 0.9rem;
          margin: 0.85rem 0;
        }
        .prices-note .order-line {
          padding-top: 0.85rem;
          border-top: 1px solid rgba(148,163,184,0.12);
          margin-top: 0.9rem;
        }

        @media (max-width: 1024px) {
          .pricing-grid { grid-template-columns: 1fr; max-width: 460px; }
          .price-card.featured { order: -1; }
          .prices-note { max-width: 460px; }
        }
        @media (max-width: 768px) {
          .prices-hero { padding: 1.15rem 1rem; border-radius: 16px; }
          .prices-hero-title { font-size: 1.05rem; }
          .price-amount { font-size: 1.65rem; }
          .pricing-grid { max-width: none; gap: 0.95rem; }
          .prices-note { max-width: none; padding: 1.1rem 1rem; font-size: 0.86rem; }
        }
      </style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="brand-wrap">
          <div class="brand-mark" title="Routers9"><span>R9</span></div>
          <div>
            <h1>Routers9</h1>
          </div>
        </div>
        <a href="https://t.me/routers9_id" target="_blank" rel="noopener" class="tg-link" title="Telegram">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
        </a>
        <p>Public Dashboard · Multi-Model LLM API</p>
      </div>
      <nav>
        <div class="nav-item active" data-page="leaderboard" onclick="switchPage('leaderboard')">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
          <span class="nav-label">Leaderboard</span>
        </div>
        <div class="nav-item" data-page="live" onclick="switchPage('live')">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.4"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.4"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/></svg>
          <span class="nav-label">Live</span>
        </div>
        <div class="nav-item" data-page="usage" onclick="switchPage('usage')">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          <span class="nav-label">Usage</span>
        </div>
        <div class="nav-item" data-page="models" onclick="switchPage('models')">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          <span class="nav-label">Models</span>
        </div>
        <div class="nav-item" data-page="prices" onclick="switchPage('prices')">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          <span class="nav-label">Prices</span>
        </div>
      </nav>
    </aside>

    <main class="content">
      <!-- Leaderboard -->
      <div class="page active" id="page-leaderboard">
        <div class="page-header">
          <div>
            <h2 class="page-title"><span class="grad">Leaderboard</span></h2>
            <p class="page-desc">Top API keys by kuota token terpakai (klik header untuk urutkan: Requests / Kuota / Remaining / Last Active)</p>
          </div>
        </div>
        <div class="overview-stats" id="overview-stats"></div>
        <div class="search-box">
          <input
            id="lb-search"
            type="search"
            placeholder="Cari nama user atau paste API key..."
            autocomplete="off"
            spellcheck="false"
          />
          <button
            id="lb-search-btn"
            type="button"
            class="primary"
            onclick="runLeaderboardSearch()"
          >Cari</button>
          <button
            id="lb-search-clear"
            type="button"
            onclick="clearLeaderboardSearch()"
          >Reset</button>
        </div>
        <div id="lb-search-meta" style="font-size:0.8rem;color:#94a3b8;margin:-0.35rem 0 0.85rem 0;min-height:1.1em"></div>
        <div class="loading" id="lb-loading"><div class="skeleton-wrap"><div class="skeleton sk-lg"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div></div>
        <div id="lb-content" style="display:none"></div>
      </div>

      <!-- Live -->
      <div class="page" id="page-live">
        <div class="page-header">
          <div>
            <h2 class="page-title"><span class="grad">Live Usage</span></h2>
            <p class="page-desc">Active API keys in the last 5 minutes</p>
          </div>
          <div style="display:flex;align-items:center;gap:0.55rem;flex-wrap:wrap">
            <span class="live-dot">Live</span>
            <span class="updated-at" id="live-updated">-</span>
          </div>
        </div>
        <div class="overview-stats" id="live-stats"></div>
        <div class="loading" id="live-loading"><div class="skeleton-wrap"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div></div>
        <div id="live-content" style="display:none"></div>
      </div>

      <!-- Usage -->
      <div class="page" id="page-usage">
        <div class="page-header">
          <div>
            <h2 class="page-title"><span class="grad">Usage</span></h2>
            <p class="page-desc">Recent API requests and traffic trends</p>
          </div>
        </div>
        <div class="chart-container">
          <div class="chart-header">
            <span class="chart-title">Requests & Tokens</span>
            <div class="range-selector">
              <button class="range-btn" onclick="loadChart('15m')">15m</button>
              <button class="range-btn" onclick="loadChart('1h')">1h</button>
              <button class="range-btn" onclick="loadChart('6h')">6h</button>
              <button class="range-btn" onclick="loadChart('12h')">12h</button>
              <button class="range-btn active" onclick="loadChart('1d')">1d</button>
              <button class="range-btn" onclick="loadChart('3d')">3d</button>
              <button class="range-btn" onclick="loadChart('7d')">7d</button>
              <button class="range-btn" onclick="loadChart('1M')">1M</button>
            </div>
          </div>
          <svg class="chart-svg" id="usage-chart" viewBox="0 0 800 250" preserveAspectRatio="none"></svg>
          <div class="chart-legend">
            <div class="chart-legend-item"><div class="chart-dot" style="background:#3b82f6;color:#3b82f6"></div>Requests</div>
            <div class="chart-legend-item"><div class="chart-dot" style="background:#fbbf24;color:#fbbf24"></div>Tokens</div>
          </div>
        </div>
        <div class="loading" id="usage-loading"><div class="skeleton-wrap"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div></div>
        <div id="usage-content" style="display:none"></div>
      </div>

      <!-- Models -->
      <div class="page" id="page-models">
        <div class="page-header">
          <div>
            <h2 class="page-title"><span class="grad">Available Models</span></h2>
            <p class="page-desc">Klik kartu untuk copy model ID. Badge <strong style="color:#7dd3fc">Unlimited</strong> = tidak potong kuota token key.</p>
          </div>
        </div>
        <div class="loading" id="models-loading"><div class="skeleton-wrap"><div class="skeleton sk-lg"></div><div class="skeleton sk-lg"></div><div class="skeleton sk-lg"></div></div></div>
        <div id="models-content" style="display:none"></div>
      </div>

      <!-- Prices -->
      <div class="page" id="page-prices">
        <div class="page-header">
          <div>
            <h2 class="page-title"><span class="grad">Harga / Prices</span></h2>
            <p class="page-desc">Daftar harga token Grok 4.5 terbaru</p>
          </div>
        </div>

        <div class="prices-hero">
          <div class="prices-hero-title">Akses Grok 4.5 lewat API OpenAI-compatible</div>
          <div class="prices-hero-sub">
            Semua paket include model <strong style="color:#c4b5fd">Grok 4.5</strong>, plus
            <strong style="color:#86efac">semua model Unlimited</strong> bisa dipakai di semua paket.
            Rate limit per paket: Starter <strong style="color:#93c5fd">10 RPM</strong>, Pro
            <strong style="color:#93c5fd">20 RPM</strong>, Business <strong style="color:#93c5fd">30 RPM</strong>,
            Ultra <strong style="color:#67e8f9">50 RPM</strong>.
            Order via Telegram.
          </div>
          <div class="prices-pills">
            <span class="price-pill purple">Grok 4.5</span>
            <span class="price-pill green">Semua Unlimited Model</span>
            <span class="price-pill blue">10 / 20 / 30 / 50 RPM</span>
            <span class="price-pill yellow">Aktif Instant</span>
          </div>
        </div>

        <div class="pricing-grid">
          <div class="price-card">
            <div class="price-tier" style="color:#6ee7b7">Starter</div>
            <div class="price-amount"><span>Rp</span>150.000</div>
            <div class="price-period">28-day active period</div>
            <ul class="price-features">
              <li><span class="price-check">✓</span><span><strong>150M</strong> token quota</span></li>
              <li><span class="price-check">✓</span><span>Access <strong>Grok 4.5</strong></span></li>
              <li><span class="price-check">✓</span><span>All <strong>Unlimited</strong> models included</span></li>
              <li><span class="price-check">✓</span><span>Rate limit <strong>10 RPM</strong></span></li>
              <li><span class="price-check">✓</span><span>Tokens valid until expiry</span></li>
              <li><span class="price-check">✓</span><span>Daily quota <strong>150M</strong> resets at <strong>00:00 WIB</strong></span></li>
            </ul>
            <a class="price-cta" href="https://t.me/routers9" target="_blank" rel="noopener">Order via Telegram</a>
          </div>

          <div class="price-card featured">
            <div class="price-badge">Most Popular</div>
            <div class="price-tier" style="color:#7dd3fc">Pro</div>
            <div class="price-amount"><span>Rp</span>250.000</div>
            <div class="price-period">28-day active period</div>
            <ul class="price-features">
              <li><span class="price-check">✓</span><span><strong>250M</strong> token quota</span></li>
              <li><span class="price-check">✓</span><span>Access <strong>Grok 4.5</strong></span></li>
              <li><span class="price-check">✓</span><span>All <strong>Unlimited</strong> models included</span></li>
              <li><span class="price-check">✓</span><span>Rate limit <strong>20 RPM</strong></span></li>
              <li><span class="price-check">✓</span><span>Tokens valid until expiry</span></li>
              <li><span class="price-check">✓</span><span>Daily quota <strong>250M</strong> resets at <strong>00:00 WIB</strong></span></li>
            </ul>
            <a class="price-cta primary" href="https://t.me/routers9" target="_blank" rel="noopener">Order Pro Now</a>
          </div>

          <div class="price-card">
            <div class="price-tier" style="color:#c4b5fd">Business</div>
            <div class="price-amount"><span>Rp</span>350.000</div>
            <div class="price-period">28-day active period</div>
            <ul class="price-features">
              <li><span class="price-check">✓</span><span><strong>350M</strong> token quota</span></li>
              <li><span class="price-check">✓</span><span>Access <strong>Grok 4.5</strong></span></li>
              <li><span class="price-check">✓</span><span>All <strong>Unlimited</strong> models included</span></li>
              <li><span class="price-check">✓</span><span>Rate limit <strong>30 RPM</strong></span></li>
              <li><span class="price-check">✓</span><span>Tokens valid until expiry</span></li>
              <li><span class="price-check">✓</span><span>Daily quota <strong>350M</strong> resets at <strong>00:00 WIB</strong></span></li>
            </ul>
            <a class="price-cta" href="https://t.me/routers9" target="_blank" rel="noopener">Order Business</a>
          </div>

          <div class="price-card ultra">
            <div class="price-badge">500M</div>
            <div class="price-tier" style="color:#67e8f9">Ultra</div>
            <div class="price-amount"><span>Rp</span>500.000</div>
            <div class="price-period">28-day active period</div>
            <ul class="price-features">
              <li><span class="price-check">✓</span><span><strong>500M</strong> token quota</span></li>
              <li><span class="price-check">✓</span><span>Access <strong>Grok 4.5</strong></span></li>
              <li><span class="price-check">✓</span><span>All <strong>Unlimited</strong> models included</span></li>
              <li><span class="price-check">✓</span><span>Rate limit <strong>50 RPM</strong></span></li>
              <li><span class="price-check">✓</span><span>Tokens valid until expiry</span></li>
              <li><span class="price-check">✓</span><span>Daily quota <strong>500M</strong> resets at <strong>00:00 WIB</strong></span></li>
            </ul>
            <a class="price-cta" href="https://t.me/routers9" target="_blank" rel="noopener">Order Ultra</a>
          </div>

          <div class="price-card supporter">
            <div class="price-badge">3 slots left</div>
            <div class="price-tier" style="color:#fde68a">Supporter</div>
            <div class="price-amount contact">Via DM</div>
            <div class="price-period">3 slots left · no public price · message admin</div>
            <ul class="price-features">
              <li><span class="price-check">✓</span><span><strong>Unlimited</strong> token quota</span></li>
              <li><span class="price-check">✓</span><span><strong>Request RPM limit</strong></span></li>
              <li><span class="price-check">✓</span><span><strong>No expiry</strong> key</span></li>
              <li><span class="price-check">✓</span><span>Access <strong>Grok 4.5</strong></span></li>
              <li><span class="price-check">✓</span><span>All <strong>Unlimited</strong> models included</span></li>
              <li><span class="price-check">✓</span><span><strong>SUPPORTER</strong> badge on panel</span></li>
            </ul>
            <a class="price-cta" href="https://t.me/routers9" target="_blank" rel="noopener">DM Admin Now</a>
          </div>
        </div>

        <div class="prices-note">
          <div class="prices-note-title">📢 Pemberitahuan</div>
          <p>Paket AI di sini akan terus berubah mengikuti perkembangan dan tren model AI terbaru. Model yang tersedia akan selalu diperbarui, diganti, atau ditambahkan berdasarkan performa dan kualitas terbaik yang tersedia.</p>
          <p>Tujuan kami adalah selalu menghadirkan AI terbaik, bukan mempertahankan model tertentu.</p>
          <p class="warn"><strong>⚠️ Tidak ada garansi model tertentu akan tersedia selamanya.</strong> Model dapat berubah sewaktu-waktu tanpa pemberitahuan sebelumnya.</p>
          <p class="order-line"><strong>Cara order:</strong> chat Telegram
          <a href="https://t.me/routers9" target="_blank" rel="noopener">@routers9</a>
          → sebut paket (Starter / Pro / Business / Ultra / Supporter) → bayar → key dikirim instant.
          Hubungi admin untuk pembelian, perpanjangan, atau donasi Supporter.</p>
        </div>
      </div>

      <footer class="pub-footer">
        <span>© 2026 Routers9 · Multi-Model LLM API Gateway</span>
        <span class="status-pill" id="status-pill">Operational</span>
        <a href="https://t.me/routers9_id" target="_blank" rel="noopener">t.me/routers9_id</a>
      </footer>
    </main>
  </div>

  <script>
    let liveInterval = null;
    let lbInterval = null;
    let currentPage = 'leaderboard';

    function switchPage(page) {
      currentPage = page;
      document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
      document.querySelector('[data-page="' + page + '"]').classList.add('active');
      document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
      document.getElementById('page-' + page).classList.add('active');

      // Stop page polling when switching
      if (liveInterval) { clearInterval(liveInterval); liveInterval = null; }
      if (lbInterval) { clearInterval(lbInterval); lbInterval = null; }

      // Load data for the page
      if (page === 'leaderboard') { loadLeaderboard(); lbInterval = setInterval(() => loadLeaderboard(null, true), 45000); }
      else if (page === 'live') { loadLive(); liveInterval = setInterval(loadLive, 10000); }
      else if (page === 'usage') { loadUsage(); loadChart('1d'); }
      else if (page === 'models') loadModels();
      // prices page is static HTML — no fetch needed

      // Scroll to top on page switch
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Footer status check (reuses /health, refresh tiap 60s)
    async function checkStatus() {
      const pill = document.getElementById('status-pill');
      if (!pill) return;
      try {
        const res = await fetch('/health', { cache: 'no-store' });
        if (res.ok) { pill.classList.remove('down'); pill.textContent = 'Operational'; }
        else { pill.classList.add('down'); pill.textContent = 'Degraded'; }
      } catch (e) {
        pill.classList.add('down');
        pill.textContent = 'Offline';
      }
    }
    checkStatus();
    setInterval(checkStatus, 60000);

    const EMPTY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
    function emptyHtml(msg) {
      return '<div class="empty">' + EMPTY_ICON + msg + '</div>';
    }

    function formatNum(n) {
      if (n >= 1000000000) return (n / 1000000000).toFixed(1) + 'B';
      if (n >= 1000000) return (n / 1000000).toFixed(0) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
      return n.toLocaleString();
    }

    function formatTime(ts) {
      if (!ts) return '-';
      return new Date(ts).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    }

    function formatTokens(n) {
      return formatNum(Number(n) || 0);
    }

    function isSuperAdminName(name) {
      return (name || '').trim().toLowerCase() === 'super admin';
    }

    function isSupporterName(name) {
      const n = (name || '').trim().toLowerCase();
      return n === 'gilbert arias' || n === 'yuop';
    }

    function isHelperName(name) {
      return (name || '').trim().toLowerCase() === 'afiq';
    }

    // Code2-style SVG + DEV chip for Super Admin (developer special)
    const SA_DEV_BADGE_HTML =
      '<span class="sa-badge" title="Super Admin · Developer (unlimited)">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>' +
      '</svg><span class="sa-dev">DEV</span></span>';

    // HeartHandshake-style SVG + SUPPORTER chip (donatur special)
    const SP_BADGE_HTML =
      '<span class="sp-badge" title="Supporter · Donatur (unlimited · no expiry)">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>' +
      '<path d="M12 5 9.04 7.96a2.17 2.17 0 0 0 0 3.08c.82.82 2.13.85 3 .07l2.07-1.9a2.82 2.82 0 0 1 3.79 0l2.96 2.66"/>' +
      '<path d="m18 15-2-2"/><path d="m15 18-2-2"/>' +
      '</svg><span class="sp-label">SUPPORTER</span></span>';

    // Wrench-style SVG + HELPER chip (builder special)
    const HP_BADGE_HTML =
      '<span class="hp-badge" title="Helper · Builder (unlimited · no expiry)">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>' +
      '</svg><span class="hp-label">HELPER</span></span>';

    // Zap-style SVG + ULTRA chip for exact 500M quota keys
    const UL_BADGE_HTML =
      '<span class="ul-badge" title="Ultra · 500M quota">' +
      '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>' +
      '</svg><span class="ul-label">ULTRA</span></span>';

    function buyerNameHtml(name, quotaTokens) {
      const display = name || '-';
      if (isSuperAdminName(name)) {
        return '<span class="sa-name">' + display + '</span>' + SA_DEV_BADGE_HTML;
      }
      if (isSupporterName(name)) {
        return '<span class="sp-name">' + display + '</span>' + SP_BADGE_HTML;
      }
      if (isHelperName(name)) {
        return '<span class="hp-name">' + display + '</span>' + HP_BADGE_HTML;
      }
      const q = quotaTokens == null || quotaTokens === '' ? null : Number(quotaTokens);
      if (q === 500000000) {
        return '<span class="ul-name">' + display + '</span>' + UL_BADGE_HTML;
      }
      let style = '';
      if (q === 250000000) style = ' style="color:#6ee7b7;font-weight:700"';
      return '<span' + style + '>' + display + '</span>';
    }

    async function fetchAPI(path) {
      const res = await fetch(path);
      if (!res.ok) throw new Error('API error');
      return res.json();
    }

    function isClaudeModel(id) {
      return typeof id === 'string' && id.toLowerCase().includes('claude');
    }

    function modelTagHtml(id) {
      const display = id || '-';
      if (isClaudeModel(id)) {
        return '<span class="model-tag claude"><span class="claude-spark">&#10022;</span>' + display + '</span>';
      }
      return '<span class="model-tag">' + display + '</span>';
    }

    function timeAgo(ts) {
      if (!ts) return '-';
      const t = new Date(ts).getTime();
      if (Number.isNaN(t)) return '-';
      const diff = Math.max(0, Date.now() - t);
      const s = Math.floor(diff / 1000);
      if (s < 10) return 'baru saja';
      if (s < 60) return s + 's ago';
      const m = Math.floor(s / 60);
      if (m < 60) return m + 'm ago';
      const h = Math.floor(m / 60);
      if (h < 24) return h + 'h ago';
      const d = Math.floor(h / 24);
      if (d < 7) return d + 'd ago';
      return formatTime(ts);
    }

    const STAT_ICONS = {
      requests: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
      tokens: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
      keys: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>'
    };

    function statCardHtml(value, label, iconKey, colorClass, countTarget, fmt) {
      const icon = STAT_ICONS[iconKey] || STAT_ICONS.requests;
      const dataAttrs = countTarget != null
        ? ' data-count="' + countTarget + '" data-fmt="' + (fmt || 'num') + '"'
        : '';
      return '<div class="stat-card"><div class="stat-icon ' + (colorClass || '') + '">' + icon + '</div>' +
        '<div class="stat-value"' + dataAttrs + '>' + value + '</div>' +
        '<div class="stat-label">' + label + '</div></div>';
    }

    function runCountUps(rootEl) {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const els = (rootEl || document).querySelectorAll('[data-count]');
      els.forEach(el => {
        const target = Number(el.getAttribute('data-count'));
        if (!Number.isFinite(target) || target <= 0) return;
        const fmt = el.getAttribute('data-fmt') === 'tok' ? formatTokens : formatNum;
        const dur = 700;
        const start = performance.now();
        function tick(now) {
          const p = Math.min(1, (now - start) / dur);
          const eased = 1 - Math.pow(1 - p, 3);
          el.textContent = fmt(Math.round(target * eased));
          if (p < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
    }

    // Leaderboard state
    let lbData = [];
    let lbSortKey = 'used_tokens';
    let lbSortDir = 'desc';
    let lbSearchQ = '';
    let lbSearchTimer = null;
    let lbShowInactive = false;

    async function loadLeaderboard(q, quiet) {
      try {
        const query = (q == null ? lbSearchQ : q).trim();
        lbSearchQ = query;
        const loading = document.getElementById('lb-loading');
        const content = document.getElementById('lb-content');
        const meta = document.getElementById('lb-search-meta');
        if (!quiet) {
          loading.style.display = 'block';
          content.style.display = 'none';
        }

        const lbPath = query
          ? '/public/leaderboard?q=' + encodeURIComponent(query)
          : '/public/leaderboard';
        const [lbRes, overviewRes] = await Promise.all([
          fetchAPI(lbPath),
          fetchAPI('/public/overview').catch(() => null)
        ]);
        loading.style.display = 'none';
        content.style.display = 'block';

        // Render overview stats
        const statsEl = document.getElementById('overview-stats');
        if (overviewRes) {
          statsEl.innerHTML =
            statCardHtml(formatNum(overviewRes.requests), 'Total Requests', 'requests', 'blue', Number(overviewRes.requests) || 0, 'num') +
            statCardHtml(formatTokens(overviewRes.tokens), 'Total Tokens', 'tokens', 'amber', Number(overviewRes.tokens) || 0, 'tok');
          if (!quiet) runCountUps(statsEl);
        }

        lbData = lbRes.rows || [];
        if (meta) {
          if (query) {
            meta.textContent = 'Hasil pencarian "' + query + '": ' + lbData.length + ' key';
          } else {
            meta.textContent = '';
          }
        }
        if (lbData.length === 0) {
          content.innerHTML = emptyHtml(query ? 'Tidak ketemu untuk "' + query + '"' : 'No usage data yet');
          return;
        }

        renderLeaderboardTable();
      } catch (e) {
        document.getElementById('lb-loading').style.display = 'none';
        document.getElementById('lb-content').style.display = 'block';
        document.getElementById('lb-content').innerHTML = emptyHtml('Failed to load data');
      }
    }

    function runLeaderboardSearch() {
      const input = document.getElementById('lb-search');
      const q = input ? input.value.trim() : '';
      loadLeaderboard(q);
    }

    function clearLeaderboardSearch() {
      const input = document.getElementById('lb-search');
      if (input) input.value = '';
      lbSearchQ = '';
      loadLeaderboard('');
    }

    function scheduleLeaderboardSearch() {
      if (lbSearchTimer) clearTimeout(lbSearchTimer);
      lbSearchTimer = setTimeout(runLeaderboardSearch, 350);
    }

    // Bind search events (script is at end of body, so nodes already exist)
    (function bindLeaderboardSearch() {
      const input = document.getElementById('lb-search');
      if (!input) return;
      input.addEventListener('input', scheduleLeaderboardSearch);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          runLeaderboardSearch();
        }
      });
    })();

    function sortLeaderboard(key) {
      const allowed = {
        total_requests: true,
        used_tokens: true,
        remaining_days: true,
        last_request_at: true
      };
      if (!allowed[key]) return;
      if (lbSortKey === key) {
        lbSortDir = lbSortDir === 'desc' ? 'asc' : 'desc';
      } else {
        lbSortKey = key;
        // Default direction: newest / most used / most remaining first
        lbSortDir = 'desc';
      }
      renderLeaderboardTable();
    }

    function renderLeaderboardTable() {
      const sortValue = (row, key) => {
        if (key === 'total_requests') return Number(row.total_requests) || 0;
        if (key === 'used_tokens') return Number(row.used_tokens) || 0;
        if (key === 'remaining_days') {
          // null/∞ = no expiry → treat as largest remaining
          if (row.remaining_days === null || row.remaining_days === undefined || row.remaining_days === '') {
            return Number.POSITIVE_INFINITY;
          }
          const n = Number(row.remaining_days);
          return Number.isNaN(n) ? 0 : n;
        }
        if (key === 'last_request_at') {
          if (!row.last_request_at) return 0;
          const t = new Date(row.last_request_at).getTime();
          return Number.isNaN(t) ? 0 : t;
        }
        return 0;
      };

      const sorted = [...lbData].sort((a, b) => {
        const valA = sortValue(a, lbSortKey);
        const valB = sortValue(b, lbSortKey);
        if (valA < valB) return lbSortDir === 'asc' ? -1 : 1;
        if (valA > valB) return lbSortDir === 'asc' ? 1 : -1;
        // Tie-break: used_tokens desc, then requests desc, then name
        const usedA = Number(a.used_tokens) || 0;
        const usedB = Number(b.used_tokens) || 0;
        if (usedA !== usedB) return usedB - usedA;
        const reqA = Number(a.total_requests) || 0;
        const reqB = Number(b.total_requests) || 0;
        if (reqA !== reqB) return reqB - reqA;
        return String(a.buyer_name || '').localeCompare(String(b.buyer_name || ''));
      });

      const arrow = (key) => {
        if (lbSortKey !== key) return '<span class="sort-arrow inactive">▲</span>';
        return lbSortDir === 'asc' ? '<span class="sort-arrow">▲</span>' : '<span class="sort-arrow">▼</span>';
      };

      const formatQuotaCell = (row) => {
        const used = Number(row.used_tokens) || 0;
        const quota = row.quota_tokens == null || row.quota_tokens === '' ? null : Number(row.quota_tokens);
        if (quota == null || Number.isNaN(quota)) {
          return formatTokens(used) + ' / ∞';
        }
        const pct = Math.min(100, Math.round((used / Math.max(quota, 1)) * 100));
        const barColor = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#22c55e';
        return '<div style="min-width:120px">' +
          '<div style="font-variant-numeric:tabular-nums">' + formatTokens(used) + ' / ' + formatTokens(quota) + '</div>' +
          '<div style="margin-top:4px;height:4px;background:#1e293b;border-radius:999px;overflow:hidden">' +
          '<div style="height:100%;width:' + pct + '%;background:' + barColor + '"></div></div>' +
          '<div style="font-size:11px;color:#94a3b8;margin-top:2px">' + pct + '%</div></div>';
      };

      // Podium Top 3 (hanya saat tanpa pencarian & data cukup)
      let podiumHtml = '';
      if (!lbSearchQ && sorted.length >= 3) {
        const medals = ['🥇', '🥈', '🥉'];
        const pods = [0, 1, 2].map(i => {
          const row = sorted[i];
          return '<div class="podium-card p-' + (i + 1) + '">' +
            '<div class="podium-medal">' + (i === 0 ? '👑' : medals[i]) + '</div>' +
            '<div class="podium-name">' + buyerNameHtml(row.buyer_name, row.quota_tokens) + '</div>' +
            '<div class="podium-stat"><strong>' + formatTokens(Number(row.used_tokens) || 0) + '</strong> tokens · ' + formatNum(row.total_requests) + ' req</div>' +
            '</div>';
        });
        podiumHtml = '<div class="podium">' + pods.join('') + '</div>';
      }

      // Pisahkan key inactive (0 kuota terpakai) di belakang toggle
      const isInactiveRow = (row) => (Number(row.used_tokens) || 0) === 0;
      const activeRows = lbSearchQ ? sorted : sorted.filter(r => !isInactiveRow(r));
      const inactiveRows = lbSearchQ ? [] : sorted.filter(isInactiveRow);
      const visibleRows = lbShowInactive ? sorted : activeRows;

      // Columns: rank, user, requests, kuota dipakai, remaining days, last active — all sortable except rank/user
      let html = podiumHtml + '<div class="table-wrapper"><table><thead><tr>' +
        '<th>#</th>' +
        '<th>User</th>' +
        '<th class="sortable" onclick="sortLeaderboard(&apos;total_requests&apos;)">Requests ' + arrow('total_requests') + '</th>' +
        '<th class="sortable" onclick="sortLeaderboard(&apos;used_tokens&apos;)">Kuota Dipakai ' + arrow('used_tokens') + '</th>' +
        '<th class="sortable" onclick="sortLeaderboard(&apos;remaining_days&apos;)">Remaining Days ' + arrow('remaining_days') + '</th>' +
        '<th class="sortable" onclick="sortLeaderboard(&apos;last_request_at&apos;)">Last Active ' + arrow('last_request_at') + '</th>' +
        '</tr></thead><tbody>';
      visibleRows.forEach((row, i) => {
        const rankClass = i < 3 ? ' rank-' + (i + 1) : '';
        const topRowClass = i < 3 ? ' class="top-row top-' + (i + 1) + '"' : '';
        const daysText = row.remaining_days !== null && row.remaining_days !== undefined ? row.remaining_days + 'd' : '∞';
        const daysClass = row.remaining_days !== null && row.remaining_days !== undefined
          ? (row.remaining_days <= 3 ? 'badge-red' : row.remaining_days <= 7 ? 'badge-yellow' : 'badge-green')
          : 'badge-blue';
        html += '<tr' + topRowClass + '><td class="rank' + rankClass + '">' + (i + 1) + '</td><td>' + buyerNameHtml(row.buyer_name, row.quota_tokens) + '</td><td>' + formatNum(row.total_requests) + '</td><td>' + formatQuotaCell(row) + '</td><td><span class="badge ' + daysClass + '">' + daysText + '</span></td><td>' + formatTime(row.last_request_at) + '</td></tr>';
      });
      html += '</tbody></table></div>';
      if (inactiveRows.length > 0) {
        html += '<button type="button" class="lb-inactive-toggle" onclick="toggleLbInactive()">' +
          (lbShowInactive
            ? 'Sembunyikan ' + inactiveRows.length + ' key tanpa pemakaian ▲'
            : 'Tampilkan ' + inactiveRows.length + ' key tanpa pemakaian ▼') +
          '</button>';
      }
      document.getElementById('lb-content').innerHTML = html;
    }

    function toggleLbInactive() {
      lbShowInactive = !lbShowInactive;
      renderLeaderboardTable();
    }

    // Live
    let livePrevKeys = null;
    async function loadLive() {
      try {
        const data = await fetchAPI('/public/live');
        const loading = document.getElementById('live-loading');
        const content = document.getElementById('live-content');
        const statsEl = document.getElementById('live-stats');
        loading.style.display = 'none';
        content.style.display = 'block';

        document.getElementById('live-updated').textContent = 'Updated: ' + formatTime(new Date().toISOString());

        const summary = data.summary || {};
        const activeKeys = Number(summary.active_keys ?? (data.active || []).length) || 0;
        const liveRequests = Number(summary.requests ?? 0) || 0;
        const liveTokens = Number(summary.tokens ?? 0) || 0;
        if (statsEl) {
          statsEl.innerHTML =
            statCardHtml(formatNum(activeKeys), 'Active Keys (5m)', 'keys', 'green', null) +
            statCardHtml(formatNum(liveRequests), 'Requests (5m)', 'requests', 'blue', null) +
            statCardHtml(formatTokens(liveTokens), 'Tokens (5m)', 'tokens', 'amber', null);
        }

        if (!data.active || data.active.length === 0) {
          livePrevKeys = new Set();
          content.innerHTML = emptyHtml('No active keys in the last 5 minutes');
          return;
        }

        const currKeys = new Set(data.active.map(r => String(r.buyer_name || '') + '|' + String(r.last_request_at || '')));
        let html = '<div class="table-wrapper"><table><thead><tr><th>User</th><th>Requests</th><th>Tokens</th><th>Models</th><th>Last Request</th></tr></thead><tbody>';
        data.active.forEach(row => {
          const models = (row.models_used || []).map(m => modelTagHtml(m)).join('');
          const rowKey = String(row.buyer_name || '') + '|' + String(row.last_request_at || '');
          const isNew = livePrevKeys !== null && !livePrevKeys.has(rowKey);
          const rowClass = isNew ? ' class="row-new row-enter"' : '';
          html += '<tr' + rowClass + '><td>' + buyerNameHtml(row.buyer_name, row.quota_tokens) + '</td><td>' + formatNum(row.request_count) + '</td><td>' + formatTokens(row.total_tokens) + '</td><td>' + models + '</td><td title="' + formatTime(row.last_request_at) + '">' + timeAgo(row.last_request_at) + '</td></tr>';
        });
        html += '</tbody></table></div>';
        content.innerHTML = html;
        livePrevKeys = currKeys;
      } catch (e) {
        // silent
      }
    }

    // Usage
    let usagePrevIds = null;
    async function loadUsage() {
      try {
        const data = await fetchAPI('/public/usage');
        const loading = document.getElementById('usage-loading');
        const content = document.getElementById('usage-content');
        loading.style.display = 'none';
        content.style.display = 'block';

        if (!data.events || data.events.length === 0) {
          usagePrevIds = new Set();
          content.innerHTML = emptyHtml('No usage events yet');
          return;
        }

        const evKey = (row) => String(row.created_at || '') + '|' + String(row.buyer_name || '') + '|' + String(row.model_id || '');
        const currIds = new Set(data.events.map(evKey));
        let html = '<div class="table-wrapper"><table><thead><tr><th>Time</th><th>User</th><th>Model</th><th>Status</th><th>Tokens</th><th>Latency</th></tr></thead><tbody>';
        data.events.forEach(row => {
          const statusBadge = row.success ? '<span class="badge badge-green">200</span>' : '<span class="badge badge-red">' + (row.status_code || 'ERR') + '</span>';
          const tokens = formatTokens(row.total_tokens);
          const latency = row.latency_ms ? row.latency_ms + 'ms' : '-';
          const isNew = usagePrevIds !== null && !usagePrevIds.has(evKey(row));
          const rowClass = isNew ? ' class="row-new"' : '';
          html += '<tr' + rowClass + '><td title="' + formatTime(row.created_at) + '">' + timeAgo(row.created_at) + '</td><td>' + buyerNameHtml(row.buyer_name, row.quota_tokens) + '</td><td>' + modelTagHtml(row.model_id) + '</td><td>' + statusBadge + '</td><td>' + tokens + '</td><td>' + latency + '</td></tr>';
        });
        html += '</tbody></table></div>';
        content.innerHTML = html;
        usagePrevIds = currIds;
      } catch (e) {
        document.getElementById('usage-content').innerHTML = emptyHtml('Failed to load data');
      }
    }

    // Chart
    async function loadChart(range) {
      document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
      event?.target?.classList.add('active');

      try {
        const data = await fetchAPI('/public/usage/chart?range=' + range);
        renderChart(data.points || []);
      } catch (e) {
        // silent
      }
    }

    function renderChart(points) {
      const svg = document.getElementById('usage-chart');
      if (!points || points.length === 0) {
        svg.innerHTML = '<text x="400" y="125" text-anchor="middle" fill="#64748b" font-size="14">No data</text>';
        return;
      }

      const width = 800;
      const height = 320;
      const padding = { top: 25, right: 20, bottom: 35, left: 20 };
      const chartW = width - padding.left - padding.right;
      const chartH = height - padding.top - padding.bottom;

      const maxReq = Math.max(...points.map(p => p.requests), 1);
      const maxTok = Math.max(...points.map(p => p.tokens), 1);

      const stepX = chartW / Math.max(points.length - 1, 1);
      
      // Show labels on every N points based on data density
      const labelInterval = points.length <= 10 ? 1 : points.length <= 20 ? 2 : 4;

      // Requests line (blue) with labels
      const reqPoints = points.map((p, i) => {
        const x = padding.left + i * stepX;
        const y = padding.top + chartH - (p.requests / maxReq) * chartH;
        return [x, y, p.requests];
      });
      const reqPath = reqPoints.map((p, i) => (i === 0 ? 'M' : 'L') + p[0] + ',' + p[1]).join(' ');
      let reqLabels = '';
      reqPoints.forEach((p, i) => {
        if (i % labelInterval === 0 || i === reqPoints.length - 1) {
          reqLabels += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="4" fill="#3b82f6"/>';
          reqLabels += '<text x="' + p[0] + '" y="' + (p[1] - 12) + '" text-anchor="middle" fill="#3b82f6" font-size="10" font-weight="600">' + p[2].toLocaleString() + '</text>';
        }
      });

      // Tokens line (yellow) with labels
      const tokPoints = points.map((p, i) => {
        const x = padding.left + i * stepX;
        const y = padding.top + chartH - (p.tokens / maxTok) * chartH;
        return [x, y, p.tokens];
      });
      const tokPath = tokPoints.map((p, i) => (i === 0 ? 'M' : 'L') + p[0] + ',' + p[1]).join(' ');
      let tokLabels = '';
      tokPoints.forEach((p, i) => {
        if (i % labelInterval === 0 || i === tokPoints.length - 1) {
          tokLabels += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="4" fill="#fbbf24"/>';
          tokLabels += '<text x="' + p[0] + '" y="' + (p[1] + 18) + '" text-anchor="middle" fill="#fbbf24" font-size="10" font-weight="600">' + formatTokens(p[2]) + '</text>';
        }
      });

      // X-axis time labels
      const timeLabelStep = Math.max(1, Math.floor(points.length / 8));
      let timeLabels = '';
      points.forEach((p, i) => {
        if (i % timeLabelStep === 0 || i === points.length - 1) {
          const x = padding.left + i * stepX;
          timeLabels += '<text x="' + x + '" y="' + (height - 8) + '" text-anchor="middle" fill="#64748b" font-size="11">' + p.label + '</text>';
        }
      });

      svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
      const baseY = padding.top + chartH;
      const reqArea = reqPath + ' L' + reqPoints[reqPoints.length - 1][0] + ',' + baseY + ' L' + reqPoints[0][0] + ',' + baseY + ' Z';
      const tokArea = tokPath + ' L' + tokPoints[tokPoints.length - 1][0] + ',' + baseY + ' L' + tokPoints[0][0] + ',' + baseY + ' Z';
      svg.innerHTML = '<defs>' +
        '<linearGradient id="reqFill" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="#3b82f6" stop-opacity="0.28"/>' +
        '<stop offset="100%" stop-color="#3b82f6" stop-opacity="0"/></linearGradient>' +
        '<linearGradient id="tokFill" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="#fbbf24" stop-opacity="0.22"/>' +
        '<stop offset="100%" stop-color="#fbbf24" stop-opacity="0"/></linearGradient>' +
        '</defs>' +
        '<path class="chart-fade-in" d="' + reqArea + '" fill="url(#reqFill)" stroke="none"/>' +
        '<path class="chart-fade-in" d="' + tokArea + '" fill="url(#tokFill)" stroke="none"/>' +
        '<path class="chart-line-anim" d="' + reqPath + '" fill="none" stroke="#3b82f6" stroke-width="2"/>' +
        '<path class="chart-line-anim" d="' + tokPath + '" fill="none" stroke="#fbbf24" stroke-width="2"/>' +
        '<g class="chart-fade-in">' + reqLabels + tokLabels + timeLabels + '</g>';
    }

    // Models
    async function loadModels() {
      try {
        const data = await fetchAPI('/public/models');
        const loading = document.getElementById('models-loading');
        const content = document.getElementById('models-content');
        loading.style.display = 'none';
        content.style.display = 'block';

        if (!data.models || data.models.length === 0) {
          content.innerHTML = emptyHtml('No models available');
          return;
        }

        const freeCount = data.models.filter(function(m) {
          const roles = Array.isArray(m.access_roles) ? m.access_roles : [];
          return !!m.quota_exempt && roles.length === 0 && !m.privileged_only;
        }).length;
        const privCount = data.models.filter(function(m) {
          const roles = Array.isArray(m.access_roles) ? m.access_roles : [];
          return roles.length > 0 || !!m.privileged_only;
        }).length;
        let html = '';
        const hintParts = [];
        if (freeCount > 0) {
          hintParts.push('<strong>' + freeCount + ' unlimited</strong> · usage tercatat, kuota token key tidak terpotong');
        }
        if (privCount > 0) {
          hintParts.push('<span class="priv-strong">' + privCount + ' role-restricted</span> · Dev / Supporter / Ultra (lihat badge)');
        }
        if (hintParts.length) {
          html += '<div class="model-hint">' + hintParts.join(' · ') + ' · klik kartu untuk copy ID</div>';
        } else {
          html += '<div class="model-hint">Klik kartu untuk copy model ID</div>';
        }
        html += '<div class="models-grid-public" style="margin-top:0.9rem">';

        data.models.forEach(function(m) {
          let roles = Array.isArray(m.access_roles) ? m.access_roles.slice() : [];
          if (!roles.length && m.privileged_only) roles = ['dev', 'supporter'];
          const isPriv = roles.length > 0;
          const isFree = !!m.quota_exempt && !isPriv;
          const name = m.display_name || m.id;
          let badge;
          if (isPriv) {
            const labels = roles.map(function(r) {
              if (r === 'dev') return 'Dev';
              if (r === 'supporter') return 'Supporter';
              if (r === 'ultra') return 'Ultra';
              return r;
            });
            badge = '<span class="privileged-badge" title="Hanya role: ' + labels.join(', ') + '">' + labels.join(' · ') + '</span>';
          } else if (isFree) {
            badge = '<span class="free-badge" title="Tidak potong kuota token key"><span aria-hidden="true">∞</span>Unlimited</span>';
          } else {
            badge = '<span class="metered-badge">Metered</span>';
          }
          const cardClass = (isPriv ? ' privileged' : (isFree ? ' free' : '')) + (isClaudeModel(m.id) ? ' claude-card' : '');
          let meta;
          if (isPriv) {
            const labels = roles.map(function(r) {
              if (r === 'dev') return 'Super Admin (DEV)';
              if (r === 'supporter') return 'Supporter';
              if (r === 'ultra') return 'Ultra (500M)';
              return r;
            });
            meta = '<span style="font-size:0.72rem;color:#fbbf24">Akses: ' + labels.join(' · ') + '</span>';
          } else if (isFree) {
            meta = '<span style="font-size:0.72rem;color:#7dd3fc">Free tokens · RPM tetap berlaku</span>';
          } else {
            meta = '<span style="font-size:0.72rem;color:#94a3b8">Menggunakan kuota token key</span>';
          }
          const claudeBadge = isClaudeModel(m.id) ? '<span class="claude-badge" title="Claude model">&#10022; Claude</span>' : '';
          html += '<div class="model-card' + cardClass + '" data-id="' + escapeHtml(m.id) + '" role="button" tabindex="0" title="Copy ' + escapeHtml(m.id) + '">' +
            '<div class="model-card-top"><div class="model-card-name">' + escapeHtml(name) + '</div>' + claudeBadge + badge + '</div>' +
            '<div class="model-card-id">' + escapeHtml(m.id) + '</div>' +
            '<div class="model-card-meta">' + meta + '</div></div>';
        });
        html += '</div>';
        content.innerHTML = html;

        content.querySelectorAll('.model-card').forEach(function(el) {
          el.addEventListener('click', function() { copyModelCard(el); });
          el.addEventListener('keydown', function(ev) {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); copyModelCard(el); }
          });
        });
      } catch (e) {
        document.getElementById('models-content').innerHTML = emptyHtml('Failed to load models');
      }
    }

    function escapeHtml(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function copyModelCard(el) {
      const id = el.getAttribute('data-id') || '';
      if (!id) return;
      navigator.clipboard.writeText(id);
      el.classList.add('copied');
      const idEl = el.querySelector('.model-card-id');
      const orig = idEl ? idEl.textContent : '';
      if (idEl) idEl.textContent = 'Copied!';
      setTimeout(function() {
        el.classList.remove('copied');
        if (idEl) idEl.textContent = orig;
      }, 1400);
    }

    // Initial load
    loadLeaderboard();
    lbInterval = setInterval(() => loadLeaderboard(null, true), 45000);
  </script>
</body>
</html>`;
}
