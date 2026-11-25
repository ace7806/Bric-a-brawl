import { assert, requireKey } from '@sim/assert';
import { getFighterSpec, getGameData, getMoveSpec } from '@sim/data';
import {
  ALL_FIGHTER_IDS,
  ArenaId,
  CancelKind,
  ErrorCode,
  FighterFlag,
  FighterId,
  FighterState,
  InputBit,
  InputDir,
  MatchMode,
  MoveId,
  SimEventKind,
  TeamId,
} from '@sim/enums';
import { encodeInputMask } from '@sim/input';
import type { FighterRuntime } from '@sim/types';
import { SimWorld } from '@sim/world';

const DEFAULT_START_PERCENTS: readonly number[] = [0, 40, 80];
const MAX_COMBO_DEPTH = 13;
const BEAM_WIDTH = 16;
const MAX_STEP_TICKS = 90;
const MAX_KO_TRAIL_TICKS = 220;

const STARTER_MOVES: readonly MoveId[] = [
  MoveId.Jab1,
  MoveId.Ftilt,
  MoveId.Utilt,
  MoveId.Dtilt,
  MoveId.Uthrow,
  MoveId.Dthrow,
];

const FOLLOWUP_MOVES: readonly MoveId[] = [
  MoveId.Jab2,
  MoveId.Jab3,
  MoveId.Nspec,
  MoveId.Sspec,
  MoveId.Uspec,
  MoveId.Nair,
  MoveId.Fair,
  MoveId.Uair,
  MoveId.Fheavy,
];

export interface ComboBranchDetail {
  readonly startPercent: number;
  readonly hits: number;
  readonly damageDealt: number;
  readonly killed: boolean;
  readonly sequence: readonly MoveId[];
}

export interface ComboSearchResult {
  readonly fighterId: FighterId;
  readonly maxTrueComboHits: number;
  readonly killedFromZeroAtCentre: boolean;
  readonly longestSequence: MoveId[];
  readonly maxDamageFromZero: number;
  readonly branches: readonly ComboBranchDetail[];
}

interface SimOutcome {
  readonly valid: boolean;
  readonly hits: number;
  readonly damageDealt: number;
  readonly killed: boolean;
  readonly score: number;
  readonly stateKey: string;
}

function isVictimInCombo(v: FighterRuntime): boolean {
  return (
    ((v.state === FighterState.Hitstun || v.state === FighterState.Tumble) && v.hitstunFrames > 0) ||
    v.state === FighterState.Held
  );
}

function isAttackerActionable(a: FighterRuntime): boolean {
  return (
    a.state === FighterState.Idle ||
    a.state === FighterState.Walk ||
    a.state === FighterState.Dash ||
    a.state === FighterState.Run ||
    a.state === FighterState.Skid ||
    a.state === FighterState.Airborne ||
    a.state === FighterState.LandingLag
  );
}

function dirToward(dx: number): InputDir {
  if (dx > 0.15) return InputDir.Right;
  if (dx < -0.15) return InputDir.Left;
  return InputDir.Neutral;
}

function facingDirOf(f: FighterRuntime): InputDir {
  return (f.flags & FighterFlag.FacingRight) !== 0 ? InputDir.Right : InputDir.Left;
}

function isLegalFollowup(fighterId: FighterId, prevMove: MoveId, nextMove: MoveId): boolean {
  const moves = getFighterSpec(fighterId).moves;
  if (!moves.has(nextMove)) return false;
  if (nextMove === MoveId.Jab2) return prevMove === MoveId.Jab1;
  if (nextMove === MoveId.Jab3) return prevMove === MoveId.Jab2;
  return true;
}

function maskForStarter(moveId: MoveId): number {
  switch (moveId) {
    case MoveId.Jab1:
      return encodeInputMask(InputDir.Neutral, InputBit.Attack);
    case MoveId.Ftilt:
      return encodeInputMask(InputDir.Right, InputBit.Attack);
    case MoveId.Utilt:
      return encodeInputMask(InputDir.Up, InputBit.Attack);
    case MoveId.Dtilt:
      return encodeInputMask(InputDir.Down, InputBit.Attack);
    case MoveId.Uthrow:
    case MoveId.Dthrow:
      return encodeInputMask(InputDir.Neutral, InputBit.Grab);
    default:
      return encodeInputMask(InputDir.Neutral, InputBit.Attack);
  }
}

