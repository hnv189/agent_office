# 02 · Architecture

## Stack

- **No framework, no bundler, no server.** Plain HTML.
- **React 18** + **ReactDOM** loaded from CDN (pinned versions with integrity hashes).
- **Babel Standalone** compiles the JSX **in the browser** at load time. Every app
  file is a `<script type="text/babel">`.
- **CSS** is two hand-written files (`base.css`, `ui.css`). No preprocessor.
- **Persistence** is `localStorage` under the key `agentPlayground.v1`.

## File load order (in `Agent Playground.html`)

The order matters because each file publishes symbols to `window` and later files
consume them:

```
react / react-dom / @babel/standalone        (CDN)
lib/tweaks-panel.jsx     → useTweaks, TweaksPanel, Tweak* controls
lib/sprites.jsx          → PixelSprite, SPRITES, SPRITE_LIST, shade, lighten, decor
lib/store.jsx            → Store, useStore, callModel, ROOM_THEMES, TOOL_LIBRARY, SIM_ACTIONS
lib/engine.jsx           → startEngine, runTask, triggerVisit, pipelineFrom
lib/office.jsx           → OfficeView
lib/editor.jsx           → EditorDrawer, SettingsDrawer
lib/tasks.jsx            → TasksView
lib/connections.jsx      → ConnectionsView
lib/app.jsx              → defines <App/> and calls ReactDOM.createRoot(...).render()
```

## The `window`-export pattern (important)

Because Babel gives each `text/babel` script its own module-like scope, components
defined in one file are **not** visible to another unless exported. At the bottom of
each file:

```js
Object.assign(window, { PixelSprite, SPRITES, /* …public symbols… */ });
```

Consumers then just reference the global (`PixelSprite`, `Store`, etc.). When you
add a file:
1. Export its public symbols to `window`.
2. Add its `<script type="text/babel" src="…">` tag **after** its dependencies and
   **before** `app.jsx`.

Style objects must also be uniquely named (never a bare `const styles = {…}`), but
this project mostly uses CSS classes, so that rarely comes up.

## State & data flow

There is exactly **one** store: `window.Store` (defined in `store.jsx`). It is a
small vanilla pub/sub object — **not** React context.

- **Read in React:** `const [s] = useStore();` returns `[Store.get(), Store]` and
  subscribes the component so it re-renders on any store change.
- **Write:** call a `Store` method (`Store.set`, `Store.updateAgent`,
  `Store.toggleConnection`, `Store.log`, …). Every write persists to `localStorage`
  and notifies subscribers.
- **The engine** (`engine.jsx`) reads/writes the same `Store` from a `setInterval`
  loop and from `runTask`, so the UI updates reactively as agents act.

```
user input / engine tick
        │
        ▼
   Store.set(...)  ──►  persist to localStorage
        │
        ▼
   subscribers (useStore) re-render  ──►  views redraw  ──►  PixelSprite repaints canvas
```

`useStore` is intentionally coarse: any store change re-renders every subscriber.
The app is small enough that this is fine. If it grows, add selector-based
memoisation inside `useStore`.

## Transient vs persisted state

`Store.set` persists everything **except** `visits` (stripped before writing —
visits are short-lived animations). `editing` and `settingsOpen` are persisted but
get reset to a clean state on a normal session. See doc 03 for the full shape.
