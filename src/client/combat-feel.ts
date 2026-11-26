import { assertNever } from '@sim/assert';
import { getFighterSpec, getGameData, getMoveSpec } from '@sim/data';
import { FighterFlag, FighterId, FighterState, MoveClass, MoveId } from '@sim/enums';
import { getMoveHitbox } from '@sim/combat';
import { getEffectiveStartup } from '@sim/fighter-state';
import type { FighterRuntime } from '@sim/types';
import { fighterPitchScale, type AudioEngine } from './audio';
import type { CameraController } from './camera';
import { getElementalFighter } from './elemental-roster';
import { SoundId } from './enums';
import type { SlashOptions, VfxSystem } from './vfx';

export enum HitTier {
  Light = 0,
  Mid = 1,
  Heavy = 2,
  KillSpark = 3,
}

export interface HitContact {
  readonly x: number;
  readonly y: number;
  readonly dirX: number;
  readonly dirY: number;
}

export interface SwingSoundCue {
  readonly soundId: SoundId;
  readonly gainScale: number;
  readonly pitchMult: number;
}

interface FighterMotionTrack {
  state: FighterState;
  grounded: boolean;
  fastFall: boolean;
  facingRight: boolean;
  vy: number;
  move: MoveId;
  slashFiredForMove: boolean;
  stepCd: number;
  chargeSparkCd: number;
}

const KILL_SPARK_LAUNCH_SPEED = 24.0;

/** Computes the exact world contact point biased toward the defender's hurtbox center + knockback direction. */
export function computeHitContactPoint(
  attacker: FighterRuntime | undefined,
  defender: FighterRuntime | undefined,
  moveId: MoveId = MoveId.None,
): HitContact {
  const defH = defender ? getFighterSpec(defender.id).stats.height : 1.5;
  const atkH = attacker ? getFighterSpec(attacker.id).stats.height : 1.5;
  const defX = defender ? defender.x : attacker ? attacker.x : 0;
  const defY = defender ? defender.y + defH * 0.54 : attacker ? attacker.y + atkH * 0.54 : 0.8;
  const atkX = attacker ? attacker.x : defX;
  const atkY = attacker ? attacker.y + atkH * 0.54 : defY;

  // Bias 72% onto the defender so hit sparks/chips visibly burst off the struck opponent
  const x = defender && attacker ? atkX * 0.28 + defX * 0.72 : defX;
  const y = defender && attacker ? atkY * 0.28 + defY * 0.72 : defY;

  // Prefer defender's actual launch vector if already tumbling/knocked back; else derive from move angle + facing
  let dirX = 0;
  let dirY = 0.35;
  if (defender && Math.hypot(defender.vx, defender.vy) > 4.0) {
    dirX = defender.vx;
    dirY = defender.vy;
  } else if (attacker && moveId !== MoveId.None) {
    const facing = (attacker.flags & FighterFlag.FacingRight) !== 0 ? 1 : -1;
    const spec = getFighterSpec(attacker.id).moves.get(moveId);
    if (spec) {
      const deg = facing > 0 ? spec.angle : 180 - spec.angle;
      const rad = (deg * Math.PI) / 180;
      dirX = Math.cos(rad);
      dirY = Math.sin(rad);
    } else {
      dirX = facing;
    }
  } else if (attacker && defender) {
    dirX = defender.x >= attacker.x ? 1 : -1;
  } else {
    dirX = 1;
  }

  const len = Math.hypot(dirX, dirY);
  return {
    x,
    y,
    dirX: len > 1e-4 ? dirX / len : 1,
    dirY: len > 1e-4 ? dirY / len : 0.35,
  };
}

/** Classifies a landed hit into Smash impact tiers for escalating sparks, camera punch, and kill-spark flair. */
export function classifyHitImpact(
  damage: number,
  attackerId: FighterId | null,
  moveId: MoveId,
  launchSpeed: number,
): HitTier {
  const isHeavyMove =
    attackerId !== null &&
    moveId !== MoveId.None &&
    getFighterSpec(attackerId).moves.get(moveId)?.moveClass === MoveClass.Heavy;
  if (launchSpeed >= KILL_SPARK_LAUNCH_SPEED || (isHeavyMove && damage >= 14 && launchSpeed >= 18)) {
    return HitTier.KillSpark;
  }
  if (damage >= 11 || isHeavyMove) return HitTier.Heavy;
  if (damage >= 6) return HitTier.Mid;
  return HitTier.Light;
}

