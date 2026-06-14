# 07 · Extending — recipes

Practical, copy-pasteable patterns. Keep the `window`-export rule (doc 02) and the
Demo-mode fallback (doc 04) intact.

---

## Add a new character (sprite)

1. In `sprites.jsx`, author three **14×14** matrices (`_A`, `_B` walk frames, `_I`
   idle). Use the legend `# s o x g d .` (doc 05).
2. Register it:
   ```js
   const SPRITES = { …, drone: { walk: [DRONE_A, DRONE_B], idle: [DRONE_I] } };
   const SPRITE_LIST = [ …, { id: 'drone', label: 'Drone' } ];
   ```
3. Done — the editor picker, office, cards, graph, and pipeline all read
   `SPRITE_LIST` / `agent.sprite` automatically.
4. **Validate dimensions.** Every row must be exactly 14 chars and there must be 14
   rows, or the canvas draw will look wrong. Eyeball it by rendering a montage, or
   assert `frame.length === 14 && frame.every(r => r.length === 14)`.

## Add a model provider

1. In `callModel` (`store.jsx`) add a branch for the new `provider`, mapping the
   agent's prompt/params to that API's request shape and reading its response text.
   Wrap network work so the existing `try/catch` fallback still applies.
2. Add a default block to `state.settings` (baseUrl/model/apiKey) in
   `defaultState()`.
3. Add the option to the **Provider** `<select>` in `EditorDrawer` and a section to
   `SettingsDrawer`.

## Add an agent field

1. Add it to the agent factory `mk(...)` (and `addAgent`) in `store.jsx` with a sane
   default so existing saved agents still work (read with `agent.newField ?? default`).
2. Add a control in `EditorDrawer` that calls `up({ newField: value })`.
3. If it affects behaviour, read it in `engine.jsx` / `callModel`.

> Migration note: existing users have a saved `agentPlayground.v1` blob. New fields
> are simply `undefined` for them until edited — always provide defaults. A hard
> reset is `Store.reset()` (wipes their customisation), so prefer additive,
> default-tolerant changes.

## Add a new view / page

1. Write `lib/myview.jsx` exporting `MyView` to `window`.
2. Add its `<script>` tag before `app.jsx` in the HTML.
3. Add a nav item in `Sidebar` (`Store.set({ view: 'myview' })`) and a route line in
   `<App>`’s routed area.

## Add a tool / capability

`TOOL_LIBRARY` in `store.jsx` is the master list shown as chips in the editor. Tools
are currently **labels** (UI + intent), not executed. To make a tool *do* something,
gate logic inside `runTask` / `callModel` on `agent.tools.includes('toolName')`.

## Make image tasks reach the model (vision)

Today `runTask` threads only text. To support image tasks, when
`task.kind === 'image'` and the agent's provider supports vision, pass the
`task.image` data URL in the provider's multimodal message format (e.g. OpenAI
`image_url` content parts, or Anthropic image blocks) inside `callModel`.

## Upgrade the pipeline to branch/fan-out

`pipelineFrom` is deliberately linear (first outgoing edge only). To support
fan-out, replace it with a traversal that visits **all** outgoing edges (BFS/DAG),
and have `runTask` await each branch — feeding the right `payload` into each.

## Add a Tweak

Add a key to `TWEAK_DEFAULTS` in `app.jsx`, render a `Tweak*` control inside
`<TweaksPanel>`, and read `t.yourKey` where needed. Persistence is automatic via
`useTweaks`.

---

## Quick reference — exported globals by file

| File | Exports |
|------|---------|
| `sprites.jsx` | `PixelSprite, SPRITES, SPRITE_LIST, shade, lighten, Zzz, SpeechBubble, MessengerDot, MonitorWall, RoomFloor` |
| `store.jsx` | `Store, useStore, callModel, SIM_ACTIONS, ROOM_THEMES, TOOL_LIBRARY` |
| `engine.jsx` | `startEngine, runTask, triggerVisit, pipelineFrom` |
| `office.jsx` | `OfficeView` |
| `editor.jsx` | `EditorDrawer, SettingsDrawer` |
| `tasks.jsx` | `TasksView` |
| `connections.jsx` | `ConnectionsView` |
| `tweaks-panel.jsx` | `useTweaks, TweaksPanel, TweakSection, TweakSlider, TweakToggle, TweakRadio, TweakSelect, TweakText, TweakNumber, TweakColor, TweakButton` |

## Gotchas

- **html-to-image screenshots can't render the fixed drawers** reliably; that's a
  tooling quirk, not a bug — the drawers work in a real browser.
- **`useStore` re-renders on any change** — fine at this scale; add selectors if it
  grows.
- **Don't reach LM Studio from a hosted preview** — `localhost` is unreachable
  there; test Live mode locally with CORS enabled.
