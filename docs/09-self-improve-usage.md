# 09 · Self-Improve — usage guide

> How to use the **Self-Improve** view (sidebar **⟳ Self-Improve**) to make the
> V-Model coding trio (Spec → Forge → Probe) get better over time. This is the
> user-facing companion to the build plan in `08-lora-learning-loop.md`.

The view has three panels, each a layer of the same loop:

| Panel | Layer | Needs training? | Effective when |
|-------|-------|-----------------|----------------|
| **⟳ GEPA — trace evolution** | prompt-level (rules) | no | next run |
| **⬡ Training data** | dataset builder | no | export step |
| **◆ LoRA fine-tune** | weight-level (adapter) | yes | after train + reload |

---

## The big picture (Hermes mapping)

This project mirrors how Hermes Agent self-improves, in two layers:

| Hermes | Here |
|--------|------|
| Skill files | `agent.rules[]` (numbered rules injected into the prompt) |
| Trajectory summariser | **Nova diagnosis** — runs once per task from the feedback form |
| GEPA trace analysis | **GEPA** — evolves a whole rule set from *many* traces |
| Weight fine-tuning | **LoRA adapter** — bakes good runs into the model weights |

Short-term gains every run (rules); durable, baked-in capability every training
cycle (LoRA).

---

## 1. Feed it history first

Every layer learns from completed, rated runs. Before any of it does something
useful you need traces:

1. **Tasks** view → create a coding task → **Run** it (flows Spec → Forge → Probe).
2. When it finishes, fill in the **feedback form** on the task:
   - rating (1–5★)
   - optional hint chip (which agent looked weak)
   - notes — *literal* is best: "spec too verbose", "generate only 1 test case",
     "wrong format".
3. Repeat. GEPA looks for **recurring** patterns, so 3–5+ rated runs per agent is
   where it gets sharp.

> Each completed run records a per-step **trace** (`system` / `user` / `assistant`)
> on the task. That trace is the raw material for all three panels.

