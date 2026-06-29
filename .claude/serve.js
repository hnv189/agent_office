// Static server + local Tool Bridge for Agent Playground (no deps).
const http = require('http');
const https = require('https');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { URL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const ROOT_REAL = fs.realpathSync(ROOT);
const AGENT_DIR = path.join(ROOT, '.agent'); // memory / skills / todo state
const PORT = Number(process.env.AGENT_PLAYGROUND_PORT || 4173);
const MAX_BODY = 5 * 1024 * 1024;
const MAX_READ_BYTES = 1024 * 1024;
const MAX_SEARCH_FILES = 2500;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.DS_Store']);
const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz',
  '.tar', '.7z', '.mp3', '.mp4', '.mov', '.woff', '.woff2', '.ttf', '.otf',
  '.wasm', '.sqlite', '.db', '.bin', '.exe', '.dmg',
]);
const TYPES = {
  '.html': 'text/html', '.jsx': 'text/babel', '.js': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.md': 'text/markdown',
  '.png': 'image/png', '.svg': 'image/svg+xml',
};

function corsHeaders(extra = {}) {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    ...extra,
  };
}

function sendJson(res, status, data) {
  res.writeHead(status, corsHeaders({ 'content-type': 'application/json' }));
  res.end(JSON.stringify(data));
}

function relPath(abs) {
  return path.relative(ROOT_REAL, abs).split(path.sep).join('/') || '.';
}

function insideRoot(abs) {
  return abs === ROOT_REAL || abs.startsWith(ROOT_REAL + path.sep);
}

function resolveLexical(input = '.') {
  const raw = String(input || '.');
  const abs = path.resolve(ROOT, raw);
  if (!(abs === ROOT || abs.startsWith(ROOT + path.sep))) {
    throw new Error(`Path escapes workspace: ${raw}`);
  }
  return abs;
}

