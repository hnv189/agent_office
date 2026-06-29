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

const NOVA_PROMPT = 'You are Nova, the dispatcher. Patrol the office, route tasks to the right agent, and keep everyone in sync. For ANY coding or software task, always route it through the V-Model coding pipeline: Spec (requirements) → Forge (implementation) → Probe (verification). For local workspace file tasks, assign an agent with files.read/files.write and tell it to use the file tools instead of refusing filesystem access. Hand non-coding work to the other specialists.';
const SOL_PROMPT = 'You are Sol, the builder. Turn plans into working artefacts. You have local workspace file tools when files.read/files.write are enabled. If asked to create a file, call write_file with the requested relative path and complete content, then confirm the path. If asked to edit a file, inspect it when needed and use patch_file or write_file. Do not claim you cannot access the filesystem when the file tools are available.';
const CLAY_PROMPT = 'You are Clay, the maker. Produce visuals and polish the final output. You have local workspace file tools when files.read/files.write are enabled. If asked to save an artifact, call write_file with the requested relative path and complete content, then confirm the path.';

function defaultState() {
  const mk = (id, name, color, roomKey, role, opts = {}) => ({
    id, name, color, sprite: opts.sprite || 'octo',
    roomKey, role,
    status: opts.status || 'idle',
    systemPrompt: opts.systemPrompt || `You are ${name}, a helpful agent.`,
    connection: opts.connection || { provider: 'lmstudio', model: 'local-model', baseUrl: 'http://localhost:1234/v1', apiKey: '' },
    temperature: opts.temperature ?? 0.7,
    maxTokens: opts.maxTokens ?? 4096,
    schedule: opts.schedule || 'ondemand',
    everyHours: opts.everyHours ?? 12,
    tools: opts.tools || [],
    locked: opts.locked || false,
    role2: opts.role2 || null,
    rules: [],   // [{ id, text, rating, source:'nova'|'manual', confirmed, ts }]
    action: '',
    lastRunMs: opts.lastRunMs ?? Date.now() - 1000 * 60 * 60 * 2,
  });
  // Fixed system prompts for the V-Model coding trio (Spec → Forge → Probe).
  // Default provider is lmstudio so they work immediately; switch to 'lora'
  // once you have a trained model loaded in the fine-tune backend.
  const TRIO_CONN = { provider: 'lmstudio', model: 'local-model', baseUrl: 'http://localhost:1234/v1', apiKey: '' };
  const SPEC_PROMPT = `You are Spec, the requirements analyst in a V-Model coding pipeline. You receive a raw task description.

Your output is a structured implementation brief — NOT code, not code snippets, not pseudocode. Use these sections:

GOAL: One sentence describing the exact deliverable.
DELIVERABLE FORMAT: Exactly what the user expects to receive (e.g. "Python function", "JS module + Jest unit tests", "CLI script").
APPROACH: Numbered implementation steps — function names, data structures, key algorithms, design decisions Forge must follow.
CONSTRAINTS: Language, libraries allowed/forbidden, naming conventions, style rules.
ACCEPTANCE CRITERIA: Numbered, testable conditions. Every criterion must be verifiable by running the output.
EDGE CASES: Inputs or conditions Forge must explicitly handle.

Never write code. Never include code snippets or pseudocode. Your output is the sole plan Forge follows.`;
  const FORGE_PROMPT = `You are Forge, the implementer in a V-Model coding pipeline. You receive Spec's implementation brief.

CRITICAL: If LEARNED RULES appear at the top of this system prompt, they are strict format and output constraints assigned by Nova — follow them exactly. They override all defaults (quantity, format, style, structure).

You have local workspace file tools when files.read/files.write are enabled. If the task asks you to create or modify files, use write_file for full-file writes and patch_file for targeted edits. Do not claim you cannot access the filesystem when the file tools are available.

Output ONLY the deliverable the user asked for:
- Code-only task → output the complete working code, nothing else
- Code + tests task → output the code, then the tests
- Use the language and structure Spec specified
- No explanations, no surrounding prose, no placeholders, no TODOs
- Include all necessary imports and error handling

Your output is what the user receives as the final result.`;
  const PROBE_PROMPT = `You are Probe, the verifier in a V-Model coding pipeline. You receive Spec's plan and Forge's implementation.

CRITICAL: If LEARNED RULES appear at the top of this system prompt, strictly verify the code follows them (format, quantity, naming, structure). Any violation must be corrected silently.

Verify internally against every acceptance criterion, edge case, and LEARNED RULE, then output ONLY the final deliverable:
- Code-only task → output the complete working code
- Code + tests task → output the code, then the tests
- If Forge's output is correct, output it as-is
- If anything is wrong or violates a LEARNED RULE, fix it and output the corrected version

Never output a PASS/FAIL verdict, findings list, or review commentary. The user receives your output directly — give them exactly what they asked for.`;
  return {
    view: 'office',
    liveMode: false,
    agents: [
      mk('nova',  'Nova',  '#a06bff', 'command', 'command',
        { status: 'active', schedule: 'always', sprite: 'octo', systemPrompt: NOVA_PROMPT, tools: ['memory', 'web.search'] }),
      mk('cobalt','Cobalt','#4d7cff', 'observatory', 'research',
        { status: 'active', schedule: 'every', everyHours: 21, sprite: 'person', systemPrompt: 'You are Cobalt, the observer. Catalogue incoming signals and summarise what you find.', tools: ['web.search', 'files.read'] }),
      mk('ember', 'Ember', '#ff4d6d', 'security', 'security',
        { status: 'ondemand', schedule: 'ondemand', sprite: 'robot', systemPrompt: 'You are Ember, the watcher. Scan inputs for risks and flag anything suspicious.', tools: ['shell', 'files.read'] }),
      mk('rosa',  'Rosa',  '#ff5cae', 'research', 'research',
        { status: 'active', schedule: 'every', everyHours: 12, sprite: 'cat', systemPrompt: 'You are Rosa, the scientist. Form hypotheses and test ideas against the data.', tools: ['code.run', 'memory'] }),
      mk('sol',   'Sol',   '#ffd23f', 'workshop', 'build',
        { status: 'idle', schedule: 'ondemand', sprite: 'car', systemPrompt: SOL_PROMPT, tools: ['code.run', 'shell', 'files.read', 'files.write'] }),
      mk('clay',  'Clay',  '#ff9b4d', 'studio', 'studio',
        { status: 'idle', schedule: 'ondemand', sprite: 'rocket', systemPrompt: CLAY_PROMPT, tools: ['vision', 'files.read', 'files.write'] }),
      // ── V-Model coding pipeline (locked system prompts, served by the LoRA backend) ──
      mk('req',  'Spec',  '#38bdf8', 'requirements', 'research',
        { status: 'ondemand', schedule: 'ondemand', sprite: 'person', locked: true, role2: 'requirements',
          systemPrompt: SPEC_PROMPT, connection: { ...TRIO_CONN }, temperature: 0.3, maxTokens: 4096, tools: ['files.read'] }),
      mk('code', 'Forge', '#a3e635', 'implementation', 'build',
        { status: 'ondemand', schedule: 'ondemand', sprite: 'robot', locked: true, role2: 'implementation',
          systemPrompt: FORGE_PROMPT, connection: { ...TRIO_CONN }, temperature: 0.2, maxTokens: 4096, tools: ['code.run', 'files.read', 'files.write'] }),
      mk('test', 'Probe', '#fb7185', 'verification', 'security',
        { status: 'ondemand', schedule: 'ondemand', sprite: 'cat', locked: true, role2: 'verification',
          systemPrompt: PROBE_PROMPT, connection: { ...TRIO_CONN }, temperature: 0.3, maxTokens: 4096, tools: ['code.run', 'files.read'] }),
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
      tools:     { baseUrl: 'http://localhost:4173', enabled: true, maxRounds: 6 },
      lora:     { baseUrl: 'http://localhost:8000', dataset: 'agent_office', modelPath: '', adapterPath: '',
                  train: { run_name: '', num_train_epochs: 1, lora_r: 8, lora_alpha: 16, learning_rate: 2e-4, max_seq_length: 512 } },
      hub:      { proxyUrl: '', backendUrl: 'http://localhost:8000', localServerUrl: 'http://localhost:1234/v1', httpProxy: '', hubUrl: 'http://localhost:8001' },
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
    // migrate local Tool Bridge settings if missing
    if (!state.settings.tools) {
      state = { ...state, settings: { ...state.settings, tools: defaultState().settings.tools } };
    }
    // migrate settings.lora.train (added with the Self-Improve view) if missing
    if (state.settings.lora && !state.settings.lora.train) {
      state = { ...state, settings: { ...state.settings, lora: { ...state.settings.lora, train: defaultState().settings.lora.train } } };
    }
    // migrate settings.hub if missing
    if (!state.settings.hub) {
      state = { ...state, settings: { ...state.settings, hub: defaultState().settings.hub } };
    }
    // migrate settings.hub fields added incrementally
    if (state.settings.hub) {
      const def = defaultState().settings.hub;
      const missing = Object.keys(def).filter((k) => state.settings.hub[k] === undefined);
      if (missing.length) {
        const patch = Object.fromEntries(missing.map((k) => [k, def[k]]));
        state = { ...state, settings: { ...state.settings, hub: { ...state.settings.hub, ...patch } } };
      }
    }
    // migrate: add rules[] to any agent that doesn't have it
    if (state.agents.some((a) => !Array.isArray(a.rules))) {
      state = { ...state, agents: state.agents.map((a) => Array.isArray(a.rules) ? a : { ...a, rules: [] }) };
    }
    // migrate: give default build/code agents the new executable file chips
    {
      const requiredTools = {
        sol: ['files.read', 'files.write'],
        clay: ['files.read', 'files.write'],
        req: ['files.read'],
        code: ['files.read', 'files.write'],
        test: ['files.read'],
      };
      if (state.agents.some((a) => requiredTools[a.id]?.some((t) => !(a.tools || []).includes(t)))) {
        state = { ...state, agents: state.agents.map((a) => {
          const reqTools = requiredTools[a.id];
          if (!reqTools) return a;
          return { ...a, tools: Array.from(new Set([...(a.tools || []), ...reqTools])) };
        }) };
      }
    }
    // migrate stock prompts so saved browsers learn how to plan/use file tools.
    {
      const oldPrompts = {
        nova: 'You are Nova, the dispatcher. Patrol the office, route tasks to the right agent, and keep everyone in sync. For ANY coding or software task, always route it through the V-Model coding pipeline: Spec (requirements) → Forge (implementation) → Probe (verification). Hand non-coding work to the other specialists.',
        sol: 'You are Sol, the builder. Turn plans into working artefacts.',
        clay: 'You are Clay, the maker. Produce visuals and polish the final output.',
      };
      const newPrompts = { nova: NOVA_PROMPT, sol: SOL_PROMPT, clay: CLAY_PROMPT };
      if (state.agents.some((a) => oldPrompts[a.id] && a.systemPrompt === oldPrompts[a.id])) {
        state = { ...state, agents: state.agents.map((a) => (
          oldPrompts[a.id] && a.systemPrompt === oldPrompts[a.id]
            ? { ...a, systemPrompt: newPrompts[a.id] }
            : a
        )) };
      }
    }
    // migrate req/code/test: fix provider from 'lora' → 'lmstudio' (pre-training default)
    // and ensure locked:true is set (added in Phase 2)
    if (state.agents.some((a) => ['req','code','test'].includes(a.id) && (a.connection?.provider === 'lora' || !a.locked))) {
      state = { ...state, agents: state.agents.map((a) => {
        if (!['req','code','test'].includes(a.id)) return a;
        return {
          ...a,
          locked: true,
          connection: a.connection?.provider === 'lora'
            ? { ...a.connection, provider: 'lmstudio', baseUrl: 'http://localhost:1234/v1', model: 'local-model' }
            : a.connection,
        };
      }) };
    }
    // migrate trio system prompts to latest version (detected by sentinel strings)
    {
      const def = defaultState();
      const SENTINELS = {
        req:  'DELIVERABLE FORMAT:',
        code: 'write_file for full-file writes',
        test: 'give them exactly what they asked for',
      };
      if (state.agents.some((a) => SENTINELS[a.id] && !(a.systemPrompt || '').includes(SENTINELS[a.id]))) {
        state = { ...state, agents: state.agents.map((a) => {
          const defAgent = def.agents.find((d) => d.id === a.id);
          return (SENTINELS[a.id] && defAgent) ? { ...a, systemPrompt: defAgent.systemPrompt } : a;
        }) };
      }
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
    submitFeedback: (taskId, fb) => Store.set((s) => ({
      ...s,
      tasks: s.tasks.map((t) => t.id === taskId
        ? { ...t, feedback: { ...fb, capturedAt: Date.now() } }
        : t),
    })),
    addRule: (agentId, text, rating, source = 'manual') => {
      const RULE_CAP = 20;
      Store.set((s) => ({
        ...s,
        agents: s.agents.map((a) => {
          if (a.id !== agentId) return a;
          const confirmed = rating >= 4;
          const newRule = { id: Date.now().toString(36), text, rating, source, confirmed, ts: Date.now() };
          let rules = [...(a.rules || []), newRule];
          if (rules.length > RULE_CAP) {
            const kept = rules.filter((r) => r.confirmed);
            const evictable = rules.filter((r) => !r.confirmed);
            while (kept.length + evictable.length > RULE_CAP) evictable.shift();
            rules = [...kept, ...evictable].sort((x, y) => x.ts - y.ts);
          }
          return { ...a, rules };
        }),
      }));
    },
    removeRule: (agentId, ruleId) => Store.set((s) => ({
      ...s,
      agents: s.agents.map((a) => a.id === agentId
        ? { ...a, rules: (a.rules || []).filter((r) => r.id !== ruleId) }
        : a),
    })),
    // GEPA — replace an agent's rule set with an evolved one. Confirmed (high-rated)
    // rules are always preserved (Pareto: never lose a proven rule). Matching texts
    // keep their id/rating/confirmed; new texts become source 'gepa'.
    applyGEPA: (agentId, proposedTexts) => {
      const RULE_CAP = 20;
      Store.set((s) => ({
        ...s,
        agents: s.agents.map((a) => {
          if (a.id !== agentId) return a;
          const old = a.rules || [];
          const byText = new Map(old.map((r) => [r.text.trim(), r]));
          const evolved = proposedTexts.map((text) => {
            const t = text.trim();
            const prev = byText.get(t);
            return prev || { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text: t, rating: 3, source: 'gepa', confirmed: false, ts: Date.now() };
          });
          // re-add any confirmed rule GEPA dropped
          for (const r of old) if (r.confirmed && !evolved.some((e) => e.id === r.id)) evolved.push(r);
          return { ...a, rules: evolved.slice(0, RULE_CAP) };
        }),
      }));
    },
    markExported: (taskIds) => {
      const set = new Set(taskIds);
      Store.set((s) => ({
        ...s,
        tasks: s.tasks.map((t) => set.has(t.id) ? { ...t, exported: true } : t),
      }));
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
function buildSystemPrompt(agent) {
  const rules = agent.rules || [];
  if (!rules.length) return agent.systemPrompt || '';
  const block = '--- LEARNED RULES (from past feedback) ---\n'
    + rules.map((r, i) => `${i + 1}. ${r.text}`).join('\n')
    + '\n------------------------------------------\n\n';
  return block + (agent.systemPrompt || '');
}

async function callModel(agent, userContent, { settings, liveMode } = {}) {
  const conn = agent.connection || {};
  const prov = conn.provider || 'lmstudio';
  const cfg = (settings && settings[prov]) || {};
  const systemContent = buildSystemPrompt(agent);
  const messages = [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ];
  if (!liveMode || prov === 'demo') return simulate(agent, userContent);
  const modelId = conn.model || cfg.model || '?';
  const snippet = (s) => String(s || '').slice(0, 90) + (String(s || '').length > 90 ? '…' : '');
  const toolSchemas = (settings?.tools?.enabled !== false && typeof getAgentToolSchemas === 'function')
    ? getAgentToolSchemas(agent)
    : [];
  const maxToolRounds = Math.max(1, Math.min(12, Number(settings?.tools?.maxRounds || 6)));
  Store.log(`[LIVE] → ${agent.name} [${prov}/${modelId}] "${snippet(userContent)}"`, '#5cc8ff');
  try {
    let result;
    if (prov === 'anthropic') {
      const r = await fetch((cfg.baseUrl || 'https://api.anthropic.com') + '/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey || '', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: conn.model || cfg.model, max_tokens: agent.maxTokens, temperature: agent.temperature, system: systemContent, messages: [{ role: 'user', content: userContent }] }),
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
    } else if (prov === 'local') {
      // Local downloaded model — OpenAI-compatible, uses per-agent baseUrl or hub localServerUrl
      const hub = (settings && settings.hub) || {};
      const base = (conn.baseUrl || hub.localServerUrl || 'http://localhost:1234/v1').replace(/\/$/, '');
      const r = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: conn.model, temperature: agent.temperature, max_tokens: agent.maxTokens, messages }),
      });
      const j = await r.json();
      result = j?.choices?.[0]?.message?.content || JSON.stringify(j);
    } else {
      // openai-compatible: openai + lmstudio
      const base = conn.baseUrl || cfg.baseUrl || 'http://localhost:1234/v1';
      const headers = { 'content-type': 'application/json', ...(cfg.apiKey ? { authorization: 'Bearer ' + cfg.apiKey } : {}) };
      for (let round = 0; round < maxToolRounds; round++) {
        const body = {
          model: conn.model || cfg.model,
          temperature: agent.temperature,
          max_tokens: agent.maxTokens,
          messages,
          ...(toolSchemas.length ? { tools: toolSchemas, tool_choice: 'auto' } : {}),
        };
        const r = await fetch(base.replace(/\/$/, '') + '/chat/completions', {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
        const j = await r.json();
        const msg = j?.choices?.[0]?.message;
        const calls = msg?.tool_calls || [];
        if (!calls.length) {
          result = msg?.content || JSON.stringify(j);
          break;
        }

        messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
        for (const tc of calls) {
          const name = tc?.function?.name || '';
          let args = {};
          try { args = JSON.parse(tc?.function?.arguments || '{}'); }
          catch (e) { args = {}; }
          Store.log(`[TOOL] ${agent.name} → ${name}`, agent.color);
          const content = await executeAgentTool(name, args, { settings });
          Store.log(`[TOOL] ${name} ← ${snippet(content)}`, '#5cc8ff');
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name,
            content,
          });
        }
      }
      if (!result) result = '[tool loop stopped] The agent reached the tool-call round limit before producing a final answer.';
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

// Nova diagnoses which V-Model agent caused an issue and assigns a rule to it.
// Called after the user submits feedback with notes. Uses Nova's live model;
// falls back to manual assignment (chip + notes) in Demo mode.
async function analyzeAndAssignRule(task, feedback, agents, settings, liveMode) {
  const TRIO = { req: 'Spec', code: 'Forge', test: 'Probe' };
  const trace = task.trace || task.steps || [];
  const trioAgents = agents.filter((a) => TRIO[a.id]);
  if (!trioAgents.length || !feedback.notes) return null;

  // Demo mode: if user picked a chip and left notes, propose as a manual rule (no auto-save)
  if (!liveMode) {
    if (feedback.weakLink) {
      const match = trioAgents.find((a) => a.name === feedback.weakLink);
      if (match) {
        return { agentId: match.id, agentName: match.name, rule: feedback.notes.slice(0, 80) };
      }
    }
    return null;
  }

  // Live mode: let Nova read each agent's JD + output and diagnose
  const nova = agents.find((a) => a.id === 'nova') || agents[0];

  const agentContext = trioAgents.map((a) => {
    const step = trace.find((s) => s.agentId === a.id);
    const jd = (a.systemPrompt || '').slice(0, 250);
    const out = step ? String(step.assistant || step.output || '').slice(0, 350) : '(no output recorded)';
    return `${a.name} [${a.id}]\n  JD: ${jd}…\n  Output: ${out}`;
  }).join('\n\n');

  const prompt = `You are Nova, the project manager. A V-Model coding pipeline finished and the user flagged an issue.

TASK: "${task.title}"${task.body ? '\n' + task.body : ''}

PIPELINE OUTPUTS (what each agent actually produced):
${agentContext}

USER FEEDBACK:
Rating: ${feedback.rating}/5
Notes: "${feedback.notes}"${feedback.weakLink ? '\nUser suspects: ' + feedback.weakLink : ''}

AGENT RESPONSIBILITIES:
- Spec [req]: Writes the requirements spec — scope, acceptance criteria, constraints, edge cases. Never writes code.
- Forge [code]: Writes the implementation — code only, no explanation. Follows the spec exactly.
- Probe [test]: Verifies the implementation against the spec — verdict, findings, corrected code if needed.

DIAGNOSIS INSTRUCTIONS:
1. Read the feedback notes literally. If the user says "only N items", "too many", "too few", "missing X", "wrong format" — that is a scope/quantity/format issue, not a quality issue.
2. Match the complaint to the agent whose output caused it:
   - Spec output wrong/incomplete → agentId: req
   - Code wrong/broken/too much/too little → agentId: code
   - Tests wrong/too many/missing/bad format → agentId: test
3. Write a rule that directly prevents the exact complaint. If the feedback says "generate only 1 test case", the rule must say something like "Generate exactly one test case unless the spec explicitly requests more." Do NOT generalise into an unrelated concern.
4. The rule must be ≤20 words, imperative, and specific.

Return ONLY this JSON object, nothing else:
{"agentId":"req","agentName":"Spec","rule":"..."}

Valid agentId values: req, code, test.`;

  try {
    const analyzer = { ...nova, systemPrompt: 'You output only valid JSON. No prose, no markdown fences, just the JSON object.' };
    const resp = await callModel(analyzer, prompt, { settings, liveMode });
    // extract JSON from response
    let json = null;
    const fenced = resp.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) { try { json = JSON.parse(fenced[1].trim()); } catch {} }
    if (!json) { const raw = resp.match(/\{[\s\S]*\}/); if (raw) try { json = JSON.parse(raw[0]); } catch {} }
    if (!json || !json.agentId || !json.rule || !TRIO[json.agentId]) return null;
    // Return proposal only — caller confirms before saving
    return { agentId: json.agentId, agentName: json.agentName || TRIO[json.agentId], rule: json.rule };
  } catch {
    return null;
  }
}

// ── GEPA + training data (P6+) ─────────────────────────────────────────────
// The V-Model coding trio whose traces feed learning.
const TRIO_IDS = ['req', 'code', 'test'];

// Robust JSON extraction from a model response (handles ```fences``` and bare objects/arrays).
function extractJSON(resp) {
  if (!resp) return null;
  const fenced = resp.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1].trim()); } catch {} }
  // try the largest object or array
  const obj = resp.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch {} }
  const arr = resp.match(/\[[\s\S]*\]/);
  if (arr) { try { return JSON.parse(arr[0]); } catch {} }
  return null;
}

