import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getFighterSpec, getGameData } from '@sim/data';
import { FighterFlag, FighterId, FighterState, InputBit, InputDir, MoveId, NestaSize, SimEventKind, TeamId } from '@sim/enums';
import { mask, tape } from '../support/inputs';
import { createMatch, disposeAllWorlds, ensurePhysics, positionPair, runTape } from '../support/world';

interface OnBlockCase {
  readonly label: string;
  readonly attackerId: FighterId;
  readonly moveId: MoveId;
  readonly dir: InputDir;
  readonly bit: InputBit;
  readonly x0: number;
  readonly x1: number;
}

const ON_BLOCK_CASES: readonly OnBlockCase[] = [
  // Earl
  { label: 'Earl.Jab1', attackerId: FighterId.Earl, moveId: MoveId.Jab1, dir: InputDir.Neutral, bit: InputBit.Attack, x0: 0, x1: 1.0 },
  { label: 'Earl.Ftilt', attackerId: FighterId.Earl, moveId: MoveId.Ftilt, dir: InputDir.Right, bit: InputBit.Attack, x0: 0, x1: 1.1 },
  { label: 'Earl.Utilt', attackerId: FighterId.Earl, moveId: MoveId.Utilt, dir: InputDir.Up, bit: InputBit.Attack, x0: 0, x1: 0.75 },
  { label: 'Earl.Dtilt', attackerId: FighterId.Earl, moveId: MoveId.Dtilt, dir: InputDir.Down, bit: InputBit.Attack, x0: 0, x1: 1.0 },
  { label: 'Earl.Fheavy', attackerId: FighterId.Earl, moveId: MoveId.Fheavy, dir: InputDir.Right, bit: InputBit.Heavy, x0: 0, x1: 1.2 },
  { label: 'Earl.Uheavy', attackerId: FighterId.Earl, moveId: MoveId.Uheavy, dir: InputDir.Up, bit: InputBit.Heavy, x0: 0, x1: 0.75 },
  { label: 'Earl.Sspec', attackerId: FighterId.Earl, moveId: MoveId.Sspec, dir: InputDir.Right, bit: InputBit.Special, x0: 0, x1: 1.5 },
  // Grog
  { label: 'Grog.Jab1', attackerId: FighterId.Grog, moveId: MoveId.Jab1, dir: InputDir.Neutral, bit: InputBit.Attack, x0: 0, x1: 1.4 },
  { label: 'Grog.Ftilt', attackerId: FighterId.Grog, moveId: MoveId.Ftilt, dir: InputDir.Right, bit: InputBit.Attack, x0: 0, x1: 1.5 },
  { label: 'Grog.Utilt', attackerId: FighterId.Grog, moveId: MoveId.Utilt, dir: InputDir.Up, bit: InputBit.Attack, x0: 0, x1: 1.15 },
  { label: 'Grog.Dtilt', attackerId: FighterId.Grog, moveId: MoveId.Dtilt, dir: InputDir.Down, bit: InputBit.Attack, x0: 0, x1: 1.4 },
  { label: 'Grog.Fheavy', attackerId: FighterId.Grog, moveId: MoveId.Fheavy, dir: InputDir.Right, bit: InputBit.Heavy, x0: 0, x1: 1.7 },
  { label: 'Grog.Uheavy', attackerId: FighterId.Grog, moveId: MoveId.Uheavy, dir: InputDir.Up, bit: InputBit.Heavy, x0: 0, x1: 1.15 },
  { label: 'Grog.Dheavy', attackerId: FighterId.Grog, moveId: MoveId.Dheavy, dir: InputDir.Down, bit: InputBit.Heavy, x0: 0, x1: 1.5 },
  // Nesta (Mid baseline)
  { label: 'Nesta.Jab1', attackerId: FighterId.Nesta, moveId: MoveId.Jab1, dir: InputDir.Neutral, bit: InputBit.Attack, x0: 0, x1: 1.0 },
  { label: 'Nesta.Ftilt', attackerId: FighterId.Nesta, moveId: MoveId.Ftilt, dir: InputDir.Right, bit: InputBit.Attack, x0: 0, x1: 1.1 },
  { label: 'Nesta.Utilt', attackerId: FighterId.Nesta, moveId: MoveId.Utilt, dir: InputDir.Up, bit: InputBit.Attack, x0: 0, x1: 0.8 },
  { label: 'Nesta.Dtilt', attackerId: FighterId.Nesta, moveId: MoveId.Dtilt, dir: InputDir.Down, bit: InputBit.Attack, x0: 0, x1: 1.0 },
  { label: 'Nesta.Fheavy', attackerId: FighterId.Nesta, moveId: MoveId.Fheavy, dir: InputDir.Right, bit: InputBit.Heavy, x0: 0, x1: 1.2 },
  { label: 'Nesta.Uheavy', attackerId: FighterId.Nesta, moveId: MoveId.Uheavy, dir: InputDir.Up, bit: InputBit.Heavy, x0: 0, x1: 0.8 },
  { label: 'Nesta.Dheavy', attackerId: FighterId.Nesta, moveId: MoveId.Dheavy, dir: InputDir.Down, bit: InputBit.Heavy, x0: 0, x1: 1.2 },
  // Moss
  { label: 'Moss.Jab1', attackerId: FighterId.Moss, moveId: MoveId.Jab1, dir: InputDir.Neutral, bit: InputBit.Attack, x0: 0, x1: 1.2 },
  { label: 'Moss.Ftilt', attackerId: FighterId.Moss, moveId: MoveId.Ftilt, dir: InputDir.Right, bit: InputBit.Attack, x0: 0, x1: 1.5 },
  { label: 'Moss.Utilt', attackerId: FighterId.Moss, moveId: MoveId.Utilt, dir: InputDir.Up, bit: InputBit.Attack, x0: 0, x1: 0.75 },
  { label: 'Moss.Dtilt', attackerId: FighterId.Moss, moveId: MoveId.Dtilt, dir: InputDir.Down, bit: InputBit.Attack, x0: 0, x1: 1.0 },
  { label: 'Moss.Fheavy', attackerId: FighterId.Moss, moveId: MoveId.Fheavy, dir: InputDir.Right, bit: InputBit.Heavy, x0: 0, x1: 1.8 },
  { label: 'Moss.Uheavy', attackerId: FighterId.Moss, moveId: MoveId.Uheavy, dir: InputDir.Up, bit: InputBit.Heavy, x0: 0, x1: 0.75 },
  { label: 'Moss.Dheavy', attackerId: FighterId.Moss, moveId: MoveId.Dheavy, dir: InputDir.Down, bit: InputBit.Heavy, x0: 0, x1: 1.2 },
];

