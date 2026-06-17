// model-hub.jsx — HuggingFace model search, download, local model management.
// Exports: ModelHubView

const HF_API = 'https://huggingface.co';

// ── helpers ────────────────────────────────────────────────────────────────────
function hfFetch(path, hub, init = {}) {
  const base = (hub.proxyUrl || HF_API).replace(/\/$/, '');
  return fetch(base + path, { signal: AbortSignal.timeout(12000), ...init });
}

function fmtSize(mb) {
  if (!mb) return '?';
  if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
  return Math.round(mb) + ' MB';
}

function fmtNum(n) {
  if (!n) return null;
  if (n >= 1000) return (n / 1000).toFixed(0) + 'k';
  return String(n);
}

// ── Search Panel ───────────────────────────────────────────────────────────────
function SearchPanel({ hub, backendBase, onRefresh }) {
  const [q, setQ] = React.useState('');
  const [results, setResults] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const [dlState, setDlState] = React.useState({}); // repo_id → 'downloading'|'done'|'error'

  const search = async () => {
    const query = q.trim();
    if (!query) return;
    setLoading(true); setErr(null);
    try {
      let data;
      if (hub.httpProxy) {
        // Route through backend so the HTTP proxy is applied server-side
        const r = await fetch(backendBase + '/api/hub/search', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query, http_proxy: hub.httpProxy, hf_endpoint: hub.proxyUrl || '', limit: 24 }),
          signal: AbortSignal.timeout(20000),
        });
        if (!r.ok) throw new Error(`Backend search failed (${r.status}) — is /api/hub/search implemented?`);
        data = await r.json();
      } else {
        const r = await hfFetch(
          `/api/models?search=${encodeURIComponent(query)}&limit=24&sort=downloads&direction=-1&full=false`,
          hub
        );
        if (!r.ok) throw new Error(`HuggingFace API returned ${r.status}`);
        data = await r.json();
      }
      setResults(data);
    } catch (e) {
      setErr(e.message);
      setResults([]);
    }
    setLoading(false);
  };

  const download = async (model) => {
    setDlState((d) => ({ ...d, [model.id]: 'downloading' }));
    try {
      const r = await fetch(backendBase + '/api/hub/download', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          repo_id: model.id,
          hf_endpoint: hub.proxyUrl || '',
          http_proxy: hub.httpProxy || '',
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new Error(t || `Backend ${r.status}`);
      }
      setDlState((d) => ({ ...d, [model.id]: 'done' }));
      onRefresh();
    } catch (e) {
      console.warn('Download error', e.message);
      setDlState((d) => ({ ...d, [model.id]: 'error:' + e.message }));
    }
  };

  return (
    <section className="hub-section">
      <div className="hub-search-row">
        <input className="inp hub-q" placeholder="Search HuggingFace models… (e.g. Qwen3, phi-4, llama)"
          value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()} />
        <button className="btn primary sm" onClick={search} disabled={loading}>
          {loading ? '…' : '🔍'}
        </button>
      </div>
      {err && (
        <div className="hub-err">
          ⚠ {err}
          {!hub.proxyUrl && <span className="hub-err-hint"> — set a proxy URL below if HuggingFace is blocked</span>}
        </div>
      )}
      {results.length > 0 && (
        <div className="hub-results">
          {results.map((m) => {
            const dl = dlState[m.id] || '';
            const isDownloading = dl === 'downloading';
            const isDone = dl === 'done';
            const isError = dl.startsWith('error:');
            return (
              <div key={m.id} className="hub-result-row">
                <div className="hub-result-info">
                  <a className="hub-result-id"
                    href={`${hub.proxyUrl || HF_API}/${m.id}`} target="_blank" rel="noreferrer">
                    {m.id}
                  </a>
                  <div className="hub-result-meta">
                    {fmtNum(m.downloads) && <span title="Downloads">↓ {fmtNum(m.downloads)}</span>}
                    {fmtNum(m.likes) && <span title="Likes">♥ {fmtNum(m.likes)}</span>}
                    {(m.tags || []).filter((t) => !['transformers','pytorch'].includes(t)).slice(0, 4).map((t) => (
                      <span key={t} className="hub-tag">{t}</span>
                    ))}
                  </div>
                  {isError && <div className="hub-dl-err">✕ {dl.slice(6)}</div>}
                </div>
                <button
                  className={'btn sm hub-dl-btn' + (isDone ? ' ghost' : '')}
                  disabled={isDownloading || isDone}
                  onClick={() => download(m)}>
                  {isDownloading ? '⏳ Downloading…' : isDone ? '✓ Done' : isError ? '↺ Retry' : '⬇ Download'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Download Progress Panel ────────────────────────────────────────────────────
function DownloadProgress({ backendBase }) {
  const [status, setStatus] = React.useState(null);

  React.useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch(backendBase + '/api/hub/download/status', { signal: AbortSignal.timeout(4000) });
        if (r.ok) setStatus(await r.json());
      } catch {}
    };
    poll();
    const id = setInterval(poll, 2500);
    return () => clearInterval(id);
  }, [backendBase]);

  if (!status || status.status === 'idle' || status.status === 'done') return null;

  const pct = status.progress != null ? Math.round(status.progress * 100) : null;
  return (
    <div className="hub-dl-progress">
      <span className="hub-dl-spinner">⏳</span>
      <span className="hub-dl-model">{status.model || 'Downloading…'}</span>
      {pct != null && (
        <>
          <div className="hub-dl-bar-wrap"><div className="hub-dl-bar" style={{ width: pct + '%' }} /></div>
          <span className="hub-dl-pct">{pct}%</span>
        </>
      )}
      {status.speed && <span className="hub-dl-speed">{status.speed}</span>}
    </div>
  );
}

// ── Local Models Panel ─────────────────────────────────────────────────────────
function LocalModelsPanel({ backendBase, hub, onUseModel, refreshKey }) {
  const [models, setModels] = React.useState([]);
  const [chatStatus, setChatStatus] = React.useState(null);
  const [loadingPath, setLoadingPath] = React.useState(null);
  const [fetching, setFetching] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setFetching(true);
    try {
      const [mr, rr, cr] = await Promise.all([
        fetch(backendBase + '/api/models', { signal: AbortSignal.timeout(5000) }).then((r) => r.ok ? r.json() : []).catch(() => []),
        fetch(backendBase + '/api/runs',   { signal: AbortSignal.timeout(5000) }).then((r) => r.ok ? r.json() : []).catch(() => []),
        fetch(backendBase + '/api/chat/status', { signal: AbortSignal.timeout(5000) }).then((r) => r.ok ? r.json() : null).catch(() => null),
      ]);
      const merged = rr.filter((r) => r.kind === 'merged').map((r) => ({
        name: r.name, path: r.merged_path || r.path, size_mb: r.size_mb, isMerged: true,
      }));
      setModels([...mr.map((m) => ({ ...m, isMerged: false })), ...merged]);
      setChatStatus(cr);
    } catch {}
    setFetching(false);
  }, [backendBase]);

  React.useEffect(() => { refresh(); }, [refresh, refreshKey]);

  const loadModel = async (m) => {
    setLoadingPath(m.path);
    try {
      const r = await fetch(backendBase + '/api/chat/load', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model_path: m.path, use_4bit: true, trust_remote_code: true }),
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) throw new Error(`Load failed: ${r.status}`);
      await refresh();
    } catch (e) { alert(e.message); }
    setLoadingPath(null);
  };

  const unload = async () => {
    try { await fetch(backendBase + '/api/chat/unload', { method: 'POST' }); await refresh(); } catch {}
  };

  const loadedPath = chatStatus?.model_path;
  const chatState = chatStatus?.state || 'unloaded';

  return (
    <section className="hub-section">
      <div className="hub-sec-hd">
        <span>Local Models</span>
        <button className="btn sm ghost" onClick={refresh} disabled={fetching}>↺ Refresh</button>
      </div>

      {loadedPath && (
        <div className="hub-loaded-bar">
          <span className={'hub-chat-dot ' + chatState} />
          <span><b>{loadedPath.split(/[\\/]/).pop()}</b> — {chatState}</span>
          {chatState === 'ready' && <button className="btn sm ghost" onClick={unload}>⬇ Unload</button>}
        </div>
      )}

      {models.length === 0 && !fetching && (
        <div className="hub-empty">No local models found. Download one above or check the backend is running at <code>{backendBase}</code>.</div>
      )}

      <div className="hub-model-grid">
        {models.map((m) => {
          const isLoaded = loadedPath === m.path;
          const isLoading = loadingPath === m.path;
          return (
            <div key={m.path} className={'hub-model-card' + (isLoaded ? ' loaded' : '') + (m.isMerged ? ' merged' : '')}>
              <div className="hub-model-name">{m.name}</div>
              <div className="hub-model-size">{fmtSize(m.size_mb)}</div>
              {m.isMerged && <span className="hub-badge">LoRA merged</span>}
              <div className="hub-model-acts">
                <button className="btn sm"
                  disabled={isLoading || chatState === 'loading' || isLoaded}
                  onClick={() => loadModel(m)}>
                  {isLoading ? '⏳' : isLoaded ? '✓ Loaded' : '⬆ Load'}
                </button>
                <button className="btn sm ghost" onClick={() => onUseModel(m, hub)}>
                  Use in agent
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Config Panel ───────────────────────────────────────────────────────────────
function HubConfig({ hub, set }) {
  return (
    <section className="hub-section hub-cfg">
      <div className="hub-sec-hd"><span>Configuration</span></div>

      <div className="hub-cfg-grid">
        <div className="hub-cfg-group">
          <label className="hub-cfg-label">HTTP proxy (for backend downloads)</label>
          <input className="inp" placeholder="http://127.0.0.1:3128"
            value={hub.httpProxy || ''}
            onChange={(e) => set({ httpProxy: e.target.value.trim() })} />
          <p className="note">Forwarded to the backend as <code>http_proxy</code> / <code>https_proxy</code> for all HuggingFace download requests. The backend must accept and apply this field.</p>
        </div>

        <div className="hub-cfg-group">
          <label className="hub-cfg-label">HuggingFace mirror URL</label>
          <input className="inp" placeholder="https://hf-mirror.com  (blank = huggingface.co)"
            value={hub.proxyUrl || ''}
            onChange={(e) => set({ proxyUrl: e.target.value.trim() })} />
          <p className="note">Replaces huggingface.co for in-browser model search. Use for CDN mirrors, not HTTP proxies.</p>
        </div>

        <div className="hub-cfg-group">
          <label className="hub-cfg-label">Backend URL (lora-finetune server)</label>
          <input className="inp" placeholder="http://localhost:8000"
            value={hub.backendUrl || ''}
            onChange={(e) => set({ backendUrl: e.target.value.trim() })} />
          <p className="note">Handles downloads, model loading, and LoRA training.</p>
        </div>

        <div className="hub-cfg-group">
          <label className="hub-cfg-label">Local inference server URL</label>
          <input className="inp" placeholder="http://localhost:1234/v1"
            value={hub.localServerUrl || ''}
            onChange={(e) => set({ localServerUrl: e.target.value.trim() })} />
          <p className="note">OpenAI-compatible endpoint for agents set to <em>Local</em> provider (llama.cpp, Ollama, etc.).</p>
        </div>
      </div>
    </section>
  );
}

// ── Backend Status Bar ─────────────────────────────────────────────────────────
function BackendStatus({ backendBase }) {
  const [sys, setSys] = React.useState(null);
  const [ok, setOk] = React.useState(null); // null | 'checking' | 'ok' | 'fail'

  React.useEffect(() => {
    const probe = async () => {
      setOk('checking');
      try {
        const r = await fetch(backendBase + '/api/system', { signal: AbortSignal.timeout(4000) });
        if (r.ok) { setSys(await r.json()); setOk('ok'); }
        else { setSys(null); setOk('fail'); }
      } catch { setSys(null); setOk('fail'); }
    };
    probe();
  }, [backendBase]);

  const gpu = sys?.gpu;
  return (
    <div className="hub-status-bar">
      <span className={'hub-status-pill ' + (ok || 'idle')}>
        <i />
        {ok === 'ok' ? 'backend online' : ok === 'fail' ? 'backend offline' : ok === 'checking' ? 'checking…' : '—'}
      </span>
      {gpu?.available && (
        <>
          <span className="hub-status-sep">·</span>
          <span className="hub-status-info">GPU: {gpu.name}</span>
          <span className="hub-status-sep">·</span>
          <span className="hub-status-info">{Math.round(gpu.used_mb || 0)} / {Math.round(gpu.total_mb || 0)} MB VRAM</span>
        </>
      )}
      {sys?.torch_version && (
        <>
          <span className="hub-status-sep">·</span>
          <span className="hub-status-info">torch {sys.torch_version}</span>
        </>
      )}
    </div>
  );
}

// ── Root View ──────────────────────────────────────────────────────────────────
function ModelHubView() {
  const [s] = useStore();
  const hub = s.settings.hub || {};
  const backendBase = (hub.backendUrl || 'http://localhost:8000').replace(/\/$/, '');

  const setHub = (patch) => Store.set((st) => ({
    ...st, settings: { ...st.settings, hub: { ...(st.settings.hub || {}), ...patch } },
  }));

  const [refreshKey, setRefreshKey] = React.useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  const useModel = (m, hubCfg) => {
    // Open the first non-locked agent editor pre-filled with this model
    const serverUrl = (hubCfg.localServerUrl || 'http://localhost:1234/v1').replace(/\/$/, '');
    const agent = s.agents.find((a) => !a.locked);
    if (!agent) return;
    Store.updateAgent(agent.id, {
      connection: { ...agent.connection, provider: 'local', model: m.name, baseUrl: serverUrl },
    });
    Store.set({ editing: agent.id });
  };

  return (
    <div className="page hub-page">
      <div className="page-hd">
        <h1><span className="emoji">🤗</span> Model Hub</h1>
        <span className="muted">Search HuggingFace · download · connect to agents</span>
      </div>

      <BackendStatus backendBase={backendBase} />
      <DownloadProgress backendBase={backendBase} />
      <SearchPanel hub={hub} backendBase={backendBase} onRefresh={refresh} />
      <LocalModelsPanel backendBase={backendBase} hub={hub} onUseModel={useModel} refreshKey={refreshKey} />
      <HubConfig hub={hub} set={setHub} />
    </div>
  );
}

Object.assign(window, { ModelHubView });
