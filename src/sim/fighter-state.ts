import type RAPIER from '@dimforge/rapier2d-deterministic-compat';
import { assert, assertFinite, requireDefined, requireKey } from './assert';
import { getFighterSpec, getGameData, type FighterStats, type MoveSpec } from './data';
import {
  ErrorCode,
  FighterFlag,
  FighterId,
  FighterState,
  GadgetId,
  InputBit,
  InputDir,
  MatchMode,
  MotionInput,
  MoveClass,
  MoveId,
  NestaSize,
  TeamId,
} from './enums';
import type { GadgetSystemState } from './gadgets';
import { createInputHistory } from './input';
import type { RapierApi } from './island';
import { SeededRng } from './prng';
import type { FighterRuntime, IslandState, SimEvent } from './types';

export const DT = 1 / 60;
export const DEG_TO_RAD = Math.PI / 180;
const POS_HISTORY_LEN = 128;

export interface FighterStepContext {
  readonly tick: number;
  readonly mode: MatchMode;
  readonly fragile: boolean;
  readonly island: IslandState;
  readonly fighters: readonly FighterRuntime[];
  readonly gadgets: GadgetSystemState;
  readonly rng: SeededRng;
  readonly rapier: RapierApi;
  readonly rapierWorld: RAPIER.World;
  readonly events: SimEvent[];
  readonly tryGrace?: (f: FighterRuntime, mask: number, inputTick: number) => boolean;
}

const AIRBORNE_STATES = new Set<FighterState>([
  FighterState.Airborne,
  FighterState.AirDodge,
  FighterState.Helpless,
  FighterState.Tumble,
  FighterState.LedgeHang,
  FighterState.Respawn,
  FighterState.Teaspoon,
  FighterState.Eliminated,
]);

const CLEAN_STARTUPS = new Map<number, number>([
  [FighterId.Earl * 100 + MoveId.Sspec, 10],
  [FighterId.Earl * 100 + MoveId.Uspec, 5],
  [FighterId.Grog * 100 + MoveId.Sspec, 12],
  [FighterId.Grog * 100 + MoveId.Dspec, 17],
]);

export const jumpVel = (gs: number, h: number): number => Math.sqrt(2 * getGameData().tuning.gravity * gs * h);
export const dirHx = (d: InputDir): -1 | 0 | 1 =>
  d === InputDir.Right || d === InputDir.UpRight || d === InputDir.DownRight
    ? 1
    : d === InputDir.Left || d === InputDir.UpLeft || d === InputDir.DownLeft
      ? -1
      : 0;
export const isDownDir = (d: InputDir): boolean =>
  d === InputDir.Down || d === InputDir.DownLeft || d === InputDir.DownRight;
export const isUpDir = (d: InputDir): boolean =>
  d === InputDir.Up || d === InputDir.UpLeft || d === InputDir.UpRight;
export const freshBit = (m: number, pm: number, b: InputBit): boolean => (m & b) !== 0 && (pm & b) === 0;
export const setFacing = (f: FighterRuntime, right: boolean): void => {
  f.flags = right ? f.flags | FighterFlag.FacingRight : f.flags & ~FighterFlag.FacingRight;
};

export function transitionState(f: FighterRuntime, next: FighterState): void {
  const prev = f.state;
  if (prev === FighterState.Attack && next !== FighterState.Attack && next !== FighterState.ChargingHeavy) {
    f.activeMove = MoveId.None;
    f.moveFrame = 0;
    f.moveHitConnected = false;
    f.moveHitIds.length = 0;
    f.moveIsClean = false;
    f.heavyChargeFrames = 0;
  }
  if (prev !== next) {
    f.state = next;
    f.stateFrame = 0;
  }
  if (AIRBORNE_STATES.has(next)) {
    f.flags &= ~FighterFlag.Grounded;
  }
}

export function resetFighterLife(f: FighterRuntime, x: number, y: number, stocks: number, initialDamage = 0): void {
  assert(Number.isInteger(stocks) && stocks >= 0, ErrorCode.InvariantViolation, `Invalid stocks ${stocks}`);
  assertFinite(x, 'resetFighterLife.x');
  assertFinite(y, 'resetFighterLife.y');
  assertFinite(initialDamage, 'resetFighterLife.damage');

  const isNesta = f.id === FighterId.Nesta;
  f.x = x;
  f.y = y;
  f.vx = 0;
  f.vy = 0;
  f.kbVx = 0;
  f.kbVy = 0;
  f.state = FighterState.Idle;
  f.stateFrame = 0;
  f.flags = x <= 0 ? FighterFlag.FacingRight : FighterFlag.None;
  f.damage = initialDamage;
  f.stocks = stocks;
  f.nestaSize = isNesta ? NestaSize.Big : NestaSize.Mid;
  f.shedsRemaining = isNesta ? 2 : 0;
  f.guardHp = getEffectiveStats(f).guardHP;
  f.guardRegenDelay = 0;
  f.parryCooldown = 0;
  f.heldGadget = GadgetId.None;
  f.heldGadgetAmmo = 0;
  f.gadgetCooldown = 0;
  f.corkChargeFrames = 0;
  f.activeMove = MoveId.None;
  f.moveFrame = 0;
  f.moveHitConnected = false;
  f.moveHitIds.length = 0;
  f.moveIsClean = false;
  f.heavyChargeFrames = 0;
  f.hitstopFrames = 0;
  f.hitstunFrames = 0;
  f.blockstunFrames = 0;
  f.invulnFrames = 0;
  f.regrabImmunity = 0;
  f.grabbedBySlot = -1;
  f.grabbingSlot = -1;
  f.grabHoldFrames = 0;
  f.doubleJumpsLeft = 1;
  f.airDodgesLeft = 1;
  f.wallJumpsLeft = 1;
  f.ledgeGrabCount = 0;
  f.ledgeChunkIndex = -1;
  f.ledgeSide = 0;
  f.comboCount = 0;
  f.comboHitsByMove.clear();
  f.lastHitBySlot = -1;
  f.lastHitByGadget = GadgetId.None;
  f.lastHitByMove = MoveId.None;
  f.lastHitTick = -1;
  f.pipingCharged = false;
  f.steepChargeFrames = 0;
  f.sneezeBuildFrames = 0;
  f.rootFrames = 0;
  f.rootMashCount = 0;
  f.slipperyFrames = 0;
  f.buffer.length = 0;
  f.pendingHit = null;
  f.stampedeCarriedSlot = -1;
  f.stampedeCarryFrames = 0;
}