/** Picks an immediate tactile swing whoosh or character special cue for every attack move. */
export function selectSwingSound(fighterId: FighterId, moveId: MoveId): SwingSoundCue | null {
  if (moveId === MoveId.None) return null;
  if (moveId === MoveId.Nspec || moveId === MoveId.Sspec || moveId === MoveId.Uspec || moveId === MoveId.Dspec) {
    let soundId: SoundId;
    switch (fighterId) {
      case FighterId.Earl: soundId = moveId === MoveId.Uspec ? SoundId.EarlPop : SoundId.EarlPuff; break;
      case FighterId.Grog: soundId = moveId === MoveId.Dspec || moveId === MoveId.Uspec ? SoundId.GrogStamp : SoundId.GrogSnort; break;
      case FighterId.Nesta: soundId = SoundId.NestaPop; break;
      case FighterId.Moss: soundId = SoundId.MossCast; break;
      default: assertNever(fighterId, 'selectSwingSound');
    }
    return { soundId, gainScale: 0.85, pitchMult: 1.0 };
  }
  switch (moveId) {
    case MoveId.Fheavy:
    case MoveId.Uheavy:
    case MoveId.Dheavy:
      return { soundId: SoundId.SwingHeavy, gainScale: 0.92, pitchMult: 0.94 };
    case MoveId.Jab1:
      return { soundId: SoundId.SwingLight, gainScale: 0.62, pitchMult: 1.12 };
    case MoveId.Jab2:
      return { soundId: SoundId.SwingLight, gainScale: 0.68, pitchMult: 1.24 };
    case MoveId.Jab3:
    case MoveId.Ftilt:
    case MoveId.Utilt:
    case MoveId.Dtilt:
    case MoveId.Dash:
      return { soundId: SoundId.SwingLight, gainScale: 0.78, pitchMult: 0.96 };
    case MoveId.Nair:
    case MoveId.Fair:
    case MoveId.Bair:
    case MoveId.Uair:
    case MoveId.Dair:
      return { soundId: SoundId.SwingLight, gainScale: 0.76, pitchMult: 1.04 };
    case MoveId.Grab:
    case MoveId.Fthrow:
    case MoveId.Bthrow:
    case MoveId.Uthrow:
    case MoveId.Dthrow:
    case MoveId.Ledge:
    case MoveId.Getup:
      return { soundId: SoundId.SwingLight, gainScale: 0.65, pitchMult: 1.18 };
    default:
      assertNever(moveId, 'selectSwingSound.move');
  }
}

function tintTowardWhite(hex: string, mix: number): string {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  if (!Number.isFinite(n)) return '#B8E0FF';
  const r = Math.min(255, Math.round(((n >> 16) & 255) * (1 - mix) + 255 * mix));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * (1 - mix) + 255 * mix));
  const b = Math.min(255, Math.round((n & 255) * (1 - mix) + 255 * mix));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Builds a 3D Smash swoosh crescent aligned directly to the move's real hitbox trajectory. */
