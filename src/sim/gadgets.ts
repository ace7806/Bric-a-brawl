import { assert, assertFinite, assertNever, requireKey } from './assert';
import { getArenaSpec, getFighterSpec, getGadgetSpec, getGameData, type GadgetSpec } from './data';
import {
  ALL_GADGET_IDS,
  ChunkState,
  ErrorCode,
  FighterFlag,
  FighterId,
  FighterState,
  GadgetId,
  GadgetTier,
  InputBit,
  InputDir,
  ProjectileKind,
  SimEventKind,
  WorldGadgetState,
} from './enums';
import { findChunkUnderPoint, querySurfaceAt } from './island';
import { SeededRng } from './prng';
import type {
  FighterRuntime,
  HazardZoneRuntime,
  IslandState,
  ProjectileRuntime,
  SimEvent,
  WorldGadgetRuntime,
} from './types';

export interface GadgetStats {
  spawned: Record<GadgetId, number>;
  pickedUp: Record<GadgetId, number>;
  used: Record<GadgetId, number>;
}

export interface HooverBagState {
  holderSlot: number;
  victimSlot: number;
  elapsedTicks: number;
  ticksLeft: number;
  spitBlockedUntilRelease: boolean;
}

export interface FlyingFriendState {
  victimSlot: number;
  ownerSlot: number;
  ticksLeft: number;
}

export interface MagnetOrbitItem {
  readonly id: number;
  readonly sourceGadgetId: GadgetId;
  readonly radius: number;
  angle: number;
  dist: number;
}

export interface MagnetOrbitState {
  holderSlot: number;
  ticksLeft: number;
  items: MagnetOrbitItem[];
}

export interface GadgetSystemState {
  readonly worldGadgets: WorldGadgetRuntime[];
  readonly projectiles: ProjectileRuntime[];
  readonly hazards: HazardZoneRuntime[];
  readonly hooverSuckingSlots: Set<number>;
  readonly hooverBags: Map<number, HooverBagState>;
  readonly flyingFriends: Map<number, FlyingFriendState>;
  readonly magnetOrbits: Map<number, MagnetOrbitState>;
  readonly enableTierB: boolean;
  readonly enableTierC: boolean;
  nextId: number;
  nextSpawnTick: number;
  stats: GadgetStats;
}

const DT = 1 / 60;
const DEG_TO_RAD = Math.PI / 180;
const SQRT1_2 = Math.SQRT1_2;
const HARD_CAP_WORLD_GADGETS = 8;
const HARD_CAP_PROJECTILES = 12;
const PARCEL_DROP_HEIGHT = 8.0;
const PICKUP_RADIUS = 1.4;
const CATCH_RADIUS = 1.5;
const BELLOWS_RANGE = 6.0;
const BELLOWS_HALF_ANGLE_COS = Math.cos(25 * DEG_TO_RAD);
const CORK_SPEED = 34.0;
const CORK_HELPLESS_FRAMES = 20;
const THROWN_SPEED = 20.0;
const THROWN_UP_VY = 4.0;
const JAM_LOB_SPEED = 14.0;
const JAM_LOB_UP_VY = 5.0;
const JAM_GRAVITY_SCALE = 0.7;
const GROG_WEIGHT_THRESHOLD = 1.2;
const HOOVER_HALF_ANGLE_COS = Math.cos(30 * DEG_TO_RAD);
const HOOVER_BAG_RADIUS = 1.0;
const HOOVER_MASH_FLOOR_FRAMES = 40;
const HOOVER_SPIT_ANGLE_DEG = 8;
const HOOVER_FLYING_FRIEND_TICKS = 45;
const MAGNET_ORBIT_RADIUS = 1.15;
const MAGNET_ORBIT_ANGULAR_STEP = 0.18;

function createPerGadgetCounter(): Record<GadgetId, number> {
  return {
    [GadgetId.None]: 0,
    [GadgetId.Bellows]: 0,
    [GadgetId.Plunger]: 0,
    [GadgetId.Cork]: 0,
    [GadgetId.Pepper]: 0,
    [GadgetId.Toaster]: 0,
    [GadgetId.Jam]: 0,
    [GadgetId.Timer]: 0,
    [GadgetId.Hoover]: 0,
    [GadgetId.Magnet]: 0,
  };
}

function reqNum(spec: GadgetSpec, key: string): number {
  const val = spec.numbers[key];
  assert(typeof val === 'number', ErrorCode.MissingRequiredEntry, `Missing gadget number ${spec.id}.${key}`);
  return assertFinite(val, `gadget.${spec.id}.${key}`);
}

function getFighterWeight(f: FighterRuntime): number {
  const spec = getFighterSpec(f.id);
  if (f.id === FighterId.Nesta && spec.nestaSizes) {
    return requireKey(spec.nestaSizes, f.nestaSize, 'nesta.sizes').weight;
  }
  return spec.stats.weight;
}

function getFighterAim(fighter: FighterRuntime, diagonalOnlyVertical: boolean): [number, number] {
  const facing = (fighter.flags & FighterFlag.FacingRight) !== 0 ? 1 : -1;
  const dir = (fighter.lastInputMask & InputBit.DirMask) as InputDir;
  switch (dir) {
    case InputDir.Neutral:
      return [facing, 0];
    case InputDir.Up:
      return diagonalOnlyVertical ? [facing * SQRT1_2, SQRT1_2] : [0, 1];
    case InputDir.UpRight:
      return [SQRT1_2, SQRT1_2];
    case InputDir.Right:
      return [1, 0];
    case InputDir.DownRight:
      return [SQRT1_2, -SQRT1_2];
    case InputDir.Down:
      return diagonalOnlyVertical ? [facing * SQRT1_2, -SQRT1_2] : [0, -1];
    case InputDir.DownLeft:
      return [-SQRT1_2, -SQRT1_2];
    case InputDir.Left:
      return [-1, 0];
    case InputDir.UpLeft:
      return [-SQRT1_2, SQRT1_2];
    default:
      return [facing, 0];
  }
}

function isFighterAlive(f: FighterRuntime): boolean {
  return f.stocks > 0 && f.state !== FighterState.Eliminated && f.state !== FighterState.Respawn && f.state !== FighterState.Teaspoon;
}

function isFighterHitAllowed(f: FighterRuntime): boolean {
  return isFighterAlive(f) && (f.flags & FighterFlag.Invuln) === 0 && f.invulnFrames <= 0;
}

function canUseNormalGadget(f: FighterRuntime): boolean {
  if (!isFighterAlive(f) || f.hitstopFrames > 0 || f.gadgetCooldown > 0) return false;
  switch (f.state) {
    case FighterState.Hitstun:
    case FighterState.Tumble:
    case FighterState.GuardBreak:
    case FighterState.ParryStun:
    case FighterState.Held:
    case FighterState.Grabbing:
    case FighterState.LedgeHang:
    case FighterState.LedgeGetup:
    case FighterState.Helpless:
      return false;
    default:
      return true;
  }
}

function applyLaunchToFighter(
  f: FighterRuntime,
  damage: number,
  bkb: number,
  kbg: number,
  angleDeg: number,
  dirX: number,
  attackerSlot: number,
  gadgetId: GadgetId,
  tick: number,
  events: SimEvent[],
): void {
  const { hitstun, hitstop, launch } = getGameData().tuning;
  f.damage += damage;
  const weight = getFighterWeight(f);
  const speed = (bkb + (kbg * f.damage) / 100) * (2 / (1 + weight));
  const rad = angleDeg * DEG_TO_RAD;
  f.kbVx = (dirX >= 0 ? 1 : -1) * Math.cos(rad) * speed;
  f.kbVy = Math.sin(rad) * speed;
  f.hitstunFrames = Math.min(hitstun.max, Math.round(hitstun.base + hitstun.perSpeed * speed));
  f.hitstopFrames = Math.min(hitstop.max, Math.max(hitstop.min, Math.round(hitstop.base + hitstop.perDamage * damage)));
  f.state = speed >= launch.tumbleSpeed ? FighterState.Tumble : FighterState.Hitstun;
  f.stateFrame = 0;
  f.flags &= ~FighterFlag.Grounded;
  f.lastHitBySlot = attackerSlot;
  f.lastHitByGadget = gadgetId;
  f.lastHitTick = tick;
  events.push({ tick, kind: SimEventKind.Hit, a: attackerSlot, b: f.slot, c: Math.round(damage * 10), d: gadgetId });
}

function grantParryGilt(defender: FighterRuntime, tick: number, attackerSlot: number, events: SimEvent[]): void {
  const { gilt, parry } = getGameData().tuning;
  defender.gilt = Math.min(gilt.max, defender.gilt + parry.giltGain);
  events.push({ tick, kind: SimEventKind.Parry, a: defender.slot, b: attackerSlot, c: parry.giltGain, d: 0 });
}

export function createGadgetSystem(
  rng: SeededRng,
  enableTierB: boolean,
  enableTierC: boolean,
): GadgetSystemState {
  void rng;
  const { gadgetRules, tuning } = getGameData();
  return {
    worldGadgets: [],
    projectiles: [],
    hazards: [],
    hooverSuckingSlots: new Set(),
    hooverBags: new Map(),
    flyingFriends: new Map(),
    magnetOrbits: new Map(),
    enableTierB,
    enableTierC,
    nextId: 1,
    nextSpawnTick: Math.round(gadgetRules.firstSpawnSeconds * tuning.tickRate),
    stats: {
      spawned: createPerGadgetCounter(),
      pickedUp: createPerGadgetCounter(),
      used: createPerGadgetCounter(),
    },
  };
}

function pickEnabledGadgetId(system: GadgetSystemState, rng: SeededRng): GadgetId {
  const pool: GadgetSpec[] = [];
  let totalWeight = 0;
  for (const id of ALL_GADGET_IDS) {
    const spec = getGadgetSpec(id);
    if (spec.tier === GadgetTier.B && !system.enableTierB) continue;
    if (spec.tier === GadgetTier.C && !system.enableTierC) continue;
    pool.push(spec);
    totalWeight += spec.weight;
  }
  assert(pool.length > 0 && totalWeight > 0, ErrorCode.InvariantViolation, 'No enabled gadgets in spawn pool');
  let roll = rng.range(0, totalWeight);
  for (const spec of pool) {
    roll -= spec.weight;
    if (roll <= 0) return spec.id;
  }
  return pool[pool.length - 1]!.id;
}