export function createFighter(
  slot: number,
  id: FighterId,
  team: TeamId,
  x: number,
  y: number,
  stocks: number,
  initialDamage = 0,
): FighterRuntime {
  assert(Number.isInteger(slot) && slot >= 0 && slot < 8, ErrorCode.IndexOutOfBounds, `Invalid slot ${slot}`);
  const spec = getFighterSpec(id);
  const isNesta = id === FighterId.Nesta;
  const guardHp = isNesta
    ? requireKey(requireDefined(spec.nestaSizes, 'nestaSizes'), NestaSize.Big, 'nestaSizes').guardHP
    : spec.stats.guardHP;
  const f: FighterRuntime = {
    slot, id, team, x, y, vx: 0, vy: 0, kbVx: 0, kbVy: 0,
    state: FighterState.Idle, stateFrame: 0, flags: FighterFlag.None,
    damage: initialDamage, guardHp, guardRegenDelay: 0, parryCooldown: 0, gilt: 0, stocks,
    heldGadget: GadgetId.None, heldGadgetAmmo: 0, gadgetCooldown: 0, corkChargeFrames: 0,
    activeMove: MoveId.None, moveFrame: 0, moveHitConnected: false, moveHitIds: [], moveIsClean: false,
    heavyChargeFrames: 0, hitstopFrames: 0, hitstunFrames: 0, blockstunFrames: 0, invulnFrames: 0,
    regrabImmunity: 0, grabbedBySlot: -1, grabbingSlot: -1, grabHoldFrames: 0,
    doubleJumpsLeft: 1, airDodgesLeft: 1, wallJumpsLeft: 1, ledgeGrabCount: 0, ledgeChunkIndex: -1, ledgeSide: 0,
    comboCount: 0, comboHitsByMove: new Map(), lastHitBySlot: -1, lastHitByGadget: GadgetId.None, lastHitByMove: MoveId.None, lastHitTick: -1,
    nestaSize: isNesta ? NestaSize.Big : NestaSize.Mid, shedsRemaining: isNesta ? 2 : 0,
    pipingCharged: false, steepChargeFrames: 0, sneezeBuildFrames: 0, rootFrames: 0, rootMashCount: 0, slipperyFrames: 0,
    teaspoonCooldown: 0, teaspoonX: 0, lastInputMask: 0, prevInputMask: 0, lastInputTick: 0,
    posHistoryX: new Float32Array(POS_HISTORY_LEN), posHistoryY: new Float32Array(POS_HISTORY_LEN), posHistoryCursor: 0, posHistoryCount: 0,
    buffer: [], history: createInputHistory(32), hurtboxHistory: [], lastMotion: MotionInput.None, pendingHit: null,
    stampedeCarriedSlot: -1, stampedeCarryFrames: 0, bodyHandle: -1, colliderHandle: -1,
  };
  resetFighterLife(f, x, y, stocks, initialDamage);
  return f;
}

export function getEffectiveStats(f: FighterRuntime): FighterStats {
  const spec = getFighterSpec(f.id);
  if (f.id !== FighterId.Nesta) return spec.stats;
  const s = requireKey(requireDefined(spec.nestaSizes, 'nestaSizes'), f.nestaSize, 'nestaSizes');
  const b = spec.stats;
  return {
    ...b,
    weight: s.weight,
    height: b.height * s.scale,
    width: b.width * s.scale,
    run: s.run,
    dash: s.dash,
    airSpeed: s.airSpeed,
    fullHop: s.fullHop,
    doubleJump: s.doubleJump,
    maxFall: s.maxFall,
    grabRange: s.grabRange,
    guardHP: s.guardHP,
    crackMult: s.crackMult,
  };
}

export function getEffectiveStartup(f: FighterRuntime, move: MoveSpec, clean: boolean): number {
  let st = move.startup;
  if (f.id === FighterId.Nesta && st > 0) {
    const ns = requireKey(requireDefined(getFighterSpec(FighterId.Nesta).nestaSizes, 'nestaSizes'), f.nestaSize, 'nestaSizes');
    st = Math.max(1, st + ns.startupAdd);
  }
  if (clean && move.moveClass === MoveClass.Special) {
    const ov = CLEAN_STARTUPS.get(f.id * 100 + move.id);
    if (ov !== undefined) st = ov;
  }
  return st;
}
