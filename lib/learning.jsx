// learning.jsx — "Self-Improve" view. Closes the loop the four ways:
//   Skill files      → agent.rules[]        (managed in editor)
//   Trajectory summ. → Nova diagnosis (P5)  (in tasks feedback form)
//   GEPA trace anal. → GepaPanel            (cross-trace rule evolution)
//   Weight fine-tune → LoRA adapter (P7)    → TrainingDataPanel + LoraTrainPanel
// Exports: SelfImproveView.

// strip the internal _agentId/_taskId tags before a record leaves the browser
function cleanRecords(records) {
  return records.map(({ messages }) => ({ messages }));
}

// ── GEPA: evolve one agent's rule set from all its traces ──────────────────
function GepaPanel() {
  const [s] = useStore();
  const trio = s.agents.filter((a) => TRIO_IDS.includes(a.id));
  const [agentId, setAgentId] = React.useState(trio[0]?.id || '');
  const [phase, setPhase] = React.useState('idle'); // idle | running | review
  const [proposed, setProposed] = React.useState([]);
  const [rationale, setRationale] = React.useState('');
  const [sampleCount, setSampleCount] = React.useState(0);

  const agent = s.agents.find((a) => a.id === agentId);
  const current = (agent?.rules || []);

  // how many feedback-bearing runs touch this agent
  const available = s.tasks.filter((t) =>
    t.status === 'done' && Array.isArray(t.trace) && t.feedback &&
    t.trace.some((st) => st.agentId === agentId)).length;

  const run = async () => {
    setPhase('running');
    const res = await runGEPA(agentId, { tasks: s.tasks, agents: s.agents, settings: s.settings, liveMode: s.liveMode });
    if (!res) { setPhase('idle'); Store.log('◈ GEPA: not enough trace data to evolve rules yet', '#ffd23f'); return; }
    setProposed(res.proposed);
    setRationale(res.rationale);
    setSampleCount(res.samples);
    setPhase('review');
  };

  const editProposed = (i, v) => setProposed((p) => p.map((x, j) => j === i ? v : x));
  const removeProposed = (i) => setProposed((p) => p.filter((_, j) => j !== i));
  const addProposed = () => setProposed((p) => [...p, '']);

  const apply = () => {
    const clean = proposed.map((t) => t.trim()).filter(Boolean);
    Store.applyGEPA(agentId, clean);
    Store.log(`⟳ GEPA evolved ${agent.name}'s rules → ${clean.length} rule(s)`, '#a06bff');
    setPhase('idle'); setProposed([]);
  };

  return (
    <section className="si-card">
      <div className="si-card-hd">
        <h2>⟳ GEPA — trace evolution</h2>
        <span className="si-sub">Reads every past run for one agent, finds recurring failures, and evolves its rule set. Prompt-level — no training.</span>
      </div>

      <div className="si-row">
        <label className="fld inline">
          <span className="fld-l">Agent</span>
          <select className="inp" value={agentId} onChange={(e) => { setAgentId(e.target.value); setPhase('idle'); }}>
            {trio.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <span className="si-meta">{available} run(s) with feedback · {current.length} current rule(s)</span>
        <button className="btn primary sm" disabled={phase === 'running' || available === 0} onClick={run}>
          {phase === 'running' ? '◈ analysing…' : '⟳ Evolve rules'}
        </button>
      </div>

      {available === 0 && phase === 'idle' && (
        <p className="si-empty">Run a task through this agent and leave feedback first — GEPA needs traces to learn from.</p>
      )}

      {phase === 'review' && (
        <div className="gepa-review">
          <p className="gepa-rationale">⟳ {rationale} <span className="muted">({sampleCount} run(s) analysed)</span></p>
          <div className="gepa-cols">
            <div className="gepa-col">
              <div className="gepa-col-hd">Current ({current.length})</div>
              {current.length === 0 && <p className="si-empty sm">no rules yet</p>}
              {current.map((r) => <div key={r.id} className="gepa-old">{r.confirmed && <span className="rule-star">★</span>}{r.text}</div>)}
            </div>
            <div className="gepa-arrow">→</div>
            <div className="gepa-col">
              <div className="gepa-col-hd">Proposed ({proposed.length})</div>
              {proposed.map((text, i) => (
                <div key={i} className="gepa-new-row">
                  <textarea className="inp ta gepa-new" rows={2} value={text} onChange={(e) => editProposed(i, e.target.value)} />
                  <button className="icon-btn" onClick={() => removeProposed(i)} title="Drop">✕</button>
                </div>
              ))}
              <button className="btn sm ghost" onClick={addProposed}>＋ add rule</button>
            </div>
          </div>
          <div className="gepa-actions">
            <button className="btn primary sm" onClick={apply}>✓ Apply evolved set to {agent.name}</button>
            <button className="btn sm" onClick={run}>↺ Regenerate</button>
            <button className="btn sm ghost" onClick={() => setPhase('idle')}>✕ Discard</button>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Training data builder + export (P6) ────────────────────────────────────
function TrainingDataPanel() {
  const [s] = useStore();
  const [threshold, setThreshold] = React.useState(3);
  const [includeExported, setIncludeExported] = React.useState(false);
  const [pushState, setPushState] = React.useState(null); // null | 'pushing' | 'ok' | 'fail'
  const [pushMsg, setPushMsg] = React.useState('');

  const cfg = s.settings.lora || {};
  const base = (cfg.baseUrl || 'http://localhost:8000').replace(/\/$/, '');

  const { records, taskIds } = buildTrainingRecords(s.tasks, { threshold, includeExported });
  const qual = qualifyingTasks(s.tasks, { threshold, includeExported });

  const download = () => {
    const jsonl = cleanRecords(records).map((r) => JSON.stringify(r)).join('\n');
    const blob = new Blob([jsonl], { type: 'application/jsonl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${cfg.dataset || 'agent_office'}_train.jsonl`;
    a.click(); URL.revokeObjectURL(url);
    Store.log(`⬇ Downloaded ${records.length} training record(s)`, '#2ee6a6');
  };

  const push = async () => {
    setPushState('pushing'); setPushMsg('');
    try {
      const r = await fetch(base + '/api/datasets/append', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dataset: cfg.dataset || 'agent_office', split: 'train', records: cleanRecords(records) }),
      });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const j = await r.json().catch(() => ({}));
      Store.markExported(taskIds);
      setPushState('ok');
      setPushMsg(`appended ${j.appended ?? records.length} · total ${j.total_rows ?? '?'} rows`);
      Store.log(`⬆ Pushed ${records.length} record(s) to ${cfg.dataset}`, '#2ee6a6');
    } catch (e) {
      setPushState('fail');
      setPushMsg(e.message || 'request failed — endpoint may not exist yet (see docs §6)');
    }
  };

  return (
    <section className="si-card">
      <div className="si-card-hd">
        <h2>⬡ Training data</h2>
        <span className="si-sub">Good runs become chat-format records — one per pipeline step. The corrected output (if you supplied one) becomes the target.</span>
      </div>

      <div className="si-row">
        <label className="fld inline">
          <span className="fld-l">Min rating · {threshold}★</span>
          <input type="range" className="range" min={1} max={5} step={1} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
        </label>
        <label className="si-check">
          <input type="checkbox" checked={includeExported} onChange={(e) => setIncludeExported(e.target.checked)} />
          include already-exported
        </label>
      </div>

      <div className="si-stat-row">
        <div className="si-stat"><b>{qual.length}</b><span>qualifying task(s)</span></div>
        <div className="si-stat"><b>{records.length}</b><span>training record(s)</span></div>
      </div>

      <div className="si-actions">
        <button className="btn sm" disabled={records.length === 0} onClick={download}>⬇ Download JSONL</button>
        <button className="btn primary sm" disabled={records.length === 0 || pushState === 'pushing'} onClick={push}>
          {pushState === 'pushing' ? 'pushing…' : '⬆ Push to backend'}
        </button>
        {pushState && pushState !== 'pushing' && (
          <span className={'si-push-msg ' + pushState}>{pushState === 'ok' ? '✓ ' : '✕ '}{pushMsg}</span>
        )}
      </div>
      {records.length === 0 && <p className="si-empty sm">No qualifying runs yet — complete tasks and rate them ≥ {threshold}★.</p>}
    </section>
  );
}

// ── LoRA fine-tune trigger + SSE monitor (P7) ──────────────────────────────
function LoraTrainPanel() {
  const [s] = useStore();
  const cfg = s.settings.lora || {};
  const base = (cfg.baseUrl || 'http://localhost:8000').replace(/\/$/, '');
  const train = cfg.train || { run_name: '', num_train_epochs: 1, lora_r: 8, lora_alpha: 16, learning_rate: 2e-4, max_seq_length: 512 };

  const setTrain = (patch) => Store.set((st) => ({
    ...st, settings: { ...st.settings, lora: { ...st.settings.lora, train: { ...train, ...patch } } },
  }));

  const [rows, setRows] = React.useState(null);
  const [status, setStatus] = React.useState('idle'); // idle | training | done | error
  const [events, setEvents] = React.useState([]);
  const [latest, setLatest] = React.useState(null); // {step,total,loss,epoch,eta}
  const [merged, setMerged] = React.useState([]);
  const abortRef = React.useRef(null);

  const refresh = React.useCallback(async () => {
    try {
      const r = await fetch(base + '/api/datasets');
      if (r.ok) {
        const ds = await r.json();
        const mine = (Array.isArray(ds) ? ds : []).find((d) => d.name === (cfg.dataset || 'agent_office'));
        setRows(mine ? (mine.train_rows ?? mine.rows ?? mine.total_rows ?? null) : 0);
      }
    } catch {}
    try {
      const rr = await fetch(base + '/api/runs');
      if (rr.ok) { const runs = await rr.json(); setMerged((Array.isArray(runs) ? runs : []).filter((r) => r.kind === 'merged')); }
    } catch {}
  }, [base, cfg.dataset]);

  React.useEffect(() => { refresh(); }, [refresh]);
  React.useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);

  const log = (msg) => setEvents((e) => [...e.slice(-80), msg]);

  const startTraining = async () => {
    setStatus('training'); setEvents([]); setLatest(null);
    // GPU constraint — one job at a time. Unload any loaded chat model first.
    try {
      const cs = await fetch(base + '/api/chat/status').then((r) => r.ok ? r.json() : null).catch(() => null);
      if (cs && cs.state && cs.state !== 'unloaded') {
        log('⚠ chat model loaded — unloading to free the GPU…');
        await fetch(base + '/api/chat/unload', { method: 'POST' }).catch(() => {});
      }
    } catch {}

    // kick off the run
    const body = {
      model_path: cfg.modelPath || undefined,
      base_model: cfg.modelPath || undefined,
      dataset: cfg.dataset || 'agent_office',
      run_name: train.run_name || `agent_office_${Date.now().toString(36)}`,
      num_train_epochs: Number(train.num_train_epochs) || 1,
      lora_r: Number(train.lora_r) || 8,
      lora_alpha: Number(train.lora_alpha) || 16,
      learning_rate: Number(train.learning_rate) || 2e-4,
      max_seq_length: Number(train.max_seq_length) || 512,
    };
    try {
      const r = await fetch(base + '/api/train', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`/api/train ${r.status} ${r.statusText}`);
      log(`▶ training started — run "${body.run_name}"`);
      Store.log(`▶ LoRA training started: ${body.run_name}`, '#a06bff');
      streamEvents();
    } catch (e) {
      setStatus('error'); log('✕ ' + (e.message || 'could not start training'));
    }
  };

  // subscribe to the SSE training-event stream
  const streamEvents = async () => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const r = await fetch(base + '/api/train/events', { headers: { accept: 'text/event-stream' }, signal: ctrl.signal });
      if (!r.ok || !r.body) throw new Error('event stream unavailable');
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n'); buf = parts.pop();
        for (const part of parts) {
          let ev = '', dat = '';
          for (const line of part.split('\n')) {
            if (line.startsWith('event: ')) ev = line.slice(7).trim();
            if (line.startsWith('data: ')) dat = line.slice(6).trim();
          }
          let d = null; try { d = JSON.parse(dat); } catch {}
          if (!d) continue;
          if (ev === 'progress' || d.loss != null || d.step != null) {
            setLatest({ step: d.step, total: d.total_steps ?? d.total, loss: d.loss, epoch: d.epoch, eta: d.eta });
            if (d.loss != null) log(`step ${d.step ?? '?'}${d.total_steps ? '/' + d.total_steps : ''} · loss ${Number(d.loss).toFixed(4)}${d.eta ? ' · eta ' + d.eta : ''}`);
          }
          if (ev === 'done' || d.state === 'completed' || d.status === 'completed') {
            setStatus('done'); log('✔ training complete — merged model ready'); Store.log('✔ LoRA training complete', '#2ee6a6'); refresh(); return;
          }
          if (ev === 'error' || d.state === 'error') { setStatus('error'); log('✕ ' + (d.message || 'training error')); return; }
        }
      }
      // stream ended without explicit done — treat as finished
      if (status === 'training') { setStatus('done'); refresh(); }
    } catch (e) {
      if (e.name !== 'AbortError') { setStatus('error'); log('✕ stream: ' + (e.message || 'lost')); }
    }
  };

  const loadMerged = async (path) => {
    try {
      Store.set((st) => ({ ...st, settings: { ...st.settings, lora: { ...st.settings.lora, modelPath: path } } }));
      await fetch(base + '/api/chat/load', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model_path: path, use_4bit: true, trust_remote_code: true }),
      });
      Store.log(`⬆ Loaded merged model — agents on LoRA now use it`, '#2ee6a6');
      setStatus('idle');
    } catch (e) { Store.log(`✕ load merged failed: ${e.message}`, '#ff6b6b'); }
  };

  return (
    <section className="si-card">
      <div className="si-card-hd">
        <h2>◆ LoRA fine-tune</h2>
        <span className="si-sub">Bakes the dataset into adapter weights. One GPU job at a time — any loaded chat model is unloaded first.</span>
      </div>

      <div className="si-stat-row">
        <div className="si-stat"><b>{rows == null ? '—' : rows}</b><span>rows in {cfg.dataset || 'agent_office'}</span></div>
        <div className="si-stat"><b>{merged.length}</b><span>merged model(s)</span></div>
        <button className="btn sm ghost" onClick={refresh}>↺ Refresh</button>
      </div>

      <div className="si-grid">
        <label className="fld"><span className="fld-l">Run name</span>
          <input className="inp" value={train.run_name} placeholder="auto" onChange={(e) => setTrain({ run_name: e.target.value })} /></label>
        <label className="fld"><span className="fld-l">Epochs</span>
          <input className="inp" type="number" min={1} value={train.num_train_epochs} onChange={(e) => setTrain({ num_train_epochs: Number(e.target.value) })} /></label>
        <label className="fld"><span className="fld-l">LoRA r</span>
          <input className="inp" type="number" min={1} value={train.lora_r} onChange={(e) => setTrain({ lora_r: Number(e.target.value) })} /></label>
        <label className="fld"><span className="fld-l">LoRA α</span>
          <input className="inp" type="number" min={1} value={train.lora_alpha} onChange={(e) => setTrain({ lora_alpha: Number(e.target.value) })} /></label>
        <label className="fld"><span className="fld-l">Learning rate</span>
          <input className="inp" type="number" step={0.00001} value={train.learning_rate} onChange={(e) => setTrain({ learning_rate: Number(e.target.value) })} /></label>
        <label className="fld"><span className="fld-l">Max seq len</span>
          <input className="inp" type="number" min={64} step={64} value={train.max_seq_length} onChange={(e) => setTrain({ max_seq_length: Number(e.target.value) })} /></label>
      </div>
      {!cfg.modelPath && <p className="si-empty sm">⚠ No base model selected — pick one in Settings → LoRA Backend before training.</p>}

      <div className="si-actions">
        <button className="btn primary sm" disabled={status === 'training' || !rows} onClick={startTraining}>
          {status === 'training' ? '◈ training…' : '▶ Start training'}
        </button>
        <span className={'si-train-state ' + status}>{status}</span>
      </div>

      {latest && (
        <div className="si-progress">
          {latest.total ? <div className="si-bar"><i style={{ width: `${Math.min(100, Math.round((latest.step / latest.total) * 100))}%` }} /></div> : null}
          <span className="si-prog-txt">
            {latest.step != null && `step ${latest.step}${latest.total ? '/' + latest.total : ''}`}
            {latest.loss != null && ` · loss ${Number(latest.loss).toFixed(4)}`}
            {latest.epoch != null && ` · epoch ${latest.epoch}`}
            {latest.eta && ` · eta ${latest.eta}`}
          </span>
        </div>
      )}

      {events.length > 0 && (
        <div className="si-eventlog">
          {events.map((e, i) => <div key={i} className="si-event">{e}</div>)}
        </div>
      )}

      {merged.length > 0 && (
        <div className="si-merged">
          <div className="gepa-col-hd">Load a merged model into the agents</div>
          {merged.map((m) => (
            <div key={m.path || m.name} className="si-merged-row">
              <span className="si-merged-name">{m.name}{status === 'done' && m === merged[0] && <span className="si-new-badge">new</span>}</span>
              <button className="btn sm" onClick={() => loadMerged(m.merged_path || m.path)}>⬆ Load</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SelfImproveView() {
  const [s] = useStore();
  return (
    <div className="page si-page">
      <div className="page-hd">
        <h1><span className="emoji">⟳</span> Self-Improve</h1>
        <span className="muted">rules → traces → weights</span>
      </div>
      {!s.liveMode && <p className="note">GEPA evolution and training need Live mode + the LoRA backend. In Demo mode you can still build and download training data.</p>}
      <GepaPanel />
      <TrainingDataPanel />
      <LoraTrainPanel />
    </div>
  );
}

Object.assign(window, { SelfImproveView });
