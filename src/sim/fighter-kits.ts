import { requireAt, requireDefined, requireKey } from './assert';
import { capsulesOverlap, computeHitstun, computeLaunchSpeed, getMoveHitbox } from './combat';
import { getArenaSpec, getFighterSpec, getGameData, getMoveSpec, type MoveSpec } from './data';
import {
  ALL_GADGET_IDS,
  ChunkState,
  CrackSource,
  FighterFlag,
  FighterId,
  FighterState,
  GadgetId,
  GadgetTier,
  InputBit,
  MatchMode,
  MoveId,
  NestaSize,
  ProjectileKind,
  SimEventKind,
  TeamId,
  WorldGadgetState,
} from './enums';
import {
  DEG_TO_RAD,
  dirHx,
  DT,
  freshBit,
  getEffectiveStartup,
  getEffectiveStats,
  jumpVel,
  transitionState,
  type FighterStepContext,
} from './fighter-state';
import { consumeBuffered, decodeInputDir, dirToUnitVector, hasBit } from './input';
import { damageChunk, findChunkUnderPoint, querySurfaceAt } from './island';
import type { FighterRuntime, ProjectileRuntime } from './types';

const SHELL_TTL = 360;
const SHELL_R = 0.42;

export interface FighterKit {
  readonly onMoveStart?: (f: FighterRuntime, moveId: MoveId, ctx: FighterStepContext) => void;
  readonly onSpecialFrame: (f: FighterRuntime, move: MoveSpec, mask: number, ctx: FighterStepContext) => void;
  readonly onNonSpecialAttackFrame?: (f: FighterRuntime, move: MoveSpec, st: number, ctx: FighterStepContext) => void;
  readonly onAttackLanding?: (f: FighterRuntime, move: MoveSpec, chunkIndex: number, ctx: FighterStepContext) => void;
  readonly handlesBonusCrackOnLanding?: (moveId: MoveId) => boolean;
}

export type ApplyThrowFn = (thrower: FighterRuntime, victim: FighterRuntime, moveId: MoveId, ctx: FighterStepContext) => void;

let applyThrowRef: ApplyThrowFn | null = null;

export function registerThrowHandler(fn: ApplyThrowFn): void {
  applyThrowRef = fn;
}

function spawnProj(ctx: FighterStepContext, proj: ProjectileRuntime): void {
  if (ctx.gadgets.projectiles.length >= 12) {
    const idx = ctx.gadgets.projectiles.findIndex((p) => p.stuckFighterSlot < 0 && p.stuckChunkIndex < 0);
    ctx.gadgets.projectiles.splice(idx >= 0 ? idx : 0, 1);
  }
  ctx.gadgets.projectiles.push(proj);
}

export function performNestaShed(f: FighterRuntime, ctx: FighterStepContext, fromBreak: boolean): boolean {
  if (f.id !== FighterId.Nesta || f.shedsRemaining <= 0) return false;
  f.nestaSize = f.nestaSize === NestaSize.Big ? NestaSize.Mid : NestaSize.Small;
  f.shedsRemaining--;
  const stats = getEffectiveStats(f);
  f.guardHp = stats.guardHP;
  f.invulnFrames = 12;
  f.flags |= FighterFlag.Invuln;
  f.vy = jumpVel(stats.gravityScale, 2.2);
  transitionState(f, FighterState.Airborne);

  if (ctx.island.rubble.length >= getGameData().tuning.terrain.maxRubble) {
    const old = ctx.island.rubble.shift();
    if (old && old.bodyHandle >= 0) {
      const b = ctx.rapierWorld.getRigidBody(old.bodyHandle);
      if (b && b.isValid()) ctx.rapierWorld.removeRigidBody(b);
    }
  }
  const facing = (f.flags & FighterFlag.FacingRight) !== 0 ? 1 : -1;
  const kickVx = !fromBreak && f.moveIsClean ? facing * 14.0 : -facing * 2.0;
  const vy = fromBreak ? 3.5 : 1.5;
  const body = ctx.rapierWorld.createRigidBody(
    ctx.rapier.RigidBodyDesc.dynamic().setTranslation(f.x, f.y + 0.5).setLinvel(kickVx, vy).setLinearDamping(0.05),
  );
  const col = ctx.rapierWorld.createCollider(
    ctx.rapier.ColliderDesc.ball(SHELL_R).setFriction(0.7).setRestitution(0.25).setDensity(2.2),
    body,
  );
  ctx.island.rubble.push({
    id: ctx.island.nextRubbleId++, x: f.x, y: f.y + 0.5, vx: kickVx, vy, angle: 0, radius: SHELL_R,
    resting: false, restSent: false, ownerSlot: f.slot, isShell: true, shellHitsLeft: 3, ttlTicks: SHELL_TTL,
    bodyHandle: body.handle, colliderHandle: col.handle,
  });
  ctx.events.push({
    tick: ctx.tick, kind: SimEventKind.Shed, a: f.slot, b: f.nestaSize, c: f.shedsRemaining,
    d: fromBreak ? 1 : f.moveIsClean ? 2 : 0,
  });
  return true;
}