async function assertRealInside(abs, { forWrite = false } = {}) {
  let probe = abs;
  try {
    const st = await fsp.lstat(abs);
    if (forWrite && st.isSymbolicLink()) throw new Error('Refusing to write through a symlink');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    probe = path.dirname(abs);
  }
  const real = await fsp.realpath(probe);
  if (!insideRoot(real)) throw new Error(`Resolved path escapes workspace: ${relPath(real)}`);
  return abs;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJson(req) {
  const text = await readBody(req);
  return text ? JSON.parse(text) : {};
}

function globToRegex(glob) {
  if (!glob) return null;
  const escaped = String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp('^' + escaped + '$', 'i');
}

function safeRegex(pattern) {
  try { return new RegExp(String(pattern), 'i'); }
  catch {
    return new RegExp(String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
}

function looksBinary(buf, ext) {
  if (BINARY_EXTS.has(String(ext || '').toLowerCase())) return true;
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

async function listDir(args) {
  const abs = await assertRealInside(resolveLexical(args.path || '.'));
  const st = await fsp.stat(abs);
  if (!st.isDirectory()) throw new Error('Path is not a directory');
  const limit = Math.max(1, Math.min(500, Number(args.limit || 120)));
  const entries = await fsp.readdir(abs, { withFileTypes: true });
  const rows = [];
  for (const ent of entries.slice().sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  }).slice(0, limit)) {
    if (ent.isSymbolicLink()) continue;
    const fp = path.join(abs, ent.name);
    const est = await fsp.stat(fp).catch(() => null);
    rows.push({
      name: ent.name,
      path: relPath(fp),
      type: ent.isDirectory() ? 'directory' : 'file',
      size: est?.size || 0,
      modifiedMs: est?.mtimeMs || 0,
    });
  }
  return { ok: true, path: relPath(abs), entries: rows, truncated: entries.length > limit };
}

async function readFile(args) {
  if (!args.path) throw new Error('path is required');
  const abs = await assertRealInside(resolveLexical(args.path));
  const st = await fsp.stat(abs);
  if (!st.isFile()) throw new Error('Path is not a file');
  if (st.size > MAX_READ_BYTES) throw new Error(`File is too large (${st.size} bytes). Use search_files or a smaller file.`);
  const buf = await fsp.readFile(abs);
  if (looksBinary(buf, path.extname(abs))) throw new Error('Refusing to read binary file');
  const lines = buf.toString('utf8').split(/\r?\n/);
  const offset = Math.max(1, Number(args.offset || 1));
  const limit = Math.max(1, Math.min(1200, Number(args.limit || 300)));
  const end = Math.min(lines.length, offset + limit - 1);
  const content = lines.slice(offset - 1, end)
    .map((line, i) => `${offset + i}|${line}`)
    .join('\n');
  return {
    ok: true,
    path: relPath(abs),
    content,
    totalLines: lines.length,
    truncated: end < lines.length,
    nextOffset: end < lines.length ? end + 1 : null,
  };
}

async function walkFiles(rootAbs, visitor) {
  let seen = 0;
  async function walk(dir) {
    if (++seen > MAX_SEARCH_FILES) return;
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const ent of entries) {
      if (SKIP_DIRS.has(ent.name) || ent.isSymbolicLink()) continue;
      const fp = path.join(dir, ent.name);
      if (ent.isDirectory()) await walk(fp);
      else if (ent.isFile()) await visitor(fp);
    }
  }
  await walk(rootAbs);
}

async function searchFiles(args) {
  if (!args.pattern) throw new Error('pattern is required');
  const rootAbs = await assertRealInside(resolveLexical(args.path || '.'));
  const st = await fsp.stat(rootAbs);
  if (!st.isDirectory()) throw new Error('Search path must be a directory');
  const target = args.target || 'content';
  const limit = Math.max(1, Math.min(200, Number(args.limit || 50)));
  const fileGlob = globToRegex(args.file_glob);
  const patternText = String(args.pattern);
  const contentRe = safeRegex(patternText);
  const fileRe = globToRegex(patternText.includes('*') ? patternText : `*${patternText}*`);
  const results = [];

  await walkFiles(rootAbs, async (fp) => {
    if (results.length >= limit) return;
    const rp = relPath(fp);
    if (fileGlob && !fileGlob.test(path.basename(fp))) return;
    if (target === 'files') {
      if (fileRe.test(path.basename(fp)) || fileRe.test(rp)) results.push({ path: rp });
      return;
    }
    if (BINARY_EXTS.has(path.extname(fp).toLowerCase())) return;
    const st = await fsp.stat(fp).catch(() => null);
    if (!st || st.size > MAX_READ_BYTES) return;
    const buf = await fsp.readFile(fp).catch(() => null);
    if (!buf || looksBinary(buf, path.extname(fp))) return;
    const lines = buf.toString('utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length && results.length < limit; i++) {
      if (contentRe.test(lines[i])) {
        results.push({ path: rp, line: i + 1, text: lines[i].slice(0, 500) });
      }
    }
  });
  return { ok: true, target, pattern: patternText, results, truncated: results.length >= limit };
}

async function writeFile(args) {
  if (!args.path) throw new Error('path is required');
  if (typeof args.content !== 'string') throw new Error('content must be a string');
  const abs = await assertRealInside(resolveLexical(args.path), { forWrite: true });
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, args.content, 'utf8');
  return { ok: true, path: relPath(abs), bytes: Buffer.byteLength(args.content, 'utf8') };
}

async function patchFile(args) {
  if (!args.path) throw new Error('path is required');
  if (typeof args.old_string !== 'string') throw new Error('old_string must be a string');
  if (typeof args.new_string !== 'string') throw new Error('new_string must be a string');
  const abs = await assertRealInside(resolveLexical(args.path), { forWrite: true });
  const text = await fsp.readFile(abs, 'utf8');
  const count = text.split(args.old_string).length - 1;
  if (count === 0) throw new Error('old_string not found');
  if (!args.replace_all && count > 1) throw new Error(`old_string matched ${count} times; set replace_all=true or add more context`);
  const next = args.replace_all ? text.split(args.old_string).join(args.new_string) : text.replace(args.old_string, args.new_string);
  await fsp.writeFile(abs, next, 'utf8');
  return { ok: true, path: relPath(abs), replacements: args.replace_all ? count : 1 };
}