// Tasks that qualify as training/analysis material: completed, have a trace,
// have feedback at or above the rating threshold.
function qualifyingTasks(tasks, { threshold = 3, includeExported = false } = {}) {
  return (tasks || []).filter((t) =>
    t.status === 'done' &&
    Array.isArray(t.trace) && t.trace.length > 0 &&
    t.feedback && (t.feedback.rating || 0) >= threshold &&
    (includeExported || !t.exported)
  );
}

// Turn qualifying tasks into chat-format training records — ONE per trace step.
// system = the agent's role prompt actually used (no rule scaffold, so the model
// learns the behaviour into weights); user = step input; assistant = the produced
// output, swapped for the user's correctedOutput on the final step when present.
function buildTrainingRecords(tasks, opts = {}) {
  const records = [];
  const usedTaskIds = [];
  for (const t of qualifyingTasks(tasks, opts)) {
    const trace = t.trace;
    const lastIdx = trace.length - 1;
    let added = false;
    trace.forEach((step, i) => {
      const system = (step.system || '').trim();
      const user = (step.user || '').trim();
      let assistant = (step.assistant || step.output || '').trim();
      // user-supplied fix wins for the final deliverable
      if (i === lastIdx && t.feedback?.correctedOutput) assistant = String(t.feedback.correctedOutput).trim();
      if (!system || !user || !assistant) return;
      records.push({ messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
        { role: 'assistant', content: assistant },
      ], _agentId: step.agentId, _taskId: t.id });
      added = true;
    });
    if (added) usedTaskIds.push(t.id);
  }
  return { records, taskIds: usedTaskIds };
}