interface KoCase {
  readonly label: string;
  readonly attackerId: FighterId;
  readonly moveId: MoveId;
}

const KO_CASES: readonly KoCase[] = [
  { label: 'Earl.Fheavy', attackerId: FighterId.Earl, moveId: MoveId.Fheavy },
  { label: 'Earl.Bair', attackerId: FighterId.Earl, moveId: MoveId.Bair },
  { label: 'Grog.Fheavy', attackerId: FighterId.Grog, moveId: MoveId.Fheavy },
  { label: 'Grog.Bthrow', attackerId: FighterId.Grog, moveId: MoveId.Bthrow },
  { label: 'Nesta.Fheavy', attackerId: FighterId.Nesta, moveId: MoveId.Fheavy },
  { label: 'Nesta.Bair', attackerId: FighterId.Nesta, moveId: MoveId.Bair },
  { label: 'Moss.Fheavy', attackerId: FighterId.Moss, moveId: MoveId.Fheavy },
  { label: 'Moss.Bthrow', attackerId: FighterId.Moss, moveId: MoveId.Bthrow },
];

function measureActualOnBlock(c: OnBlockCase): { actualOnBlock: number; blocked: boolean } {
  const world = createMatch({
    fighters: [
      { slot: 0, id: c.attackerId, team: TeamId.None },
      { slot: 1, id: FighterId.Earl, team: TeamId.None },
    ],
  });
  positionPair(world, c.x0, c.x1);
  const atk = world.fighters[0]!;
  const def = world.fighters[1]!;
  if (c.attackerId === FighterId.Nesta) {
    atk.nestaSize = NestaSize.Mid;
    atk.guardHp = getFighterSpec(FighterId.Nesta).nestaSizes!.get(NestaSize.Mid)!.guardHP;
  }

  // Defender holds Guard for 6+ ticks first so parry window expires before strike hits.
  const atkTape = tape().wait(6).tap(c.dir, c.bit).build();
  const defMask = mask(InputDir.Neutral, InputBit.Guard);

  let blocked = false;
  let blockstunTicks = 0;
  let atkRecoveryTicks = 0;

  for (let t = 0; t < 110; t++) {
    const events = world.step([atkTape[t] ?? 0, defMask]);
    if (blocked) {
      if (def.hitstopFrames > 0 || atk.hitstopFrames > 0) continue;
      if (def.state === FighterState.GuardStun) blockstunTicks++;
      if (atk.state === FighterState.Attack) atkRecoveryTicks++;
      if (def.state !== FighterState.GuardStun && atk.state !== FighterState.Attack) break;
    } else if (events.some((e) => e.kind === SimEventKind.Block && e.a === 0 && e.b === 1)) {
      blocked = true;
    }
  }
  return { actualOnBlock: blockstunTicks - atkRecoveryTicks, blocked };
}

