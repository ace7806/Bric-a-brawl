import type RAPIER from '@dimforge/rapier2d-deterministic-compat';
import { assert, assertFinite, assertNever, requireAt, requireKey } from './assert';
import { getArenaSpec, getFighterSpec, getGameData, type ChunkSpec, type PlatformSpec } from './data';
import {
  ArenaId,
  BowlHalf,
  ChunkState,
  CrackSource,
  ErrorCode,
  FighterFlag,
  FighterId,
  FighterState,
  HazardId,
  KoCause,
  PlatformKind,
  SimEventKind,
  TimelineAction,
} from './enums';
import { polygonCentroid } from './geometry';
import { SeededRng } from './prng';
import type {
  ChunkRuntime,
  FighterRuntime,
  IslandState,
  LedgePoint,
  PlatformRuntime,
  SimEvent,
} from './types';

export type RapierApi = typeof RAPIER;

export interface SurfaceHit {
  readonly y: number;
  readonly chunkIndex: number;
  readonly platformIndex: number;
  readonly isOneWay: boolean;
}

const DT = 1 / 60;
const DEG_TO_RAD = Math.PI / 180;
const PLAYER_SCALE_CUTOFF = 4;
const PLAYER_SHIFT_TICKS = 600;
const CRAZE_HP_RATIO = 0.4;
const RUBBLE_RADIUS_MIN = 0.22;
const RUBBLE_RADIUS_MAX = 0.34;
const RUBBLE_TTL_TICKS = 60 * 35;
const REST_SPEED_SQ = 0.04;
const REST_ANG_VEL = 0.15;
const TEACUP_HALF_HEIGHT = 0.18;
const BOWL_DRIFT_SPEED = 0.14;
const BOWL_MAX_GAP = 8.0;
const BOWL_TILT_SPEED_DEG = 0.5;
const BOWL_MAX_TILT_DEG = 12.0;
const BOWL_PIVOT_Y = -2.8;
const SEESAW_PIVOT_Y = 8.0;
const SEESAW_MAX_ANGLE_DEG = 14.0;
const SEESAW_MAX_SPEED_DEG = 40.0;
const SEESAW_TORQUE_GAIN = 48.0;
const SEESAW_RETURN_TORQUE = 18.0;
const SEESAW_DAMPING = 0.92;
const FALLING_CHUNK_CRACK_DMG = 25;
const FALLING_IMPACT_MASK = new WeakMap<ChunkRuntime, number>();

export const COLLISION_GROUP_TERRAIN = (0x0001 << 16) | 0x0007;
export const COLLISION_GROUP_DYNAMIC_DEBRIS = (0x0002 << 16) | 0x0003;
export const COLLISION_GROUP_GADGET = (0x0004 << 16) | 0x0001;

function buildLocalVertices(poly: readonly (readonly [number, number])[], cx: number, cy: number): Float32Array {
  const arr = new Float32Array(poly.length * 2);
  for (let i = 0; i < poly.length; i++) {
    const pt = poly[i]!;
    arr[i * 2] = pt[0] - cx;
    arr[i * 2 + 1] = pt[1] - cy;
  }
  return arr;
}

function createChunkBody(
  rapier: RapierApi,
  world: RAPIER.World,
  spec: ChunkSpec,
  x: number,
  y: number,
  angle: number,
  bodyType: RAPIER.RigidBodyType,
  angVel: number,
): { bodyHandle: number; colliderHandle: number } {
  const [cx0, cy0] = polygonCentroid(spec.poly);
  const verts = buildLocalVertices(spec.poly, cx0, cy0);
  let desc: RAPIER.RigidBodyDesc;
  if (bodyType === rapier.RigidBodyType.Fixed) {
    desc = rapier.RigidBodyDesc.fixed();
  } else if (bodyType === rapier.RigidBodyType.KinematicPositionBased) {
    desc = rapier.RigidBodyDesc.kinematicPositionBased();
  } else {
    desc = rapier.RigidBodyDesc.dynamic().setAngvel(angVel).setLinearDamping(0.05).setAngularDamping(0.05);
  }
  desc.setTranslation(x, y).setRotation(angle);
  const body = world.createRigidBody(desc);
  const colDesc = rapier.ColliderDesc.convexHull(verts);
  assert(colDesc !== null, ErrorCode.InvariantViolation, `Failed convexHull for chunk ${spec.id}`);
  colDesc.setFriction(0.6).setRestitution(0.15).setDensity(1.4);
  colDesc.setCollisionGroups(spec.oneWay ? (0x0008 << 16) | 0x0002 : COLLISION_GROUP_TERRAIN);
  const col = world.createCollider(colDesc, body);
  return { bodyHandle: body.handle, colliderHandle: col.handle };
}

function createPlatformBody(
  rapier: RapierApi,
  world: RAPIER.World,
  plat: PlatformSpec,
): { bodyHandle: number; colliderHandle: number } {
  if (plat.kind === PlatformKind.Soft) {
    // Soft one-way platforms are tracked geometrically so fighters pass upward freely.
    return { bodyHandle: -1, colliderHandle: -1 };
  }
  const cx = (plat.x0 + plat.x1) * 0.5;
  const hx = (plat.x1 - plat.x0) * 0.5;
  const body = world.createRigidBody(
    rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(cx, plat.y - TEACUP_HALF_HEIGHT),
  );
  const colDesc = rapier.ColliderDesc.cuboid(hx, TEACUP_HALF_HEIGHT)
    .setFriction(0.7)
    .setRestitution(0.1)
    .setCollisionGroups(COLLISION_GROUP_TERRAIN);
  const col = world.createCollider(colDesc, body);
  return { bodyHandle: body.handle, colliderHandle: col.handle };
}