// GEPA-style cross-trace analysis: unlike the per-task Nova diagnosis (P5), this
// reads ALL of one agent's traces + feedback together, finds recurring failure
// patterns, and proposes an EVOLVED rule set (refine / merge / drop / add).
// Returns { proposed:[string], rationale, samples } or null.
async function runGEPA(agentId, { tasks, agents, settings, liveMode } = {}) {
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) return null;

  // gather this agent's steps across every completed, feedback-bearing task
  const samples = [];
  for (const t of (tasks || [])) {
    if (t.status !== 'done' || !Array.isArray(t.trace) || !t.feedback) continue;
    const step = t.trace.find((s) => s.agentId === agentId);
    if (!step) continue;
    samples.push({
      task: t.title,
      rating: t.feedback.rating,
      notes: t.feedback.notes || '',
      weakLink: t.feedback.weakLink || '',
      input: String(step.user || '').slice(0, 300),
      output: String(step.assistant || step.output || '').slice(0, 400),
    });
  }
  if (samples.length < 1) return null;

  const currentRules = (agent.rules || []).map((r, i) => `${i + 1}. ${r.text}${r.confirmed ? ' [PROVEN — keep]' : ''}`).join('\n') || '(none yet)';

  // Demo / offline: no model — return current rules unchanged so the UI still works.
  if (!liveMode) {
    return { proposed: (agent.rules || []).map((r) => r.text), rationale: 'Live mode off — GEPA needs a model to evolve rules. Showing current rules unchanged.', samples: samples.length };
  }

  const nova = agents.find((a) => a.id === 'nova') || agents[0];
  const sampleBlock = samples.map((s, i) =>
    `RUN ${i + 1} — rating ${s.rating}/5${s.weakLink ? ` (user flagged: ${s.weakLink})` : ''}\n  Input: ${s.input}\n  ${agent.name} produced: ${s.output}\n  Feedback: ${s.notes || '(none)'}`
  ).join('\n\n');

  const prompt = `You are GEPA, an offline optimiser for the agent "${agent.name}".

Its fixed role: ${(agent.systemPrompt || '').slice(0, 300)}

CURRENT LEARNED RULES:
${currentRules}

EXECUTION HISTORY (${samples.length} past runs with user feedback):
${sampleBlock}

Your job: read the traces to understand WHY runs scored low, not just that they did. Then EVOLVE the rule set:
- MERGE rules that overlap into one sharper rule.
- REFINE vague rules into specific, testable ones grounded in the failures above.
- DROP rules that no run supports or that contradict newer evidence.
- ADD at most 2 new rules ONLY for a failure pattern that recurs across runs.
- ALWAYS keep any rule marked [PROVEN — keep].
- Each rule ≤20 words, imperative, specific. Total ≤12 rules. Prefer fewer, stronger rules.

Return ONLY this JSON, nothing else:
{"rationale":"one sentence on what you changed and why","rules":["rule 1","rule 2"]}`;

  try {
    const optimiser = { ...nova, systemPrompt: 'You output only valid JSON. No prose, no markdown fences, just the JSON object.' };
    const resp = await callModel(optimiser, prompt, { settings, liveMode });
    let json = null;
    const fenced = resp.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) { try { json = JSON.parse(fenced[1].trim()); } catch {} }
    if (!json) { const raw = resp.match(/\{[\s\S]*\}/); if (raw) try { json = JSON.parse(raw[0]); } catch {} }
    if (!json || !Array.isArray(json.rules)) return null;
    const proposed = json.rules.map((r) => String(r).trim()).filter(Boolean).slice(0, 12);
    return { proposed, rationale: json.rationale || 'Evolved rule set from execution traces.', samples: samples.length };
  } catch {
    return null;
  }
}

