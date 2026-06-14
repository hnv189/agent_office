# How to run Agent Playground

## Does this have a backend?

**No — it is a frontend-only app.** There is no server of its own, no database, no
build step. Everything (UI, state, the logic that decides what to send to a model)
runs in your browser, and state is saved in `localStorage`.

The only "server" you start locally is a **static file server** — it just hands the
files to the browser. It contains zero application logic.

The actual AI inference happens in an **external model backend** that you choose per
agent. The browser calls it directly:

| Provider | Endpoint | Notes |
|----------|----------|-------|
| **LM Studio** (local) | `http://localhost:1234/v1` | OpenAI-compatible; enable CORS in its server settings |
| **OpenAI** | `https://api.openai.com/v1` | needs an API key |
| **Anthropic** | `https://api.anthropic.com` | needs an API key |

```
[ Your browser: Agent Playground (frontend) ]
        │  (you point each agent at a backend)
        ├──────────────► LM Studio  @ localhost:1234   (local, free)
        ├──────────────► OpenAI     @ api.openai.com    (cloud, key)
        └──────────────► Anthropic  @ api.anthropic.com (cloud, key)

   A static file server only serves the .html/.jsx/.css files. It is NOT a backend.
```

---

## Prerequisites

- A modern browser (Chrome, Edge, Firefox, Safari).
- A way to serve static files locally — **Python 3** (preinstalled on most
  Macs/Linux) or **Node.js**. Either works; you only need one.
- (Optional, for real local models) **LM Studio**.

> Why a server at all? The app loads its `lib/*.jsx` files through an in-browser
> compiler. Browsers block that over `file://`, so double-clicking the HTML shows a
> blank page. Serving over `http://localhost` fixes it.

---

## Step 1 — Get the files

Unzip the project somewhere, e.g. `~/agent-playground`. You should see:

```
Agent Playground.html
lib/        (the app code + styles)
docs/       (documentation)
AGENTS.md
HOW-TO-RUN.md   ← this file
```

## Step 2 — Start a static server in that folder

Open a terminal, `cd` into the folder, and run **one** of these:

**Python**
```
cd ~/agent-playground
python3 -m http.server 8000
```

**Node**
```
cd ~/agent-playground
npx serve -l 8000
```

Leave that terminal running.

## Step 3 — Open the app

In your browser, go to:

```
http://localhost:8000/Agent%20Playground.html
```

It works right away in **Demo mode** (agents are simulated — nothing leaves your
browser). You can create/edit agents, wire connections, and run tasks immediately.

---

## Step 4 — Use real models (Live mode)

### Option A — LM Studio (local, free)

1. Open LM Studio → **Developer / Local Server** tab.
2. Load a model, then **Start Server** (listens on `http://localhost:1234`).
3. **Enable CORS** in the server settings (toggle). Without it the browser blocks
   the request.
4. In the app: **Settings** → flip **Demo → Live**. Make sure the LM Studio base URL
   is `http://localhost:1234/v1` and the model name matches the loaded model.
5. Open any agent → **▶ Run now**, or go to **Tasks** and run one.

### Option B — OpenAI / Anthropic (cloud)

1. In the app: **Settings** → flip **Demo → Live**.
2. Paste your API key into the OpenAI and/or Anthropic fields.
3. On each agent (editor → **Provider**), pick the provider and model you want.

If any live call fails, the app automatically returns a simulated reply prefixed
with `[offline — simulated]`, so it never hard-breaks.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| **Blank page** | You opened it as `file://`. Use the `http://localhost:8000/...` URL (Step 2–3). |
| **Live calls fail to LM Studio** | Server not started, or **CORS not enabled** in LM Studio, or wrong base URL/model name. |
| **`localhost` unreachable** | You're running it on a *hosted* preview, not your own machine. Live mode only works locally. |
| **Port 8000 in use** | Use another port, e.g. `python3 -m http.server 8080`, then open `:8080`. |
| **Scheduled "every N hours" never fires** | Expected — it's a frontend prototype with no background server; it only ticks while the tab is open. |

---

## What persists

All your agents, connections, tasks, settings, and graph layout are saved in the
browser's `localStorage` (key `agentPlayground.v1`). Clearing site data, or using a
different browser/profile, starts fresh. **Settings → Reset everything** restores
the six default agents.