export function stepGadgetSpawns(
  system: GadgetSystemState,
  island: IslandState,
  fighters: readonly FighterRuntime[],
  tick: number,
  rng: SeededRng,
  events: SimEvent[],
): void {
  const { gadgetRules, tuning } = getGameData();
  const arena = getArenaSpec(island.arenaId);
  const hz = tuning.tickRate;

  // Step active world gadgets (parcel descent & grounded despawn)
  const despawnTicks = Math.round(gadgetRules.despawnSeconds * hz);
  for (let i = system.worldGadgets.length - 1; i >= 0; i--) {
    const wg = system.worldGadgets[i]!;
    if (wg.state === WorldGadgetState.Parcel) {
      wg.y += wg.vy * DT;
      wg.ttlTicks--;
      if (wg.ttlTicks <= 0) {
        wg.state = WorldGadgetState.Grounded;
        wg.vy = 0;
        wg.ttlTicks = despawnTicks;
      }
    } else if (wg.state === WorldGadgetState.Grounded) {
      if (wg.stuckChunkIndex >= 0 && island.chunks[wg.stuckChunkIndex]!.state >= ChunkState.Falling) {
        wg.vy -= tuning.gravity * DT;
        wg.y += wg.vy * DT;
        if (wg.y < arena.blastZone.bottom) {
          system.worldGadgets.splice(i, 1);
          events.push({ tick, kind: SimEventKind.GadgetGone, a: wg.id, b: wg.gadgetId, c: 0, d: 0 });
          continue;
        }
      }
      wg.ttlTicks--;
      if (wg.ttlTicks <= 0) {
        system.worldGadgets.splice(i, 1);
        events.push({ tick, kind: SimEventKind.GadgetGone, a: wg.id, b: wg.gadgetId, c: 0, d: 0 });
      }
    }
  }

  if (tick < system.nextSpawnTick) return;

  const mult = island.lastCallActive ? gadgetRules.lastCallSpawnMult : 1.0;
  const intervalSec = rng.range(gadgetRules.spawnIntervalSeconds[0], gadgetRules.spawnIntervalSeconds[1]) / mult;
  system.nextSpawnTick = tick + Math.max(1, Math.round(intervalSec * hz));

  const stageCap = Math.min(
    HARD_CAP_WORLD_GADGETS,
    fighters.length <= 4 ? gadgetRules.maxOnStage2to4 : gadgetRules.maxOnStage5to8,
  );
  if (system.worldGadgets.length >= stageCap) return;

  const standingIndices: number[] = [];
  for (let i = 0; i < island.chunks.length; i++) {
    const st = island.chunks[i]!.state;
    if (st === ChunkState.Intact || st === ChunkState.Crazed) standingIndices.push(i);
  }
  if (standingIndices.length === 0) return;

  let trailing: FighterRuntime | null = null;
  for (const f of fighters) {
    if (f.stocks <= 0) continue;
    if (trailing === null || f.stocks < trailing.stocks || (f.stocks === trailing.stocks && f.damage > trailing.damage)) {
      trailing = f;
    }
  }

  let targetChunkIdx = rng.pick(standingIndices);
  if (trailing !== null && rng.next() < gadgetRules.trailingPlayerBias) {
    const side = trailing.x >= 0 ? 1 : -1;
    const biased = standingIndices.filter((ci) => island.chunks[ci]!.x * side >= 0);
    if (biased.length > 0) targetChunkIdx = rng.pick(biased);
  }

  const chunkSpec = arena.chunks[targetChunkIdx]!;
  const targetX = rng.range(Math.min(chunkSpec.topX0, chunkSpec.topX1) + 0.2, Math.max(chunkSpec.topX0, chunkSpec.topX1) - 0.2);
  const t = Math.abs(chunkSpec.topX1 - chunkSpec.topX0) < 1e-5 ? 0.5 : (targetX - chunkSpec.topX0) / (chunkSpec.topX1 - chunkSpec.topX0);
  const targetY = chunkSpec.topY0 + (chunkSpec.topY1 - chunkSpec.topY0) * Math.max(0, Math.min(1, t));
  const descentTicks = Math.max(1, Math.round(gadgetRules.parcelDescentSeconds * hz));

  const gadgetId = pickEnabledGadgetId(system, rng);
  const spec = getGadgetSpec(gadgetId);
  const wg: WorldGadgetRuntime = {
    id: system.nextId++,
    gadgetId,
    ammo: spec.ammo,
    state: WorldGadgetState.Parcel,
    x: targetX,
    y: targetY + PARCEL_DROP_HEIGHT,
    vx: 0,
    vy: -PARCEL_DROP_HEIGHT / gadgetRules.parcelDescentSeconds,
    angle: 0,
    ttlTicks: descentTicks,
    armTicks: 0,
    ownerSlot: -1,
    stuckChunkIndex: targetChunkIdx,
    bodyHandle: -1,
    colliderHandle: -1,
  };

  system.worldGadgets.push(wg);
  system.stats.spawned[gadgetId]++;
  events.push({ tick, kind: SimEventKind.GadgetSpawn, a: wg.id, b: gadgetId, c: Math.round(wg.x * 64), d: Math.round(wg.y * 64) });
}

function pushProjectile(system: GadgetSystemState, proj: ProjectileRuntime): void {
  if (system.projectiles.length >= HARD_CAP_PROJECTILES) {
    const evictIdx = system.projectiles.findIndex((p) => p.stuckFighterSlot < 0 && p.stuckChunkIndex < 0);
    system.projectiles.splice(evictIdx >= 0 ? evictIdx : 0, 1);
  }
  system.projectiles.push(proj);
}

function fireCork(
  system: GadgetSystemState,
  fighter: FighterRuntime,
  tick: number,
  events: SimEvent[],
): void {
  const spec = getGadgetSpec(GadgetId.Cork);
  const dmg = reqNum(spec, 'damage');
  const bkb = reqNum(spec, 'bkb');
  const kbg = reqNum(spec, 'kbg');
  const angle = reqNum(spec, 'angle');
  const recoilMin = reqNum(spec, 'recoilMin');
  const recoilMax = reqNum(spec, 'recoilMax');
  const shakeFrames = reqNum(spec, 'shakeFrames');

  const [ax, ay] = getFighterAim(fighter, false);
  const chargeRatio = Math.max(0, Math.min(1, fighter.corkChargeFrames / shakeFrames));
  const recoil = recoilMin + (recoilMax - recoilMin) * chargeRatio;

  fighter.kbVx = -ax * recoil;
  fighter.kbVy = -ay * recoil;
  fighter.vx = 0;
  fighter.vy = ay <= 0 ? 2.5 : 0;
  fighter.y += 0.12;
  fighter.flags &= ~FighterFlag.Grounded;
  fighter.state = FighterState.Helpless;
  fighter.stateFrame = 0;
  fighter.hitstunFrames = CORK_HELPLESS_FRAMES;
  fighter.corkChargeFrames = 0;
  fighter.heldGadgetAmmo--;
  fighter.gadgetCooldown = CORK_HELPLESS_FRAMES;

  const fh = getFighterSpec(fighter.id).stats.height * 0.55;
  pushProjectile(system, {
    id: system.nextId++,
    kind: ProjectileKind.Cork,
    ownerSlot: fighter.slot,
    x: fighter.x + ax * 0.6,
    y: fighter.y + fh + ay * 0.6,
    vx: ax * CORK_SPEED,
    vy: ay * CORK_SPEED,
    radius: 0.22,
    damage: dmg,
    bkb,
    kbg,
    angle,
    ttlTicks: 90,
    gravityScale: 0,
    reflected: false,
    stuckFighterSlot: -1,
    stuckChunkIndex: -1,
    stuckTicks: 0,
    gadgetId: GadgetId.Cork,
    pipingMultiHits: 0,
  });

  system.stats.used[GadgetId.Cork]++;
  events.push({ tick, kind: SimEventKind.GadgetUse, a: fighter.slot, b: GadgetId.Cork, c: Math.round(chargeRatio * 100), d: 0 });
}

const lastCorkTick = new WeakMap<FighterRuntime, number>();

export function useCork(
  system: GadgetSystemState,
  fighter: FighterRuntime,
  mask: number,
  tick: number,
  events: SimEvent[],
): boolean {
  if (fighter.heldGadget !== GadgetId.Cork || fighter.heldGadgetAmmo <= 0) return false;
  if ((mask & InputBit.Use) !== 0) {
    if (!canUseNormalGadget(fighter)) return false;
    const shakeMax = reqNum(getGadgetSpec(GadgetId.Cork), 'shakeFrames');
    fighter.corkChargeFrames = Math.min(shakeMax, fighter.corkChargeFrames + 1);
    lastCorkTick.set(fighter, tick);
    return true;
  }
  if (fighter.corkChargeFrames > 0) {
    fireCork(system, fighter, tick, events);
    lastCorkTick.delete(fighter);
    return true;
  }
  return false;
}

function fireBellows(
  system: GadgetSystemState,
  fighter: FighterRuntime,
  fighters: readonly FighterRuntime[],
  island: IslandState,
  tick: number,
  events: SimEvent[],
): void {
  const spec = getGadgetSpec(GadgetId.Bellows);
  const push = reqNum(spec, 'push');
  const airMult = reqNum(spec, 'pushAirborneMult');
  const dmg = reqNum(spec, 'damage');
  const recoil = reqNum(spec, 'userRecoil');
  const cooldown = reqNum(spec, 'cooldownFrames');
  const { parry } = getGameData().tuning;

  const [ax, ay] = getFighterAim(fighter, true);
  const fh = getFighterSpec(fighter.id).stats.height * 0.5;
  const ox = fighter.x;
  const oy = fighter.y + fh;

  fighter.kbVx -= ax * recoil;
  fighter.kbVy -= ay * recoil;
  if (ay < -0.2) fighter.flags &= ~FighterFlag.Grounded;
  fighter.gadgetCooldown = Math.round(cooldown);
  fighter.heldGadgetAmmo--;

  for (const target of fighters) {
    if (target.slot === fighter.slot || !isFighterHitAllowed(target)) continue;
    const tSpec = getFighterSpec(target.id).stats;
    const dx = target.x - ox;
    const tyClosest = Math.max(target.y, Math.min(target.y + tSpec.height, oy));
    const dy = tyClosest - oy;
    const dist = Math.hypot(dx, dy);
    if (dist > BELLOWS_RANGE + tSpec.width * 0.5 || dist < 1e-5) continue;
    const proj = dx * ax + dy * ay;
    if (proj <= 0) continue;
    const perp = Math.abs(-ay * dx + ax * dy);
    const coneHalfW = proj * Math.tan(25 * DEG_TO_RAD) + tSpec.height * 0.5;
    if (perp > coneHalfW) continue;

    if (target.state === FighterState.Parry) {
      const refPush = push * parry.projectileReflectSpeedMult;
      fighter.damage += dmg;
      fighter.kbVx -= ax * refPush;
      fighter.kbVy -= ay * refPush;
      fighter.flags &= ~FighterFlag.Grounded;
      grantParryGilt(target, tick, fighter.slot, events);
      events.push({ tick, kind: SimEventKind.Hit, a: target.slot, b: fighter.slot, c: Math.round(dmg * 10), d: GadgetId.Bellows });
      continue;
    }

    if (target.state === FighterState.Guard || target.state === FighterState.GuardStun) {
      const halfPush = push * 0.5;
      target.kbVx += Math.sign(ax !== 0 ? ax : dx) * halfPush;
      events.push({ tick, kind: SimEventKind.Block, a: fighter.slot, b: target.slot, c: 0, d: GadgetId.Bellows });
      continue;
    }

    const mult = (target.flags & FighterFlag.Grounded) === 0 ? airMult : 1.0;
    const mag = push * mult;
    target.damage += dmg;
    target.kbVx += ax * mag;
    target.kbVy += ay * mag;
    if (ay > 0.1 || (target.flags & FighterFlag.Grounded) === 0) {
      target.flags &= ~FighterFlag.Grounded;
    }
    target.lastHitBySlot = fighter.slot;
    target.lastHitByGadget = GadgetId.Bellows;
    target.lastHitTick = tick;
    events.push({ tick, kind: SimEventKind.Hit, a: fighter.slot, b: target.slot, c: Math.round(dmg * 10), d: GadgetId.Bellows });
  }

  for (const h of system.hazards) {
    if (h.gadgetId !== GadgetId.Pepper) continue;
    const dx = h.x - ox;
    const dy = h.y - oy;
    const dist = Math.hypot(dx, dy);
    if (dist <= BELLOWS_RANGE + h.radius) {
      h.vx = ax * push * 0.5;
    }
  }

  for (const r of island.rubble) {
    const dx = r.x - ox;
    const dy = r.y - oy;
    const dist = Math.hypot(dx, dy);
    if (dist <= BELLOWS_RANGE && dist > 1e-5 && (dx * ax + dy * ay) / dist >= BELLOWS_HALF_ANGLE_COS) {
      r.vx += ax * push;
      r.vy += ay * push;
      r.ownerSlot = fighter.slot;
      r.resting = false;
    }
  }

  system.stats.used[GadgetId.Bellows]++;
  events.push({ tick, kind: SimEventKind.GadgetUse, a: fighter.slot, b: GadgetId.Bellows, c: 0, d: 0 });
}

