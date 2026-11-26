import { assert } from '@sim/assert';
import { computeHitstun } from '@sim/combat';
import { CHASE_DODGE_WINDOW_FRAMES } from '@sim/combat-kinematics';
import { getFighterSpec, getGameData } from '@sim/data';
import { ChunkState, ErrorCode, FighterFlag, FighterId, FighterState, MoveId, NestaSize, SimEventKind } from '@sim/enums';
import { recomputeLedges } from '@sim/island';
import type { FighterRuntime, InputBufferEntry, MatchConfig, SimEvent } from '@sim/types';
import { SimWorld } from '@sim/world';
import type { InputPacket, SnapshotData, SnapshotFighter } from './codec';
import { PredictionController, ReconcileContext, type ReconcileResult } from './sync';

const CHECKPOINT_RING_SIZE = 64;
const CHECKPOINT_RING_MASK = CHECKPOINT_RING_SIZE - 1;

interface FighterCheckpoint {
  tick: number;
  prevInputMask: number;
  lastInputMask: number;
  doubleJumpsLeft: number;
  airDodgesLeft: number;
  wallJumpsLeft: number;
  ledgeGrabCount: number;
  ledgeChunkIndex: number;
  ledgeSide: number;
  parryCooldown: number;
  guardRegenDelay: number;
  hitstunFrames: number;
  blockstunFrames: number;
  hitstopFrames: number;
  invulnFrames: number;
  slipperyFrames: number;
  moveIsClean: boolean;
  moveHitConnected: boolean;
  moveHitLanded: boolean;
  moveHitIds: number[];
  chaseDodgeWindow: number;
  chaseDodgeActive: boolean;
  sdiNudgesLeft: number;
  heavyChargeFrames: number;
  comboCount: number;
  state: FighterState;
  historyMasks: Int32Array;
  historyTicks: Int32Array;
  historyHead: number;
  historyCount: number;
  buffer: InputBufferEntry[];
}

export function fighterToSnapshot(f: FighterRuntime): SnapshotFighter {
  return {
    slot: f.slot,
    x: f.x,
    y: f.y,
    vx: f.vx + f.kbVx,
    vy: f.vy + f.kbVy,
    state: f.state,
    stateFrame: f.stateFrame,
    activeMove: f.activeMove,
    flags: f.flags,
    damage: f.damage,
    guardHp: f.guardHp,
    gilt: f.gilt,
    stocks: f.stocks,
    heldGadget: f.heldGadget,
    heldGadgetAmmo: f.heldGadgetAmmo,
    nestaSize: f.nestaSize,
    hitstopFrames: Math.min(15, f.hitstopFrames),
  };
}

