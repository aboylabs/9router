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
      `SELECT id, display_name FROM models WHERE active = true AND id LIKE 'routers9/%' ORDER BY id`
    );
    return { models: result.rows };
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
              <div class="url">http://43.128.67.88/v1</div>
            </div>
            <button class="copy-btn" onclick="copyToClip(this, 'http://43.128.67.88/v1')">Copy</button>
          </div>

          <div class="pro-tips">
            <h3>Pro Tips</h3>
            <ul>
              <li><span class="tip-icon">&#9679;</span>Your API key starts with <code>9r-xxxx</code></li>
              <li><span class="tip-icon">&#9679;</span>Base URL: <code>http://43.128.67.88/v1</code></li>
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
              <div class="url" style="font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.9rem; color: #60a5fa;">http://43.128.67.88/v1</div>
              <button class="copy-btn" onclick="copyToClip(this, 'http://43.128.67.88/v1')">Copy</button>
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
curl http://43.128.67.88/v1/chat/completions \
  -H <span class="string">"Authorization: Bearer ***"</span> \
  -H <span class="string">"Content-Type: application/json"</span> \
  -d <span class="string">'{
  "model": "routers9/claude-sonnet-4.6",
  "messages": [{"role": "user", "content": "Hello!"}]
}'</span></div>
            <div class="code-block" id="code-stream"><button class="code-copy" onclick="copyCurl(this, 'stream')">Copy</button><span class="comment"># Streaming</span>
