import { MAP_SIZE, tileToWorld, worldToTile } from './config';
import { Vec2 } from './types';

const DIRS: ReadonlyArray<[number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, 1.4142],
  [1, -1, 1.4142],
  [-1, 1, 1.4142],
  [-1, -1, 1.4142],
];

// Reusable typed arrays for zero-GC A*
const TOTAL_CELLS = MAP_SIZE * MAP_SIZE;
const gScore = new Float32Array(TOTAL_CELLS);
const fScore = new Float32Array(TOTAL_CELLS);
const cameFrom = new Int32Array(TOTAL_CELLS);
const closedStamp = new Int32Array(TOTAL_CELLS);
const openStamp = new Int32Array(TOTAL_CELLS);
let searchId = 1;

// Simple binary min-heap for open set
class MinHeap {
  private nodes: number[] = [];

  clear(): void {
    this.nodes.length = 0;
  }

  get size(): number {
    return this.nodes.length;
  }

  push(cell: number): void {
    this.nodes.push(cell);
    this.bubbleUp(this.nodes.length - 1);
  }

  pop(): number {
    const top = this.nodes[0];
    const last = this.nodes.pop()!;
    if (this.nodes.length > 0) {
      this.nodes[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  private bubbleUp(i: number): void {
    const node = this.nodes[i];
    const score = fScore[node];
    while (i > 0) {
      const parentIdx = (i - 1) >> 1;
      const parent = this.nodes[parentIdx];
      if (score >= fScore[parent]) break;
      this.nodes[i] = parent;
      i = parentIdx;
    }
    this.nodes[i] = node;
  }

  private sinkDown(i: number): void {
    const len = this.nodes.length;
    const node = this.nodes[i];
    const score = fScore[node];
    while (true) {
      const left = (i << 1) + 1;
      const right = left + 1;
      let smallest = i;
      let smallestScore = score;
      if (left < len && fScore[this.nodes[left]] < smallestScore) {
        smallest = left;
        smallestScore = fScore[this.nodes[left]];
      }
      if (right < len && fScore[this.nodes[right]] < smallestScore) {
        smallest = right;
      }
      if (smallest === i) break;
      this.nodes[i] = this.nodes[smallest];
      i = smallest;
    }
    this.nodes[i] = node;
  }
}

const openHeap = new MinHeap();

function heuristic(ax: number, az: number, bx: number, bz: number): number {
  const dx = Math.abs(ax - bx);
  const dz = Math.abs(az - bz);
  return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz);
}

function findNearestPassable(
  gx: number,
  gz: number,
  blocked: Uint8Array,
  maxRadius = 8
): { gx: number; gz: number } | null {
  if (!blocked[gz * MAP_SIZE + gx]) return { gx, gz };
  for (let r = 1; r <= maxRadius; r++) {
    let best: { gx: number; gz: number } | null = null;
    let bestD = Infinity;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        const nx = gx + dx;
        const nz = gz + dz;
        if (nx < 1 || nz < 1 || nx >= MAP_SIZE - 1 || nz >= MAP_SIZE - 1) continue;
        if (!blocked[nz * MAP_SIZE + nx]) {
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = { gx: nx, gz: nz };
          }
        }
      }
    }
    if (best) return best;
  }
  return null;
}

function lineClear(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  blocked: Uint8Array
): boolean {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const steps = Math.ceil(Math.hypot(dx, dz) * 2);
  if (steps <= 1) return true;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const gx = Math.floor(x0 + dx * t + 0.5);
    const gz = Math.floor(z0 + dz * t + 0.5);
    if (gx < 0 || gz < 0 || gx >= MAP_SIZE || gz >= MAP_SIZE) return false;
    if (blocked[gz * MAP_SIZE + gx]) return false;
  }
  return true;
}

