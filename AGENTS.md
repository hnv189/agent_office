# AGENTS.md — Read this first

This file is the entry point for any AI agent (or developer) working on the
**Agent Playground** project. Read it top-to-bottom, then dive into `docs/`.

---

## What this project is

Agent Playground is a **single-page, front-end-only web app** that visualises a
team of AI agents as little pixel-art creatures living in a retro "Mission
Control" office. Each agent has its own themed room. When an agent is working it
**walks around and shows a speech bubble**; when idle it **sits and sleeps
(ZZZ)**. Agents can be wired together into pipelines, and a task (text + optional
image) can be pushed through that pipeline to make the agents act.

It runs in two modes:

- **Demo mode** (default) — agent "thinking" is simulated locally. Nothing leaves
  the browser. Good for previewing the experience anywhere.
- **Live mode** — agents make **real model calls** to local or cloud backends
  (**LM Studio**, **OpenAI**, **Anthropic**). Only works when the file is opened
  from the user's own machine (a hosted sandbox cannot reach `localhost`).

There is **no server and no build step**. It is plain HTML + React (via in-browser
Babel) + CSS. All state lives in the browser's `localStorage`.

---

## How to run it

Just open `Agent Playground.html` in a browser. For Live mode against LM Studio,
start LM Studio's server on `http://localhost:1234` **with CORS enabled**, then
flip Demo → Live in the app's Settings.

---

## Where everything lives

```
Agent Playground.html     # the only HTML file; loads React + Babel + all lib/*.jsx
lib/
  tweaks-panel.jsx        # 3rd-party-style Tweaks panel shell (do not rewrite)
  sprites.jsx             # pixel-art sprite engine + room decor primitives
  store.jsx               # global state, defaults, persistence, model-call layer
  engine.jsx              # simulation loop, room-to-room visits, task pipeline runner
  office.jsx              # the main "Agent Office" view
  editor.jsx              # per-agent editor drawer + global Settings drawer
  tasks.jsx               # Tasks view (composer + queue)
  connections.jsx         # node-graph view of agent-to-agent links
  app.jsx                 # shell: sidebar, routing, tweaks, mounts <App/>
  base.css                # tokens, shell, sidebar, office styles
  ui.css                  # drawers, forms, tasks, connections styles
docs/                     # reference documentation (read these)
```

---

## The one architectural rule you must respect

Each `<script type="text/babel">` file is compiled in its own scope, so **shared
symbols are exported onto `window`** at the bottom of each file via
`Object.assign(window, { ... })`. Files are loaded in **dependency order** in the
HTML (`sprites → store → engine → office/editor/tasks/connections → app`). If you
add a file, export its public symbols and insert the `<script>` tag in the right
place.

State is **not** React context. There is one vanilla pub/sub store (`window.Store`)
and a thin hook (`useStore`) that re-renders subscribers on any change. Mutate
state only through `Store` methods — never reassign `window.Store.get()`.

---

## Documentation index (`docs/`)

Read in this order:

1. `docs/01-concept.md` — the metaphor, vocabulary, and product behaviour.
2. `docs/02-architecture.md` — files, load order, the window-export pattern, data flow.
3. `docs/03-data-model.md` — the full state shape and the `Store` API.
4. `docs/04-engine-and-models.md` — simulation loop, visits, task pipeline, the model-call layer, Demo vs Live.
5. `docs/05-rendering-and-sprites.md` — the pixel sprite engine, characters, rooms, animations.
6. `docs/06-views-and-ui.md` — each view/drawer, the sidebar, and the Tweaks panel.
7. `docs/07-extending.md` — recipes: add a character, a model provider, a view, a tool, an agent field.

---

## Conventions & guardrails

- **Pixel art is data, not hand-drawn SVG.** Sprites are 14×14 character matrices
  in `sprites.jsx` drawn to a `<canvas>`. Keep new frames exactly 14×14.
- **Colour comes from the agent.** A sprite is tinted by one agent colour; the
  matrix legend (`# s o x g d`) maps to derived shades — see doc 05.
- **Never break Demo mode.** Live calls are wrapped in `try/catch` and fall back to
  the simulator. Keep that fallback.
- **Don't clobber `localStorage`** keys other than `agentPlayground.v1`.
- **Keep files small** and keep the window-export pattern intact.
- This is an **original** design — the creatures and names (Nova, Cobalt, Ember,
  Rosa, Sol, Clay) are not based on any trademarked characters. Keep it that way.