export function buildSlashForMove(fighter: FighterRuntime, liveryHex: string): SlashOptions | null {
  if (fighter.activeMove === MoveId.None) return null;
  const move = getMoveSpec(fighter.id, fighter.activeMove);
  if (move.moveClass === MoveClass.Grab || move.moveClass === MoveClass.Throw) return null;
  if (fighter.id === FighterId.Earl && move.id === MoveId.Dspec) return null;
  if (fighter.id === FighterId.Moss && move.id === MoveId.Dspec) return null;

  const pal = getGameData().palette;
  const elem = getElementalFighter(fighter.id);
  const facing = (fighter.flags & FighterFlag.FacingRight) !== 0 ? 1 : -1;
  const hb = getMoveHitbox(fighter, move);
  const cx = (hb.x0 + hb.x1) * 0.5;
  const cy = (hb.y0 + hb.y1) * 0.5;
  const isHeavy = move.moveClass === MoveClass.Heavy;
  const colorHex = isHeavy
    ? elem.heavySlashHex
    : move.moveClass === MoveClass.Special
      ? elem.slashHex
      : move.id === MoveId.Jab1 || move.id === MoveId.Jab2
        ? tintTowardWhite(elem.slashHex, 0.45)
        : tintTowardWhite(elem.slashHex, 0.18) || tintTowardWhite(liveryHex, 0.56) || pal.accents['gilt_hi']!;
  const radius = Math.min(1.18, Math.max(0.72, move.reach * (isHeavy ? 0.56 : 0.48)));
  const durationFrames = isHeavy ? 11 : 8;
  const thickness = isHeavy ? 1.12 : 0.96;

  switch (move.id) {
    case MoveId.Utilt:
    case MoveId.Uheavy:
    case MoveId.Uair:
    case MoveId.Uspec:
      return {
        x: fighter.x + facing * 0.16,
        y: Math.max(fighter.y + 0.82, cy - 0.06),
        radius: radius * 0.92,
        angle: facing > 0 ? Math.PI * 0.24 : Math.PI * 0.76,
        sweepRad: facing * 0.72,
        colorHex,
        durationFrames,
        thickness,
        flipY: facing < 0,
      };
    case MoveId.Dtilt:
      return {
        x: cx,
        y: fighter.y + 0.42,
        radius: radius * 0.84,
        angle: facing > 0 ? -0.26 : Math.PI + 0.26,
        sweepRad: facing * 0.48,
        colorHex,
        durationFrames,
        thickness: thickness * 0.92,
        flipY: facing < 0,
      };
    case MoveId.Dair:
      return {
        x: fighter.x,
        y: fighter.y + 0.24,
        radius: radius * 0.88,
        angle: -Math.PI * 0.5 - facing * 0.32,
        sweepRad: facing * 0.78,
        colorHex,
        durationFrames,
        thickness,
        flipY: facing < 0,
      };
    case MoveId.Bair:
      return {
        x: cx,
        y: Math.max(fighter.y + 0.75, cy),
        radius,
        angle: facing > 0 ? Math.PI + 0.32 : -0.32,
        sweepRad: -facing * 0.78,
        colorHex,
        durationFrames,
        thickness,
        flipY: facing > 0,
      };
    case MoveId.Nair:
    case MoveId.Dheavy:
      return {
        x: fighter.x,
        y: Math.max(fighter.y + 0.76, cy),
        radius: radius * 0.96,
        angle: facing > 0 ? -0.35 : Math.PI + 0.35,
        sweepRad: facing * Math.PI * 1.4,
        colorHex,
        durationFrames: durationFrames + 2,
        thickness,
        flipY: false,
      };
    default: {
      // Forward swings (Jab1/Jab2/Jab3/Ftilt/Fheavy/Fair/Dash/Sspec/Nspec)
      const flip = move.id === MoveId.Jab2 ? facing > 0 : facing < 0;
      const startOff = move.id === MoveId.Jab2 ? -0.36 : 0.36;
      const yLift = fighter.id === FighterId.Grog ? 0.34 : 0.10;
      return {
        x: fighter.x + facing * Math.max(0.36, move.reach * 0.28),
        y: Math.max(fighter.y + 0.82, cy + yLift),
        radius,
        angle: facing > 0 ? startOff : Math.PI - startOff,
        sweepRad: facing * (move.id === MoveId.Jab2 ? 0.78 : -0.78),
        colorHex,
        durationFrames,
        thickness,
        flipY: flip,
      };
    }
  }
}

export interface HitFeedbackInput {
  readonly attacker: FighterRuntime | undefined;
  readonly defender: FighterRuntime | undefined;
  readonly damage: number;
  readonly moveId: MoveId;
  readonly launchSpeed: number;
  readonly defenderColorHex: string;
  readonly allowLoudFx: boolean;
  readonly nowMs: number;
  readonly comboCount?: number;
}