export function findPath(
  startWorld: Vec2,
  goalWorld: Vec2,
  blocked: Uint8Array
): Vec2[] {
  const startTileRaw = worldToTile(startWorld.x, startWorld.z);
  const goalTileRaw = worldToTile(goalWorld.x, goalWorld.z);

  const startTile = findNearestPassable(startTileRaw.gx, startTileRaw.gz, blocked, 6);
  const goalTile = findNearestPassable(goalTileRaw.gx, goalTileRaw.gz, blocked, 8);
  if (!startTile || !goalTile) return [];

  if (startTile.gx === goalTile.gx && startTile.gz === goalTile.gz) {
    return [{ x: goalWorld.x, z: goalWorld.z }];
  }

  searchId++;
  if (searchId > 1_000_000_000) {
    closedStamp.fill(0);
    openStamp.fill(0);
    searchId = 1;
  }

  const startIdx = startTile.gz * MAP_SIZE + startTile.gx;
  const goalIdx = goalTile.gz * MAP_SIZE + goalTile.gx;

  openHeap.clear();
  gScore[startIdx] = 0;
  fScore[startIdx] = heuristic(startTile.gx, startTile.gz, goalTile.gx, goalTile.gz);
  cameFrom[startIdx] = -1;
  openStamp[startIdx] = searchId;
  openHeap.push(startIdx);

  let found = false;
  let closestIdx = startIdx;
  let closestH = fScore[startIdx];
  let iterations = 0;
  const maxIterations = 2400;

  while (openHeap.size > 0 && iterations++ < maxIterations) {
    const current = openHeap.pop();
    if (closedStamp[current] === searchId) continue;
    closedStamp[current] = searchId;

    if (current === goalIdx) {
      found = true;
      break;
    }

    const cx = current % MAP_SIZE;
    const cz = (current - cx) / MAP_SIZE;
    const curG = gScore[current];

    for (const [dx, dz, cost] of DIRS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= MAP_SIZE || nz >= MAP_SIZE) continue;
      const nIdx = nz * MAP_SIZE + nx;
      if (closedStamp[nIdx] === searchId) continue;
      if (blocked[nIdx]) continue;

      // Prevent squeezing diagonally through two blocked corners
      if (dx !== 0 && dz !== 0) {
        if (blocked[cz * MAP_SIZE + nx] || blocked[nz * MAP_SIZE + cx]) continue;
      }

      const tentativeG = curG + cost;
      if (openStamp[nIdx] !== searchId || tentativeG < gScore[nIdx]) {
        cameFrom[nIdx] = current;
        gScore[nIdx] = tentativeG;
        const h = heuristic(nx, nz, goalTile.gx, goalTile.gz);
        fScore[nIdx] = tentativeG + h;
        openStamp[nIdx] = searchId;
        openHeap.push(nIdx);

        if (h < closestH) {
          closestH = h;
          closestIdx = nIdx;
        }
      }
    }
  }

  const endIdx = found ? goalIdx : closestIdx;
  if (endIdx === startIdx) return [];

  // Reconstruct tile path
  const tiles: Array<{ gx: number; gz: number }> = [];
  let cur = endIdx;
  while (cur !== -1 && cur !== startIdx) {
    const gx = cur % MAP_SIZE;
    const gz = (cur - gx) / MAP_SIZE;
    tiles.push({ gx, gz });
    cur = cameFrom[cur];
  }
  tiles.reverse();
  if (tiles.length === 0) return [];

  // String-pull smoothing so units move in crisp natural lines
  const smoothed: Array<{ gx: number; gz: number }> = [];
  let anchor = startTile;
  let i = 0;
  while (i < tiles.length) {
    let farthest = i;
    for (let j = Math.min(tiles.length - 1, i + 12); j > i; j--) {
      if (lineClear(anchor.gx, anchor.gz, tiles[j].gx, tiles[j].gz, blocked)) {
        farthest = j;
        break;
      }
    }
    smoothed.push(tiles[farthest]);
    anchor = tiles[farthest];
    i = farthest + 1;
  }

  const waypoints = smoothed.map((t) => tileToWorld(t.gx, t.gz));
  // If the exact goal world coordinate is walkable, use it as the final waypoint for precision
  if (found && !blocked[goalTileRaw.gz * MAP_SIZE + goalTileRaw.gx]) {
    waypoints[waypoints.length - 1] = { x: goalWorld.x, z: goalWorld.z };
  }
  return waypoints;
}
