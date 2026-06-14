# 06 · Views & UI

The shell lives in `app.jsx`. It renders the **sidebar**, routes the main area by
`state.view`, mounts both drawers, and renders the **Tweaks** panel. The routed
views are wrapped in an `ErrorBoundary` (keyed by `view`) so a render error in one
view shows a recoverable message instead of blanking the whole app.

## Sidebar — `Sidebar` (`app.jsx`)

"MISSION CONTROL" branding with the always-on agent's sprite, an online status
line, and nav items:

- **Agent Office** → `view: 'office'`
- **Tasks** → `view: 'tasks'`
- **Connections** → `view: 'connections'`
- **Settings** → opens the Settings drawer (`settingsOpen: true`)

Footer: **+ Add agent** (`Store.addAgent()` then opens the editor on the new id)
and a **DEMO/LIVE** pill (`liveMode` toggle).

## Agent Office — `OfficeView` (`office.jsx`)

The hero view. Composed of:

- **`AgentRoom`** (one per agent) — themed room with `MonitorWall` + `RoomFloor`, a
  status dot, and the agent. When `active`, the sprite walks (position animates to
  random x targets, `flip` follows direction) with a `SpeechBubble`; when not, it
  shows `Zzz`. Clicking a room opens that agent's editor.
- **`TravelLayer` / `TravelSprite`** — overlay that renders any in-flight
  **visits**, tweening a sprite between the two rooms' centres (computed from refs).
- **`Ticker`** — the scrolling LIVE feed from `state.ticker`.
- **`AgentCard`** (one per agent, in a row beneath) — mini sprite, name, status
  badge, and "last run / next run" derived from `lastRunMs`, `schedule`,
  `everyHours`. Clicking a card opens the editor.

Grid is responsive (`repeat(auto-fill, minmax(330px, 1fr))`) so it shows 1 column
on narrow screens and 3+ on a wide desktop, matching the reference.

## Tasks — `TasksView` (`tasks.jsx`)

- **`TaskComposer`** — title, body, an **image drop/picker** (read as a data URL),
  and a "Start with" agent select that previews the resulting `pipelineFrom` chain.
  Adds a `Task` to the front of `state.tasks`.
- **`TaskRow`** — shows status, body, image thumbnail, the pipeline as sprite chips,
  the final `result` when done, a **run** button (switches to Office and calls
  `runTask`), and a delete button.

## Connections — `ConnectionsView` (`connections.jsx`)

A draggable node graph:

- Agents are nodes positioned from `state.nodePos` (seeded in a circle on first
  view via a `ResizeObserver`). Drag updates `nodePos` live.
- **Click one node then another** to toggle a connection (`Store.toggleConnection`).
- Edges are SVG paths whose **style** is the `graphStyle` tweak —
  `wires` (curved bézier), `ortho` (right-angle), or `beam` (straight + glow). See
  `wirePath(a, b, style)`.
- Animated **flow dots** travel along each edge using CSS `offset-path`.
- A list below mirrors the connections with remove buttons.

## Drawers — `editor.jsx`

Both drawers slide in from the right (animated via the `right` CSS property so they
render reliably). A shared `Drawer` shell provides the scrim, header, body, footer.

### `EditorDrawer` (opened by `state.editing = agentId`)

Edits one agent: hero (sprite + inline name), **Character** picker (`SPRITE_LIST`),
sprite **colour** swatches + custom, **room** + **status**, **system prompt**,
**model connection** (provider/model/baseUrl/apiKey — fields shown conditionally per
provider), **temperature** + **max tokens**, **schedule** (+ interval), and **tools**
chips. Footer has **Delete** and **▶ Run now** (does a one-shot `callModel` and shows
the response inline — works in Live mode, simulated otherwise).

### `SettingsDrawer` (opened by `state.settingsOpen`)

Global **Demo ⇄ Live** switch, a note about CORS/localhost, and default
**LM Studio / OpenAI / Anthropic** connection fields (`state.settings`). Footer has
**Reset everything** (`Store.reset()`).

## Tweaks panel — `app.jsx` + `tweaks-panel.jsx`

Toggled from the host toolbar. Controls:

- **Neon accent** (`accent`) — recolours the UI's primary/active highlights.
- **Agent speed** (`animSpeed`) — global motion speed.
- **Wire style** (`graphStyle`) — the Connections edge rendering.

Defaults live in the `TWEAK_DEFAULTS` block in `app.jsx` (inside the
`EDITMODE-BEGIN/END` markers the host rewrites). Use `useTweaks` + the `Tweak*`
controls from `tweaks-panel.jsx`; don't rewrite that file.