// ── Terminal (capability: shell) ───────────────────────────────────────────
function runChild(file, fnArgs, { cwd, timeout, input } = {}) {
  return new Promise((resolve) => {
    const child = execFile(file, fnArgs, {
      cwd: cwd || ROOT,
      timeout: timeout || 30000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        code: err && typeof err.code === 'number' ? err.code : (err ? 1 : 0),
        stdout: String(stdout || '').slice(0, 60000),
        stderr: String(stderr || '').slice(0, 20000),
        timedOut: !!(err && err.killed),
      });
    });
    if (input != null) { try { child.stdin.end(input); } catch {} }
  });
}

async function runTerminal(args) {
  if (!args.command) throw new Error('command is required');
  const cwd = await assertRealInside(resolveLexical(args.cwd || '.'));
  const timeout = Math.max(1000, Math.min(120000, Number(args.timeout_ms || 30000)));
  const res = await runChild('bash', ['-lc', String(args.command)], { cwd, timeout });
  return { ok: res.ok, command: args.command, ...res };
}

// ── Code execution (capability: code.run) ───────────────────────────────────
async function executeCode(args) {
  if (typeof args.code !== 'string' || !args.code.trim()) throw new Error('code is required');
  const lang = (args.language || 'python').toLowerCase();
  const timeout = Math.max(1000, Math.min(120000, Number(args.timeout_ms || 30000)));
  let res;
  if (lang === 'python') {
    res = await runChild('python3', ['-c', args.code], { timeout });
  } else if (lang === 'javascript' || lang === 'js' || lang === 'node') {
    res = await runChild(process.execPath, ['-e', args.code], { timeout });
  } else if (lang === 'bash' || lang === 'sh') {
    res = await runChild('bash', ['-lc', args.code], { timeout });
  } else {
    throw new Error(`Unsupported language: ${lang}`);
  }
  return { ok: res.ok, language: lang, ...res };
}

// ── Web (capability: web.search) ────────────────────────────────────────────
function httpGet(rawUrl, { headers = {}, redirects = 4 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(rawUrl); } catch { return reject(new Error('Invalid URL')); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return reject(new Error('Only http(s) URLs are allowed'));
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, {
      method: 'GET',
      headers: { 'user-agent': 'Mozilla/5.0 (AgentPlayground ToolBridge)', accept: '*/*', ...headers },
      timeout: 15000,
    }, (resp) => {
      const status = resp.statusCode || 0;
      if (status >= 300 && status < 400 && resp.headers.location && redirects > 0) {
        resp.resume();
        const next = new URL(resp.headers.location, u).toString();
        return resolve(httpGet(next, { headers, redirects: redirects - 1 }));
      }
      const chunks = [];
      let size = 0;
      resp.on('data', (c) => { size += c.length; if (size < 4 * 1024 * 1024) chunks.push(c); });
      resp.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8'), contentType: resp.headers['content-type'] || '' }));
    });
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    req.end();
  });
}

function stripHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function webFetch(args) {
  if (!args.url) throw new Error('url is required');
  const maxChars = Math.max(200, Math.min(40000, Number(args.max_chars || 6000)));
  const { status, body, contentType } = await httpGet(args.url);
  const text = /html/i.test(contentType) ? stripHtml(body) : body;
  return { ok: status >= 200 && status < 300, url: args.url, status, contentType, text: text.slice(0, maxChars), truncated: text.length > maxChars };
}