export function applySnapshotFighter(sf: SnapshotFighter, target: FighterRuntime): void {
  const prevState = target.state;
  target.x = sf.x;
  target.y = sf.y;
  target.teaspoonX = sf.x;
  const isLaunched = sf.state === FighterState.Hitstun || sf.state === FighterState.Tumble;
  if (isLaunched) {
    target.vx = 0;
    target.vy = 0;
    target.kbVx = sf.vx;
    target.kbVy = sf.vy;
    const { kbDecay, tickRate } = getGameData().tuning;
    const estInitialSpeed = Math.hypot(sf.vx, sf.vy) + kbDecay * (sf.stateFrame / tickRate);
    const estRemaining = Math.max(1, computeHitstun(estInitialSpeed) - sf.stateFrame);
    if (prevState !== FighterState.Hitstun && prevState !== FighterState.Tumble) {
      target.hitstunFrames = estRemaining;
    } else if (sf.state === FighterState.Hitstun && target.hitstunFrames <= 0) {
      target.hitstunFrames = estRemaining;
    }
  } else {
    const stats = getFighterSpec(target.id).stats;
    const grounded = (sf.flags & FighterFlag.Grounded) !== 0;
    const isSelfBurst =
      sf.state === FighterState.AirDodge ||
      sf.state === FighterState.Roll ||
      sf.state === FighterState.Attack;
    const maxSelfVx =
      sf.state === FighterState.GuardStun
        ? 0.25
        : isSelfBurst
          ? Math.max(stats.dash, stats.run, stats.airSpeed, 18.0)
          : Math.max(stats.dash, stats.run, stats.airSpeed) + 0.5;
    if (Math.abs(sf.vx) > maxSelfVx) {
      const clampedVx = Math.sign(sf.vx) * Math.max(0, maxSelfVx - 0.5);
      target.vx = clampedVx;
      target.kbVx = sf.vx - clampedVx;
    } else {
      target.vx = sf.vx;
      target.kbVx = 0;
    }
    if (grounded && Math.abs(sf.vy) > 0.25) {
      target.vy = 0;
      target.kbVy = sf.vy;
    } else {
      target.vy = sf.vy;
      target.kbVy = 0;
    }
  }
  target.hitstopFrames = sf.hitstopFrames;
  target.state = sf.state;
  target.stateFrame = sf.stateFrame;
  target.activeMove = sf.activeMove;
  target.moveFrame = sf.state === FighterState.Attack ? sf.stateFrame : 0;
  target.chaseDodgeActive = sf.state === FighterState.AirDodge && Math.hypot(sf.vx, sf.vy) > 13.8;
  assert(
    !(target.state === FighterState.Attack && target.activeMove === MoveId.None),
    ErrorCode.InvariantViolation,
    `Fighter slot ${target.slot} in Attack state with MoveId.None`,
  );
  target.flags = sf.flags;
  target.damage = sf.damage;
  target.guardHp = sf.guardHp;
  target.gilt = sf.gilt;
  target.stocks = sf.stocks;
  target.heldGadget = sf.heldGadget;
  target.heldGadgetAmmo = sf.heldGadgetAmmo;
  target.nestaSize = sf.nestaSize;
  if (target.id === FighterId.Nesta) {
    target.shedsRemaining = sf.nestaSize === NestaSize.Big ? 2 : sf.nestaSize === NestaSize.Mid ? 1 : 0;
  }
  if ((sf.flags & FighterFlag.Grounded) !== 0) {
    target.doubleJumpsLeft = 1;
    target.airDodgesLeft = 1;
    target.wallJumpsLeft = 1;
    target.ledgeGrabCount = 0;
  }
}

function createEmptyCheckpoint(historyCapacity: number): FighterCheckpoint {
  return {
    tick: -1,
    prevInputMask: 0,
    lastInputMask: 0,
    doubleJumpsLeft: 0,
    airDodgesLeft: 0,
    wallJumpsLeft: 0,
    ledgeGrabCount: 0,
    ledgeChunkIndex: -1,
    ledgeSide: 0,
    parryCooldown: 0,
    guardRegenDelay: 0,
    hitstunFrames: 0,
    blockstunFrames: 0,
    hitstopFrames: 0,
    invulnFrames: 0,
    slipperyFrames: 0,
    moveIsClean: false,
    moveHitConnected: false,
    moveHitLanded: false,
    moveHitIds: [],
    chaseDodgeWindow: 0,
    chaseDodgeActive: false,
    sdiNudgesLeft: 0,
    heavyChargeFrames: 0,
    comboCount: 0,
    state: FighterState.Idle,
    historyMasks: new Int32Array(historyCapacity),
    historyTicks: new Int32Array(historyCapacity),
    historyHead: 0,
    historyCount: 0,
    buffer: [],
  };
}

