# 03 · Data model

All state is one plain object held by `window.Store` (in `store.jsx`) and persisted
to `localStorage` key **`agentPlayground.v1`**.

## Top-level state shape

```js
{
  view: 'office' | 'tasks' | 'connections',   // which main page is shown
  liveMode: false,                             // false = simulate, true = real model calls
  agents: [ Agent, … ],
  connections: [ { from: agentId, to: agentId }, … ],   // directed edges
  tasks: [ Task, … ],
  nodePos: { [agentId]: { x, y } },            // saved positions in the Connections graph
  settings: {
    lmstudio:  { baseUrl: 'http://localhost:1234/v1', model: 'local-model' },
    openai:    { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '' },
    anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-latest', apiKey: '' },
    tools:     { baseUrl: 'http://localhost:4173', enabled: true, maxRounds: 6 },
  },
  ticker: [ { t: epochMs, msg: string, color: hex }, … ],   // newest first, capped at 40
  visits: [ Visit, … ],   // TRANSIENT — never persisted

  // UI flags (set by the app, also persisted):
  editing: agentId | null,   // which agent's editor drawer is open
  settingsOpen: boolean,     // is the Settings drawer open
}
```

## Agent

```js
{
  id: 'nova',
  name: 'Nova',
  color: '#a06bff',                 // hex; tints the sprite and room accents
  sprite: 'octo',                   // one of SPRITE_LIST ids: octo|person|robot|cat|car|rocket
  roomKey: 'command',               // key into ROOM_THEMES
  role: 'command',                  // selects SIM_ACTIONS phrase pool (simulation only)
  status: 'active',                 // active | ondemand | idle
  systemPrompt: 'You are Nova, …',
  connection: {                     // which backend THIS agent uses
    provider: 'lmstudio',           // lmstudio | openai | anthropic | demo
    model: 'local-model',
    baseUrl: 'http://localhost:1234/v1',
    apiKey: '',
  },
  temperature: 0.7,
  maxTokens: 1024,
  schedule: 'always',               // always | ondemand | every
  everyHours: 12,                   // used when schedule === 'every'
  tools: ['memory', 'web.search'],  // subset of TOOL_LIBRARY (UI/labelling only)
  action: '',                       // current speech-bubble text when active
  lastRunMs: 1700000000000,         // epoch ms of last run (drives "last run / next run")
}
```

## Task

```js
{
  id: 't1',
  kind: 'text' | 'image',
  title: 'Summarise weekly signals',
  body: 'Pull the latest signals …',   // fed to the first agent
  image: null | dataURL,                // base64 data URL if an image was attached
  status: 'queued' | 'running' | 'done',
  assignee: 'cobalt',                   // agent the pipeline starts from
  createdMs: epochMs,
  result?: string,                      // final pipeline output, set when done
}
```

## Visit (transient animation)

```js
{ id, from: agentId, to: agentId, color: hex, sprite: spriteId, phase: 'go' | 'back' }
```

## Constants (also in `store.jsx`)

- **`ROOM_THEMES`** — `{ command, observatory, security, research, workshop, studio }`,
  each `{ label, theme }` (uppercase label + accent hex).
- **`TOOL_LIBRARY`** — `['web.search','files.read','files.write','shell','memory','vision','code.run','email']`.
  `files.read` and `files.write` now enable real local file tool schemas when the
  Tool Bridge is online.
- **`SIM_ACTIONS`** — speech-bubble phrase pools keyed by `role`
  (`general, research, security, command, build, studio`).

## The `Store` API

| Method | Purpose |
|--------|---------|
| `Store.get()` | Current state object (do not mutate in place). |
| `Store.set(patch)` | Shallow-merge `patch`, or pass a function `(s) => newState`. Persists + notifies. |
| `Store.subscribe(fn)` | Register a listener; returns an unsubscribe fn. (Used by `useStore`.) |
| `Store.reset()` | Restore the full default state (six agents, default connections, etc.). |
| `Store.updateAgent(id, patch)` | Patch one agent. `patch` may be an object or `(agent) => patch`. |
| `Store.addAgent()` | Append a new default agent in the next free room; returns its id. |
| `Store.removeAgent(id)` | Delete an agent and any connections touching it. |
| `Store.toggleConnection(from, to)` | Add the edge if absent, remove it if present. |
| `Store.log(msg, color)` | Prepend an entry to the ticker (auto-capped at 40). |

### React binding

```js
const [s, store] = useStore();   // s === Store.get(); store === Store
// read s.agents, s.view, …; write with store.updateAgent(...), Store.set(...), etc.
```

`useStore` re-renders the calling component on **any** store change.
