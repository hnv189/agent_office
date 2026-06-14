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
    action: '',
    lastRunMs: opts.lastRunMs ?? Date.now() - 1000 * 60 * 60 * 2,
  });
  return {
    view: 'office',
    liveMode: false,
    agents: [
      mk('nova',  'Nova',  '#a06bff', 'command', 'command',
        { status: 'active', schedule: 'always', sprite: 'octo', systemPrompt: 'You are Nova, the dispatcher. Patrol the office, route tasks to the right agent, and keep everyone in sync.', tools: ['memory', 'web.search'] }),
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
    ],
    connections: [
      { from: 'nova', to: 'cobalt' },
      { from: 'nova', to: 'ember' },
      { from: 'cobalt', to: 'rosa' },
      { from: 'rosa', to: 'sol' },
      { from: 'sol', to: 'clay' },
    ],
    tasks: [
      { id: 't1', kind: 'text', title: 'Summarise weekly signals', body: 'Pull the latest signals and produce a 5-bullet digest.', image: null, status: 'queued', assignee: 'cobalt', createdMs: Date.now() - 36e5 },
    ],
    nodePos: {}, // connections graph positions {id:{x,y}}
    settings: {
      lmstudio: { baseUrl: 'http://localhost:1234/v1', model: 'local-model' },
      openai:   { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '' },
      anthropic:{ baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-latest', apiKey: '' },
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
    removeAgent: (id) => Store.set((s) => ({
      ...s,
      agents: s.agents.filter((a) => a.id !== id),
      connections: s.connections.filter((c) => c.from !== id && c.to !== id),
    })),
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
