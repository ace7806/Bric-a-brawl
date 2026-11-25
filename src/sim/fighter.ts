import { assertNever, requireDefined, requireKey } from './assert';
import {
  applyLaunchSteering, computeBlockstun, computeHitstop,
  computeHitstun, computeLaunchSpeed, createHurtboxFrame,
} from './combat';
import { getArenaSpec, getFighterSpec, getGameData, getMoveSpec } from './data';
import {
  ChunkState, CrackSource, FighterFlag, FighterId, FighterState, GadgetId,
  InputBit, InputDir, MotionInput, MoveClass, MoveId, SimEventKind,
} from './enums';
import { FIGHTER_KITS, performNestaShed, registerThrowHandler, stepFighterSpecialProjectiles } from './fighter-kits';
import {
  createFighter, DEG_TO_RAD, dirHx, DT, freshBit, getEffectiveStartup, getEffectiveStats,
  isDownDir, isUpDir, jumpVel, setFacing, transitionState, type FighterStepContext,
} from './fighter-state';
import { recordFighterPosition, tryPickupOrUseGadget } from './gadgets';
import {
  consumeBuffered, decodeInputDir, detectMotionInput,
  dirToUnitVector, hasBit, pushInputHistory, updateInputBuffer,
} from './input';
import { damageChunk, findChunkUnderPoint, getUpdraftBounds, querySurfaceAt } from './island';
import type { FighterRuntime, LedgePoint } from './types';

const HURTBOX_HISTORY_CAP = 12;
const DASH_FRAMES = 10;
const TEASPOON_SPEED = 10.0;
const SEPARATION_SPEED = 3.0;

function recentGuardPress(f: FighterRuntime, tick: number, win: number): boolean {
  const { masks, ticks, head, count } = f.history;
  const cap = masks.length;
  for (let i = 0; i < count; i++) {
    const idx = (head - 1 - i + cap) % cap;
    const sampleTick = ticks[idx] as number;
    if (tick - sampleTick > win) break;
    const prevIdx = (idx - 1 + cap) % cap;
    const curMask = masks[idx] as number;
    const prevMask = masks[prevIdx] as number;
    if ((curMask & InputBit.Guard) !== 0 && (i + 1 >= count || (prevMask & InputBit.Guard) === 0)) return true;
  }
  return false;
}

function syncBody(f: FighterRuntime, ctx: FighterStepContext): void {
  if (f.bodyHandle < 0) return;
  const body = ctx.rapierWorld.getRigidBody(f.bodyHandle);
  if (body && body.isValid()) body.setNextKinematicTranslation({ x: f.x, y: f.y + getEffectiveStats(f).height * 0.5 });
}

function tryGiltBreak(f: FighterRuntime, mask: number, ctx: FighterStepContext): boolean {
  const { gilt } = getGameData().tuning;
  if (f.gilt < gilt.breakerCost || !hasBit(mask, InputBit.Guard) || !hasBit(mask, InputBit.Special)) return false;
  if (f.state !== FighterState.Hitstun && f.state !== FighterState.Tumble && f.state !== FighterState.Held) return false;

  if (f.state === FighterState.Held && f.grabbedBySlot >= 0) {
    const g = ctx.fighters.find((o) => o.slot === f.grabbedBySlot);
    if (g) { g.grabbingSlot = -1; g.stampedeCarriedSlot = -1; transitionState(g, FighterState.Idle); }
  }
  f.grabbedBySlot = -1; f.grabHoldFrames = 0; f.gilt = 0; f.hitstopFrames = 0; f.hitstunFrames = 0;
  f.kbVx = 0; f.kbVy = 0; f.vx = 0; f.vy = 0;
  f.buffer.length = 0;
  f.invulnFrames = gilt.breakerInvulnFrames;
  f.flags |= FighterFlag.Invuln;
  transitionState(f, (f.flags & FighterFlag.Grounded) !== 0 ? FighterState.Idle : FighterState.Airborne);

  for (const o of ctx.fighters) {
    if (o.slot === f.slot || o.stocks <= 0 || o.state >= FighterState.Respawn) continue;
    if (Math.hypot(o.x - f.x, o.y - f.y) > gilt.breakerRadius) continue;
    o.kbVx = (o.x >= f.x ? 1 : -1) * gilt.breakerPushSpeed;
    o.kbVy = 4.0;
    o.hitstunFrames = Math.max(o.hitstunFrames, 12);
    transitionState(o, FighterState.Hitstun);
  }
  ctx.events.push({ tick: ctx.tick, kind: SimEventKind.GiltBreak, a: f.slot, b: 0, c: 0, d: 0 });
  return true;
}

function stepTeaspoon(f: FighterRuntime, mask: number, ctx: FighterStepContext): void {
  const { match, tickRate } = getGameData().tuning;
  const arena = getArenaSpec(ctx.island.arenaId);
  f.teaspoonX = Math.max(arena.cameraBounds.minX, Math.min(arena.cameraBounds.maxX, f.teaspoonX + dirHx(decodeInputDir(mask)) * TEASPOON_SPEED * DT));
  f.x = f.teaspoonX; f.y = arena.blastZone.top - 1.5; f.vx = 0; f.vy = 0;
  if (f.teaspoonCooldown > 0) f.teaspoonCooldown--;

  if (f.teaspoonCooldown === 0 && (freshBit(mask, f.prevInputMask, InputBit.Attack) || freshBit(mask, f.prevInputMask, InputBit.Use))) {
    f.teaspoonCooldown = Math.round(match.ghostTapCooldownSeconds * tickRate);
    let targetIdx = -1;
    for (let i = 0; i < ctx.island.chunks.length; i++) {
      const ch = ctx.island.chunks[i]!;
      const sp = arena.chunks[i]!;
      if ((ch.state === ChunkState.Intact || ch.state === ChunkState.Crazed) && f.teaspoonX >= Math.min(sp.topX0, sp.topX1) && f.teaspoonX <= Math.max(sp.topX0, sp.topX1)) {
        targetIdx = i;
        break;
      }
    }
    if (targetIdx >= 0) damageChunk(ctx.rapier, ctx.rapierWorld, ctx.island, targetIdx, match.ghostTapCrack, CrackSource.Teaspoon, ctx.fragile, ctx.tick, ctx.rng, ctx.events);
    ctx.events.push({ tick: ctx.tick, kind: SimEventKind.TeaspoonTap, a: f.slot, b: targetIdx, c: Math.round(f.teaspoonX * 64), d: match.ghostTapCrack });
  }
  syncBody(f, ctx);
}

