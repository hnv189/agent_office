# 05 · Rendering & sprites

All pixel art and room decor lives in `sprites.jsx`.

## Sprites are 14×14 character matrices

Each character has frames stored as arrays of **14 strings, each 14 characters
long**. Example (one frame):

```js
const OCTO_A = [
  '....######....',
  '..##########..',
  // … 14 rows total, each 14 chars …
];
```

### Pixel legend

Each character in a matrix maps to a colour derived from the agent's colour, so one
sprite reads as a single themed creature with shading and highlights:

| Char | Meaning | Colour |
|------|---------|--------|
| `#` | body | the agent colour |
| `s` | underside shadow | `shade(color, .45)` |
| `o` | eye white / highlight | `#f4f7ff` (fixed) |
| `x` | dark detail (pupil, wheels, outline) | `#0a0e1a` (fixed) |
| `g` | glass / light accent (windows, screens, flame) | `lighten(color, .6)` |
| `d` | deep detail | `shade(color, .7)` |
| `.` or space | transparent | — |

`shade()` and `lighten()` are exported helpers (mix toward near-black / white).

## The character set

`SPRITES` maps an id to `{ walk: [frameA, frameB], idle: [frameI] }`:

```
octo · person · robot · cat · car · rocket
```

`SPRITE_LIST` is the ordered `[{ id, label }]` used to render the editor's
Character picker.

- **walk** alternates frameA/frameB to animate motion;
- **idle** is a single resting pose (e.g. eyes half-closed, wheels still).

## `PixelSprite` component

```jsx
<PixelSprite sprite="cat" color="#ff9b4d" scale={4} mode="walk" flip={false} speed={1} />
```

| Prop | Default | Notes |
|------|---------|-------|
| `sprite` | `'octo'` | key into `SPRITES` |
| `color` | `'#a06bff'` | tints every `#`/`s`/`g`/`d` pixel |
| `scale` | `5` | CSS pixels per sprite pixel |
| `mode` | `'idle'` | `'walk'` or `'idle'` |
| `flip` | `false` | mirror horizontally (used for walk direction) |
| `speed` | `1` | multiplies the walk frame rate |

It draws the current frame to a 14×14 `<canvas>` and scales it up with
`image-rendering: pixelated`, so it stays crisp at any size. When `mode` has ≥2
frames it advances them on a `setInterval` (≈230 ms ÷ speed).

## Rooms & decor

Rooms are pure CSS + a few helper components:

- **`RoomFloor`** — a perspective grid floor tinted by the room theme.
- **`MonitorWall`** — procedurally-laid-out "monitors" with flickering data lines,
  seeded per agent so each room looks a little different.
- **`SpeechBubble`** — the themed bubble shown above an active agent.
- **`Zzz`** — the floating sleep marker for idle agents.
- **`MessengerDot`** — a small glowing dot used for message-flow effects.

Room theming comes from `ROOM_THEMES[roomKey]` (`{ label, theme }`). The accent
colour drives borders, glows, the floor grid, and the monitor lines.

## Animation rules

- Walk cadence and in-room horizontal movement are scaled by the **`animSpeed`**
  tweak (and the `speed` prop).
- CSS keyframes (`bob`, `zfloat`, `scroll`, `flow`, `pulse`, `flicker`) live in
  `base.css` / `ui.css`. They all respect `@media (prefers-reduced-motion: reduce)`,
  which disables looping motion.

## Where sprites are drawn

`PixelSprite` is used in: the office rooms (`office.jsx`), the room-to-room travel
overlay, the agent cards, the sidebar brand mark (`app.jsx`), the connections graph
nodes (`connections.jsx`), the task pipeline chips (`tasks.jsx`), and the editor
hero + Character picker (`editor.jsx`). All of them pass `agent.sprite` so a
character change is reflected everywhere at once.