function writeCheckpoint(cp: FighterCheckpoint, tick: number, f: FighterRuntime): void {
  cp.tick = tick;
  cp.prevInputMask = f.prevInputMask;
  cp.lastInputMask = f.lastInputMask;
  cp.doubleJumpsLeft = f.doubleJumpsLeft;
  cp.airDodgesLeft = f.airDodgesLeft;
  cp.wallJumpsLeft = f.wallJumpsLeft;
  cp.ledgeGrabCount = f.ledgeGrabCount;
  cp.ledgeChunkIndex = f.ledgeChunkIndex;
  cp.ledgeSide = f.ledgeSide;
  cp.parryCooldown = f.parryCooldown;
  cp.guardRegenDelay = f.guardRegenDelay;
  cp.hitstunFrames = f.hitstunFrames;
  cp.blockstunFrames = f.blockstunFrames;
  cp.hitstopFrames = f.hitstopFrames;
  cp.invulnFrames = f.invulnFrames;
  cp.slipperyFrames = f.slipperyFrames;
  cp.moveIsClean = f.moveIsClean;
  cp.moveHitConnected = f.moveHitConnected;
  cp.moveHitLanded = f.moveHitLanded;
  cp.moveHitIds.length = 0;
  for (let i = 0; i < f.moveHitIds.length; i++) cp.moveHitIds.push(f.moveHitIds[i]!);
  cp.chaseDodgeWindow = f.chaseDodgeWindow;
  cp.chaseDodgeActive = f.chaseDodgeActive;
  cp.sdiNudgesLeft = f.sdiNudgesLeft;
  cp.heavyChargeFrames = f.heavyChargeFrames;
  cp.comboCount = f.comboCount;
  cp.state = f.state;
  cp.historyMasks.set(f.history.masks);
  cp.historyTicks.set(f.history.ticks);
  cp.historyHead = f.history.head;
  cp.historyCount = f.history.count;
  cp.buffer.length = 0;
  for (let i = 0; i < f.buffer.length; i++) {
    const e = f.buffer[i]!;
    cp.buffer.push({ bit: e.bit, dir: e.dir, pressedTick: e.pressedTick });
  }
}

function restoreCheckpoint(cp: FighterCheckpoint, f: FighterRuntime): void {
  f.prevInputMask = cp.prevInputMask;
  f.lastInputMask = cp.lastInputMask;
  f.doubleJumpsLeft = cp.doubleJumpsLeft;
  f.airDodgesLeft = cp.airDodgesLeft;
  f.wallJumpsLeft = cp.wallJumpsLeft;
  f.ledgeGrabCount = cp.ledgeGrabCount;
  f.ledgeChunkIndex = cp.ledgeChunkIndex;
  f.ledgeSide = cp.ledgeSide;
  f.parryCooldown = cp.parryCooldown;
  f.guardRegenDelay = cp.guardRegenDelay;
  f.hitstunFrames = cp.hitstunFrames;
  f.blockstunFrames = cp.blockstunFrames;
  f.hitstopFrames = cp.hitstopFrames;
  f.invulnFrames = cp.invulnFrames;
  f.slipperyFrames = cp.slipperyFrames;
  f.moveIsClean = cp.moveIsClean;
  f.moveHitConnected = cp.moveHitConnected;
  f.moveHitLanded = cp.moveHitLanded;
  f.moveHitIds.length = 0;
  for (let i = 0; i < cp.moveHitIds.length; i++) f.moveHitIds.push(cp.moveHitIds[i]!);
  f.chaseDodgeWindow = cp.chaseDodgeWindow;
  f.chaseDodgeActive = cp.chaseDodgeActive;
  f.sdiNudgesLeft = cp.sdiNudgesLeft;
  f.heavyChargeFrames = cp.heavyChargeFrames;
  f.comboCount = cp.comboCount;
  f.state = cp.state;
  f.history.masks.set(cp.historyMasks);
  f.history.ticks.set(cp.historyTicks);
  f.history.head = cp.historyHead;
  f.history.count = cp.historyCount;
  f.buffer.length = 0;
  for (let i = 0; i < cp.buffer.length; i++) {
    const e = cp.buffer[i]!;
    f.buffer.push({ bit: e.bit, dir: e.dir, pressedTick: e.pressedTick });
  }
}

/**
 * Single-source-of-truth local fighter predictor (MASTER_DESIGN 7.3.6).
 * Shared by the browser client and the headless netsim harness so client prediction
 * always runs the exact same deterministic fighter controller against synced terrain.
 */
export class ClientPredictor {
  public readonly world: SimWorld;
  public readonly fighter: FighterRuntime;
  public readonly controller: PredictionController;
  public readonly localSlot: number;
  public readonly matchEpoch: number;
  private readonly checkpoints: FighterCheckpoint[];
  private lastAuthStocks: number;
  private lastAuthState: FighterState;
  private lastAuthDamage: number;
  private lastAuthGilt: number;
  private lastAuthGadget: number;
  private lastAuthAmmo: number;
  private lastAuthWasCombat = false;
  private hasFirstAck = false;