function applyThrowHit(thrower: FighterRuntime, victim: FighterRuntime, moveId: MoveId, ctx: FighterStepContext): void {
  const { grab, launch, hitstop } = getGameData().tuning;
  const move = getMoveSpec(thrower.id, moveId);
  const facing = (thrower.flags & FighterFlag.FacingRight) !== 0 ? 1 : -1;
  const throwDir = moveId === MoveId.Bthrow ? -facing : facing;
  const stats = getEffectiveStats(thrower);
  const vStats = getEffectiveStats(victim);

  let dmg = move.damage;
  let kbMult = 1.0;
  if (thrower.id === FighterId.Nesta) {
    const ns = requireKey(requireDefined(getFighterSpec(FighterId.Nesta).nestaSizes, 'nestaSizes'), thrower.nestaSize, 'nestaSizes');
    dmg *= ns.damageMult; kbMult *= ns.kbMult;
  }
  victim.damage += dmg;
  const spd = computeLaunchSpeed(move.bkb, move.kbg, victim.damage, vStats.weight) * kbMult;
  const rad = applyLaunchSteering(move.angle, throwDir > 0, decodeInputDir(victim.lastInputMask)) * DEG_TO_RAD;
  victim.kbVx = Math.cos(rad) * spd; victim.kbVy = Math.sin(rad) * spd; victim.vx = 0; victim.vy = 0;
  victim.hitstunFrames = computeHitstun(spd, 1, 0);
  victim.hitstopFrames = computeHitstop(dmg, false);
  thrower.hitstopFrames = Math.min(hitstop.max, victim.hitstopFrames);
  transitionState(victim, spd >= launch.tumbleSpeed ? FighterState.Tumble : FighterState.Hitstun);
  victim.grabbedBySlot = -1; victim.grabHoldFrames = 0; victim.regrabImmunity = grab.regrabImmunityFrames;
  victim.lastHitBySlot = thrower.slot; victim.lastHitByMove = moveId; victim.lastHitByGadget = GadgetId.None; victim.lastHitTick = ctx.tick;

  if (move.bonusCrack > 0) {
    const ci = findChunkUnderPoint(ctx.island, thrower.x, thrower.y);
    if (ci >= 0) damageChunk(ctx.rapier, ctx.rapierWorld, ctx.island, ci, move.bonusCrack * stats.crackMult, CrackSource.Move, ctx.fragile, ctx.tick, ctx.rng, ctx.events);
  }
  if (thrower.activeMove === MoveId.Sspec && thrower.state === FighterState.Attack) {
    const sm = getMoveSpec(thrower.id, MoveId.Sspec);
    thrower.moveFrame = Math.max(thrower.moveFrame, getEffectiveStartup(thrower, sm, thrower.moveIsClean) + sm.active);
    thrower.flags &= ~FighterFlag.Armour;
    thrower.vx = 0;
  } else {
    thrower.moveFrame = 0;
    transitionState(thrower, FighterState.Attack);
  }
  thrower.grabbingSlot = -1; thrower.activeMove = moveId; thrower.moveHitConnected = true;
  ctx.events.push({ tick: ctx.tick, kind: SimEventKind.Throw, a: thrower.slot, b: victim.slot, c: moveId, d: 0 });
  ctx.events.push({ tick: ctx.tick, kind: SimEventKind.Launch, a: thrower.slot, b: victim.slot, c: Math.round(spd * 8), d: moveId });
  ctx.events.push({ tick: ctx.tick, kind: SimEventKind.Hit, a: thrower.slot, b: victim.slot, c: Math.round(dmg * 10), d: moveId });
}

registerThrowHandler(applyThrowHit);

function stepHeldOrGrabbing(f: FighterRuntime, mask: number, ctx: FighterStepContext): boolean {
  const { grab } = getGameData().tuning;
  if (f.state === FighterState.Held) {
    const gr = ctx.fighters.find((o) => o.slot === f.grabbedBySlot);
    if (!gr || (gr.state !== FighterState.Grabbing && gr.stampedeCarriedSlot !== f.slot)) {
      f.grabbedBySlot = -1; transitionState(f, FighterState.Airborne);
      return false;
    }
    if (gr.state === FighterState.Grabbing) {
      const gf = (gr.flags & FighterFlag.FacingRight) !== 0 ? 1 : -1;
      f.x = gr.x + gf * 0.85; f.y = gr.y;
      const mashed = (mask & ~f.prevInputMask & (InputBit.Attack | InputBit.Special | InputBit.Jump | InputBit.Guard)) !== 0;
      f.grabHoldFrames -= mashed ? 3 : 1;
      if (f.grabHoldFrames <= 0) {
        gr.grabbingSlot = -1; transitionState(gr, FighterState.Idle);
        f.grabbedBySlot = -1; f.regrabImmunity = grab.regrabImmunityFrames;
        f.kbVx = gf * 6; f.vy = 5; transitionState(f, FighterState.Airborne);
      }
    }
    syncBody(f, ctx);
    return true;
  }
  if (f.state === FighterState.Grabbing) {
    const v = ctx.fighters.find((o) => o.slot === f.grabbingSlot);
    if (!v || v.state !== FighterState.Held) { f.grabbingSlot = -1; transitionState(f, FighterState.Idle); return false; }
    const dir = decodeInputDir(mask);
    const hx = dirHx(dir);
    const facing = (f.flags & FighterFlag.FacingRight) !== 0 ? 1 : -1;
    const tm = isUpDir(dir) ? MoveId.Uthrow : isDownDir(dir) ? MoveId.Dthrow : hx !== 0 ? (hx === facing ? MoveId.Fthrow : MoveId.Bthrow) : f.stateFrame > 60 ? MoveId.Fthrow : null;
    if (tm !== null) applyThrowHit(f, v, tm, ctx);
    syncBody(f, ctx);
    return true;
  }
  return false;
}