function removeBodySafe(world: RAPIER.World, bodyHandle: number): void {
  if (bodyHandle < 0) return;
  const body = world.getRigidBody(bodyHandle);
  if (body && body.isValid()) {
    world.removeRigidBody(body);
  }
}

function swapChunkToKinematic(
  rapier: RapierApi,
  world: RAPIER.World,
  spec: ChunkSpec,
  chunk: ChunkRuntime,
): void {
  const existing = chunk.bodyHandle >= 0 ? world.getRigidBody(chunk.bodyHandle) : null;
  if (existing && existing.isValid() && existing.bodyType() === rapier.RigidBodyType.KinematicPositionBased) return;
  removeBodySafe(world, chunk.bodyHandle);
  const { bodyHandle, colliderHandle } = createChunkBody(
    rapier,
    world,
    spec,
    chunk.x,
    chunk.y,
    chunk.angle,
    rapier.RigidBodyType.KinematicPositionBased,
    0,
  );
  chunk.bodyHandle = bodyHandle;
  chunk.colliderHandle = colliderHandle;
}

function createCrackTotals(): Record<CrackSource, number> {
  return {
    [CrackSource.Slam]: 0,
    [CrackSource.Move]: 0,
    [CrackSource.Teaspoon]: 0,
    [CrackSource.FallingChunk]: 0,
    [CrackSource.Timeline]: 0,
  };
}

function isChunkSolidStanding(state: ChunkState): boolean {
  return state === ChunkState.Intact || state === ChunkState.Crazed;
}

function isChunkStandable(state: ChunkState): boolean {
  return state === ChunkState.Intact || state === ChunkState.Crazed || state === ChunkState.Loose;
}

function isSeesawChunk(island: IslandState, chunk: ChunkRuntime): boolean {
  if (island.arenaId !== ArenaId.HighTea) return false;
  const arena = getArenaSpec(island.arenaId);
  for (const entry of arena.timeline) {
    if (entry.action === TimelineAction.StemSnap) {
      return entry.targetChunkIndices.includes(chunk.index);
    }
  }
  return false;
}

function rotatePoint(x: number, y: number, px: number, py: number, rad: number): [number, number] {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = x - px;
  const dy = y - py;
  return [px + dx * cos - dy * sin, py + dx * sin + dy * cos];
}

function chunkWorldTopEndpoints(
  island: IslandState,
  spec: ChunkSpec,
  chunk: ChunkRuntime,
): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = spec.topX0;
  let y0 = spec.topY0;
  let x1 = spec.topX1;
  let y1 = spec.topY1;

  if (island.arenaId === ArenaId.MendedBowl && chunk.half !== BowlHalf.None && isChunkStandable(chunk.state)) {
    const sign = chunk.half === BowlHalf.Left ? -1 : 1;
    const dx = sign * (island.bowl.gap * 0.5);
    x0 += dx;
    x1 += dx;
    if (island.bowl.tiltDeg > 0) {
      const pivotX = dx;
      const rad = -sign * island.bowl.tiltDeg * DEG_TO_RAD;
      [x0, y0] = rotatePoint(x0, y0, pivotX, BOWL_PIVOT_Y, rad);
      [x1, y1] = rotatePoint(x1, y1, pivotX, BOWL_PIVOT_Y, rad);
    }
  } else if (island.seesaw.snapped && isSeesawChunk(island, chunk) && isChunkStandable(chunk.state)) {
    const rad = -island.seesaw.angleDeg * DEG_TO_RAD;
    [x0, y0] = rotatePoint(x0, y0, 0, SEESAW_PIVOT_Y, rad);
    [x1, y1] = rotatePoint(x1, y1, 0, SEESAW_PIVOT_Y, rad);
  }

  if (chunk.state === ChunkState.Loose) {
    const [cx0, cy0] = polygonCentroid(spec.poly);
    const dy = chunk.y - cy0;
    const dx = island.arenaId === ArenaId.MendedBowl ? 0 : chunk.x - cx0;
    x0 += dx;
    x1 += dx;
    y0 += dy;
    y1 += dy;
  }

  return { x0, y0, x1, y1 };
}

export function recomputeLedges(island: IslandState): void {
  const arena = getArenaSpec(island.arenaId);
  const ledges: LedgePoint[] = [];
  const eps = 0.08;

  for (let i = 0; i < island.chunks.length; i++) {
    const chunk = island.chunks[i]!;
    if (!isChunkSolidStanding(chunk.state)) continue;
    const spec = arena.chunks[i]!;
    const { x0, y0, x1, y1 } = chunkWorldTopEndpoints(island, spec, chunk);

    let leftCovered = false;
    let rightCovered = false;
    for (let j = 0; j < island.chunks.length; j++) {
      if (i === j) continue;
      const other = island.chunks[j]!;
      if (!isChunkSolidStanding(other.state)) continue;
      const oEnd = chunkWorldTopEndpoints(island, arena.chunks[j]!, other);
      if (Math.abs(oEnd.x1 - x0) <= eps && Math.abs(oEnd.y1 - y0) <= 0.25) leftCovered = true;
      if (Math.abs(oEnd.x0 - x1) <= eps && Math.abs(oEnd.y0 - y1) <= 0.25) rightCovered = true;
    }

    if (!leftCovered) ledges.push({ chunkIndex: i, side: -1, x: x0, y: y0 });
    if (!rightCovered) ledges.push({ chunkIndex: i, side: 1, x: x1, y: y1 });
  }

  island.ledges = ledges;
}

