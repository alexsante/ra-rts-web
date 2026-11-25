# RA-RTS-Web — Modern 3D Browser RTS

A playable 3D real-time strategy game inspired by *Command & Conquer: Red Alert*, built with **TypeScript**, **Three.js**, **Web Audio**, and a built-in **WebSocket 1v1 multiplayer relay** — zero external 3D assets or audio downloads required out of the box, plus full support for drop-in `.glb` models and custom audio packs.

---

## Highlights

### 1. True Asymmetric Factions (Allies vs. Soviets)
- **Allied Forces (High-Tech Precision & Mobility)**
  - **Prism Tower** & **Prism Tank:** Focusing photonic laser cannons whose beams **chain-bounce** to strike a secondary nearby enemy!
  - **Chrono Tank:** Hover-skirted rapid missile raider with an automatic **12-second Phase-Blink** warp when ordered to move long distances (`>14` tiles).
  - **Superweapons:** **A-10 Air Strike** (Tech Center) & **Chronosphere** (2-click **Chronoshift** teleporting up to 6 friendly units anywhere on the battlefield!).
- **Soviet Union (Heavy Armor & Overwhelming Firepower)**
  - **Tesla Coil** & **Tesla Trooper:** High-voltage crackling arc discharges that shred armor.
  - **V2 Rocket Launcher:** Long-range ballistic artillery with massive blast radius.
  - **Mammoth Tank:** Quad-tracked dual-cannon titan with self-repair and twin SAM pods.
  - **Kirov Airship:** Heavily armored flying siege zeppelin that glides over canyon cliffs.
  - **Superweapons:** **Iron Curtain** (Tech Center, 10s invulnerability dome) & **Nuclear Silo** (Tactical Nuke with sliding blast doors, global siren, mushroom cloud & radioactive fallout).
- **Shared Core Infrastructure:** Construction Yard, Power Plant, Ore Refinery (with free Ore Harvester), Barracks, War Factory, Gun Turret, Tech Center, Rifle Squad, Rocket Squad, Ore Truck, Medium Tank, capturable **Tech Oil Derricks**, **Bonus Crates**, and Unit Veterancy (`★ Veteran` → `★★★ Elite`).

### 2. Pre-Game Command Lobby (Solo Skirmish & 1v1 Multiplayer)
- Configure **Theater/Map** (*Canyon Protocol*, *Arctic Divide*, *Obsidian Caldera*), **Faction** (*Allies* or *Soviets*), **Starting Credits** (`$3,000` / `$5,000` / `$10,000`), **AI Difficulty** (*Easy* / *Normal* / *Brutal*), and rule toggles (**Fog of War**, **Bonus Crates**, **Superweapons**).
- In **1v1 Multiplayer**, the Host configures settings (and can swap sides), shares a `?room=XXXXXX` link, both players Ready Up, and the match launches with synced settings.

### 3. Multiplayer Upgrades & Deterministic Match Replays
- **Delta-Compressed Snapshots:** After an initial keyframe, the Host streams compact delta diffs (`src/net/delta.ts`) omitting unchanged buildings, stationary units, ore tiles, crates, and derricks — typically cutting snapshot bandwidth by **60–85%**.
- **Mid-Game Reconnect (45s Seat Retention):** Sessions persist a per-tab `sessionToken` (`sessionStorage`). If a connection drops mid-match, the relay holds the seat for 45 seconds, blocks interlopers, and automatically resyncs a full snapshot on reconnect.
- **Deterministic Match Replays:** Every Solo and 1v1 match records seeded ticks + commands (`src/sim/replay.ts`). Download `.json` replays from the **Replay** button or Game Over screen, then load any replay to watch with **Play/Pause**, **1x / 2x / 4x** speed, and a live **timeline scrubber**.