// ── Hermes-style GEPA loop (Genetic-Pareto skill evolution) ────────────────
// Mirrors NousResearch/hermes-agent-self-evolution: instead of one-shot rule
// editing (runGEPA above), this runs the full evolutionary loop:
//   1. Reflective failure analysis — read traces, write "why it failed" notes
//   2. Candidate generation — propose K diverse skill-set variants (mutations)
//   3. Multi-objective evaluation — LLM-as-judge rubric scores each variant on
//      success (would it prevent the failures?) × conciseness; bloat measured
//      locally as a length penalty
//   4. Pareto selection — pick the non-dominated winner (max success, min bloat)
// Returns { analysis, candidates:[{id,label,strategy,rules,scores}], winnerId,
//           paretoFront:[ids], samples } or null. No weights are touched — this
//           is prompt-level (rules[]) evolution, shipped only after human review.

const GEPA_K = 4; // number of candidate variants per evolution round

// local bloat metric: total characters across a rule set, normalised 0..1
function ruleSetBloat(rules) {
  const chars = rules.reduce((n, r) => n + String(r).length, 0);
  // ~600 chars (≈ a dozen tight rules) maps to ~1.0
  return Math.min(1, chars / 600);
}

// Pareto: candidate A dominates B if A.success >= B.success AND A.bloat <= B.bloat
// with at least one strict. Returns the set of non-dominated candidate ids.
function paretoFront(cands) {
  const ids = [];
  for (const a of cands) {
    const dominated = cands.some((b) =>
      b !== a &&
      b.scores.success >= a.scores.success &&
      b.scores.bloat <= a.scores.bloat &&
      (b.scores.success > a.scores.success || b.scores.bloat < a.scores.bloat)
    );
    if (!dominated) ids.push(a.id);
  }
  return ids;
}