function runFinisherAtPercent(
  attackerId: FighterId,
  moveId: MoveId,
  startX: number,
  initialDamage: number,
): boolean {
  // 5 fighters keeps W12 (x=10.83..13.0) intact at tick 0 so grounded x=12 matches data/fighters.json.
  const world = createMatch({
    stocksOverride: 1,
    fighters: [
      { slot: 0, id: attackerId, team: TeamId.None },
      { slot: 1, id: FighterId.Earl, team: TeamId.None },
      { slot: 2, id: FighterId.Earl, team: TeamId.None },
      { slot: 3, id: FighterId.Earl, team: TeamId.None },
      { slot: 4, id: FighterId.Earl, team: TeamId.None },
    ],
  });
  const atk = world.fighters[0]!;
  const def = world.fighters[1]!;
  const offset = moveId === MoveId.Bthrow ? -1.0 : moveId === MoveId.Bair ? -0.9 : -1.2;
  positionPair(world, startX + offset, startX);
  world.fighters[2]!.x = -12;
  world.fighters[3]!.x = -10;
  world.fighters[4]!.x = -8;
  if (attackerId === FighterId.Nesta) atk.nestaSize = NestaSize.Mid;
  def.damage = initialDamage;

  let atkTape: readonly number[];
  if (moveId === MoveId.Fheavy) {
    atkTape = tape().tap(InputDir.Right, InputBit.Heavy).build();
  } else if (moveId === MoveId.Bair) {
    atk.flags &= ~FighterFlag.FacingRight;
    atkTape = tape().tap(InputDir.Neutral, InputBit.Jump).wait(21).tap(InputDir.Right, InputBit.Attack).build();
  } else {
    // Bthrow: face right, grab, then tap Left on grab connect to throw toward +X blast zone.
    const grabStartup = getFighterSpec(attackerId).moves.get(MoveId.Grab)!.startup;
    atkTape = tape().tap(InputDir.Right, InputBit.Grab).wait(grabStartup).tap(InputDir.Left).build();
  }

  let hitRegistered = false;
  let usedDoubleJump = false;
  let usedUpSpec = false;
  let prevDefInput = 0;

  for (let t = 0; t < 260; t++) {
    let defInput = 0;
    if (hitRegistered && def.stocks > 0 && def.state !== FighterState.Teaspoon) {
      const canAct = def.state === FighterState.Airborne || (def.state === FighterState.Tumble && def.hitstunFrames <= 0);
      if (canAct && def.x > 10.5) {
        if (!usedDoubleJump && def.doubleJumpsLeft > 0 && (prevDefInput & InputBit.Jump) === 0) {
          defInput = mask(InputDir.Left, InputBit.Jump);
          usedDoubleJump = true;
        } else if (!usedUpSpec && def.y < 0.2) {
          defInput = mask(InputDir.Up, InputBit.Special);
          usedUpSpec = true;
        } else {
          defInput = mask(InputDir.Left);
        }
      } else if (canAct) {
        defInput = mask(InputDir.Left);
      }
    }
    prevDefInput = defInput;
    const events = world.step([atkTape[t] ?? 0, defInput, 0, 0, 0]);
    if (events.some((e) => e.kind === SimEventKind.Hit && e.a === 0 && e.b === 1)) {
      hitRegistered = true;
    }
    if (def.stocks === 0 || events.some((e) => e.kind === SimEventKind.Ko && e.a === 1)) {
      expect(hitRegistered).toBe(true);
      return true;
    }
  }
  expect(hitRegistered).toBe(true);
  return false;
}

