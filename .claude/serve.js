// Static server + local Tool Bridge for Agent Playground (no deps).
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ROOT_REAL = fs.realpathSync(ROOT);
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

const TOOL_HANDLERS = {
  list_dir: listDir,
  read_file: readFile,
  search_files: searchFiles,
  write_file: writeFile,
  patch_file: patchFile,
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
