// engine.jsx — simulation loop, room-to-room visits, and task pipeline runner.
// Exports: startEngine, triggerVisit, runTask.

function __agent(id) { return Store.get().agents.find((a) => a.id === id); }

function triggerVisit(from, to, ms = 1700) {
  const a = __agent(from);
  if (!a) return;
  const id = 'v' + Math.random().toString(36).slice(2);
  Store.set((s) => ({ ...s, visits: [...s.visits, { id, from, to, color: a.color, sprite: a.sprite, phase: 'go' }] }));
  setTimeout(() => Store.set((s) => ({ ...s, visits: s.visits.map((v) => v.id === id ? { ...v, phase: 'back' } : v) })), ms);
  setTimeout(() => Store.set((s) => ({ ...s, visits: s.visits.filter((v) => v.id !== id) })), ms * 2);
}

let __engineTimer = null;
let __speed = 1;
function startEngine(getSpeed) {
  const stop = () => { if (__engineTimer) clearInterval(__engineTimer); };
  stop();
  const tick = () => {
    __speed = getSpeed ? getSpeed() : 1;
    const s = Store.get();
    // refresh speech bubbles for active agents
    s.agents.forEach((a) => {
      if (a.status === 'active' && Math.random() < 0.5) {
        const pool = SIM_ACTIONS[a.role] || SIM_ACTIONS.general;
        Store.updateAgent(a.id, { action: pool[Math.floor(Math.random() * pool.length)] });
      } else if (a.status === 'idle' && a.action) {
        Store.updateAgent(a.id, { action: '' });
      }
    });
    // occasional spontaneous visit along a live connection
    if (Math.random() < 0.35) {
      const live = s.connections.filter((c) => {
        const f = s.agents.find((a) => a.id === c.from);
        return f && f.status === 'active';
      });
      if (live.length) {
        const c = live[Math.floor(Math.random() * live.length)];
        triggerVisit(c.from, c.to);
        const fn = __agent(c.from), tn = __agent(c.to);
        if (fn && tn) Store.log(`${fn.name} → ${tn.name}`, fn.color);
      }
    }
  };
  __engineTimer = setInterval(tick, 2600);
  return stop;
}

// derive a linear pipeline starting from an agent, following outgoing edges
function pipelineFrom(startId) {
  const s = Store.get();
  const chain = [startId];
  const seen = new Set(chain);
  let cur = startId;
  while (true) {
    const next = s.connections.find((c) => c.from === cur && !seen.has(c.to));
    if (!next) break;
    chain.push(next.to); seen.add(next.to); cur = next.to;
  }
  return chain;
}

async function runTask(taskId, opts = {}) {
  const { agentOverrides = {} } = opts;
  const s = Store.get();
  const task = s.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const startId = task.assignee || s.agents[0]?.id;
  const chain = pipelineFrom(startId);
  Store.set((st) => ({ ...st, tasks: st.tasks.map((t) => t.id === taskId ? { ...t, status: 'running', steps: [], trace: [], feedback: null, result: null } : t) }));
  Store.log(`▶ task "${task.title}" → ${chain.map((id) => __agent(id)?.name).join(' → ')}`, '#2ee6a6');
  let payload = task.body || task.title;
  const steps = [];
  for (let i = 0; i < chain.length; i++) {
    const id = chain[i];
    const a = __agent(id); if (!a) continue;
    const effectiveAgent = agentOverrides[id] ? { ...a, ...agentOverrides[id] } : a;
    Store.updateAgent(id, { status: 'active', action: 'on it!' });
    if (i > 0) triggerVisit(chain[i - 1], id);
    await new Promise((r) => setTimeout(r, 900));
    const inputPayload = payload; // capture before overwriting for trace
    // Surface active learned rules in the ticker so it's clear they're being used
    const activeRules = effectiveAgent.rules || [];
    if (activeRules.length > 0) {
      Store.log(`◈ ${a.name} has ${activeRules.length} learned rule(s) — injecting into prompt`, '#a06bff');
    }
    let out;
    try { out = await callModel(effectiveAgent, payload, { settings: s.settings, liveMode: s.liveMode }); }
    catch (e) { out = '[error] ' + e.message; }
    payload = out;
    steps.push({
      agentId: id, agentName: a.name, agentColor: a.color, output: out,
      // Phase 3 trace — exact triple used; becomes LoRA training data after feedback
      system: typeof buildSystemPrompt === 'function' ? buildSystemPrompt(effectiveAgent) : (effectiveAgent.systemPrompt || ''),
      user: inputPayload,
      assistant: out,
    });
    Store.set((st) => ({ ...st, tasks: st.tasks.map((t) => t.id === taskId ? { ...t, steps: [...steps] } : t) }));
    Store.log(`${a.name}: ${String(out).slice(0, 70)}`, a.color);
    Store.updateAgent(id, { action: 'done', lastRunMs: Date.now() });
    await new Promise((r) => setTimeout(r, 500));
    Store.updateAgent(id, (ag) => ({ status: ag.schedule === 'always' ? 'active' : (ag.schedule === 'ondemand' ? 'ondemand' : 'idle'), action: ag.schedule === 'always' ? ag.action : '' }));
  }
  Store.set((st) => ({ ...st, tasks: st.tasks.map((t) => t.id === taskId ? { ...t, status: 'done', result: payload, steps, trace: steps } : t) }));
  Store.log(`✔ task "${task.title}" complete`, '#2ee6a6');
}