function tryYankActivePlunger(
  system: GadgetSystemState,
  fighter: FighterRuntime,
  fighters: readonly FighterRuntime[],
  island: IslandState,
  tick: number,
  events: SimEvent[],
): boolean {
  const idx = system.projectiles.findIndex(
    (p) => p.kind === ProjectileKind.Plunger && p.ownerSlot === fighter.slot && (p.stuckFighterSlot >= 0 || p.stuckChunkIndex !== -1),
  );
  if (idx < 0) return false;

  const proj = system.projectiles[idx]!;
  const spec = getGadgetSpec(GadgetId.Plunger);
  const yankSpeed = reqNum(spec, 'yankSpeed');
  const fh = getFighterSpec(fighter.id).stats.height * 0.5;
  const dx = proj.x - fighter.x;
  const dy = proj.y - (fighter.y + fh);
  const dist = Math.max(1e-5, Math.hypot(dx, dy));
  const ux = dx / dist;
  const uy = dy / dist;

  if (proj.stuckFighterSlot >= 0) {
    const target = fighters.find((f) => f.slot === proj.stuckFighterSlot);
    if (target && isFighterAlive(target)) {
      if (getFighterWeight(target) >= GROG_WEIGHT_THRESHOLD) {
        fighter.vx = 0;
        fighter.vy = 0;
        fighter.kbVx = ux * yankSpeed;
        fighter.kbVy = uy * yankSpeed;
        fighter.flags &= ~FighterFlag.Grounded;
      } else {
        target.vx = 0;
        target.vy = 0;
        target.kbVx = -ux * yankSpeed;
        target.kbVy = -uy * yankSpeed;
        target.flags &= ~FighterFlag.Grounded;
        target.lastHitBySlot = fighter.slot;
        target.lastHitByGadget = GadgetId.Plunger;
        target.lastHitTick = tick;
      }
    }
  } else if (proj.stuckChunkIndex >= 0) {
    fighter.vx = 0;
    fighter.vy = 0;
    fighter.kbVx = ux * yankSpeed;
    fighter.kbVy = uy <= 0 && (fighter.flags & FighterFlag.Grounded) !== 0 ? Math.max(2.0, Math.abs(uy) * 0.25 * yankSpeed) : uy * yankSpeed;
    fighter.flags &= ~FighterFlag.Grounded;
  } else if (proj.stuckChunkIndex === -2) {
    const rubble = island.rubble.find((r) => r.id === proj.pipingMultiHits);
    if (rubble) {
      rubble.vx = -ux * yankSpeed;
      rubble.vy = -uy * yankSpeed;
      rubble.ownerSlot = fighter.slot;
    } else {
      const wg = system.worldGadgets.find((w) => w.id === proj.pipingMultiHits);
      if (wg) {
        wg.vx = -ux * yankSpeed;
        wg.vy = -uy * yankSpeed;
        wg.x += wg.vx * DT * 4;
        wg.y += wg.vy * DT * 4;
      }
    }
  }

  system.projectiles.splice(idx, 1);
  events.push({ tick, kind: SimEventKind.GadgetUse, a: fighter.slot, b: GadgetId.Plunger, c: 1, d: 0 });
  return true;
}

function throwEmptyGadget(
  system: GadgetSystemState,
  fighter: FighterRuntime,
  tick: number,
  events: SimEvent[],
): void {
  const { gadgetRules } = getGameData();
  const [ax, ay] = getFighterAim(fighter, false);
  const fh = getFighterSpec(fighter.id).stats.height * 0.55;
  const gadgetId = fighter.heldGadget;
  fighter.heldGadget = GadgetId.None;
  fighter.heldGadgetAmmo = 0;
  fighter.corkChargeFrames = 0;

  if (system.worldGadgets.length >= HARD_CAP_WORLD_GADGETS) {
    const dropIdx = system.worldGadgets.findIndex((w) => w.state === WorldGadgetState.Grounded);
    if (dropIdx >= 0) system.worldGadgets.splice(dropIdx, 1);
  }

  const wg: WorldGadgetRuntime = {
    id: system.nextId++,
    gadgetId,
    ammo: 0,
    state: WorldGadgetState.Thrown,
    x: fighter.x + ax * 0.6,
    y: fighter.y + fh + ay * 0.6,
    vx: ax * THROWN_SPEED,
    vy: ay * THROWN_SPEED + THROWN_UP_VY,
    angle: 0,
    ttlTicks: 90,
    armTicks: 0,
    ownerSlot: fighter.slot,
    stuckChunkIndex: -1,
    bodyHandle: -1,
    colliderHandle: -1,
  };
  system.worldGadgets.push(wg);
  events.push({ tick, kind: SimEventKind.GadgetUse, a: fighter.slot, b: gadgetId, c: Math.round(gadgetRules.emptyThrowDamage), d: 1 });
}

function spitHooverBag(
  system: GadgetSystemState,
  holder: FighterRuntime,
  fighters: readonly FighterRuntime[],
  tick: number,
  events: SimEvent[],
): boolean {
  const bag = system.hooverBags.get(holder.slot);
  if (!bag) return false;
  system.hooverBags.delete(holder.slot);
  system.hooverSuckingSlots.delete(holder.slot);

  const spec = getGadgetSpec(GadgetId.Hoover);
  const spitSpeed = reqNum(spec, 'spitSpeed');
  const spitDamage = reqNum(spec, 'spitDamage');
  const spitBkb = reqNum(spec, 'spitBkb');
  const spitKbg = reqNum(spec, 'spitKbg');
  const { hitstun, hitstop, launch } = getGameData().tuning;

  if (holder.heldGadget === GadgetId.Hoover && holder.heldGadgetAmmo > 0) {
    holder.heldGadgetAmmo--;
  }
  holder.gadgetCooldown = 16;

  const victim = fighters.find((f) => f.slot === bag.victimSlot);
  if (victim && isFighterAlive(victim)) {
    const [ax, ay] = getFighterAim(holder, false);
    const dirX = Math.abs(ax) >= 1e-4 ? Math.sign(ax) : ((holder.flags & FighterFlag.FacingRight) !== 0 ? 1 : -1);
    const launchX = Math.abs(ax) >= 1e-4 ? ax : dirX;
    const launchY = Math.abs(ay) >= 1e-4 ? ay : Math.sin(HOOVER_SPIT_ANGLE_DEG * DEG_TO_RAD);
    const norm = Math.max(1e-5, Math.hypot(launchX, launchY));
    const ux = launchX / norm;
    const uy = launchY / norm;
    const weight = getFighterWeight(victim);
    const dmgAfter = victim.damage + spitDamage;
    const kbSpeed = Math.max(spitSpeed, ((spitBkb + (spitKbg * dmgAfter) / 100) * 2) / (1 + weight));

    victim.grabbedBySlot = -1;
    victim.grabHoldFrames = 0;
    victim.flags &= ~(FighterFlag.Invuln | FighterFlag.Grounded);
    victim.invulnFrames = 0;
    victim.damage = dmgAfter;
    victim.vx = 0;
    victim.vy = 0;
    victim.kbVx = ux * kbSpeed;
    victim.kbVy = uy * kbSpeed;
    victim.hitstunFrames = Math.min(hitstun.max, Math.round(hitstun.base + hitstun.perSpeed * kbSpeed));
    victim.hitstopFrames = Math.min(hitstop.max, Math.max(hitstop.min, Math.round(hitstop.base + hitstop.perDamage * spitDamage)));
    victim.state = kbSpeed >= launch.tumbleSpeed ? FighterState.Tumble : FighterState.Hitstun;
    victim.stateFrame = 0;
    victim.lastHitBySlot = holder.slot;
    victim.lastHitByGadget = GadgetId.Hoover;
    victim.lastHitTick = tick;

    system.flyingFriends.set(victim.slot, {
      victimSlot: victim.slot,
      ownerSlot: holder.slot,
      ticksLeft: HOOVER_FLYING_FRIEND_TICKS,
    });
    events.push({ tick, kind: SimEventKind.Hit, a: holder.slot, b: victim.slot, c: Math.round(spitDamage * 10), d: GadgetId.Hoover });
    events.push({ tick, kind: SimEventKind.Launch, a: holder.slot, b: victim.slot, c: Math.round(kbSpeed * 8), d: GadgetId.Hoover });
  }

  system.stats.used[GadgetId.Hoover]++;
  events.push({ tick, kind: SimEventKind.GadgetUse, a: holder.slot, b: GadgetId.Hoover, c: 1, d: bag.victimSlot });
  return true;
}