function startMove(f: FighterRuntime, moveId: MoveId, clean: boolean, ctx: FighterStepContext): void {
  f.state = FighterState.Attack; f.stateFrame = 0; f.activeMove = moveId; f.moveFrame = 0;
  f.moveHitConnected = false; f.moveHitIds.length = 0; f.moveIsClean = clean;
  f.heavyChargeFrames = 0; f.steepChargeFrames = 0;
  if ((f.flags & FighterFlag.Grounded) !== 0 && moveId !== MoveId.Dash && moveId !== MoveId.Sspec) f.vx = 0;
  FIGHTER_KITS[f.id].onMoveStart?.(f, moveId, ctx);
}

function selectMove(f: FighterRuntime, dir: InputDir, bit: InputBit, grounded: boolean): { moveId: MoveId; clean: boolean } {
  if (bit === InputBit.Special) {
    if (f.lastMotion === MotionInput.Dp623) return { moveId: MoveId.Uspec, clean: true };
    if (f.lastMotion === MotionInput.Qcf236) return { moveId: MoveId.Sspec, clean: true };
    if (f.lastMotion === MotionInput.Qcb214) return { moveId: MoveId.Dspec, clean: true };
    if (isUpDir(dir)) {
      const hx = dirHx(dir);
      if (hx !== 0) setFacing(f, hx > 0);
      return { moveId: MoveId.Uspec, clean: false };
    }
    if (isDownDir(dir)) return { moveId: MoveId.Dspec, clean: false };
    const hx = dirHx(dir);
    if (hx !== 0) { setFacing(f, hx > 0); return { moveId: MoveId.Sspec, clean: false }; }
    return { moveId: MoveId.Nspec, clean: false };
  }
  const hx = dirHx(dir);
  if (!grounded) {
    const facing = (f.flags & FighterFlag.FacingRight) !== 0 ? 1 : -1;
    return { moveId: isUpDir(dir) ? MoveId.Uair : isDownDir(dir) ? MoveId.Dair : hx !== 0 ? (hx === facing ? MoveId.Fair : MoveId.Bair) : MoveId.Nair, clean: false };
  }
  if (bit === InputBit.Grab) return { moveId: MoveId.Grab, clean: false };
  if (bit === InputBit.Heavy) {
    if (isUpDir(dir)) return { moveId: MoveId.Uheavy, clean: false };
    if (isDownDir(dir)) return { moveId: MoveId.Dheavy, clean: false };
    if (hx !== 0) setFacing(f, hx > 0);
    return { moveId: MoveId.Fheavy, clean: false };
  }
  if ((f.state === FighterState.Dash || f.state === FighterState.Run) && hx !== 0) return { moveId: MoveId.Dash, clean: false };
  if (isUpDir(dir)) return { moveId: MoveId.Utilt, clean: false };
  if (isDownDir(dir)) return { moveId: MoveId.Dtilt, clean: false };
  if (hx !== 0) { setFacing(f, hx > 0); return { moveId: MoveId.Ftilt, clean: false }; }
  return { moveId: MoveId.Jab1, clean: false };
}

function stepAttack(f: FighterRuntime, mask: number, ctx: FighterStepContext): void {
  const { input } = getGameData().tuning;
  const move = getMoveSpec(f.id, f.activeMove);
  const st = getEffectiveStartup(f, move, f.moveIsClean);

  if (f.state === FighterState.ChargingHeavy) {
    if (!hasBit(mask, InputBit.Heavy) || ++f.heavyChargeFrames >= input.smashChargeMaxFrames) {
      f.state = FighterState.Attack; f.stateFrame = 0; f.moveFrame = 0;
    }
    return;
  }

  f.moveFrame++;
  if (f.moveFrame >= st) {
    if (move.cancel === 1) {
      const next = move.id === MoveId.Jab1 ? MoveId.Jab2 : move.id === MoveId.Jab2 && getFighterSpec(f.id).moves.has(MoveId.Jab3) ? MoveId.Jab3 : null;
      if (next !== null && (consumeBuffered(f.buffer, InputBit.Attack, ctx.tick, input.actionBufferFrames) !== null || freshBit(mask, f.prevInputMask, InputBit.Attack))) {
        startMove(f, next, false, ctx); return;
      }
    }
    if (move.cancel === 2 && f.moveHitConnected && f.moveFrame <= st + move.active + 12 && (consumeBuffered(f.buffer, InputBit.Special, ctx.tick, input.actionBufferFrames) !== null || freshBit(mask, f.prevInputMask, InputBit.Special))) {
      const sel = selectMove(f, decodeInputDir(mask), InputBit.Special, (f.flags & FighterFlag.Grounded) !== 0);
      startMove(f, sel.moveId, sel.clean, ctx); return;
    }
  }

  const kit = FIGHTER_KITS[f.id];
  if (move.moveClass === MoveClass.Special) kit.onSpecialFrame(f, move, mask, ctx);
  else kit.onNonSpecialAttackFrame?.(f, move, st, ctx);

  if (move.id === MoveId.Ledge && f.moveFrame === 1) {
    const lp = ctx.island.ledges.find((l) => l.chunkIndex === f.ledgeChunkIndex && l.side === f.ledgeSide);
    if (lp) { f.x = lp.x - lp.side * 0.6; f.y = lp.y; f.flags |= FighterFlag.Grounded; }
  }
  if (f.moveFrame >= move.total && f.state === FighterState.Attack) {
    f.flags &= ~(FighterFlag.Armour | FighterFlag.Invuln);
    transitionState(f, (f.flags & FighterFlag.Grounded) !== 0 ? FighterState.Idle : FighterState.Airborne);
  }
}

