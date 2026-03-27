/**
 * menu-server.js
 * Serves the raw Lua menu code at /LucidMenu
 * Also serves a password-protected admin panel at /admin to edit the code live
 * MachoIsolatedInject(MachoWebRequest("https://lucidluav2.up.railway.app/LucidMenu"))
 */
require('dotenv').config();
const http = require('http');
const { Pool } = require('pg');
const url  = require('url');

const PORT         = process.env.MENU_SERVER_PORT || 3001;
const ADMIN_PASS   = process.env.MENU_ADMIN_PASSWORD || 'changeme';

// ─── Postgres for storing the menu code ───────────────────────────────────────
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false,
});

async function initDb() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS menu_code (
            id      INT PRIMARY KEY DEFAULT 1,
            code    TEXT NOT NULL DEFAULT '',
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    // Insert default row if not exists
    await pool.query(`
        INSERT INTO menu_code (id, code) VALUES (1, '-- Paste your Lucid Menu Lua code here')
        ON CONFLICT (id) DO NOTHING
    `);
    console.log('[MenuServer] DB ready.');
}

async function getCode() {
    const { rows } = await pool.query('SELECT code FROM menu_code WHERE id = 1');
    return rows[0]?.code ?? '';
}

async function saveCode(code) {
    await pool.query('UPDATE menu_code SET code = $1, updated_at = NOW() WHERE id = 1', [code]);
}

// ─── HTTP Server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
    const parsed   = url.parse(req.url, true);
    const pathname = parsed.pathname;

    // ── Serve raw Lua code — this is what MachoWebRequest hits ────────────────
    if (req.method === 'GET' && pathname === '/LucidMenu') {
        try {
            const code = await getCode();
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end(code);
        } catch (err) {
            res.writeHead(500);
            return res.end('-- Server error');
        }
    }

    // ── Admin Panel ───────────────────────────────────────────────────────────
    if (pathname === '/admin') {

        // GET — show the editor
        if (req.method === 'GET') {
            const pass = parsed.query.pass;
            if (pass !== ADMIN_PASS) {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                return res.end(loginPage());
            }
            const code = await getCode();
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(adminPage(code, pass));
        }

        // POST — save new code
        if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                const params   = new URLSearchParams(body);
                const pass     = params.get('pass');
                const newCode  = params.get('code') ?? '';

                if (pass !== ADMIN_PASS) {
                    res.writeHead(403);
                    return res.end('Forbidden');
                }

                await saveCode(newCode);
                res.writeHead(302, { Location: `/admin?pass=${pass}&saved=1` });
                res.end();
            });
            return;
        }
    }

    res.writeHead(404);
    res.end('Not found');
});