export function createIsland(
  rapier: RapierApi,
  rapierWorld: RAPIER.World,
  arenaId: ArenaId,
  playerCount: number,
  fragile: boolean,
): IslandState {
  assert(
    Number.isInteger(playerCount) && playerCount >= 1 && playerCount <= 8,
    ErrorCode.InvariantViolation,
    `Invalid playerCount=${playerCount}`,
  );
  void fragile;
  const arena = getArenaSpec(arenaId);
  const shiftTicks = arena.breakable && playerCount <= PLAYER_SCALE_CUTOFF ? PLAYER_SHIFT_TICKS : 0;

  const chunks: ChunkRuntime[] = arena.chunks.map((spec) => {
    const [cx, cy] = polygonCentroid(spec.poly);
    const { bodyHandle, colliderHandle } = createChunkBody(
      rapier,
      rapierWorld,
      spec,
      cx,
      cy,
      0,
      rapier.RigidBodyType.Fixed,
      0,
    );
    return {
      index: spec.index,
      id: spec.id,
      maxHp: spec.hp,
      oneWay: spec.oneWay,
      half: spec.half,
      hp: spec.hp,
      state: ChunkState.Intact,
      stateTicks: 0,
      x: cx,
      y: cy,
      vx: 0,
      vy: 0,
      angle: 0,
      angVel: 0,
      resting: false,
      restSent: false,
      bodyHandle,
      colliderHandle,
    };
  });

  const platforms: PlatformRuntime[] = arena.platforms.map((p) => {
    const { bodyHandle, colliderHandle } = createPlatformBody(rapier, rapierWorld, p);
    return {
      index: p.index,
      id: p.id,
      kind: p.kind,
      baseY: p.y,
      x0: p.x0,
      x1: p.x1,
      y: p.y,
      hp: p.hp,
      alive: true,
      falling: false,
      vy: 0,
      bodyHandle,
      colliderHandle,
    };
  });

  const timelineFired = arena.timeline.map(() => false);
  const island: IslandState = {
    arenaId,
    chunks,
    platforms,
    rubble: [],
    timelineFired,
    playerCountTimeShiftTicks: shiftTicks,
    nextRubbleId: 1,
    lastCallActive: false,
    suddenDeathActive: false,
    pour: { active: false, telegraphing: false, ticksLeft: 0 },
    bowl: { splitActive: false, gap: 0, tiltActive: false, tiltDeg: 0 },
    seesaw: { snapped: false, angleDeg: 0, angVelDeg: 0 },
    ledges: [],
    crackTotals: createCrackTotals(),
    halfGoneTick: -1,
  };

  // GDD 3.2: With <= 4 players on breakable arenas, the first timeline event (rim craze/drop) has already happened.
  if (shiftTicks > 0 && arena.timeline.length > 0) {
    const rimIndices = new Set<number>();
    for (let i = 0; i < arena.timeline.length; i++) {
      const entry = arena.timeline[i]!;
      if (i === 0) {
        timelineFired[i] = true;
        if (entry.action === TimelineAction.Split) {
          island.bowl.splitActive = true;
        }
        for (const idx of entry.targetChunkIndices) rimIndices.add(idx);
      } else if (
        entry.action === TimelineAction.Drop &&
        entry.targetChunkIndices.length > 0 &&
        entry.targetChunkIndices.every((idx) => rimIndices.has(idx))
      ) {
        timelineFired[i] = true;
      }
    }
    for (const idx of rimIndices) {
      const ch = requireAt(island.chunks, idx, 'island.chunks');
      removeBodySafe(rapierWorld, ch.bodyHandle);
      ch.hp = 0;
      ch.state = ChunkState.Gone;
      ch.bodyHandle = -1;
      ch.colliderHandle = -1;
    }
  }

  recomputeLedges(island);
  return island;
}

function spawnChunkRubble(
  rapier: RapierApi,
  rapierWorld: RAPIER.World,
  island: IslandState,
  chunk: ChunkRuntime,
  rng: SeededRng,
): void {
  const { terrain } = getGameData().tuning;
  const count = rng.int(terrain.rubblePerChunk[0], terrain.rubblePerChunk[1]);

  for (let i = 0; i < count; i++) {
    if (island.rubble.length >= terrain.maxRubble) {
      let removeIdx = island.rubble.findIndex((r) => r.resting && !r.isShell);
      if (removeIdx < 0) removeIdx = 0;
      const old = island.rubble.splice(removeIdx, 1)[0]!;
      removeBodySafe(rapierWorld, old.bodyHandle);
    }

    const radius = rng.range(RUBBLE_RADIUS_MIN, RUBBLE_RADIUS_MAX);
    const ox = rng.range(-0.8, 0.8);
    const oy = rng.range(-0.3, 0.3);
    const vx = rng.range(-3.0, 3.0);
    const vy = rng.range(1.5, 4.5);
    const body = rapierWorld.createRigidBody(
      rapier.RigidBodyDesc.dynamic()
        .setTranslation(chunk.x + ox, chunk.y + oy)
        .setLinvel(vx, vy)
        .setAngvel(rng.range(-6, 6))
        .setLinearDamping(0.08)
        .setAngularDamping(0.08),
    );
    const col = rapierWorld.createCollider(
      rapier.ColliderDesc.ball(radius)
        .setFriction(0.65)
        .setRestitution(0.3)
        .setDensity(1.2)
        .setCollisionGroups(COLLISION_GROUP_DYNAMIC_DEBRIS),
      body,
    );

    island.rubble.push({
      id: island.nextRubbleId++,
      x: chunk.x + ox,
      y: chunk.y + oy,
      vx,
      vy,
      angle: 0,
      radius,
      resting: false,
      restSent: false,
      ownerSlot: -1,
      isShell: false,
      shellHitsLeft: 0,
      ttlTicks: RUBBLE_TTL_TICKS,
      bodyHandle: body.handle,
      colliderHandle: col.handle,
    });
  }
}