function fireMagnetShrapnel(
  system: GadgetSystemState,
  holder: FighterRuntime,
  tick: number,
  events: SimEvent[],
): boolean {
  const orbit = system.magnetOrbits.get(holder.slot);
  if (!orbit) return false;
  system.magnetOrbits.delete(holder.slot);

  const spec = getGadgetSpec(GadgetId.Magnet);
  const speed = reqNum(spec, 'shrapnelSpeed');
  const dmgEach = reqNum(spec, 'shrapnelDamageEach');
  const [ax, ay] = getFighterAim(holder, false);
  const fh = getFighterSpec(holder.id).stats.height * 0.55;

  if (holder.heldGadget === GadgetId.Magnet && holder.heldGadgetAmmo > 0) {
    holder.heldGadgetAmmo--;
  }
  holder.gadgetCooldown = 16;

  const count = orbit.items.length;
  const spreadStep = count > 1 ? 6 * DEG_TO_RAD : 0;
  const baseAngle = Math.atan2(ay, ax);
  for (let i = 0; i < count; i++) {
    const item = orbit.items[i]!;
    const offset = count > 1 ? (i - (count - 1) * 0.5) * spreadStep : 0;
    const ang = baseAngle + offset;
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    pushProjectile(system, {
      id: system.nextId++,
      kind: item.sourceGadgetId !== GadgetId.None ? ProjectileKind.ThrownGadget : ProjectileKind.RubbleThrow,
      ownerSlot: holder.slot,
      x: holder.x + ux * 0.7,
      y: holder.y + fh + uy * 0.7,
      vx: ux * speed,
      vy: uy * speed,
      radius: Math.max(0.24, Math.min(0.36, item.radius)),
      damage: dmgEach,
      bkb: 11,
      kbg: 9,
      angle: 35,
      ttlTicks: 90,
      gravityScale: 0,
      reflected: false,
      stuckFighterSlot: -1,
      stuckChunkIndex: -1,
      stuckTicks: 0,
      gadgetId: GadgetId.Magnet,
      pipingMultiHits: 0,
    });
  }

  system.stats.used[GadgetId.Magnet]++;
  events.push({ tick, kind: SimEventKind.GadgetUse, a: holder.slot, b: GadgetId.Magnet, c: count, d: 1 });
  return true;
}

export function dropHeldGadget(
  system: GadgetSystemState,
  fighter: FighterRuntime,
  launchDirX: number,
  tick: number,
  events: SimEvent[],
): void {
  if (fighter.heldGadget === GadgetId.None) return;
  system.hooverSuckingSlots.delete(fighter.slot);
  const bag = system.hooverBags.get(fighter.slot);
  if (bag) {
    system.hooverBags.delete(fighter.slot);
  }
  const orbit = system.magnetOrbits.get(fighter.slot);
  if (orbit) {
    system.magnetOrbits.delete(fighter.slot);
  }
  const gadgetId = fighter.heldGadget;
  const ammo = fighter.heldGadgetAmmo;
  fighter.heldGadget = GadgetId.None;
  fighter.heldGadgetAmmo = 0;
  fighter.corkChargeFrames = 0;

  if (system.worldGadgets.length >= HARD_CAP_WORLD_GADGETS) return;
  const dir = launchDirX >= 0 ? 1 : -1;
  const wg: WorldGadgetRuntime = {
    id: system.nextId++,
    gadgetId,
    ammo,
    state: WorldGadgetState.Thrown,
    x: fighter.x,
    y: fighter.y + 0.8,
    vx: dir * 6.0,
    vy: 8.0,
    angle: 0,
    ttlTicks: 120,
    armTicks: 0,
    ownerSlot: fighter.slot,
    stuckChunkIndex: -1,
    bodyHandle: -1,
    colliderHandle: -1,
  };
  system.worldGadgets.push(wg);
  events.push({ tick, kind: SimEventKind.GadgetSpawn, a: wg.id, b: gadgetId, c: Math.round(wg.x * 64), d: Math.round(wg.y * 64) });
}

function triggerTimerRewind(
  system: GadgetSystemState,
  fighter: FighterRuntime,
  tick: number,
  events: SimEvent[],
): void {
  const spec = getGadgetSpec(GadgetId.Timer);
  const rewindFrames = Math.round(reqNum(spec, 'rewindFrames'));
  const invulnFrames = Math.round(reqNum(spec, 'invulnFrames'));

  const cap = fighter.posHistoryX.length;
  let targetX = fighter.x;
  let targetY = fighter.y;
  if (cap > 0 && fighter.posHistoryCount > 0) {
    const lookback = Math.min(rewindFrames, fighter.posHistoryCount - 1);
    const idx = ((fighter.posHistoryCursor - 1 - lookback) % cap + cap) % cap;
    targetX = fighter.posHistoryX[idx]!;
    targetY = fighter.posHistoryY[idx]!;
  }

  const oldX = fighter.x;
  fighter.x = targetX;
  fighter.y = targetY;
  fighter.vx = 0;
  fighter.vy = 0;
  fighter.kbVx = 0;
  fighter.kbVy = 0;
  fighter.hitstunFrames = 0;
  fighter.hitstopFrames = 0;
  fighter.blockstunFrames = 0;
  fighter.state = FighterState.Airborne;
  fighter.stateFrame = 0;
  fighter.flags &= ~(FighterFlag.Grounded | FighterFlag.Rooted);
  fighter.rootFrames = 0;
  fighter.invulnFrames = Math.max(fighter.invulnFrames, invulnFrames);
  fighter.flags |= FighterFlag.Invuln;
  fighter.heldGadgetAmmo--;
  fighter.gadgetCooldown = 18;

  system.stats.used[GadgetId.Timer]++;
  events.push({ tick, kind: SimEventKind.Rewind, a: fighter.slot, b: Math.round(oldX * 64), c: Math.round(targetX * 64), d: Math.round(targetY * 64) });
  events.push({ tick, kind: SimEventKind.GadgetUse, a: fighter.slot, b: GadgetId.Timer, c: 0, d: 0 });
}