/** Fires coordinated Smash hit VFX + SFX + directional camera kick at the exact defender contact point. */
export function triggerHitFeedback(
  input: HitFeedbackInput,
  vfx: VfxSystem,
  camera: CameraController,
  audio: AudioEngine,
): HitTier {
  const pal = getGameData().palette;
  const contact = computeHitContactPoint(input.attacker, input.defender, input.moveId);
  const tier = classifyHitImpact(input.damage, input.attacker?.id ?? null, input.moveId, input.launchSpeed);
  const pan = Math.max(-0.6, Math.min(0.6, contact.x / 12));
  const basePitch = input.defender
    ? fighterPitchScale(input.defender.id, input.defender.nestaSize)
    : input.attacker
      ? fighterPitchScale(input.attacker.id, input.attacker.nestaSize)
      : 1.0;
  // Rising musical pitch on consecutive combo hits makes multi-hit strings audibly exhilarating!
  const comboSteps = Math.max(0, (input.comboCount ?? 1) - 1);
  const pitchScale = basePitch * (1 + Math.min(0.24, comboSteps * 0.05));

  if (input.allowLoudFx) {
    const soundId =
      tier >= HitTier.Heavy ? SoundId.HitHeavy : tier === HitTier.Mid ? SoundId.HitMid : SoundId.HitLight;
    audio.play(soundId, { pan, pitchScale, gainScale: tier === HitTier.KillSpark ? 1.12 : 1.0 });
  }

  const boneHex = pal.neutrals['bone']!;
  const giltHex = pal.accents['gilt_hi'] ?? pal.accents['gilt']!;
  const redHex = pal.accents['stamp_red']!;

  if (tier === HitTier.KillSpark) {
    vfx.spawnKillSpark(contact.x, contact.y, contact.dirX, contact.dirY);
    vfx.spawnChips(contact.x, contact.y, 14, input.defenderColorHex, 15, contact.dirX, contact.dirY);
    vfx.spawnDust(contact.x, contact.y, 5, boneHex, 0.42);
    if (input.allowLoudFx) {
      camera.addTrauma(0.52);
      camera.kick(contact.dirX, contact.dirY, 0.85, 0.85);
      vfx.triggerImpactFrame(5, input.nowMs);
    }
  } else if (tier === HitTier.Heavy) {
    vfx.spawnHitSparks(contact.x, contact.y, contact.dirX, contact.dirY, 12, boneHex, redHex, 17);
    vfx.spawnChips(contact.x, contact.y, 11, input.defenderColorHex, 13, contact.dirX, contact.dirY);
    vfx.spawnRing(contact.x, contact.y, redHex, 2.35, 15);
    vfx.spawnRing(contact.x, contact.y, giltHex, 1.45, 10);
    vfx.spawnDust(contact.x, contact.y, 3, boneHex, 0.34);
    if (input.allowLoudFx) {
      camera.addTrauma(0.36);
      camera.kick(contact.dirX, contact.dirY, 0.58, 0.42);
      if (input.damage >= 14) vfx.triggerImpactFrame(4, input.nowMs);
    }
  } else if (tier === HitTier.Mid) {
    vfx.spawnHitSparks(contact.x, contact.y, contact.dirX, contact.dirY, 8, boneHex, giltHex, 13);
    vfx.spawnChips(contact.x, contact.y, 7, input.defenderColorHex, 10, contact.dirX, contact.dirY);
    vfx.spawnRing(contact.x, contact.y, giltHex, 1.55, 11);
    if (input.allowLoudFx) {
      camera.addTrauma(0.18);
      camera.kick(contact.dirX, contact.dirY, 0.30, 0.14);
    }
  } else {
    vfx.spawnHitSparks(contact.x, contact.y, contact.dirX, contact.dirY, 5, boneHex, giltHex, 10);
    vfx.spawnChips(contact.x, contact.y, 4, input.defenderColorHex, 8, contact.dirX, contact.dirY);
    vfx.spawnRing(contact.x, contact.y, boneHex, 1.05, 8);
    if (input.allowLoudFx) {
      camera.addTrauma(0.09);
      camera.kick(contact.dirX, contact.dirY, 0.14, 0);
    }
  }
  return tier;
}

/** Tracks per-fighter movement, attack swing arcs, charge sparks, and swing/footstep SFX cleanly outside app.ts. */
export class CombatFeedbackTracker {
  private readonly tracks = new Map<number, FighterMotionTrack>();

  public reset(): void {
    this.tracks.clear();
  }

