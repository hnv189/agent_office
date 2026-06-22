# 04 · Engine & models

Everything that makes agents "act" lives in `engine.jsx` and the model-call layer
in `store.jsx`.

## The simulation loop — `startEngine(getSpeed)`

Started once from `<App>` (`app.jsx`) inside a `useEffect`. It returns a stop
function. It runs a `setInterval` every **2600 ms** and, each tick:

1. For every `active` agent, ~50% of the time it picks a fresh speech-bubble phrase
   from that agent's `SIM_ACTIONS[role]` pool and writes it to `agent.action`.
   Idle agents get their `action` cleared.
2. ~35% of the time it picks a random connection whose `from` agent is active and
   fires a **visit** along it (`triggerVisit`) plus a ticker entry.

`getSpeed` is a callback returning the current `animSpeed` tweak; the engine reads
it live each tick (the loop itself is not restarted when speed changes — a ref is
used so the latest value is always read). `animSpeed` also scales sprite walk
cadence and in-room movement in the views.

## Visits — `triggerVisit(from, to, ms = 1700)`

Pushes a `Visit` (`phase: 'go'`) into `state.visits`, then after `ms` flips it to
`phase: 'back'`, then after `ms*2` removes it. `office.jsx`'s `TravelLayer` reads
the two rooms' on-screen rectangles (via refs + `getBoundingClientRect`) and
tweens an overlay sprite from one room centre to the other and back. Visits are
**transient** and never persisted.

## The pipeline — `pipelineFrom(startId)`

Derives a **linear** chain: start at `startId`, then repeatedly follow the *first*
outgoing connection to an unvisited agent until none remain. So with default edges
`Nova→Cobalt, Nova→Ember, Cobalt→Rosa, Rosa→Sol, Sol→Clay`, `pipelineFrom('nova')`
is `[nova, cobalt, rosa, sol, clay]` (the `Nova→Ember` branch is not included
because only the first edge is followed). This is intentional and simple; if you
need fan-out/branching, this is the function to upgrade.

## Nova planning — `planTask(taskId)`

Live-mode tasks can ask Nova to return a JSON plan before execution. The planner
prompt includes each available agent's id, display name, role, and tool chips.
Returned agent references are normalised so small local models can say `Sol` or
`Forge` and still map to `sol` / `code`.

File-write tasks get one extra guardrail: if the title/body looks like a request
to create, write, modify, edit, patch, update, replace, or save a file, the plan is
forced onto an agent with `files.write` (preferring Sol, then Forge, then Clay).
That keeps simple file operations from accidentally routing through research-only
agents that cannot call `write_file` or `patch_file`.

## Running a task — `runTask(taskId)`

Async. For the task's `assignee` it builds `pipelineFrom(assignee)` and walks it:

1. Mark the task `running`; log the chain to the ticker.
2. `payload` starts as the task `body` (or `title`).
3. For each agent in the chain, in order:
   - set the agent `active` with action `on it!`;
   - if not the first, `triggerVisit(prev, this)` so you see the hand-off;
   - `await callModel(agent, payload, { settings, liveMode })`;
   - the agent's output becomes the next `payload` (output chains forward);
   - log it, set `lastRunMs`, then restore the agent's resting status based on its
     `schedule`.
4. Mark the task `done` and store the final `payload` as `task.result`.

Note: the **image** on an image task is not yet sent to the model — only text is
threaded through. Wiring vision input is a documented extension (doc 07).

## The model-call layer — `callModel(agent, userContent, { settings, liveMode })`

Single entry point for getting a response from an agent. Logic:

- If **not** in Live mode, or the agent's provider is `demo`, return `simulate(...)`.
- **`anthropic`** → `POST {baseUrl}/v1/messages` with headers `x-api-key`,
  `anthropic-version: 2023-06-01`, and `anthropic-dangerous-direct-browser-access:
  true`. Body uses `system`, `messages`, `max_tokens`, `temperature`. Reads
  `json.content[0].text`.
- **`openai` / `lmstudio`** (both OpenAI-compatible) → `POST
  {baseUrl}/chat/completions` with `messages: [system, user]`,
  `Authorization: Bearer …` if an `apiKey` exists. Reads
  `json.choices[0].message.content`.
- If the agent has executable file chips (`files.read` / `files.write`) and the
  local Tool Bridge is enabled, `callModel()` also sends OpenAI-compatible
  function schemas. When the model returns `tool_calls`, the browser calls
  `POST {settings.tools.baseUrl}/api/tools/call`, appends each `role:"tool"`
  result, and continues until the model returns final text or hits
  `settings.tools.maxRounds`.
- Everything is wrapped in `try/catch`; on **any** failure it returns
  `'[offline — simulated] ' + simulate(...)`. **Keep this fallback** — it is what
  makes the app never break in the sandbox or when a backend is down.

`agent.connection` carries the per-agent provider/model/baseUrl/apiKey;
`settings[provider]` holds the global defaults used when the agent doesn't override
them. The agent's own `connection.model` / `connection.baseUrl` win when present.

### `simulate(agent, userContent)`

Returns a short, deterministic-feeling string built from the agent's role phrase
pool and a truncated echo of the input, so Demo mode looks plausible.

## Demo vs Live — practical notes

- The in-app toggle is in **Settings** (`liveMode`), mirrored by the sidebar
  DEMO/LIVE pill.
- A hosted preview **cannot** reach `localhost`, so LM Studio calls only succeed
  when the file is opened locally. Browsers also require **CORS** to be enabled in
  LM Studio's server settings.
- Cloud keys are stored only in `localStorage` on the user's machine.
- Local file tools require launching the Node server with
  `node .claude/serve.js`; plain `python3 -m http.server` can still preview the
  app, but the Tool Bridge will show offline.