export function tryPickupOrUseGadget(
  system: GadgetSystemState,
  fighter: FighterRuntime,
  fighters: readonly FighterRuntime[],
  island: IslandState,
  tick: number,
  rng: SeededRng,
  events: SimEvent[],
): boolean {
  void rng;
  if (!isFighterAlive(fighter)) return false;

  // Pickup or catch when empty-handed
  if (fighter.heldGadget === GadgetId.None) {
    if (!canUseNormalGadget(fighter)) return false;
    const fh = getFighterSpec(fighter.id).stats.height * 0.5;
    let bestIdx = -1;
    let bestDist = Infinity;

    for (let i = 0; i < system.worldGadgets.length; i++) {
      const wg = system.worldGadgets[i]!;
      const isCatchableThrown = wg.state === WorldGadgetState.Thrown && wg.ownerSlot !== fighter.slot;
      const isPickupable = wg.state === WorldGadgetState.Parcel || wg.state === WorldGadgetState.Grounded;
      if (!isCatchableThrown && !isPickupable) continue;
      const maxDist = isCatchableThrown ? CATCH_RADIUS : PICKUP_RADIUS;
      const d = Math.hypot(wg.x - fighter.x, wg.y - (fighter.y + fh));
      if (d <= maxDist && d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    if (bestIdx < 0) return false;
    const picked = system.worldGadgets.splice(bestIdx, 1)[0]!;
    fighter.heldGadget = picked.gadgetId;
    fighter.heldGadgetAmmo = picked.ammo;
    fighter.corkChargeFrames = 0;
    system.stats.pickedUp[picked.gadgetId]++;
    events.push({ tick, kind: SimEventKind.GadgetTake, a: fighter.slot, b: picked.gadgetId, c: picked.id, d: picked.ammo });
    return true;
  }

  // Egg Timer works even in hitstun/tumble
  if (fighter.heldGadget === GadgetId.Timer) {
    if (fighter.gadgetCooldown > 0) return false;
    if (fighter.heldGadgetAmmo <= 0) {
      if (!canUseNormalGadget(fighter)) return false;
      throwEmptyGadget(system, fighter, tick, events);
      return true;
    }
    triggerTimerRewind(system, fighter, tick, events);
    return true;
  }

  // Plunger yank has priority while an attached plunger exists (not blocked by fire cooldown)
  if (
    fighter.heldGadget === GadgetId.Plunger &&
    isFighterAlive(fighter) &&
    fighter.hitstopFrames === 0 &&
    fighter.state !== FighterState.Hitstun &&
    fighter.state !== FighterState.Tumble &&
    fighter.state !== FighterState.Held &&
    tryYankActivePlunger(system, fighter, fighters, island, tick, events)
  ) {
    return true;
  }

  // Hoover: tap Use while holding a bagged victim spits immediately; holding Use activates suction
  if (fighter.heldGadget === GadgetId.Hoover && isFighterAlive(fighter) && fighter.hitstopFrames === 0) {
    const activeBag = system.hooverBags.get(fighter.slot);
    const freshUse = (fighter.lastInputMask & InputBit.Use) !== 0 && (fighter.prevInputMask & InputBit.Use) === 0;
    if (activeBag !== undefined) {
      if (freshUse) {
        spitHooverBag(system, fighter, fighters, tick, events);
        return true;
      }
      return false;
    }
    if ((fighter.lastInputMask & InputBit.Use) !== 0 && (fighter.state === FighterState.Guard || fighter.state === FighterState.Parry)) {
      fighter.state = FighterState.Idle;
      fighter.stateFrame = 0;
    }
  }

  // Magnet: tap Use while orbiting fires shrapnel immediately
  if (fighter.heldGadget === GadgetId.Magnet && isFighterAlive(fighter) && fighter.hitstopFrames === 0) {
    const activeOrbit = system.magnetOrbits.get(fighter.slot);
    const freshUse = (fighter.lastInputMask & InputBit.Use) !== 0 && (fighter.prevInputMask & InputBit.Use) === 0;
    if (activeOrbit !== undefined) {
      if (freshUse) {
        fireMagnetShrapnel(system, fighter, tick, events);
        return true;
      }
      return false;
    }
  }

  if (!canUseNormalGadget(fighter)) return false;

  if (fighter.heldGadgetAmmo <= 0) {
    throwEmptyGadget(system, fighter, tick, events);
    return true;
  }

  const { tuning } = getGameData();
  const fh = getFighterSpec(fighter.id).stats.height * 0.55;
  const facing = (fighter.flags & FighterFlag.FacingRight) !== 0 ? 1 : -1;

  switch (fighter.heldGadget) {
    case GadgetId.Bellows:
      fireBellows(system, fighter, fighters, island, tick, events);
      return true;

    case GadgetId.Plunger: {
      const spec = getGadgetSpec(GadgetId.Plunger);
      const range = reqNum(spec, 'range');
      const speed = reqNum(spec, 'speed');
      const dmg = reqNum(spec, 'damage');
      const [ax, ay] = getFighterAim(fighter, false);
      fighter.heldGadgetAmmo--;
      fighter.gadgetCooldown = 12;
      pushProjectile(system, {
        id: system.nextId++,
        kind: ProjectileKind.Plunger,
        ownerSlot: fighter.slot,
        x: fighter.x + ax * 0.5,
        y: fighter.y + fh + ay * 0.5,
        vx: ax * speed,
        vy: ay * speed,
        radius: 0.28,
        damage: dmg,
        bkb: 0,
        kbg: 0,
        angle: 0,
        ttlTicks: Math.max(1, Math.ceil((range / speed) * tuning.tickRate)),
        gravityScale: 0,
        reflected: false,
        stuckFighterSlot: -1,
        stuckChunkIndex: -1,
        stuckTicks: 0,
        gadgetId: GadgetId.Plunger,
        pipingMultiHits: 0,
      });
      system.stats.used[GadgetId.Plunger]++;
      events.push({ tick, kind: SimEventKind.GadgetUse, a: fighter.slot, b: GadgetId.Plunger, c: 0, d: 0 });
      return true;
    }

    case GadgetId.Cork:
      useCork(system, fighter, fighter.lastInputMask, tick, events);
      return true;

    case GadgetId.Pepper: {
      const spec = getGadgetSpec(GadgetId.Pepper);
      const cloudRadius = reqNum(spec, 'cloudRadius');
      const cloudSeconds = reqNum(spec, 'cloudSeconds');
      fighter.heldGadgetAmmo--;
      fighter.gadgetCooldown = 18;
      system.hazards.push({
        id: system.nextId++,
        gadgetId: GadgetId.Pepper,
        ownerSlot: fighter.slot,
        x: fighter.x + facing * 1.4,
        y: fighter.y + 0.7,
        vx: 0,
        radius: cloudRadius,
        ttlTicks: Math.round(cloudSeconds * tuning.tickRate),
        chunkIndex: -1,
      });
      system.stats.used[GadgetId.Pepper]++;
      events.push({ tick, kind: SimEventKind.GadgetUse, a: fighter.slot, b: GadgetId.Pepper, c: 0, d: 0 });
      return true;
    }

    case GadgetId.Toaster: {
      const x = fighter.x + facing * 0.9;
      const y = fighter.y;
      const chunkIdx = findChunkUnderPoint(island, x, y);
      const ammo = fighter.heldGadgetAmmo;
      fighter.heldGadget = GadgetId.None;
      fighter.heldGadgetAmmo = 0;
      fighter.gadgetCooldown = 14;
      system.worldGadgets.push({
        id: system.nextId++,
        gadgetId: GadgetId.Toaster,
        ammo,
        state: WorldGadgetState.ArmedToaster,
        x,
        y,
        vx: 0,
        vy: 0,
        angle: 0,
        ttlTicks: Math.round(getGameData().gadgetRules.despawnSeconds * tuning.tickRate * 2),
        armTicks: 0,
        ownerSlot: fighter.slot,
        stuckChunkIndex: chunkIdx,
        bodyHandle: -1,
        colliderHandle: -1,
      });
      system.stats.used[GadgetId.Toaster]++;
      events.push({ tick, kind: SimEventKind.GadgetUse, a: fighter.slot, b: GadgetId.Toaster, c: 0, d: 0 });
      return true;
    }

    case GadgetId.Jam: {
      const spec = getGadgetSpec(GadgetId.Jam);
      const dmg = reqNum(spec, 'damage');
      const [ax, ay] = getFighterAim(fighter, false);
      fighter.heldGadgetAmmo--;
      fighter.gadgetCooldown = 18;
      pushProjectile(system, {
        id: system.nextId++,
        kind: ProjectileKind.JamJar,
        ownerSlot: fighter.slot,
        x: fighter.x + ax * 0.5,
        y: fighter.y + fh + ay * 0.5,
        vx: ax * JAM_LOB_SPEED,
        vy: ay * JAM_LOB_SPEED + JAM_LOB_UP_VY,
        radius: 0.25,
        damage: dmg,
        bkb: 0,
        kbg: 0,
        angle: 0,
        ttlTicks: 120,
        gravityScale: JAM_GRAVITY_SCALE,
        reflected: false,
        stuckFighterSlot: -1,
        stuckChunkIndex: -1,
        stuckTicks: 0,
        gadgetId: GadgetId.Jam,
        pipingMultiHits: 0,
      });
      system.stats.used[GadgetId.Jam]++;
      events.push({ tick, kind: SimEventKind.GadgetUse, a: fighter.slot, b: GadgetId.Jam, c: 0, d: 0 });
      return true;
    }

    case GadgetId.Hoover: {
      if ((fighter.lastInputMask & InputBit.Use) === 0) return false;
      system.hooverSuckingSlots.add(fighter.slot);
      if (fighter.state === FighterState.Guard || fighter.state === FighterState.Parry) {
        fighter.state = FighterState.Idle;
        fighter.stateFrame = 0;
      }
      return true;
    }

    case GadgetId.Magnet: {
      const spec = getGadgetSpec(GadgetId.Magnet);
      const attractFrames = Math.round(reqNum(spec, 'attractFrames'));
      system.magnetOrbits.set(fighter.slot, {
        holderSlot: fighter.slot,
        ticksLeft: attractFrames,
        items: [],
      });
      events.push({ tick, kind: SimEventKind.GadgetUse, a: fighter.slot, b: GadgetId.Magnet, c: 0, d: 0 });
      return true;
    }

    default:
      assertNever(fighter.heldGadget, 'tryPickupOrUseGadget');
  }
}

function segmentCircleHit(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  r: number,
): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lenSq = dx * dx + dy * dy;
  let t = 0;
  if (lenSq > 1e-8) {
    t = Math.max(0, Math.min(1, ((cx - x0) * dx + (cy - y0) * dy) / lenSq));
  }
  const px = x0 + dx * t - cx;
  const py = y0 + dy * t - cy;
  return px * px + py * py <= r * r;
}

function spawnJamPuddle(
  system: GadgetSystemState,
  island: IslandState,
  ownerSlot: number,
  x: number,
  y: number,
): void {
  const spec = getGadgetSpec(GadgetId.Jam);
  const width = reqNum(spec, 'puddleWidth');
  const seconds = reqNum(spec, 'puddleSeconds');
  const { tickRate } = getGameData().tuning;
  const chunkIndex = findChunkUnderPoint(island, x, y);
  system.hazards.push({
    id: system.nextId++,
    gadgetId: GadgetId.Jam,
    ownerSlot,
    x,
    y,
    vx: 0,
    radius: width * 0.5,
    ttlTicks: Math.round(seconds * tickRate),
    chunkIndex,
  });
}

function stepCorkCharges(
  system: GadgetSystemState,
  fighters: readonly FighterRuntime[],
  tick: number,
  events: SimEvent[],
): void {
  for (const f of fighters) {
    if (f.heldGadget !== GadgetId.Cork || f.corkChargeFrames <= 0) continue;
    if (!isFighterAlive(f) || f.state === FighterState.Hitstun || f.state === FighterState.Tumble) {
      f.corkChargeFrames = 0;
      lastCorkTick.delete(f);
      continue;
    }
    if (lastCorkTick.get(f) === tick - 1) continue;
    if ((f.lastInputMask & InputBit.Use) === 0) {
      fireCork(system, f, tick, events);
      lastCorkTick.delete(f);
    } else if (f.lastInputTick < tick) {
      useCork(system, f, f.lastInputMask, tick, events);
    }
  }
}

const JAM_ESCAPE_IMMUNITY_TICKS = 45;
const jamRootImmunityUntilTick = new WeakMap<FighterRuntime, number>();

function isFighterSpecialProjectile(kind: ProjectileKind): boolean {
  return (
    kind === ProjectileKind.SteamPuff ||
    kind === ProjectileKind.Hook ||
    kind === ProjectileKind.Bobber ||
    kind === ProjectileKind.Sinker ||
    kind === ProjectileKind.Boot ||
    kind === ProjectileKind.Shell
  );
}

function stepProjectiles(
  system: GadgetSystemState,
  island: IslandState,
  fighters: readonly FighterRuntime[],
  tick: number,
  events: SimEvent[],
): void {
  const { gravity, parry, gadgetRules, tuning } = (() => {
    const d = getGameData();
    return { gravity: d.tuning.gravity, parry: d.tuning.parry, gadgetRules: d.gadgetRules, tuning: d.tuning };
  })();
  const arena = getArenaSpec(island.arenaId);
  const plungerStickTicks = Math.round(reqNum(getGadgetSpec(GadgetId.Plunger), 'stickSeconds') * tuning.tickRate);

  for (let i = system.projectiles.length - 1; i >= 0; i--) {
    const p = system.projectiles[i]!;

    // Stuck plunger update
    if (p.kind === ProjectileKind.Plunger && (p.stuckFighterSlot >= 0 || p.stuckChunkIndex !== -1)) {
      p.stuckTicks--;
      if (p.stuckTicks <= 0) {
        system.projectiles.splice(i, 1);
        continue;
      }
      if (p.stuckFighterSlot >= 0) {
        const tf = fighters.find((f) => f.slot === p.stuckFighterSlot);
        if (!tf || !isFighterAlive(tf)) {
          system.projectiles.splice(i, 1);
          continue;
        }
        p.x = tf.x;
        p.y = tf.y + getFighterSpec(tf.id).stats.height * 0.5;
      } else if (p.stuckChunkIndex >= 0) {
        const ch = island.chunks[p.stuckChunkIndex]!;
        if (ch.state === ChunkState.Gone) {
          system.projectiles.splice(i, 1);
          continue;
        }
      }
      continue;
    }

    // Stuck Hook or stationary Bobber are managed by stepFighterSpecialProjectiles
    if (p.kind === ProjectileKind.Hook && p.stuckFighterSlot >= 0) continue;
    if (p.kind === ProjectileKind.Bobber && p.vx === 0 && p.vy === 0) continue;

    p.ttlTicks--;
    if (p.ttlTicks <= 0) {
      system.projectiles.splice(i, 1);
      continue;
    }

    const prevX = p.x;
    const prevY = p.y;
    p.vy -= gravity * p.gravityScale * DT;
    p.x += p.vx * DT;
    p.y += p.vy * DT;

    if (p.x < arena.blastZone.left || p.x > arena.blastZone.right || p.y < arena.blastZone.bottom || p.y > arena.blastZone.top) {
      system.projectiles.splice(i, 1);
      continue;
    }

    // Fighter special projectiles (SteamPuff, Hook, Bobber, Sinker, Boot, Shell) resolve hits in stepFighterSpecialProjectiles
    if (isFighterSpecialProjectile(p.kind)) continue;

    // Continuous segment-cast vs fighters
    let hitHandled = false;
    for (const f of fighters) {
      if (f.slot === p.ownerSlot || !isFighterHitAllowed(f)) continue;
      const spec = getFighterSpec(f.id);
      const fy = f.y + spec.stats.height * 0.5;
      if (!segmentCircleHit(prevX, prevY, p.x, p.y, f.x, fy, p.radius + spec.stats.width * 0.45)) continue;

      if (f.state === FighterState.Parry) {
        grantParryGilt(f, tick, p.ownerSlot, events);
        if (p.kind === ProjectileKind.Plunger) {
          const origOwner = p.ownerSlot;
          p.ownerSlot = f.slot;
          p.reflected = true;
          p.stuckFighterSlot = origOwner;
          p.stuckTicks = plungerStickTicks;
          p.vx = 0;
          p.vy = 0;
        } else {
          p.ownerSlot = f.slot;
          p.reflected = true;
          p.vx = -p.vx * parry.projectileReflectSpeedMult;
          p.vy = -p.vy * parry.projectileReflectSpeedMult;
        }
        hitHandled = true;
        break;
      }

      if (p.kind === ProjectileKind.Plunger) {
        f.damage += p.damage;
        p.stuckFighterSlot = f.slot;
        p.stuckTicks = plungerStickTicks;
        p.vx = 0;
        p.vy = 0;
        events.push({ tick, kind: SimEventKind.Hit, a: p.ownerSlot, b: f.slot, c: Math.round(p.damage * 10), d: GadgetId.Plunger });
        hitHandled = true;
        break;
      }

      if (p.kind === ProjectileKind.JamJar) {
        f.damage += p.damage;
        events.push({ tick, kind: SimEventKind.Hit, a: p.ownerSlot, b: f.slot, c: Math.round(p.damage * 10), d: GadgetId.Jam });
        spawnJamPuddle(system, island, p.ownerSlot, p.x, f.y);
        system.projectiles.splice(i, 1);
        hitHandled = true;
        break;
      }

      const dirX = p.vx !== 0 ? Math.sign(p.vx) : Math.sign(f.x - prevX);
      applyLaunchToFighter(f, p.damage, p.bkb, p.kbg, p.angle, dirX, p.ownerSlot, p.gadgetId, tick, events);
      system.projectiles.splice(i, 1);
      hitHandled = true;
      break;
    }
    if (hitHandled) continue;

    // Terrain surface collision for JamJar & Plunger & Cork
    const surf = querySurfaceAt(island, p.x, prevY, p.y, p.kind === ProjectileKind.Plunger);
    if (surf) {
      if (p.kind === ProjectileKind.JamJar) {
        spawnJamPuddle(system, island, p.ownerSlot, p.x, surf.y);
        system.projectiles.splice(i, 1);
        continue;
      }
      if (p.kind === ProjectileKind.Plunger && surf.chunkIndex >= 0) {
        p.y = surf.y;
        p.stuckChunkIndex = surf.chunkIndex;
        p.stuckTicks = plungerStickTicks;
        p.vx = 0;
        p.vy = 0;
        continue;
      }
      if (p.kind === ProjectileKind.Cork) {
        system.projectiles.splice(i, 1);
        continue;
      }
    }
    if (p.kind === ProjectileKind.Plunger && !surf) {
      let chunkHit = -1;
      for (let ci = 0; ci < island.chunks.length; ci++) {
        const ch = island.chunks[ci]!;
        if (ch.oneWay || ch.state === ChunkState.Falling || ch.state === ChunkState.Gone) continue;
        const poly = arena.chunks[ci]!.poly;
        let inside = false;
        for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
          const ax = poly[a]![0], ay = poly[a]![1];
          const bx = poly[b]![0], by = poly[b]![1];
          if ((ay > p.y) !== (by > p.y) && p.x < ((bx - ax) * (p.y - ay)) / (by - ay) + ax) {
            inside = !inside;
          }
        }
        if (inside) {
          chunkHit = ci;
          break;
        }
      }
      if (chunkHit >= 0) {
        p.stuckChunkIndex = chunkHit;
        p.stuckTicks = plungerStickTicks;
        p.vx = 0;
        p.vy = 0;
        continue;
      }
    }

    // Plunger sticking to rubble or world gadgets
    if (p.kind === ProjectileKind.Plunger) {
      let stuck = false;
      for (const r of island.rubble) {
        if (segmentCircleHit(prevX, prevY, p.x, p.y, r.x, r.y, p.radius + r.radius)) {
          p.stuckChunkIndex = -2;
          p.pipingMultiHits = r.id;
          p.stuckTicks = plungerStickTicks;
          p.vx = 0;
          p.vy = 0;
          stuck = true;
          break;
        }
      }
      if (!stuck) {
        for (const wg of system.worldGadgets) {
          if (segmentCircleHit(prevX, prevY, p.x, p.y, wg.x, wg.y, p.radius + 0.35)) {
            p.stuckChunkIndex = -2;
            p.pipingMultiHits = wg.id;
            p.stuckTicks = plungerStickTicks;
            p.vx = 0;
            p.vy = 0;
            break;
          }
        }
      }
    }
  }

  // Step thrown WorldGadgetRuntime objects
  for (let i = system.worldGadgets.length - 1; i >= 0; i--) {
    const wg = system.worldGadgets[i]!;
    if (wg.state !== WorldGadgetState.Thrown) continue;

    const prevX = wg.x;
    const prevY = wg.y;
    wg.vy -= gravity * 0.65 * DT;
    wg.x += wg.vx * DT;
    wg.y += wg.vy * DT;
    wg.ttlTicks--;

    let hitFighter = false;
    for (const f of fighters) {
      if (f.slot === wg.ownerSlot || !isFighterHitAllowed(f)) continue;
      const spec = getFighterSpec(f.id);
      const fy = f.y + spec.stats.height * 0.5;
      if (!segmentCircleHit(prevX, prevY, wg.x, wg.y, f.x, fy, 0.35 + spec.stats.width * 0.45)) continue;
      const dmg = gadgetRules.emptyThrowDamage;
      const dirX = wg.vx !== 0 ? Math.sign(wg.vx) : 1;
      applyLaunchToFighter(f, dmg, 10, 8, 35, dirX, wg.ownerSlot, wg.gadgetId, tick, events);
      system.worldGadgets.splice(i, 1);
      events.push({ tick, kind: SimEventKind.GadgetGone, a: wg.id, b: wg.gadgetId, c: 0, d: 0 });
      hitFighter = true;
      break;
    }
    if (hitFighter) continue;

    const surf = querySurfaceAt(island, wg.x, prevY, wg.y, false);
    if (surf) {
      wg.y = surf.y;
      wg.vx = 0;
      wg.vy = 0;
      wg.state = WorldGadgetState.Grounded;
      wg.ttlTicks = Math.round(gadgetRules.despawnSeconds * tuning.tickRate);
      continue;
    }

    if (wg.y < arena.blastZone.bottom || wg.ttlTicks <= 0) {
      system.worldGadgets.splice(i, 1);
      events.push({ tick, kind: SimEventKind.GadgetGone, a: wg.id, b: wg.gadgetId, c: 0, d: 0 });
    }
  }
}

