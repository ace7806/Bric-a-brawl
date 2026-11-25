import RAPIER from '@dimforge/rapier2d-deterministic-compat';
import { assert, assertFinite, requireAt, requireDefined } from './assert';
import {
  applyLaunchSteering,
  computeBlockstun,
  computeHitstun,
  getMoveHitbox,
  resolveStrike,
} from './combat';
import { getArenaSpec, getGameData, getMoveSpec } from './data';
import {
  ChunkState,
  CrackSource,
  ErrorCode,
  FighterFlag,
  FighterId,
  FighterState,
  GadgetId,
  HitOutcome,
  InputBit,
  KoCause,
  MatchMode,
  MoveClass,
  MoveId,
  SimEventKind,
  TeamId,
} from './enums';
import {
  createFighter,
  getEffectiveStartup,
  getEffectiveStats,
  stepFighter,
  stepFighterGadgetAction,
  stepFighterSpecialProjectiles,
  type FighterStepContext,
} from './fighter';
import { FIGHTER_KITS } from './fighter-kits';
import { resetFighterLife } from './fighter-state';
import {
  createGadgetSystem,
  cutPlungerStringsInBox,
  dropHeldGadget,
  stepGadgetSpawns,
  stepProjectilesAndHazards,
  type GadgetSystemState,
} from './gadgets';
import { decodeInputDir, dirToUnitVector } from './input';
import {
  createIsland,
  damageChunk,
  findChunkUnderPoint,
  stepIsland,
  type RapierApi,
} from './island';
import { SeededRng } from './prng';
import type {
  FighterRuntime,
  IslandState,
  MatchConfig,
  PendingHitRecord,
  RoundResult,
  SimEvent,
} from './types';

const DEG_TO_RAD = Math.PI / 180;
const COLLISION_GROUP_FIGHTER = (0x0010 << 16) | 0x0001;

let rapierReady = false;

export async function initPhysics(): Promise<void> {
  if (rapierReady) return;
  await RAPIER.init();
  rapierReady = true;
}

export interface SlotLatency {
  readonly rewindTicks: number;
  readonly graceTicks: number;
}

export class SimWorld {
  public readonly config: MatchConfig;
  public readonly rng: SeededRng;
  public readonly island: IslandState;
  public readonly gadgets: GadgetSystemState;
  public readonly fighters: FighterRuntime[];
  public tick = 0;

  private readonly rapier: RapierApi;
  private readonly rapierWorld: RAPIER.World;
  private readonly koOrder: {
    readonly tick: number;
    readonly victimSlot: number;
    readonly killerSlot: number;
    readonly cause: KoCause;
    readonly moveId: MoveId;
    readonly gadgetId: GadgetId;
  }[] = [];
  private roundResult: RoundResult | null = null;
  private lastVictimSlot = -1;
  private disposed = false;
  private readonly pendingEvents: SimEvent[] = [];

