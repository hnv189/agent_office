// connections.jsx — drag-the-agents node graph with 3 wire styles (tweak),
// connect-mode, animated message flow, and an editable connection list.
// Exports: ConnectionsView.

function wirePath(a, b, style) {
  const ax = a.x, ay = a.y, bx = b.x, by = b.y;
  if (style === 'ortho') {
    const mx = (ax + bx) / 2;
    return `M ${ax} ${ay} L ${mx} ${ay} L ${mx} ${by} L ${bx} ${by}`;
  }
  if (style === 'beam') return `M ${ax} ${ay} L ${bx} ${by}`;
  // curved wires (default)
  const dx = Math.max(40, Math.abs(bx - ax) * 0.5);
  return `M ${ax} ${ay} C ${ax + dx} ${ay}, ${bx - dx} ${by}, ${bx} ${by}`;
}

function ConnectionsView({ graphStyle = 'wires' }) {
  const [s] = useStore();
  const wrapRef = React.useRef(null);
  const [, tick] = React.useReducer((x) => x + 1, 0);
  const [connectFrom, setConnectFrom] = React.useState(null);
  const [size, setSize] = React.useState({ w: 900, h: 520 });

  // layout: seed any missing node positions in a circle
  React.useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); setSize({ w: r.width, h: r.height }); });
    ro.observe(el);
    const r = el.getBoundingClientRect(); setSize({ w: r.width, h: r.height });
    const pos = { ...Store.get().nodePos };
    let changed = false;
    const cx = r.width / 2, cy = r.height / 2, rad = Math.min(r.width, r.height) * 0.34;
    s.agents.forEach((a, i) => {
      if (!pos[a.id]) {
        const ang = (i / s.agents.length) * Math.PI * 2 - Math.PI / 2;
        pos[a.id] = { x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad };
        changed = true;
      }
    });
    if (changed) Store.set({ nodePos: pos });
    return () => ro.disconnect();
  }, [s.agents.length]);

  const pos = (id) => s.nodePos[id] || { x: size.w / 2, y: size.h / 2 };

  const startDrag = (id, e) => {
    e.preventDefault(); e.stopPropagation();
    const wrap = wrapRef.current.getBoundingClientRect();
    const move = (ev) => {
      const x = Math.max(40, Math.min(size.w - 40, ev.clientX - wrap.left));
      const y = Math.max(36, Math.min(size.h - 36, ev.clientY - wrap.top));
      Store.set((st) => ({ ...st, nodePos: { ...st.nodePos, [id]: { x, y } } }));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const nodeClick = (id) => {
    if (!connectFrom) { setConnectFrom(id); return; }
    if (connectFrom === id) { setConnectFrom(null); return; }
    Store.toggleConnection(connectFrom, id);
    setConnectFrom(null);
  };

  return (
    <div className="page">
      <div className="page-hd">
        <h1><span className="emoji">🔗</span> Connections</h1>
        <div className="conn-tools">
          <span className="muted">{connectFrom ? `pick a target for ${s.agents.find((a) => a.id === connectFrom)?.name}…` : 'click an agent, then another, to link them'}</span>
          {connectFrom && <button className="btn ghost sm" onClick={() => setConnectFrom(null)}>cancel</button>}
        </div>
      </div>

      <div className="graph" ref={wrapRef}>
        <svg className="graph-wires" width={size.w} height={size.h}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="#7c89b0" />
            </marker>
          </defs>
          {s.connections.map((c, i) => {
            const a = pos(c.from), b = pos(c.to);
            const col = s.agents.find((x) => x.id === c.from)?.color || '#7c89b0';
            const d = wirePath(a, b, graphStyle);
            return (
              <g key={i}>
                <path d={d} fill="none" stroke={col} strokeOpacity="0.5" strokeWidth={graphStyle === 'beam' ? 3 : 2} markerEnd="url(#arrow)" style={graphStyle === 'beam' ? { filter: `drop-shadow(0 0 5px ${col})` } : null} />
                <div />
              </g>
            );
          })}
        </svg>
        {/* animated message flow dots, layered above wires */}
        <div className="graph-flow">
          {s.connections.map((c, i) => {
            const a = pos(c.from), b = pos(c.to);
            const col = s.agents.find((x) => x.id === c.from)?.color || '#7c89b0';
            const d = wirePath(a, b, graphStyle);
            return <span key={i} className="flow-dot" style={{ offsetPath: `path('${d}')`, WebkitOffsetPath: `path('${d}')`, background: col, boxShadow: `0 0 8px ${col}`, animationDelay: `${(i % 5) * 0.5}s` }} />;
          })}
        </div>
        {s.agents.map((a) => {
          const p = pos(a.id);
          const sel = connectFrom === a.id;
          return (
            <div key={a.id} className={'gnode' + (sel ? ' sel' : '')} style={{ left: p.x, top: p.y, '--theme': a.color }}
              onPointerDown={(e) => startDrag(a.id, e)} onClick={() => nodeClick(a.id)}>
              <PixelSprite sprite={a.sprite} color={a.color} scale={2.4} mode={a.status === 'active' ? 'walk' : 'idle'} speed={1} />
              <span className="gnode-name">{a.name}</span>
            </div>
          );
        })}
      </div>

      <div className="conn-list">
        <div className="sect-l">Pipelines</div>
        {s.connections.length === 0 && <div className="empty">No connections yet.</div>}
        {s.connections.map((c, i) => {
          const f = s.agents.find((a) => a.id === c.from), t = s.agents.find((a) => a.id === c.to);
          if (!f || !t) return null;
          return (
            <div key={i} className="conn-item">
              <span className="conn-chip" style={{ '--theme': f.color }}>{f.name}</span>
              <span className="conn-arrow" style={{ color: f.color }}>───▸</span>
              <span className="conn-chip" style={{ '--theme': t.color }}>{t.name}</span>
              <button className="icon-btn" onClick={() => Store.toggleConnection(c.from, c.to)} aria-label="Remove">✕</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window, { ConnectionsView });