function stepToastersAndHazards(
  system: GadgetSystemState,
  island: IslandState,
  fighters: readonly FighterRuntime[],
  tick: number,
  events: SimEvent[],
): void {
  const { tuning, gadgetRules } = getGameData();
  const { hitstun, hitstop, launch, tickRate, gravity, terrain } = tuning;

  const pepperSpec = getGadgetSpec(GadgetId.Pepper);
  const sneezeMax = reqNum(pepperSpec, 'sneezeBuildFrames');
  const sneezeLaunch = reqNum(pepperSpec, 'sneezeLaunch');
  const sneezeAngleRad = reqNum(pepperSpec, 'sneezeAngle') * DEG_TO_RAD;
  const sneezeDmg = reqNum(pepperSpec, 'damage');

  const toasterSpec = getGadgetSpec(GadgetId.Toaster);
  const toasterArmFrames = reqNum(toasterSpec, 'armFrames');
  const toasterPopSpeed = reqNum(toasterSpec, 'popSpeed');
  const toasterDmg = reqNum(toasterSpec, 'damage');

  const jamSpec = getGadgetSpec(GadgetId.Jam);
  const rootMaxFrames = Math.round(reqNum(jamSpec, 'rootMaxFrames'));
  const mashToEscape = Math.round(reqNum(jamSpec, 'mashToEscape'));

  // Step hazards (Pepper clouds & Jam puddles)
  const inPepper = new Set<number>();
  const inJam = new Set<number>();
  for (let i = system.hazards.length - 1; i >= 0; i--) {
    const h = system.hazards[i]!;
    h.ttlTicks--;
    if (h.ttlTicks <= 0) {
      system.hazards.splice(i, 1);
      continue;
    }

    if (h.gadgetId === GadgetId.Pepper) {
      h.x += h.vx * DT;
      h.vx *= 0.92;
      for (const f of fighters) {
        if (!isFighterHitAllowed(f)) continue;
        const fy = f.y + getFighterSpec(f.id).stats.height * 0.5;
        const dx = f.x - h.x;
        const dy = fy - h.y;
        if (dx * dx + dy * dy <= h.radius * h.radius) {
          inPepper.add(f.slot);
          f.sneezeBuildFrames++;
          if (f.sneezeBuildFrames >= sneezeMax) {
            f.sneezeBuildFrames = 0;
            const backDir = (f.flags & FighterFlag.FacingRight) !== 0 ? -1 : 1;
            f.damage += sneezeDmg;
            f.kbVx = backDir * Math.cos(sneezeAngleRad) * sneezeLaunch;
            f.kbVy = Math.sin(sneezeAngleRad) * sneezeLaunch;
            f.hitstunFrames = Math.min(hitstun.max, Math.round(hitstun.base + hitstun.perSpeed * sneezeLaunch));
            f.hitstopFrames = Math.min(hitstop.max, Math.max(hitstop.min, Math.round(hitstop.base + hitstop.perDamage * sneezeDmg)));
            f.state = sneezeLaunch >= launch.tumbleSpeed ? FighterState.Tumble : FighterState.Hitstun;
            f.stateFrame = 0;
            f.flags &= ~FighterFlag.Grounded;
            f.lastHitBySlot = h.ownerSlot;
            f.lastHitByGadget = GadgetId.Pepper;
            f.lastHitTick = tick;
            events.push({ tick, kind: SimEventKind.Sneeze, a: f.slot, b: h.ownerSlot, c: Math.round(sneezeDmg * 10), d: 0 });
          }
        }
      }
    } else if (h.gadgetId === GadgetId.Jam) {
      if (h.chunkIndex >= 0) {
        const ch = island.chunks[h.chunkIndex]!;
        const sp = getArenaSpec(island.arenaId).chunks[h.chunkIndex]!;
        const overChunk = h.x >= Math.min(sp.topX0, sp.topX1) - h.radius && h.x <= Math.max(sp.topX0, sp.topX1) + h.radius;
        if (ch.state === ChunkState.Gone && overChunk) {
          system.hazards.splice(i, 1);
          continue;
        }
        if (ch.state === ChunkState.Loose) {
          h.y -= terrain.looseSinkSpeed * DT;
        } else if (ch.state === ChunkState.Falling) {
          h.x += ch.vx * DT;
          h.y += ch.vy * DT;
        }
      }
      for (const f of fighters) {
        if (!isFighterHitAllowed(f) || (f.flags & FighterFlag.Grounded) === 0) continue;
        if (Math.abs(f.x - h.x) <= h.radius && Math.abs(f.y - h.y) <= 0.6) {
          inJam.add(f.slot);
          const immuneUntil = jamRootImmunityUntilTick.get(f) ?? -1;
          if ((f.flags & FighterFlag.Rooted) === 0 && f.rootFrames === 0 && tick >= immuneUntil) {
            f.flags |= FighterFlag.Rooted;
            f.rootFrames = rootMaxFrames;
            f.rootMashCount = 0;
          }
        }
      }
      for (const r of island.rubble) {
        if (Math.abs(r.x - h.x) <= h.radius && Math.abs(r.y - h.y) <= 0.6) {
          r.vx = 0;
        }
      }
      for (const wg of system.worldGadgets) {
        if (wg.state === WorldGadgetState.Grounded && Math.abs(wg.x - h.x) <= h.radius && Math.abs(wg.y - h.y) <= 0.6) {
          wg.vx = 0;
        }
      }
    }
  }

  // Decay sneeze buildup when outside pepper clouds; resolve Jam root mash
  for (const f of fighters) {
    if (!inPepper.has(f.slot) && f.sneezeBuildFrames > 0) {
      f.sneezeBuildFrames = Math.max(0, f.sneezeBuildFrames - 1);
    }
    if (!inJam.has(f.slot)) {
      jamRootImmunityUntilTick.delete(f);
    }
    if ((f.flags & FighterFlag.Rooted) !== 0) {
      f.rootFrames--;
      if ((f.lastInputMask & InputBit.Jump) !== 0 && (f.prevInputMask & InputBit.Jump) === 0) {
        f.rootMashCount++;
      }
      if (f.rootMashCount >= mashToEscape || f.rootFrames <= 0) {
        f.flags &= ~FighterFlag.Rooted;
        f.rootFrames = 0;
        f.rootMashCount = 0;
        jamRootImmunityUntilTick.set(f, tick + JAM_ESCAPE_IMMUNITY_TICKS);
      }
    }
  }

  // Step Armed Toasters
  for (let i = system.worldGadgets.length - 1; i >= 0; i--) {
    const wg = system.worldGadgets[i]!;
    if (wg.state !== WorldGadgetState.ArmedToaster) continue;

    if (wg.stuckChunkIndex >= 0) {
      const ch = island.chunks[wg.stuckChunkIndex]!;
      if (ch.state === ChunkState.Loose) {
        wg.y -= terrain.looseSinkSpeed * DT;
      } else if (ch.state === ChunkState.Falling || ch.state === ChunkState.Gone) {
        wg.vy -= gravity * DT;
        wg.y += wg.vy * DT;
        if (wg.y < getArenaSpec(island.arenaId).blastZone.bottom) {
          system.worldGadgets.splice(i, 1);
          events.push({ tick, kind: SimEventKind.GadgetGone, a: wg.id, b: wg.gadgetId, c: 0, d: 0 });
          continue;
        }
      }
    }

    const jammed = system.hazards.some(
      (h) => h.gadgetId === GadgetId.Jam && Math.abs(h.x - wg.x) <= h.radius + 0.4 && Math.abs(h.y - wg.y) <= 0.7,
    );
    if (jammed) {
      wg.armTicks = 0;
      continue;
    }

    if (wg.armTicks === 0) {
      const triggeredByFighter = fighters.some(
        (f) => isFighterHitAllowed(f) && Math.abs(f.x - wg.x) <= 0.8 && Math.abs(f.y - wg.y) <= 0.7,
      );
      const triggeredByRubble = island.rubble.some(
        (r) => Math.abs(r.x - wg.x) <= 0.6 && Math.abs(r.y - wg.y) <= 0.6,
      );
      if (triggeredByFighter || triggeredByRubble) {
        wg.armTicks = 1;
      }
    } else {
      wg.armTicks++;
      if (wg.armTicks >= toasterArmFrames) {
        for (const f of fighters) {
          if (!isFighterHitAllowed(f)) continue;
          if (Math.abs(f.x - wg.x) <= 0.9 && Math.abs(f.y - wg.y) <= 1.0) {
            f.damage += toasterDmg;
            f.kbVx = 0;
            f.kbVy = toasterPopSpeed;
            f.hitstunFrames = Math.min(hitstun.max, Math.round(hitstun.base + hitstun.perSpeed * toasterPopSpeed));
            f.hitstopFrames = Math.min(hitstop.max, Math.max(hitstop.min, Math.round(hitstop.base + hitstop.perDamage * toasterDmg)));
            f.state = FighterState.Tumble;
            f.stateFrame = 0;
            f.flags &= ~FighterFlag.Grounded;
            f.lastHitBySlot = wg.ownerSlot;
            f.lastHitByGadget = GadgetId.Toaster;
            f.lastHitTick = tick;
            events.push({ tick, kind: SimEventKind.Launch, a: wg.ownerSlot, b: f.slot, c: Math.round(toasterPopSpeed * 8), d: GadgetId.Toaster });
            events.push({ tick, kind: SimEventKind.Hit, a: wg.ownerSlot, b: f.slot, c: Math.round(toasterDmg * 10), d: GadgetId.Toaster });
          }
        }
        wg.ammo--;
        wg.armTicks = 0;
        if (wg.ammo <= 0) {
          wg.state = WorldGadgetState.Grounded;
          wg.ttlTicks = Math.round(gadgetRules.despawnSeconds * tickRate);
        }
      }
    }
  }
}

