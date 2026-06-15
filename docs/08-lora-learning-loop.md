# 08 — LoRA Learning Loop (V-Model self-improvement)

> Implementation plan for wiring the **lora-finetune** tool into **Agent
> Playground** so a Req → Code → Test pipeline gets measurably better after
> each use. Read `AGENTS.md` and docs `01`–`07` first; this builds on the
> existing engine, store, and model-call layer.

---

## 1. Goal

Run a V-Model pipeline (**Requirements → Code → Test**) inside Agent
Playground. After every run the user gives feedback. That feedback feeds two
learning layers:

1. **Rules layer (immediate, prompt-level).** Learnings are appended to each
   agent's system prompt as numbered rules. Effective on the *next* run, no
   training needed.
2. **LoRA layer (long-term, weight-level).** Good runs become chat-format
   training records. Periodically we fine-tune a LoRA adapter via the
   lora-finetune server, merge it, and point the agents at the new model.

The result: short-term gains every run (rules) and durable, baked-in capability
every training cycle (LoRA).

---

## 2. The two systems

### 2.1 Agent Playground (this repo)
- Browser-only SPA. React via in-browser Babel. No build, no backend.
- State in `localStorage` (`agentPlayground.v1`) via `window.Store`.
- `callModel(agent, userContent, { settings, liveMode })` in `lib/store.jsx`
  already speaks LM Studio / OpenAI / Anthropic and **falls back to
  `simulate()`** on any error. Demo mode must never break.
- `runTask(taskId)` in `lib/engine.jsx` walks a linear pipeline derived by
  `pipelineFrom(startId)`, chaining each agent's output into the next.

### 2.2 lora-finetune (the uploaded tool)
- Python package + **FastAPI** server: `lora-finetune ui --host 127.0.0.1 --port 8000`.
- **CORS is wide open** (`allow_origins=["*"]`) → the browser app can call it
  directly with `fetch`.
- API surface we will use:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET  | `/api/system` | GPU / paths probe |
| GET  | `/api/models` | base models under `models/` |
| GET  | `/api/datasets` | datasets under `data/**` |
| GET  | `/api/runs` | adapters + merged models under `outputs/` |
| POST | `/api/train` | start a training run (returns run dir) |
| GET  | `/api/train/status` | poll training state/loss/eta |
| GET  | `/api/train/events` | **SSE** live training events |
| POST | `/api/chat/load` | load a merged model (or base+adapter) into VRAM |
| POST | `/api/chat/generate` | **SSE** token stream for inference |
| POST | `/api/chat/unload` | free VRAM |
| GET  | `/api/chat/status` | current chat-model state |

- **Training data format** (what `/api/train` consumes from
  `data/<name>/{train,test}.jsonl`):

  ```json
  {"messages":[
    {"role":"system","content":"..."},
    {"role":"user","content":"..."},
    {"role":"assistant","content":"..."}
  ]}
  ```

  Each V-Model step is *already* this shape: `system` = agent prompt,
  `user` = what the agent received, `assistant` = what it produced.

- **Hard constraint — one GPU job at a time.** The server refuses to start
  training while a chat model is loaded, and refuses to load a chat model while
  training runs. So **live inference and training are mutually exclusive**. The
  loop is therefore *batch*: collect feedback → unload → train → reload new
  model. Plan for an explicit "stop serving to train" step; do not assume both
  can run at once.

---

## 3. Architecture