### What the feedback form already does (Nova diagnosis, P5)
Right after you submit feedback with notes, **Nova** reads the pipeline outputs,
diagnoses which agent caused the issue, and proposes **one** rule for your review.
You can **edit**, **↺ Regenerate** (re-ask Nova until it's right), **✓ Apply**, or
**✕ Dismiss**. Applied rules attach to the weak agent and fire on the next run.

This is the *continuous accumulation* layer — one rule at a time.

---

## 2. GEPA — evolve a whole rule set

GEPA is the periodic *consolidation* pass. Unlike Nova diagnosis (one task → one
rule), GEPA reads **all** of one agent's traces + feedback together, finds
recurring failures, and proposes a re-evolved **rule set** (merge overlaps, refine
vague rules, drop unsupported ones, add at most 2 new ones).

### Steps
1. Sidebar → **⟳ Self-Improve**.
2. In **GEPA — trace evolution**, pick the agent (Spec / Forge / Probe).
3. Read the meta line: `N run(s) with feedback · M current rule(s)`.
   If `N = 0`, the button is disabled — go run + rate some tasks first.
4. Click **⟳ Evolve rules**.
5. Review the **current → proposed** diff:
   - left = existing rules, right = GEPA's evolved set (each box is editable)
   - a one-line **rationale** explains what changed and why
6. Choose:
   - **✓ Apply evolved set** — replaces the rule set (★ proven rules are always kept)
   - **↺ Regenerate** — re-run if you don't like it
   - **✕ Discard** — keep the old rules

Applied GEPA rules show in the agent's editor drawer with the **⟳** icon
(vs **◈** Nova, **✎** manual) and take effect on the **next run** — no training.

### Requires Live mode
GEPA evolves rules via a model call (Nova as the optimiser). In **Demo mode** it
returns your current rules unchanged with a note. To use it:
- flip the sidebar pill to **LIVE**
- make sure Nova's backend is reachable (LM Studio / OpenAI / Anthropic).

### Nova diagnosis vs GEPA

| | Triggered by | Scope | Output |
|---|---|---|---|
| **Nova diagnosis** | one task, after you rate it | that single run | one new rule |
| **GEPA** | you, manually, anytime | *all* of an agent's runs | a re-evolved whole rule set |

Run GEPA after you've gathered a batch of feedback, to compress noisy per-task
rules into a few sharp ones.

---

## 3. Training data — build the dataset

Turns good runs into chat-format training records (the input LoRA consumes).

1. In **⬡ Training data**, set the **Min rating** slider (default 3★) — only runs
   at or above this become training data.
2. The counters show **qualifying task(s)** and **training record(s)**
   (one record per pipeline step; if you supplied a corrected output, it becomes
   the target for the final step).
3. Export:
   - **⬇ Download JSONL** — saves `<dataset>_train.jsonl` you can drop into
     `data/<dataset>/` on the backend. Zero server changes needed.
   - **⬆ Push to backend** — POSTs to `/api/datasets/append` and marks those tasks
     exported so they aren't sent twice. *(Needs the backend endpoint — see below.)*

Record shape (one per step):
```json
{"messages":[
  {"role":"system","content":"<agent role prompt>"},
  {"role":"user","content":"<step input>"},
  {"role":"assistant","content":"<produced or corrected output>"}
]}
```

The system prompt is the **raw role prompt** (no rule scaffold) on purpose — so the
model learns the behaviour into its weights rather than depending on prompt rules.

---

## 4. LoRA fine-tune — bake it into weights

Trains a LoRA adapter on the dataset, merges it, and lets you load the result back
into the agents.

### Before you can train
- A **base model** must be selected in **Settings → LoRA Backend** (downloaded into
  the server's `models/` dir as a HuggingFace **safetensors** folder).
- The dataset must have rows (push or drop in JSONL first).
- The **lora-finetune** server must be running and reachable.

### Steps
1. In **◆ LoRA fine-tune**, check the stats: rows in dataset, merged models.
2. Set hyperparameters (sane defaults provided): run name, epochs, LoRA r, LoRA α,
   learning rate, max seq len.
3. Click **▶ Start training**.
   - **One GPU job at a time:** any loaded chat model is **auto-unloaded** first.
   - The app POSTs `/api/train`, then subscribes to the SSE event stream.
4. Watch the **loss curve / step / eta** update live in the event log.
5. On completion, the **merged model** list refreshes. Click **⬆ Load** next to the
   new one to load it into VRAM — every agent set to the **LoRA** provider now uses
   it.

### Pointing agents at the trained model
Per agent (editor drawer → Provider) set **LoRA (fine-tune)**. The model is loaded
globally via Settings → LoRA Backend, so all LoRA agents share it.

---

## Full loop, end to end

```
run task ─► rate it (feedback form)
   │            │
   │            ├─► Nova diagnosis ─► 1 rule  ───────────┐ (instant, next run)
   │            │                                        │
   │            ▼                                        ▼
   │      [repeat a few runs]                     agent.rules[] grows
   │            │
   ▼            ▼
Self-Improve ─► GEPA: evolve rule set ─► apply ─► sharper rules (instant)
   │
   ├─► Training data: build records ─► download / push to dataset
   │
   └─► LoRA fine-tune: unload chat ─► train ─► merge ─► load ─► smarter weights
        └────────────────── repeat: better runs ──────────────────┘
```

---

## Requirements & gotchas

- **Live mode** is required for GEPA, Nova diagnosis, training, and inference.
  Demo mode still lets you build and **download** training data.
- **Backend endpoint P6.5:** "Push to backend" calls `POST /api/datasets/append`,
  which must be added to the lora-finetune server (see `08-…` §6). Until then, use
  **Download JSONL** and drop the file into `data/<dataset>/` manually.
- **Base model format:** use HuggingFace **safetensors** (not GGUF/MLX) — that's
  what the trainer loads. Merged outputs are safetensors too.
- **One GPU job at a time:** training and chat inference are mutually exclusive.
  The training panel unloads the chat model for you; reload it (or the new merged
  model) when training finishes.
- **Data quality gates the loop.** Bad runs poison the adapter — keep the rating
  threshold sensible and prefer corrected outputs.
- **Everything stays local** — traces, rules, feedback live in `localStorage`;
  training data and the model never leave your machine + the localhost server.

---

## How to launch for previewing

The app is a static SPA (no build). A tiny static server is included:

```
node .claude/serve.js      # serves the repo on http://localhost:4173
```

Then open `http://localhost:4173`. For Live mode, point agents at LM Studio
(`http://localhost:1234/v1`, CORS enabled) or a cloud key in Settings, and the
LoRA backend at `http://localhost:8000`.
