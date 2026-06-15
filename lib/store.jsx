// store.jsx — app state, default agents/rooms/connections, simulation engine,
// model-call layer (LM Studio / OpenAI / Anthropic + simulated fallback),
// localStorage persistence. Exports: useStore, Store, callModel, SIM_ACTIONS.

const LS_KEY = 'agentPlayground.v1';

// Curated speech-bubble phrases per agent role/tool.
const SIM_ACTIONS = {
  general: ['thinking…', 'planning…', 'reasoning…', 'drafting…', 'on it!'],
  research: ['cataloguing', 'cross-refs', 'hypothesis!', 'reading docs', 'found it!'],
  security: ['scanning…', 'all clear', 'patrolling', 'watching…', 'log check'],
  command: ['routing', 'dispatching', 'sync…', 'on watch', 'coordinating'],
  build: ['compiling', 'wiring…', 'shipping', 'testing', 'fixing bug'],
  studio: ['sketching', 'rendering', 'palette…', 'composing', 'polishing'],
};

const ROOM_THEMES = {
  command:  { label: 'COMMAND HQ',    theme: '#a06bff' },
  observatory: { label: 'OBSERVATORY', theme: '#4d7cff' },
  security: { label: 'SECURITY',      theme: '#ff4d6d' },
  research: { label: 'RESEARCH LAB',  theme: '#ff5cae' },
  workshop: { label: 'WORKSHOP',      theme: '#ffd23f' },
  studio:   { label: 'STUDIO',        theme: '#ff9b4d' },
  // V-Model coding pipeline rooms
  requirements:   { label: 'REQUIREMENTS',   theme: '#38bdf8' },
  implementation: { label: 'IMPLEMENTATION', theme: '#a3e635' },
  verification:   { label: 'VERIFICATION',   theme: '#fb7185' },
};

const TOOL_LIBRARY = ['web.search', 'files.read', 'files.write', 'shell', 'memory', 'vision', 'code.run', 'email'];

