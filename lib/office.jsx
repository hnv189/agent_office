// office.jsx — the Agent Office: themed rooms, walking/idle agents,
// speech bubbles, room-to-room travel overlay, LIVE ticker, agent cards.
// Exports: OfficeView.

function __timeAgo(ms) {
  if (!ms) return '—';
  const d = Date.now() - ms;
  const h = Math.floor(d / 3.6e6), m = Math.floor(d / 6e4);
  if (h >= 24) return Math.floor(h / 24) + 'd ago';
  if (h >= 1) return h + 'h ago';
  if (m >= 1) return m + 'm ago';
  return 'just now';
}
function __nextRun(a) {
  if (a.schedule === 'always') return 'always on';
  if (a.schedule === 'ondemand') return 'on demand';
  const next = (a.lastRunMs || Date.now()) + a.everyHours * 3.6e6;
  const h = Math.max(0, Math.round((next - Date.now()) / 3.6e6));
  return 'in ' + h + 'h';
}
const STATUS_META = {
  active:   { label: 'ACTIVE',    color: '#2ee6a6' },
  ondemand: { label: 'ON-DEMAND', color: '#ffd23f' },
  idle:     { label: 'IDLE',      color: '#6b7693' },
};

function AgentRoom({ agent, speed, onOpen, away, setRoomRef }) {
  const rt = ROOM_THEMES[agent.roomKey] || { label: 'ROOM', theme: agent.color };
  const active = agent.status === 'active';
  const [x, setX] = React.useState(50);
  const [flip, setFlip] = React.useState(false);
  React.useEffect(() => {
    if (!active) { setX(50); return; }
    const iv = setInterval(() => {
      setX((prev) => {
        const next = 18 + Math.random() * 64;
        setFlip(next < prev);
        return next;
      });
    }, 1900 / (speed || 1));
    return () => clearInterval(iv);
  }, [active, speed]);

  return (
    <div className="room" ref={(el) => setRoomRef(agent.id, el)}
      style={{ '--theme': rt.theme, borderColor: `${rt.theme}55`, boxShadow: `0 0 0 1px ${rt.theme}22, inset 0 0 60px ${rt.theme}14` }}
      onClick={() => onOpen(agent.id)} title={`Open ${agent.name}`}>
      <div className="room-scan" />
      <RoomFloor theme={rt.theme} />
      <div className="room-hd">
        <span className="room-label" style={{ color: lighten(rt.theme, 0.2) }}>{rt.label}</span>
        <span className="room-dot" style={{ background: active ? '#2ee6a6' : `${rt.theme}88` }} />
      </div>
      <MonitorWall theme={rt.theme} seed={agent.name.length} />
      {!away && (
        <div className="room-stage">
          <div className="agent-pos" style={{ left: x + '%', transition: `left ${1.7 / (speed || 1)}s ease-in-out` }}>
            <div className={active ? 'agent-bob walking' : 'agent-bob'} style={{ animationDuration: `${0.5 / (speed || 1)}s` }}>
              {active && agent.action ? <SpeechBubble text={agent.action} color={rt.theme} /> : null}
              {!active ? <Zzz color={lighten(rt.theme, 0.3)} /> : null}
              <PixelSprite sprite={agent.sprite} color={agent.color} scale={4} mode={active ? 'walk' : 'idle'} flip={flip} speed={speed} />
            </div>
            <div className="agent-name-tag" style={{ borderColor: `${rt.theme}66` }}>{agent.name}</div>
          </div>
        </div>
      )}
      {away && <div className="room-empty">— out visiting —</div>}
    </div>
  );
}

function TravelSprite({ fromC, toC, color, sprite, phase }) {
  const [p, setP] = React.useState(fromC);
  React.useEffect(() => { const id = requestAnimationFrame(() => setP(toC)); return () => cancelAnimationFrame(id); }, []);
  React.useEffect(() => { if (phase === 'back') setP(fromC); }, [phase]);
  const pos = p || fromC || toC;
  if (!pos || !fromC || !toC) return null;
  return (
    <div className="travel-sprite" style={{ left: pos.x, top: pos.y, transition: 'left 1.55s cubic-bezier(.45,.05,.5,.95), top 1.55s cubic-bezier(.45,.05,.5,.95)' }}>
      <PixelSprite sprite={sprite} color={color} scale={3.4} mode="walk" flip={toC.x < fromC.x} speed={1.6} />
    </div>
  );
}