```
┌─────────────────────────── Browser: Agent Playground ───────────────────────────┐
│                                                                                  │
│  Tasks view ──► runTask() ──► Req ─► Code ─► Test   (pipelineFrom)               │
│                                  │      │      │                                  │
│                                  └──────┴──────┘ each step: callModel()           │
│                                          │                                        │
│                                          ▼                                        │
│                                   Feedback form (rating, weak-link, correction)  │
│                                          │                                        │
│              ┌───────────────────────────┼────────────────────────────┐         │
│              ▼                            ▼                             ▼         │
│        Rules layer                 Trace recorder              Learning view      │
│   (append rule to agent      (per-step system/user/assistant   (push data, start │
│    systemPrompt, instant)      triples kept on the task)        train, watch SSE)│
└──────────────┬───────────────────────────┬──────────────────────────┬──────────┘
               │ callModel (provider:"lora")│ POST /api/datasets/append │ POST /api/train
               ▼                            ▼                           ▼
        /api/chat/generate          (new endpoint, §6)            /api/train/events
┌──────────────────────────── localhost:8000  lora-finetune (FastAPI) ─────────────┐
│  models/        data/agent_office/{train,test}.jsonl        outputs/<run>-merged/ │
│  chat (infer) ◄──────────── train ──────────────► merge ──────────► new model    │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Closed loop:** infer with current merged model → user feedback → append good
runs to `data/agent_office/train.jsonl` → unload → train + merge → load new
`outputs/<run>-merged` → infer better. Repeat.

---

## 4. Where the lora-finetune tool lives

**Decision (recommended): vendor it into this repo under `tools/lora-finetune/`.**
Keeps the browser app and its backend versioned together; the two new endpoints
in §6 are committed alongside the UI that calls them. Alternative is to keep it
a separate sibling checkout and only document the URL — simpler git, but the
endpoint patch then lives outside this repo. Pick one before Phase 5.

> The app stays usable with **zero backend** in Demo mode and against
> LM Studio / OpenAI / Anthropic. The lora-finetune server is only required for
> the LoRA provider and the training loop.

---

## 5. Data model changes (`lib/store.jsx`)

All additive; bump the persisted shape carefully and keep `simulate()` intact.

### 5.1 Agent
```js
agent.rules = [];   // [{ id, text, source: 'manual'|'derived', rating, ts, confirmed }]
```
Injected at call time (see §8). Read-only list rendered in the editor drawer.

### 5.2 Task — per-step trace + feedback
`runTask()` must record, for **each** step, the exact triple used:
```js
task.trace = [
  { agentId, role,            // 'req' | 'code' | 'test'
    system,                   // systemPrompt + injected rules actually sent
    user,                     // full input the agent received (prev output)
    assistant,                // raw model output
    provider, model, ms }
];
task.feedback = {
  rating,                     // 1..5
  weakLink,                   // 'req' | 'code' | 'test' | null
  notes,                      // freetext
  correctedOutput,           // optional: user-fixed final/step output
  capturedAt
};
task.exported = false;        // true once pushed to the dataset
```

### 5.3 Settings
```js
settings.lora = {
  baseUrl: 'http://127.0.0.1:8000',
  modelPath: '',              // selected base model dir (from /api/models)
  mergedPath: '',             // selected merged model dir (from /api/runs)
  adapterPath: '',            // optional base+adapter combo
  dataset: 'agent_office',    // data/<name>/
  loaded: false,              // mirrors /api/chat/status
  // sane training defaults surfaced in the Learning view:
  train: { run_name: '', num_train_epochs: 1, lora_r: 8, lora_alpha: 16,
           learning_rate: 2e-4, max_seq_length: 512 }
};
```

New `Store` methods (export each via the `window` pattern):
`submitFeedback`, `applyFeedbackToRules`, `addRule`, `removeRule`,
`buildTrainingRecords`, `markExported`.

---

## 6. Backend additions to lora-finetune (small, additive)

The browser can call training/chat APIs already, but **cannot write the dataset
file to disk**. Add two endpoints to `src/lora_finetune/server/app.py`
(+ schemas), mirroring `scripts/convert_to_chat_jsonl.py` validation:

```
POST /api/datasets/append
  body: { dataset: "agent_office", split: "train",
          records: [ {messages:[...]}, ... ] }
  -> validates each record is a chat triple, appends to
     data/<dataset>/<split>.jsonl, returns { appended, total_rows, path }

POST /api/datasets/create        (optional convenience)
  body: { dataset, splits:["train","test"] }
  -> mkdir data/<dataset>, touch empty splits