function stepLedgeHang(f: FighterRuntime, mask: number, ctx: FighterStepContext): void {
  const { ledge, dodge, tickRate } = getGameData().tuning;
  const pt = ctx.island.ledges.find((l) => l.chunkIndex === f.ledgeChunkIndex && l.side === f.ledgeSide);
  if (!pt || f.stateFrame >= Math.round(ledge.maxHangSeconds * tickRate)) {
    transitionState(f, FighterState.Airborne); f.ledgeChunkIndex = -1; f.invulnFrames = 0; f.flags &= ~FighterFlag.Invuln; return;
  }
  f.x = pt.x + pt.side * 0.35; f.y = pt.y - 0.6; f.vx = 0; f.vy = 0;
  if (f.stateFrame < 4) return;
  const dir = decodeInputDir(mask); const hx = dirHx(dir); const inw = -pt.side;
  if (isDownDir(dir) || hx === pt.side) { f.y = pt.y - 0.9; transitionState(f, FighterState.Airborne); f.ledgeChunkIndex = -1; }
  else if (hasBit(mask, InputBit.Jump)) { f.x = pt.x + inw * 0.4; f.y = pt.y + 0.1; f.vy = jumpVel(getEffectiveStats(f).gravityScale, getEffectiveStats(f).fullHop); transitionState(f, FighterState.Airborne); f.ledgeChunkIndex = -1; }
  else if (hasBit(mask, InputBit.Attack)) startMove(f, MoveId.Ledge, false, ctx);
  else if (hasBit(mask, InputBit.Guard)) { f.x = pt.x + inw; f.y = pt.y; f.flags |= FighterFlag.Grounded; transitionState(f, FighterState.Roll); f.vx = inw * (dodge.roll.distance / (dodge.roll.total * DT)); f.ledgeChunkIndex = -1; }
  else if (isUpDir(dir) || hx === inw) { f.x = pt.x + inw * 0.6; f.y = pt.y; f.flags |= FighterFlag.Grounded; transitionState(f, FighterState.LedgeGetup); f.ledgeChunkIndex = -1; }
}

function hasActionReady(f: FighterRuntime, bit: InputBit, mask: number, tick: number, bufF: number): boolean {
  return freshBit(mask, f.prevInputMask, bit) || f.buffer.some((e) => e.bit === bit && tick - e.pressedTick >= 0 && tick - e.pressedTick <= bufF);
}

function hasPendingGadgetUse(f: FighterRuntime, mask: number, tick: number, bufF: number): boolean {
  if (f.heldGadget === GadgetId.Cork && (hasBit(mask, InputBit.Use) || f.corkChargeFrames > 0)) return true;
  return hasActionReady(f, InputBit.Use, mask, tick, bufF);
}

function handleActionInitiation(f: FighterRuntime, mask: number, dir: InputDir, ctx: FighterStepContext): boolean {
  const { input, dodge, wallJump } = getGameData().tuning;
  const bufF = input.actionBufferFrames;
  const grounded = (f.flags & FighterFlag.Grounded) !== 0;
  const rooted = (f.flags & FighterFlag.Rooted) !== 0;

  if (hasPendingGadgetUse(f, mask, ctx.tick, bufF)) return false;

  const hooverSucking = f.heldGadget === GadgetId.Hoover && hasBit(mask, InputBit.Use) && !ctx.gadgets.hooverBags.has(f.slot);
  if (hasBit(mask, InputBit.Guard) && !hooverSucking) {
    if (grounded) {
      const hx = dirHx(dir);
      if (hx !== 0 && !rooted) { transitionState(f, FighterState.Roll); f.vx = hx * (dodge.roll.distance / (dodge.roll.total * DT)); return true; }
      if (isDownDir(dir) && !rooted) { transitionState(f, FighterState.SpotDodge); f.vx = 0; return true; }
      if (f.state !== FighterState.Guard && f.state !== FighterState.Parry) transitionState(f, f.parryCooldown === 0 ? FighterState.Parry : FighterState.Guard);
      return true;
    }
    if (f.airDodgesLeft > 0 && freshBit(mask, f.prevInputMask, InputBit.Guard)) {
      const v = dirToUnitVector(dir); const spd = dodge.air.distance / (dodge.air.travelFrames * DT);
      f.vx = v.x * spd; f.vy = v.y * spd; f.airDodgesLeft--; transitionState(f, FighterState.AirDodge); f.flags &= ~FighterFlag.FastFall;
      consumeBuffered(f.buffer, InputBit.Guard, ctx.tick, bufF);
      return true;
    }
  }

  for (const bit of [InputBit.Grab, InputBit.Special, InputBit.Heavy, InputBit.Attack] as const) {
    if ((bit === InputBit.Grab || bit === InputBit.Heavy) && !grounded) continue;
    const entry = consumeBuffered(f.buffer, bit, ctx.tick, bufF);
    if (entry !== null || freshBit(mask, f.prevInputMask, bit)) {
      const sel = selectMove(f, entry ? entry.dir : dir, bit, grounded);
      startMove(f, sel.moveId, sel.clean, ctx);
      if (bit === InputBit.Heavy) f.state = FighterState.ChargingHeavy;
      return true;
    }
  }

  if (!rooted && hasActionReady(f, InputBit.Jump, mask, ctx.tick, bufF)) {
    if (grounded) {
      consumeBuffered(f.buffer, InputBit.Jump, ctx.tick, bufF);
      transitionState(f, FighterState.JumpSquat); return true;
    }
    if (f.wallJumpsLeft > 0) {
      const stats = getEffectiveStats(f);
      const chunks = getArenaSpec(ctx.island.arenaId).chunks;
      for (let i = 0; i < ctx.island.chunks.length; i++) {
        const ch = ctx.island.chunks[i]!; const sp = chunks[i]!;
        const nearL = Math.abs(f.x - sp.topX0) <= stats.width * 0.7;
        const nearR = Math.abs(f.x - sp.topX1) <= stats.width * 0.7;
        if ((ch.state === ChunkState.Intact || ch.state === ChunkState.Crazed) && (nearL || nearR) && f.y < sp.topY0 && f.y > sp.topY0 - 2.6) {
          consumeBuffered(f.buffer, InputBit.Jump, ctx.tick, bufF);
          f.vx = (nearL ? -1 : 1) * wallJump.speed[0]; f.vy = wallJump.speed[1]; f.wallJumpsLeft--;
          setFacing(f, !nearL); f.flags &= ~FighterFlag.FastFall; transitionState(f, FighterState.Airborne); return true;
        }
      }
    }
    if (f.doubleJumpsLeft > 0) {
      consumeBuffered(f.buffer, InputBit.Jump, ctx.tick, bufF);
      const stats = getEffectiveStats(f); const hx = dirHx(dir);
      f.vy = jumpVel(stats.gravityScale, stats.doubleJump);
      if (Math.hypot(f.kbVx, f.kbVy) < stats.airSpeed * 1.5) {
        if (hx !== 0) f.vx = hx * stats.airSpeed;
      } else if (f.kbVy > 0) {
        f.kbVy *= 0.5;
      }
      f.doubleJumpsLeft--; f.flags &= ~FighterFlag.FastFall; transitionState(f, FighterState.Airborne); return true;
    }
  }
  return false;
}