curl http://43.128.67.88/v1/chat/completions \
  -H <span class="string">"Authorization: Bearer ***"</span> \
  -H <span class="string">"Content-Type: application/json"</span> \
  -d <span class="string">'{
  "model": "routers9/claude-sonnet-4.6",
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
        text = "curl http://43.128.67.88/v1/chat/completions \\\\n  -H \\"Authorization: Bearer 9r-xxxx\\" \\\\n  -H \\"Content-Type: application/json\\" \\\\n  -d '{\\n  \\"model\\": \\"routers9/claude-sonnet-4.6\\",\\n  \\"messages\\": [{\\"role\\": \\"user\\", \\"content\\": \\"Hello!\\"}]\\n}'";
      } else {
        text = "curl http://43.128.67.88/v1/chat/completions \\\\n  -H \\"Authorization: Bearer 9r-xxxx\\" \\\\n  -H \\"Content-Type: application/json\\" \\\\n  -d '{\\n  \\"model\\": \\"routers9/claude-sonnet-4.6\\",\\n  \\"messages\\": [{\\"role\\": \\"user\\", \\"content\\": \\"Hello!\\"}],\\n  \\"stream\\": true\\n}'";
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
  <title>Routers9 Public</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { -webkit-tap-highlight-color: transparent; }
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
    }
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
      max-width: 1400px;
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
      gap: 1rem; flex-wrap: wrap; margin-bottom: 1.25rem;
    }
    .page-title {
      font-size: 1.65rem; font-weight: 800; letter-spacing: -0.03em;
      color: #f8fafc; margin-bottom: 0.35rem;
    }
    .page-title span.grad {
      background: linear-gradient(90deg, #c4b5fd, #60a5fa, #34d399);
      -webkit-background-clip: text; background-clip: text; color: transparent;
    }
    .page-desc { font-size: 0.9rem; color: #94a3b8; margin-bottom: 0; line-height: 1.5; max-width: 48rem; }
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
      background: rgba(15,23,42,0.55);
      border: 1px solid rgba(148,163,184,0.12);
      border-radius: 16px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.18);
    }
    table { width: 100%; border-collapse: collapse; min-width: 700px; }
    th {
      text-align: left;
      font-size: 0.72rem;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding: 0.9rem 1rem;
      border-bottom: 1px solid rgba(148,163,184,0.12);
      position: sticky;
      top: 0;
      background: rgba(15,23,42,0.95);
      backdrop-filter: blur(8px);
      z-index: 10;
      font-weight: 700;
    }
    td {
      font-size: 0.875rem;
      padding: 0.95rem 1rem;
      border-bottom: 1px solid rgba(148,163,184,0.07);
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

    /* === SEARCH === */
    .search-box {
      margin: 0 0 1rem 0;
      display: flex;
      gap: 0.55rem;
      align-items: center;
      flex-wrap: wrap;
      background: rgba(15,23,42,0.45);
      border: 1px solid rgba(148,163,184,0.12);
      border-radius: 14px;
      padding: 0.55rem;
    }
    .search-box input {
      flex: 1; min-width: 220px;
      padding: 0.7rem 0.9rem;
      border-radius: 10px;
      border: 1px solid rgba(148,163,184,0.14);
      background: rgba(7,11,22,0.75);
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
      padding: 0.7rem 1rem;
      border-radius: 10px;
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
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 55%, #1e1b4b 100%);
      border: 1px solid #334155;
      border-radius: 16px;
      padding: 1.5rem 1.75rem;
      margin-bottom: 1.5rem;
      position: relative;
      overflow: hidden;
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
      font-size: 1.15rem;
      font-weight: 700;
      color: #f8fafc;
      margin-bottom: 0.35rem;
    }
    .prices-hero-sub {
      font-size: 0.9rem;
      color: #94a3b8;
      line-height: 1.5;
      max-width: 640px;
    }
    .prices-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 1rem;
    }
    .price-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.4rem 0.75rem;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 600;
      border: 1px solid #334155;
      background: rgba(15, 23, 42, 0.7);
      color: #e2e8f0;
    }
    .price-pill.purple { border-color: #7c3aed; color: #c4b5fd; background: rgba(124, 58, 237, 0.15); }
    .price-pill.blue { border-color: #2563eb; color: #93c5fd; background: rgba(37, 99, 235, 0.15); }
    .price-pill.green { border-color: #16a34a; color: #86efac; background: rgba(22, 163, 74, 0.15); }
    .price-pill.yellow { border-color: #ca8a04; color: #fde68a; background: rgba(202, 138, 4, 0.15); }

    .pricing-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .price-card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 16px;
      padding: 1.35rem 1.25rem 1.25rem;
      display: flex;
      flex-direction: column;
      position: relative;
      transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s;
    }
    .price-card:hover {
      transform: translateY(-4px);
      border-color: #475569;
      box-shadow: 0 12px 30px rgba(0,0,0,0.25);
    }
    .price-card.featured {
      border-color: #7c3aed;
      background: linear-gradient(180deg, rgba(124,58,237,0.18) 0%, #1e293b 45%);
      box-shadow: 0 0 0 1px rgba(124,58,237,0.25), 0 16px 40px rgba(124,58,237,0.12);
    }
    .price-card.featured:hover { border-color: #a78bfa; }
    .price-badge {
      position: absolute;
      top: -11px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(90deg, #7c3aed, #2563eb);
      color: white;
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      padding: 0.28rem 0.7rem;
      border-radius: 999px;
      white-space: nowrap;
    }
    .price-tier {
      font-size: 0.8rem;
      font-weight: 700;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 0.5rem;
    }
    .price-amount {
      font-size: 1.85rem;
      font-weight: 800;
      color: #f8fafc;
      line-height: 1.1;
      margin-bottom: 0.2rem;
    }
    .price-amount span {
      font-size: 0.95rem;
      font-weight: 600;
      color: #94a3b8;
      margin-right: 0.15rem;
    }
    .price-period {
      font-size: 0.82rem;
      color: #64748b;
      margin-bottom: 1rem;
    }
    .price-features {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
      margin: 0 0 1.25rem;
      flex: 1;
    }
    .price-features li {
      display: flex;
      align-items: flex-start;
      gap: 0.55rem;
      font-size: 0.88rem;
      color: #e2e8f0;
      line-height: 1.35;
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
      padding: 0.8rem 1rem;
      border-radius: 10px;
      font-weight: 700;
      font-size: 0.9rem;
      transition: all 0.2s;
      border: 1px solid #334155;
      background: #0f172a;
      color: #e2e8f0;
    }
    .price-cta:hover { border-color: #3b82f6; color: #fff; background: #1e293b; }
    .price-cta.primary {
      background: linear-gradient(90deg, #7c3aed, #2563eb);
      border-color: transparent;
      color: #fff;
    }
    .price-cta.primary:hover {
      filter: brightness(1.08);
      box-shadow: 0 8px 20px rgba(124,58,237,0.3);
    }
    .prices-note {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 1.1rem 1.25rem;
      color: #94a3b8;
      font-size: 0.88rem;
      line-height: 1.55;
    }
    .prices-note strong { color: #e2e8f0; }
    .prices-note a { color: #60a5fa; text-decoration: none; font-weight: 600; }
    .prices-note a:hover { text-decoration: underline; }

    @media (max-width: 1024px) {
      .pricing-grid { grid-template-columns: 1fr; max-width: 420px; }
      .price-card.featured { order: -1; }
    }
    @media (max-width: 768px) {
      .prices-hero { padding: 1.15rem 1rem; }
      .price-amount { font-size: 1.6rem; }
      .pricing-grid { max-width: none; }
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
        <a href="https://t.me/grokapi_id" target="_blank" rel="noopener" class="tg-link" title="Telegram">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
        </a>
        <p>Public Dashboard · Grok 4.5 API</p>
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
            <p class="page-desc">Top API keys by request count and token usage</p>
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
        <div class="loading pulse" id="lb-loading">Loading...</div>
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
        <div class="loading pulse" id="live-loading">Loading...</div>
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
        <div class="loading pulse" id="usage-loading">Loading...</div>
        <div id="usage-content" style="display:none"></div>
      </div>

      <!-- Models -->
      <div class="page" id="page-models">
        <div class="page-header">
          <div>
            <h2 class="page-title"><span class="grad">Available Models</span></h2>
            <p class="page-desc">Click any model ID to copy it</p>
          </div>
        </div>
        <div class="loading pulse" id="models-loading">Loading...</div>
        <div id="models-content" style="display:none"></div>
      </div>

      <!-- Prices -->
      <div class="page" id="page-prices">
        <div class="page-header">
          <div>
            <h2 class="page-title"><span class="grad">Harga / Prices</span></h2>
            <p class="page-desc">Paket akses Routers9 — bayar sekali, langsung pakai</p>
          </div>
        </div>

        <div class="prices-hero">
          <div class="prices-hero-title">Akses Grok 4.5 lewat API OpenAI-compatible</div>
          <div class="prices-hero-sub">
            Semua paket sudah include model <strong style="color:#c4b5fd">Grok 4.5</strong>, rate limit
            <strong style="color:#93c5fd">50 RPM</strong>, dan endpoint siap pakai. Order cepat via Telegram.
          </div>
          <div class="prices-pills">
            <span class="price-pill purple">Grok 4.5</span>
            <span class="price-pill blue">50 RPM</span>
            <span class="price-pill green">OpenAI Compatible</span>
            <span class="price-pill yellow">Aktif Instant</span>
          </div>
        </div>

        <div class="pricing-grid">
          <div class="price-card">
            <div class="price-tier">Starter</div>
            <div class="price-amount"><span>Rp</span>100.000</div>
            <div class="price-period">masa aktif 7 hari</div>
            <ul class="price-features">
              <li><span class="price-check">✓</span><span><strong>100M</strong> token quota</span></li>
              <li><span class="price-check">✓</span><span>Akses <strong>Grok 4.5</strong></span></li>
              <li><span class="price-check">✓</span><span>Rate limit <strong>50 RPM</strong></span></li>
              <li><span class="price-check">✓</span><span>API key pribadi</span></li>
              <li><span class="price-check">✓</span><span>Cocok buat coba / light use</span></li>
            </ul>
            <a class="price-cta" href="https://t.me/routers9" target="_blank" rel="noopener">Order via Telegram</a>
          </div>

          <div class="price-card featured">
            <div class="price-badge">Paling Laris</div>
            <div class="price-tier" style="color:#c4b5fd">Pro</div>
            <div class="price-amount"><span>Rp</span>200.000</div>
            <div class="price-period">masa aktif 14 hari</div>
            <ul class="price-features">
              <li><span class="price-check">✓</span><span><strong>250M</strong> token quota</span></li>
              <li><span class="price-check">✓</span><span>Akses <strong>Grok 4.5</strong></span></li>
              <li><span class="price-check">✓</span><span>Rate limit <strong>50 RPM</strong></span></li>
              <li><span class="price-check">✓</span><span>API key pribadi</span></li>
              <li><span class="price-check">✓</span><span>Best value buat daily use</span></li>
            </ul>
            <a class="price-cta primary" href="https://t.me/routers9" target="_blank" rel="noopener">Order Pro Sekarang</a>
          </div>

          <div class="price-card">
            <div class="price-tier">Ultra</div>
            <div class="price-amount"><span>Rp</span>300.000</div>
            <div class="price-period">masa aktif 28 hari</div>
            <ul class="price-features">
              <li><span class="price-check">✓</span><span><strong>500M</strong> token quota</span></li>
              <li><span class="price-check">✓</span><span>Akses <strong>Grok 4.5</strong></span></li>
              <li><span class="price-check">✓</span><span>Rate limit <strong>50 RPM</strong></span></li>
              <li><span class="price-check">✓</span><span>API key pribadi</span></li>
              <li><span class="price-check">✓</span><span>Paling hemat per token</span></li>
            </ul>
            <a class="price-cta" href="https://t.me/routers9" target="_blank" rel="noopener">Order via Telegram</a>
          </div>
        </div>

        <div class="prices-note">
          <strong>Cara order:</strong> chat Telegram
          <a href="https://t.me/routers9" target="_blank" rel="noopener">@routers9</a>
          → sebut paket (Starter / Pro / Ultra) → bayar → key dikirim instant.<br/>
          Semua paket: endpoint OpenAI-compatible, akses <strong>Grok 4.5</strong>, rate limit <strong>50 request/menit</strong>.
        </div>
      </div>
    </main>
  </div>

  <script>
    let liveInterval = null;
    let currentPage = 'leaderboard';

    function switchPage(page) {
      currentPage = page;
      document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
      document.querySelector('[data-page="' + page + '"]').classList.add('active');
      document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
      document.getElementById('page-' + page).classList.add('active');

      // Stop live polling if not on live page
      if (liveInterval) { clearInterval(liveInterval); liveInterval = null; }

      // Load data for the page
      if (page === 'leaderboard') loadLeaderboard();
      else if (page === 'live') { loadLive(); liveInterval = setInterval(loadLive, 10000); }
      else if (page === 'usage') { loadUsage(); loadChart('1d'); }
      else if (page === 'models') loadModels();
      // prices page is static HTML — no fetch needed

      // Scroll to top on page switch
      window.scrollTo({ top: 0, behavior: 'smooth' });
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

    async function fetchAPI(path) {
      const res = await fetch(path);
      if (!res.ok) throw new Error('API error');
      return res.json();
    }

    // Leaderboard state
    let lbData = [];
    let lbSortKey = 'total_requests';
    let lbSortDir = 'desc';
    let lbSearchQ = '';
    let lbSearchTimer = null;

    async function loadLeaderboard(q) {
      try {
        const query = (q == null ? lbSearchQ : q).trim();
        lbSearchQ = query;
        const loading = document.getElementById('lb-loading');
        const content = document.getElementById('lb-content');
        const meta = document.getElementById('lb-search-meta');
        loading.style.display = 'block';
        content.style.display = 'none';

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
          statsEl.innerHTML = '<div class="stat-card"><div class="stat-value">' + formatNum(overviewRes.requests) + '</div><div class="stat-label">Total Requests</div></div>' +
            '<div class="stat-card"><div class="stat-value">' + formatTokens(overviewRes.tokens) + '</div><div class="stat-label">Total Tokens</div></div>';
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
          content.innerHTML = '<div class="empty">' + (query ? 'Tidak ketemu untuk "' + query + '"' : 'No usage data yet') + '</div>';
          return;
        }

        renderLeaderboardTable();
      } catch (e) {
        document.getElementById('lb-loading').style.display = 'none';
        document.getElementById('lb-content').style.display = 'block';
        document.getElementById('lb-content').innerHTML = '<div class="empty">Failed to load data</div>';
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
      if (lbSortKey === key) {
        lbSortDir = lbSortDir === 'desc' ? 'asc' : 'desc';
      } else {
        lbSortKey = key;
        lbSortDir = 'desc';
      }
      renderLeaderboardTable();
    }

    function renderLeaderboardTable() {
      const sorted = [...lbData].sort((a, b) => {
        let valA = a[lbSortKey];
        let valB = b[lbSortKey];
        if (lbSortKey === 'used_tokens' || lbSortKey === 'quota_tokens') {
          valA = Number(valA);
          valB = Number(valB);
        }
        if (valA < valB) return lbSortDir === 'asc' ? -1 : 1;
        if (valA > valB) return lbSortDir === 'asc' ? 1 : -1;
        return 0;
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

      // Columns: rank, user, requests, token quota (used/limit), remaining days, last active.
      // "Usage Tokens" (lifetime sum from usage_events) removed — redundant with Token Quota.
      let html = '<div class="table-wrapper"><table><thead><tr><th>#</th><th>User</th><th class="sortable" onclick="sortLeaderboard(&apos;total_requests&apos;)">Requests ' + arrow('total_requests') + '</th><th class="sortable" onclick="sortLeaderboard(&apos;used_tokens&apos;)">Token Quota ' + arrow('used_tokens') + '</th><th>Remaining Days</th><th>Last Active</th></tr></thead><tbody>';
      sorted.forEach((row, i) => {
        const rankClass = i < 3 ? ' rank-' + (i + 1) : '';
        const topRowClass = i < 3 ? ' class="top-row top-' + (i + 1) + '"' : '';
        const daysText = row.remaining_days !== null ? row.remaining_days + 'd' : '∞';
        const daysClass = row.remaining_days !== null ? (row.remaining_days <= 3 ? 'badge-red' : row.remaining_days <= 7 ? 'badge-yellow' : 'badge-green') : 'badge-blue';
        const nameStyle = (row.buyer_name || '').trim().toLowerCase() === 'super admin'
          ? ' style="color:#c084fc;font-weight:700"'
          : row.is_vip ? ' style="color:#fbbf24;font-weight:700"' : '';
        const vipBadge = (row.buyer_name || '').trim().toLowerCase() === 'super admin'
          ? ' <span style="color:#c084fc" title="Super Admin (unlimited)">👑</span>'
          : row.is_vip ? ' <span style="color:#fbbf24" title="VIP (500M token quota)">👑</span>' : '';
        html += '<tr' + topRowClass + '><td class="rank' + rankClass + '">' + (i + 1) + '</td><td' + nameStyle + '>' + (row.buyer_name || '-') + vipBadge + '</td><td>' + formatNum(row.total_requests) + '</td><td>' + formatQuotaCell(row) + '</td><td><span class="badge ' + daysClass + '">' + daysText + '</span></td><td>' + formatTime(row.last_request_at) + '</td></tr>';
      });
      html += '</tbody></table></div>';
      document.getElementById('lb-content').innerHTML = html;
    }

    // Live
    async function loadLive() {
      try {
        const data = await fetchAPI('/public/live');
        const loading = document.getElementById('live-loading');
        const content = document.getElementById('live-content');
        loading.style.display = 'none';
        content.style.display = 'block';

        document.getElementById('live-updated').textContent = 'Updated: ' + formatTime(new Date().toISOString());

        if (!data.active || data.active.length === 0) {
          content.innerHTML = '<div class="empty">No active keys in the last 5 minutes</div>';
          return;
        }

        let html = '<div class="table-wrapper"><table><thead><tr><th>User</th><th>Requests</th><th>Tokens</th><th>Models</th><th>Last Request</th></tr></thead><tbody>';
        data.active.forEach(row => {
          const models = (row.models_used || []).map(m => '<span class="model-tag">' + m + '</span>').join('');
          const nameStyle = (row.buyer_name || '').trim().toLowerCase() === 'super admin'
            ? ' style="color:#c084fc;font-weight:700"'
            : row.is_vip ? ' style="color:#fbbf24;font-weight:700"' : '';
          const vipBadge = (row.buyer_name || '').trim().toLowerCase() === 'super admin'
            ? ' <span style="color:#c084fc" title="Super Admin (unlimited)">👑</span>'
            : row.is_vip ? ' <span style="color:#fbbf24" title="VIP Unlimited">👑</span>' : '';
          html += '<tr><td' + nameStyle + '>' + (row.buyer_name || '-') + vipBadge + '</td><td>' + formatNum(row.request_count) + '</td><td>' + formatTokens(row.total_tokens) + '</td><td>' + models + '</td><td>' + formatTime(row.last_request_at) + '</td></tr>';
        });
        html += '</tbody></table></div>';
        content.innerHTML = html;
      } catch (e) {
        // silent
      }
    }

    // Usage
    async function loadUsage() {
      try {
        const data = await fetchAPI('/public/usage');
        const loading = document.getElementById('usage-loading');
        const content = document.getElementById('usage-content');
        loading.style.display = 'none';
        content.style.display = 'block';

        if (!data.events || data.events.length === 0) {
          content.innerHTML = '<div class="empty">No usage events yet</div>';
          return;
        }

        let html = '<div class="table-wrapper"><table><thead><tr><th>Time</th><th>User</th><th>Model</th><th>Status</th><th>Tokens</th><th>Latency</th></tr></thead><tbody>';
        data.events.forEach(row => {
          const statusBadge = row.success ? '<span class="badge badge-green">200</span>' : '<span class="badge badge-red">' + (row.status_code || 'ERR') + '</span>';
          const tokens = formatTokens(row.total_tokens);
          const latency = row.latency_ms ? row.latency_ms + 'ms' : '-';
          const nameStyle = (row.buyer_name || '').trim().toLowerCase() === 'super admin'
            ? ' style="color:#c084fc;font-weight:700"'
            : row.is_vip ? ' style="color:#fbbf24;font-weight:700"' : '';
          const vipBadge = (row.buyer_name || '').trim().toLowerCase() === 'super admin'
            ? ' <span style="color:#c084fc" title="Super Admin (unlimited)">👑</span>'
            : row.is_vip ? ' <span style="color:#fbbf24" title="VIP Unlimited">👑</span>' : '';
          html += '<tr><td>' + formatTime(row.created_at) + '</td><td' + nameStyle + '>' + (row.buyer_name || '-') + vipBadge + '</td><td class="model-tag">' + (row.model_id || '-') + '</td><td>' + statusBadge + '</td><td>' + tokens + '</td><td>' + latency + '</td></tr>';
        });
        html += '</tbody></table></div>';
        content.innerHTML = html;
      } catch (e) {
        document.getElementById('usage-content').innerHTML = '<div class="empty">Failed to load data</div>';
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
      svg.innerHTML = '<path d="' + reqPath + '" fill="none" stroke="#3b82f6" stroke-width="2"/>' +
        reqLabels +
        '<path d="' + tokPath + '" fill="none" stroke="#fbbf24" stroke-width="2"/>' +
        tokLabels +
        timeLabels;
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
          content.innerHTML = '<div class="empty">No models available</div>';
          return;
        }

        let html = '<div style="display:flex;flex-wrap:wrap;gap:0.5rem">';
        data.models.forEach(m => {
          html += '<span class="model-tag" style="cursor:pointer" onclick="copyModel(this, \\'' + m.id + '\\')">' + m.id + '</span>';
        });
        html += '</div>';
        content.innerHTML = html;
      } catch (e) {
        document.getElementById('models-content').innerHTML = '<div class="empty">Failed to load models</div>';
      }
    }

    function copyModel(el, id) {
      navigator.clipboard.writeText(id);
      el.classList.add('badge-green');
      const orig = el.textContent;
      el.textContent = 'Copied!';
      setTimeout(() => { el.textContent = orig; el.classList.remove('badge-green'); }, 1500);
    }

    // Initial load
    loadLeaderboard();
  </script>
</body>
</html>`;
}