function defaultState() {
  const mk = (id, name, color, roomKey, role, opts = {}) => ({
    id, name, color, sprite: opts.sprite || 'octo',
    roomKey, role,
    status: opts.status || 'idle',
    systemPrompt: opts.systemPrompt || `You are ${name}, a helpful agent.`,
    connection: opts.connection || { provider: 'lmstudio', model: 'local-model', baseUrl: 'http://localhost:1234/v1', apiKey: '' },
    temperature: opts.temperature ?? 0.7,
    maxTokens: opts.maxTokens ?? 4096,
    schedule: opts.schedule || 'ondemand',     // always | ondemand | every
    everyHours: opts.everyHours ?? 12,
    tools: opts.tools || [],
    locked: opts.locked || false,              // locked agents have a fixed system prompt & can't be deleted
    role2: opts.role2 || null,                 // V-Model phase tag: 'requirements' | 'implementation' | 'verification'
    action: '',
    lastRunMs: opts.lastRunMs ?? Date.now() - 1000 * 60 * 60 * 2,
  });
  // Fixed system prompts for the V-Model coding trio (Spec → Forge → Probe).
  const LORA_CONN = { provider: 'lora', model: '', baseUrl: 'http://localhost:8000', apiKey: '' };
  const SPEC_PROMPT = 'You are Spec, the requirements analyst in a V-Model coding pipeline. You receive a raw coding task. Output a precise, structured specification only — never code. Include: Goal (one line), Inputs/Outputs, Constraints, Acceptance Criteria (numbered and testable), and Edge Cases. Assume the task description is complete; never ask for clarification. Your output is the single source of truth that the implementer and tester will follow.';
  const FORGE_PROMPT = 'You are Forge, the implementer in a V-Model coding pipeline. You receive a specification from Spec. Output complete, working code that satisfies every acceptance criterion — nothing else. No explanations, no surrounding prose, no placeholders or TODOs. Use idiomatic, production-quality code with the necessary imports and error handling. If the spec names a language, use it; otherwise pick the most fitting one and stay consistent. Your output is the implementation, ready to run.';
  const PROBE_PROMPT = 'You are Probe, the verifier in a V-Model coding pipeline. You receive a specification and the code Forge wrote for it. Check the code against every acceptance criterion and edge case. Output a VERDICT line (PASS or FAIL), then a numbered list of findings (criterion → pass/fail + reason). If anything fails, output a corrected, complete version of the code under a "Corrected implementation" heading. If everything passes, restate the final code as the deliverable. Always produce the actual code, never a description of what to change.';
  return {
    view: 'office',
    liveMode: false,
    agents: [
      mk('nova',  'Nova',  '#a06bff', 'command', 'command',
        { status: 'active', schedule: 'always', sprite: 'octo', systemPrompt: 'You are Nova, the dispatcher. Patrol the office, route tasks to the right agent, and keep everyone in sync. For ANY coding or software task, always route it through the V-Model coding pipeline: Spec (requirements) → Forge (implementation) → Probe (verification). Hand non-coding work to the other specialists.', tools: ['memory', 'web.search'] }),
      mk('cobalt','Cobalt','#4d7cff', 'observatory', 'research',
        { status: 'active', schedule: 'every', everyHours: 21, sprite: 'person', systemPrompt: 'You are Cobalt, the observer. Catalogue incoming signals and summarise what you find.', tools: ['web.search', 'files.read'] }),
      mk('ember', 'Ember', '#ff4d6d', 'security', 'security',
        { status: 'ondemand', schedule: 'ondemand', sprite: 'robot', systemPrompt: 'You are Ember, the watcher. Scan inputs for risks and flag anything suspicious.', tools: ['shell', 'files.read'] }),
      mk('rosa',  'Rosa',  '#ff5cae', 'research', 'research',
        { status: 'active', schedule: 'every', everyHours: 12, sprite: 'cat', systemPrompt: 'You are Rosa, the scientist. Form hypotheses and test ideas against the data.', tools: ['code.run', 'memory'] }),
      mk('sol',   'Sol',   '#ffd23f', 'workshop', 'build',
        { status: 'idle', schedule: 'ondemand', sprite: 'car', systemPrompt: 'You are Sol, the builder. Turn plans into working artefacts.', tools: ['code.run', 'shell', 'files.write'] }),
      mk('clay',  'Clay',  '#ff9b4d', 'studio', 'studio',
        { status: 'idle', schedule: 'ondemand', sprite: 'rocket', systemPrompt: 'You are Clay, the maker. Produce visuals and polish the final output.', tools: ['vision', 'files.write'] }),
      // ── V-Model coding pipeline (locked system prompts, served by the LoRA backend) ──
      mk('req',  'Spec',  '#38bdf8', 'requirements', 'research',
        { status: 'ondemand', schedule: 'ondemand', sprite: 'person', locked: true, role2: 'requirements',
          systemPrompt: SPEC_PROMPT, connection: { ...LORA_CONN }, temperature: 0.3, maxTokens: 4096, tools: [] }),
      mk('code', 'Forge', '#a3e635', 'implementation', 'build',
        { status: 'ondemand', schedule: 'ondemand', sprite: 'robot', locked: true, role2: 'implementation',
          systemPrompt: FORGE_PROMPT, connection: { ...LORA_CONN }, temperature: 0.2, maxTokens: 4096, tools: ['code.run'] }),
      mk('test', 'Probe', '#fb7185', 'verification', 'security',
        { status: 'ondemand', schedule: 'ondemand', sprite: 'cat', locked: true, role2: 'verification',
          systemPrompt: PROBE_PROMPT, connection: { ...LORA_CONN }, temperature: 0.3, maxTokens: 4096, tools: ['code.run'] }),
    ],
    connections: [
      { from: 'nova', to: 'cobalt' },
      { from: 'nova', to: 'ember' },
      { from: 'cobalt', to: 'rosa' },
      { from: 'rosa', to: 'sol' },
      { from: 'sol', to: 'clay' },
      // V-Model coding pipeline: Nova dispatches → Spec → Forge → Probe
      { from: 'nova', to: 'req' },
      { from: 'req', to: 'code' },
      { from: 'code', to: 'test' },
    ],
    tasks: [
      { id: 't1', kind: 'text', title: 'Summarise weekly signals', body: 'Pull the latest signals and produce a 5-bullet digest.', image: null, status: 'queued', assignee: 'cobalt', createdMs: Date.now() - 36e5 },
    ],
    nodePos: {}, // connections graph positions {id:{x,y}}
    settings: {
      lmstudio: { baseUrl: 'http://localhost:1234/v1', model: 'local-model' },
      openai:   { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '' },
      anthropic:{ baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-latest', apiKey: '' },
      lora:     { baseUrl: 'http://localhost:8000', dataset: 'agent_office', modelPath: '', adapterPath: '' },
    },
    ticker: [],
    visits: [], // active room-to-room visits {id, from, to, color, phase}
  };
}

// ── store core (vanilla pub/sub so all files share one source of truth) ────────
const Store = (() => {
  let state;
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    state = saved ? { ...defaultState(), ...saved, visits: [], ticker: saved.ticker || [] } : defaultState();
    // migrate agents that still have the old 1024 default up to 4096
    if (state.agents.some((a) => a.maxTokens === 1024)) {
      state = { ...state, agents: state.agents.map((a) => a.maxTokens === 1024 ? { ...a, maxTokens: 4096 } : a) };
    }
    // migrate settings.lora if missing
    if (!state.settings.lora) {
      state = { ...state, settings: { ...state.settings, lora: defaultState().settings.lora } };
    }
    // migrate V-Model coding trio (req/code/test) + their wiring if missing
    {
      const def = defaultState();
      const have = new Set(state.agents.map((a) => a.id));
      const missing = def.agents.filter((a) => ['req', 'code', 'test'].includes(a.id) && !have.has(a.id));
      if (missing.length) {
        const conns = [...state.connections];
        for (const c of def.connections) {
          if (['req', 'code', 'test'].includes(c.from) || ['req', 'code', 'test'].includes(c.to)) {
            if (!conns.some((x) => x.from === c.from && x.to === c.to)) conns.push(c);
          }
        }
        state = { ...state, agents: [...state.agents, ...missing], connections: conns };
      }
    }
  } catch (e) { state = defaultState(); }
  const subs = new Set();
  const persist = () => {
    try {
      const { visits, ...rest } = state;
      localStorage.setItem(LS_KEY, JSON.stringify(rest));
    } catch (e) {}
  };
  const emit = () => { subs.forEach((fn) => fn(state)); };
  return {
    get: () => state,
    set: (patch) => { state = typeof patch === 'function' ? patch(state) : { ...state, ...patch }; persist(); emit(); },
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    reset: () => { state = defaultState(); persist(); emit(); },
    // helpers
    updateAgent: (id, patch) => Store.set((s) => ({
      ...s, agents: s.agents.map((a) => a.id === id ? { ...a, ...(typeof patch === 'function' ? patch(a) : patch) } : a),
    })),
    addAgent: () => {
      const s = Store.get();
      const palette = ['#2ee6a6', '#5cc8ff', '#c07bff', '#ff8f5c', '#ffd23f', '#ff5cae'];
      const rk = Object.keys(ROOM_THEMES)[s.agents.length % 6];
      const id = 'a' + Date.now().toString(36);
      const a = {
        id, name: 'New Agent', color: palette[s.agents.length % palette.length], sprite: 'octo',
        roomKey: rk, role: 'general', status: 'idle',
        systemPrompt: 'You are a helpful agent.',
        connection: { provider: 'lmstudio', model: 'local-model', baseUrl: 'http://localhost:1234/v1', apiKey: '' },
        temperature: 0.7, maxTokens: 1024, schedule: 'ondemand', everyHours: 12, tools: [], action: '', lastRunMs: Date.now(),
      };
      Store.set({ agents: [...s.agents, a] });
      return id;
    },
    removeAgent: (id) => Store.set((s) => {
      const target = s.agents.find((a) => a.id === id);
      if (target && target.locked) return s; // locked V-Model agents can't be removed
      return {
        ...s,
        agents: s.agents.filter((a) => a.id !== id),
        connections: s.connections.filter((c) => c.from !== id && c.to !== id),
      };
    }),
    toggleConnection: (from, to) => Store.set((s) => {
      const exists = s.connections.some((c) => c.from === from && c.to === to);
      return { ...s, connections: exists
        ? s.connections.filter((c) => !(c.from === from && c.to === to))
        : [...s.connections, { from, to }] };
    }),
    log: (msg, color) => Store.set((s) => ({
      ...s, ticker: [{ t: Date.now(), msg, color }, ...s.ticker].slice(0, 40),
    })),
  };
})();