  public constructor(matchConfig: MatchConfig, localSlot: number, matchEpoch = 0) {
    this.localSlot = localSlot;
    this.matchEpoch = matchEpoch & 0xffff;
    this.world = new SimWorld(matchConfig);
    const f = this.world.fighters.find((x) => x.slot === localSlot);
    assert(f !== undefined, ErrorCode.IndexOutOfBounds, `ClientPredictor slot ${localSlot} missing from matchConfig`);
    this.fighter = f;
    this.controller = new PredictionController();
    const histCap = this.fighter.history.masks.length;
    this.checkpoints = Array.from({ length: CHECKPOINT_RING_SIZE }, () => createEmptyCheckpoint(histCap));
    this.lastAuthStocks = this.fighter.stocks;
    this.lastAuthState = this.fighter.state;
    this.lastAuthDamage = this.fighter.damage;
    this.lastAuthGilt = this.fighter.gilt;
    this.lastAuthGadget = this.fighter.heldGadget;
    this.lastAuthAmmo = this.fighter.heldGadgetAmmo;
  }

  public predictTick(inputTick: number, mask: number, sentAtMs = -1): InputPacket {
    this.world.stepSingleFighterForPrediction(this.localSlot, mask, inputTick);
    writeCheckpoint(this.checkpoints[inputTick & CHECKPOINT_RING_MASK]!, inputTick, this.fighter);
    this.controller.recordPredictedState(inputTick, this.fighter.x, this.fighter.y);
    this.controller.stepVisualOffset();
    return this.controller.recordInput(inputTick, mask, sentAtMs, this.matchEpoch);
  }

  public observeAckOneWayMs(snap: SnapshotData, arrivalMs: number): number {
    if ((snap.epoch & 0xffff) !== this.matchEpoch) return this.controller.getOneWayMs();
    const la =
      this.localSlot >= 0 && this.localSlot < snap.lastAppliedInputTicks.length
        ? snap.lastAppliedInputTicks[this.localSlot]!
        : -1;
    return this.controller.observeAckOneWayMs(la, arrivalMs);
  }

  public applyReliableEvents(events: readonly SimEvent[]): void {
    let ledgesDirty = false;
    for (const ev of events) {
      if (ev.kind === SimEventKind.ChunkState) {
        const ch = this.world.island.chunks[ev.a];
        if (ch && ch.state !== (ev.b as ChunkState)) {
          ch.state = ev.b as ChunkState;
          ledgesDirty = true;
        }
      }
    }
    if (ledgesDirty) recomputeLedges(this.world.island);
  }

