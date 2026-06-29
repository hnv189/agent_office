// editor.jsx — slide-in drawers: per-agent customization + global Settings.
// Exports: EditorDrawer, SettingsDrawer.

function Field({ label, hint, children }) {
  return (
    <label className="fld">
      <span className="fld-l">{label}{hint && <em>{hint}</em>}</span>
      {children}
    </label>
  );
}

function Drawer({ open, title, onClose, children, footer }) {
  return (
    <>
      <div className={'scrim' + (open ? ' on' : '')} onClick={onClose} />
      <aside className={'drawer' + (open ? ' on' : '')} role="dialog" aria-label={title}>
        <header className="drawer-hd">
          <b>{title}</b>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="drawer-body">{children}</div>
        {footer && <footer className="drawer-ft">{footer}</footer>}
      </aside>
    </>
  );
}

const SWATCHES = ['#a06bff', '#4d7cff', '#2ee6a6', '#ff4d6d', '#ff5cae', '#ffd23f', '#ff9b4d', '#5cc8ff'];

function LocalModelPicker({ conn, settings, onModel }) {
  const hub = (settings && settings.hub) || {};
  const backendBase = (hub.backendUrl || 'http://localhost:8000').replace(/\/$/, '');
  const [models, setModels] = React.useState([]);

  React.useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const [mr, rr] = await Promise.all([
          fetch(backendBase + '/api/models', { signal: AbortSignal.timeout(5000) }).then((r) => r.ok ? r.json() : []).catch(() => []),
          fetch(backendBase + '/api/runs',   { signal: AbortSignal.timeout(5000) }).then((r) => r.ok ? r.json() : []).catch(() => []),
        ]);
        const merged = rr.filter((r) => r.kind === 'merged').map((r) => ({ name: r.name, path: r.merged_path || r.path }));
        if (live) setModels([...mr.map((m) => ({ name: m.name, path: m.path })), ...merged]);
      } catch {}
    };
    load();
    return () => { live = false; };
  }, [backendBase]);

  return (
    <label className="fld">
      <span className="fld-l">Model</span>
      {models.length > 0
        ? (
          <select className="inp" value={conn.model || ''} onChange={(e) => onModel(e.target.value)}>
            <option value="">— pick a model —</option>
            {models.map((m) => <option key={m.path} value={m.name}>{m.name}</option>)}
          </select>
        )
        : <input className="inp" value={conn.model || ''} placeholder="model name" onChange={(e) => onModel(e.target.value)} />
      }
    </label>
  );
}