export function stepFighterGadgetAction(f: FighterRuntime, mask: number, ctx: FighterStepContext): void {
  if (f.state === FighterState.Eliminated || f.state === FighterState.Teaspoon || f.state === FighterState.Respawn) return;
  if (f.hitstopFrames > 0) return;

  const bufF = getGameData().tuning.input.actionBufferFrames;
  if (f.heldGadget === GadgetId.Timer && (f.state === FighterState.Hitstun || f.state === FighterState.Tumble)) {
    if (hasActionReady(f, InputBit.Use, mask, ctx.tick, bufF)) {
      if (tryPickupOrUseGadget(ctx.gadgets, f, ctx.fighters, ctx.island, ctx.tick, ctx.rng, ctx.events)) {
        consumeBuffered(f.buffer, InputBit.Use, ctx.tick, bufF);
        syncBody(f, ctx);
      }
    }
    return;
  }

  const actionable =
    f.state <= FighterState.Airborne ||
    f.state === FighterState.Guard ||
    f.state === FighterState.Parry;
  if (!actionable) return;
  const hooverSucking = f.heldGadget === GadgetId.Hoover && hasBit(mask, InputBit.Use) && !ctx.gadgets.hooverBags.has(f.slot);
  if ((f.state === FighterState.Guard || f.state === FighterState.Parry) && hasBit(mask, InputBit.Guard) && !hooverSucking) return;

  if (hasPendingGadgetUse(f, mask, ctx.tick, bufF)) {
    if (tryPickupOrUseGadget(ctx.gadgets, f, ctx.fighters, ctx.island, ctx.tick, ctx.rng, ctx.events)) {
      consumeBuffered(f.buffer, InputBit.Use, ctx.tick, bufF);
      syncBody(f, ctx);
    }
  }
}