  public reconcileSnapshot(snap: SnapshotData): ReconcileResult | null {
    if ((snap.epoch & 0xffff) !== this.matchEpoch) return null;
    if (snap.tick <= this.controller.getLastSnapshotTick()) return null;
    this.controller.setLastSnapshotTick(snap.tick);
    if (snap.hasWorld) {
      let ledgesDirty = false;
      for (const sc of snap.chunks) {
        const ch = this.world.island.chunks[sc.index];
        if (ch) {
          if (ch.state !== sc.state || ch.x !== sc.x || ch.y !== sc.y || ch.angle !== sc.angle) {
            ledgesDirty = true;
          }
          ch.x = sc.x;
          ch.y = sc.y;
          ch.angle = sc.angle;
          ch.vx = sc.vx;
          ch.vy = sc.vy;
          ch.state = sc.state;
          ch.resting = sc.resting;
        }
      }
      if (ledgesDirty) recomputeLedges(this.world.island);
    }

    for (const sf of snap.fighters) {
      if (sf.slot === this.localSlot) continue;
      const rf = this.world.fighters.find((f) => f.slot === sf.slot);
      if (rf !== undefined) applySnapshotFighter(sf, rf);
    }

    const authSelf = snap.fighters.find((f) => f.slot === this.localSlot);
    if (authSelf === undefined) return null;

    const lastApplied =
      this.localSlot >= 0 && this.localSlot < snap.lastAppliedInputTicks.length
        ? snap.lastAppliedInputTicks[this.localSlot]!
        : -1;

    if (lastApplied < 0) return null;

    const isFirstAck = !this.hasFirstAck;
    this.hasFirstAck = true;
    const isHostTeleport =
      isFirstAck ||
      authSelf.stocks < this.lastAuthStocks ||
      (authSelf.state === FighterState.Respawn && this.lastAuthState !== FighterState.Respawn) ||
      (authSelf.state === FighterState.Teaspoon && this.lastAuthState !== FighterState.Teaspoon);
    const selfStats = getFighterSpec(this.fighter.id).stats;
    const maxNormalVx = Math.max(selfStats.dash, selfStats.run, selfStats.airSpeed) + 0.5;
    const hasResidualKb =
      Math.abs(authSelf.vx) > maxNormalVx ||
      ((authSelf.flags & FighterFlag.Grounded) !== 0 && Math.abs(authSelf.vy) > 0.5);
    const landedHostHit = authSelf.gilt > this.lastAuthGilt;
    const isCombatState =
      authSelf.hitstopFrames > 0 ||
      hasResidualKb ||
      landedHostHit ||
      authSelf.state === FighterState.Hitstun ||
      authSelf.state === FighterState.Tumble ||
      authSelf.state === FighterState.Held ||
      authSelf.state === FighterState.Grabbing ||
      authSelf.state === FighterState.GuardStun ||
      authSelf.state === FighterState.GuardBreak ||
      authSelf.state === FighterState.ParryStun ||
      authSelf.damage > this.lastAuthDamage ||
      authSelf.heldGadget !== this.lastAuthGadget ||
      authSelf.heldGadgetAmmo !== this.lastAuthAmmo ||
      (authSelf.flags & (FighterFlag.Rooted | FighterFlag.Slippery)) !== 0;
    const context = isHostTeleport
      ? ReconcileContext.HostTeleport
      : isCombatState || this.lastAuthWasCombat
        ? ReconcileContext.HostCombatEvent
        : ReconcileContext.Normal;
    this.lastAuthStocks = authSelf.stocks;
    this.lastAuthState = authSelf.state;
    this.lastAuthDamage = authSelf.damage;
    this.lastAuthGilt = authSelf.gilt;
    this.lastAuthGadget = authSelf.heldGadget;
    this.lastAuthAmmo = authSelf.heldGadgetAmmo;
    this.lastAuthWasCombat = isCombatState;

    const baseCp = this.checkpoints[lastApplied & CHECKPOINT_RING_MASK]!;
    const matchedBaseCp = baseCp.tick === lastApplied ? baseCp : null;

    let firstStep = true;
    const res = this.controller.reconcile(
      authSelf,
      lastApplied,
      { x: this.fighter.x, y: this.fighter.y },
      (state, mask, tick) => {
        if (firstStep) {
          firstStep = false;
          if (matchedBaseCp !== null && !isHostTeleport) restoreCheckpoint(matchedBaseCp, this.fighter);
          applySnapshotFighter(state, this.fighter);
          if (landedHostHit) {
            this.fighter.chaseDodgeWindow = CHASE_DODGE_WINDOW_FRAMES;
            if (this.fighter.state === FighterState.Attack) {
              this.fighter.moveHitConnected = true;
              this.fighter.moveHitLanded = true;
            }
          }
        }
        this.world.stepSingleFighterForPrediction(this.localSlot, mask, tick);
        writeCheckpoint(this.checkpoints[tick & CHECKPOINT_RING_MASK]!, tick, this.fighter);
        return fighterToSnapshot(this.fighter);
      },
      context,
    );

    if (firstStep) {
      if (matchedBaseCp !== null && !isHostTeleport) restoreCheckpoint(matchedBaseCp, this.fighter);
      applySnapshotFighter(res.state, this.fighter);
      if (landedHostHit) {
        this.fighter.chaseDodgeWindow = CHASE_DODGE_WINDOW_FRAMES;
        if (this.fighter.state === FighterState.Attack) {
          this.fighter.moveHitConnected = true;
          this.fighter.moveHitLanded = true;
        }
      }
    }
    return res;
  }

  public getVisualOffset(): { readonly x: number; readonly y: number } {
    return this.controller.getVisualOffset();
  }

  public getPredictionErrorP95(): number {
    return this.controller.getPredictionErrorP95();
  }

  public getLargeCorrectionCount(): number {
    return this.controller.getLargeCorrectionCount();
  }

  public getHostCombatSnapCount(): number {
    return this.controller.getHostCombatSnapCount();
  }

  public dispose(): void {
    this.world.dispose();
  }
}