  public constructor(config: MatchConfig) {
    assert(rapierReady, ErrorCode.PhysicsNotInitialized, 'initPhysics() must be awaited before constructing SimWorld');
    assert(config.fighters.length >= 1 && config.fighters.length <= 8, ErrorCode.InvariantViolation, `Invalid fighter count: ${config.fighters.length}`);

    const { tuning } = getGameData();
    const arena = getArenaSpec(config.arenaId);
    const defaultStocks = config.fighters.length <= 4 ? tuning.match.stocks2to4 : tuning.match.stocks5to8;
    const stocks = config.stocksOverride ?? defaultStocks;

    this.config = config;
    this.rng = new SeededRng(config.seed);
    this.rapier = RAPIER;
    this.rapierWorld = new RAPIER.World({ x: 0, y: -tuning.gravity });
    this.rapierWorld.timestep = 1 / tuning.tickRate;

    this.island = createIsland(this.rapier, this.rapierWorld, config.arenaId, config.fighters.length, config.fragile);
    this.gadgets = createGadgetSystem(this.rng, config.enableTierB ?? true, config.enableTierC ?? true);

    this.fighters = config.fighters.map((fc, idx) => {
      const spawn = requireAt(arena.spawns, idx % arena.spawns.length, 'arena.spawns');
      const f = createFighter(fc.slot, fc.id, fc.team, spawn[0], spawn[1], stocks, 0);
      const st = getEffectiveStats(f);
      const radius = Math.min(st.width, st.height) * 0.45;
      const hh = Math.max(0.05, st.height * 0.5 - radius);
      const body = this.rapierWorld.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(f.x, f.y + st.height * 0.5),
      );
      const col = this.rapierWorld.createCollider(
        RAPIER.ColliderDesc.capsule(hh, radius).setCollisionGroups(COLLISION_GROUP_FIGHTER),
        body,
      );
      f.bodyHandle = body.handle;
      f.colliderHandle = col.handle;
      return f;
    });
  }

  public isFinished(): boolean {
    return this.roundResult !== null;
  }

  public getRoundResult(): RoundResult | null {
    return this.roundResult;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.rapierWorld.free();
  }

  private getSlotMask(inputs: ReadonlyMap<number, number> | readonly number[], slot: number): number {
    if (inputs instanceof Map || ('get' in inputs && typeof inputs.get === 'function')) {
      const val = (inputs as ReadonlyMap<number, number>).get(slot);
      assert(val !== undefined, ErrorCode.MissingRequiredEntry, `Missing input for slot ${slot}`);
      return val;
    }
    const arr = inputs as readonly number[];
    return requireAt(arr, slot, 'inputsBySlot');
  }

  private applyPendingHitLaunch(attacker: FighterRuntime, defender: FighterRuntime, rec: PendingHitRecord, events: SimEvent[]): void {
    const { tuning } = getGameData();
    const defStats = getEffectiveStats(defender);
    const atkStats = getEffectiveStats(attacker);
    const move = getMoveSpec(attacker.id, rec.moveId);

    defender.damage += rec.damage;
    defender.gilt = Math.min(tuning.gilt.max, defender.gilt + rec.damage * tuning.gilt.gainPerPercentTaken);
    defender.comboCount++;
    const prevMoveHits = defender.comboHitsByMove.get(rec.moveId);
    const nextMoveHits = (prevMoveHits === undefined ? 0 : prevMoveHits) + 1;
    defender.comboHitsByMove.set(rec.moveId, nextMoveHits);

    const launchSpd = Math.hypot(rec.launchX, rec.launchY);
    const steerableDeg = applyLaunchSteering(rec.angle, rec.attackerFacing > 0, decodeInputDir(defender.lastInputMask));
    const rad = steerableDeg * DEG_TO_RAD;
    defender.kbVx = Math.cos(rad) * launchSpd;
    defender.kbVy = Math.sin(rad) * launchSpd;
    defender.vx = 0;
    defender.vy = 0;
    defender.hitstunFrames = computeHitstun(launchSpd, defender.comboCount, nextMoveHits - 1);
    defender.lastHitBySlot = attacker.slot;
    defender.lastHitByMove = rec.moveId;
    defender.lastHitByGadget = GadgetId.None;
    defender.lastHitTick = this.tick;
    defender.flags &= ~FighterFlag.Grounded;

    if (launchSpd >= tuning.launch.tumbleSpeed) {
      defender.state = FighterState.Tumble;
      if (getGameData().gadgetRules.dropOnTumble) {
        dropHeldGadget(this.gadgets, defender, rec.launchX, this.tick, events);
      }
      if (defender.pipingCharged) {
        defender.pipingCharged = false;
        defender.flags &= ~FighterFlag.Piping;
      }
    } else {
      defender.state = FighterState.Hitstun;
    }
    defender.stateFrame = 0;

    const bonusCrackHook = FIGHTER_KITS[attacker.id].handlesBonusCrackOnLanding;
    const handledInFighterStep = bonusCrackHook !== undefined ? bonusCrackHook(rec.moveId) : false;
    if (move.bonusCrack > 0 && !handledInFighterStep) {
      const ci = findChunkUnderPoint(this.island, defender.x, defender.y);
      if (ci >= 0) {
        damageChunk(this.rapier, this.rapierWorld, this.island, ci, move.bonusCrack * atkStats.crackMult, CrackSource.Move, this.config.fragile, this.tick, this.rng, events);
      }
    }
    void defStats;
    events.push({ tick: this.tick, kind: SimEventKind.Hit, a: attacker.slot, b: defender.slot, c: Math.round(rec.damage * 10), d: rec.moveId });
    events.push({ tick: this.tick, kind: SimEventKind.Launch, a: attacker.slot, b: defender.slot, c: Math.round(launchSpd * 8), d: rec.moveId });
  }

  public applyDefenderGrace(defenderSlot: number, inputMask: number, defenderPressTick: number): boolean {
    const defender = this.fighters.find((f) => f.slot === defenderSlot);
    if (!defender || defender.pendingHit === null) return false;
    const rec = defender.pendingHit;
    const { tuning } = getGameData();
    if (this.tick - rec.tick > tuning.net.defenderGraceMaxTicks && defender.hitstopFrames <= 0) return false;
    if (defenderPressTick > this.tick) return false;

    const attacker = this.fighters.find((f) => f.slot === rec.attackerSlot);
    if (!attacker) return false;

    const hasGuard = (inputMask & InputBit.Guard) !== 0;
    const dir = decodeInputDir(inputMask);
    if (!hasGuard) return false;

    defender.pendingHit = null;
    const grounded = (defender.flags & FighterFlag.Grounded) !== 0;

    // Dodge roll / spot dodge / air dodge
    if (dir !== 0 && grounded) {
      const vec = dirToUnitVector(dir);
      defender.state = Math.abs(vec.x) > 0.2 ? FighterState.Roll : FighterState.SpotDodge;
      defender.stateFrame = 0;
      defender.hitstopFrames = 0;
      defender.flags |= FighterFlag.Invuln;
      defender.invulnFrames = 10;
      return true;
    }

    if (!rec.isGrab && defender.parryCooldown === 0) {
      defender.state = FighterState.Parry;
      defender.stateFrame = 0;
      defender.hitstopFrames = 0;
      defender.gilt = Math.min(tuning.gilt.max, defender.gilt + tuning.parry.giltGain);
      attacker.state = FighterState.ParryStun;
      attacker.stateFrame = 0;
      attacker.activeMove = MoveId.None;
      this.pendingEvents.push({
        tick: this.tick,
        kind: SimEventKind.Parry,
        a: defender.slot,
        b: attacker.slot,
        c: tuning.parry.giltGain,
        d: rec.moveId,
      });
      return true;
    }

    if (!rec.isGrab) {
      defender.state = FighterState.GuardStun;
      defender.stateFrame = 0;
      defender.blockstunFrames = computeBlockstun(rec.damage);
      const mult = rec.isHeavy ? tuning.guard.heavyGuardDamageMult : tuning.guard.guardDamageMult;
      defender.guardHp = Math.max(0, defender.guardHp - rec.damage * mult);
      this.pendingEvents.push({
        tick: this.tick,
        kind: SimEventKind.Block,
        a: attacker.slot,
        b: defender.slot,
        c: Math.round(rec.damage * 10),
        d: rec.moveId,
      });
      return true;
    }

    return false;
  }

  private resolveMeleeAndGrabs(
    latencyBySlot: readonly SlotLatency[] | undefined,
    events: SimEvent[],
  ): void {
    const { tuning } = getGameData();
    const activeAttackers: { f: FighterRuntime; move: ReturnType<typeof getMoveSpec> }[] = [];

    for (const f of this.fighters) {
      if (f.state !== FighterState.Attack || f.activeMove === MoveId.None || f.hitstopFrames > 0) continue;
      if (f.id === FighterId.Grog && f.activeMove === MoveId.Sspec) continue;
      const move = getMoveSpec(f.id, f.activeMove);
      const startup = getEffectiveStartup(f, move, f.moveIsClean);
      if (f.moveFrame < startup || f.moveFrame >= startup + move.active) continue;
      activeAttackers.push({ f, move });

      const hb = getMoveHitbox(f, move);
      cutPlungerStringsInBox(this.gadgets, hb.x0 - hb.radius, hb.y0 - hb.radius, hb.x1 + hb.radius, hb.y1 + hb.radius, this.fighters);
    }

    // Grab vs Grab tech (GDD 3.5.5)
    for (let i = 0; i < activeAttackers.length; i++) {
      const a = activeAttackers[i]!;
      if (a.move.moveClass !== MoveClass.Grab) continue;
      for (let j = i + 1; j < activeAttackers.length; j++) {
        const b = activeAttackers[j]!;
        if (b.move.moveClass !== MoveClass.Grab) continue;
        if (Math.abs(a.f.x - b.f.x) <= getEffectiveStats(a.f).grabRange + getEffectiveStats(b.f).grabRange) {
          a.f.activeMove = MoveId.None;
          b.f.activeMove = MoveId.None;
          a.f.state = FighterState.Idle;
          b.f.state = FighterState.Idle;
          const dir = a.f.x <= b.f.x ? -1 : 1;
          a.f.kbVx = dir * 10;
          b.f.kbVx = -dir * 10;
          events.push({ tick: this.tick, kind: SimEventKind.Grab, a: a.f.slot, b: b.f.slot, c: 1, d: 0 });
        }
      }
    }

    for (const { f: attacker, move } of activeAttackers) {
      if (attacker.activeMove === MoveId.None) continue;
      const atkLat = latencyBySlot !== undefined && attacker.slot < latencyBySlot.length ? latencyBySlot[attacker.slot] : undefined;
      const atkRewind = atkLat !== undefined ? atkLat.rewindTicks : 0;

      for (const defender of this.fighters) {
        if (defender.slot === attacker.slot) continue;
        if (this.config.mode === MatchMode.Teams && attacker.team !== TeamId.None && attacker.team === defender.team) continue;
        if (attacker.moveHitIds.includes(defender.slot)) continue;

        const defLat = latencyBySlot !== undefined && defender.slot < latencyBySlot.length ? latencyBySlot[defender.slot] : undefined;
        const defGrace = defLat !== undefined ? defLat.graceTicks : 0;
        const chargeMult =
          move.moveClass === MoveClass.Heavy
            ? 1 + (Math.min(tuning.input.smashChargeMaxFrames, attacker.heavyChargeFrames) / tuning.input.smashChargeMaxFrames) * (tuning.input.smashChargeMaxMult - 1)
            : 1.0;

        const res = resolveStrike(attacker, defender, move, chargeMult, attacker.pipingCharged, attacker.moveIsClean, atkRewind, defGrace);
        if (res.outcome === HitOutcome.Miss || res.outcome === HitOutcome.Invuln) continue;

        attacker.moveHitIds.push(defender.slot);
        attacker.moveHitConnected = true;

        if (res.outcome === HitOutcome.Parry) {
          defender.gilt = Math.min(tuning.gilt.max, defender.gilt + tuning.parry.giltGain);
          defender.state = FighterState.Parry;
          defender.stateFrame = 0;
          attacker.state = FighterState.ParryStun;
          attacker.stateFrame = 0;
          attacker.activeMove = MoveId.None;
          events.push({ tick: this.tick, kind: SimEventKind.Parry, a: defender.slot, b: attacker.slot, c: tuning.parry.giltGain, d: move.id });
          continue;
        }

        if (res.outcome === HitOutcome.Block) {
          const mult = move.moveClass === MoveClass.Heavy ? tuning.guard.heavyGuardDamageMult : tuning.guard.guardDamageMult;
          defender.guardHp = Math.max(0, defender.guardHp - res.damage * mult);
          defender.state = FighterState.GuardStun;
          defender.stateFrame = 0;
          defender.blockstunFrames = res.blockstun;
          const pushDir = attacker.x <= defender.x ? 1 : -1;
          defender.kbVx = pushDir * res.pushbackSpeed;
          attacker.hitstopFrames = res.hitstop;
          defender.hitstopFrames = res.hitstop;
          events.push({ tick: this.tick, kind: SimEventKind.Block, a: attacker.slot, b: defender.slot, c: Math.round(res.damage * 10), d: move.id });
          continue;
        }

        if (res.outcome === HitOutcome.Armour) {
          defender.damage += res.damage;
          attacker.hitstopFrames = res.hitstop;
          defender.hitstopFrames = res.hitstop;
          events.push({ tick: this.tick, kind: SimEventKind.Hit, a: attacker.slot, b: defender.slot, c: Math.round(res.damage * 10), d: move.id });
          continue;
        }

        if (move.moveClass === MoveClass.Grab) {
          if (defender.regrabImmunity > 0 || defender.state === FighterState.Held) continue;
          attacker.state = FighterState.Grabbing;
          attacker.stateFrame = 0;
          attacker.grabbingSlot = defender.slot;
          attacker.activeMove = MoveId.None;
          defender.state = FighterState.Held;
          defender.stateFrame = 0;
          defender.grabbedBySlot = attacker.slot;
          defender.grabHoldFrames = Math.min(tuning.grab.holdMaxFrames, Math.round(tuning.grab.holdBaseFrames + tuning.grab.holdPerPercent * defender.damage));
          events.push({ tick: this.tick, kind: SimEventKind.Grab, a: attacker.slot, b: defender.slot, c: 0, d: move.id });
          break;
        }

        // Hit outcome: defer launch until hitstop/grace expires if defender grace > 0, else apply immediately after hitstop
        const rad = res.launchAngleDeg * DEG_TO_RAD;
        const facing = (attacker.flags & FighterFlag.FacingRight) !== 0 ? 1 : -1;
        attacker.hitstopFrames = res.hitstop;
        defender.hitstopFrames = res.hitstop;
        const rec: PendingHitRecord = {
          tick: this.tick,
          attackerSlot: attacker.slot,
          defenderSlot: defender.slot,
          moveId: move.id,
          damage: res.damage,
          bkb: move.bkb,
          kbg: move.kbg,
          angle: move.angle,
          isHeavy: move.moveClass === MoveClass.Heavy,
          isGrab: false,
          launchX: Math.cos(rad) * res.launchSpeed,
          launchY: Math.sin(rad) * res.launchSpeed,
          attackerFacing: facing,
          resolvedTick: this.tick + Math.max(defGrace, res.hitstop),
        };
        if (defGrace > 0) {
          defender.pendingHit = rec;
        } else {
          this.applyPendingHitLaunch(attacker, defender, rec, events);
        }
      }
    }

    // Flush pending hits whose grace window / hitstop elapsed
    for (const defender of this.fighters) {
      const rec = defender.pendingHit;
      if (rec && this.tick > rec.resolvedTick) {
        defender.pendingHit = null;
        const attacker = this.fighters.find((f) => f.slot === rec.attackerSlot);
        if (attacker) this.applyPendingHitLaunch(attacker, defender, rec, events);
      }
    }
  }

  private checkBlastZonesAndWin(events: SimEvent[]): void {
    const { tuning } = getGameData();
    const arena = getArenaSpec(this.config.arenaId);
    const bz = arena.blastZone;

    for (const f of this.fighters) {
      if (f.state === FighterState.Eliminated || f.state === FighterState.Teaspoon || f.state === FighterState.Respawn) continue;
      if (f.x >= bz.left && f.x <= bz.right && f.y >= bz.bottom && f.y <= bz.top) continue;

      const recentHit = this.tick - f.lastHitTick <= 600;
      const recentAttacker = recentHit ? f.lastHitBySlot : -1;
      const recentGadget = recentHit ? f.lastHitByGadget : GadgetId.None;
      const cause: KoCause =
        recentGadget !== GadgetId.None ? KoCause.Gadget : recentAttacker >= 0 ? KoCause.FighterMove : KoCause.SelfDestruct;

      if (this.config.mode !== MatchMode.Practice) {
        f.stocks = Math.max(0, f.stocks - 1);
      }
      this.lastVictimSlot = f.slot;
      this.koOrder.push({
        tick: this.tick,
        victimSlot: f.slot,
        killerSlot: recentAttacker,
        cause,
        moveId: recentHit ? f.lastHitByMove : MoveId.None,
        gadgetId: recentGadget,
      });
      events.push({ tick: this.tick, kind: SimEventKind.Ko, a: f.slot, b: recentAttacker, c: cause, d: f.stocks });

      if (f.stocks > 0) {
        const spawn = requireAt(arena.spawns, f.slot % arena.spawns.length, 'arena.spawns');
        let spawnX = spawn[0];
        let spawnY = spawn[1];
        // Pick a standing chunk closest to the fighter's spawn so respawns never drop into vanished rim gaps
        let bestDist = Infinity;
        for (let pass = 0; pass < 2 && !Number.isFinite(bestDist); pass++) {
          for (let ci = 0; ci < this.island.chunks.length; ci++) {
            const ch = this.island.chunks[ci]!;
            const ok = pass === 0
              ? ch.state === ChunkState.Intact || ch.state === ChunkState.Crazed
              : ch.state === ChunkState.Loose;
            if (!ok) continue;
            const sp = arena.chunks[ci]!;
            const midX = (sp.topX0 + sp.topX1) * 0.5;
            const d = Math.abs(midX - spawn[0]);
            if (d < bestDist) {
              bestDist = d;
              spawnX = midX;
              spawnY = Math.max(sp.topY0, sp.topY1);
            }
          }
        }
        const respawnDmg = this.island.suddenDeathActive ? tuning.match.suddenDeathPercent : 0;
        resetFighterLife(f, spawnX, spawnY + 2.5, f.stocks, respawnDmg);
        f.gilt = Math.min(tuning.gilt.max, f.gilt + tuning.gilt.gainOnStockLost);
        f.invulnFrames = tuning.match.respawnInvulnFrames;
        f.flags |= FighterFlag.Invuln;
        f.state = FighterState.Respawn;
        events.push({ tick: this.tick, kind: SimEventKind.Respawn, a: f.slot, b: f.stocks, c: 0, d: 0 });
      } else {
        f.state = FighterState.Teaspoon;
        f.stateFrame = 0;
        f.teaspoonX = Math.max(arena.cameraBounds.minX, Math.min(arena.cameraBounds.maxX, f.x));
        f.teaspoonCooldown = 0;
        f.heldGadget = GadgetId.None;
        f.pendingHit = null;
        f.buffer.length = 0;
        f.vx = 0;
        f.vy = 0;
      }
    }

    if (this.config.mode === MatchMode.Practice || this.roundResult !== null) return;

    const alive = this.fighters.filter((f) => f.stocks > 0);
    if (this.config.mode === MatchMode.Teams) {
      const teamsAlive = new Set(alive.map((f) => f.team));
      if (teamsAlive.size <= 1) {
        const firstAlive = alive[0];
        const winTeam = firstAlive !== undefined ? firstAlive.team : TeamId.None;
        const winSlot = firstAlive !== undefined ? firstAlive.slot : -1;
        this.roundResult = {
          winnerSlot: winSlot,
          winnerTeam: winTeam,
          endTick: this.tick,
          endedBySuddenDeath: this.island.suddenDeathActive,
          endedByHardEnd: false,
          koOrder: this.koOrder,
        };
        events.push({ tick: this.tick, kind: SimEventKind.RoundEnd, a: this.roundResult.winnerSlot, b: winTeam, c: 0, d: 0 });
      }
    } else if (alive.length <= 1 && this.fighters.length > 1) {
      const winner = alive[0];
      const winSlot = winner !== undefined ? winner.slot : this.lastVictimSlot;
      this.roundResult = {
        winnerSlot: winSlot,
        winnerTeam: TeamId.None,
        endTick: this.tick,
        endedBySuddenDeath: this.island.suddenDeathActive,
        endedByHardEnd: false,
        koOrder: this.koOrder,
      };
      events.push({ tick: this.tick, kind: SimEventKind.RoundEnd, a: this.roundResult.winnerSlot, b: TeamId.None, c: 0, d: 0 });
    }

    const hardEndTick = Math.round(tuning.match.hardEndSeconds * tuning.tickRate);
    if (this.roundResult === null && this.tick >= hardEndTick) {
      const sorted = [...this.fighters].sort((a, b) => {
        if (a.stocks !== b.stocks) return b.stocks - a.stocks;
        if (a.damage !== b.damage) return a.damage - b.damage;
        if (a.slot === this.lastVictimSlot) return -1;
        if (b.slot === this.lastVictimSlot) return 1;
        return a.slot - b.slot;
      });
      const w = requireDefined(sorted[0], 'hardEnd.winner');
      this.roundResult = {
        winnerSlot: w.slot,
        winnerTeam: w.team,
        endTick: this.tick,
        endedBySuddenDeath: this.island.suddenDeathActive,
        endedByHardEnd: true,
        koOrder: this.koOrder,
      };
      events.push({ tick: this.tick, kind: SimEventKind.RoundEnd, a: w.slot, b: w.team, c: 1, d: 0 });
    }
  }

  public stepSingleFighterForPrediction(slot: number, mask: number, inputTick: number): void {
    assert(!this.disposed, ErrorCode.InvariantViolation, 'Cannot step disposed SimWorld');
    const fighter = this.fighters.find((f) => f.slot === slot);
    assert(fighter !== undefined, ErrorCode.IndexOutOfBounds, `Prediction fighter slot ${slot} not found`);
    if (fighter.state === FighterState.Held && fighter.grabbedBySlot < 0) {
      const dt = 1 / getGameData().tuning.tickRate;
      fighter.x += fighter.vx * dt;
      fighter.y += fighter.vy * dt;
      fighter.stateFrame++;
      return;
    }
    const events: SimEvent[] = [];
    const ctx: FighterStepContext = {
      tick: inputTick,
      mode: this.config.mode,
      fragile: this.config.fragile,
      island: this.island,
      fighters: this.fighters,
      gadgets: this.gadgets,
      rng: this.rng,
      rapier: this.rapier,
      rapierWorld: this.rapierWorld,
      events,
    };
    stepFighter(fighter, mask, inputTick, ctx);
  }

  public step(
    inputsBySlot: ReadonlyMap<number, number> | readonly number[],
    latencyBySlot?: readonly SlotLatency[],
  ): readonly SimEvent[] {
    assert(!this.disposed, ErrorCode.InvariantViolation, 'Cannot step disposed SimWorld');
    this.tick++;
    const events: SimEvent[] = [];
    if (this.pendingEvents.length > 0) {
      events.push(...this.pendingEvents);
      this.pendingEvents.length = 0;
    }

    stepIsland(this.rapier, this.rapierWorld, this.island, this.fighters, this.tick, this.rng, events);

    const ctx: FighterStepContext = {
      tick: this.tick,
      mode: this.config.mode,
      fragile: this.config.fragile,
      island: this.island,
      fighters: this.fighters,
      gadgets: this.gadgets,
      rng: this.rng,
      rapier: this.rapier,
      rapierWorld: this.rapierWorld,
      events,
      tryGrace: (f, m, it) => this.applyDefenderGrace(f.slot, m, it),
    };

    for (const f of this.fighters) {
      const mask = this.getSlotMask(inputsBySlot, f.slot);
      stepFighter(f, mask, this.tick, ctx);
    }
    if (this.pendingEvents.length > 0) {
      events.push(...this.pendingEvents);
      this.pendingEvents.length = 0;
    }

    for (const f of this.fighters) {
      const mask = this.getSlotMask(inputsBySlot, f.slot);
      stepFighterGadgetAction(f, mask, ctx);
    }

    stepGadgetSpawns(this.gadgets, this.island, this.fighters, this.tick, this.rng, events);
    stepProjectilesAndHazards(this.gadgets, this.island, this.fighters, this.tick, this.rng, events);
    stepFighterSpecialProjectiles(ctx);
    this.resolveMeleeAndGrabs(latencyBySlot, events);
    this.checkBlastZonesAndWin(events);

    this.rapierWorld.step();
    return events;
  }

  public computeStateHash(): string {
    let h = 0x811c9dc5;
    const mix = (v: number): void => {
      assertFinite(v, 'hashValue');
      const iv = Math.round(v * 1024) | 0;
      h ^= iv & 0xff;
      h = Math.imul(h, 0x01000193);
      h ^= (iv >>> 8) & 0xff;
      h = Math.imul(h, 0x01000193);
      h ^= (iv >>> 16) & 0xff;
      h = Math.imul(h, 0x01000193);
      h ^= (iv >>> 24) & 0xff;
      h = Math.imul(h, 0x01000193);
    };

    mix(this.tick);
    mix(this.rng.getState());
    for (const f of this.fighters) {
      mix(f.slot);
      mix(f.x);
      mix(f.y);
      mix(f.vx);
      mix(f.vy);
      mix(f.kbVx);
      mix(f.kbVy);
      mix(f.state);
      mix(f.flags);
      mix(f.damage);
      mix(f.gilt);
      mix(f.stocks);
      mix(f.heldGadget);
      mix(f.nestaSize);
    }
    for (const ch of this.island.chunks) {
      mix(ch.state);
      mix(ch.hp);
      mix(ch.x);
      mix(ch.y);
    }
    for (const r of this.island.rubble) {
      mix(r.id);
      mix(r.x);
      mix(r.y);
    }
    for (const g of this.gadgets.worldGadgets) {
      mix(g.id);
      mix(g.state);
      mix(g.x);
      mix(g.y);
    }
    for (const p of this.gadgets.projectiles) {
      mix(p.id);
      mix(p.x);
      mix(p.y);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
}