function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1].trim()); } catch {} }
  const raw = text.match(/\{[\s\S]*\}/);
  if (raw) { try { return JSON.parse(raw[0]); } catch {} }
  return null;
}

function taskLooksLikeFileWrite(task) {
  const text = `${task?.title || ''}\n${task?.body || ''}`.toLowerCase();
  return /\b(create|write|modify|edit|patch|update|replace|save)\b/.test(text)
    && /\b(file|\.txt|\.md|\.js|\.jsx|\.ts|\.tsx|\.json|\.css|\.html|\.py|\.sh)\b/.test(text);
}

function normalizeAgentRef(ref, agents) {
  const raw = String(typeof ref === 'object' ? (ref?.id || ref?.name || '') : ref || '').trim();
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const match = agents.find((a) => (
    a.id.toLowerCase() === key
    || a.name.toLowerCase().replace(/[^a-z0-9_-]/g, '') === key
    || String(a.role2 || '').toLowerCase() === key
  ));
  return match?.id || null;
}

function preferredFileWriter(agents) {
  const ids = ['sol', 'code', 'clay'];
  return ids.map((id) => agents.find((a) => a.id === id && (a.tools || []).includes('files.write'))).find(Boolean)
    || agents.find((a) => (a.tools || []).includes('files.write'));
}

function normalizePlan(plan, task, agents) {
  const fileWriteTask = taskLooksLikeFileWrite(task);
  const pipeline = (plan.pipeline || []).map((id) => normalizeAgentRef(id, agents)).filter(Boolean);
  const patches = (plan.agents || []).map((patch) => {
    const id = normalizeAgentRef(patch, agents);
    return id ? { ...patch, id } : null;
  }).filter(Boolean);

  if (fileWriteTask) {
    const writer = preferredFileWriter(agents);
    if (writer) {
      const writerPatch = patches.find((p) => p.id === writer.id) || {};
      return {
        ...plan,
        rationale: plan.rationale || `${writer.name} has workspace file-write tools.`,
        pipeline: [writer.id],
        agents: [{
          id: writer.id,
          temperature: writerPatch.temperature ?? 0.2,
          systemPrompt: writerPatch.systemPrompt || `You receive a local workspace file task. Use the available file tools to complete it. For full content replacement or creation, call write_file with the requested relative path and complete content. For targeted edits, inspect with read_file if needed and call patch_file. If the task contains a placeholder asking for the responsible agent name, replace it with "${writer.name}". Final answer: confirm the path written or modified.`,
        }],
      };
    }
  }

  return { ...plan, pipeline, agents: patches };
}