function chooseStepMask(
  fighterId: FighterId,
  atk: FighterRuntime,
  vic: FighterRuntime,
  prevMove: MoveId | null,
  moveId: MoveId,
  prevAtkMask: number,
  heavyChargingStarted: boolean,
): { mask: number; chargingDone: boolean } {
  const dx = vic.x - atk.x;
  const dy = vic.y - atk.y;
  const grounded = (atk.flags & FighterFlag.Grounded) !== 0;
  const move = getMoveSpec(fighterId, moveId);
  const chaseDir = dirToward(dx);

  if (prevMove === null) {
    if (atk.state === FighterState.Grabbing) {
      return {
        mask: encodeInputMask(moveId === MoveId.Uthrow ? InputDir.Up : InputDir.Down, 0),
        chargingDone: false,
      };
    }
    if (atk.state === FighterState.Idle) {
      return { mask: maskForStarter(moveId), chargingDone: false };
    }
    return { mask: 0, chargingDone: false };
  }

  // Chain cancel (Jab1 -> Jab2 -> Jab3)
  if (moveId === MoveId.Jab2 || moveId === MoveId.Jab3) {
    if (atk.state === FighterState.Attack && atk.activeMove === prevMove) {
      const prevSpec = getMoveSpec(fighterId, prevMove);
      if (atk.moveFrame >= prevSpec.startup && (prevAtkMask & InputBit.Attack) === 0) {
        return { mask: encodeInputMask(InputDir.Neutral, InputBit.Attack), chargingDone: false };
      }
      return { mask: 0, chargingDone: false };
    }
  }

  // Special cancel or link
  if (moveId === MoveId.Nspec || moveId === MoveId.Sspec || moveId === MoveId.Uspec) {
    const prevSpec = getMoveSpec(fighterId, prevMove);
    const canSpecialCancel =
      prevSpec.cancel === CancelKind.Special &&
      atk.state === FighterState.Attack &&
      atk.activeMove === prevMove &&
      atk.moveHitConnected;
    const readyToAct = isAttackerActionable(atk) && atk.state !== FighterState.LandingLag;
    const inRange =
      moveId === MoveId.Sspec
        ? Math.abs(dx) <= move.reach + 3.5 && Math.abs(dy) <= 1.8
        : Math.abs(dx) <= move.reach + 0.7 && Math.abs(dy) <= move.reach + 1.0;

    if (canSpecialCancel || (readyToAct && inRange)) {
      const dir =
        moveId === MoveId.Uspec
          ? InputDir.Up
          : moveId === MoveId.Sspec
            ? chaseDir === InputDir.Neutral
              ? facingDirOf(atk)
              : chaseDir
            : InputDir.Neutral;
      const bit = (prevAtkMask & InputBit.Special) === 0 ? InputBit.Special : 0;
      return { mask: encodeInputMask(dir, bit), chargingDone: false };
    }
    return { mask: encodeInputMask(chaseDir, 0), chargingDone: false };
  }

  // Aerials: jump if grounded, drift toward victim, attack in range
  if (moveId === MoveId.Nair || moveId === MoveId.Fair || moveId === MoveId.Uair) {
    if (grounded && atk.state !== FighterState.JumpSquat) {
      if (isAttackerActionable(atk) && atk.state !== FighterState.LandingLag) {
        const jumpBit = (prevAtkMask & InputBit.Jump) === 0 ? InputBit.Jump : 0;
        return { mask: encodeInputMask(chaseDir, jumpBit), chargingDone: false };
      }
      return { mask: encodeInputMask(chaseDir, 0), chargingDone: false };
    }
    if (atk.state === FighterState.JumpSquat) {
      return { mask: encodeInputMask(chaseDir, InputBit.Jump), chargingDone: false };
    }
    if (!grounded && isAttackerActionable(atk)) {
      const inRange =
        Math.abs(dx) <= move.reach + 0.75 &&
        (moveId === MoveId.Uair ? dy >= -0.3 && dy <= move.reach + 1.2 : Math.abs(dy) <= move.reach + 1.0);
      if (inRange) {
        const dir =
          moveId === MoveId.Uair
            ? InputDir.Up
            : moveId === MoveId.Fair
              ? chaseDir === InputDir.Neutral
                ? facingDirOf(atk)
                : chaseDir
              : InputDir.Neutral;
        const atkBit = (prevAtkMask & InputBit.Attack) === 0 ? InputBit.Attack : 0;
        return { mask: encodeInputMask(dir, atkBit), chargingDone: false };
      }
      return { mask: encodeInputMask(chaseDir, 0), chargingDone: false };
    }
    return { mask: encodeInputMask(chaseDir, 0), chargingDone: false };
  }

  // Grounded Fheavy link
  if (moveId === MoveId.Fheavy) {
    if (atk.state === FighterState.ChargingHeavy) {
      return { mask: 0, chargingDone: true };
    }
    if (grounded && isAttackerActionable(atk) && atk.state !== FighterState.LandingLag) {
      if (Math.abs(dx) <= move.reach + 0.55 && Math.abs(dy) <= 1.5 && !heavyChargingStarted) {
        const dir = chaseDir === InputDir.Neutral ? facingDirOf(atk) : chaseDir;
        const bit = (prevAtkMask & InputBit.Heavy) === 0 ? InputBit.Heavy : 0;
        return { mask: encodeInputMask(dir, bit), chargingDone: bit !== 0 };
      }
      return { mask: encodeInputMask(chaseDir, 0), chargingDone: false };
    }
    return { mask: encodeInputMask(chaseDir, 0), chargingDone: false };
  }

  return { mask: 0, chargingDone: false };
}