const earlKit: FighterKit = {
  onMoveStart(f, moveId) {
    if (moveId === MoveId.Sspec && f.pipingCharged) f.flags |= FighterFlag.Armour;
  },
  onSpecialFrame(f, move, mask, ctx) {
    const stats = getEffectiveStats(f);
    const facing = (f.flags & FighterFlag.FacingRight) !== 0 ? 1 : -1;
    const st = getEffectiveStartup(f, move, f.moveIsClean);

    if (move.id === MoveId.Nspec && f.moveFrame === st) {
      const pip = f.pipingCharged;
      f.pipingCharged = false;
      f.flags &= ~FighterFlag.Piping;
      spawnProj(ctx, {
        id: ctx.gadgets.nextId++, kind: ProjectileKind.SteamPuff, ownerSlot: f.slot,
        x: f.x + facing * 0.7, y: f.y + stats.height * 0.55, vx: facing * 7.0, vy: 0, radius: 0.38,
        damage: pip ? 3 : move.damage, bkb: pip ? 18 : move.bkb, kbg: move.kbg, angle: move.angle,
        ttlTicks: 70, gravityScale: 0, reflected: false, stuckFighterSlot: -1, stuckChunkIndex: -1,
        stuckTicks: 0, gadgetId: GadgetId.None, pipingMultiHits: pip ? 3 : 0,
      });
    } else if (move.id === MoveId.Sspec) {
      if (f.moveFrame >= st && f.moveFrame < st + move.active) {
        f.vx = facing * ((f.pipingCharged ? 7.0 : 5.0) / (move.active * DT));
        f.flags = f.pipingCharged && f.moveFrame >= 8 && f.moveFrame <= 21 ? f.flags | FighterFlag.Armour : f.flags & ~FighterFlag.Armour;
      } else {
        f.vx = 0;
        f.flags &= ~FighterFlag.Armour;
        if (f.moveFrame === st + move.active && f.pipingCharged) {
          f.pipingCharged = false;
          f.flags &= ~FighterFlag.Piping;
        }
      }
    } else if (move.id === MoveId.Uspec) {
      f.flags = f.moveIsClean && f.moveFrame >= 3 && f.moveFrame <= 6
        ? f.flags | FighterFlag.Invuln
        : f.invulnFrames <= 0 ? f.flags & ~FighterFlag.Invuln : f.flags;
      if (f.moveFrame === st) {
        f.vy = jumpVel(stats.gravityScale, f.pipingCharged ? 6.2 : 4.6);
        f.flags &= ~FighterFlag.Grounded;
      }
      if (f.moveFrame >= st && f.moveFrame < st + move.active) {
        for (let i = 0; i < ctx.island.chunks.length; i++) {
          const ch = ctx.island.chunks[i]!;
          const sp = getArenaSpec(ctx.island.arenaId).chunks[i]!;
          if (ch.state === ChunkState.Crazed && f.x >= Math.min(sp.topX0, sp.topX1) && f.x <= Math.max(sp.topX0, sp.topX1) && Math.abs(f.y + stats.height - sp.topY0) <= 0.8) {
            damageChunk(ctx.rapier, ctx.rapierWorld, ctx.island, i, ch.hp + 1, CrackSource.Move, ctx.fragile, ctx.tick, ctx.rng, ctx.events);
          }
        }
      }
      if (f.moveFrame >= st + move.active) {
        f.pipingCharged = false;
        f.flags &= ~FighterFlag.Piping;
        transitionState(f, FighterState.Helpless);
      }
    } else if (move.id === MoveId.Dspec) {
      if (hasBit(mask, InputBit.Special)) {
        f.steepChargeFrames++;
        f.moveFrame = Math.min(f.moveFrame, st - 1);
        if (f.steepChargeFrames >= (f.moveIsClean ? 35 : 50)) {
          f.pipingCharged = true;
          f.flags |= FighterFlag.Piping;
          transitionState(f, (f.flags & FighterFlag.Grounded) !== 0 ? FighterState.Idle : FighterState.Airborne);
        }
      } else if (f.steepChargeFrames > 0) {
        f.steepChargeFrames = 0;
        transitionState(f, (f.flags & FighterFlag.Grounded) !== 0 ? FighterState.Idle : FighterState.Airborne);
      }
    }
  },
};