export function setChunkState(
  rapier: RapierApi,
  rapierWorld: RAPIER.World,
  island: IslandState,
  chunkIndex: number,
  nextState: ChunkState,
  tick: number,
  rng: SeededRng,
  events: SimEvent[],
): void {
  const chunk = requireAt(island.chunks, chunkIndex, 'island.chunks');
  if (chunk.state === nextState || chunk.state === ChunkState.Gone) return;

  const arena = getArenaSpec(island.arenaId);
  const spec = requireAt(arena.chunks, chunkIndex, 'arena.chunks');
  const { terrain } = getGameData().tuning;

  if (nextState === ChunkState.Falling) {
    let fallingCount = 0;
    for (let i = 0; i < island.chunks.length; i++) {
      if (island.chunks[i]!.state === ChunkState.Falling) fallingCount++;
    }
    if (fallingCount >= terrain.maxDynamicChunks) return;
  }

  chunk.state = nextState;
  chunk.stateTicks = 0;

  switch (nextState) {
    case ChunkState.Intact:
    case ChunkState.Crazed:
      break;
    case ChunkState.Loose: {
      chunk.hp = 0;
      swapChunkToKinematic(rapier, rapierWorld, spec, chunk);
      spawnChunkRubble(rapier, rapierWorld, island, chunk, rng);
      recomputeLedges(island);
      break;
    }
    case ChunkState.Falling: {
      removeBodySafe(rapierWorld, chunk.bodyHandle);
      const angVel = rng.range(-1.8, 1.8);
      const { bodyHandle, colliderHandle } = createChunkBody(
        rapier,
        rapierWorld,
        spec,
        chunk.x,
        chunk.y,
        chunk.angle,
        rapier.RigidBodyType.Dynamic,
        angVel,
      );
      chunk.bodyHandle = bodyHandle;
      chunk.colliderHandle = colliderHandle;
      chunk.angVel = angVel;
      chunk.resting = false;
      chunk.restSent = false;
      recomputeLedges(island);
      break;
    }
    case ChunkState.Gone: {
      removeBodySafe(rapierWorld, chunk.bodyHandle);
      chunk.bodyHandle = -1;
      chunk.colliderHandle = -1;
      chunk.vx = 0;
      chunk.vy = 0;
      chunk.angVel = 0;
      recomputeLedges(island);
      break;
    }
    default:
      assertNever(nextState, 'setChunkState');
  }

  events.push({ tick, kind: SimEventKind.ChunkState, a: chunkIndex, b: nextState, c: 0, d: 0 });
}

export function damageChunk(
  rapier: RapierApi,
  rapierWorld: RAPIER.World,
  island: IslandState,
  chunkIndex: number,
  amount: number,
  source: CrackSource,
  fragile: boolean,
  tick: number,
  rng: SeededRng,
  events: SimEvent[],
): void {
  assertFinite(amount, 'damageChunk.amount');
  if (amount <= 0) return;
  const arena = getArenaSpec(island.arenaId);
  if (!arena.breakable) return;
  const chunk = requireAt(island.chunks, chunkIndex, 'island.chunks');
  if (!isChunkSolidStanding(chunk.state)) return;

  const applied = fragile ? amount * 2 : amount;
  island.crackTotals[source] += applied;
  chunk.hp = Math.max(0, chunk.hp - applied);

  if (chunk.hp <= 0) {
    setChunkState(rapier, rapierWorld, island, chunkIndex, ChunkState.Loose, tick, rng, events);
  } else if (chunk.state === ChunkState.Intact && chunk.hp <= chunk.maxHp * CRAZE_HP_RATIO) {
    setChunkState(rapier, rapierWorld, island, chunkIndex, ChunkState.Crazed, tick, rng, events);
  }
}

function dropPlatform(rapierWorld: RAPIER.World, plat: PlatformRuntime, tick: number, events: SimEvent[]): void {
  if (!plat.alive || plat.falling) return;
  plat.falling = true;
  plat.vy = -1.5;
  removeBodySafe(rapierWorld, plat.bodyHandle);
  plat.bodyHandle = -1;
  plat.colliderHandle = -1;
  events.push({ tick, kind: SimEventKind.PlatformState, a: plat.index, b: 1, c: 0, d: 0 });
}

function dropChunkByTimeline(
  rapier: RapierApi,
  rapierWorld: RAPIER.World,
  island: IslandState,
  chunkIndex: number,
  tick: number,
  rng: SeededRng,
  events: SimEvent[],
): void {
  const chunk = requireAt(island.chunks, chunkIndex, 'island.chunks');
  if (!isChunkSolidStanding(chunk.state)) return;
  const { terrain, tickRate } = getGameData().tuning;
  const minCrazeTicks = Math.round(terrain.crazeWarningSeconds * tickRate);
  if (chunk.state === ChunkState.Intact) {
    setChunkState(rapier, rapierWorld, island, chunkIndex, ChunkState.Crazed, tick, rng, events);
    return;
  }
  if (chunk.state === ChunkState.Crazed && chunk.stateTicks < minCrazeTicks) return;
  island.crackTotals[CrackSource.Timeline] += chunk.hp;
  setChunkState(rapier, rapierWorld, island, chunkIndex, ChunkState.Loose, tick, rng, events);
}

