# RA-RTS-Web — Modern 3D Browser RTS

A playable 3D real-time strategy game inspired by *Command & Conquer: Red Alert*, built with **TypeScript**, **Three.js**, **Web Audio**, and a built-in **WebSocket 1v1 multiplayer relay** — zero external 3D assets or texture downloads required.

## Highlights

- **3D PBR Graphics & Procedural Models:** Procedural sunlit PMREM environment reflections, beveled military armor & `LatheGeometry` silhouettes, riveted armor/concrete/corrugated/tread bump & roughness maps, soft PCF shadows, contact AO decals, sky domes, and subtle `UnrealBloomPass` post-processing.
- **Classic *Red Alert* Gameplay Loop:**
  - **9 Structures:** Construction Yard, Power Plant, Ore Refinery (with free Ore Truck), Barracks, War Factory, Gun Turret, Tesla Coil, Tech Center, and Nuclear Silo (with animated sliding blast doors).
  - **8 Units:** Rifle Squad, Rocket Squad, Tesla Trooper, Ore Truck, Medium Tank, V2 Rocket Launcher, Mammoth Tank, and **Kirov Airship** (high-altitude flying zeppelin).
  - **3 Superweapons:** **A-10 Air Strike** (twin swooping 3D jets + carpet bombs), **Iron Curtain** (10s invulnerability energy dome), and **Tactical Nuclear Missile** (global siren, descending warhead, mushroom cloud, screen shake, and radioactive fallout).
  - **Skirmish Depth:** Unit Veterancy (`★ Veteran` → `★★★ Elite`), capturable **Tech Oil Derricks**, spawning **Bonus Crates**, continuous C&C credit drain, Low Power penalties, Repair (`R`) & Sell (`V`) modes, and Fog of War.
- **3 Playable Biomes:** *Canyon Protocol* (desert mesas), *Arctic Redoubt* (snowpass & pines), and *Volcanic Basin* (dusk caldera).
- **1v1 Multiplayer via Invite Link:** Click **1v1 Multiplayer → Host** to generate a shareable `?room=XXXXXX` link. Uses a Host-Authoritative command + 15Hz snapshot model over `/ws` with live ping, faction-scoped Fog of War, and in-game chat (`Enter`).
- **Procedural Web Audio:** Synthesized cannons, rockets, Tesla zaps, sirens, explosions, EVA speech alerts, and an optional 116 BPM industrial rock synth soundtrack.

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

Serves `dist/` and the `/ws` multiplayer relay on `http://0.0.0.0:3000` (configurable via `PORT` env var) with a `/health` endpoint. A ready-to-deploy `Dockerfile` is included for Fly.io, Railway, Render, or any container host.

### Automated Verification

```bash
npm run typecheck   # Strict TypeScript check
npm run test:sim    # 90-second headless battle, superweapons, derricks & AI test
npm run test:mp     # End-to-end 2-player WebSocket room, command authority & sync test
```

---

## Controls

| Input | Action |
| :--- | :--- |
| **Left Click / Drag** | Select unit/building or marquee box select (Double-click selects all matching units on screen) |
| **Right Click** | Move in formation / Attack enemy / Set Rally Point (when Barracks or War Factory is selected) |
| **G + Click** or **Shift + RMB** | Attack-Move |
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
src/
├── sim/        # Headless 20Hz RTS simulation (zero Three.js imports)
│   ├── types.ts, config.ts, mapGen.ts, pathfinding.ts, world.ts, ai.ts
├── render/     # 60fps Three.js PBR presentation layer
│   ├── materials.ts, textures.ts, terrain.ts, buildings.ts, units.ts, vfx.ts, renderer.ts
├── net/        # 2-player Host-Authoritative WebSocket relay & client
│   ├── protocol.ts, wsRelayPlugin.ts, multiplayer.ts
├── audio/      # Procedural Web Audio SFX, EVA alerts & industrial synth music
├── ui/         # Classic modernized Red Alert sidebar, minimap & lobby modals
└── main.ts     # Game loop, input dispatcher & network wiring
server/
└── index.ts    # Standalone production HTTP + /ws relay server
```