const grogKit: FighterKit = {
  onMoveStart(f, moveId) {
    if (moveId === MoveId.Sspec) {
      f.stampedeCarriedSlot = -1;
      f.stampedeCarryFrames = 0;
    }
  },
  onSpecialFrame(f, move, _mask, ctx) {
    const stats = getEffectiveStats(f);
    const facing = (f.flags & FighterFlag.FacingRight) !== 0 ? 1 : -1;
    const st = getEffectiveStartup(f, move, f.moveIsClean);

    if (move.id === MoveId.Nspec && f.moveFrame === st) {
      const oy = f.y + stats.height * 0.5;
      for (const p of ctx.gadgets.projectiles) if (Math.hypot(p.x - f.x, p.y - oy) <= 3.5 && Math.sign(p.x - f.x) === facing) { p.vx = facing * Math.max(12, Math.abs(p.vx)); p.ownerSlot = f.slot; }
      for (const r of ctx.island.rubble) if (Math.hypot(r.x - f.x, r.y - oy) <= 3.5) { r.vx += facing * 14; r.vy += 3; r.ownerSlot = f.slot; }
      for (const w of ctx.gadgets.worldGadgets) if (Math.hypot(w.x - f.x, w.y - oy) <= 3.5) w.vx += facing * 14;
    } else if (move.id === MoveId.Sspec) {
      if (f.moveFrame >= st && f.moveFrame < st + move.active) {
        f.vx = facing * 11.0;
        f.flags |= FighterFlag.Armour;
        if (f.stampedeCarriedSlot < 0) {
          for (const t of ctx.fighters) {
            if (t.slot !== f.slot && t.stocks > 0 && t.state < FighterState.Respawn && (t.flags & FighterFlag.Invuln) === 0 && t.invulnFrames <= 0 && Math.abs(t.x - (f.x + facing * 0.8)) <= 1.1 && Math.abs(t.y - f.y) <= 1.2) {
              f.stampedeCarriedSlot = t.slot;
              f.stampedeCarryFrames = 0;
              t.grabbedBySlot = f.slot;
              transitionState(t, FighterState.Held);
              t.flags &= ~FighterFlag.Grounded;
              break;
            }
          }
        } else {
          const c = ctx.fighters.find((o) => o.slot === f.stampedeCarriedSlot);
          if (c && c.state === FighterState.Held) {
            c.x = f.x + facing * 0.95;
            c.y = f.y + 0.35;
            if (++f.stampedeCarryFrames >= 40 || f.moveFrame === st + move.active - 1) {
              requireDefined(applyThrowRef, 'grogKit.applyThrowRef')(f, c, MoveId.Sspec, ctx);
              f.stampedeCarriedSlot = -1;
            }
          } else {
            f.stampedeCarriedSlot = -1;
          }
        }
      } else {
        f.flags &= ~FighterFlag.Armour;
        f.vx = 0;
      }
    } else if (move.id === MoveId.Uspec) {
      f.flags = f.moveIsClean && f.moveFrame >= 5 && f.moveFrame <= 8
        ? f.flags | FighterFlag.Invuln
        : f.invulnFrames <= 0 ? f.flags & ~FighterFlag.Invuln : f.flags;
      if (f.moveFrame === st) {
        f.vy = jumpVel(stats.gravityScale, f.moveIsClean ? 4.0 : 3.6);
        f.vx = facing * 7.5;
        f.flags &= ~FighterFlag.Grounded;
      }
      if (f.moveFrame >= st + move.active) {
        transitionState(f, FighterState.Helpless);
      }
    } else if (move.id === MoveId.Dspec) {
      if ((f.flags & FighterFlag.Grounded) === 0 && f.moveFrame >= st) {
        f.vy = -26.0;
        f.vx = 0;
      } else if ((f.flags & FighterFlag.Grounded) !== 0 && f.moveFrame === st) {
        const ci = findChunkUnderPoint(ctx.island, f.x, f.y);
        if (ci >= 0) damageChunk(ctx.rapier, ctx.rapierWorld, ctx.island, ci, 45 * stats.crackMult, CrackSource.Move, ctx.fragile, ctx.tick, ctx.rng, ctx.events);
      }
    }
  },
  onNonSpecialAttackFrame(f, move) {
    if (move.id === MoveId.Dash) {
      f.flags = f.moveFrame >= 8 && f.moveFrame <= 17 ? f.flags | FighterFlag.Armour : f.flags & ~FighterFlag.Armour;
    }
  },
  onAttackLanding(f, move, chunkIndex, ctx) {
    const stats = getEffectiveStats(f);
    if (move.id === MoveId.Dspec && chunkIndex >= 0) {
      damageChunk(ctx.rapier, ctx.rapierWorld, ctx.island, chunkIndex, 45 * stats.crackMult, CrackSource.Move, ctx.fragile, ctx.tick, ctx.rng, ctx.events);
    } else if (chunkIndex >= 0 && (move.id === MoveId.Nair || move.id === MoveId.Dair)) {
      damageChunk(ctx.rapier, ctx.rapierWorld, ctx.island, chunkIndex, (move.id === MoveId.Dair ? 20 : 10) * stats.crackMult, CrackSource.Move, ctx.fragile, ctx.tick, ctx.rng, ctx.events);
    }
  },
  handlesBonusCrackOnLanding(moveId) {
    return moveId === MoveId.Dspec || moveId === MoveId.Nair || moveId === MoveId.Dair;
  },
};