function stepHooverAndMagnet(
  system: GadgetSystemState,
  island: IslandState,
  fighters: readonly FighterRuntime[],
  tick: number,
  events: SimEvent[],
): void {
  const hooverSpec = getGadgetSpec(GadgetId.Hoover);
  const coneRange = reqNum(hooverSpec, 'cone');
  const pullFighter = reqNum(hooverSpec, 'pullFighter');
  const pullObject = reqNum(hooverSpec, 'pullObject');
  const bagMaxFrames = Math.round(reqNum(hooverSpec, 'bagMaxFrames'));
  const hitByFlyingFriend = reqNum(hooverSpec, 'hitByFlyingFriend');

  const magnetSpec = getGadgetSpec(GadgetId.Magnet);
  const magnetRadius = reqNum(magnetSpec, 'radius');
  const maxOrbit = Math.round(reqNum(magnetSpec, 'maxOrbit'));

  // 1. Active Hoover suction cones (while holding Use & not yet carrying a bagged victim)
  for (const slot of [...system.hooverSuckingSlots]) {
    const holder = fighters.find((f) => f.slot === slot);
    if (
      !holder ||
      !isFighterAlive(holder) ||
      holder.heldGadget !== GadgetId.Hoover ||
      holder.heldGadgetAmmo <= 0 ||
      holder.hitstopFrames > 0 ||
      (holder.lastInputMask & InputBit.Use) === 0 ||
      system.hooverBags.has(slot) ||
      !canUseNormalGadget(holder)
    ) {
      system.hooverSuckingSlots.delete(slot);
      continue;
    }

    if (holder.state === FighterState.Guard || holder.state === FighterState.Parry || holder.state === FighterState.GuardRelease) {
      holder.state = FighterState.Idle;
      holder.stateFrame = 0;
    }

    const [ax, ay] = getFighterAim(holder, false);
    const fh = getFighterSpec(holder.id).stats.height * 0.5;
    const nozzleX = holder.x + ax * 0.65;
    const nozzleY = holder.y + fh + ay * 0.65;

    // Pull non-guarding opponents inside cone; bag non-Grog opponent reaching nozzle
    for (const target of fighters) {
      if (target.slot === holder.slot || !isFighterHitAllowed(target)) continue;
      if (target.state === FighterState.Held || target.state === FighterState.Grabbing) continue;
      if (target.state === FighterState.Guard || target.state === FighterState.GuardStun || target.state === FighterState.Parry) continue;

      const tSpec = getFighterSpec(target.id).stats;
      const tx = target.x;
      const ty = target.y + tSpec.height * 0.5;
      const dx = tx - nozzleX;
      const dy = ty - nozzleY;
      const dist = Math.hypot(dx, dy);
      if (dist > coneRange + tSpec.width * 0.5) continue;

      if (dist > 1e-5) {
        const dot = (dx * ax + dy * ay) / dist;
        if (dot < HOOVER_HALF_ANGLE_COS && dist > HOOVER_BAG_RADIUS) continue;
      }

      if (dist <= HOOVER_BAG_RADIUS && getFighterWeight(target) < GROG_WEIGHT_THRESHOLD) {
        target.state = FighterState.Held;
        target.stateFrame = 0;
        target.grabbedBySlot = -1;
        target.grabHoldFrames = 0;
        target.vx = 0;
        target.vy = 0;
        target.kbVx = 0;
        target.kbVy = 0;
        target.flags = (target.flags | FighterFlag.Invuln) & ~FighterFlag.Grounded;
        target.invulnFrames = bagMaxFrames;
        target.x = nozzleX;
        target.y = holder.y;
        system.hooverBags.set(holder.slot, {
          holderSlot: holder.slot,
          victimSlot: target.slot,
          elapsedTicks: 0,
          ticksLeft: bagMaxFrames,
          spitBlockedUntilRelease: (holder.lastInputMask & InputBit.Use) !== 0,
        });
        system.hooverSuckingSlots.delete(holder.slot);
        break;
      }

      const ux = dist > 1e-5 ? -dx / dist : -ax;
      const uy = dist > 1e-5 ? -dy / dist : -ay;
      target.x += ux * pullFighter * DT;
      target.y += uy * pullFighter * DT;
      target.vx = ux * pullFighter;
      target.vy = uy * pullFighter;
      if (uy > 0.1) target.flags &= ~FighterFlag.Grounded;
    }

    if (system.hooverBags.has(holder.slot)) continue;

    // Pull rubble, world gadgets, and non-stuck projectiles toward nozzle
    for (const r of island.rubble) {
      const dx = r.x - nozzleX;
      const dy = r.y - nozzleY;
      const dist = Math.hypot(dx, dy);
      if (dist > coneRange || dist < 1e-5) continue;
      if ((dx * ax + dy * ay) / dist < HOOVER_HALF_ANGLE_COS) continue;
      const ux = -dx / dist;
      const uy = -dy / dist;
      r.x += ux * pullObject * DT;
      r.y += uy * pullObject * DT;
      r.vx = ux * pullObject;
      r.vy = uy * pullObject;
      r.resting = false;
    }

    for (const wg of system.worldGadgets) {
      if (wg.state === WorldGadgetState.ArmedToaster) continue;
      const dx = wg.x - nozzleX;
      const dy = wg.y - nozzleY;
      const dist = Math.hypot(dx, dy);
      if (dist > coneRange || dist < 1e-5) continue;
      if ((dx * ax + dy * ay) / dist < HOOVER_HALF_ANGLE_COS) continue;
      const ux = -dx / dist;
      const uy = -dy / dist;
      wg.x += ux * pullObject * DT;
      wg.y += uy * pullObject * DT;
      wg.vx = ux * pullObject;
      wg.vy = uy * pullObject;
    }

    for (const p of system.projectiles) {
      if (p.stuckFighterSlot >= 0 || p.stuckChunkIndex >= 0) continue;
      const dx = p.x - nozzleX;
      const dy = p.y - nozzleY;
      const dist = Math.hypot(dx, dy);
      if (dist > coneRange || dist < 1e-5) continue;
      if ((dx * ax + dy * ay) / dist < HOOVER_HALF_ANGLE_COS) continue;
      const ux = -dx / dist;
      const uy = -dy / dist;
      p.vx = ux * pullObject;
      p.vy = uy * pullObject;
    }
  }

  // 2. Active Hoover bags (follow nozzle, mash to shorten to 40f, release/expiry spits)
  for (const [holderSlot, bag] of [...system.hooverBags.entries()]) {
    const holder = fighters.find((f) => f.slot === holderSlot);
    const victim = fighters.find((f) => f.slot === bag.victimSlot);
    if (!holder || !isFighterAlive(holder) || holder.heldGadget !== GadgetId.Hoover || !victim || !isFighterAlive(victim)) {
      if (victim) {
        victim.flags &= ~FighterFlag.Invuln;
        victim.invulnFrames = 0;
        if (victim.state === FighterState.Held) victim.state = FighterState.Airborne;
      }
      system.hooverBags.delete(holderSlot);
      continue;
    }

    const [ax, ay] = getFighterAim(holder, false);
    const fh = getFighterSpec(holder.id).stats.height * 0.5;
    victim.x = holder.x + ax * 0.65;
    victim.y = holder.y + ay * 0.35 + fh * 0.2;
    victim.vx = 0;
    victim.vy = 0;
    victim.kbVx = 0;
    victim.kbVy = 0;
    victim.state = FighterState.Held;
    victim.flags = (victim.flags | FighterFlag.Invuln) & ~FighterFlag.Grounded;
    victim.invulnFrames = Math.max(2, bag.ticksLeft);

    bag.elapsedTicks++;
    const mashFresh = (victim.lastInputMask & ~victim.prevInputMask & (InputBit.Jump | InputBit.Attack)) !== 0;
    if (mashFresh) {
      const minRemainingFromFloor = Math.max(0, HOOVER_MASH_FLOOR_FRAMES - bag.elapsedTicks + 1);
      const reduced = Math.max(minRemainingFromFloor, bag.ticksLeft - 8);
      bag.ticksLeft = reduced;
    }

    const useHeld = (holder.lastInputMask & InputBit.Use) !== 0;
    if (!useHeld && bag.spitBlockedUntilRelease) {
      bag.spitBlockedUntilRelease = false;
      spitHooverBag(system, holder, fighters, tick, events);
      continue;
    }

    bag.ticksLeft--;
    if (bag.ticksLeft <= 0) {
      spitHooverBag(system, holder, fighters, tick, events);
    }
  }

  // 3. Flying friend projectile collision against other opponents
  for (const [victimSlot, ff] of [...system.flyingFriends.entries()]) {
    const victim = fighters.find((f) => f.slot === victimSlot);
    if (!victim || !isFighterAlive(victim) || (victim.state !== FighterState.Tumble && victim.state !== FighterState.Hitstun)) {
      system.flyingFriends.delete(victimSlot);
      continue;
    }
    const vSpec = getFighterSpec(victim.id).stats;
    const vyCenter = victim.y + vSpec.height * 0.5;
    let collided = false;
    for (const bystander of fighters) {
      if (bystander.slot === victim.slot || bystander.slot === ff.ownerSlot || !isFighterHitAllowed(bystander)) continue;
      const bSpec = getFighterSpec(bystander.id).stats;
      const byCenter = bystander.y + bSpec.height * 0.5;
      const hitRadius = (vSpec.width + bSpec.width) * 0.5;
      if (Math.hypot(bystander.x - victim.x, byCenter - vyCenter) <= hitRadius) {
        const dirX = victim.kbVx !== 0 ? Math.sign(victim.kbVx) : Math.sign(bystander.x - victim.x) || 1;
        const spec = hooverSpec;
        applyLaunchToFighter(
          bystander,
          hitByFlyingFriend,
          reqNum(spec, 'spitBkb'),
          reqNum(spec, 'spitKbg'),
          HOOVER_SPIT_ANGLE_DEG,
          dirX,
          ff.ownerSlot,
          GadgetId.Hoover,
          tick,
          events,
        );
        system.flyingFriends.delete(victimSlot);
        collided = true;
        break;
      }
    }
    if (!collided && --ff.ticksLeft <= 0) {
      system.flyingFriends.delete(victimSlot);
    }
  }

  // 4. Active Horseshoe Magnet attract phase -> orbit -> shrapnel burst
  for (const [holderSlot, orbit] of [...system.magnetOrbits.entries()]) {
    const holder = fighters.find((f) => f.slot === holderSlot);
    if (!holder || !isFighterAlive(holder) || holder.heldGadget !== GadgetId.Magnet) {
      system.magnetOrbits.delete(holderSlot);
      continue;
    }

    const fh = getFighterSpec(holder.id).stats.height * 0.5;
    const hx = holder.x;
    const hy = holder.y + fh;

    // Pull loose rubble into orbit
    for (let i = island.rubble.length - 1; i >= 0 && orbit.items.length < maxOrbit; i--) {
      const r = island.rubble[i]!;
      const dx = r.x - hx;
      const dy = r.y - hy;
      if (Math.hypot(dx, dy) > magnetRadius) continue;
      island.rubble.splice(i, 1);
      orbit.items.push({
        id: r.id,
        sourceGadgetId: GadgetId.None,
        radius: r.radius,
        angle: Math.atan2(dy, dx),
        dist: MAGNET_ORBIT_RADIUS,
      });
    }

    // Pull loose world gadgets into orbit (excluding ArmedToaster)
    for (let i = system.worldGadgets.length - 1; i >= 0 && orbit.items.length < maxOrbit; i--) {
      const wg = system.worldGadgets[i]!;
      if (wg.state === WorldGadgetState.ArmedToaster) continue;
      const dx = wg.x - hx;
      const dy = wg.y - hy;
      if (Math.hypot(dx, dy) > magnetRadius) continue;
      system.worldGadgets.splice(i, 1);
      orbit.items.push({
        id: wg.id,
        sourceGadgetId: wg.gadgetId,
        radius: 0.3,
        angle: Math.atan2(dy, dx),
        dist: MAGNET_ORBIT_RADIUS,
      });
    }

    // Pull free projectiles (corks, shells, boots, bobbers, etc.) into orbit
    for (let i = system.projectiles.length - 1; i >= 0 && orbit.items.length < maxOrbit; i--) {
      const p = system.projectiles[i]!;
      if (p.ownerSlot === holder.slot && p.gadgetId === GadgetId.Magnet) continue;
      if (p.stuckFighterSlot >= 0 || p.stuckChunkIndex >= 0) continue;
      const dx = p.x - hx;
      const dy = p.y - hy;
      if (Math.hypot(dx, dy) > magnetRadius) continue;
      system.projectiles.splice(i, 1);
      orbit.items.push({
        id: p.id,
        sourceGadgetId: p.gadgetId,
        radius: p.radius,
        angle: Math.atan2(dy, dx),
        dist: MAGNET_ORBIT_RADIUS,
      });
    }

    // Rip held gadgets away from opponents within radius (fighters themselves do NOT stick!)
    for (const opp of fighters) {
      if (opp.slot === holder.slot || !isFighterAlive(opp) || opp.heldGadget === GadgetId.None) continue;
      if (orbit.items.length >= maxOrbit) break;
      const oppY = opp.y + getFighterSpec(opp.id).stats.height * 0.5;
      const dx = opp.x - hx;
      const dy = oppY - hy;
      if (Math.hypot(dx, dy) > magnetRadius) continue;
      const rippedGadget = opp.heldGadget;
      opp.heldGadget = GadgetId.None;
      opp.heldGadgetAmmo = 0;
      opp.corkChargeFrames = 0;
      system.hooverSuckingSlots.delete(opp.slot);
      system.magnetOrbits.delete(opp.slot);
      orbit.items.push({
        id: system.nextId++,
        sourceGadgetId: rippedGadget,
        radius: 0.32,
        angle: Math.atan2(dy, dx),
        dist: MAGNET_ORBIT_RADIUS,
      });
    }

    for (const item of orbit.items) {
      item.angle += MAGNET_ORBIT_ANGULAR_STEP;
    }

    orbit.ticksLeft--;
    if (orbit.ticksLeft <= 0) {
      fireMagnetShrapnel(system, holder, tick, events);
    }
  }
}