```

Reuse the existing chat-record validation logic so malformed rows are rejected
server-side. No other server change is required — `/api/train`,
`/api/train/events`, `/api/chat/*` are used as-is.

---

## 7. Implementation phases (build in this order)

Each phase is independently shippable and leaves the app working in Demo mode.

### Phase 0 — Scaffolding
- Decide vendor location (§4); add `tools/lora-finetune/` if vendoring.
- Add `settings.lora` defaults + Settings UI fields (baseUrl, dataset).
- Add a `loraStatus()` helper that GETs `/api/system` + `/api/chat/status` and
  shows a connection pill (mirrors the existing DEMO/LIVE pill pattern).
- **Done when:** app shows "LoRA backend: connected / offline" without breaking
  anything else.

### Phase 1 — Inference bridge (new `lora` provider)
- Add `'lora'` to provider selects in `lib/editor.jsx`.
- In `callModel()`, handle `provider === 'lora'`: POST `messages` to
  `{baseUrl}/api/chat/generate`, parse the SSE `token` events, concatenate, and
  return text. On any failure → existing `'[offline — simulated] '` fallback.
- Add a "Load model" control in Settings: list `/api/models` + `/api/runs`,
  call `/api/chat/load`, reflect `/api/chat/status`. Add "Unload".
- **Done when:** an agent set to provider `lora` produces real output from a
  loaded merged model, and Demo mode still works untouched.

### Phase 2 — V-Model agents
- Add three default agents in `store.jsx` (ids `req`, `code`, `test`) with
  prompts that follow the `jd/nova.md` rules (produce, don't describe; chain
  continuity; verification matters):
  - **Spec (req):** raw task → structured spec (goal, constraints, acceptance
    criteria, edge cases). No code.
  - **Forge (code):** spec → implementation only.
  - **Probe (test):** spec + code → pass/fail verdict, failing cases, and a
    corrected implementation if any test fails.
- Wire default connections `req → code → test`. Temperatures 0.3 / 0.2 / 0.3.
- **Done when:** running a task flows Spec → Forge → Probe with chained I/O.

### Phase 3 — Trace recorder
- Modify `runTask()` to populate `task.trace[]` (§5.2) with the *actual*
  system/user/assistant for each step (system = prompt **after** rule
  injection, so training data matches what was really sent).
- **Done when:** a completed task has a full, inspectable trace.

### Phase 4 — Feedback capture
- `FeedbackForm` in `lib/tasks.jsx`, shown when `task.status === 'done'`:
  rating (1–5), weak-link chips (Spec/Forge/Probe), notes, optional
  "corrected output" textarea.
- `Store.submitFeedback(taskId, feedback)` persists it.
- Styles in `lib/ui.css` (`.feedback-form`).
- **Done when:** feedback is captured and visible on the task.

### Phase 5 — Rules layer (immediate learning)
- `applyFeedbackToRules(task, feedback)`:
  - **5a (manual):** if notes contain a rule, append it to the weak-link
    agent's `rules[]`.
  - **5b (derived, optional):** one extra `callModel()` "reflector" call —
    *"Given this task, output, and feedback, write one ≤15-word rule the agent
    should follow next time."* Append the result.
- In `callModel()`, prepend a rules block to the system prompt:
  ```
  --- LEARNED RULES (from past runs) ---
  1. ...
  --------------------------------------
  ```
- Cap 20 rules/agent; rating ≥ 4 marks a rule `confirmed` (never pruned).
- Read-only rules list + per-rule delete in `lib/editor.jsx`.
- **Done when:** a correction on run N visibly changes the prompt on run N+1,
  with no training.

### Phase 6 — Training-data builder + export
- `buildTrainingRecords()` turns qualifying tasks into chat records — **one per
  step** from `task.trace`, using `correctedOutput` as the `assistant` when the
  user supplied a fix. Filter: only `feedback.rating >= 3` (configurable);
  exclude already-`exported` tasks.
- **6a (no backend):** "Download training JSONL" button → `Blob` download the
  user drops into `data/agent_office/`. Closes the loop with zero server edits.
- **6b (with backend, needs §6 endpoint):** "Push to backend" → POST records to
  `/api/datasets/append`, then `markExported`.
- **Done when:** good runs become valid JSONL the trainer accepts.

### Phase 7 — Train trigger + monitor ("Learning" view)
- New view `lib/learning.jsx` (export to `window`, add `<script>` in load order,
  add sidebar nav — see `docs/07-extending.md`).
- Show dataset row count, pick base model / run name / hyperparams from
  `settings.lora.train`, **warn + auto-unload** any loaded chat model (GPU
  constraint), then POST `/api/train`.
- Subscribe to `/api/train/events` (SSE) → live loss curve + step/eta. Optional
  flourish: animate a "Training Lab" room while a run is active.
- On completion, refresh `/api/runs`; offer one-click "Load new merged model"
  → updates `settings.lora.mergedPath` and calls `/api/chat/load`.
- **Done when:** train → merge → reload happens from inside the app.

### Phase 8 — Loop orchestration (optional polish)
- Track runs-since-last-train; when ≥ N qualifying new tasks exist, surface a
  "Ready to retrain (N new examples)" nudge.
- Optional auto-cadence: after retrain, hot-swap the merged model for all `lora`
  agents and clear `rules[]` entries already baked into the weights (or keep
  them as belt-and-suspenders — measure first).
- **Done when:** the cycle runs with minimal manual steps and quality trends up.

### Phase 9 (optional, later) — Few-shot bank
- `findSimilarTasks(taskBody, topN)` by keyword overlap (no vector DB at this
  scale); inject top-3 high-rated past triples as few-shots in `callModel()`.
- Add only after ~20+ tasks exist; rules + LoRA cover earlier improvement.

---

## 8. Prompt assembly order (single source of truth)

When `callModel()` builds the request for a `lora`/live agent:

```
system  = LEARNED RULES block (if any)
        + agent.systemPrompt
        + (optional) few-shot examples block        [Phase 9]
user    = chained input from previous step (or the task body for step 1)
```

The **exact** assembled `system` and `user` are what Phase 3 records into
`task.trace`, so training data is a faithful copy of production prompts.

---

## 9. Constraints & guardrails (do not violate)

- **Never break Demo mode.** Every lora call is `try/catch` with the existing
  simulate fallback. Rule injection and export are UI-layer only.
- **One GPU job at a time.** Unload chat before training; reload after. Surface
  this in the UI, don't hide it.
- **localStorage only** on the browser side — traces, rules, feedback, settings
  all persist there; don't clobber keys other than `agentPlayground.v1`.
- **Keep files small** and keep the `Object.assign(window, {...})` export
  pattern; register any new `.jsx` in the HTML load order.
- **Data quality gates the loop.** Bad runs poison the adapter — filter by
  rating, prefer corrected outputs, keep a held-out `test.jsonl`.
- **Privacy.** Live/LoRA traces may contain real task content; everything stays
  local (browser + localhost server). Note this in Settings.

---

## 10. Phase checklist

- [x] P0 — Settings + connection pill for lora backend
- [x] P1 — `lora` inference provider + load/unload model
- [x] P2 — Req/Code/Test agents + default wiring
- [x] P3 — per-step trace recorder in `runTask()`
- [x] P4 — feedback form + `submitFeedback`
- [x] P5 — rules layer (Nova diagnosis + regenerate) + prompt injection
- [x] P6 — training-record builder + JSONL download + push (`buildTrainingRecords`, Self-Improve view)
- [ ] P6.5 — backend `/api/datasets/append` (+ optional `create`) — UI calls it; endpoint still to add server-side
- [x] P7 — Self-Improve view: train trigger + SSE monitor + reload model
- [x] GEPA — cross-trace rule evolution (`runGEPA`/`applyGEPA`) — the Hermes-style trace optimiser
- [ ] P8 — loop orchestration / retrain nudge / hot-swap
- [ ] P9 — few-shot bank (optional)

> **Hermes mapping (this branch):** Skill files → `agent.rules[]`; trajectory
> summariser → Nova diagnosis (P5); GEPA trace analysis → `runGEPA` (Self-Improve
> view, evolves a whole rule set from many traces, distinct from P5's single-task
> diagnosis); weight fine-tuning → LoRA adapter (P7 train trigger + merge + reload).

---

## 11. Open decisions (confirm before coding)

1. **Vendor vs sibling** for lora-finetune (§4). Recommended: vendor under
   `tools/lora-finetune/`.
2. **Derived rules (5b)** — worth the extra model call, or manual-only to start?
3. **Per-agent adapters vs one shared adapter.** Simplest: one adapter trained
   on all three roles (system prompt disambiguates). Per-role adapters are
   stronger but triple the training/serving cost — start shared.
4. **Rating threshold** for export (default ≥ 3) and **retrain cadence** N.
```