const nestaKit: FighterKit = {
  onMoveStart(f, moveId, ctx) {
    if (moveId === MoveId.Dspec && f.shedsRemaining > 0) performNestaShed(f, ctx, false);
  },
  onSpecialFrame(f, move, mask, ctx) {
    const stats = getEffectiveStats(f);
    const facing = (f.flags & FighterFlag.FacingRight) !== 0 ? 1 : -1;
    const st = getEffectiveStartup(f, move, f.moveIsClean);

    if (move.id === MoveId.Nspec && f.moveFrame >= st && f.moveFrame < st + move.active) {
      f.vx = dirHx(decodeInputDir(mask)) * 5.0;
      if (f.moveFrame < st + 20 && (f.moveFrame - st) % 4 === 0) f.moveHitIds.length = 0;
    } else if (move.id === MoveId.Sspec && f.moveFrame >= st && f.moveFrame < st + move.active) {
      f.vx = facing * 12.0;
      if (f.moveFrame >= 12 && (consumeBuffered(f.buffer, InputBit.Jump, ctx.tick, getGameData().tuning.input.actionBufferFrames) !== null || freshBit(mask, f.prevInputMask, InputBit.Jump))) {
        f.vy = jumpVel(stats.gravityScale, stats.fullHop);
        transitionState(f, FighterState.Airborne);
        return;
      }
      if (f.moveHitConnected && !f.moveIsClean) {
        f.vx = -facing * 6.0;
        f.vy = 5.0;
        f.moveFrame = st + move.active;
        f.stateFrame = f.moveFrame;
      }
    } else if (move.id === MoveId.Uspec) {
      f.flags = f.moveIsClean && f.moveFrame >= 3 && f.moveFrame <= 7
        ? f.flags | FighterFlag.Invuln
        : f.invulnFrames <= 0 ? f.flags & ~FighterFlag.Invuln : f.flags;
      if (f.moveFrame === st) {
        const ns = requireKey(requireDefined(getFighterSpec(FighterId.Nesta).nestaSizes, 'nestaSizes'), f.nestaSize, 'nestaSizes');
        f.vy = jumpVel(stats.gravityScale, ns.popsHeight);
        f.flags &= ~FighterFlag.Grounded;
      }
      if (f.moveFrame >= st + move.active) {
        transitionState(f, FighterState.Helpless);
      }
    }
  },
  onNonSpecialAttackFrame(f, move, st) {
    if (move.id === MoveId.Dair && f.moveFrame >= st && (f.moveFrame - st) % 3 === 0) {
      f.moveHitIds.length = 0;
    }
  },
};