function stepTimeline(
  rapier: RapierApi,
  rapierWorld: RAPIER.World,
  island: IslandState,
  fighters: readonly FighterRuntime[],
  tick: number,
  rng: SeededRng,
  events: SimEvent[],
): void {
  const arena = getArenaSpec(island.arenaId);
  const { match } = getGameData().tuning;

  for (let i = 0; i < arena.timeline.length; i++) {
    if (island.timelineFired[i]) continue;
    const entry = arena.timeline[i]!;
    const scheduledTick = Math.max(0, entry.tick - island.playerCountTimeShiftTicks);
    if (tick < scheduledTick) continue;

    island.timelineFired[i] = true;
    events.push({ tick, kind: SimEventKind.Timeline, a: entry.action, b: i, c: 0, d: 0 });

    switch (entry.action) {
      case TimelineAction.Craze:
        for (const ci of entry.targetChunkIndices) {
          if (island.chunks[ci]!.state === ChunkState.Intact) {
            setChunkState(rapier, rapierWorld, island, ci, ChunkState.Crazed, tick, rng, events);
          }
        }
        break;
      case TimelineAction.Drop:
        for (const ci of entry.targetChunkIndices) {
          dropChunkByTimeline(rapier, rapierWorld, island, ci, tick, rng, events);
        }
        for (const pi of entry.targetPlatformIndices) {
          dropPlatform(rapierWorld, island.platforms[pi]!, tick, events);
        }
        break;
      case TimelineAction.LastCall:
        island.lastCallActive = true;
        for (const ci of entry.targetChunkIndices) {
          if (island.chunks[ci]!.state === ChunkState.Intact) {
            setChunkState(rapier, rapierWorld, island, ci, ChunkState.Crazed, tick, rng, events);
          }
        }
        break;
      case TimelineAction.SuddenDeath:
        island.suddenDeathActive = true;
        for (const f of fighters) {
          if (f.stocks > 0 && f.damage < match.suddenDeathPercent) {
            f.damage = match.suddenDeathPercent;
          }
        }
        events.push({ tick, kind: SimEventKind.SuddenDeath, a: match.suddenDeathPercent, b: 0, c: 0, d: 0 });
        break;
      case TimelineAction.SinkOne:
        if (entry.sinkPair) {
          const [a, b] = entry.sinkPair;
          const candidates: number[] = [];
          if (isChunkSolidStanding(island.chunks[a]!.state)) candidates.push(a);
          if (isChunkSolidStanding(island.chunks[b]!.state)) candidates.push(b);
          if (candidates.length > 0) {
            setChunkState(rapier, rapierWorld, island, rng.pick(candidates), ChunkState.Loose, tick, rng, events);
          }
        }
        break;
      case TimelineAction.Sink:
        for (const ci of entry.targetChunkIndices) {
          if (isChunkSolidStanding(island.chunks[ci]!.state)) {
            setChunkState(rapier, rapierWorld, island, ci, ChunkState.Loose, tick, rng, events);
          }
        }
        break;
      case TimelineAction.Hazard:
        if (entry.targetHazard === HazardId.Pour && arena.pourHazard) {
          island.pour.telegraphing = true;
          island.pour.active = false;
          island.pour.ticksLeft = arena.pourHazard.telegraphTicks;
          events.push({ tick, kind: SimEventKind.Hazard, a: HazardId.Pour, b: 0, c: 0, d: 0 });
        }
        break;
      case TimelineAction.StemSnap:
        island.seesaw.snapped = true;
        for (const ci of entry.targetChunkIndices) {
          const ch = island.chunks[ci]!;
          if (isChunkStandable(ch.state)) {
            swapChunkToKinematic(rapier, rapierWorld, arena.chunks[ci]!, ch);
          }
        }
        break;
      case TimelineAction.Split:
        island.bowl.splitActive = true;
        for (let ci = 0; ci < island.chunks.length; ci++) {
          const ch = island.chunks[ci]!;
          if (isChunkStandable(ch.state)) {
            swapChunkToKinematic(rapier, rapierWorld, arena.chunks[ci]!, ch);
          }
        }
        recomputeLedges(island);
        break;
      case TimelineAction.Tilt:
        island.bowl.tiltActive = true;
        break;
      default:
        assertNever(entry.action, 'stepTimeline');
    }
  }
}

function getFighterWeight(f: FighterRuntime): number {
  const spec = getFighterSpec(f.id);
  if (f.id === FighterId.Nesta && spec.nestaSizes) {
    return requireKey(spec.nestaSizes, f.nestaSize, 'nesta.sizes').weight;
  }
  return spec.stats.weight;
}

function checkDebrisHitFighters(
  fighters: readonly FighterRuntime[],
  x: number,
  y: number,
  radius: number,
  vx: number,
  vy: number,
  ownerSlot: number,
  tick: number,
  events: SimEvent[],
): void {
  const { terrain, hitstun, hitstop, launch } = getGameData().tuning;
  const speed = Math.hypot(vx, vy);
  if (speed < terrain.debrisHitMinSpeed) return;

  for (const f of fighters) {
    if (f.slot === ownerSlot || f.stocks <= 0 || f.state === FighterState.Eliminated || f.state === FighterState.Respawn) {
      continue;
    }
    if ((f.flags & FighterFlag.Invuln) !== 0 || f.invulnFrames > 0) continue;
    const spec = getFighterSpec(f.id);
    const fy = f.y + spec.stats.height * 0.5;
    const hitR = radius + spec.stats.width * 0.45;
    const dx = f.x - x;
    const dy = fy - y;
    if (dx * dx + dy * dy > hitR * hitR) continue;

    const dmg = speed * terrain.debrisDamagePerSpeed;
    f.damage += dmg;
    const weight = getFighterWeight(f);
    const launchSpeed = (terrain.debrisBkb + (terrain.debrisKbg * f.damage) / 100) * (2 / (1 + weight));
    const dirX = dx !== 0 ? Math.sign(dx) : vx !== 0 ? Math.sign(vx) : 1;
    const angleRad = 45 * DEG_TO_RAD;
    f.kbVx = dirX * Math.cos(angleRad) * launchSpeed;
    f.kbVy = Math.sin(angleRad) * launchSpeed;
    f.hitstunFrames = Math.min(hitstun.max, Math.round(hitstun.base + hitstun.perSpeed * launchSpeed));
    f.hitstopFrames = Math.min(hitstop.max, Math.max(hitstop.min, Math.round(hitstop.base + hitstop.perDamage * dmg)));
    f.state = launchSpeed >= launch.tumbleSpeed ? FighterState.Tumble : FighterState.Hitstun;
    f.stateFrame = 0;
    f.flags &= ~FighterFlag.Grounded;
    f.lastHitBySlot = ownerSlot;
    events.push({ tick, kind: SimEventKind.Hit, a: ownerSlot, b: f.slot, c: Math.round(dmg * 10), d: KoCause.FallingChunk });
  }
}

