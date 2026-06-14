// sprites.jsx — pixel-art sprite engine (multiple characters) + room decor.
// Exports to window: shade, lighten, PixelSprite, Zzz, SpeechBubble,
//   MessengerDot, MonitorWall, RoomFloor, SPRITES, SPRITE_LIST.

// ── color helpers ────────────────────────────────────────────────────────────
function __hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const x = h.length === 3 ? h.replace(/./g, (c) => c + c) : h.padEnd(6, '0');
  const n = parseInt(x.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function __mix(a, b, t) {
  const A = __hexToRgb(a), B = __hexToRgb(b);
  return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`;
}
function shade(hex, t = 0.32) { return __mix(hex, '#05060d', t); }
function lighten(hex, t = 0.32) { return __mix(hex, '#ffffff', t); }

// pixel legend:  # body · s underside shade · o eye-white · x dark · g glass/light · d deep detail
function __colorFor(ch, color) {
  switch (ch) {
    case '#': return color;
    case 's': return shade(color, 0.45);
    case 'o': return '#f4f7ff';
    case 'x': return '#0a0e1a';
    case 'g': return lighten(color, 0.6);
    case 'd': return shade(color, 0.7);
    default: return null;
  }
}

// ── sprite frame data (all 14×14) ──────────────────────────────────────────────
const OCTO_A = ['....######....','..##########..','.############.','##############','##############','###oo####oo###','###xo####xo###','##############','##############','#############s','.ssssssssssss.','##.##.##.##.##','##.##.##.##.##','.#..#..#..#...'];
const OCTO_B = ['....######....','..##########..','.############.','##############','##############','###oo####oo###','###ox####ox###','##############','##############','#############s','.ssssssssssss.','##.##.##.##.##','##.##.##.##.##','...#..#..#..#.'];
const OCTO_I = ['....######....','..##########..','.############.','##############','##############','##############','###oo####oo###','##############','##############','#############s','.ssssssssssss.','.##.##.##.##.#','..#..#..#..#..','..............'];

const ROBO_A = ['......##......','.....g##g.....','..##########..','..##########..','..#oo####oo#..','..#oo####oo#..','..##########..','..#gggggggg#..','..##########..','...ssssssss...','..g########g..','...########...','...##..##.....','...##..##.....'];
const ROBO_B = ['......##......','.....g##g.....','..##########..','..##########..','..#oo####oo#..','..#oo####oo#..','..##########..','..#gggggggg#..','..##########..','...ssssssss...','..g########g..','...########...','....##..##....','....##..##....'];
const ROBO_I = ['......##......','.....g##g.....','..##########..','..##########..','..#gg####gg#..','..#gg####gg#..','..##########..','..#gggggggg#..','..##########..','...ssssssss...','..g########g..','...########...','....######....','....######....'];

const PERS_A = ['.....####.....','....######....','....######....','....#o##o#....','....######....','...########...','..##########..','..#.######.#..','....######....','....######....','....##..##....','....##..##....','....##..##....','...###..###...'];
const PERS_B = ['.....####.....','....######....','....######....','....#o##o#....','....######....','...########...','..##########..','..#.######.#..','....######....','....######....','...##....##...','..##......##..','.###......###.','###........###'];
const PERS_I = ['.....####.....','....######....','....######....','....#o##o#....','....######....','...########...','..##########..','..#.######.#..','....######....','....######....','....######....','....######....','....##..##....','...###..###...'];

const CAT_A = ['..##......##..','..##......##..','..##########..','..#oo####oo#..','..####gg####..','..##########..','.############.','##############','##############','##############','.############.','..##.####.##..','..##......##..','..##......##..'];
const CAT_B = ['..##......##..','..##......##..','..##########..','..#oo####oo#..','..####gg####..','..##########..','.############.','##############','##############','##############','.############.','..##.####.##..','...##....##...','...##....##...'];
const CAT_I = ['..##......##..','..##......##..','..##########..','..#gg####gg#..','..####gg####..','..##########..','.############.','##############','##############','##############','.############.','..########.##.','...######.....','..............'];

const CAR_A = ['..............','..............','....######....','...########...','..##gggggg##..','.############.','##############','##############','##############','##############','.xxx......xxx.','.xgx......xgx.','.xxx......xxx.','..............'];
const CAR_B = ['..............','..............','....######....','...########...','..##gggggg##..','.############.','##############','##############','##############','##############','.xxx......xxx.','.gxx......gxx.','.xxx......xxx.','..............'];
const CAR_I = ['..............','..............','....######....','...########...','..##gggggg##..','.############.','##############','##############','##############','##############','.xxx......xxx.','.xgx......xgx.','.xxx......xxx.','..............'];

const ROCK_A = ['......##......','.....####.....','.....####.....','.....####.....','.....#gg#.....','.....####.....','.....####.....','....######....','...########...','..##.####.##..','.##..####..##.','.....####.....','.....gggg.....','......gg......'];
const ROCK_B = ['......##......','.....####.....','.....####.....','.....####.....','.....#gg#.....','.....####.....','.....####.....','....######....','...########...','..##.####.##..','.##..####..##.','.....####.....','.....g..g.....','......gg......'];
const ROCK_I = ['......##......','.....####.....','.....####.....','.....####.....','.....#gg#.....','.....####.....','.....####.....','....######....','...########...','..##.####.##..','.##..####..##.','.....####.....','......gg......','......g.......'];

const SPRITES = {
  octo:   { walk: [OCTO_A, OCTO_B], idle: [OCTO_I] },
  robot:  { walk: [ROBO_A, ROBO_B], idle: [ROBO_I] },
  person: { walk: [PERS_A, PERS_B], idle: [PERS_I] },
  cat:    { walk: [CAT_A, CAT_B],   idle: [CAT_I] },
  car:    { walk: [CAR_A, CAR_B],   idle: [CAR_I] },
  rocket: { walk: [ROCK_A, ROCK_B], idle: [ROCK_I] },
};
const SPRITE_LIST = [
  { id: 'octo', label: 'Octopus' },
  { id: 'person', label: 'Person' },
  { id: 'robot', label: 'Robot' },
  { id: 'cat', label: 'Cat' },
  { id: 'car', label: 'Car' },
  { id: 'rocket', label: 'Rocket' },
];

// ── PixelSprite ───────────────────────────────────────────────────────────────
function PixelSprite({ sprite = 'octo', color = '#a06bff', scale = 5, mode = 'idle', flip = false, speed = 1 }) {
  const ref = React.useRef(null);
  const set = SPRITES[sprite] || SPRITES.octo;
  const frames = set[mode] || set.idle;
  const [f, setF] = React.useState(0);
  React.useEffect(() => {
    if (frames.length < 2) { setF(0); return; }
    const iv = setInterval(() => setF((p) => (p + 1) % frames.length), 230 / (speed || 1));
    return () => clearInterval(iv);
  }, [mode, sprite, speed, frames.length]);
  React.useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const m = frames[f % frames.length];
    const rows = m.length, cols = m[0].length;
    cv.width = cols; cv.height = rows;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cols, rows);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const c = __colorFor(m[y][x], color);
      if (c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); }
    }
  }, [f, color, sprite, mode]);
  const dim = (frames[0] || ['..............']);
  return (
    <canvas ref={ref} className="pixel-sprite" style={{
      width: (dim[0].length) * scale, height: dim.length * scale, imageRendering: 'pixelated',
      transform: flip ? 'scaleX(-1)' : 'none',
      filter: `drop-shadow(0 0 ${scale * 1.3}px ${__mix(color, '#000', 0.1)}55)`,
    }} />
  );
}

// ── Zzz / speech / decor ────────────────────────────────────────────────────
function Zzz({ color = '#9fb0d8' }) {
  return (
    <div className="zzz" aria-hidden="true">
      <span style={{ color, animationDelay: '0s' }}>z</span>
      <span style={{ color, animationDelay: '.45s' }}>z</span>
      <span style={{ color, animationDelay: '.9s' }}>z</span>
    </div>
  );
}
function SpeechBubble({ text, color = '#2ee6a6' }) {
  if (!text) return null;
  return (
    <div className="speech" style={{ borderColor: color, color: lighten(color, 0.25) }}>
      {text}<i style={{ borderTopColor: color }} />
    </div>
  );
}
function MessengerDot({ color }) {
  return <span className="msg-dot" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />;
}
function MonitorWall({ theme, seed = 0 }) {
  const lines = (n) => Array.from({ length: n });
  return (
    <div className="mwall" aria-hidden="true">
      <div className="mwall-row">
        {lines(3 + (seed % 2)).map((_, i) => (
          <div key={i} className="monitor" style={{ borderColor: `${theme}55` }}>
            {lines(2 + ((i + seed) % 3)).map((__, j) => (
              <span key={j} className="mline" style={{ background: `${theme}${j === 0 ? 'cc' : '66'}`, width: `${40 + ((i * 13 + j * 29 + seed * 7) % 55)}%` }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
function RoomFloor({ theme }) {
  return <div className="rfloor" aria-hidden="true" style={{ backgroundImage: `linear-gradient(${theme}22 1px, transparent 1px), linear-gradient(90deg, ${theme}22 1px, transparent 1px)` }} />;
}

Object.assign(window, { shade, lighten, PixelSprite, Zzz, SpeechBubble, MessengerDot, MonitorWall, RoomFloor, SPRITES, SPRITE_LIST });
