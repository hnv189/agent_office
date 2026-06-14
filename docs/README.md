# docs/README.md — Documentation index

Reference docs for **Agent Playground**. Start with `../AGENTS.md`, then read these
in order. Everything here describes the code as it actually is — file names,
exported symbols, and state keys are real and can be grepped.

| # | Doc | What it covers |
|---|-----|----------------|
| 01 | [Concept](01-concept.md) | The metaphor, vocabulary, and how the app behaves |
| 02 | [Architecture](02-architecture.md) | Files, load order, the `window`-export pattern, data flow |
| 03 | [Data model](03-data-model.md) | The full state shape + the `Store` API |
| 04 | [Engine & models](04-engine-and-models.md) | Simulation loop, visits, task pipeline, model-call layer, Demo vs Live |
| 05 | [Rendering & sprites](05-rendering-and-sprites.md) | Pixel sprite engine, characters, rooms, animations |
| 06 | [Views & UI](06-views-and-ui.md) | Sidebar, Office, Tasks, Connections, drawers, Tweaks |
| 07 | [Extending](07-extending.md) | Recipes for common changes |

## 30-second mental model

```
        ┌─────────────────────── window.Store (single source of truth) ───────────────────────┐
        │  agents[] · connections[] · tasks[] · settings · nodePos · ticker[] · visits[] · view │
        └───────▲───────────────────────────────────────────────────────────────────▲─────────┘
                │ subscribe (useStore)                                  Store.set()   │
        ┌───────┴────────┐   reads/writes                              ┌──────────────┴───────┐
        │ React views    │ ◀───────────────────────────────────────── │ engine.jsx           │
        │ office/tasks/… │                                             │  startEngine loop    │
        └───────┬────────┘                                             │  runTask pipeline    │
                │ draws                                                │  triggerVisit        │
        ┌───────▼────────┐                                             └──────────┬───────────┘
        │ PixelSprite    │  (sprites.jsx, canvas pixel art)                       │ callModel()
        └────────────────┘                                             ┌──────────▼───────────┐
                                                                       │ LM Studio / OpenAI / │
                                                                       │ Anthropic OR simulate│
                                                                       └──────────────────────┘
```