function stepChunksAndRubble(
  rapier: RapierApi,
  rapierWorld: RAPIER.World,
  island: IslandState,
  fighters: readonly FighterRuntime[],
  tick: number,
  rng: SeededRng,
  events: SimEvent[],
): void {
  const arena = getArenaSpec(island.arenaId);
  const { terrain, tickRate } = getGameData().tuning;
  const looseMaxTicks = Math.round(terrain.looseSinkSeconds * tickRate);

  let colliderToChunk: Map<number, number> | null = null;

  let goneOrFallingOrLoose = 0;

  for (let i = 0; i < island.chunks.length; i++) {
    const chunk = island.chunks[i]!;
    chunk.stateTicks++;

    if (chunk.state === ChunkState.Loose) {
      chunk.y -= terrain.looseSinkSpeed * DT;
      if (chunk.bodyHandle >= 0) {
        const body = rapierWorld.getRigidBody(chunk.bodyHandle);
        if (body && body.isValid()) {
          body.setNextKinematicTranslation({ x: chunk.x, y: chunk.y });
        }
      }
      if (chunk.stateTicks >= looseMaxTicks) {
        setChunkState(rapier, rapierWorld, island, i, ChunkState.Falling, tick, rng, events);
      }
    } else if (chunk.state === ChunkState.Falling) {
      const body = chunk.bodyHandle >= 0 ? rapierWorld.getRigidBody(chunk.bodyHandle) : null;
      if (body && body.isValid()) {
        const preStepSpeed = Math.hypot(chunk.vx, chunk.vy);
        const pos = body.translation();
        const vel = body.linvel();
        chunk.x = pos.x;
        chunk.y = pos.y;
        chunk.vx = vel.x;
        chunk.vy = vel.y;
        chunk.angle = body.rotation();
        chunk.angVel = body.angvel();
        chunk.resting = vel.x * vel.x + vel.y * vel.y < REST_SPEED_SQ && Math.abs(chunk.angVel) < REST_ANG_VEL;

        const impactSpeed = Math.max(preStepSpeed, Math.hypot(vel.x, vel.y));
        if (impactSpeed >= terrain.debrisHitMinSpeed && chunk.colliderHandle >= 0) {
          const col = rapierWorld.getCollider(chunk.colliderHandle);
          if (col && col.isValid()) {
            if (colliderToChunk === null) {
              colliderToChunk = new Map<number, number>();
              for (let j = 0; j < island.chunks.length; j++) {
                const ch = island.chunks[j]!;
                if (ch.colliderHandle >= 0) colliderToChunk.set(ch.colliderHandle, j);
              }
            }
            const cMap = colliderToChunk;
            const hitTargets: number[] = [];
            rapierWorld.contactPairsWith(col, (other) => {
              const targetIdx = cMap.get(other.handle);
              if (targetIdx !== undefined && targetIdx !== i) hitTargets.push(targetIdx);
            });
            const existingMask = FALLING_IMPACT_MASK.get(chunk);
            let hitMask = existingMask === undefined ? 0 : existingMask;
            for (const targetIdx of hitTargets) {
              const bit = 1 << targetIdx;
              if ((hitMask & bit) !== 0) continue;
              hitMask |= bit;
              damageChunk(
                rapier,
                rapierWorld,
                island,
                targetIdx,
                FALLING_CHUNK_CRACK_DMG,
                CrackSource.FallingChunk,
                false,
                tick,
                rng,
                events,
              );
            }
            FALLING_IMPACT_MASK.set(chunk, hitMask);
          }
        }
        checkDebrisHitFighters(fighters, chunk.x, chunk.y, 1.0, vel.x, vel.y, -1, tick, events);
      }
      if (chunk.y < arena.blastZone.bottom) {
        setChunkState(rapier, rapierWorld, island, i, ChunkState.Gone, tick, rng, events);
      }
    }

    if (!isChunkSolidStanding(chunk.state)) {
      goneOrFallingOrLoose++;
    }
  }

  if (island.halfGoneTick < 0 && goneOrFallingOrLoose * 2 >= island.chunks.length) {
    island.halfGoneTick = tick;
  }

  for (let i = island.rubble.length - 1; i >= 0; i--) {
    const r = island.rubble[i]!;
    r.ttlTicks--;
    const body = r.bodyHandle >= 0 ? rapierWorld.getRigidBody(r.bodyHandle) : null;
    if (body && body.isValid()) {
      const pos = body.translation();
      const vel = body.linvel();
      r.x = pos.x;
      r.y = pos.y;
      r.vx = vel.x;
      r.vy = vel.y;
      r.angle = body.rotation();
      r.resting = vel.x * vel.x + vel.y * vel.y < REST_SPEED_SQ && Math.abs(body.angvel()) < REST_ANG_VEL;
      checkDebrisHitFighters(fighters, r.x, r.y, r.radius, r.vx, r.vy, r.ownerSlot, tick, events);
    }
    if (r.y < arena.blastZone.bottom || r.ttlTicks <= 0) {
      removeBodySafe(rapierWorld, r.bodyHandle);
      island.rubble.splice(i, 1);
    }
  }
}

