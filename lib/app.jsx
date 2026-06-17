// app.jsx — Mission Control shell, sidebar nav, routing, tweaks, engine boot.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#2ee6a6",
  "animSpeed": 1,
  "graphStyle": "wires"
}/*EDITMODE-END*/;

const ACCENTS = ['#2ee6a6', '#5cc8ff', '#c07bff', '#ff6f9c', '#ffd23f'];

function NavItem({ icon, label, active, dot, onClick }) {
  return (
    <button className={'nav' + (active ? ' active' : '')} onClick={onClick}>
      <span className="nav-ic">{icon}</span>
      <span className="nav-lbl">{label}</span>
      {dot && <span className="nav-dot" />}
    </button>
  );
}

function Sidebar({ view }) {
  const [s] = useStore();
  const online = s.agents.find((a) => a.schedule === 'always') || s.agents[0];
  const [connStatus, setConnStatus] = React.useState('idle');
  const [modelName, setModelName] = React.useState('');

  React.useEffect(() => {
    if (!s.liveMode) { setConnStatus('idle'); setModelName(''); return; }
    const baseUrl = (s.settings.lmstudio.baseUrl || 'http://localhost:1234/v1').replace(/\/+$/, '');
    const check = async () => {
      setConnStatus('checking');
      try {
        const res = await fetch(baseUrl + '/models', { signal: AbortSignal.timeout(4000) });
        if (res.ok) {
          const j = await res.json();
          setModelName(j?.data?.[0]?.id || '');
          setConnStatus('ok');
        } else {
          setModelName('');
          setConnStatus('fail');
        }
      } catch {
        setModelName('');
        setConnStatus('fail');
      }
    };
    check();
    const id = setInterval(check, 15000);
    return () => clearInterval(id);
  }, [s.liveMode, s.settings.lmstudio.baseUrl]);

  return (
    <aside className="side">
      <div className="brand"><PixelSprite sprite={online?.sprite} color={online?.color || '#a06bff'} scale={3} mode="walk" speed={1} /></div>
      <div className="mc">
        <div className="mc-box">MISSION<br />CONTROL</div>
        <div className="mc-status"><i style={{ background: '#2ee6a6' }} />{(online?.name || 'AGENT').toUpperCase()} ONLINE</div>
      </div>
      <nav className="navs">
        <NavItem icon="🎮" label="Agent Office" active={view === 'office'} dot onClick={() => Store.set({ view: 'office' })} />
        <NavItem icon="🎯" label="Tasks" active={view === 'tasks'} onClick={() => Store.set({ view: 'tasks' })} />
        <NavItem icon="🔗" label="Connections" active={view === 'connections'} onClick={() => Store.set({ view: 'connections' })} />
        <NavItem icon="⟳" label="Self-Improve" active={view === 'learning'} onClick={() => Store.set({ view: 'learning' })} />
        <NavItem icon="🤗" label="Model Hub" active={view === 'hub'} onClick={() => Store.set({ view: 'hub' })} />
        <NavItem icon="⚙" label="Settings" onClick={() => Store.set({ settingsOpen: true })} />
      </nav>
      <div className="side-ft">
        <button className="add-agent" onClick={() => { const id = Store.addAgent(); Store.set({ editing: id }); }}>＋ Add agent</button>
        <button className={'mode-pill' + (s.liveMode ? ' live' : '')} onClick={() => Store.set({ liveMode: !s.liveMode })}>
          <i />{s.liveMode ? 'LIVE' : 'DEMO'}
        </button>
        {s.liveMode && (
          <div className={'conn-status ' + connStatus}>
            <i />
            <span>
              {connStatus === 'ok' ? 'connected' : connStatus === 'fail' ? 'no model' : 'checking…'}
              {connStatus === 'ok' && modelName && <span className="conn-model">{modelName}</span>}
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}

class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 40, fontFamily: 'var(--mono)', color: '#ff8fa3' }}>
          <h2 style={{ fontFamily: 'var(--ui)' }}>Something glitched.</h2>
          <p style={{ color: 'var(--muted)' }}>{String(this.state.err.message || this.state.err)}</p>
          <button className="btn" onClick={() => this.setState({ err: null })}>Reload view</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [s] = useStore();
  // keep engine speed live without restarting the loop
  const speedRef = React.useRef(t.animSpeed); speedRef.current = t.animSpeed;
  React.useEffect(() => { const stop = startEngine(() => speedRef.current); return stop; }, []);

  return (
    <div className="app" style={{ '--accent': t.accent }}>
      <Sidebar view={s.view} />
      <main className="main">
        <ErrorBoundary key={s.view}>
          {s.view === 'office' && <OfficeView speed={t.animSpeed} />}
          {s.view === 'tasks' && <TasksView />}
          {s.view === 'connections' && <ConnectionsView graphStyle={t.graphStyle} />}
          {s.view === 'learning' && <SelfImproveView />}
          {s.view === 'hub' && <ModelHubView />}
        </ErrorBoundary>
      </main>

      <EditorDrawer />
      <SettingsDrawer />

      <TweaksPanel>
        <TweakSection label="Look" />
        <TweakColor label="Neon accent" value={t.accent} options={ACCENTS} onChange={(v) => setTweak('accent', v)} />
        <TweakSection label="Motion" />
        <TweakSlider label="Agent speed" value={t.animSpeed} min={0.3} max={2.5} step={0.1} unit="×" onChange={(v) => setTweak('animSpeed', v)} />
        <TweakSection label="Connections graph" />
        <TweakRadio label="Wire style" value={t.graphStyle} options={[{ value: 'wires', label: 'Curved' }, { value: 'ortho', label: 'Right-angle' }, { value: 'beam', label: 'Beam' }]} onChange={(v) => setTweak('graphStyle', v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