const mossKit: FighterKit = {
  onSpecialFrame(f, move, mask, ctx) {
    const stats = getEffectiveStats(f);
    const facing = (f.flags & FighterFlag.FacingRight) !== 0 ? 1 : -1;
    const st = getEffectiveStartup(f, move, f.moveIsClean);

    if (move.id === MoveId.Nspec && f.moveFrame === st) {
      const aim = dirToUnitVector(decodeInputDir(mask));
      const ax = aim.x === 0 && aim.y === 0 ? facing : aim.x;
      const ay = aim.y === 0 ? 0.2 : aim.y;
      const n = Math.hypot(ax, ay);
      spawnProj(ctx, {
        id: ctx.gadgets.nextId++, kind: ProjectileKind.Hook, ownerSlot: f.slot,
        x: f.x + (ax / n) * 0.5, y: f.y + stats.height * 0.6 + (ay / n) * 0.5,
        vx: (ax / n) * 16.0, vy: (ay / n) * 16.0, radius: 0.3, damage: move.damage,
        bkb: move.bkb, kbg: move.kbg, angle: move.angle, ttlTicks: 30, gravityScale: 0.3,
        reflected: false, stuckFighterSlot: -1, stuckChunkIndex: -1, stuckTicks: 0, gadgetId: GadgetId.None, pipingMultiHits: 0,
      });
    } else if (move.id === MoveId.Sspec && f.moveFrame === st && ctx.gadgets.projectiles.filter((p) => p.kind === ProjectileKind.Bobber && p.ownerSlot === f.slot).length < 2) {
      spawnProj(ctx, {
        id: ctx.gadgets.nextId++, kind: ProjectileKind.Bobber, ownerSlot: f.slot,
        x: f.x + facing * 0.5, y: f.y + stats.height * 0.6,
        vx: facing * (f.moveIsClean ? 11.2 : 8.0), vy: 7.5, radius: 0.32,
        damage: f.moveIsClean ? 7 : move.damage, bkb: move.bkb, kbg: move.kbg, angle: move.angle,
        ttlTicks: 240, gravityScale: 0.6, reflected: false, stuckFighterSlot: -1, stuckChunkIndex: -1,
        stuckTicks: 0, gadgetId: GadgetId.None, pipingMultiHits: 0,
      });
    } else if (move.id === MoveId.Uspec && f.moveFrame === st) {
      const reach = f.moveIsClean ? 11.0 : 9.0;
      const hx = dirHx(decodeInputDir(mask));
      const dx0 = hx !== 0 ? hx * 0.55 : facing * 0.45;
      const len = Math.hypot(dx0, 0.85);
      const ux = dx0 / len;
      const uy = 0.85 / len;
      let bestT = Infinity;
      let latch: FighterRuntime | null = null;
      for (const lp of ctx.island.ledges) {
        const d = Math.hypot(lp.x - f.x, lp.y - (f.y + 0.5));
        if (d <= reach && ((lp.x - f.x) * ux + (lp.y - f.y - 0.5) * uy) / Math.max(1e-4, d) > 0.35 && d < bestT) bestT = d;
      }
      for (const o of ctx.fighters) {
        const d = Math.hypot(o.x - f.x, o.y - f.y);
        if (o.slot !== f.slot && o.stocks > 0 && o.state < FighterState.Respawn && d <= reach && ((o.x - f.x) * ux + (o.y - f.y) * uy) / Math.max(1e-4, d) > 0.45 && d < bestT) {
          bestT = d;
          latch = o;
        }
      }
      if (bestT === Infinity) {
        for (let s = 1.0; s <= reach; s += 0.6) {
          if (querySurfaceAt(ctx.island, f.x + ux * s, f.y + 0.7 + uy * s, f.y + 0.2 + uy * s, false)) { bestT = s; break; }
        }
      }
      if (bestT < Infinity) {
        f.vx = ux * 20.0;
        f.vy = uy * 20.0;
        f.flags &= ~FighterFlag.Grounded;
        if (latch) {
          latch.damage += move.damage;
          latch.kbVy = 10;
          latch.hitstunFrames = 14;
          latch.state = FighterState.Hitstun;
          latch.flags &= ~FighterFlag.Grounded;
        }
      }
    } else if (move.id === MoveId.Dspec) {
      if ((f.flags & FighterFlag.Grounded) === 0) {
        transitionState(f, FighterState.Airborne);
        return;
      }
      if (f.moveFrame === (f.moveIsClean ? 40 : 55)) {
        const roll = ctx.rng.next();
        if (roll < 0.6) {
          const body = ctx.rapierWorld.createRigidBody(ctx.rapier.RigidBodyDesc.dynamic().setTranslation(f.x + facing * 0.7, f.y + 0.5).setLinvel(facing * 3, 5));
          const col = ctx.rapierWorld.createCollider(ctx.rapier.ColliderDesc.ball(0.28), body);
          ctx.island.rubble.push({ id: ctx.island.nextRubbleId++, x: f.x + facing * 0.7, y: f.y + 0.5, vx: facing * 3, vy: 5, angle: 0, radius: 0.28, resting: false, restSent: false, ownerSlot: f.slot, isShell: false, shellHitsLeft: 0, ttlTicks: 1800, bodyHandle: body.handle, colliderHandle: col.handle });
        } else if (roll < 0.9) {
          spawnProj(ctx, { id: ctx.gadgets.nextId++, kind: ProjectileKind.Boot, ownerSlot: f.slot, x: f.x + facing * 0.6, y: f.y + 0.7, vx: facing * 12, vy: 5, radius: 0.28, damage: 6, bkb: 10, kbg: 8, angle: 45, ttlTicks: 90, gravityScale: 0.8, reflected: false, stuckFighterSlot: -1, stuckChunkIndex: -1, stuckTicks: 0, gadgetId: GadgetId.None, pipingMultiHits: 0 });
        } else if (roll < 0.99) {
          const pool = ALL_GADGET_IDS.filter((gid) => { const t = getGameData().gadgets.get(gid)!.tier; return (t !== GadgetTier.B || ctx.gadgets.enableTierB) && (t !== GadgetTier.C || ctx.gadgets.enableTierC); });
          const gid = ctx.rng.pick(pool);
          ctx.gadgets.worldGadgets.push({ id: ctx.gadgets.nextId++, gadgetId: gid, ammo: getGameData().gadgets.get(gid)!.ammo, state: WorldGadgetState.Grounded, x: f.x + facing * 0.7, y: f.y + 0.2, vx: 0, vy: 0, angle: 0, ttlTicks: 1200, armTicks: 0, ownerSlot: f.slot, stuckChunkIndex: findChunkUnderPoint(ctx.island, f.x, f.y), bodyHandle: -1, colliderHandle: -1 });
        } else {
          f.damage += 2;
          f.vy = 7;
          f.flags &= ~FighterFlag.Grounded;
        }
      }
    }
  },
  onNonSpecialAttackFrame(f, move, st, ctx) {
    if (move.id === MoveId.Dair && f.moveFrame === st && !ctx.gadgets.projectiles.some((p) => p.kind === ProjectileKind.Sinker && p.ownerSlot === f.slot)) {
      spawnProj(ctx, { id: ctx.gadgets.nextId++, kind: ProjectileKind.Sinker, ownerSlot: f.slot, x: f.x, y: f.y, vx: 0, vy: -16, radius: 0.25, damage: move.damage, bkb: move.bkb, kbg: move.kbg, angle: move.angle, ttlTicks: 90, gravityScale: 0, reflected: false, stuckFighterSlot: -1, stuckChunkIndex: -1, stuckTicks: 0, gadgetId: GadgetId.None, pipingMultiHits: 0 });
    }
  },
};