function simulateSequence(
  fighterId: FighterId,
  startPercent: number,
  seq: readonly MoveId[],
): SimOutcome {
  const world = new SimWorld({
    arenaId: ArenaId.Willow,
    mode: MatchMode.FreeForAll,
    fragile: false,
    seed: 1,
    fighters: [
      { slot: 0, id: fighterId, team: TeamId.None },
      { slot: 1, id: FighterId.Earl, team: TeamId.None },
    ],
    enableTierB: false,
    enableTierC: false,
    stocksOverride: 1,
  });

  try {
    const atk = world.fighters[0] as FighterRuntime;
    const vic = world.fighters[1] as FighterRuntime;
    atk.x = -0.55;
    atk.y = 0;
    atk.vx = 0;
    atk.vy = 0;
    atk.flags = FighterFlag.FacingRight | FighterFlag.Grounded;
    vic.x = 0.55;
    vic.y = 0;
    vic.vx = 0;
    vic.vy = 0;
    vic.damage = startPercent;
    vic.flags = FighterFlag.Grounded;
    world.step([0, 0]);

    let hits = 0;
    let prevMask = 0;
    let killed = false;

    for (let stepIdx = 0; stepIdx < seq.length; stepIdx++) {
      const moveId = seq[stepIdx] as MoveId;
      const prevMove = stepIdx > 0 ? (seq[stepIdx - 1] as MoveId) : null;
      let moveStarted = false;
      let moveConnected = false;
      let heavyStarted = false;

      for (let t = 0; t < MAX_STEP_TICKS; t++) {
        if (stepIdx > 0 && !isVictimInCombo(vic)) {
          return { valid: false, hits, damageDealt: vic.damage - startPercent, killed: false, score: 0, stateKey: '' };
        }

        const stepChoice = chooseStepMask(fighterId, atk, vic, prevMove, moveId, prevMask, heavyStarted);
        if (stepChoice.chargingDone) heavyStarted = true;
        const atkMask = moveStarted && atk.state === FighterState.Attack ? 0 : stepChoice.mask;
        prevMask = atkMask;

        const events = world.step([atkMask, 0]);

        if (atk.activeMove === moveId && atk.state === FighterState.Attack) {
          moveStarted = true;
        }

        for (let e = 0; e < events.length; e++) {
          const ev = events[e]!;
          if (ev.kind === SimEventKind.Ko && ev.a === vic.slot) {
            killed = true;
            if (!moveConnected) hits++;
            return {
              valid: true,
              hits,
              damageDealt: vic.damage - startPercent,
              killed: true,
              score: hits * 1000 + 500,
              stateKey: `ko:${moveId}:${hits}`,
            };
          }
          if ((ev.kind === SimEventKind.Hit || ev.kind === SimEventKind.Throw) && ev.a === atk.slot && ev.b === vic.slot) {
            moveConnected = true;
            hits++;
          }
        }

        if (moveConnected) break;
        if (moveStarted && atk.state !== FighterState.Attack && atk.state !== FighterState.ChargingHeavy && atk.state !== FighterState.Grabbing) {
          return { valid: false, hits, damageDealt: vic.damage - startPercent, killed: false, score: 0, stateKey: '' };
        }
      }

      if (!moveConnected) {
        return { valid: false, hits, damageDealt: vic.damage - startPercent, killed: false, score: 0, stateKey: '' };
      }
    }

    // Check whether the final hit launches victim to a true KO before recovering
    let trailPrevMask = 0;
    let trailUsedUp = false;
    for (let t = 0; t < MAX_KO_TRAIL_TICKS; t++) {
      let vicMask = 0;
      if (!isVictimInCombo(vic) && (vic.flags & FighterFlag.Grounded) === 0 && vic.state !== FighterState.Teaspoon) {
        const inward = vic.x > 0.2 ? InputDir.Left : vic.x < -0.2 ? InputDir.Right : InputDir.Neutral;
        if (Math.abs(vic.x) > 10.5) {
          if (vic.doubleJumpsLeft > 0 && (trailPrevMask & InputBit.Jump) === 0) {
            vicMask = encodeInputMask(inward, InputBit.Jump);
          } else if (!trailUsedUp && vic.y < 0.2) {
            vicMask = encodeInputMask(InputDir.Up, InputBit.Special);
            trailUsedUp = true;
          } else {
            vicMask = encodeInputMask(inward, 0);
          }
        } else {
          vicMask = encodeInputMask(inward, 0);
        }
      }
      trailPrevMask = vicMask;
      const events = world.step([0, vicMask]);
      for (let e = 0; e < events.length; e++) {
        const ev = events[e]!;
        if (ev.kind === SimEventKind.Ko && ev.a === vic.slot) {
          killed = true;
          break;
        }
      }
      if (killed || (vic.flags & FighterFlag.Grounded) !== 0 || vic.state === FighterState.LedgeHang) break;
    }

    const dist = Math.hypot(vic.x - atk.x, vic.y - atk.y);
    const dmgDealt = vic.damage - startPercent;
    const score = vic.hitstunFrames * 3 - dist * 5 + dmgDealt * 0.5 + (killed ? 500 : 0);
    const lastMove = seq[seq.length - 1] as MoveId;
    const stateKey = `${lastMove}:${Math.round(vic.x * 2)}:${Math.round(vic.y * 2)}:${Math.round(vic.damage)}`;
    return { valid: true, hits, damageDealt: dmgDealt, killed, score, stateKey };
  } finally {
    world.dispose();
  }
}