function stepPlatformsAndGimmicks(
  rapierWorld: RAPIER.World,
  island: IslandState,
  fighters: readonly FighterRuntime[],
  tick: number,
  events: SimEvent[],
): void {
  const arena = getArenaSpec(island.arenaId);
  const { gravity } = getGameData().tuning;

  if (island.arenaId === ArenaId.MendedBowl) {
    let bowlMoved = false;
    if (island.bowl.splitActive && island.bowl.gap < BOWL_MAX_GAP) {
      island.bowl.gap = Math.min(BOWL_MAX_GAP, island.bowl.gap + BOWL_DRIFT_SPEED * DT * 2);
      bowlMoved = true;
    }
    if (island.bowl.tiltActive && island.bowl.tiltDeg < BOWL_MAX_TILT_DEG) {
      island.bowl.tiltDeg = Math.min(BOWL_MAX_TILT_DEG, island.bowl.tiltDeg + BOWL_TILT_SPEED_DEG * DT);
      bowlMoved = true;
    }
    if (bowlMoved) {
      for (let i = 0; i < island.chunks.length; i++) {
        const ch = island.chunks[i]!;
        if (!isChunkStandable(ch.state) || ch.half === BowlHalf.None) continue;
        const spec = arena.chunks[i]!;
        const [cx0, cy0] = polygonCentroid(spec.poly);
        const sign = ch.half === BowlHalf.Left ? -1 : 1;
        const dx = sign * (island.bowl.gap * 0.5);
        let nx = cx0 + dx;
        let ny = ch.state === ChunkState.Loose ? ch.y : cy0;
        const rad = island.bowl.tiltDeg > 0 ? -sign * island.bowl.tiltDeg * DEG_TO_RAD : 0;
        if (rad !== 0) {
          [nx, ny] = rotatePoint(nx, ny, dx, BOWL_PIVOT_Y, rad);
        }
        ch.x = nx;
        ch.y = ny;
        ch.angle = rad;
        if (ch.bodyHandle >= 0) {
          const body = rapierWorld.getRigidBody(ch.bodyHandle);
          if (body && body.isValid()) {
            body.setNextKinematicTranslation({ x: nx, y: ny });
            body.setNextKinematicRotation(rad);
          }
        }
      }
      recomputeLedges(island);
    }
  }

  if (island.arenaId === ArenaId.HighTea && island.seesaw.snapped) {
    const prevAngleDeg = island.seesaw.angleDeg;
    let torque = 0;
    for (const f of fighters) {
      if (f.stocks <= 0 || (f.flags & FighterFlag.Grounded) === 0) continue;
      if (f.y < 6.5 || Math.abs(f.x) > 3.8) continue;
      torque += getFighterWeight(f) * f.x;
    }
    if (Math.abs(torque) > 0.05) {
      island.seesaw.angVelDeg += torque * SEESAW_TORQUE_GAIN * DT;
    } else {
      island.seesaw.angVelDeg -= Math.sign(island.seesaw.angleDeg) * SEESAW_RETURN_TORQUE * DT;
    }
    island.seesaw.angVelDeg = Math.max(
      -SEESAW_MAX_SPEED_DEG,
      Math.min(SEESAW_MAX_SPEED_DEG, island.seesaw.angVelDeg * SEESAW_DAMPING),
    );
    island.seesaw.angleDeg = Math.max(
      -SEESAW_MAX_ANGLE_DEG,
      Math.min(SEESAW_MAX_ANGLE_DEG, island.seesaw.angleDeg + island.seesaw.angVelDeg * DT),
    );
    if (Math.abs(island.seesaw.angleDeg - prevAngleDeg) > 1e-5) {
      const rad = -island.seesaw.angleDeg * DEG_TO_RAD;
      for (let i = 0; i < island.chunks.length; i++) {
        const ch = island.chunks[i]!;
        if (!isSeesawChunk(island, ch) || !isChunkStandable(ch.state)) continue;
        const spec = arena.chunks[i]!;
        const [cx0, cy0] = polygonCentroid(spec.poly);
        const [nx, ny] = rotatePoint(cx0, ch.state === ChunkState.Loose ? ch.y : cy0, 0, SEESAW_PIVOT_Y, rad);
        ch.x = nx;
        ch.y = ny;
        ch.angle = rad;
        if (ch.bodyHandle >= 0) {
          const body = rapierWorld.getRigidBody(ch.bodyHandle);
          if (body && body.isValid()) {
            body.setNextKinematicTranslation({ x: nx, y: ny });
            body.setNextKinematicRotation(rad);
          }
        }
      }
      recomputeLedges(island);
    }
  }

  if (arena.pourHazard && (island.pour.telegraphing || island.pour.active)) {
    island.pour.ticksLeft--;
    if (island.pour.telegraphing && island.pour.ticksLeft <= 0) {
      island.pour.telegraphing = false;
      island.pour.active = true;
      island.pour.ticksLeft = arena.pourHazard.durationTicks;
      events.push({ tick, kind: SimEventKind.Hazard, a: HazardId.Pour, b: 1, c: 0, d: 0 });
    } else if (island.pour.active) {
      const pour = arena.pourHazard;
      const midX = (pour.x0 + pour.x1) * 0.5;
      for (const f of fighters) {
        if (f.stocks <= 0 || f.state === FighterState.Eliminated || f.state === FighterState.Respawn) continue;
        if (f.x >= pour.x0 && f.x <= pour.x1 && f.y >= 0) {
          f.vy -= pour.forceDown * DT;
          f.vx += (f.x >= midX ? 1 : -1) * pour.forceOutward * DT;
          f.flags |= FighterFlag.Slippery;
          f.slipperyFrames = Math.max(f.slipperyFrames, pour.slipperyTicks);
        }
      }
      if (island.pour.ticksLeft <= 0) {
        island.pour.active = false;
        events.push({ tick, kind: SimEventKind.Hazard, a: HazardId.Pour, b: 2, c: 0, d: 0 });
      }
    }
  }

  for (let i = 0; i < island.platforms.length; i++) {
    const plat = island.platforms[i]!;
    if (!plat.alive) continue;
    const spec = arena.platforms[i]!;

    if (plat.falling) {
      plat.vy -= gravity * 0.6 * DT;
      plat.y += plat.vy * DT;
      if (plat.y < arena.blastZone.bottom) plat.alive = false;
      continue;
    }

    if (spec.supportChunkIndices.length > 0) {
      const hasSupport = spec.supportChunkIndices.some((ci) => isChunkSolidStanding(island.chunks[ci]!.state));
      if (!hasSupport) {
        dropPlatform(rapierWorld, plat, tick, events);
        continue;
      }
    }

    if (spec.attachHalf !== BowlHalf.None) {
      const sign = spec.attachHalf === BowlHalf.Left ? -1 : 1;
      const dx = sign * (island.bowl.gap * 0.5);
      plat.x0 = spec.x0 + dx;
      plat.x1 = spec.x1 + dx;
    }

    if (spec.bobAmp > 0 && spec.bobPeriodSeconds > 0) {
      const phase = (tick * DT) / spec.bobPeriodSeconds + spec.bobPhase;
      plat.y = plat.baseY + Math.sin(phase * Math.PI * 2) * spec.bobAmp;
      if (plat.bodyHandle >= 0) {
        const body = rapierWorld.getRigidBody(plat.bodyHandle);
        if (body && body.isValid()) {
          body.setNextKinematicTranslation({ x: (plat.x0 + plat.x1) * 0.5, y: plat.y - TEACUP_HALF_HEIGHT });
        }
      }
    }
  }
}

