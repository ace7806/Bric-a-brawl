import { assert, assertNever, InvariantError, requireDefined, requireKey } from '@sim/assert';
import { getFighterSpec, getGameData, getMoveSpec, type MoveSpec } from '@sim/data';
import {
  CancelKind,
  ChunkState,
  ErrorCode,
  FighterId,
  FighterState,
  GadgetId,
  InputBit,
  InputDir,
  MoveClass,
  MoveId,
  NestaSize,
  TeamId,
  WorldGadgetState,
} from '@sim/enums';
import { decodeInputDir, encodeInputMask } from '@sim/input';
import { SeededRng } from '@sim/prng';
import type { LedgePoint } from '@sim/types';
import { BotKind } from './enums';
import {
  DelayedBotViewBuffer,
  type BotChunkSummary,
  type BotFighterSummary,
  type BotGadgetSummary,
  type BotView,
} from './view';

export interface BotConfig {
  readonly kind: BotKind;
  readonly tape?: readonly number[];
  readonly reactionTicks?: number;
  readonly parryTargetTick?: number;
  readonly blockMarginFrames?: number;
}

export interface BotController {
  readonly kind: BotKind;
  decide(view: BotView, selfSlot: number, rng: SeededRng): number;
  reset(): void;
}

const DEFAULT_BRAWLER_REACTION = 14;
const DEFAULT_SHARP_REACTION = 12;
const DEFAULT_PARRY_REACTION = 0;
const DEFAULT_BLOCK_REACTION = 0;
const DEFAULT_BLOCK_MARGIN = 6;
const PARRY_WINDOW_TRIGGER = 3;

const MASHER_DIRS: readonly InputDir[] = [
  InputDir.Neutral,
  InputDir.Left,
  InputDir.Right,
  InputDir.UpLeft,
  InputDir.UpRight,
  InputDir.Up,
  InputDir.Down,
  InputDir.DownLeft,
  InputDir.DownRight,
];

function validateNonNegInt(value: number | undefined, defaultValue: number, label: string): number {
  if (value === undefined) return defaultValue;
  assert(Number.isInteger(value) && value >= 0, ErrorCode.InvariantViolation, `${label} must be a non-negative integer`);
  return value;
}

function findSelf(view: BotView, selfSlot: number): BotFighterSummary {
  for (let i = 0; i < view.fighters.length; i++) {
    const f = view.fighters[i]!;
    if (f.slot === selfSlot) return f;
  }
  throw new InvariantError(ErrorCode.MissingRequiredEntry, `Missing selfSlot ${selfSlot} in BotView`);
}

function isLivingEnemy(self: BotFighterSummary, other: BotFighterSummary): boolean {
  if (other.slot === self.slot) return false;
  if (self.team !== TeamId.None && other.team === self.team) return false;
  return other.stocks > 0 && other.state !== FighterState.Eliminated && other.state !== FighterState.Teaspoon;
}

function findNearestEnemy(view: BotView, self: BotFighterSummary): BotFighterSummary | null {
  let best: BotFighterSummary | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < view.fighters.length; i++) {
    const f = view.fighters[i]!;
    if (!isLivingEnemy(self, f)) continue;
    const d = Math.hypot(f.x - self.x, f.y - self.y);
    if (d < bestDist) {
      bestDist = d;
      best = f;
    }
  }
  return best;
}

function isStandable(state: ChunkState, avoidLoose: boolean): boolean {
  if (avoidLoose) return state === ChunkState.Intact || state === ChunkState.Crazed;
  return state === ChunkState.Intact || state === ChunkState.Crazed || state === ChunkState.Loose;
}

function findChunkUnder(x: number, y: number, chunks: readonly BotChunkSummary[], avoidLoose: boolean): BotChunkSummary | null {
  let best: BotChunkSummary | null = null;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]!;
    if (!isStandable(c.state, avoidLoose)) continue;
    if (x < c.x0 || x > c.x1 || c.y > y + 0.6) continue;
    if (best === null || c.y > best.y) best = c;
  }
  return best;
}