async function webSearch(args) {
  if (!args.query) throw new Error('query is required');
  const limit = Math.max(1, Math.min(15, Number(args.limit || 6)));
  try {
    const { body } = await httpGet('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(args.query));
    const results = [];
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(body)) && results.length < limit) {
      let url = m[1];
      const uddg = url.match(/[?&]uddg=([^&]+)/);
      if (uddg) { try { url = decodeURIComponent(uddg[1]); } catch {} }
      results.push({ title: stripHtml(m[2]).slice(0, 200), url });
    }
    if (!results.length) return { ok: false, query: args.query, results: [], note: 'No results parsed — the search endpoint may be blocked from this network.' };
    return { ok: true, query: args.query, results };
  } catch (e) {
    return { ok: false, query: args.query, results: [], error: e.message, note: 'web_search needs outbound internet from the Tool Bridge host.' };
  }
}

// ── Agent state dir helpers (memory / skills / todo) ────────────────────────
async function ensureAgentDir(sub) {
  const dir = sub ? path.join(AGENT_DIR, sub) : AGENT_DIR;
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}
async function readJsonFile(fp, fallback) {
  try { return JSON.parse(await fsp.readFile(fp, 'utf8')); } catch { return fallback; }
}

// ── Memory (capability: memory) ─────────────────────────────────────────────
async function memoryWrite(args) {
  if (!args.text) throw new Error('text is required');
  await ensureAgentDir();
  const fp = path.join(AGENT_DIR, 'memory.json');
  const mem = await readJsonFile(fp, []);
  const entry = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text: String(args.text), tags: Array.isArray(args.tags) ? args.tags.map(String) : [], ts: Date.now() };
  mem.push(entry);
  await fsp.writeFile(fp, JSON.stringify(mem, null, 2), 'utf8');
  return { ok: true, stored: entry, total: mem.length };
}
async function memorySearch(args) {
  const fp = path.join(AGENT_DIR, 'memory.json');
  const mem = await readJsonFile(fp, []);
  const q = String(args.query || '').toLowerCase();
  const limit = Math.max(1, Math.min(50, Number(args.limit || 10)));
  const hits = mem
    .filter((e) => !q || e.text.toLowerCase().includes(q) || (e.tags || []).some((t) => t.toLowerCase().includes(q)))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit);
  return { ok: true, query: args.query || '', count: hits.length, memories: hits };
}