describe('M2.3 Frame-Data & KO% Tape Verification', () => {
  beforeAll(async () => {
    await ensurePhysics();
  });

  afterEach(() => {
    disposeAllWorlds();
  });

  it.each(ON_BLOCK_CASES)('onBlock matches data/fighters.json and is <= -7 for $label', (c) => {
    const move = getFighterSpec(c.attackerId).moves.get(c.moveId)!;
    expect(move.onBlock).not.toBeNull();
    const { actualOnBlock, blocked } = measureActualOnBlock(c);
    expect(blocked).toBe(true);
    expect(actualOnBlock).toBe(move.onBlock);
    expect(actualOnBlock).toBeLessThanOrEqual(-7);
  });

  it('enforces Pillar 4: every non-grab move with onBlock in data/fighters.json is <= -7', () => {
    const fighters = getGameData().fighters;
    for (const [fid, spec] of fighters) {
      for (const [mid, mv] of spec.moves) {
        if (mv.onBlock !== null) {
          expect(mv.onBlock, `Fighter ${fid} Move ${mid} onBlock <= -7`).toBeLessThanOrEqual(-7);
        }
      }
    }
  });

  it.each(KO_CASES)('KO percent at centre and ledge is within ±3 pts of data/fighters.json for $label', ({ attackerId, moveId }) => {
    const move = getFighterSpec(attackerId).moves.get(moveId)!;
    expect(move.koCentre).not.toBeNull();
    expect(move.koLedge).not.toBeNull();

    const centrePct = move.koCentre!;
    expect(runFinisherAtPercent(attackerId, moveId, 0, centrePct + 3), `${attackerId}.${moveId} centre +3 KOs`).toBe(true);
    expect(runFinisherAtPercent(attackerId, moveId, 0, Math.max(0, centrePct - 4)), `${attackerId}.${moveId} centre -4 survives`).toBe(false);

    const ledgePct = move.koLedge!;
    expect(runFinisherAtPercent(attackerId, moveId, 12, ledgePct + 3), `${attackerId}.${moveId} ledge +3 KOs`).toBe(true);
    expect(runFinisherAtPercent(attackerId, moveId, 12, Math.max(0, ledgePct - 4)), `${attackerId}.${moveId} ledge -4 survives`).toBe(false);
  });

  it('runs clean Tape execution via runTape without violating invariants', () => {
    const world = createMatch();
    positionPair(world, -1.0, 0.2);
    const events = runTape(world, [tape().wait(2).tap(InputDir.Right, InputBit.Attack).build(), tape().wait(30).build()], 30);
    expect(events.some((e) => e.kind === SimEventKind.Hit)).toBe(true);
  });
});