export function stepFighter(f: FighterRuntime, mask: number, inputTick: number, ctx: FighterStepContext): void {
  const tuning = getGameData().tuning;
  const arena = getArenaSpec(ctx.island.arenaId);
  recordFighterPosition(f);
  f.hurtboxHistory.push(createHurtboxFrame(f, ctx.tick));
  if (f.hurtboxHistory.length > HURTBOX_HISTORY_CAP) f.hurtboxHistory.shift();

  f.prevInputMask = f.lastInputMask; f.lastInputMask = mask; f.lastInputTick = inputTick;
  pushInputHistory(f.history, ctx.tick, mask);
  updateInputBuffer(f.buffer, ctx.tick, mask, f.prevInputMask, tuning.input.actionBufferFrames);
  if (f.state !== FighterState.Attack) f.lastMotion = detectMotionInput(f.history, ctx.tick, (f.flags & FighterFlag.FacingRight) !== 0, tuning.input.motionWindowFrames);

  if (f.state === FighterState.Eliminated) return;
  if (f.state === FighterState.Teaspoon) { stepTeaspoon(f, mask, ctx); return; }

  if (f.parryCooldown > 0) f.parryCooldown--;
  if (f.regrabImmunity > 0) f.regrabImmunity--;
  if (f.gadgetCooldown > 0) f.gadgetCooldown--;
  if (f.slipperyFrames > 0 && --f.slipperyFrames === 0) f.flags &= ~FighterFlag.Slippery;
  if (f.invulnFrames > 0 && --f.invulnFrames === 0) f.flags &= ~FighterFlag.Invuln;

  if (f.pendingHit !== null && ctx.tryGrace && ctx.tryGrace(f, mask, inputTick)) { syncBody(f, ctx); return; }
  if (tryGiltBreak(f, mask, ctx)) { syncBody(f, ctx); return; }
  if (f.hitstopFrames > 0) { f.hitstopFrames--; return; }

  f.stateFrame++;
  const stats = getEffectiveStats(f);
  const dir = decodeInputDir(mask);
  const hx = dirHx(dir);

  if (f.state === FighterState.Respawn) {
    if (f.stateFrame >= 24 || (mask & ~InputBit.DirMask) !== 0 || hx !== 0) transitionState(f, FighterState.Airborne);
    syncBody(f, ctx); return;
  }
  if (stepHeldOrGrabbing(f, mask, ctx)) return;
  if (f.state === FighterState.LedgeHang) { stepLedgeHang(f, mask, ctx); syncBody(f, ctx); return; }

  if (f.state !== FighterState.Guard && f.state !== FighterState.Parry && f.state !== FighterState.GuardStun && !hasBit(mask, InputBit.Guard)) {
    if (f.guardRegenDelay > 0) f.guardRegenDelay--;
    else f.guardHp = Math.min(stats.guardHP, f.guardHp + tuning.guard.regenPerSec * DT);
  }

  const updateDodgeInv = (inv: readonly [number, number], tot: number): void => {
    f.flags = f.stateFrame >= inv[0] && f.stateFrame <= inv[1] ? f.flags | FighterFlag.Invuln : f.invulnFrames <= 0 ? f.flags & ~FighterFlag.Invuln : f.flags;
    if (f.stateFrame >= tot) {
      if (f.state === FighterState.Roll) f.vx = 0;
      f.flags &= ~FighterFlag.Invuln;
      transitionState(f, f.state === FighterState.AirDodge ? FighterState.Airborne : FighterState.Idle);
    }
  };

  const stepGuardHold = (): void => {
    const hooverSucking = f.heldGadget === GadgetId.Hoover && hasBit(mask, InputBit.Use) && !ctx.gadgets.hooverBags.has(f.slot);
    if (hooverSucking) { transitionState(f, FighterState.Idle); return; }
    if (!hasBit(mask, InputBit.Guard)) { transitionState(f, FighterState.GuardRelease); f.parryCooldown = tuning.parry.cooldownFrames; return; }
    if (f.state === FighterState.Parry) {
      if (f.stateFrame < tuning.parry.windowFrames) return;
      transitionState(f, FighterState.Guard);
    }
    f.guardRegenDelay = tuning.guard.regenDelayFrames; f.guardHp -= tuning.guard.drainPerSec * DT;
    if (f.guardHp <= 0) {
      if (!performNestaShed(f, ctx, true)) {
        f.vy = tuning.guard.breakPopSpeed; f.flags &= ~FighterFlag.Grounded; transitionState(f, FighterState.GuardBreak);
        f.hitstunFrames = tuning.guard.breakStunFrames; f.guardHp = stats.guardHP * 0.5;
        ctx.events.push({ tick: ctx.tick, kind: SimEventKind.GuardBreak, a: f.slot, b: 0, c: 0, d: 0 });
      }
    } else handleActionInitiation(f, mask & ~InputBit.Guard, dir, ctx);
  };

  switch (f.state) {
    case FighterState.Idle: case FighterState.Walk: case FighterState.Dash: case FighterState.Run: case FighterState.Skid: case FighterState.Airborne:
      handleActionInitiation(f, mask, dir, ctx); break;
    case FighterState.JumpSquat:
      if (f.stateFrame >= stats.jumpSquat) {
        f.vy = jumpVel(stats.gravityScale, !hasBit(mask, InputBit.Jump) || hasBit(mask, InputBit.Attack) ? stats.shortHop : stats.fullHop);
        transitionState(f, FighterState.Airborne);
        if (hasBit(mask, InputBit.Attack)) startMove(f, selectMove(f, dir, InputBit.Attack, false).moveId, false, ctx);
      }
      break;
    case FighterState.Attack: case FighterState.ChargingHeavy:
      stepAttack(f, mask, ctx); break;
    case FighterState.Parry: case FighterState.Guard:
      stepGuardHold(); break;
    case FighterState.GuardRelease:
      if (f.stateFrame >= tuning.guard.releaseLag) transitionState(f, FighterState.Idle);
      break;
    case FighterState.GuardStun:
      if (--f.blockstunFrames <= 0) transitionState(f, hasBit(mask, InputBit.Guard) ? FighterState.Guard : FighterState.Idle);
      break;
    case FighterState.ParryStun:
      if (f.stateFrame >= tuning.parry.attackerStunFrames) transitionState(f, (f.flags & FighterFlag.Grounded) !== 0 ? FighterState.Idle : FighterState.Airborne);
      break;
    case FighterState.GuardBreak: {
      const m = (mask & ~f.prevInputMask & (InputBit.Attack | InputBit.Jump | InputBit.Special | InputBit.Guard)) !== 0;
      f.hitstunFrames -= m ? 2 : 1;
      if (f.hitstunFrames <= 0 || f.stateFrame >= tuning.guard.breakStunFrames) { f.hitstunFrames = 0; transitionState(f, (f.flags & FighterFlag.Grounded) !== 0 ? FighterState.Idle : FighterState.Airborne); }
      break;
    }
    case FighterState.Roll: updateDodgeInv(tuning.dodge.roll.invuln, tuning.dodge.roll.total); break;
    case FighterState.SpotDodge: updateDodgeInv(tuning.dodge.spot.invuln, tuning.dodge.spot.total); break;
    case FighterState.AirDodge:
      if (f.stateFrame === tuning.dodge.air.travelFrames) { f.vx *= 0.4; f.vy *= 0.4; }
      updateDodgeInv(tuning.dodge.air.invuln, tuning.dodge.air.total);
      break;
    case FighterState.Hitstun: case FighterState.Tumble:
      if (f.hitstunFrames > 0) f.hitstunFrames--;
      if (f.hitstunFrames <= 0 && (f.state === FighterState.Hitstun || (mask & ~InputBit.DirMask) !== 0 || hx !== 0)) {
        f.comboCount = 0; f.comboHitsByMove.clear();
        transitionState(f, f.state === FighterState.Hitstun && (f.flags & FighterFlag.Grounded) !== 0 ? FighterState.Idle : FighterState.Airborne);
      }
      break;
    case FighterState.LedgeGetup:
      if (f.stateFrame >= tuning.ledge.getupFrames) transitionState(f, FighterState.Idle);
      break;
    case FighterState.LandingLag:
      if (f.hitstunFrames > 0) f.hitstunFrames--; else transitionState(f, FighterState.Idle);
      break;
    case FighterState.Helpless: case FighterState.Grabbing: case FighterState.Held: break;
    default: assertNever(f.state, 'stepFighter.state');
  }

  let pendingAirGravity = false;
  let airGravity = 0;
  let airMaxFall = stats.maxFall;
  const grounded = (f.flags & FighterFlag.Grounded) !== 0;
  const traction = stats.traction * ((f.flags & FighterFlag.Slippery) !== 0 && arena.pourHazard ? arena.pourHazard.tractionMult : 1.0);
  if (grounded) {
    if (f.state <= FighterState.Skid) {
      if ((f.flags & FighterFlag.Rooted) !== 0 || hx === 0 || isDownDir(dir)) {
        const dec = traction * DT;
        f.vx = Math.abs(f.vx) <= dec ? 0 : f.vx - Math.sign(f.vx) * dec;
        if (f.vx === 0) f.state = FighterState.Idle; else if (f.state === FighterState.Run) f.state = FighterState.Skid;
      } else {
        const curFacing = (f.flags & FighterFlag.FacingRight) !== 0 ? 1 : -1;
        if (hasBit(mask, InputBit.Tilt)) { setFacing(f, hx > 0); f.state = FighterState.Walk; f.vx = hx * stats.run * 0.55; }
        else if (f.state === FighterState.Idle || f.state === FighterState.Walk || (f.state === FighterState.Skid && hx !== curFacing)) {
          setFacing(f, hx > 0); transitionState(f, FighterState.Dash); f.vx = hx * stats.dash;
        } else if (f.state === FighterState.Dash) {
          f.vx = hx * stats.dash; if (f.stateFrame >= DASH_FRAMES) transitionState(f, FighterState.Run);
        } else if (f.state === FighterState.Run) {
          if (hx !== curFacing) transitionState(f, FighterState.Skid); else f.vx = hx * stats.run;
        }
      }
    } else if (f.state !== FighterState.Roll && !(f.state === FighterState.Attack && (f.activeMove === MoveId.Sspec || f.activeMove === MoveId.Nspec))) {
      const dec = traction * DT;
      f.vx = Math.abs(f.vx) <= dec ? 0 : f.vx - Math.sign(f.vx) * dec;
    }
  } else if (!(f.state === FighterState.AirDodge && f.stateFrame < tuning.dodge.air.travelFrames)) {
    if (f.state <= FighterState.Skid) transitionState(f, FighterState.Airborne);
    let g = tuning.gravity * stats.gravityScale; let maxFall = stats.maxFall;
    const up = getUpdraftBounds(ctx.island);
    if (up && f.x >= up.x0 && f.x <= up.x1) {
      g *= up.gravityMult; maxFall *= up.maxFallMult;
      if (f.state === FighterState.Hitstun || f.state === FighterState.Tumble) f.vy += up.launchedLift * DT;
    }
    const canAirDrift =
      f.state === FighterState.Airborne || f.state === FighterState.Helpless || f.state === FighterState.Tumble ||
      (f.state === FighterState.Attack && f.activeMove !== MoveId.None && (getMoveSpec(f.id, f.activeMove).moveClass === MoveClass.Air || f.activeMove === MoveId.Uspec));
    if (canAirDrift) {
      if (hx !== 0) f.vx = Math.max(-stats.airSpeed, Math.min(stats.airSpeed, f.vx + hx * stats.airAccel * DT));
      if (f.state === FighterState.Airborne && f.vy <= 0 && isDownDir(dir) && !isDownDir(decodeInputDir(f.prevInputMask))) f.flags |= FighterFlag.FastFall;
    }
    pendingAirGravity = true; airGravity = g;
    airMaxFall = (f.flags & FighterFlag.FastFall) !== 0 ? stats.fastFall : maxFall;
  }

  let dropThrough = false;
  if (grounded && (f.state === FighterState.Idle || f.state === FighterState.Walk) && dir === InputDir.Down && decodeInputDir(f.prevInputMask) !== InputDir.Down) {
    const s = querySurfaceAt(ctx.island, f.x, f.y + 0.1, f.y - 0.12, false);
    if (s && s.isOneWay) { dropThrough = true; transitionState(f, FighterState.Airborne); f.y -= 0.12; }
  }

  const prevY = f.y;
  f.x += (f.vx + f.kbVx) * DT;
  const nextY = f.y + (f.vy + f.kbVy) * DT;
  const kbSpd = Math.hypot(f.kbVx, f.kbVy);
  if (kbSpd > 0) { const r = Math.max(0, kbSpd - tuning.kbDecay * DT) / kbSpd; f.kbVx *= r; f.kbVy *= r; }
  if (pendingAirGravity) f.vy = Math.max(-airMaxFall, f.vy - airGravity * DT);
  if ((f.flags & FighterFlag.Grounded) !== 0 && f.vy + f.kbVy <= 0.05) {
    const surf = querySurfaceAt(ctx.island, f.x, prevY + 0.14, nextY - 0.16, false);
    if (surf) { f.y = surf.y; f.vy = 0; }
    else { f.y = nextY; f.flags &= ~FighterFlag.Grounded; if (f.state !== FighterState.Attack && f.state !== FighterState.Hitstun && f.state !== FighterState.Tumble) transitionState(f, FighterState.Airborne); }
  } else {
    f.y = nextY;
    if (!dropThrough && f.vy + f.kbVy <= 0) {
      const surf = querySurfaceAt(ctx.island, f.x, prevY + 0.08, f.y, isDownDir(dir));
      if (surf) {
        const totalSpd = Math.hypot(f.vx + f.kbVx, f.vy + f.kbVy);
        if (f.state === FighterState.Tumble && totalSpd >= tuning.launch.bounceMinSpeed) {
          const atk = ctx.fighters.find((o) => o.slot === f.lastHitBySlot);
          const rawCrack = totalSpd * (atk ? getEffectiveStats(atk).crackMult : 1.0) * tuning.terrain.crackPerImpactSpeed;
          const teched = recentGuardPress(f, ctx.tick, 12);
          if (surf.chunkIndex >= 0) damageChunk(ctx.rapier, ctx.rapierWorld, ctx.island, surf.chunkIndex, rawCrack * (teched ? tuning.terrain.crackTechMult : 1), CrackSource.Slam, ctx.fragile, ctx.tick, ctx.rng, ctx.events);
          if (teched) {
            f.y = surf.y; f.vx = 0; f.vy = 0; f.kbVx = 0; f.kbVy = 0; f.hitstunFrames = 0;
            f.invulnFrames = Math.max(f.invulnFrames, 12); f.flags |= FighterFlag.Invuln | FighterFlag.Grounded; transitionState(f, FighterState.Idle);
            ctx.events.push({ tick: ctx.tick, kind: SimEventKind.Tech, a: f.slot, b: surf.chunkIndex, c: 0, d: 0 });
          } else {
            f.y = surf.y + 0.05; f.damage += tuning.launch.bounceDamage;
            f.kbVx = (f.vx + f.kbVx) * tuning.launch.bounceRetain; f.kbVy = Math.abs(f.vy + f.kbVy) * tuning.launch.bounceRetain; f.vx = 0; f.vy = 0;
            ctx.events.push({ tick: ctx.tick, kind: SimEventKind.Bounce, a: f.slot, b: surf.chunkIndex, c: Math.round(totalSpd * 8), d: 0 });
          }
        } else {
          f.y = surf.y; f.vy = 0; f.kbVy = 0; f.flags = (f.flags | FighterFlag.Grounded) & ~FighterFlag.FastFall;
          f.doubleJumpsLeft = 1; f.airDodgesLeft = 1; f.wallJumpsLeft = 1; f.ledgeGrabCount = 0;
          if (f.state === FighterState.AirDodge) { f.vx *= tuning.dodge.air.slideRetain; f.hitstunFrames = tuning.dodge.air.landingLag; transitionState(f, FighterState.LandingLag); }
          else if (f.state === FighterState.Attack && f.activeMove !== MoveId.None) {
            const m = getMoveSpec(f.id, f.activeMove);
            FIGHTER_KITS[f.id].onAttackLanding?.(f, m, surf.chunkIndex, ctx);
            if (m.moveClass === MoveClass.Air) { f.hitstunFrames = Math.max(1, m.landingLag); transitionState(f, FighterState.LandingLag); }
          } else if (f.state === FighterState.Tumble) { f.hitstunFrames = 10; transitionState(f, FighterState.LandingLag); }
          else if (f.state === FighterState.Airborne || f.state === FighterState.Helpless) transitionState(f, FighterState.Idle);
        }
      }
    }
  }

  if ((f.flags & FighterFlag.Grounded) === 0 && (f.state === FighterState.Airborne || f.state === FighterState.Helpless) && f.vy <= 0 && !isDownDir(dir)) {
    const facingRight = (f.flags & FighterFlag.FacingRight) !== 0;
    const [boxW, boxH] = tuning.ledge.grabBox;
    for (const lp of ctx.island.ledges as readonly LedgePoint[]) {
      const towardLedge = facingRight === (lp.side === -1) || f.state === FighterState.Helpless || (hx !== 0 && hx === -lp.side);
      if (!towardLedge || Math.abs(f.x - lp.x) > boxW || f.y < lp.y - boxH || f.y > lp.y + 0.3) continue;
      if (tuning.ledge.trump) {
        for (const o of ctx.fighters) if (o.slot !== f.slot && o.state === FighterState.LedgeHang && o.ledgeChunkIndex === lp.chunkIndex && o.ledgeSide === lp.side) {
          transitionState(o, FighterState.Airborne); o.vy = 6.0; o.kbVx = o.ledgeSide * 6.0; o.ledgeChunkIndex = -1; o.invulnFrames = 0; o.flags &= ~FighterFlag.Invuln;
        }
      }
      setFacing(f, lp.side === -1);
      f.x = lp.x + lp.side * 0.35; f.y = lp.y - 0.6; f.vx = 0; f.vy = 0; f.kbVx = 0; f.kbVy = 0;
      transitionState(f, FighterState.LedgeHang); f.ledgeChunkIndex = lp.chunkIndex; f.ledgeSide = lp.side;
      f.doubleJumpsLeft = 1; f.airDodgesLeft = 1; f.wallJumpsLeft = 1;
      if (f.ledgeGrabCount++ === 0) { f.invulnFrames = tuning.ledge.invulnFramesFirstGrab; f.flags |= FighterFlag.Invuln; }
      break;
    }
  }

  const postLedgeState = (f as FighterRuntime).state;
  if (postLedgeState !== FighterState.LedgeHang) {
    for (const o of ctx.fighters) {
      if (o.slot === f.slot || o.stocks <= 0 || o.state >= FighterState.LedgeHang) continue;
      const minSep = (stats.width + getEffectiveStats(o).width) * 0.4;
      if (Math.abs(f.x - o.x) < minSep && Math.abs(f.y - o.y) < 0.9) f.x += (f.x >= o.x ? 1 : -1) * SEPARATION_SPEED * DT * 0.5;
    }
  }
  syncBody(f, ctx);
}

export {
  applyLaunchSteering, computeBlockstun, computeHitstop, computeHitstun, computeLaunchSpeed,
  createFighter, getEffectiveStartup, getEffectiveStats, performNestaShed, stepFighterSpecialProjectiles,
  type FighterStepContext,
};