  public updateFighter(
    f: FighterRuntime,
    liveryHex: string,
    allowAudio: boolean,
    vfx: VfxSystem,
    audio: AudioEngine,
  ): void {
    const pal = getGameData().palette;
    const grounded = (f.flags & FighterFlag.Grounded) !== 0;
    const fastFall = (f.flags & FighterFlag.FastFall) !== 0;
    const facingRight = (f.flags & FighterFlag.FacingRight) !== 0;
    const prev = this.tracks.get(f.slot);
    const pan = Math.max(-0.6, Math.min(0.6, f.x / 12));
    const pitchScale = fighterPitchScale(f.id, f.nestaSize);

    let stepCd = prev ? Math.max(0, prev.stepCd - 1) : 0;
    let chargeSparkCd = prev ? Math.max(0, prev.chargeSparkCd - 1) : 0;
    let slashFiredForMove = prev && prev.state === FighterState.Attack && prev.move === f.activeMove
      ? prev.slashFiredForMove
      : false;

    if (prev !== undefined) {
      // Movement dust, rings & audio
      if (prev.grounded && !grounded && f.vy > 2.5 && f.state !== FighterState.Hitstun && f.state !== FighterState.Tumble) {
        if (allowAudio) audio.play(SoundId.Jump, { pan, pitchScale, gainScale: 0.72 });
        vfx.spawnDust(f.x, f.y, 3);
      } else if (!prev.grounded && !grounded && prev.vy < 2.0 && f.vy > 6.0 && f.state !== FighterState.Hitstun && f.state !== FighterState.Tumble) {
        if (allowAudio) audio.play(SoundId.DoubleJump, { pan, pitchScale, gainScale: 0.75 });
        vfx.spawnRing(f.x, f.y, pal.neutrals['bone']!, 0.95, 10);
      } else if (!prev.grounded && grounded && prev.vy < -3.5) {
        if (allowAudio) audio.play(SoundId.Land, { pan, pitchScale, gainScale: Math.min(1, Math.abs(prev.vy) / 14) });
        vfx.spawnDust(f.x, f.y, 4);
      } else if (grounded && f.state === FighterState.Dash && (prev.state !== FighterState.Dash || prev.facingRight !== facingRight)) {
        // Tactile Smash dash-burst & Dash-Dance turnaround dust kick
        vfx.spawnDust(f.x, f.y, 3);
        if (allowAudio) audio.play(f.id === FighterId.Grog ? SoundId.StepStone : SoundId.StepChina, { pan, pitchScale: pitchScale * 1.12, gainScale: 0.34 });
        stepCd = 12;
      } else if (grounded && (f.state === FighterState.Run || f.state === FighterState.Dash) && stepCd === 0) {
        if (allowAudio) audio.play(f.id === FighterId.Grog ? SoundId.StepStone : SoundId.StepChina, { pan, pitchScale, gainScale: 0.26 });
        stepCd = 15;
      }

      // Classic Smash Fast-Fall twinkle spark on rising edge
      if (!grounded && fastFall && !prev.fastFall) {
        vfx.spawnFastFallSpark(f.x, f.y + 0.86);
      }

      // Air-Dodge & Brawlhalla Chase-Dodge directional streak glint
      if (f.state === FighterState.AirDodge && prev.state !== FighterState.AirDodge) {
        const isChase = f.chaseDodgeActive || Math.hypot(f.vx, f.vy) > 13.8;
        const glintCol = isChase
          ? (pal.accents['gilt_hi'] ?? pal.accents['gilt']!)
          : pal.neutrals['bone']!;
        vfx.spawnChaseGlint(f.x, f.y + 0.72, f.vx, f.vy, glintCol, isChase);
        if (allowAudio) {
          audio.play(SoundId.SwingLight, {
            pan,
            pitchScale: pitchScale * (isChase ? 1.38 : 1.15),
            gainScale: isChase ? 0.62 : 0.44,
          });
        }
      }

      // Smash heavy charge feedback: rising gilt sparks & subtle pulse cue
      if (f.state === FighterState.ChargingHeavy) {
        if (chargeSparkCd === 0) {
          vfx.spawnChargeSpark(f.x, f.y, pal.accents['gilt_hi'] ?? pal.accents['gilt']!);
          chargeSparkCd = 5;
        }
        if (prev.state !== FighterState.ChargingHeavy && allowAudio) {
          audio.play(SoundId.ChargePulse, { pan, pitchScale, gainScale: 0.52 });
        }
      }

      // Attack swing arc + tactile whoosh synced to active swing onset!
      if (f.state === FighterState.Attack && f.activeMove !== MoveId.None) {
        const moveSpec = getMoveSpec(f.id, f.activeMove);
        const startup = getEffectiveStartup(f, moveSpec, f.moveIsClean);
        const swingTriggerFrame = Math.max(1, startup - 1);
        const isFreshMove = prev.state !== FighterState.Attack || prev.move !== f.activeMove;

        // Play specials immediately on move start; play melee swing whoosh + slash arc right as strike snaps out!
        if (isFreshMove && moveSpec.moveClass === MoveClass.Special && allowAudio) {
          const cue = selectSwingSound(f.id, f.activeMove);
          if (cue) audio.play(cue.soundId, { pan, pitchScale: pitchScale * cue.pitchMult, gainScale: cue.gainScale });
        }

        if (!slashFiredForMove && f.moveFrame >= swingTriggerFrame) {
          slashFiredForMove = true;
          const slash = buildSlashForMove(f, liveryHex);
          if (slash) vfx.spawnSlash(slash);
          if (grounded && (moveSpec.moveClass === MoveClass.Heavy || f.activeMove === MoveId.Dash)) {
            vfx.spawnDust(f.x, f.y, 3);
          }
          if (moveSpec.moveClass !== MoveClass.Special && allowAudio) {
            const cue = selectSwingSound(f.id, f.activeMove);
            if (cue) audio.play(cue.soundId, { pan, pitchScale: pitchScale * cue.pitchMult, gainScale: cue.gainScale });
          }
        }
      }
    }

    this.tracks.set(f.slot, {
      state: f.state,
      grounded,
      fastFall,
      facingRight,
      vy: f.vy,
      move: f.activeMove,
      slashFiredForMove,
      stepCd,
      chargeSparkCd,
    });
  }
}