function TravelLayer({ visits, roomRefs, containerRef }) {
  const center = (id) => {
    const el = roomRefs.current[id], c = containerRef.current;
    if (!el || !c) return null;
    const r = el.getBoundingClientRect(), cr = c.getBoundingClientRect();
    return { x: r.left - cr.left + r.width / 2, y: r.top - cr.top + r.height * 0.62 };
  };
  return (
    <div className="travel-layer">
      {visits.map((v) => {
        const f = center(v.from), t = center(v.to);
        if (!f || !t) return null;
        return <TravelSprite key={v.id} fromC={f} toC={t} color={v.color} sprite={v.sprite} phase={v.phase} />;
      })}
    </div>
  );
}

function Ticker({ items }) {
  const txt = items.length
    ? items.map((it) => it.msg).join('   ·   ')
    : 'ACTIVE · agents standing by · feed a task to wake the pipeline';
  const save = () => {
    const lines = items.length
      ? items.map((it) => `[${new Date(it.t).toISOString()}] ${it.msg}`).join('\n')
      : '(no log entries yet)';
    const blob = new Blob([lines], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agent-log-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="ticker">
      <span className="ticker-badge">▸ LIVE</span>
      <div className="ticker-scroll">
        <div className="ticker-track"><span>{txt}</span><span aria-hidden="true">{txt}</span></div>
      </div>
      <button className="ticker-save" onClick={save} title="Save log to .txt">⬇ save</button>
    </div>
  );
}

function AgentCard({ agent, onOpen }) {
  const sm = STATUS_META[agent.status];
  const rt = ROOM_THEMES[agent.roomKey] || { theme: agent.color };
  return (
    <div className="acard" onClick={() => onOpen(agent.id)} style={{ '--theme': rt.theme }}>
      <div className="acard-top">
        <div className="acard-sprite"><PixelSprite sprite={agent.sprite} color={agent.color} scale={2.6} mode={agent.status === 'active' ? 'walk' : 'idle'} speed={1} /></div>
        <div className="acard-id">
          <b>{agent.name}</b>
          <span className="badge" style={{ color: sm.color, borderColor: `${sm.color}66` }}>{sm.label}</span>
        </div>
      </div>
      {agent.status === 'active' && agent.schedule === 'always'
        ? <div className="acard-note">always on · {agent.systemPrompt.split('.')[0].slice(0, 38).toLowerCase()}</div>
        : (
          <div className="acard-rows">
            <div><span>last run</span><span>{__timeAgo(agent.lastRunMs)}</span></div>
            <div><span>next run</span><span>{__nextRun(agent)}</span></div>
          </div>
        )}
    </div>
  );
}

function OfficeView({ speed }) {
  const [s] = useStore();
  const roomRefs = React.useRef({});
  const containerRef = React.useRef(null);
  const setRoomRef = React.useCallback((id, el) => { roomRefs.current[id] = el; }, []);
  const awayIds = new Set(s.visits.map((v) => v.from));
  const open = (id) => Store.set({ editing: id });

  return (
    <div className="office">
      <div className="office-hd">
        <h1><span className="emoji">🎮</span> Agent Office</h1>
        <span className="live"><i />LIVE</span>
      </div>

      <div className="rooms-wrap" ref={containerRef}>
        <div className="rooms-grid">
          {s.agents.map((a) => (
            <AgentRoom key={a.id} agent={a} speed={speed} onOpen={open} away={awayIds.has(a.id)} setRoomRef={setRoomRef} />
          ))}
        </div>
        <TravelLayer visits={s.visits} roomRefs={roomRefs} containerRef={containerRef} />
      </div>

      <Ticker items={s.ticker} />

      <div className="cards-row">
        {s.agents.map((a) => <AgentCard key={a.id} agent={a} onOpen={open} />)}
      </div>
    </div>
  );
}

Object.assign(window, { OfficeView });