export function searchFighterCombos(
  fighterId: FighterId,
  startPercents: readonly number[] = DEFAULT_START_PERCENTS,
): ComboSearchResult {
  getGameData();
  const spec = getFighterSpec(fighterId);
  assert(startPercents.length > 0, ErrorCode.InvariantViolation, 'startPercents must be non-empty');

  let maxTrueComboHits = 0;
  let killedFromZeroAtCentre = false;
  let maxDamageFromZero = 0;
  let longestSequence: MoveId[] = [];
  const branches: ComboBranchDetail[] = [];

  for (const pct of startPercents) {
    assert(Number.isFinite(pct) && pct >= 0, ErrorCode.InvariantViolation, `Invalid startPercent ${pct}`);

    interface BeamNode {
      readonly seq: MoveId[];
      readonly outcome: SimOutcome;
    }

    let frontier: BeamNode[] = [];
    for (const starter of STARTER_MOVES) {
      const baseMove = starter === MoveId.Uthrow || starter === MoveId.Dthrow ? MoveId.Grab : starter;
      if (!spec.moves.has(baseMove) || !spec.moves.has(starter)) continue;
      const seq = [starter];
      const outcome = simulateSequence(fighterId, pct, seq);
      if (!outcome.valid) continue;
      frontier.push({ seq, outcome });
    }

    for (let depth = 1; depth <= MAX_COMBO_DEPTH && frontier.length > 0; depth++) {
      for (const node of frontier) {
        const { outcome, seq } = node;
        if (outcome.hits > maxTrueComboHits) {
          maxTrueComboHits = outcome.hits;
          longestSequence = [...seq];
        }
        if (pct === 0) {
          if (outcome.killed) killedFromZeroAtCentre = true;
          if (outcome.damageDealt > maxDamageFromZero) maxDamageFromZero = outcome.damageDealt;
        }
        branches.push({
          startPercent: pct,
          hits: outcome.hits,
          damageDealt: Number(outcome.damageDealt.toFixed(1)),
          killed: outcome.killed,
          sequence: [...seq],
        });
      }

      if (depth === MAX_COMBO_DEPTH) break;

      const nextCandidates: BeamNode[] = [];
      const seenKeys = new Set<string>();
      for (const node of frontier) {
        if (node.outcome.killed) continue;
        const prevMove = node.seq[node.seq.length - 1] as MoveId;
        for (const nextMove of FOLLOWUP_MOVES) {
          if (!isLegalFollowup(fighterId, prevMove, nextMove)) continue;
          const nextSeq = [...node.seq, nextMove];
          const outcome = simulateSequence(fighterId, pct, nextSeq);
          if (!outcome.valid) continue;
          if (seenKeys.has(outcome.stateKey)) continue;
          seenKeys.add(outcome.stateKey);
          nextCandidates.push({ seq: nextSeq, outcome });
        }
      }

      nextCandidates.sort((a, b) => b.outcome.score - a.outcome.score);
      frontier = nextCandidates.slice(0, BEAM_WIDTH);
    }
  }

  return {
    fighterId,
    maxTrueComboHits,
    killedFromZeroAtCentre,
    longestSequence,
    maxDamageFromZero: Number(maxDamageFromZero.toFixed(1)),
    branches,
  };
}

export function runAllComboSearches(): ComboSearchResult[] {
  const results: ComboSearchResult[] = [];
  for (const id of ALL_FIGHTER_IDS) {
    requireKey(getGameData().fighters, id, 'fighters');
    results.push(searchFighterCombos(id));
  }
  return results;
}
