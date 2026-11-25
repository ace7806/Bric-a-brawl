import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildBotView } from '@bots/view';
import { getArenaSpec, getFighterSpec, getGameData } from '@sim/data';
import {
  ArenaId,
  ChunkState,
  FighterFlag,
  FighterId,
  FighterState,
  InputBit,
  InputDir,
  KoCause,
  MatchMode,
  MoveId,
  NestaSize,
  ProjectileKind,
  SimEventKind,
  TeamId,
} from '@sim/enums';
import { findChunkUnderPoint } from '@sim/island';
import { expectEvent, findEvents } from '../support/asserts';
import { tape } from '../support/inputs';
import { createMatch, disposeAllWorlds, ensurePhysics, positionPair, runTape, stepIdle } from '../support/world';

describe('The 5 Pillars, Combat Rules & All 4 Fighter Gimmicks', () => {
  beforeAll(async () => {
    await ensurePhysics();
  });

  afterEach(() => {
    disposeAllWorlds();
  });

  it('Pillar 2 ("Everything chips"): slam bounce >=16 u/s, Tech halves crack & cancels bounce, Grog crackMult=2.0', () => {
    const { tuning } = getGameData();

    const runSlam = (attackerId: FighterId, tech: boolean) => {
      const world = createMatch({
        fighters: [
          { slot: 0, id: attackerId, team: TeamId.None },
          { slot: 1, id: FighterId.Earl, team: TeamId.None },
        ],
      });
      positionPair(world, 0, 2.0);
      const v = world.fighters[1]!;
      const chunkIdx = findChunkUnderPoint(world.island, v.x, 0);
      expect(chunkIdx).toBeGreaterThanOrEqual(0);
      const startHp = world.island.chunks[chunkIdx]!.hp;

      v.y = 0.6;
      v.flags &= ~FighterFlag.Grounded;
      v.state = FighterState.Tumble;
      v.hitstunFrames = 30;
      v.lastHitBySlot = 0;
      v.kbVx = 0;
      v.kbVy = -20.0;

      const events = runTape(world, [[], tech ? tape().tap(InputDir.Neutral, InputBit.Guard).build() : []], 4);
      const chunkDmg = startHp - world.island.chunks[chunkIdx]!.hp;
      return { world, v, events, chunkDmg };
    };

    const earlSlam = runSlam(FighterId.Earl, false);
    const bounceEv = expectEvent(earlSlam.events, SimEventKind.Bounce, (e) => e.a === 1);
    const impactSpeed = bounceEv.c / 8;
    expect(impactSpeed).toBeGreaterThanOrEqual(tuning.launch.bounceMinSpeed);
    expect(earlSlam.v.damage).toBeCloseTo(tuning.launch.bounceDamage, 4);
    expect(earlSlam.v.kbVy).toBeGreaterThan(10);
    expect(earlSlam.chunkDmg).toBeCloseTo(impactSpeed * 1.0, 1);

    const techSlam = runSlam(FighterId.Earl, true);
    expectEvent(techSlam.events, SimEventKind.Tech, (e) => e.a === 1);
    expect(findEvents(techSlam.events, SimEventKind.Bounce)).toHaveLength(0);
    expect(techSlam.v.damage).toBe(0);
    expect(techSlam.v.kbVy).toBe(0);
    expect(techSlam.v.state).toBe(FighterState.Idle);
    expect(techSlam.chunkDmg).toBeCloseTo(earlSlam.chunkDmg * tuning.terrain.crackTechMult, 1);

    const grogSlam = runSlam(FighterId.Grog, false);
    expect(grogSlam.chunkDmg).toBeCloseTo(earlSlam.chunkDmg * 2.0, 1);
  });

  it('Pillar 3 ("Shove, don\'t stab"): guard pushback (0.35x) slides defender off ledge & guard shatters at 0 HP', () => {
    const world = createMatch({
      fighters: [
        { slot: 0, id: FighterId.Grog, team: TeamId.None },
        { slot: 1, id: FighterId.Earl, team: TeamId.None },
      ],
    });
    // Near W11 right ledge (x=10.833 with 2 players; W12 is pre-dropped; y=0.02 stays below bough platform at y=3.0)
    positionPair(world, 9.2, 10.65, 0.02);
    const events = runTape(
      world,
      [tape().wait(6).tap(InputDir.Right, InputBit.Heavy).build(), tape().hold(45, InputDir.Neutral, InputBit.Guard).build()],
      45,
    );
    expectEvent(events, SimEventKind.Block, (e) => e.a === 0 && e.b === 1);
    const def = world.fighters[1]!;
    expect(def.x).toBeGreaterThan(10.833);
    expect((def.flags & FighterFlag.Grounded) === 0).toBe(true);

    // Guard drain & shatter at 0 HP -> GuardBreak
    const shatterWorld = createMatch();
    positionPair(shatterWorld, -2.0, 2.0);
    const sDef = shatterWorld.fighters[1]!;
    sDef.guardHp = 0.2;
    const shatterEvents = runTape(shatterWorld, [[], tape().hold(12, InputDir.Neutral, InputBit.Guard).build()], 12);
    expectEvent(shatterEvents, SimEventKind.GuardBreak, (e) => e.a === 1);
    expect(sDef.state).toBe(FighterState.GuardBreak);
  });

  it('Pillar 4 ("Honest frames"): 5f parry stuns attacker 30f, costs 0 guard, grants +15 Gilt, reflects 1.3x; 30f cooldown blocks flicker parry', () => {
    const { tuning } = getGameData();
    const world = createMatch();
    positionPair(world, 0, 1.0);
    const atk = world.fighters[0]!;
    const def = world.fighters[1]!;
    const startGuard = def.guardHp;

    // Jab1 startup is 4f; defender taps Guard on tick 3 so parry (5f) is active when Jab1 hits on tick 4.
    const parryEvs = runTape(
      world,
      [tape().tap(InputDir.Neutral, InputBit.Attack).build(), tape().wait(3).hold(6, InputDir.Neutral, InputBit.Guard).build()],
      12,
    );
    expectEvent(parryEvs, SimEventKind.Parry, (e) => e.a === 1 && e.b === 0);
    expect(atk.state).toBe(FighterState.ParryStun);
    expect(def.gilt).toBe(tuning.parry.giltGain);
    expect(def.guardHp).toBe(startGuard);

    // Verify ParryStun lasts 30f
    stepIdle(world, 29);
    expect(atk.state).toBe(FighterState.Idle);

    // Reflect projectile at 1.3x speed
    const projWorld = createMatch();
    positionPair(projWorld, -3.5, 0.5);
    const pDef = projWorld.fighters[1]!;
    const projEvs = runTape(
      projWorld,
      [tape().tap(InputDir.Neutral, InputBit.Special).build(), tape().wait(35).hold(6, InputDir.Neutral, InputBit.Guard).build()],
      50,
    );
    expectEvent(projEvs, SimEventKind.Parry, (e) => e.a === 1);
    expect(pDef.gilt).toBe(tuning.parry.giltGain);
    const steam = projWorld.gadgets.projectiles.find((p) => p.kind === ProjectileKind.SteamPuff);
    expect(steam).toBeDefined();
    expect(steam!.ownerSlot).toBe(1);
    expect(steam!.vx).toBeCloseTo(-7.0 * tuning.parry.projectileReflectSpeedMult, 4);

    // Flicker guard cooldown: releasing Guard sets 30f parryCooldown -> re-pressing Guard gives normal Guard, NOT Parry
    const cdWorld = createMatch();
    positionPair(cdWorld, 0, 1.0);
    const cdDef = cdWorld.fighters[1]!;
    const cdEvents = runTape(
      cdWorld,
      [
        tape().wait(10).tap(InputDir.Neutral, InputBit.Attack).build(),
        tape().tap(InputDir.Neutral, InputBit.Guard).wait(9).hold(10, InputDir.Neutral, InputBit.Guard).build(),
      ],
      22,
    );
    expect(cdDef.parryCooldown).toBeGreaterThan(0);
    expect(findEvents(cdEvents, SimEventKind.Parry)).toHaveLength(0);
    expectEvent(cdEvents, SimEventKind.Block, (e) => e.a === 0 && e.b === 1);
  });

  it('Grab beats Guard/Parry, simultaneous grabs tech apart, and Throw grants 60f regrab immunity', () => {
    // Grab beats Parry/Guard
    const w1 = createMatch();
    positionPair(w1, 0, 1.0);
    const ev1 = runTape(
      w1,
      [tape().tap(InputDir.Neutral, InputBit.Grab).build(), tape().wait(5).hold(8, InputDir.Neutral, InputBit.Guard).build()],
      12,
    );
    expectEvent(ev1, SimEventKind.Grab, (e) => e.a === 0 && e.b === 1);
    expect(w1.fighters[0]!.state).toBe(FighterState.Grabbing);
    expect(w1.fighters[1]!.state).toBe(FighterState.Held);

    // Throw grants 60f regrab immunity (next grab at frame 10 fails)
    const evThrow = runTape(w1, [tape().tap(InputDir.Right).build(), []], 10);
    expectEvent(evThrow, SimEventKind.Throw, (e) => e.a === 0 && e.b === 1);
    expect(w1.fighters[1]!.regrabImmunity).toBeGreaterThanOrEqual(48);
    positionPair(w1, 0, 1.0);
    w1.fighters[1]!.regrabImmunity = 30;
    const regrabAttempt = runTape(w1, [tape().tap(InputDir.Neutral, InputBit.Grab).build(), []], 12);
    expect(findEvents(regrabAttempt, SimEventKind.Grab)).toHaveLength(0);

    // Simultaneous grabs tech apart
    const w2 = createMatch();
    positionPair(w2, -0.6, 0.6);
    const techEvs = runTape(
      w2,
      [tape().tap(InputDir.Right, InputBit.Grab).build(), tape().tap(InputDir.Left, InputBit.Grab).build()],
      12,
    );
    expectEvent(techEvs, SimEventKind.Grab, (e) => e.c === 1);
    expect(w2.fighters[0]!.state).toBe(FighterState.Idle);
    expect(w2.fighters[1]!.state).toBe(FighterState.Idle);
  });

  it('Gilt Break at 100 Gilt escapes hitstun with 12f invuln, pushes nearby foes at 16 u/s, and resets Gilt', () => {
    const { gilt } = getGameData().tuning;
    const world = createMatch();
    positionPair(world, 0, 1.5);
    const f0 = world.fighters[0]!;
    const f1 = world.fighters[1]!;
    f0.state = FighterState.Hitstun;
    f0.hitstunFrames = 30;
    f0.gilt = gilt.breakerCost;

    const evs = runTape(world, [tape().tap(InputDir.Neutral, InputBit.Guard, InputBit.Special).build(), []], 2);
    expectEvent(evs, SimEventKind.GiltBreak, (e) => e.a === 0);
    expect(f0.gilt).toBe(0);
    expect(f0.invulnFrames).toBeGreaterThanOrEqual(gilt.breakerInvulnFrames - 2);
    expect((f0.flags & FighterFlag.Invuln) !== 0).toBe(true);
    expect(f0.state).toBe(FighterState.Idle);
    expect(f1.kbVx).toBeGreaterThan(14);
    expect(f1.state).toBe(FighterState.Hitstun);
  });

  it('Earl gimmick: Steep (50f / 35f clean 214+S) grants Piping upgrading Nspec & Uspec, lost on tumble', () => {
    const world = createMatch();
    positionPair(world, -3.0, 4.0);
    const earl = world.fighters[0]!;

    // Clean 214+S charges in 35f
    runTape(world, [tape().motion214(true, InputBit.Special).hold(38, InputDir.Down, InputBit.Special).build(), []], 42);
    expect(earl.pipingCharged).toBe(true);
    expect((earl.flags & FighterFlag.Piping) !== 0).toBe(true);

    // Piping Nspec fires upgraded SteamPuff (3 multi-hits x 3%, BKB 18)
    runTape(world, [tape().tap(InputDir.Neutral, InputBit.Special).build(), []], 18);
    const steam = world.gadgets.projectiles.find((p) => p.kind === ProjectileKind.SteamPuff);
    expect(steam).toBeDefined();
    expect(steam!.pipingMultiHits).toBe(3);
    expect(steam!.bkb).toBe(18);
    expect(earl.pipingCharged).toBe(false);
    stepIdle(world, 30);

    // Normal Steep charges in 50f, and is lost when launched into tumble
    runTape(world, [tape().hold(52, InputDir.Down, InputBit.Special).build(), []], 53);
    expect(earl.pipingCharged).toBe(true);
    positionPair(world, -1.2, 0.2);
    earl.pipingCharged = true;
    earl.flags |= FighterFlag.Piping;
    earl.damage = 60;
    runTape(world, [[], tape().tap(InputDir.Left, InputBit.Heavy).build()], 25);
    expect(earl.state).toBe(FighterState.Tumble);
    expect(earl.pipingCharged).toBe(false);
  });

  it('Grog gimmick: Stampede carries with armour and runs off ledge; Stamp deals +45*crackMult (+90) crack underfoot', () => {
    const world = createMatch({
      fighters: [
        { slot: 0, id: FighterId.Grog, team: TeamId.None },
        { slot: 1, id: FighterId.Earl, team: TeamId.None },
      ],
    });
    positionPair(world, 7.5, 9.5, 0.0);
    const grog = world.fighters[0]!;
    const earl = world.fighters[1]!;

    // Stamp (Dspec) deals 45 * crackMult(2.0) = 90 crack underfoot on Willow W10 (90 HP -> Loose!)
    const ci = findChunkUnderPoint(world.island, grog.x, grog.y);
    expect(ci).toBeGreaterThanOrEqual(0);
    runTape(world, [tape().tap(InputDir.Down, InputBit.Special).build(), []], 24);
    expect(world.island.chunks[ci]!.state).toBe(ChunkState.Loose);

    // Stampede carries victim with armour and does NOT stop at ledge (W11 right ledge x=10.833)
    positionPair(world, 7.2, 8.6);
    const stampEvs = runTape(world, [tape().hold(65, InputDir.Right, InputBit.Special).build(), []], 65);
    expect((grog.flags & FighterFlag.Armour) !== 0 || stampEvs.some((e) => e.kind === SimEventKind.Throw && e.a === 0)).toBe(true);
    expect(grog.x).toBeGreaterThan(10.833);
    expect(earl.damage).toBeGreaterThan(0);
  });

  it('Nesta gimmick: Shed steps Big -> Mid -> Small with 12f invuln & shell prop; Guard Break sheds instead of stunning', () => {
    const world = createMatch({
      fighters: [
        { slot: 0, id: FighterId.Nesta, team: TeamId.None },
        { slot: 1, id: FighterId.Earl, team: TeamId.None },
      ],
    });
    positionPair(world, -2.0, 3.0);
    const nesta = world.fighters[0]!;
    expect(nesta.nestaSize).toBe(NestaSize.Big);
    expect(nesta.shedsRemaining).toBe(2);

    // Shed via Dspec -> Mid, 12f invuln, spawns shell rubble
    const ev1 = runTape(world, [tape().tap(InputDir.Down, InputBit.Special).build(), []], 5);
    expectEvent(ev1, SimEventKind.Shed, (e) => e.a === 0 && e.b === NestaSize.Mid);
    expect(nesta.nestaSize).toBe(NestaSize.Mid);
    expect(nesta.invulnFrames).toBeGreaterThanOrEqual(7);
    expect(world.island.rubble.some((r) => r.isShell && r.ownerSlot === 0)).toBe(true);

    // Guard break on Mid -> sheds to Small instead of GuardBreak stun!
    positionPair(world, -2.0, 3.0);
    nesta.nestaSize = NestaSize.Mid;
    nesta.shedsRemaining = 1;
    nesta.guardHp = 0.1;
    const ev2 = runTape(world, [tape().hold(6, InputDir.Neutral, InputBit.Guard).build(), []], 6);
    expectEvent(ev2, SimEventKind.Shed, (e) => e.a === 0 && e.b === NestaSize.Small);
    expect(findEvents(ev2, SimEventKind.GuardBreak)).toHaveLength(0);
    expect(nesta.nestaSize).toBe(NestaSize.Small);
    expect(nesta.state).not.toBe(FighterState.GuardBreak);
  });

  it('Moss gimmick: Cast hooks fighter, Tether Cast zips to ledge (whiffs in empty air), Gone Fishin\' spawns rubble/boot/gadget', () => {
    const world = createMatch({
      fighters: [
        { slot: 0, id: FighterId.Moss, team: TeamId.None },
        { slot: 1, id: FighterId.Earl, team: TeamId.None },
      ],
    });
    positionPair(world, -2.0, 2.5);
    const moss = world.fighters[0]!;
    const earl = world.fighters[1]!;

    // Cast (Nspec) fires Hook and sticks to Earl, then Special reels and Attack yanks
    runTape(world, [tape().tap(InputDir.Neutral, InputBit.Special).build(), []], 35);
    const hook = world.gadgets.projectiles.find((p) => p.kind === ProjectileKind.Hook);
    expect(hook).toBeDefined();
    expect(hook!.stuckFighterSlot).toBe(1);
    const startX = earl.x;
    runTape(world, [tape().hold(5, InputDir.Neutral, InputBit.Special).tap(InputDir.Neutral, InputBit.Attack).build(), []], 8);
    expect(earl.x).toBeLessThan(startX);
    expect(earl.damage).toBe(getFighterSpec(FighterId.Moss).moves.get(MoveId.Nspec)!.damage);

    // Tether Cast (Uspec): empty air far offstage does NOT launch Moss upward; near ledge zips at 20 u/s
    positionPair(world, -2.0, 3.0);
    moss.x = -20.0;
    moss.y = -2.0;
    moss.flags &= ~FighterFlag.Grounded;
    moss.vy = 0;
    runTape(world, [tape().tap(InputDir.Up, InputBit.Special).build(), []], 12);
    expect(moss.vy).toBeLessThan(0);

    positionPair(world, -2.0, 3.0);
    moss.x = -12.5;
    moss.y = -2.0;
    moss.flags &= ~FighterFlag.Grounded;
    moss.flags |= FighterFlag.FacingRight;
    moss.vy = 0;
    runTape(world, [tape().tap(InputDir.Up, InputBit.Special).build(), []], 14);
    expect(moss.vx).toBeGreaterThan(5);

    // Gone Fishin' (Dspec) spawns rubble, boot, or gadget (test deterministic seed 7 spawn)
    positionPair(world, 0, 5.0);
    const rubbleBefore = world.island.rubble.length;
    const projBefore = world.gadgets.projectiles.length;
    const wgBefore = world.gadgets.worldGadgets.length;
    runTape(world, [tape().hold(60, InputDir.Down, InputBit.Special).build(), []], 60);
    const spawned =
      world.island.rubble.length > rubbleBefore ||
      world.gadgets.projectiles.length > projBefore ||
      world.gadgets.worldGadgets.length > wgBefore ||
      moss.damage > 0;
    expect(spawned).toBe(true);
  });

  it('Eliminated Teaspoon taps chunk for 15 crack every 5s; Sudden Death (7200) sets >=150% & Hard End (8400) resolves tie-break', () => {
    const world = createMatch({
      arenaId: ArenaId.Willow,
      mode: MatchMode.FreeForAll,
      stocksOverride: 1,
      fighters: [
        { slot: 0, id: FighterId.Earl, team: TeamId.None },
        { slot: 1, id: FighterId.Grog, team: TeamId.None },
        { slot: 2, id: FighterId.Nesta, team: TeamId.None },
      ],
    });
    const f0 = world.fighters[0]!;
    const f1 = world.fighters[1]!;
    const f2 = world.fighters[2]!;
    f0.x = 0;
    f0.y = 0;
    f1.x = 3;
    f1.y = 0;
    // Eliminate slot 2 into Teaspoon
    f2.x = 0;
    f2.y = -20;
    stepIdle(world, 1);
    expect(f2.stocks).toBe(0);
    expect(f2.state).toBe(FighterState.Teaspoon);

    // Teaspoon taps chunk underfoot for 15 crack, then 5s (300f) cooldown before next tap
    const ci = findChunkUnderPoint(world.island, 0, 0);
    const hpBefore = world.island.chunks[ci]!.hp;
    const tapEv = runTape(world, [[], [], tape().tap(InputDir.Neutral, InputBit.Attack).build()], 2);
    expectEvent(tapEv, SimEventKind.TeaspoonTap, (e) => e.a === 2 && e.d === 15);
    expect(world.island.chunks[ci]!.hp).toBe(hpBefore - 15);
    expect(f2.teaspoonCooldown).toBeGreaterThanOrEqual(298);

    // Fast-forward tick to Sudden Death (7200) and Hard End (8400) cleanly
    f0.damage = 40;
    f1.damage = 25;
    world.tick = 7198;
    const sdEvents = stepIdle(world, 3);
    expectEvent(sdEvents, SimEventKind.SuddenDeath, (e) => e.a === 150);
    expect(f0.damage).toBeGreaterThanOrEqual(150);
    expect(f1.damage).toBeGreaterThanOrEqual(150);

    // Hard end at tick 8400 resolves winner by stocks -> damage -> last fell (f0 has higher damage, f1 wins)
    f0.damage = 180;
    f1.damage = 150;
    world.tick = 8398;
    const endEvents = stepIdle(world, 3);
    expectEvent(endEvents, SimEventKind.RoundEnd, (e) => e.a === 1);
    const res = world.getRoundResult();
    expect(res).not.toBeNull();
    expect(res!.endedByHardEnd).toBe(true);
    expect(res!.winnerSlot).toBe(1);
  });

  it('Regression: airborne Idle normalizes to Airborne with air drift; aerials & Uspec steer and grab ledges', () => {
    const world = createMatch();
    const f = world.fighters[0]!;
    f.x = -12.0;
    f.y = 1.5;
    f.vx = -4.0;
    f.vy = 0;
    f.state = FighterState.Idle;
    f.flags &= ~FighterFlag.Grounded;

    // Holding Right must normalize out of Idle and steer velocity positive (inward)
    runTape(world, [tape().hold(12, InputDir.Right).build(), []], 12);
    expect(f.state).toBe(FighterState.Airborne);
    expect(f.vx).toBeGreaterThan(0);

    // Offstage Uspec with UpRight faces right, drifts inward, and grabs left ledge cleanly
    f.x = -12.2;
    f.y = -2.2;
    f.vx = -1.0;
    f.vy = -2.0;
    f.flags &= ~(FighterFlag.Grounded | FighterFlag.FacingRight);
    f.state = FighterState.Airborne;
    runTape(world, [tape().tap(InputDir.UpRight, InputBit.Special).hold(26, InputDir.Right).build(), []], 27);
    expect((f.flags & FighterFlag.FacingRight) !== 0).toBe(true);
    expect(f.x).toBeGreaterThan(-12.2);
  });

  it('Regression: respawn picks a standing chunk, clears input buffer/hit attribution, and restores air jumps', () => {
    const world = createMatch({ stocksOverride: 3 });
    const f = world.fighters[0]!;
    // Remove left rim chunks so slot 0 original spawn (-9, 0.6) is over empty void
    world.island.chunks[0]!.state = ChunkState.Gone;
    world.island.chunks[1]!.state = ChunkState.Gone;
    world.island.chunks[2]!.state = ChunkState.Gone;
    f.doubleJumpsLeft = 0;
    f.lastHitBySlot = 1;
    f.lastHitTick = world.tick;
    f.buffer.push({ bit: InputBit.Special, dir: InputDir.Up, pressedTick: world.tick });

    // Cross bottom blast zone
    f.x = -9.0;
    f.y = -20.0;
    const koEvs = stepIdle(world, 1);
    expectEvent(koEvs, SimEventKind.Respawn, (e) => e.a === 0);
    expect(f.state).toBe(FighterState.Respawn);
    expect(f.doubleJumpsLeft).toBe(1);
    expect(f.buffer).toHaveLength(0);
    expect(f.lastHitBySlot).toBe(-1);
    expect(f.lastHitTick).toBe(-1);
    // Must respawn above a standing chunk (Intact/Crazed), NOT over the vanished chunks
    const respawnChunk = findChunkUnderPoint(world.island, f.x, 0);
    expect(respawnChunk).toBeGreaterThanOrEqual(0);

    // Dying immediately after respawn with no new hit must be SelfDestruct, not credited to slot 1
    f.state = FighterState.Airborne;
    f.y = -20.0;
    const sdEvs = stepIdle(world, 1);
    expectEvent(sdEvs, SimEventKind.Ko, (e) => e.a === 0 && e.b === -1 && e.c === KoCause.SelfDestruct);
  });

  it('Regression: Grog.Dspec (Stamp) applies underfoot crack (+90) once regardless of how many opponents are hit', () => {
    const world = createMatch({
      fighters: [
        { slot: 0, id: FighterId.Grog, team: TeamId.None },
        { slot: 1, id: FighterId.Earl, team: TeamId.None },
        { slot: 2, id: FighterId.Nesta, team: TeamId.None },
      ],
    });
    const g = world.fighters[0]!;
    const e1 = world.fighters[1]!;
    const e2 = world.fighters[2]!;
    g.x = 0; g.y = 0; g.flags |= FighterFlag.Grounded;
    e1.x = -1.2; e1.y = 0; e1.flags |= FighterFlag.Grounded;
    e2.x = 1.2; e2.y = 0; e2.flags |= FighterFlag.Grounded;

    const crackBefore = world.island.crackTotals[1];
    const evs = runTape(world, [tape().tap(InputDir.Down, InputBit.Special).build(), [], []], 30);
    expect(findEvents(evs, SimEventKind.Hit, (e) => e.a === 0).length).toBeGreaterThanOrEqual(2);
    // Exactly one Stamp underfoot crack: 45 * Grog crackMult (2.0) = 90 (never 180 or 270)
    expect(world.island.crackTotals[1] - crackBefore).toBe(90);
  });

  it('Regression: buildBotView reports exact world-space chunk bounds without double-adding centroids', () => {
    const world = createMatch({
      arenaId: ArenaId.Willow,
      fighters: [
        { slot: 0, id: FighterId.Earl, team: TeamId.None },
        { slot: 1, id: FighterId.Grog, team: TeamId.None },
        { slot: 2, id: FighterId.Nesta, team: TeamId.None },
        { slot: 3, id: FighterId.Moss, team: TeamId.None },
        { slot: 4, id: FighterId.Earl, team: TeamId.None },
      ],
    });
    const arena = getArenaSpec(ArenaId.Willow);
    const view = buildBotView(
      world.tick,
      world.fighters,
      world.island,
      world.gadgets.worldGadgets,
      world.gadgets.projectiles,
      arena.blastZone,
      arena.chunks,
    );
    expect(view.chunks).toHaveLength(arena.chunks.length);
    for (let i = 0; i < arena.chunks.length; i++) {
      const sp = arena.chunks[i]!;
      const vc = view.chunks[i]!;
      expect(vc.x0).toBeCloseTo(Math.min(sp.topX0, sp.topX1), 3);
      expect(vc.x1).toBeCloseTo(Math.max(sp.topX0, sp.topX1), 3);
      expect(vc.y).toBeCloseTo((sp.topY0 + sp.topY1) * 0.5, 3);
    }
  });
});