export function stepIsland(
  rapier: RapierApi,
  rapierWorld: RAPIER.World,
  island: IslandState,
  fighters: readonly FighterRuntime[],
  tick: number,
  rng: SeededRng,
  events: SimEvent[],
): void {
  stepTimeline(rapier, rapierWorld, island, fighters, tick, rng, events);
  stepChunksAndRubble(rapier, rapierWorld, island, fighters, tick, rng, events);
  stepPlatformsAndGimmicks(rapierWorld, island, fighters, tick, events);
}

export function findChunkUnderPoint(island: IslandState, x: number, y: number): number {
  const arena = getArenaSpec(island.arenaId);
  let bestIdx = -1;
  let bestDist = Infinity;

  for (let i = 0; i < island.chunks.length; i++) {
    const ch = island.chunks[i]!;
    if (!isChunkStandable(ch.state)) continue;
    const spec = arena.chunks[i]!;
    const { x0, y0, x1, y1 } = chunkWorldTopEndpoints(island, spec, ch);
    const minX = Math.min(x0, x1) - 0.1;
    const maxX = Math.max(x0, x1) + 0.1;
    if (x < minX || x > maxX) continue;
    const t = Math.abs(x1 - x0) < 1e-5 ? 0.5 : Math.max(0, Math.min(1, (x - x0) / (x1 - x0)));
    const surfY = y0 + (y1 - y0) * t;
    if (y >= surfY - 4.0 && y <= surfY + 1.5) {
      const d = Math.abs(y - surfY);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
  }
  return bestIdx;
}

export function querySurfaceAt(
  island: IslandState,
  x: number,
  prevY: number,
  nextY: number,
  dropThrough: boolean,
): SurfaceHit | null {
  if (nextY > prevY + 1e-4) return null;
  const arena = getArenaSpec(island.arenaId);
  const eps = 0.08;
  let best: SurfaceHit | null = null;

  for (let i = 0; i < island.chunks.length; i++) {
    const ch = island.chunks[i]!;
    if (!isChunkStandable(ch.state)) continue;
    if (dropThrough && ch.oneWay) continue;
    const spec = arena.chunks[i]!;
    const { x0, y0, x1, y1 } = chunkWorldTopEndpoints(island, spec, ch);
    const minX = Math.min(x0, x1) - 0.05;
    const maxX = Math.max(x0, x1) + 0.05;
    if (x < minX || x > maxX) continue;
    const t = Math.abs(x1 - x0) < 1e-5 ? 0.5 : Math.max(0, Math.min(1, (x - x0) / (x1 - x0)));
    const surfY = y0 + (y1 - y0) * t;
    if (prevY >= surfY - eps && nextY <= surfY + eps) {
      if (best === null || surfY > best.y) {
        best = { y: surfY, chunkIndex: i, platformIndex: -1, isOneWay: ch.oneWay };
      }
    }
  }

  for (let i = 0; i < island.platforms.length; i++) {
    const plat = island.platforms[i]!;
    if (!plat.alive || plat.falling) continue;
    const isOneWay = plat.kind === PlatformKind.Soft;
    if (dropThrough && isOneWay) continue;
    if (x < plat.x0 - 0.05 || x > plat.x1 + 0.05) continue;
    const surfY = plat.y;
    if (prevY >= surfY - eps && nextY <= surfY + eps) {
      if (best === null || surfY > best.y) {
        best = { y: surfY, chunkIndex: -1, platformIndex: i, isOneWay };
      }
    }
  }

  return best;
}

export function getUpdraftBounds(
  island: IslandState,
): { x0: number; x1: number; gravityMult: number; maxFallMult: number; launchedLift: number } | null {
  const arena = getArenaSpec(island.arenaId);
  if (!arena.updraftHazard || !island.bowl.splitActive) return null;
  if (island.bowl.gap < arena.updraftHazard.minGap) return null;
  return {
    x0: -island.bowl.gap * 0.5,
    x1: island.bowl.gap * 0.5,
    gravityMult: arena.updraftHazard.gravityMult,
    maxFallMult: arena.updraftHazard.maxFallMult,
    launchedLift: arena.updraftHazard.launchedLift,
  };
}