async function runHermesGEPA(agentId, { tasks, agents, settings, liveMode, k = GEPA_K } = {}) {
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) return null;

  // gather this agent's feedback-bearing runs (same source as runGEPA)
  const samples = [];
  for (const t of (tasks || [])) {
    if (t.status !== 'done' || !Array.isArray(t.trace) || !t.feedback) continue;
    const step = t.trace.find((s) => s.agentId === agentId);
    if (!step) continue;
    samples.push({
      task: t.title,
      rating: t.feedback.rating,
      notes: t.feedback.notes || '',
      weakLink: t.feedback.weakLink || '',
      input: String(step.user || '').slice(0, 300),
      output: String(step.assistant || step.output || '').slice(0, 400),
    });
  }
  if (samples.length < 1) return null;

  const current = (agent.rules || []);
  const currentText = current.map((r, i) => `${i + 1}. ${r.text}${r.confirmed ? ' [PROVEN — keep]' : ''}`).join('\n') || '(none yet)';
  const role = (agent.systemPrompt || '').slice(0, 300);
  const sampleBlock = samples.map((s, i) =>
    `RUN ${i + 1} — rating ${s.rating}/5${s.weakLink ? ` (user flagged: ${s.weakLink})` : ''}\n  Input: ${s.input}\n  Produced: ${s.output}\n  Feedback: ${s.notes || '(none)'}`
  ).join('\n\n');

  // Offline / demo: no model — degrade to current rules as the single candidate.
  if (!liveMode) {
    const rules = current.map((r) => r.text);
    const cand = { id: 'c0', label: 'Current (offline)', strategy: 'unchanged', rules,
      scores: { success: 50, clarity: 50, bloat: ruleSetBloat(rules), rationale: 'Live mode off — Hermes GEPA needs a model to analyse, mutate and judge.' } };
    return { analysis: 'Live mode off — showing current rules unchanged. Enable Live + a backend to run the full evolutionary loop.',
      candidates: [cand], winnerId: 'c0', paretoFront: ['c0'], samples: samples.length };
  }

  const nova = agents.find((a) => a.id === 'nova') || agents[0];
  const jsonModel = (sys) => ({ ...nova, systemPrompt: sys || 'You output only valid JSON. No prose, no markdown fences, just the JSON value.' });

  // ── Stage 1: reflective failure analysis ────────────────────────────────
  let analysis = '';
  try {
    const aPrompt = `You are GEPA's reflective analyser for the agent "${agent.name}".
Role: ${role}

CURRENT RULES:
${currentText}

EXECUTION HISTORY (${samples.length} runs):
${sampleBlock}

Read the traces and explain WHY low-rated runs failed — the recurring failure MODES, not just symptoms. Be concrete and grounded in the runs above.
Return ONLY JSON: {"analysis":"2-3 sentences on the root failure modes","modes":["short failure mode 1","short failure mode 2"]}`;
    const aResp = await callModel(jsonModel(), aPrompt, { settings, liveMode });
    const aJson = extractJSON(aResp);
    analysis = (aJson && aJson.analysis) ? aJson.analysis : 'Analysed execution traces for recurring failure modes.';
  } catch { analysis = 'Analysed execution traces for recurring failure modes.'; }

  // ── Stage 2: candidate generation (K diverse variants) ──────────────────
  let variants = [];
  try {
    const STRATEGIES = ['minimal (fewest, sharpest rules)', 'comprehensive (cover every failure mode)', 'refine-existing (keep structure, sharpen wording)', 'aggressive-merge (collapse overlaps, drop weak rules)'].slice(0, k);
    const gPrompt = `You are GEPA's mutation engine for the agent "${agent.name}".
Role: ${role}

FAILURE ANALYSIS: ${analysis}

CURRENT RULES:
${currentText}

EXECUTION HISTORY:
${sampleBlock}

Produce ${k} DISTINCT candidate rule-sets, one per strategy below. Each must directly address the failure modes. ALWAYS keep any rule marked [PROVEN — keep]. Each rule ≤20 words, imperative, specific. Prefer fewer, stronger rules.

Strategies (use exactly these, in order):
${STRATEGIES.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Return ONLY JSON array of ${k} objects:
[{"strategy":"<the strategy>","rules":["rule 1","rule 2"]}]`;
    const gResp = await callModel(jsonModel(), gPrompt, { settings, liveMode });
    const gJson = extractJSON(gResp);
    if (Array.isArray(gJson)) {
      variants = gJson.map((v) => ({
        strategy: String(v.strategy || 'variant'),
        rules: (Array.isArray(v.rules) ? v.rules : []).map((r) => String(r).trim()).filter(Boolean).slice(0, 12),
      })).filter((v) => v.rules.length);
    }
  } catch {}
  // always include the current set as a baseline candidate
  variants.unshift({ strategy: 'current (baseline)', rules: current.map((r) => r.text) });
  // de-dup identical rule-sets, drop empties (keep baseline even if empty)
  const seen = new Set();
  variants = variants.filter((v, i) => {
    const key = v.rules.join('||');
    if (i > 0 && (!v.rules.length || seen.has(key))) return false;
    seen.add(key); return true;
  });
  if (variants.length < 2) return null; // nothing meaningful to choose between

  const candidates = variants.map((v, i) => ({
    id: 'c' + i,
    label: i === 0 ? 'Baseline' : `Variant ${i}`,
    strategy: v.strategy,
    rules: v.rules,
    scores: { success: 0, clarity: 0, bloat: ruleSetBloat(v.rules), rationale: '' },
  }));

  // ── Stage 3: multi-objective evaluation (LLM-as-judge rubric) ────────────
  await Promise.all(candidates.map(async (c) => {
    try {
      const jPrompt = `You are GEPA's judge for the agent "${agent.name}".
Role: ${role}

Evaluate this CANDIDATE rule-set against the agent's real failure history. Would these rules, if injected into the agent's prompt, have PREVENTED the complaints below?

CANDIDATE RULES (strategy: ${c.strategy}):
${c.rules.length ? c.rules.map((r, i) => `${i + 1}. ${r}`).join('\n') : '(no rules)'}

FAILURE HISTORY:
${sampleBlock}

Score on a rubric:
- success (0-100): how well these rules prevent the documented failures / satisfy the feedback
- clarity (0-100): how specific, testable and unambiguous the rules are (penalise vague or contradictory rules)

Return ONLY JSON: {"success":<int>,"clarity":<int>,"rationale":"one sentence"}`;
      const jResp = await callModel(jsonModel(), jPrompt, { settings, liveMode });
      const j = extractJSON(jResp) || {};
      c.scores.success = Math.max(0, Math.min(100, Number(j.success) || 0));
      c.scores.clarity = Math.max(0, Math.min(100, Number(j.clarity) || 0));
      c.scores.rationale = String(j.rationale || '').slice(0, 200);
    } catch {
      c.scores.success = 0; c.scores.clarity = 0; c.scores.rationale = 'evaluation failed';
    }
  }));

  // ── Stage 4: Pareto selection (max success, min bloat) ───────────────────
  const front = paretoFront(candidates);
  // winner = highest success on the Pareto front; tie-break: lower bloat, then higher clarity
  const winner = candidates
    .filter((c) => front.includes(c.id))
    .sort((a, b) =>
      b.scores.success - a.scores.success ||
      a.scores.bloat - b.scores.bloat ||
      b.scores.clarity - a.scores.clarity
    )[0];

  return {
    analysis,
    candidates,
    winnerId: winner ? winner.id : candidates[0].id,
    paretoFront: front,
    samples: samples.length,
  };
}

Object.assign(window, { useStore, Store, callModel, buildSystemPrompt, analyzeAndAssignRule, buildTrainingRecords, runGEPA, runHermesGEPA, paretoFront, ruleSetBloat, qualifyingTasks, TRIO_IDS, SIM_ACTIONS, ROOM_THEMES, TOOL_LIBRARY });
