// tasks.jsx — task composer (text + image) and queue that feeds the pipeline.
// Exports: TasksView.

function TaskComposer() {
  const [s] = useStore();
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [img, setImg] = React.useState(null);
  const [assignee, setAssignee] = React.useState(s.agents[0]?.id || '');
  const fileRef = React.useRef(null);

  const onFile = (file) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => setImg(r.result);
    r.readAsDataURL(file);
  };

  const add = () => {
    if (!title.trim() && !body.trim() && !img) return;
    const id = 't' + Date.now().toString(36);
    Store.set((st) => ({ ...st, tasks: [{
      id, kind: img ? 'image' : 'text', title: title.trim() || 'Untitled task',
      body: body.trim(), image: img, status: 'queued', assignee, createdMs: Date.now(),
    }, ...st.tasks] }));
    setTitle(''); setBody(''); setImg(null);
  };

  return (
    <div className="composer">
      <input className="inp big" placeholder="Task title…" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="inp ta" rows={3} placeholder="Describe the task — this text (and image) gets fed to the first agent in the pipeline." value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="composer-row">
        <div className={'drop' + (img ? ' has' : '')}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]); }}>
          {img ? <img src={img} alt="task" /> : <span>＋ drop / pick image</span>}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files[0])} />
        </div>
        <div className="composer-assign">
          <span className="fld-l">Start with</span>
          <select className="inp" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            {s.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <div className="pipe-preview">{pipelineFrom(assignee).map((id) => s.agents.find((a) => a.id === id)?.name).join(' → ')}</div>
          <button className="btn primary" onClick={add}>＋ Add task</button>
        </div>
      </div>
    </div>
  );
}

const TASK_STATUS = { queued: '#6b7693', running: '#ffd23f', done: '#2ee6a6' };

const RESULT_LIMIT = 240;

function StepOutput({ step }) {
  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(step.output).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };
  return (
    <div className="step-row">
      <button className="step-hd" onClick={() => setOpen((v) => !v)} style={{ '--agent-color': step.agentColor }}>
        <span className="step-dot" />
        <span className="step-name">{step.agentName}</span>
        <span className="step-preview">{open ? '' : String(step.output).slice(0, 60) + (step.output.length > 60 ? '…' : '')}</span>
        <span className="step-chars">{step.output.length} chars</span>
        <span className="step-chevron">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="step-body">
          <div className="step-copy-row">
            <button className="icon-btn copy-btn" onClick={copy} title="Copy">{copied ? '✓' : '⎘'}</button>
          </div>
          <div className="step-output">{step.output}</div>
        </div>
      )}
    </div>
  );
}

function StepOutputs({ steps }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="steps-wrap">
      <button className="steps-toggle" onClick={() => setOpen((v) => !v)}>
        <span>agent outputs ({steps.length})</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="steps-list">
          {steps.map((step, i) => <StepOutput key={i} step={step} />)}
        </div>
      )}
    </div>
  );
}

function PlanCard({ task, agents }) {
  const [open, setOpen] = React.useState(false);
  const plan = task.plan;
  return (
    <div className="plan-card">
      <div className="plan-hd">
        <span className="plan-badge">◈ Nova's Plan</span>
        <button className="expand-btn" onClick={() => setOpen((v) => !v)}>{open ? '▲ hide config' : '▼ show config'}</button>
      </div>
      {plan.rationale && <p className="plan-rationale">{plan.rationale}</p>}
      <div className="plan-pipe">
        {plan.pipeline.map((id, i) => {
          const a = agents.find((ag) => ag.id === id);
          if (!a) return null;
          return (
            <React.Fragment key={id}>
              <span className="pipe-node" style={{ '--theme': a.color }}><PixelSprite sprite={a.sprite} color={a.color} scale={1.6} mode="idle" />{a.name}</span>
              {i < plan.pipeline.length - 1 && <span className="pipe-arrow">→</span>}
            </React.Fragment>
          );
        })}
      </div>
      {open && (
        <div className="plan-agents">
          {plan.agents.map((pa) => {
            const a = agents.find((ag) => ag.id === pa.id);
            return (
              <div key={pa.id} className="plan-agent-row">
                <div className="plan-agent-hd">
                  <span className="plan-agent-name" style={{ color: a?.color }}>{a?.name || pa.id}</span>
                  {pa.temperature != null && <span className="plan-agent-temp">temp {pa.temperature}</span>}
                </div>
                <p className="plan-agent-prompt">{pa.systemPrompt}</p>
              </div>
            );
          })}
        </div>
      )}
      <div className="plan-footer">
        <button className="btn primary sm" onClick={() => approvePlan(task.id)}>✓ Approve &amp; Run</button>
        <button className="btn sm" onClick={() => planTask(task.id)}>↺ Re-plan</button>
      </div>
    </div>
  );
}