// ─── HTML Pages ────────────────────────────────────────────────────────────────
function loginPage() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Lucid Menu — Admin</title>
<link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Rajdhani:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0a0a0f;
    --panel: #111118;
    --border: #eb000033;
    --accent: #eb0000;
    --accent2: #ff4444;
    --text: #e8e8f0;
    --muted: #555566;
    --mono: 'Share Tech Mono', monospace;
    --sans: 'Rajdhani', sans-serif;
  }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--sans);
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  body::before {
    content: '';
    position: fixed;
    inset: 0;
    background:
      repeating-linear-gradient(0deg, transparent, transparent 40px, #eb000008 40px, #eb000008 41px),
      repeating-linear-gradient(90deg, transparent, transparent 40px, #eb000008 40px, #eb000008 41px);
    pointer-events: none;
  }
  .box {
    background: var(--panel);
    border: 1px solid var(--border);
    padding: 48px 40px;
    width: 380px;
    position: relative;
    box-shadow: 0 0 60px #eb000022, inset 0 0 40px #eb000008;
  }
  .box::before {
    content: '';
    position: absolute;
    top: -1px; left: 20px; right: 20px; height: 2px;
    background: var(--accent);
    box-shadow: 0 0 20px var(--accent);
  }
  .logo {
    font-family: var(--sans);
    font-weight: 700;
    font-size: 28px;
    letter-spacing: 4px;
    text-transform: uppercase;
    color: var(--accent);
    text-shadow: 0 0 20px var(--accent);
    margin-bottom: 8px;
  }
  .sub {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
    letter-spacing: 2px;
    text-transform: uppercase;
    margin-bottom: 36px;
  }
  label {
    display: block;
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 2px;
    color: var(--muted);
    text-transform: uppercase;
    margin-bottom: 8px;
  }
  input[type=password] {
    width: 100%;
    background: #0d0d14;
    border: 1px solid #eb000033;
    color: var(--text);
    font-family: var(--mono);
    font-size: 14px;
    padding: 12px 16px;
    outline: none;
    transition: border-color .2s, box-shadow .2s;
  }
  input[type=password]:focus {
    border-color: var(--accent);
    box-shadow: 0 0 16px #eb000033;
  }
  button {
    width: 100%;
    margin-top: 20px;
    background: var(--accent);
    color: #fff;
    border: none;
    font-family: var(--sans);
    font-weight: 700;
    font-size: 14px;
    letter-spacing: 3px;
    text-transform: uppercase;
    padding: 14px;
    cursor: pointer;
    transition: background .2s, box-shadow .2s;
  }
  button:hover {
    background: var(--accent2);
    box-shadow: 0 0 24px #eb000066;
  }
</style>
</head>
<body>
<div class="box">
  <div class="logo">LUCID</div>
  <div class="sub">Menu Admin Panel</div>
  <form method="GET" action="/admin">
    <label>Admin Password</label>
    <input type="password" name="pass" placeholder="••••••••••" autofocus>
    <button type="submit">ACCESS</button>
  </form>
</div>
</body>
</html>`;
}

function adminPage(code, pass, saved) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Lucid Menu — Editor</title>
<link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Rajdhani:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0a0a0f;
    --panel: #111118;
    --border: #eb000033;
    --accent: #eb0000;
    --accent2: #ff4444;
    --text: #e8e8f0;
    --muted: #555566;
    --green: #00ff88;
    --mono: 'Share Tech Mono', monospace;
    --sans: 'Rajdhani', sans-serif;
  }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--sans);
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  body::before {
    content: '';
    position: fixed;
    inset: 0;
    background:
      repeating-linear-gradient(0deg, transparent, transparent 40px, #eb000006 40px, #eb000006 41px),
      repeating-linear-gradient(90deg, transparent, transparent 40px, #eb000006 40px, #eb000006 41px);
    pointer-events: none;
    z-index: 0;
  }
  header {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 28px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    box-shadow: 0 0 30px #eb000015;
    flex-shrink: 0;
  }
  .logo {
    font-weight: 700;
    font-size: 22px;
    letter-spacing: 5px;
    text-transform: uppercase;
    color: var(--accent);
    text-shadow: 0 0 16px var(--accent);
  }
  .logo span { color: var(--text); }
  .endpoint {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--muted);
    background: #0d0d14;
    border: 1px solid var(--border);
    padding: 6px 14px;
  }
  .endpoint b { color: var(--green); }
  .actions { display: flex; gap: 10px; align-items: center; }
  .saved-badge {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--green);
    letter-spacing: 2px;
    text-transform: uppercase;
    animation: fadeout 3s forwards;
  }
  @keyframes fadeout { 0%,70%{opacity:1} 100%{opacity:0} }
  .btn {
    background: var(--accent);
    color: #fff;
    border: none;
    font-family: var(--sans);
    font-weight: 700;
    font-size: 13px;
    letter-spacing: 3px;
    text-transform: uppercase;
    padding: 10px 24px;
    cursor: pointer;
    transition: background .2s, box-shadow .2s;
  }
  .btn:hover { background: var(--accent2); box-shadow: 0 0 20px #eb000055; }
  .editor-wrap {
    position: relative;
    z-index: 1;
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 20px 28px;
    gap: 12px;
    overflow: hidden;
  }
  .editor-label {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 2px;
    color: var(--muted);
    text-transform: uppercase;
    display: flex;
    justify-content: space-between;
  }
  .editor-label span { color: var(--green); }
  textarea {
    flex: 1;
    background: #0c0c13;
    border: 1px solid var(--border);
    color: #c8f0a0;
    font-family: var(--mono);
    font-size: 13px;
    line-height: 1.6;
    padding: 20px;
    resize: none;
    outline: none;
    transition: border-color .2s, box-shadow .2s;
    tab-size: 4;
  }
  textarea:focus {
    border-color: #eb000066;
    box-shadow: 0 0 20px #eb000022, inset 0 0 20px #eb000008;
  }
  .footer {
    flex-shrink: 0;
    position: relative;
    z-index: 1;
    padding: 10px 28px;
    border-top: 1px solid var(--border);
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
    display: flex;
    justify-content: space-between;
  }
  #linecount { color: var(--accent); }
</style>
</head>
<body>
<header>
  <div class="logo">LUCID<span> MENU</span></div>
  <div class="endpoint">MachoWebRequest(<b>"https://lucidluav2.up.railway.app/LucidMenu"</b>)</div>
  <div class="actions">
    ${saved ? '<span class="saved-badge">✓ SAVED</span>' : ''}
    <form method="POST" action="/admin" style="display:inline">
      <input type="hidden" name="pass" value="${pass}">
      <textarea name="code" id="hidden_code" style="display:none"></textarea>
      <button type="button" class="btn" onclick="submitForm()">SAVE &amp; DEPLOY</button>
    </form>
  </div>
</header>
<div class="editor-wrap">
  <div class="editor-label">
    <span>LucidMenu.lua</span>
    <span id="linecount">0 lines</span>
  </div>
  <textarea id="editor" spellcheck="false" autocorrect="off" autocapitalize="off">${escapeHtml(code)}</textarea>
</div>
<div class="footer">
  <span>TAB KEY SUPPORTED &nbsp;•&nbsp; CHANGES GO LIVE INSTANTLY ON SAVE</span>
  <span id="charcount">0 chars</span>
</div>
<script>
  const editor = document.getElementById('editor');
  const linecount = document.getElementById('linecount');
  const charcount = document.getElementById('charcount');

  function updateCounts() {
    const lines = editor.value.split('\\n').length;
    linecount.textContent = lines + ' lines';
    charcount.textContent = editor.value.length + ' chars';
  }
  editor.addEventListener('input', updateCounts);
  updateCounts();

  // Tab key support
  editor.addEventListener('keydown', function(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = this.selectionStart;
      const end   = this.selectionEnd;
      this.value  = this.value.substring(0, start) + '    ' + this.value.substring(end);
      this.selectionStart = this.selectionEnd = start + 4;
      updateCounts();
    }
  });

  function submitForm() {
    document.getElementById('hidden_code').value = editor.value;
    document.getElementById('hidden_code').form.submit();
  }
</script>
</body>
</html>`;
}

function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Boot ──────────────────────────────────────────────────────────────────────
initDb().then(() => {
    server.listen(PORT, () => {
        console.log(`[MenuServer] Running at http://0.0.0.0:${PORT}/LucidMenu`);
        console.log(`[MenuServer] Admin panel at http://0.0.0.0:${PORT}/admin`);
    });
}).catch(err => {
    console.error('[MenuServer] Failed to init DB:', err);
    process.exit(1);
});