// ── Skills (capability: skills) — Hermes SKILL.md files ─────────────────────
function slugify(name) { return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 64) || 'skill'; }
async function skillCreate(args) {
  if (!args.name || !args.body) throw new Error('name and body are required');
  const dir = await ensureAgentDir('skills');
  const slug = slugify(args.name);
  const fp = path.join(dir, slug + '.md');
  const front = `---\nname: ${args.name}\ndescription: ${String(args.description || '').replace(/\n/g, ' ')}\n---\n\n`;
  await fsp.writeFile(fp, front + String(args.body), 'utf8');
  return { ok: true, skill: slug, path: relPath(fp) };
}
async function skillList() {
  const dir = await ensureAgentDir('skills');
  const files = (await fsp.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.md'));
  const skills = [];
  for (const f of files) {
    const text = await fsp.readFile(path.join(dir, f), 'utf8').catch(() => '');
    const desc = (text.match(/description:\s*(.*)/) || [])[1] || '';
    skills.push({ name: f.replace(/\.md$/, ''), description: desc.trim() });
  }
  return { ok: true, count: skills.length, skills };
}
async function skillRead(args) {
  if (!args.name) throw new Error('name is required');
  const dir = await ensureAgentDir('skills');
  const fp = path.join(dir, slugify(args.name) + '.md');
  const content = await fsp.readFile(fp, 'utf8').catch(() => null);
  if (content == null) throw new Error(`Skill not found: ${args.name}`);
  return { ok: true, name: args.name, content };
}

// ── Todo (capability: todo) ─────────────────────────────────────────────────
async function todoWrite(args) {
  if (!Array.isArray(args.items)) throw new Error('items must be an array');
  await ensureAgentDir();
  const items = args.items.map((it, i) => ({ id: i + 1, content: String(it.content || ''), status: ['pending', 'in_progress', 'done'].includes(it.status) ? it.status : 'pending' }));
  await fsp.writeFile(path.join(AGENT_DIR, 'todo.json'), JSON.stringify(items, null, 2), 'utf8');
  return { ok: true, count: items.length, items };
}
async function todoRead() {
  const items = await readJsonFile(path.join(AGENT_DIR, 'todo.json'), []);
  return { ok: true, count: items.length, items };
}

// ── Clarify (capability: clarify) ───────────────────────────────────────────
async function clarify(args) {
  if (!args.question) throw new Error('question is required');
  return { ok: true, awaiting_user: true, question: String(args.question) };
}

// ── Vision / media (capability: vision) — best-effort, needs a backend ──────
async function visionAnalyze(args) {
  const base = process.env.VISION_API_BASE || process.env.OPENAI_API_BASE;
  const key = process.env.VISION_API_KEY || process.env.OPENAI_API_KEY;
  if (!base || !key) {
    return { ok: false, error: 'not_configured', note: 'Set VISION_API_BASE and VISION_API_KEY (OpenAI-compatible) env vars on the Tool Bridge to enable vision_analyze.' };
  }
  return { ok: false, error: 'not_implemented', note: 'Vision backend detected via env, but image relay is left to your deployment. Wire visionAnalyze() to your VLM endpoint.' };
}
async function imageGenerate(args) {
  const base = process.env.IMAGE_API_BASE || process.env.OPENAI_API_BASE;
  const key = process.env.IMAGE_API_KEY || process.env.OPENAI_API_KEY;
  if (!base || !key) {
    return { ok: false, error: 'not_configured', note: 'Set IMAGE_API_BASE and IMAGE_API_KEY (OpenAI-compatible) env vars on the Tool Bridge to enable image_generate.' };
  }
  return { ok: false, error: 'not_implemented', note: 'Image backend detected via env, but generation relay is left to your deployment. Wire imageGenerate() to your image endpoint.' };
}

const TOOL_HANDLERS = {
  // file
  list_dir: listDir,
  read_file: readFile,
  search_files: searchFiles,
  write_file: writeFile,
  patch_file: patchFile,
  // terminal + code
  run_terminal: runTerminal,
  execute_code: executeCode,
  // web
  web_search: webSearch,
  web_fetch: webFetch,
  // memory
  memory_write: memoryWrite,
  memory_search: memorySearch,
  // skills
  skill_create: skillCreate,
  skill_list: skillList,
  skill_read: skillRead,
  // todo
  todo_write: todoWrite,
  todo_read: todoRead,
  // clarify
  clarify: clarify,
  // vision / media
  vision_analyze: visionAnalyze,
  image_generate: imageGenerate,
};

async function handleApi(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    return res.end();
  }
  if (req.method === 'GET' && req.url.split('?')[0] === '/api/tools/status') {
    return sendJson(res, 200, {
      ok: true,
      workspaceRoot: ROOT_REAL,
      tools: Object.keys(TOOL_HANDLERS),
    });
  }
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/tools/call') {
    try {
      const body = await readJson(req);
      const name = body.name;
      const handler = TOOL_HANDLERS[name];
      if (!handler) return sendJson(res, 404, { error: `Unknown tool: ${name}` });
      const result = await handler(body.args || {});
      return sendJson(res, 200, result);
    } catch (e) {
      return sendJson(res, 400, { error: e.message || 'tool failed' });
    }
  }
  return false;
}

function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/Agent Playground.html';
  const fp = path.join(ROOT, rel);
  if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    const handled = await handleApi(req, res);
    if (handled !== false) return;
  }
  serveStatic(req, res);
}).listen(PORT, () => {
  console.log('serving ' + ROOT + ' on http://localhost:' + PORT);
  console.log('tool bridge workspace: ' + ROOT_REAL);
});