function FeedbackForm({ task, chain }) {
  const [rating, setRating] = React.useState(0);
  const [hover, setHover] = React.useState(0);
  const [weakLink, setWeakLink] = React.useState(null);
  const [notes, setNotes] = React.useState('');
  const [submitted, setSubmitted] = React.useState(false);

  // Only offer weak-link selection for the V-Model coding trio
  const trioIds = new Set(['req', 'code', 'test']);
  const trioAgents = chain.filter((a) => trioIds.has(a.id));

  const submit = () => {
    if (!rating) return;
    Store.submitFeedback(task.id, { rating, weakLink, notes: notes.trim() });
    setSubmitted(true);
  };

  if (task.feedback) {
    const fb = task.feedback;
    const stars = '★'.repeat(fb.rating) + '☆'.repeat(5 - fb.rating);
    return (
      <div className="fb-done">
        <span className="fb-stars-done" style={{ color: fb.rating >= 4 ? '#2ee6a6' : fb.rating >= 3 ? '#ffd23f' : '#ff6b6b' }}>{stars}</span>
        {fb.weakLink && <span className="fb-weak-done">weak: {fb.weakLink}</span>}
        {fb.notes && <span className="fb-notes-done">"{fb.notes}"</span>}
      </div>
    );
  }

  if (submitted) return null; // optimistic hide before store update propagates

  return (
    <div className="fb-form">
      <div className="fb-hd">How did this run go?</div>
      <div className="fb-stars">
        {[1,2,3,4,5].map((n) => (
          <button key={n} className={'fb-star' + (n <= (hover || rating) ? ' on' : '')}
            onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)}
            onClick={() => setRating(n)}>★</button>
        ))}
      </div>
      {trioAgents.length > 0 && (
        <div className="fb-weaklink">
          <span className="fb-lbl">Weak link:</span>
          {trioAgents.map((a) => (
            <button key={a.id} className={'fb-chip' + (weakLink === a.name ? ' sel' : '')}
              style={{ '--chip-color': a.color }}
              onClick={() => setWeakLink(weakLink === a.name ? null : a.name)}>
              {a.name}
            </button>
          ))}
        </div>
      )}
      <textarea className="inp ta fb-notes" rows={2} placeholder="What went wrong? (optional — becomes a rule for the agent)"
        value={notes} onChange={(e) => setNotes(e.target.value)} />
      <button className="btn primary sm fb-submit" disabled={!rating} onClick={submit}>Submit feedback</button>
    </div>
  );
}

function TaskRow({ task }) {
  const [s] = useStore();
  const [expanded, setExpanded] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const chain = pipelineFrom(task.assignee).map((id) => s.agents.find((a) => a.id === id)).filter(Boolean);
  const run = () => { Store.set({ view: 'office' }); runTask(task.id); };
  const resultText = String(task.result || '');
  const needsExpand = resultText.length > RESULT_LIMIT;
  const copy = () => {
    navigator.clipboard?.writeText(resultText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const busy = task.status === 'running' || task.planStatus === 'planning';
  return (
    <div className="task">
      <div className="task-main">
        <div className="task-hd">
          <span className="dot" style={{ background: TASK_STATUS[task.status] }} />
          <b>{task.title}</b>
          <span className="task-status" style={{ color: TASK_STATUS[task.status] }}>{task.status}</span>
        </div>
        {task.body && <p className="task-body">{task.body}</p>}
        {task.image && <img className="task-thumb" src={task.image} alt="" />}
        <div className="task-pipe">
          {chain.map((a, i) => (
            <React.Fragment key={a.id}>
              <span className="pipe-node" style={{ '--theme': a.color }}><PixelSprite sprite={a.sprite} color={a.color} scale={1.6} mode="idle" />{a.name}</span>
              {i < chain.length - 1 && <span className="pipe-arrow">→</span>}
            </React.Fragment>
          ))}
        </div>

        {task.planStatus === 'planning' && (
          <div className="plan-thinking">◈ Nova is analyzing the task and selecting agents…</div>
        )}
        {task.planStatus === 'error' && (
          <div className="plan-error">
            ◈ {task.planError || 'Planning failed.'}
            <button className="expand-btn" style={{ marginLeft: 10 }} onClick={() => planTask(task.id)}>↺ retry</button>
          </div>
        )}
        {task.planStatus === 'ready' && task.plan && (
          <PlanCard task={task} agents={s.agents} />
        )}

        {task.steps && task.steps.length > 0 && (
          <StepOutputs steps={task.steps} />
        )}

        {resultText && (
          <div className="task-result-wrap">
            <div className="task-result-hd">
              <span className="task-result-lbl">final result</span>
              <button className="icon-btn copy-btn" onClick={copy} title="Copy full result">{copied ? '✓' : '⎘'}</button>
            </div>
            <div className="task-result">
              {expanded || !needsExpand ? resultText : resultText.slice(0, RESULT_LIMIT) + '…'}
            </div>
            {needsExpand && (
              <button className="expand-btn" onClick={() => setExpanded((v) => !v)}>
                {expanded ? '▲ show less' : `▼ show more (${resultText.length} chars)`}
              </button>
            )}
          </div>
        )}
        {task.status === 'done' && <FeedbackForm task={task} chain={chain} />}
      </div>
      <div className="task-actions">
        <button className="btn plan-btn sm" disabled={busy} onClick={() => planTask(task.id)}>
          {task.planStatus === 'planning' ? '◈ …' : '◈ plan'}
        </button>
        <button className="btn primary sm" disabled={busy} onClick={run}>{task.status === 'running' ? 'running…' : '▶ run'}</button>
        <button className="icon-btn" onClick={() => Store.set((st) => ({ ...st, tasks: st.tasks.filter((t) => t.id !== task.id) }))} aria-label="Delete">✕</button>
      </div>
    </div>
  );
}

function TasksView() {
  const [s] = useStore();
  return (
    <div className="page">
      <div className="page-hd"><h1><span className="emoji">🎯</span> Tasks</h1><span className="muted">{s.tasks.length} in queue</span></div>
      <TaskComposer />
      <div className="task-list">
        {s.tasks.length === 0 && <div className="empty">No tasks yet — add one above and hit run to watch the agents work.</div>}
        {s.tasks.map((t) => <TaskRow key={t.id} task={t} />)}
      </div>
    </div>
  );
}

Object.assign(window, { TasksView });