async function planTask(taskId) {
  const s = Store.get();
  const task = s.tasks.find((t) => t.id === taskId);
  if (!task) return;

  if (!s.liveMode) {
    Store.set((st) => ({ ...st, tasks: st.tasks.map((t) => t.id === taskId ? { ...t, planStatus: 'error', planError: 'Planning requires Live mode — flip the DEMO/LIVE switch.' } : t) }));
    return;
  }

  const nova = s.agents.find((a) => a.id === 'nova') || s.agents[0];
  const modelId = nova.connection?.model || s.settings.lmstudio?.model || 'local-model';
  const agentList = s.agents.map((a) => {
    const tools = (a.tools || []).length ? (a.tools || []).join(', ') : 'none';
    return `  - id:"${a.id}" name:"${a.name}" role:"${a.role}" tools:"${tools}"`;
  }).join('\n');

  let novaJD = '';
  try {
    const r = await fetch('jd/nova.md');
    if (r.ok) novaJD = await r.text();
  } catch {}

  const planningPrompt = `${novaJD}

---

CURRENT TASK:
Title: "${task.title}"
Description: "${task.body || task.title}"

AVAILABLE AGENTS:
${agentList}

MODEL: "${modelId}"

Return ONLY this JSON object, nothing else:
{
  "rationale": "one sentence explaining your agent selection",
  "pipeline": ["agentId1", "agentId2"],
  "agents": [
    { "id": "agentId1", "systemPrompt": "precise task instruction", "temperature": 0.5 }
  ]
}

Use exact agent ids from AVAILABLE AGENTS in "pipeline" and "agents[].id"; never use display names. For file create/modify/edit tasks, use a single agent with files.write unless the task also asks for review.`;

  Store.set((st) => ({ ...st, tasks: st.tasks.map((t) => t.id === taskId ? { ...t, planStatus: 'planning', plan: null, planError: null } : t) }));
  Store.log(`◈ Nova planning "${task.title}"…`, nova.color);

  try {
    const plannerNova = { ...nova, tools: [], systemPrompt: 'You output only valid JSON. No prose, no markdown, just the JSON object.' };
    const response = await callModel(plannerNova, planningPrompt, { settings: s.settings, liveMode: s.liveMode });
    let plan = extractJSON(response);

    if (!plan || !Array.isArray(plan.pipeline) || !Array.isArray(plan.agents)) {
      throw new Error('Nova returned an unreadable plan — try re-planning.');
    }

    plan = normalizePlan(plan, task, s.agents);
    if (plan.pipeline.length === 0) throw new Error('No valid agents in the plan — try re-planning.');

    Store.set((st) => ({ ...st, tasks: st.tasks.map((t) => t.id === taskId ? { ...t, planStatus: 'ready', plan } : t) }));
    Store.log(`◈ Plan ready — ${plan.pipeline.map((id) => __agent(id)?.name || id).join(' → ')}`, nova.color);
  } catch (e) {
    Store.set((st) => ({ ...st, tasks: st.tasks.map((t) => t.id === taskId ? { ...t, planStatus: 'error', planError: e.message } : t) }));
    Store.log(`◈ Planning failed: ${e.message}`, '#ff6b6b');
  }
}

function approvePlan(taskId) {
  const s = Store.get();
  const task = s.tasks.find((t) => t.id === taskId);
  if (!task?.plan) return;
  const { plan } = task;

  // Build per-run overrides — never write planned prompts back to the store
  const agentOverrides = {};
  plan.agents.forEach((patch) => {
    agentOverrides[patch.id] = {
      ...(patch.systemPrompt && { systemPrompt: patch.systemPrompt }),
      ...(patch.temperature != null && { temperature: patch.temperature }),
    };
  });

  // Only update connections to match the planned pipeline
  const plannedIds = new Set(plan.pipeline);
  const keptConns = s.connections.filter((c) => !plannedIds.has(c.from) && !plannedIds.has(c.to));
  const newConns = [];
  for (let i = 0; i < plan.pipeline.length - 1; i++) {
    newConns.push({ from: plan.pipeline[i], to: plan.pipeline[i + 1] });
  }

  Store.set((st) => ({
    ...st,
    connections: [...keptConns, ...newConns],
    tasks: st.tasks.map((t) => t.id === taskId ? { ...t, planStatus: 'approved', assignee: plan.pipeline[0] } : t),
  }));

  Store.log(`✓ Plan approved — ${plan.pipeline.map((id) => __agent(id)?.name || id).join(' → ')}`, '#2ee6a6');
  Store.set({ view: 'office' });
  runTask(taskId, { agentOverrides });
}

Object.assign(window, { startEngine, triggerVisit, runTask, pipelineFrom, planTask, approvePlan });