// ── React binding ──────────────────────────────────────────────────────────
function useStore(selector) {
  const sel = selector || ((s) => s);
  const [, force] = React.useReducer((x) => x + 1, 0);
  const ref = React.useRef();
  ref.current = sel(Store.get());
  React.useEffect(() => Store.subscribe((s) => {
    const next = sel(s);
    force();
  }), []);
  return [Store.get(), Store];
}

// ── model-call layer ───────────────────────────────────────────────────────
async function callModel(agent, userContent, { settings, liveMode } = {}) {
  const conn = agent.connection || {};
  const prov = conn.provider || 'lmstudio';
  const cfg = (settings && settings[prov]) || {};
  const messages = [
    { role: 'system', content: agent.systemPrompt || '' },
    { role: 'user', content: userContent },
  ];
  if (!liveMode || prov === 'demo') return simulate(agent, userContent);
  const modelId = conn.model || cfg.model || '?';
  const snippet = (s) => String(s || '').slice(0, 90) + (String(s || '').length > 90 ? '…' : '');
  Store.log(`[LIVE] → ${agent.name} [${prov}/${modelId}] "${snippet(userContent)}"`, '#5cc8ff');
  try {
    let result;
    if (prov === 'anthropic') {
      const r = await fetch((cfg.baseUrl || 'https://api.anthropic.com') + '/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey || '', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: conn.model || cfg.model, max_tokens: agent.maxTokens, temperature: agent.temperature, system: agent.systemPrompt, messages: [{ role: 'user', content: userContent }] }),
      });
      const j = await r.json();
      result = j?.content?.[0]?.text || JSON.stringify(j);
    } else if (prov === 'lora') {
      // LoRA fine-tune backend (lora-finetune FastAPI server) — SSE token stream
      const base = (cfg.baseUrl || 'http://localhost:8000').replace(/\/$/, '');
      const r = await fetch(base + '/api/chat/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'accept': 'text/event-stream' },
        body: JSON.stringify({ messages, temperature: agent.temperature, top_p: 0.9, max_new_tokens: Math.min(agent.maxTokens || 512, 2048), enable_thinking: false }),
      });
      if (!r.ok) throw new Error(`LoRA backend: ${r.status} ${r.statusText}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '', out = '';
      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const part of parts) {
          let ev = '', dat = '';
          for (const line of part.split('\n')) {
            if (line.startsWith('event: ')) ev = line.slice(7).trim();
            if (line.startsWith('data: ')) dat = line.slice(6).trim();
          }
          if (ev === 'token') { try { out += JSON.parse(dat).t || ''; } catch {} }
          if (ev === 'done') break outer;
          if (ev === 'error') { try { throw new Error(JSON.parse(dat).message || 'stream error'); } catch (e2) { throw e2; } }
        }
      }
      result = out || '(empty response)';
    } else {
      // openai-compatible: openai + lmstudio
      const base = conn.baseUrl || cfg.baseUrl || 'http://localhost:1234/v1';
      const r = await fetch(base.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cfg.apiKey ? { authorization: 'Bearer ' + cfg.apiKey } : {}) },
        body: JSON.stringify({ model: conn.model || cfg.model, temperature: agent.temperature, max_tokens: agent.maxTokens, messages }),
      });
      const j = await r.json();
      result = j?.choices?.[0]?.message?.content || JSON.stringify(j);
    }
    Store.log(`[LIVE] ← ${agent.name} (${modelId}): "${snippet(result)}"`, '#2ee6a6');
    return result;
  } catch (e) {
    Store.log(`[LIVE] ✕ ${agent.name}: ${e.message || 'request failed'}`, '#ff6b6b');
    return '[offline — simulated] ' + simulate(agent, userContent);
  }
}

function simulate(agent, userContent) {
  const pool = SIM_ACTIONS[agent.role] || SIM_ACTIONS.general;
  const verb = pool[Math.floor(Math.random() * pool.length)];
  const snippet = String(userContent || '').slice(0, 60);
  return `${agent.name} (${verb}): processed "${snippet}${snippet.length >= 60 ? '…' : ''}". Done.`;
}

Object.assign(window, { useStore, Store, callModel, SIM_ACTIONS, ROOM_THEMES, TOOL_LIBRARY });