function EditorDrawer() {
  const [s] = useStore();
  const id = s.editing;
  const agent = s.agents.find((a) => a.id === id);
  const [test, setTest] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { setTest(null); }, [id]);
  if (!agent) return <Drawer open={false} title="" onClose={() => {}} />;
  const up = (patch) => Store.updateAgent(agent.id, patch);
  const conn = agent.connection;
  const close = () => Store.set({ editing: null });

  const runNow = async () => {
    setBusy(true); setTest('…thinking');
    Store.updateAgent(agent.id, { status: 'active', action: 'on it!' });
    const out = await callModel(agent, 'Introduce yourself and your job in one short sentence.', { settings: s.settings, liveMode: s.liveMode });
    setTest(out); setBusy(false);
    Store.updateAgent(agent.id, { lastRunMs: Date.now() });
    Store.log(`${agent.name}: ${String(out).slice(0, 60)}`, agent.color);
  };

  const toggleTool = (t) => up((a) => ({ tools: a.tools.includes(t) ? a.tools.filter((x) => x !== t) : [...a.tools, t] }));

  return (
    <Drawer open={!!id} title="Edit Agent" onClose={close}
      footer={(
        <div className="ft-row">
          {agent.locked
            ? <span className="lock-pill" title="V-Model agents are kept to preserve the coding pipeline">🔒 V-Model agent</span>
            : <button className="btn ghost danger" onClick={() => { Store.removeAgent(agent.id); close(); }}>Delete</button>}
          <button className="btn primary" onClick={runNow} disabled={busy} style={{ '--accent': agent.color }}>{busy ? 'Running…' : '▶ Run now'}</button>
        </div>
      )}>
      <div className="ed-hero" style={{ '--theme': agent.color }}>
        <PixelSprite sprite={agent.sprite} color={agent.color} scale={4} mode="walk" speed={1} />
        <div className="ed-hero-meta">
          <input className="ed-name" value={agent.name} onChange={(e) => up({ name: e.target.value })} />
          <span className="muted">{(ROOM_THEMES[agent.roomKey] || {}).label}</span>
        </div>
      </div>

      <Field label="Character">
        <div className="sprite-pick">
          {SPRITE_LIST.map((sp) => (
            <button key={sp.id} className={'sprite-opt' + (agent.sprite === sp.id ? ' on' : '')} onClick={() => up({ sprite: sp.id })} title={sp.label}>
              <PixelSprite sprite={sp.id} color={agent.color} scale={2.4} mode="idle" speed={1} />
              <span>{sp.label}</span>
            </button>
          ))}
        </div>
      </Field>

      <Field label="Sprite colour">
        <div className="swatches">
          {SWATCHES.map((c) => (
            <button key={c} className={'sw' + (agent.color === c ? ' on' : '')} style={{ background: c }} onClick={() => up({ color: c })} />
          ))}
          <input type="color" className="sw-custom" value={agent.color} onChange={(e) => up({ color: e.target.value })} />
        </div>
      </Field>

      <div className="grid2">
        <Field label="Room / environment">
          <select className="inp" value={agent.roomKey} onChange={(e) => up({ roomKey: e.target.value })}>
            {Object.entries(ROOM_THEMES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select className="inp" value={agent.status} onChange={(e) => up({ status: e.target.value })}>
            <option value="active">Active (moving)</option>
            <option value="ondemand">On-demand</option>
            <option value="idle">Idle (ZZZ)</option>
          </select>
        </Field>
      </div>

      <Field label="System prompt" hint={agent.locked ? '🔒 locked · V-Model role' : undefined}>
        <textarea className={'inp ta' + (agent.locked ? ' locked' : '')} rows={4} value={agent.systemPrompt}
          readOnly={agent.locked} disabled={agent.locked}
          onChange={(e) => { if (!agent.locked) up({ systemPrompt: e.target.value }); }} />
        {agent.locked && <p className="lock-note">This agent's role is fixed so the coding pipeline stays consistent. Behaviour improves over time via learned rules and LoRA fine-tuning, not by editing this prompt.</p>}
      </Field>

      {(agent.rules || []).length > 0 && (
        <>
          <div className="sect-l">Learned rules <span className="rules-count">({agent.rules.length} / 20)</span></div>
          <div className="rules-list">
            {agent.rules.map((r) => (
              <div key={r.id} className="rule-row">
                <span className={'rule-src src-' + r.source} title={r.source === 'nova' ? 'Nova diagnosed' : r.source === 'gepa' ? 'GEPA evolved' : 'Manual'}>
                  {r.source === 'nova' ? '◈' : r.source === 'gepa' ? '⟳' : '✎'}
                </span>
                <span className="rule-text">{r.text}</span>
                {r.confirmed && <span className="rule-star" title="High-rated — kept permanently">★</span>}
                <button className="icon-btn rule-del" onClick={() => Store.removeRule(agent.id, r.id)} title="Remove rule">✕</button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="sect-l">Model connection</div>
      <div className="grid2">
        <Field label="Provider">
          <select className="inp" value={conn.provider} onChange={(e) => up({ connection: { ...conn, provider: e.target.value } })}>
            <option value="lmstudio">LM Studio (local)</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="lora">LoRA (fine-tune)</option>
            <option value="local">Local (downloaded)</option>
            <option value="demo">Demo (simulated)</option>
          </select>
        </Field>
        {conn.provider !== 'lora' && conn.provider !== 'local' && (
          <Field label="Model">
            <input className="inp" value={conn.model} onChange={(e) => up({ connection: { ...conn, model: e.target.value } })} />
          </Field>
        )}
        {conn.provider === 'local' && (
          <LocalModelPicker conn={conn} settings={s.settings} onModel={(m) => up({ connection: { ...conn, model: m } })} />
        )}
      </div>
      {conn.provider === 'lora' && (
        <p className="note">Model is loaded globally via Settings → LoRA Backend. All agents set to LoRA share the same loaded model.</p>
      )}
      {conn.provider === 'local' && (
        <p className="note">Uses a locally downloaded model via an OpenAI-compatible server. Manage downloads and server URL in the <b>Model Hub</b> tab.</p>
      )}
      {(conn.provider === 'lmstudio' || conn.provider === 'openai' || conn.provider === 'local') && (
        <Field label="Base URL" hint={conn.provider === 'lmstudio' ? 'LM Studio server' : conn.provider === 'local' ? 'local inference server' : ''}>
          <input className="inp" value={conn.baseUrl || ''} placeholder="http://localhost:1234/v1" onChange={(e) => up({ connection: { ...conn, baseUrl: e.target.value } })} />
        </Field>
      )}
      {(conn.provider === 'openai' || conn.provider === 'anthropic') && (
        <Field label="API key" hint="stored locally only">
          <input className="inp" type="password" value={conn.apiKey || ''} placeholder="sk-…" onChange={(e) => up({ connection: { ...conn, apiKey: e.target.value } })} />
        </Field>
      )}

      <div className="grid2">
        <Field label={`Temperature · ${agent.temperature.toFixed(2)}`}>
          <input type="range" className="range" min={0} max={1.5} step={0.05} value={agent.temperature} onChange={(e) => up({ temperature: Number(e.target.value) })} />
        </Field>
        <Field label="Max tokens">
          <input className="inp" type="number" min={64} step={64} value={agent.maxTokens} onChange={(e) => up({ maxTokens: Number(e.target.value) })} />
        </Field>
      </div>

      <div className="sect-l">Schedule</div>
      <div className="grid2">
        <Field label="When it runs">
          <select className="inp" value={agent.schedule} onChange={(e) => up({ schedule: e.target.value, status: e.target.value === 'always' ? 'active' : agent.status })}>
            <option value="always">Always on</option>
            <option value="ondemand">On-demand</option>
            <option value="every">Every N hours</option>
          </select>
        </Field>
        {agent.schedule === 'every' && (
          <Field label="Interval (hours)">
            <input className="inp" type="number" min={1} value={agent.everyHours} onChange={(e) => up({ everyHours: Number(e.target.value) })} />
          </Field>
        )}
      </div>

      <Field label="Tools / capabilities">
        <div className="chips">
          {TOOL_LIBRARY.map((t) => (
            <button key={t} className={'chip' + (agent.tools.includes(t) ? ' on' : '')} onClick={() => toggleTool(t)}>{t}</button>
          ))}
        </div>
      </Field>

      {test != null && (
        <div className="test-out" style={{ borderColor: `${agent.color}55` }}>
          <span className="test-l" style={{ color: agent.color }}>● {s.liveMode ? 'LIVE' : 'DEMO'} response</span>
          <p>{test}</p>
        </div>
      )}
    </Drawer>
  );
}

function LoraSettings() {
  const [s] = useStore();
  const cfg = s.settings.lora || {};
  const setLora = (patch) => Store.set((st) => ({
    ...st,
    settings: { ...st.settings, lora: { ...st.settings.lora, ...patch } },
  }));

  const [sysOk, setSysOk] = React.useState(null);
  const [chatSt, setChatSt] = React.useState(null);
  const [models, setModels] = React.useState([]);
  const [busy, setBusy] = React.useState(false);

  const base = (cfg.baseUrl || 'http://localhost:8000').replace(/\/$/, '');

  const probe = React.useCallback(async () => {
    setSysOk('checking');
    try {
      const [sr, cr] = await Promise.all([
        fetch(base + '/api/system', { signal: AbortSignal.timeout(4000) }),
        fetch(base + '/api/chat/status', { signal: AbortSignal.timeout(4000) }),
      ]);
      setSysOk(sr.ok ? 'ok' : 'fail');
      setChatSt(cr.ok ? await cr.json() : null);
    } catch {
      setSysOk('fail');
      setChatSt(null);
    }
  }, [base]);

  const fetchModels = React.useCallback(async () => {
    try {
      const [mr, rr] = await Promise.all([
        fetch(base + '/api/models'),
        fetch(base + '/api/runs'),
      ]);
      const mods = mr.ok ? await mr.json() : [];
      const runs = rr.ok ? await rr.json() : [];
      setModels([
        ...mods.map((m) => ({ name: m.name, path: m.path })),
        ...runs.filter((r) => r.kind === 'merged').map((r) => ({
          name: r.name + ' ✓ merged', path: r.merged_path || r.path,
        })),
      ]);
    } catch {}
  }, [base]);

  React.useEffect(() => { probe(); fetchModels(); }, [base]);

  const loadModel = async () => {
    if (!cfg.modelPath) return;
    setBusy(true);
    try {
      await fetch(base + '/api/chat/load', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model_path: cfg.modelPath, adapter_path: cfg.adapterPath || null, use_4bit: true, trust_remote_code: true }),
      });
      await probe();
    } catch {}
    setBusy(false);
  };

  const unloadModel = async () => {
    setBusy(true);
    try { await fetch(base + '/api/chat/unload', { method: 'POST' }); await probe(); } catch {}
    setBusy(false);
  };

  const chatState = chatSt?.state || 'unloaded';
  const isReady = chatState === 'ready';
  const isLoading = chatState === 'loading';

  return (
    <>
      <div className="sect-l">LoRA Backend</div>
      <Field label="Server URL">
        <input className="inp" value={cfg.baseUrl || ''} placeholder="http://localhost:8000"
          onChange={(e) => setLora({ baseUrl: e.target.value })} />
      </Field>
      <Field label="Dataset name" hint="data/<name>/ on server">
        <input className="inp" value={cfg.dataset || ''} placeholder="agent_office"
          onChange={(e) => setLora({ dataset: e.target.value })} />
      </Field>

      <div className="lora-status-row">
        <div className={`lora-pill ${sysOk || 'idle'}`}>
          <i />
          {sysOk === 'checking' ? 'checking…'
            : sysOk === 'ok' ? 'backend online'
            : sysOk === 'fail' ? 'not reachable'
            : 'not checked'}
        </div>
        <button className="btn sm ghost" onClick={() => { probe(); fetchModels(); }}>↺ Refresh</button>
      </div>

      {sysOk === 'ok' && (
        <>
          <Field label="Model / merged run">
            <select className="inp" value={cfg.modelPath || ''}
              onChange={(e) => setLora({ modelPath: e.target.value })}>
              <option value="">— pick a model —</option>
              {models.map((m) => <option key={m.path} value={m.path}>{m.name}</option>)}
            </select>
          </Field>
          <div className="lora-chat-row">
            <span className={`lora-state-badge ${chatState}`}>{chatState}</span>
            {chatSt?.model_path && (
              <span className="lora-loaded-model">{chatSt.model_path.split(/[\\/]/).pop()}</span>
            )}
          </div>
          <div className="lora-load-row">
            <button className="btn sm" onClick={loadModel}
              disabled={busy || isLoading || !cfg.modelPath}>
              {isLoading ? 'Loading…' : '⬆ Load model'}
            </button>
            <button className="btn sm ghost" onClick={unloadModel}
              disabled={busy || !isReady}>
              ⬇ Unload
            </button>
          </div>
        </>
      )}
    </>
  );
}

function LocalSettings() {
  const [s] = useStore();
  const hub = s.settings.hub || {};
  const backendBase = (hub.backendUrl || 'http://localhost:8000').replace(/\/$/, '');
  const hubBase    = (hub.hubUrl     || 'http://localhost:8001').replace(/\/$/, '');
  const serverUrl  =  hub.localServerUrl || 'http://localhost:1234/v1';

  const setHub = (patch) => Store.set((st) => ({
    ...st, settings: { ...st.settings, hub: { ...(st.settings.hub || {}), ...patch } },
  }));

  const [models, setModels] = React.useState([]); // { name, path, source }
  const [selectedPath, setSelectedPath] = React.useState('');
  const [chatStatus, setChatStatus] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [flash, setFlash] = React.useState('');

  const showFlash = (msg) => { setFlash(msg); setTimeout(() => setFlash(''), 2800); };

  const fetchAll = React.useCallback(async () => {
    const [hubMods, loraMods, loraRuns, chatSt] = await Promise.all([
      fetch(hubBase    + '/api/models',      { signal: AbortSignal.timeout(5000) }).then((r) => r.ok ? r.json() : []).catch(() => []),
      fetch(backendBase + '/api/models',     { signal: AbortSignal.timeout(5000) }).then((r) => r.ok ? r.json() : []).catch(() => []),
      fetch(backendBase + '/api/runs',       { signal: AbortSignal.timeout(5000) }).then((r) => r.ok ? r.json() : []).catch(() => []),
      fetch(backendBase + '/api/chat/status',{ signal: AbortSignal.timeout(5000) }).then((r) => r.ok ? r.json() : null).catch(() => null),
    ]);
    const merged = loraRuns.filter((r) => r.kind === 'merged').map((r) => ({
      name: r.name, path: r.merged_path || r.path, source: 'merged',
    }));
    const all = [
      ...hubMods.map((m) => ({ name: m.name, path: m.path, source: 'hub' })),
      ...loraMods.map((m) => ({ name: m.name, path: m.path, source: 'lora' })),
      ...merged,
    ];
    const seen = new Set();
    setModels(all.filter((m) => { if (seen.has(m.path)) return false; seen.add(m.path); return true; }));
    setChatStatus(chatSt);
  }, [hubBase, backendBase]);

  React.useEffect(() => { fetchAll(); }, [fetchAll]);

  const chatState  = chatStatus?.state || 'unloaded';
  const loadedPath = chatStatus?.model_path || '';
  const selected   = models.find((m) => m.path === selectedPath);
  const isLoaded   = !!loadedPath && loadedPath === selectedPath;

  const loadModel = async () => {
    if (!selectedPath) return;
    setBusy(true);
    try {
      const r = await fetch(backendBase + '/api/chat/load', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model_path: selectedPath, use_4bit: true, trust_remote_code: true }),
        signal: AbortSignal.timeout(60000),
      });
      if (!r.ok) throw new Error(`Load failed: ${r.status}`);
      await fetchAll();
      showFlash('✓ Model loaded');
    } catch (e) { showFlash('✕ ' + e.message); }
    setBusy(false);
  };

  const unloadModel = async () => {
    setBusy(true);
    try {
      await fetch(backendBase + '/api/chat/unload', { method: 'POST', signal: AbortSignal.timeout(15000) });
      await fetchAll();
    } catch {}
    setBusy(false);
  };

  const applyToAgents = (all) => {
    if (!selected) return;
    const url = serverUrl.replace(/\/$/, '');
    Store.set((st) => ({
      ...st,
      agents: st.agents.map((a) => {
        if (!all && a.locked) return a;
        return { ...a, connection: { ...a.connection, provider: 'local', model: selected.name, baseUrl: url } };
      }),
    }));
    showFlash(`✓ Applied to ${all ? 'all' : 'unlocked'} agents`);
  };

  const srcLabel = { hub: '↓ downloaded', lora: 'base model', merged: '✓ merged' };

  return (
    <>
      <div className="sect-l">Local (downloaded models)</div>

      {/* model picker */}
      <label className="fld">
        <span className="fld-l">
          Available models
          <button className="btn sm ghost" style={{ padding: '1px 8px', fontSize: 11 }} onClick={fetchAll}>↺</button>
        </span>
        {models.length > 0
          ? (
            <select className="inp" value={selectedPath} onChange={(e) => setSelectedPath(e.target.value)}>
              <option value="">— select a model —</option>
              {models.map((m) => (
                <option key={m.path} value={m.path}>[{srcLabel[m.source] || m.source}] {m.name}</option>
              ))}
            </select>
          )
          : <p className="note" style={{ margin: 0 }}>No models found. Download one in <b>Model Hub</b>, or check that the hub server and lora-finetune backend are running.</p>
        }
      </label>
      {selected && <p className="note" style={{ marginTop: -8, wordBreak: 'break-all' }}>{selected.path}</p>}

      {/* current load status */}
      {loadedPath && (
        <div className="local-loaded-bar">
          <span className={'local-chat-dot ' + chatState} />
          <span className="local-loaded-name">{loadedPath.split(/[\\/]/).pop()}</span>
          <span className="local-chat-state">{chatState}</span>
        </div>
      )}

      {/* load / unload controls */}
      <div className="local-actions">
        <button className="btn sm" onClick={loadModel}
          disabled={busy || !selectedPath || isLoaded || chatState === 'loading'}>
          {busy && !isLoaded ? '⏳' : '⬆'} Load into backend
        </button>
        <button className="btn sm ghost" onClick={unloadModel} disabled={busy || chatState !== 'ready'}>
          ⬇ Unload
        </button>
      </div>
      <p className="note">Loads the model into the lora-finetune backend VRAM. Agents set to <em>LoRA</em> provider will use it. Or serve externally and use <em>Local</em> provider below.</p>

      {/* inference server + apply */}
      <Field label="Inference server URL" hint="OpenAI-compatible · for Local provider">
        <input className="inp" value={serverUrl} placeholder="http://localhost:1234/v1"
          onChange={(e) => setHub({ localServerUrl: e.target.value })} />
      </Field>
      <div className="local-apply-row">
        <button className="btn primary sm" onClick={() => applyToAgents(false)} disabled={!selected}>
          Apply to agents
        </button>
        <button className="btn sm ghost" onClick={() => applyToAgents(true)} disabled={!selected}>
          Apply to all
        </button>
        {flash && <span className="local-apply-flash">{flash}</span>}
      </div>
      <p className="note">Sets provider → Local, model name, and server URL on every (non-locked) agent in one click.</p>
    </>
  );
}

function ToolBridgeSettings() {
  const [s] = useStore();
  const cfg = s.settings.tools || {};
  const base = (cfg.baseUrl || (typeof TOOL_BRIDGE_DEFAULT !== 'undefined' ? TOOL_BRIDGE_DEFAULT : 'http://localhost:4173')).replace(/\/$/, '');
  const setTools = (patch) => Store.set((st) => ({
    ...st, settings: { ...st.settings, tools: { ...(st.settings.tools || {}), ...patch } },
  }));

  const [status, setStatus] = React.useState('idle'); // idle | checking | ok | fail
  const [toolList, setToolList] = React.useState([]);

  const probe = React.useCallback(async () => {
    setStatus('checking');
    try {
      const r = await fetch(base + '/api/tools/status', { signal: AbortSignal.timeout(4000) });
      if (r.ok) { const j = await r.json(); setToolList(j.tools || []); setStatus('ok'); }
      else { setToolList([]); setStatus('fail'); }
    } catch { setToolList([]); setStatus('fail'); }
  }, [base]);

  React.useEffect(() => { probe(); }, [probe]);

  return (
    <>
      <div className="sect-l">Tool Bridge · agent tools</div>
      <div className="mode-card">
        <div>
          <b>Enable tool calling</b>
          <p className="muted">Let agents call file, shell, code, web, memory &amp; skill tools via the local bridge.</p>
        </div>
        <button className={'switch' + (cfg.enabled !== false ? ' on' : '')} onClick={() => setTools({ enabled: cfg.enabled === false })}><i /></button>
      </div>
      <Field label="Bridge URL" hint="node .claude/serve.js">
        <input className="inp" value={cfg.baseUrl || base} placeholder="http://localhost:4173"
          onChange={(e) => setTools({ baseUrl: e.target.value })} />
      </Field>
      <Field label={`Max tool rounds · ${cfg.maxRounds || 6}`}>
        <input type="range" className="range" min={1} max={12} step={1} value={cfg.maxRounds || 6} onChange={(e) => setTools({ maxRounds: Number(e.target.value) })} />
      </Field>
      <div className="lora-status-row">
        <div className={`lora-pill ${status === 'ok' ? 'ok' : status === 'fail' ? 'fail' : status === 'checking' ? 'idle' : 'idle'}`}>
          <i />
          {status === 'checking' ? 'checking…' : status === 'ok' ? `online · ${toolList.length} tools` : status === 'fail' ? 'offline — run serve.js' : 'not checked'}
        </div>
        <button className="btn sm ghost" onClick={probe}>↺ Check</button>
      </div>
      {status === 'fail' && <p className="note">Start the bridge with <code>node .claude/serve.js</code> and open the app at <code>{base}</code>. Without it, agents fall back to text-only answers.</p>}
    </>
  );
}

function SettingsDrawer() {
  const [s] = useStore();
  const open = !!s.settingsOpen;
  const set = (prov, patch) => Store.set((st) => ({ ...st, settings: { ...st.settings, [prov]: { ...st.settings[prov], ...patch } } }));
  const close = () => Store.set({ settingsOpen: false });
  return (
    <Drawer open={open} title="Settings" onClose={close}
      footer={<button className="btn ghost danger" onClick={() => { if (confirm('Reset all agents, rooms & connections?')) Store.reset(); }}>Reset everything</button>}>
      <div className={'mode-card' + (s.liveMode ? ' live' : '')}>
        <div>
          <b>{s.liveMode ? 'Live mode' : 'Demo mode'}</b>
          <p className="muted">{s.liveMode ? 'Agents call your real model backends.' : 'Agents are simulated — perfect for previewing. Switch on Live when running locally.'}</p>
        </div>
        <button className={'switch' + (s.liveMode ? ' on' : '')} onClick={() => Store.set({ liveMode: !s.liveMode })}><i /></button>
      </div>
      <p className="note">Note: browsers block cross-origin calls in this hosted preview. Run the file locally (and enable CORS in LM Studio) for Live calls to reach <code>localhost</code>.</p>

      <div className="sect-l">LM Studio · local</div>
      <Field label="Base URL"><input className="inp" value={s.settings.lmstudio.baseUrl} onChange={(e) => set('lmstudio', { baseUrl: e.target.value })} /></Field>
      <Field label="Default model"><input className="inp" value={s.settings.lmstudio.model} onChange={(e) => set('lmstudio', { model: e.target.value })} /></Field>

      <div className="sect-l">OpenAI</div>
      <Field label="API key"><input className="inp" type="password" placeholder="sk-…" value={s.settings.openai.apiKey} onChange={(e) => set('openai', { apiKey: e.target.value })} /></Field>
      <Field label="Default model"><input className="inp" value={s.settings.openai.model} onChange={(e) => set('openai', { model: e.target.value })} /></Field>

      <div className="sect-l">Anthropic</div>
      <Field label="API key"><input className="inp" type="password" placeholder="sk-ant-…" value={s.settings.anthropic.apiKey} onChange={(e) => set('anthropic', { apiKey: e.target.value })} /></Field>
      <Field label="Default model"><input className="inp" value={s.settings.anthropic.model} onChange={(e) => set('anthropic', { model: e.target.value })} /></Field>

      <ToolBridgeSettings />
      <LoraSettings />
      <LocalSettings />
    </Drawer>
  );
}

Object.assign(window, { EditorDrawer, SettingsDrawer });