function findNearestChunk(x: number, y: number, chunks: readonly BotChunkSummary[], avoidLoose: boolean): BotChunkSummary | null {
  let best: BotChunkSummary | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]!;
    if (!isStandable(c.state, avoidLoose)) continue;
    const cx = Math.max(c.x0, Math.min(c.x1, x));
    const d = Math.hypot(cx - x, c.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

function hasGroundBeyond(x: number, dirSign: number, y: number, chunks: readonly BotChunkSummary[], avoidLoose: boolean): boolean {
  if (dirSign === 0) return false;
  for (let d = 2.0; d <= 5.5; d += 1.1) {
    if (findChunkUnder(x + dirSign * d, y + 1.5, chunks, avoidLoose) !== null) return true;
  }
  return false;
}

function findRecoveryTarget(x: number, y: number, view: BotView): { x: number; y: number } {
  let bestLedge: LedgePoint | null = null;
  let bestLedgeDist = Infinity;
  for (let i = 0; i < view.ledges.length; i++) {
    const l = view.ledges[i]!;
    const d = Math.hypot(l.x - x, l.y - y);
    if (d < bestLedgeDist) {
      bestLedgeDist = d;
      bestLedge = l;
    }
  }
  if (bestLedge !== null) return { x: bestLedge.x, y: bestLedge.y };
  const chunk = findNearestChunk(x, y, view.chunks, false);
  if (chunk !== null) return { x: Math.max(chunk.x0, Math.min(chunk.x1, x)), y: chunk.y };
  return { x: 0, y: 0 };
}

function horizontalDir(dx: number, deadzone = 0.25): InputDir {
  if (dx > deadzone) return InputDir.Right;
  if (dx < -deadzone) return InputDir.Left;
  return InputDir.Neutral;
}

function aimDirToward(dx: number, dy: number): InputDir {
  const sx = Math.abs(dx) > 0.35 ? (dx > 0 ? 1 : -1) : 0;
  const sy = Math.abs(dy) > 0.35 ? (dy > 0 ? 1 : -1) : 0;
  if (sy > 0) return sx > 0 ? InputDir.UpRight : sx < 0 ? InputDir.UpLeft : InputDir.Up;
  if (sy < 0) return sx > 0 ? InputDir.DownRight : sx < 0 ? InputDir.DownLeft : InputDir.Down;
  return sx > 0 ? InputDir.Right : sx < 0 ? InputDir.Left : InputDir.Neutral;
}

function getFighterMetrics(f: BotFighterSummary): { width: number; grabRange: number; startupAdd: number; scale: number } {
  const spec = getFighterSpec(f.id);
  if (f.id === FighterId.Nesta) {
    const size = requireKey(requireDefined(spec.nestaSizes, 'nesta.nestaSizes'), f.nestaSize, 'nestaSizes');
    return { width: spec.stats.width * size.scale, grabRange: size.grabRange, startupAdd: size.startupAdd, scale: size.scale };
  }
  return { width: spec.stats.width, grabRange: spec.stats.grabRange, startupAdd: 0, scale: 1 };
}

function getAdjustedMove(f: BotFighterSummary, moveId: MoveId): { spec: MoveSpec; startup: number; reach: number } {
  const spec = getMoveSpec(f.id, moveId);
  const m = getFighterMetrics(f);
  const startup = Math.max(1, spec.startup + m.startupAdd);
  const reach = spec.moveClass === MoveClass.Grab ? m.grabRange : spec.reach * m.scale;
  return { spec, startup, reach };
}

interface ThreatInfo {
  readonly framesToActive: number;
  readonly isActiveNow: boolean;
  readonly isGrab: boolean;
  readonly isProjectile: boolean;
}

function assessIncomingThreat(view: BotView, self: BotFighterSummary, lookaheadFrames: number): ThreatInfo | null {
  const selfMetrics = getFighterMetrics(self);
  let closest: ThreatInfo | null = null;

  for (let i = 0; i < view.fighters.length; i++) {
    const atk = view.fighters[i]!;
    if (!isLivingEnemy(self, atk)) continue;
    if (atk.state !== FighterState.Attack || atk.activeMove === MoveId.None) continue;

    const { spec, startup, reach } = getAdjustedMove(atk, atk.activeMove);
    if (spec.active <= 0) continue;
    const framesToActive = startup - atk.moveFrame;
    const isActiveNow = atk.moveFrame >= startup && atk.moveFrame < startup + spec.active;
    if (framesToActive > lookaheadFrames || (!isActiveNow && framesToActive < 0)) continue;

    const dx = self.x - atk.x;
    const dy = self.y - atk.y;
    if (Math.abs(dx) > reach + selfMetrics.width * 0.6 + 0.25) continue;
    if (Math.abs(dy) > reach + 1.5) continue;

    const omnidirectional = spec.bothSides || spec.id === MoveId.Nair || spec.id === MoveId.Dspec;
    const checkBack = spec.id === MoveId.Bair;
    const dirMatch = omnidirectional
      ? true
      : checkBack
        ? (atk.facingRight ? dx <= 0.4 : dx >= -0.4)
        : (atk.facingRight ? dx >= -0.4 : dx <= 0.4);
    if (!dirMatch) continue;

    if (closest === null || framesToActive < closest.framesToActive) {
      closest = {
        framesToActive,
        isActiveNow,
        isGrab: spec.moveClass === MoveClass.Grab,
        isProjectile: false,
      };
    }
  }

  for (let i = 0; i < view.projectiles.length; i++) {
    const p = view.projectiles[i]!;
    if (p.ownerSlot === self.slot) continue;
    const dx = self.x - p.x;
    const dy = (self.y + 0.7) - p.y;
    const dist = Math.hypot(dx, dy);
    const speed = Math.hypot(p.vx, p.vy);
    const closing = dx * p.vx + dy * p.vy;
    if (dist > 4.5 || (speed > 0.5 && closing <= 0)) continue;
    const etaFrames = speed > 0.5 ? Math.round((Math.max(0, dist - 0.6) / speed) * 60) : 0;
    if (etaFrames <= lookaheadFrames && (closest === null || etaFrames < closest.framesToActive)) {
      closest = {
        framesToActive: etaFrames,
        isActiveNow: etaFrames <= 1,
        isGrab: false,
        isProjectile: true,
      };
    }
  }

  return closest;
}

function findBestPickupGadget(view: BotView, self: BotFighterSummary, maxDist: number): BotGadgetSummary | null {
  let best: BotGadgetSummary | null = null;
  let bestDist = maxDist;
  for (let i = 0; i < view.gadgets.length; i++) {
    const g = view.gadgets[i]!;
    if (g.state !== WorldGadgetState.Parcel && g.state !== WorldGadgetState.Grounded) continue;
    if (findChunkUnder(g.x, g.y + 0.5, view.chunks, true) === null) continue;
    const d = Math.hypot(g.x - self.x, g.y - self.y);
    if (d < bestDist) {
      bestDist = d;
      best = g;
    }
  }
  return best;
}

// ---------------------------------------------------------------- Base helper

abstract class BaseBot implements BotController {
  public abstract readonly kind: BotKind;
  protected prevMask = 0;

  public abstract decide(view: BotView, selfSlot: number, rng: SeededRng): number;

  public reset(): void {
    this.prevMask = 0;
  }

  protected emit(mask: number): number {
    this.prevMask = mask;
    return mask;
  }

  protected fresh(bit: InputBit): number {
    return (this.prevMask & bit) !== 0 ? 0 : bit;
  }
}

// ---------------------------------------------------------------- 1. Masher

class MasherBot extends BaseBot {
  public readonly kind = BotKind.Masher;

  public decide(view: BotView, selfSlot: number, rng: SeededRng): number {
    findSelf(view, selfSlot);
    const dir = rng.pick(MASHER_DIRS);
    let bits = InputBit.None;
    const r = rng.next();
    if (r < 0.28) bits |= InputBit.Attack;
    else if (r < 0.44) bits |= InputBit.Special;
    else if (r < 0.58) bits |= InputBit.Heavy;
    else if (r < 0.68) bits |= InputBit.Guard;
    else if (r < 0.76) bits |= InputBit.Grab;
    else if (r < 0.86) bits |= InputBit.Use;
    if (rng.next() < 0.24) bits |= InputBit.Jump;
    if (rng.next() < 0.03) bits |= InputBit.Taunt;
    return this.emit(encodeInputMask(dir, bits));
  }
}

// ---------------------------------------------------------------- 2. Tape

class TapeBot implements BotController {
  public readonly kind = BotKind.Tape;
  private readonly tape: readonly number[];
  private cursor = 0;

  public constructor(tape: readonly number[] | undefined) {
    const resolved = requireDefined(tape, 'BotConfig.tape');
    for (let i = 0; i < resolved.length; i++) {
      const m = resolved[i]!;
      decodeInputDir(m);
      assert((m & ~0xffff) === 0, ErrorCode.InvariantViolation, `Tape[${i}] out of 16-bit range`);
    }
    this.tape = resolved;
  }

  public decide(_view: BotView, _selfSlot: number, _rng: SeededRng): number {
    if (this.cursor >= this.tape.length) return 0;
    return this.tape[this.cursor++]!;
  }

  public reset(): void {
    this.cursor = 0;
  }
}

// ---------------------------------------------------------------- 3. Chaser (Level 1)

class ChaserBot extends BaseBot {
  public readonly kind = BotKind.Chaser;

  public decide(view: BotView, selfSlot: number, _rng: SeededRng): number {
    const self = findSelf(view, selfSlot);
    if (self.state === FighterState.Eliminated) return this.emit(0);
    if (self.state === FighterState.Teaspoon) {
      const target = findNearestChunk(self.x, self.y, view.chunks, false);
      const dir = target !== null ? horizontalDir((target.x0 + target.x1) * 0.5 - self.x, 0.5) : InputDir.Neutral;
      return this.emit(encodeInputMask(dir, view.tick % 4 === 0 ? this.fresh(InputBit.Attack) : 0));
    }
    if (self.state === FighterState.LedgeHang) {
      return this.emit(encodeInputMask(InputDir.Neutral, this.fresh(InputBit.Jump)));
    }
    if (self.state === FighterState.Grabbing) {
      return this.emit(encodeInputMask(self.x >= 0 ? InputDir.Right : InputDir.Left, 0));
    }

    const standing = findChunkUnder(self.x, self.y, view.chunks, false);
    if (!self.grounded && standing === null) {
      const target = findRecoveryTarget(self.x, self.y, view);
      const dxRec = target.x - self.x;
      const drift = horizontalDir(dxRec, 0.2);
      if (self.state === FighterState.Helpless || self.state === FighterState.Attack) {
        return this.emit(encodeInputMask(drift, 0));
      }
      if (self.vy < -2.2 && self.y < target.y - 1.2 && self.doubleJumpsLeft > 0) {
        return this.emit(encodeInputMask(drift, this.fresh(InputBit.Jump)));
      }
      if (self.y < target.y - 2.4 && self.vy <= 0.2) {
        const aim = dxRec < -0.5 ? InputDir.UpLeft : dxRec > 0.5 ? InputDir.UpRight : InputDir.Up;
        return this.emit(encodeInputMask(aim, this.fresh(InputBit.Special)));
      }
      return this.emit(encodeInputMask(drift, 0));
    }

    const enemy = findNearestEnemy(view, self);
    if (enemy === null) return this.emit(0);

    const dx = enemy.x - self.x;
    const dy = enemy.y - self.y;
    const absDx = Math.abs(dx);
    const dir = horizontalDir(dx, 0.45);
    const dirSign = Math.sign(dx);

    // Chaser guards incoming swings instead of facetanking every hit
    const threat = assessIncomingThreat(view, self, 8);
    if (threat !== null && !threat.isGrab && self.grounded && self.guardHp > 16) {
      return this.emit(encodeInputMask(InputDir.Neutral, InputBit.Guard));
    }

    // Use held gadget or grab nearby parcel
    if (self.heldGadget !== GadgetId.None && Math.hypot(dx, dy) <= 7.0) {
      return this.emit(encodeInputMask(aimDirToward(dx, dy), this.fresh(InputBit.Use)));
    }
    const pickup = findBestPickupGadget(view, self, 9.5);
    if (self.heldGadget === GadgetId.None && pickup !== null) {
      const gx = pickup.x - self.x;
      if (Math.hypot(gx, pickup.y - self.y) <= 1.45) {
        return this.emit(encodeInputMask(horizontalDir(gx, 0.2), this.fresh(InputBit.Use)));
      }
      const gSign = Math.sign(gx);
      const gVoid = self.grounded && findChunkUnder(self.x + gSign * 1.2, self.y, view.chunks, false) === null;
      if (!gVoid || hasGroundBeyond(self.x, gSign, self.y, view.chunks, false)) {
        return this.emit(encodeInputMask(horizontalDir(gx, 0.2), gVoid ? this.fresh(InputBit.Jump) : 0));
      }
    }

    // Disengage from early 8-way dogpiles so matches open with genuine neutral exchanges
    if (self.grounded) {
      let closeEnemies = 0;
      for (let i = 0; i < view.fighters.length; i++) {
        const o = view.fighters[i]!;
        if (isLivingEnemy(self, o) && Math.hypot(o.x - self.x, o.y - self.y) < 3.4) closeEnemies++;
      }
      if (closeEnemies >= 2 || (view.tick < 1500 && self.damage >= 30 && absDx < 3.5 && (view.tick + selfSlot * 17) % 90 < 45)) {
        const awaySign = Math.abs(self.x) > 7.5 ? -Math.sign(self.x) : (dx >= 0 ? -1 : 1);
        if (findChunkUnder(self.x + awaySign * 2.0, self.y, view.chunks, true) !== null) {
          return this.emit(encodeInputMask(horizontalDir(awaySign, 0.1), 0));
        }
      }
    }

    const intactCount = view.chunks.filter((c) => c.state === ChunkState.Intact || c.state === ChunkState.Crazed).length;
    const stepProbeX = self.x + dirSign * 1.3;
    const voidAhead = self.grounded && absDx > 0.8 && findChunkUnder(stepProbeX, self.y, view.chunks, false) === null;
    if (voidAhead) {
      if (hasGroundBeyond(self.x, dirSign, self.y, view.chunks, false)) {
        return this.emit(encodeInputMask(dir, this.fresh(InputBit.Jump)));
      }
      // Once the island begins fracturing, aggressive Chaser gambles on off-edge chases
      if ((view.tick > 1500 || intactCount <= 9) && absDx < 5.0 && (view.tick + selfSlot * 7) % 4 === 0) {
        return this.emit(encodeInputMask(dir, this.fresh(InputBit.Jump)));
      }
      if (absDx <= 2.3 && Math.abs(dy) <= 1.8 && view.tick % 13 === 0) {
        return this.emit(encodeInputMask(dir, this.fresh(InputBit.Attack)));
      }
      return this.emit(encodeInputMask(horizontalDir(-dirSign, 0.1), 0));
    }

    if (self.grounded && dy > 2.0 && absDx < 4.0) {
      return this.emit(encodeInputMask(dir, this.fresh(InputBit.Jump)));
    }
    const swingCadence = view.tick < 1500 ? 21 : 13;
    if (absDx <= 2.1 && Math.abs(dy) <= 1.8) {
      if (self.grounded && enemy.damage >= 95 && (view.tick + selfSlot * 3) % 21 === 0) {
        return this.emit(encodeInputMask(dir, this.fresh(InputBit.Heavy)));
      }
      if ((view.tick + selfSlot * 5) % swingCadence === 0) {
        const atkDir = dir === InputDir.Neutral ? (self.facingRight ? InputDir.Right : InputDir.Left) : dir;
        return this.emit(encodeInputMask(dy > 1.2 ? InputDir.Up : atkDir, this.fresh(InputBit.Attack)));
      }
      if ((view.tick + selfSlot * 7) % 9 === 0) {
        return this.emit(encodeInputMask(horizontalDir(-dx, 0.2), 0));
      }
    }
    return this.emit(encodeInputMask(dir, 0));
  }
}

// ---------------------------------------------------------------- 4 & 5. Brawler & Sharp

class TacticalBot extends BaseBot {
  public readonly kind: BotKind.Brawler | BotKind.Sharp;
  private readonly sharp: boolean;
  private readonly delayTicks: number;
  private buffer: DelayedBotViewBuffer;
  private corkHoldTicks = 0;
  private steepHoldTicks = 0;

  public constructor(kind: BotKind.Brawler | BotKind.Sharp, reactionTicks: number) {
    super();
    this.kind = kind;
    this.sharp = kind === BotKind.Sharp;
    this.delayTicks = reactionTicks;
    this.buffer = new DelayedBotViewBuffer(reactionTicks);
  }

  public override reset(): void {
    super.reset();
    this.buffer = new DelayedBotViewBuffer(this.delayTicks);
    this.corkHoldTicks = 0;
    this.steepHoldTicks = 0;
  }

  public decide(rawView: BotView, selfSlot: number, _rng: SeededRng): number {
    const view = this.buffer.pushAndRead(rawView);
    const selfNow = findSelf(rawView, selfSlot);
    const self = findSelf(view, selfSlot);

    if (selfNow.state === FighterState.Eliminated) return this.emit(0);
    if (selfNow.state === FighterState.Teaspoon) {
      const c = findNearestChunk(selfNow.x, selfNow.y, rawView.chunks, true);
      const dir = c !== null ? horizontalDir((c.x0 + c.x1) * 0.5 - selfNow.x, 0.5) : InputDir.Neutral;
      return this.emit(encodeInputMask(dir, this.fresh(InputBit.Attack)));
    }
    if (selfNow.state === FighterState.Respawn) {
      return this.emit(encodeInputMask(InputDir.Down, 0));
    }
    if (selfNow.state === FighterState.Held) {
      return this.emit(encodeInputMask(rawView.tick % 2 === 0 ? InputDir.Left : InputDir.Right, this.fresh(InputBit.Attack)));
    }
    if (selfNow.state === FighterState.LedgeHang) {
      return this.emit(encodeInputMask(InputDir.Neutral, this.fresh(InputBit.Jump)));
    }
    if (selfNow.state === FighterState.Grabbing) {
      const targetDir = selfNow.x >= 0 ? InputDir.Right : InputDir.Left;
      const grabbed = findNearestEnemy(view, selfNow);
      const comboThrow = this.sharp && grabbed !== null && grabbed.damage < 45;
      return this.emit(encodeInputMask(comboThrow ? InputDir.Up : targetDir, 0));
    }

    // Sharp: Gilt Break in hitstun/tumble at 100 Gilt
    const breakerCost = getGameData().tuning.gilt.breakerCost;
    if (this.sharp && (selfNow.state === FighterState.Hitstun || selfNow.state === FighterState.Tumble) && selfNow.gilt >= breakerCost) {
      return this.emit(encodeInputMask(InputDir.Neutral, InputBit.Guard | InputBit.Special));
    }

    // Egg Timer recovery save in hitstun/tumble
    if (selfNow.heldGadget === GadgetId.Timer && (selfNow.state === FighterState.Hitstun || selfNow.state === FighterState.Tumble)) {
      if (findChunkUnder(selfNow.x, selfNow.y, rawView.chunks, false) === null || selfNow.y < -1.5) {
        return this.emit(encodeInputMask(InputDir.Neutral, this.fresh(InputBit.Use)));
      }
    }

    // Sharp: Tech near ground/wall + Launch DI inward
    if (selfNow.state === FighterState.Hitstun || selfNow.state === FighterState.Tumble) {
      if (this.sharp && selfNow.state === FighterState.Tumble) {
        const chunkBelow = findChunkUnder(selfNow.x, selfNow.y, rawView.chunks, false);
        const nearFloor = chunkBelow !== null && selfNow.y - chunkBelow.y <= 1.25 && selfNow.vy < 0;
        const target = findRecoveryTarget(selfNow.x, selfNow.y, rawView);
        const nearWall = Math.abs(selfNow.x - target.x) <= 1.1 && Math.abs(selfNow.y - target.y) <= 1.6;
        if (nearFloor || nearWall) {
          return this.emit(encodeInputMask(horizontalDir(-selfNow.x, 0.2), this.fresh(InputBit.Guard)));
        }
      }
      if (this.sharp) {
        const inward = selfNow.x > 0.2 ? -1 : selfNow.x < -0.2 ? 1 : 0;
        const diDir = selfNow.y > 4 && Math.abs(selfNow.vx) > 6
          ? (inward > 0 ? InputDir.DownRight : inward < 0 ? InputDir.DownLeft : InputDir.Down)
          : (inward > 0 ? (selfNow.vy < 0 ? InputDir.UpRight : InputDir.Right) : inward < 0 ? (selfNow.vy < 0 ? InputDir.UpLeft : InputDir.Left) : InputDir.Neutral);
        return this.emit(encodeInputMask(diDir, 0));
      }
      // Steer inward during Tumble so Brawler exits Tumble once hitstun expires and can actually recover!
      const recoverDir = horizontalDir(-selfNow.x, 0.2);
      return this.emit(encodeInputMask(recoverDir === InputDir.Neutral ? InputDir.Right : recoverDir, 0));
    }

    // Immediate offstage recovery using live self position (never walk/fall off due to enemy reaction delay)
    const standingNow = findChunkUnder(selfNow.x, selfNow.y, rawView.chunks, false);
    if (!selfNow.grounded && standingNow === null) {
      return this.emit(this.decideRecovery(rawView, selfNow));
    }

    // Continue charging Cork or Steep if active
    if (this.corkHoldTicks > 0 && selfNow.heldGadget === GadgetId.Cork) {
      this.corkHoldTicks++;
      const enemy = findNearestEnemy(view, selfNow);
      const dir = enemy !== null ? horizontalDir(enemy.x - selfNow.x, 0.2) : InputDir.Neutral;
      if (this.corkHoldTicks >= 20) {
        this.corkHoldTicks = 0;
        return this.emit(encodeInputMask(dir, 0));
      }
      return this.emit(encodeInputMask(dir, InputBit.Use));
    }
    if (this.steepHoldTicks > 0 && selfNow.id === FighterId.Earl && !selfNow.pipingCharged) {
      const threat = assessIncomingThreat(view, selfNow, 10);
      if (threat === null && this.steepHoldTicks < 52) {
        this.steepHoldTicks++;
        return this.emit(encodeInputMask(InputDir.Down, InputBit.Special));
      }
      this.steepHoldTicks = 0;
    }

    // Sharp: Light -> Special or Chain cancels on active hit
    if (this.sharp && selfNow.state === FighterState.Attack && selfNow.activeMove !== MoveId.None) {
      const cancelMask = this.decideSharpCancel(view, selfNow);
      if (cancelMask !== null) return this.emit(cancelMask);
    }

    // Threat defense (Parry for Sharp, Guard for both — read rawView so fast swings are actually reactable!)
    const threat = assessIncomingThreat(rawView, selfNow, this.sharp ? 8 : 9);
    if (threat !== null && !threat.isGrab && selfNow.grounded && selfNow.guardHp > 14) {
      if (this.sharp && threat.framesToActive <= PARRY_WINDOW_TRIGGER && threat.framesToActive >= 0) {
        return this.emit(encodeInputMask(InputDir.Neutral, this.fresh(InputBit.Guard)));
      }
      if (!this.sharp || threat.framesToActive > PARRY_WINDOW_TRIGGER) {
        return this.emit(encodeInputMask(InputDir.Neutral, InputBit.Guard));
      }
    }

    // Avoid standing on Loose chunks!
    const standingSafe = findChunkUnder(selfNow.x, selfNow.y, rawView.chunks, true);
    if (selfNow.grounded && standingSafe === null) {
      const safe = findNearestChunk(selfNow.x, selfNow.y, rawView.chunks, true);
      if (safe !== null) {
        const sx = (safe.x0 + safe.x1) * 0.5;
        const dir = horizontalDir(sx - selfNow.x, 0.2);
        const dirSign = Math.sign(sx - selfNow.x);
        const stepGap = findChunkUnder(selfNow.x + dirSign * 1.1, selfNow.y, rawView.chunks, false) === null;
        return this.emit(encodeInputMask(dir, stepGap && hasGroundBeyond(selfNow.x, dirSign, selfNow.y, rawView.chunks, false) ? this.fresh(InputBit.Jump) : 0));
      }
    }

    const enemy = findNearestEnemy(view, self);
    if (enemy === null) return this.emit(0);

    // Gadget use / pickup (prioritize gadgets strongly so party brawls feature gadget play!)
    const gadgetMask = this.decideGadget(rawView, selfNow, enemy);
    if (gadgetMask !== null) return this.emit(gadgetMask);

    // Anti-dogpile footsie spacing: when crowded by 2+ foes or hurt near a foe, disengage/weave instead of non-stop brawling
    if (selfNow.grounded) {
      let closeCount = 0;
      for (let i = 0; i < rawView.fighters.length; i++) {
        const other = rawView.fighters[i]!;
        if (isLivingEnemy(selfNow, other) && Math.hypot(other.x - selfNow.x, other.y - selfNow.y) < 3.4) {
          closeCount++;
        }
      }
      const cycle = (rawView.tick + selfSlot * 29) % 120;
      const openingPhase = rawView.tick < 1500;
      const shouldSpace =
        closeCount >= 2 ||
        (openingPhase && Math.abs(enemy.x - selfNow.x) < 3.6 && cycle < 64) ||
        (selfNow.damage >= 35 && Math.abs(enemy.x - selfNow.x) < 3.4 && cycle < 56);
      if (shouldSpace) {
        const preferCenter = Math.abs(selfNow.x) > 7.5 ? -Math.sign(selfNow.x) : (enemy.x >= selfNow.x ? -1 : 1);
        const safeRetreat = findChunkUnder(selfNow.x + preferCenter * 2.0, selfNow.y, rawView.chunks, true) !== null;
        if (safeRetreat) {
          const awayDir = horizontalDir(preferCenter, 0.1);
          if (closeCount >= 2 && cycle % 24 === 0) {
            return this.emit(encodeInputMask(awayDir, InputBit.Guard));
          }
          return this.emit(encodeInputMask(awayDir, 0));
        }
      }
    }

    // Edge-guarding when enemy is offstage
    const enemyOnStage = findChunkUnder(enemy.x, enemy.y, rawView.chunks, false) !== null;
    if (!enemy.grounded && !enemyOnStage && selfNow.grounded) {
      return this.emit(this.decideEdgeGuard(rawView, selfNow, enemy));
    }

    return this.emit(this.decideNeutralAndCombat(rawView, selfNow, enemy));
  }

  private decideRecovery(view: BotView, self: BotFighterSummary): number {
    const target = findRecoveryTarget(self.x, self.y, view);
    const dx = target.x - self.x;
    const dy = target.y - self.y;
    const drift = horizontalDir(dx, 0.2);
    if (self.state === FighterState.Helpless || self.state === FighterState.Attack) {
      return encodeInputMask(drift, 0);
    }
    const isHeavy = self.id === FighterId.Grog;
    const lateChaos = !this.sharp && view.tick > 1500;
    const djThreshold = isHeavy ? -0.4 : this.sharp ? -0.8 : lateChaos ? -4.2 : -1.8;
    if (self.vy < djThreshold && self.doubleJumpsLeft > 0) {
      return encodeInputMask(drift, this.fresh(InputBit.Jump));
    }
    if (self.id === FighterId.Moss && Math.hypot(dx, dy) <= 9.0 && self.y < target.y + 0.5 && self.vy <= 0.5) {
      const aim = dx < -0.6 ? InputDir.UpLeft : dx > 0.6 ? InputDir.UpRight : InputDir.Up;
      return encodeInputMask(aim, this.fresh(InputBit.Special));
    }
    const uspecYOffset = isHeavy ? 0.5 : this.sharp ? 1.0 : lateChaos ? 3.8 : 1.6;
    if (self.y < target.y - uspecYOffset && self.vy <= 0.4) {
      const aim = dx < -0.5 ? InputDir.UpLeft : dx > 0.5 ? InputDir.UpRight : InputDir.Up;
      return encodeInputMask(aim, this.fresh(InputBit.Special));
    }
    return encodeInputMask(drift, 0);
  }

  private decideSharpCancel(view: BotView, self: BotFighterSummary): number | null {
    const move = getMoveSpec(self.id, self.activeMove);
    if (self.moveFrame < move.startup) return null;
    const enemy = findNearestEnemy(view, self);
    if (enemy === null) return null;
    const dx = enemy.x - self.x;
    const dy = enemy.y - self.y;
    if (Math.hypot(dx, dy) > 2.8) return null;
    if (move.cancel === CancelKind.Chain) {
      return encodeInputMask(horizontalDir(dx, 0.3), this.fresh(InputBit.Attack));
    }
    if (move.cancel === CancelKind.Special) {
      const dir = dy > 1.2 ? InputDir.Up : horizontalDir(dx, 0.2);
      return encodeInputMask(dir, this.fresh(InputBit.Special));
    }
    return null;
  }

  private decideGadget(view: BotView, self: BotFighterSummary, enemy: BotFighterSummary): number | null {
    const dx = enemy.x - self.x;
    const dy = enemy.y - self.y;
    const dist = Math.hypot(dx, dy);

    if (self.heldGadget !== GadgetId.None) {
      if (self.heldGadget === GadgetId.Cork) {
        if (dist <= 9.5 && self.grounded) {
          this.corkHoldTicks = 1;
          return encodeInputMask(horizontalDir(dx, 0.2), InputBit.Use);
        }
        return null;
      }
      const fireRange =
        self.heldGadget === GadgetId.Bellows || self.heldGadget === GadgetId.Plunger || self.heldGadget === GadgetId.Magnet
          ? 7.8
          : 5.5;
      if (dist <= fireRange) {
        return encodeInputMask(aimDirToward(dx, dy), this.fresh(InputBit.Use));
      }
      return null;
    }

    const pickup = findBestPickupGadget(view, self, 12.0);
    if (pickup === null) return null;
    const gx = pickup.x - self.x;
    const gy = pickup.y - self.y;
    if (Math.hypot(gx, gy) <= 1.45) {
      return encodeInputMask(horizontalDir(gx, 0.3), this.fresh(InputBit.Use));
    }
    const dirSign = Math.sign(gx);
    const dir = horizontalDir(gx, 0.2);
    const gapAhead = self.grounded && findChunkUnder(self.x + dirSign * 1.2, self.y, view.chunks, false) === null;
    if (gapAhead && !hasGroundBeyond(self.x, dirSign, self.y, view.chunks, false)) return null;
    const jumpNeeded = (self.grounded && gy > 1.5) || gapAhead;
    return encodeInputMask(dir, jumpNeeded ? this.fresh(InputBit.Jump) : 0);
  }

  private decideEdgeGuard(view: BotView, self: BotFighterSummary, enemy: BotFighterSummary): number {
    const target = findRecoveryTarget(enemy.x, enemy.y, view);
    const inwardSign = target.x >= 0 ? -1 : 1;
    const guardSpotX = target.x + inwardSign * 1.4;
    const dxSpot = guardSpotX - self.x;
    // Once match heats up (t > 25s), Brawler gambles on deep offstage aerial edgeguards
    if (!this.sharp && view.tick > 1500 && Math.abs(enemy.x - self.x) < 4.8 && (view.tick + self.slot * 13) % 4 === 0) {
      return encodeInputMask(horizontalDir(enemy.x - self.x, 0.1), this.fresh(InputBit.Jump));
    }
    if (Math.abs(dxSpot) > 0.9) {
      const stepSign = Math.sign(dxSpot);
      if (findChunkUnder(self.x + stepSign * 1.2, self.y, view.chunks, false) === null) {
        return encodeInputMask(horizontalDir(-stepSign, 0.1), 0);
      }
      return encodeInputMask(horizontalDir(dxSpot, 0.2), 0);
    }
    const facingLedgeDir = target.x >= self.x ? InputDir.Right : InputDir.Left;
    if (Math.abs(enemy.x - self.x) <= 2.4 && Math.abs(enemy.y - self.y) <= 2.0) {
      return encodeInputMask(facingLedgeDir, this.fresh(enemy.damage >= 75 ? InputBit.Heavy : InputBit.Attack));
    }
    if (self.id === FighterId.Earl || self.id === FighterId.Moss) {
      return encodeInputMask(facingLedgeDir, this.fresh(InputBit.Special));
    }
    return encodeInputMask(facingLedgeDir, 0);
  }

  private decideNeutralAndCombat(view: BotView, self: BotFighterSummary, enemy: BotFighterSummary): number {
    const dx = enemy.x - self.x;
    const dy = enemy.y - self.y;
    const absDx = Math.abs(dx);
    const dir = horizontalDir(dx, 0.3);
    const dirSign = Math.sign(dx);
    const metrics = getFighterMetrics(self);

    // Grab guarding opponent
    if (
      self.grounded &&
      (enemy.state === FighterState.Guard || enemy.state === FighterState.GuardStun) &&
      absDx <= metrics.grabRange + 0.5 &&
      Math.abs(dy) <= 1.2
    ) {
      return encodeInputMask(dir, this.fresh(InputBit.Grab));
    }

    // Fighter-specific tactical specials
    if (self.grounded) {
      if (self.id === FighterId.Nesta && self.nestaSize !== NestaSize.Small && (self.damage >= 95 || (Math.abs(self.x) > 9.5 && absDx < 3.0))) {
        return encodeInputMask(InputDir.Down, this.fresh(InputBit.Special));
      }
      if (self.id === FighterId.Earl && !self.pipingCharged && absDx > 6.0) {
        this.steepHoldTicks = 1;
        return encodeInputMask(InputDir.Down, InputBit.Special);
      }
      if (self.id === FighterId.Grog) {
        const underfoot = findChunkUnder(self.x, self.y, view.chunks, true);
        if (underfoot !== null && underfoot.hp > 95 && absDx <= 3.0 && Math.abs(dy) <= 1.5 && view.tick % 50 === 0) {
          return encodeInputMask(InputDir.Down, this.fresh(InputBit.Special));
        }
        // Check full Stampede runway (2.5, 5.0, 7.5 u) so Grog doesn't charge off into the void
        const safeStampede =
          findChunkUnder(self.x + dirSign * 2.5, self.y, view.chunks, true) !== null &&
          findChunkUnder(self.x + dirSign * 5.0, self.y, view.chunks, true) !== null &&
          findChunkUnder(self.x + dirSign * 7.5, self.y, view.chunks, true) !== null;
        if (safeStampede && absDx >= 3.8 && absDx <= 7.2 && Math.abs(dy) <= 1.2 && view.tick % 36 === 0) {
          return encodeInputMask(dir, this.fresh(InputBit.Special));
        }
      }
    } else if (self.id === FighterId.Grog && dy < -1.5 && absDx < 1.8 && findChunkUnder(self.x, self.y, view.chunks, false) !== null) {
      return encodeInputMask(InputDir.Down, this.fresh(InputBit.Special));
    }

    // Sharp: Juggle airborne opponents above
    if (this.sharp && !enemy.grounded && dy > 0.8 && dy < 4.5 && absDx < 2.2) {
      if (self.grounded) {
        if (dy < 2.1 && (view.tick + self.slot * 5) % 10 === 0) return encodeInputMask(InputDir.Up, this.fresh(enemy.damage >= 95 ? InputBit.Heavy : InputBit.Attack));
        return encodeInputMask(dir, this.fresh(InputBit.Jump));
      }
      if ((view.tick + self.slot * 5) % 9 === 0) return encodeInputMask(InputDir.Up, this.fresh(InputBit.Attack));
    }

    // Aerial attacks (only when over solid stage!)
    if (!self.grounded && absDx <= 2.3 && Math.abs(dy) <= 2.0 && (view.tick + self.slot * 7) % 10 === 0) {
      const atkDir = dy > 0.9 ? InputDir.Up : dy < -1.0 ? InputDir.Down : dir;
      return encodeInputMask(atkDir, this.fresh(InputBit.Attack));
    }

    // Grounded attacks with human-like opening footsie cadence escalating as stage shrinks
    const attackReach = self.id === FighterId.Moss ? 2.6 : 2.1;
    if (self.grounded && absDx <= attackReach && Math.abs(dy) <= 1.7) {
      const opening = view.tick < 1500;
      const cadence = this.sharp ? (opening ? 15 : 10) : (opening ? 23 : 15);
      if (enemy.damage >= 95 && (view.tick + self.slot * 11) % (opening ? 27 : 18) === 0) {
        return encodeInputMask(dir, this.fresh(InputBit.Heavy));
      }
      if ((view.tick + self.slot * 7) % cadence === 0) {
        const atkDir = dy > 1.0 ? InputDir.Up : (self.id === FighterId.Moss && absDx > 1.6 ? dir : InputDir.Neutral);
        return encodeInputMask(atkDir, this.fresh(InputBit.Attack));
      }
      // Subtle shimmy / guard poke between swings
      const phase = (view.tick + self.slot * 13) % 18;
      if (phase < 7 && self.guardHp > 20) return encodeInputMask(InputDir.Neutral, InputBit.Guard);
      return encodeInputMask(phase < 13 ? horizontalDir(-dx, 0.2) : InputDir.Neutral, 0);
    }

    // Approach while respecting chunk gaps vs outer cliffs
    const stepProbeX = self.x + dirSign * 1.3;
    const voidAhead = self.grounded && absDx > 0.8 && findChunkUnder(stepProbeX, self.y, view.chunks, true) === null;
    if (voidAhead) {
      if (hasGroundBeyond(self.x, dirSign, self.y, view.chunks, false)) {
        return encodeInputMask(dir, this.fresh(InputBit.Jump));
      }
      return encodeInputMask(horizontalDir(-dirSign, 0.1), 0);
    }
    if (self.grounded && dy > 2.1 && absDx < 4.5) {
      return encodeInputMask(dir, this.fresh(InputBit.Jump));
    }
    return encodeInputMask(dir, 0);
  }
}

// ---------------------------------------------------------------- 6. ParryBot

class ParryBot extends BaseBot {
  public readonly kind = BotKind.ParryBot;
  private readonly parryTargetTick: number | undefined;
  private readonly delayTicks: number;
  private buffer: DelayedBotViewBuffer;

  public constructor(parryTargetTick: number | undefined, reactionTicks: number) {
    super();
    this.parryTargetTick = parryTargetTick;
    this.delayTicks = reactionTicks;
    this.buffer = new DelayedBotViewBuffer(reactionTicks);
  }

  public override reset(): void {
    super.reset();
    this.buffer = new DelayedBotViewBuffer(this.delayTicks);
  }

  public decide(rawView: BotView, selfSlot: number, _rng: SeededRng): number {
    const view = this.buffer.pushAndRead(rawView);
    const self = findSelf(view, selfSlot);

    if (this.parryTargetTick !== undefined) {
      const mask = rawView.tick === this.parryTargetTick ? encodeInputMask(InputDir.Neutral, InputBit.Guard) : 0;
      return this.emit(mask);
    }

    const threat = assessIncomingThreat(view, self, PARRY_WINDOW_TRIGGER);
    if (threat !== null && !threat.isGrab && (threat.framesToActive <= PARRY_WINDOW_TRIGGER || threat.isActiveNow)) {
      return this.emit(encodeInputMask(InputDir.Neutral, this.fresh(InputBit.Guard)));
    }
    return this.emit(0);
  }
}

// ---------------------------------------------------------------- 7. BlockBot

class BlockBot extends BaseBot {
  public readonly kind = BotKind.BlockBot;
  private readonly marginFrames: number;
  private readonly delayTicks: number;
  private buffer: DelayedBotViewBuffer;

  public constructor(blockMarginFrames: number, reactionTicks: number) {
    super();
    this.marginFrames = blockMarginFrames;
    this.delayTicks = reactionTicks;
    this.buffer = new DelayedBotViewBuffer(reactionTicks);
  }

  public override reset(): void {
    super.reset();
    this.buffer = new DelayedBotViewBuffer(this.delayTicks);
  }

  public decide(rawView: BotView, selfSlot: number, _rng: SeededRng): number {
    const view = this.buffer.pushAndRead(rawView);
    const self = findSelf(view, selfSlot);
    const threat = assessIncomingThreat(view, self, this.marginFrames);
    if (threat !== null && !threat.isGrab) {
      return this.emit(encodeInputMask(InputDir.Neutral, InputBit.Guard));
    }
    return this.emit(0);
  }
}

// ---------------------------------------------------------------- 8. Runner

class RunnerBot extends BaseBot {
  public readonly kind = BotKind.Runner;
  private airTicksSinceJump = 0;
  private jumpAttempted = false;
  private airDodgeAttempted = false;

  public override reset(): void {
    super.reset();
    this.airTicksSinceJump = 0;
    this.jumpAttempted = false;
    this.airDodgeAttempted = false;
  }

  public decide(view: BotView, selfSlot: number, _rng: SeededRng): number {
    const self = findSelf(view, selfSlot);
    if (self.state === FighterState.Eliminated || self.state === FighterState.Teaspoon) return this.emit(0);

    if (self.grounded || self.state === FighterState.LedgeHang || self.state === FighterState.Respawn) {
      this.jumpAttempted = false;
      this.airTicksSinceJump = 0;
      this.airDodgeAttempted = false;
      if (self.state === FighterState.LedgeHang) {
        return this.emit(encodeInputMask(InputDir.Neutral, this.fresh(InputBit.Jump)));
      }
      const safe = findNearestChunk(self.x, self.y, view.chunks, true);
      if (safe !== null) {
        const cx = (safe.x0 + safe.x1) * 0.5;
        return this.emit(encodeInputMask(horizontalDir(cx - self.x, 0.5), 0));
      }
      return this.emit(0);
    }

    const standing = findChunkUnder(self.x, self.y, view.chunks, false);
    const target = findRecoveryTarget(self.x, self.y, view);
    const dx = target.x - self.x;
    const dy = target.y - self.y;
    const drift = horizontalDir(dx, 0.15);

    if (self.state === FighterState.Hitstun || self.state === FighterState.Tumble) {
      this.jumpAttempted = false;
      this.airTicksSinceJump = 0;
      const di = Math.abs(dx) > 0.3 ? (dx > 0 ? InputDir.UpRight : InputDir.UpLeft) : InputDir.Up;
      return this.emit(encodeInputMask(di, 0));
    }
    if (self.state === FighterState.Helpless || self.state === FighterState.Attack || self.state === FighterState.AirDodge) {
      return this.emit(encodeInputMask(drift, 0));
    }

    // Over safe stage and not falling deeply: drift toward center of chunk
    if (standing !== null && self.y >= standing.y) {
      const cx = (standing.x0 + standing.x1) * 0.5;
      return this.emit(encodeInputMask(horizontalDir(cx - self.x, 0.3), 0));
    }

    // Offstage / falling recovery sequence: drift -> double-jump at apex/below ledge -> up-special / air-dodge
    if (this.jumpAttempted) {
      if (self.vy > 4.0) this.airTicksSinceJump = 0;
      else this.airTicksSinceJump++;
    }

    if (!this.jumpAttempted && (self.y <= target.y + 0.5 || self.vy <= 0.2)) {
      this.jumpAttempted = true;
      this.airTicksSinceJump = 0;
      return this.emit(encodeInputMask(drift, this.fresh(InputBit.Jump)));
    }

    const dist = Math.hypot(dx, dy);
    const airDodgeDist = getGameData().tuning.dodge.air.distance;
    if (!this.airDodgeAttempted && dist <= airDodgeDist + 0.4 && self.y >= target.y - 1.2 && self.y <= target.y + 1.5 && self.vy <= 1.0) {
      this.airDodgeAttempted = true;
      return this.emit(encodeInputMask(aimDirToward(dx, dy), this.fresh(InputBit.Guard)));
    }

    if ((this.airTicksSinceJump >= 8 || self.y < target.y - 2.0) && self.vy <= 0.6) {
      if (self.id === FighterId.Moss) {
        const aim = dx < -0.5 ? InputDir.UpLeft : dx > 0.5 ? InputDir.UpRight : InputDir.Up;
        return this.emit(encodeInputMask(aim, this.fresh(InputBit.Special)));
      }
      return this.emit(encodeInputMask(InputDir.Up, this.fresh(InputBit.Special)));
    }

    return this.emit(encodeInputMask(drift, 0));
  }
}

// ---------------------------------------------------------------- Factory

export function createBot(config: BotConfig): BotController {
  switch (config.kind) {
    case BotKind.Masher:
      return new MasherBot();
    case BotKind.Tape:
      return new TapeBot(config.tape);
    case BotKind.Chaser:
      return new ChaserBot();
    case BotKind.Brawler:
      return new TacticalBot(BotKind.Brawler, validateNonNegInt(config.reactionTicks, DEFAULT_BRAWLER_REACTION, 'reactionTicks'));
    case BotKind.Sharp:
      return new TacticalBot(BotKind.Sharp, validateNonNegInt(config.reactionTicks, DEFAULT_SHARP_REACTION, 'reactionTicks'));
    case BotKind.ParryBot:
      return new ParryBot(
        config.parryTargetTick === undefined ? undefined : validateNonNegInt(config.parryTargetTick, 0, 'parryTargetTick'),
        validateNonNegInt(config.reactionTicks, DEFAULT_PARRY_REACTION, 'reactionTicks'),
      );
    case BotKind.BlockBot:
      return new BlockBot(
        validateNonNegInt(config.blockMarginFrames, DEFAULT_BLOCK_MARGIN, 'blockMarginFrames'),
        validateNonNegInt(config.reactionTicks, DEFAULT_BLOCK_REACTION, 'reactionTicks'),
      );
    case BotKind.Runner:
      return new RunnerBot();
    default:
      return assertNever(config.kind, 'createBot');
  }
}