export const FIGHTER_KITS: Record<FighterId, FighterKit> = {
  [FighterId.Earl]: earlKit,
  [FighterId.Grog]: grogKit,
  [FighterId.Nesta]: nestaKit,
  [FighterId.Moss]: mossKit,
};

export function stepFighterSpecialProjectiles(ctx: FighterStepContext): void {
  const { hitstun, hitstop, launch, parry, gilt } = getGameData().tuning;
  for (let i = ctx.gadgets.projectiles.length - 1; i >= 0; i--) {
    const p = ctx.gadgets.projectiles[i]!;
    if (p.kind !== ProjectileKind.SteamPuff && p.kind !== ProjectileKind.Hook && p.kind !== ProjectileKind.Bobber && p.kind !== ProjectileKind.Sinker && p.kind !== ProjectileKind.Boot && p.kind !== ProjectileKind.Shell) continue;

    if (p.kind === ProjectileKind.Hook && p.stuckFighterSlot >= 0) {
      const moss = ctx.fighters.find((f) => f.slot === p.ownerSlot);
      const tf = ctx.fighters.find((f) => f.slot === p.stuckFighterSlot);
      if (!moss || moss.stocks <= 0 || !tf || tf.stocks <= 0) { ctx.gadgets.projectiles.splice(i, 1); continue; }
      p.x = tf.x;
      p.y = tf.y + 0.7;
      const dx = moss.x - tf.x;
      const dy = moss.y - tf.y;
      const d = Math.max(1e-4, Math.hypot(dx, dy));
      if (hasBit(moss.lastInputMask, InputBit.Special)) {
        tf.vx = (dx / d) * 13;
        tf.vy = (dy / d) * 13;
        tf.flags &= ~FighterFlag.Grounded;
      } else if (freshBit(moss.lastInputMask, moss.prevInputMask, InputBit.Attack)) {
        const facing = (moss.flags & FighterFlag.FacingRight) !== 0 ? 1 : -1;
        tf.damage += p.damage;
        const spd = computeLaunchSpeed(p.bkb, p.kbg, tf.damage, getEffectiveStats(tf).weight);
        const rad = (facing > 0 ? p.angle : 180 - p.angle) * DEG_TO_RAD;
        tf.kbVx = Math.cos(rad) * spd;
        tf.kbVy = Math.sin(rad) * spd;
        tf.hitstunFrames = computeHitstun(spd);
        tf.state = spd >= launch.tumbleSpeed ? FighterState.Tumble : FighterState.Hitstun;
        tf.flags &= ~FighterFlag.Grounded;
        ctx.events.push({ tick: ctx.tick, kind: SimEventKind.Hit, a: moss.slot, b: tf.slot, c: Math.round(p.damage * 10), d: MoveId.Nspec });
        ctx.gadgets.projectiles.splice(i, 1);
        continue;
      }
      if (--p.ttlTicks <= 0) ctx.gadgets.projectiles.splice(i, 1);
      continue;
    }

    if (p.kind === ProjectileKind.Bobber && p.vx === 0 && p.vy === 0 && --p.ttlTicks <= 0) {
      ctx.gadgets.projectiles.splice(i, 1);
      continue;
    }

    let hit = false;
    for (const f of ctx.fighters) {
      if (f.slot === p.ownerSlot || f.stocks <= 0 || f.state >= FighterState.Respawn || (f.flags & FighterFlag.Invuln) !== 0 || f.invulnFrames > 0) continue;
      if (ctx.mode === MatchMode.Teams && f.team !== TeamId.None && f.team === requireAt(ctx.fighters, p.ownerSlot, 'fighters').team) continue;
      const st = getEffectiveStats(f);
      if (Math.hypot(f.x - p.x, f.y + st.height * 0.5 - p.y) > p.radius + st.width * 0.45) continue;

      if (f.state === FighterState.Parry) {
        const prevOwner = p.ownerSlot;
        p.ownerSlot = f.slot;
        p.vx = -p.vx * parry.projectileReflectSpeedMult;
        p.vy = -p.vy * parry.projectileReflectSpeedMult;
        f.gilt = Math.min(gilt.max, f.gilt + parry.giltGain);
        ctx.events.push({ tick: ctx.tick, kind: SimEventKind.Parry, a: f.slot, b: prevOwner, c: parry.giltGain, d: 0 });
        hit = true;
        break;
      }
      if (p.kind === ProjectileKind.Hook) {
        p.stuckFighterSlot = f.slot;
        p.ttlTicks = 120;
        p.vx = 0;
        p.vy = 0;
        hit = true;
        break;
      }
      const dir = p.vx !== 0 ? Math.sign(p.vx) : Math.sign(f.x - p.x) || 1;
      f.damage += p.damage;
      const spd = computeLaunchSpeed(p.bkb, p.kbg, f.damage, st.weight);
      const rad = (dir > 0 ? p.angle : 180 - p.angle) * DEG_TO_RAD;
      f.kbVx = Math.cos(rad) * spd;
      f.kbVy = Math.sin(rad) * spd;
      f.hitstunFrames = Math.min(hitstun.max, Math.round(hitstun.base + hitstun.perSpeed * spd));
      f.hitstopFrames = Math.min(hitstop.max, Math.max(hitstop.min, Math.round(hitstop.base + hitstop.perDamage * p.damage)));
      transitionState(f, spd >= launch.tumbleSpeed ? FighterState.Tumble : FighterState.Hitstun);
      f.lastHitBySlot = p.ownerSlot;
      f.lastHitTick = ctx.tick;
      ctx.events.push({ tick: ctx.tick, kind: SimEventKind.Hit, a: p.ownerSlot, b: f.slot, c: Math.round(p.damage * 10), d: 0 });
      if (p.pipingMultiHits > 1) p.pipingMultiHits--;
      else ctx.gadgets.projectiles.splice(i, 1);
      hit = true;
      break;
    }
    if (hit) continue;

    if (p.kind === ProjectileKind.Bobber && p.vy < 0) {
      const s = querySurfaceAt(ctx.island, p.x, p.y + 0.1, p.y + p.vy * DT, false);
      if (s) { p.y = s.y; p.vx = 0; p.vy = 0; }
    } else if (p.kind === ProjectileKind.Sinker && p.vy < 0 && querySurfaceAt(ctx.island, p.x, p.y + 0.1, p.y + p.vy * DT, false)) {
      ctx.gadgets.projectiles.splice(i, 1);
    }
  }

  for (let i = ctx.island.rubble.length - 1; i >= 0; i--) {
    const r = ctx.island.rubble[i]!;
    if (!r.isShell || r.shellHitsLeft <= 0) continue;
    for (const f of ctx.fighters) {
      if (f.state !== FighterState.Attack || f.activeMove === MoveId.None) continue;
      const move = getMoveSpec(f.id, f.activeMove);
      const st = getEffectiveStartup(f, move, f.moveIsClean);
      if (f.moveFrame < st || f.moveFrame >= st + move.active || !capsulesOverlap(getMoveHitbox(f, move), { x0: r.x, y0: r.y, x1: r.x, y1: r.y, radius: r.radius })) continue;
      const facing = (f.flags & FighterFlag.FacingRight) !== 0 ? 1 : -1;
      const dspec = getMoveSpec(FighterId.Nesta, MoveId.Dspec);
      r.shellHitsLeft--;
      r.ownerSlot = f.slot;
      const body = r.bodyHandle >= 0 ? ctx.rapierWorld.getRigidBody(r.bodyHandle) : null;
      if (body && body.isValid()) body.setLinvel({ x: facing * 14, y: 4 }, true);
      spawnProj(ctx, { id: ctx.gadgets.nextId++, kind: ProjectileKind.Shell, ownerSlot: f.slot, x: r.x, y: r.y, vx: facing * 14, vy: 3, radius: r.radius, damage: dspec.damage, bkb: dspec.bkb, kbg: dspec.kbg, angle: dspec.angle, ttlTicks: 60, gravityScale: 0.4, reflected: false, stuckFighterSlot: -1, stuckChunkIndex: -1, stuckTicks: 0, gadgetId: GadgetId.None, pipingMultiHits: 0 });
      if (r.shellHitsLeft <= 0) {
        if (r.bodyHandle >= 0 && body && body.isValid()) ctx.rapierWorld.removeRigidBody(body);
        ctx.island.rubble.splice(i, 1);
      }
      break;
    }
  }
}