### 4. Drop-In `.glb` 3D Model & Custom Audio Pack Pipeline
- Plays instantly with zero external files using procedural PBR meshes (`LatheGeometry`, beveled armor, PMREM IBL reflections) and Web Audio synthesis.
- Override any unit, building, or SFX cue with custom `.glb` models or `.wav/.mp3/.ogg` clips either:
  - **Live in-game** via the **Assets** button in the top bar (hot-swaps live battlefield meshes immediately), or
  - **Permanently** by dropping files into `public/assets/` and listing them in [`public/assets/manifest.json`](public/assets/manifest.json):

```json
{
  "models": {
    "medium_tank": {
      "url": "/assets/models/medium_tank.glb",
      "rotationY": 0,
      "turretNodeName": "Turret",
      "barrelNodeName": "Barrel",
      "teamColorMaterialPrefix": "TeamColor"
    }
  },
  "audio": {
    "shot_shell": "/assets/audio/tank_cannon.wav",
    "chrono_warp": "/assets/audio/chrono.ogg"
  }
}
```

- Materials whose names start with `TeamColor` automatically tint to Allied Blue or Soviet Red. Models are automatically grounded to `y = 0` and scaled to fit their unit/building footprint if `scale` is omitted.

---

## Quick Start

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (default `http://localhost:5173`).

### Production Build & Server (Static + `/ws` Relay)

```bash
npm run build
npm start
```

Serves `dist/` and the `/ws` multiplayer relay on `http://0.0.0.0:3000` (configurable via `PORT` env var) with a `/health` endpoint. A ready-to-deploy `Dockerfile` is included.

### Automated Verification

```bash
npm run typecheck   # Strict TypeScript check
npm run test:sim    # Headless asymmetric battle, Prism bounce, Chrono warp, AI & Replay determinism test
npm run test:mp     # End-to-end 2-player Lobby, Delta Snapshot compression & Mid-Game Reconnect test
```

---

## Controls

| Input | Action |
| :--- | :--- |
| **Left Click / Drag** | Select unit/building or marquee box select (Double-click selects all matching units on screen) |
| **Right Click** | Move in formation (Chrono Tanks phase-blink on moves `>14` tiles) / Attack enemy / Set Rally Point |
| **G + Click** or **Shift + RMB** | Attack-Move |
| **Chronoshift (2 Clicks)** | Click 1: select friendly squad zone · Click 2: warp destination |
| **Right Click Minimap** | Move / Attack-Move selected units directly to minimap location |
| **Shift + Click Unit Card** | Queue ×5 units at once |
| **Right Click Sidebar Card** | Cancel construction/queue and refund spent credits |
| **R / V** | Toggle Building Repair / Sell mode |
| **B / U** | Switch Structures / Units sidebar tabs |
| **Ctrl + 1–5 / 1–5** | Assign / recall control groups |
| **WASD / Arrows / Middle-Drag** | Pan camera (`Q`/`E` rotate, Scroll zoom, `H`/`Space` home base, `Backspace` jump to attack alert) |
| **Enter** | Open 1v1 multiplayer chat |

---

## Architecture

```text
public/
└── assets/manifest.json  # Optional declarative overrides for .glb models & audio clips
src/
├── sim/        # Headless 20Hz seeded RTS simulation (zero Three.js imports)
│   ├── types.ts, config.ts, mapGen.ts, pathfinding.ts, world.ts, ai.ts, replay.ts
├── assets/     # Optional GLTFLoader override manager & Web Audio pack decoder
│   ├── modelLoader.ts, audioPack.ts
├── render/     # 60fps Three.js PBR presentation layer
│   ├── materials.ts, textures.ts, terrain.ts, buildings.ts, units.ts, vfx.ts, renderer.ts
├── net/        # 2-player Lobby, Delta Sync encoder/decoder, 45s Reconnect relay & client
│   ├── protocol.ts, delta.ts, wsRelayPlugin.ts, multiplayer.ts
├── audio/      # Procedural Web Audio SFX (with custom clip fallback), EVA & synth soundtrack
├── ui/         # Faction-dynamic Red Alert sidebar, minimap, lobby, replay & asset modals
└── main.ts     # Game loop, input dispatcher, replay engine & network wiring
server/
└── index.ts    # Standalone production HTTP + /ws relay server
```