export function stepProjectilesAndHazards(
  system: GadgetSystemState,
  island: IslandState,
  fighters: readonly FighterRuntime[],
  tick: number,
  rng: SeededRng,
  events: SimEvent[],
): void {
  void rng;
  stepCorkCharges(system, fighters, tick, events);
  stepHooverAndMagnet(system, island, fighters, tick, events);
  stepProjectiles(system, island, fighters, tick, events);
  stepToastersAndHazards(system, island, fighters, tick, events);
}

export function cutPlungerStringsInBox(
  system: GadgetSystemState,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  fighters: readonly FighterRuntime[],
): void {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);

  for (let i = system.projectiles.length - 1; i >= 0; i--) {
    const p = system.projectiles[i]!;
    if (p.kind !== ProjectileKind.Plunger) continue;
    const owner = fighters.find((f) => f.slot === p.ownerSlot);
    if (!owner) continue;
    const midX = (owner.x + p.x) * 0.5;
    const midY = (owner.y + 0.7 + p.y) * 0.5;
    if (midX >= minX && midX <= maxX && midY >= minY && midY <= maxY) {
      system.projectiles.splice(i, 1);
    }
  }
}

export function recordFighterPosition(fighter: FighterRuntime): void {
  const cap = fighter.posHistoryX.length;
  if (cap === 0) return;
  fighter.posHistoryX[fighter.posHistoryCursor] = fighter.x;
  fighter.posHistoryY[fighter.posHistoryCursor] = fighter.y;
  fighter.posHistoryCursor = (fighter.posHistoryCursor + 1) % cap;
  if (fighter.posHistoryCount < cap) fighter.posHistoryCount++;
}
