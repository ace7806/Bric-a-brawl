import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getGadgetSpec, getGameData } from '@sim/data';
import {
  FighterFlag,
  FighterId,
  FighterState,
  GadgetId,
  InputBit,
  InputDir,
  ProjectileKind,
  SimEventKind,
  TeamId,
  WorldGadgetState,
} from '@sim/enums';
import { assertWithinBand, expectEvent } from '../support/asserts';
import { tape } from '../support/inputs';
import { createMatch, disposeAllWorlds, ensurePhysics, positionPair, runTape, stepIdle } from '../support/world';

function giveGadget(world: ReturnType<typeof createMatch>, slot: number, id: GadgetId): void {
  const f = world.fighters[slot]!;
  f.heldGadget = id;
  f.heldGadgetAmmo = getGadgetSpec(id).ammo;
}

describe('Tier A & Tier B Gadgets + Spawn/Drop Rules', () => {
  beforeAll(async () => {
    await ensurePhysics();
  });

  afterEach(() => {
    disposeAllWorlds();
  });

  it('Bellows: cone shove 16 u/s, 1.6x airborne, 0.5x guarded, 1.3x parry reflect, and only 1% damage (Pillar 3)', () => {
    const push = getGadgetSpec(GadgetId.Bellows).numbers['push']!;

    // Grounded target: 16 u/s (minus 1 tick kbDecay), 1% damage
    const wGnd = createMatch();
    positionPair(wGnd, 0, 2.0);
    giveGadget(wGnd, 0, GadgetId.Bellows);
    runTape(wGnd, [tape().tap(InputDir.Neutral, InputBit.Use).build(), []], 1);
    expect(wGnd.fighters[1]!.damage).toBe(1);
    assertWithinBand(wGnd.fighters[1]!.kbVx, push - 1.0, push, 'bellows grounded kbVx');

    // Airborne target: 1.6x push
    const wAir = createMatch();
    positionPair(wAir, 0, 2.0);
    giveGadget(wAir, 0, GadgetId.Bellows);
    wAir.fighters[1]!.flags &= ~FighterFlag.Grounded;
    wAir.fighters[1]!.y = 0.5;
    runTape(wAir, [tape().tap(InputDir.Neutral, InputBit.Use).build(), []], 1);
    assertWithinBand(wAir.fighters[1]!.kbVx, push * 1.6 - 1.0, push * 1.6, 'bellows air kbVx');

    // Guarded target: 0.5x push, 0% damage
    const wGuard = createMatch();
    positionPair(wGuard, 0, 2.0);
    giveGadget(wGuard, 0, GadgetId.Bellows);
    wGuard.fighters[1]!.state = FighterState.Guard;
    runTape(wGuard, [tape().wait(1).tap(InputDir.Neutral, InputBit.Use).build(), tape().hold(4, InputDir.Neutral, InputBit.Guard).build()], 2);
    expect(wGuard.fighters[1]!.damage).toBe(0);
    assertWithinBand(wGuard.fighters[1]!.kbVx, push * 0.5 - 1.0, push * 0.5, 'bellows guard kbVx');

    // Parried target: reflects gust back onto user at 1.3x
    const wParry = createMatch();
    positionPair(wParry, 0, 2.0);
    giveGadget(wParry, 0, GadgetId.Bellows);
    const evP = runTape(
      wParry,
      [tape().wait(1).tap(InputDir.Neutral, InputBit.Use).build(), tape().wait(1).tap(InputDir.Neutral, InputBit.Guard).build()],
      2,
    );
    expectEvent(evP, SimEventKind.Parry, (e) => e.a === 1 && e.b === 0);
    expect(wParry.fighters[0]!.kbVx).toBeLessThan(-push);
    expect(wParry.fighters[0]!.damage).toBe(1);
  });

  it('Plunger: pulls light fighter toward user, but pulls user toward heavy Grog or solid chunk', () => {
    const yankSpeed = getGadgetSpec(GadgetId.Plunger).numbers['yankSpeed']!;

    // Light target (Earl): pulled toward user
    const wLight = createMatch();
    positionPair(wLight, -2.0, 2.0);
    giveGadget(wLight, 0, GadgetId.Plunger);
    runTape(wLight, [tape().tap(InputDir.Neutral, InputBit.Use).build(), []], 14);
    expect(wLight.gadgets.projectiles.some((p) => p.kind === ProjectileKind.Plunger && p.stuckFighterSlot === 1)).toBe(true);
    runTape(wLight, [tape().tap(InputDir.Neutral, InputBit.Use).build(), []], 1);
    assertWithinBand(wLight.fighters[1]!.kbVx, -yankSpeed, -yankSpeed + 1.0, 'plunger pull light kbVx');

    // Heavy target (Grog): user is pulled toward Grog instead!
    const wHeavy = createMatch({
      fighters: [
        { slot: 0, id: FighterId.Earl, team: TeamId.None },
        { slot: 1, id: FighterId.Grog, team: TeamId.None },
      ],
    });
    positionPair(wHeavy, -2.0, 2.0);
    giveGadget(wHeavy, 0, GadgetId.Plunger);
    runTape(wHeavy, [tape().tap(InputDir.Neutral, InputBit.Use).build(), []], 14);
    runTape(wHeavy, [tape().tap(InputDir.Neutral, InputBit.Use).build(), []], 1);
    assertWithinBand(wHeavy.fighters[0]!.kbVx, yankSpeed - 1.0, yankSpeed, 'plunger pull toward Grog kbVx');
    expect(wHeavy.fighters[1]!.kbVx).toBe(0);

    // Solid chunk target: aim DownRight into floor -> pulls user toward stuck chunk
    const wChunk = createMatch();
    positionPair(wChunk, -1.0, 5.0);
    giveGadget(wChunk, 0, GadgetId.Plunger);
    runTape(wChunk, [tape().tap(InputDir.DownRight, InputBit.Use).build(), []], 6);
    expect(wChunk.gadgets.projectiles.some((p) => p.kind === ProjectileKind.Plunger && p.stuckChunkIndex >= 0)).toBe(true);
    runTape(wChunk, [tape().tap(InputDir.Neutral, InputBit.Use).build(), []], 1);
    expect(wChunk.fighters[0]!.kbVx).toBeGreaterThan(5);
  });

  it('Cork: shakes up to 45f, fires 34 u/s cork, recoils shooter opposite way & sets helpless for 20f', () => {
    const world = createMatch();
    positionPair(world, 0, 5.0);
    giveGadget(world, 0, GadgetId.Cork);
    const shooter = world.fighters[0]!;

    // Hold Use for 45f to charge max shake, then release on frame 46
    runTape(world, [tape().hold(45, InputDir.Neutral, InputBit.Use).build(), []], 46);
    expect(shooter.state).toBe(FighterState.Helpless);
    expect(shooter.hitstunFrames).toBe(20);
    assertWithinBand(shooter.kbVx, -24.0, -23.0, 'cork max recoil kbVx');
    const cork = world.gadgets.projectiles.find((p) => p.kind === ProjectileKind.Cork);
    expect(cork).toBeDefined();
    expect(cork!.vx).toBeCloseTo(34.0, 4);
  });

  it('Pepper: 40f inside cloud triggers backwards sneeze launch', () => {
    const world = createMatch();
    positionPair(world, -2.0, -0.6);
    giveGadget(world, 0, GadgetId.Pepper);
    const victim = world.fighters[1]!; // facing Left toward slot 0 -> backwards is +X

    const evs = runTape(world, [tape().tap(InputDir.Neutral, InputBit.Use).build(), []], 42);
    expectEvent(evs, SimEventKind.Sneeze, (e) => e.a === 1 && e.b === 0);
    expect(victim.kbVx).toBeGreaterThan(12);
    expect(victim.damage).toBe(getGadgetSpec(GadgetId.Pepper).numbers['damage']!);
  });

  it('Toaster: arms 36f after contact and pops straight up at 26 u/s; Jam puddle suppresses firing', () => {
    const world = createMatch();
    positionPair(world, -0.8, 0.1);
    giveGadget(world, 0, GadgetId.Toaster);
    const victim = world.fighters[1]!;

    // Place toaster at x = -0.8 + 0.9 = 0.1 right under victim
    const evs = runTape(world, [tape().tap(InputDir.Neutral, InputBit.Use).build(), []], 38);
    expectEvent(evs, SimEventKind.Launch, (e) => e.b === 1 && e.d === GadgetId.Toaster);
    expect(victim.kbVy).toBeCloseTo(26.0, 2);
    expect(victim.kbVx).toBe(0);

    // Jam puddle suppresses toaster firing
    const wJam = createMatch();
    positionPair(wJam, -0.8, 0.1);
    giveGadget(wJam, 0, GadgetId.Toaster);
    runTape(wJam, [tape().tap(InputDir.Neutral, InputBit.Use).build(), []], 1);
    wJam.gadgets.hazards.push({
      id: wJam.gadgets.nextId++,
      gadgetId: GadgetId.Jam,
      ownerSlot: 1,
      x: 0.1,
      y: 0,
      vx: 0,
      radius: 1.5,
      ttlTicks: 480,
      chunkIndex: 0,
    });
    const jamEvs = stepIdle(wJam, 45);
    expect(jamEvs.some((e) => e.kind === SimEventKind.Launch && e.d === GadgetId.Toaster)).toBe(false);
  });

  it('Jam: roots fighter up to 90f while allowing Attack & Guard; 3 Jump mashes escape early', () => {
    const world = createMatch();
    positionPair(world, -2.0, 1.0);
    giveGadget(world, 0, GadgetId.Jam);
    const victim = world.fighters[1]!;

    // Lob Jam horizontally onto grounded victim at x=1.0
    runTape(world, [tape().tap(InputDir.Neutral, InputBit.Use).build(), []], 16);
    expect(world.gadgets.hazards.some((h) => h.gadgetId === GadgetId.Jam)).toBe(true);
    expect((victim.flags & FighterFlag.Rooted) !== 0).toBe(true);

    // While rooted: Guard and Attack still work!
    runTape(world, [[], tape().tap(InputDir.Neutral, InputBit.Guard).build()], 1);
    expect(victim.state).toBe(FighterState.Parry);
    stepIdle(world, 10);
    runTape(world, [[], tape().tap(InputDir.Neutral, InputBit.Attack).build()], 2);
    expect(victim.state).toBe(FighterState.Attack);
    stepIdle(world, 18);

    // 3 Jump mashes break root early
    const escapeTape = tape().tap(InputDir.Neutral, InputBit.Jump).wait(1).tap(InputDir.Neutral, InputBit.Jump).wait(1).tap(InputDir.Neutral, InputBit.Jump).build();
    runTape(world, [[], escapeTape], 8);
    expect((victim.flags & FighterFlag.Rooted) !== 0).toBe(false);
    expect(victim.rootFrames).toBe(0);
  });

  it('Egg Timer: usable in Hitstun, rewinds position 120f back while preserving current damage + 10f invuln', () => {
    const world = createMatch();
    positionPair(world, -4.0, 4.0);
    const f0 = world.fighters[0]!;
    giveGadget(world, 0, GadgetId.Timer);

    // Record 120f of position history at x=-4.0
    stepIdle(world, 122);
    const rewindOriginX = f0.x;

    // Move f0 to x=6.0, place into Hitstun with 45% damage, then press Use
    f0.x = 6.0;
    f0.y = 2.0;
    f0.damage = 45;
    f0.state = FighterState.Hitstun;
    f0.hitstunFrames = 25;
    const evs = runTape(world, [tape().tap(InputDir.Neutral, InputBit.Use).build(), []], 2);
    expectEvent(evs, SimEventKind.Rewind, (e) => e.a === 0);
    expect(f0.x).toBeCloseTo(rewindOriginX, 1);
    expect(f0.damage).toBe(45);
    expect(f0.hitstunFrames).toBe(0);
    expect(f0.invulnFrames).toBeGreaterThanOrEqual(8);
    expect((f0.flags & FighterFlag.Invuln) !== 0).toBe(true);
  });

  it('Gadget spawn cadence (8s first spawn), 60% trailing bias, drop-on-tumble, and empty throw 4% damage', () => {
    const { gadgetRules, tuning } = getGameData();

    // First spawn at tick 8 * 60 = 480
    const wSpawn = createMatch();
    positionPair(wSpawn, -4.0, 4.0);
    const firstTick = Math.round(gadgetRules.firstSpawnSeconds * tuning.tickRate);
    const earlyEvents = stepIdle(wSpawn, firstTick - 1);
    expect(earlyEvents.some((e) => e.kind === SimEventKind.GadgetSpawn)).toBe(false);
    const spawnEvents = stepIdle(wSpawn, 2);
    expectEvent(spawnEvents, SimEventKind.GadgetSpawn);

    // Trailing-player 60% bias check across deterministic trials
    let trailingSideSpawns = 0;
    const trials = 40;
    for (let s = 1; s <= trials; s++) {
      const wBias = createMatch({ seed: s * 31 });
      positionPair(wBias, -6.0, 6.0);
      wBias.fighters[1]!.damage = 90; // slot 1 on +X is trailing
      wBias.gadgets.nextSpawnTick = 1;
      const evs = stepIdle(wBias, 2);
      const sp = expectEvent(evs, SimEventKind.GadgetSpawn);
      if (sp.c / 64 >= 0) trailingSideSpawns++;
    }
    expect(trailingSideSpawns).toBeGreaterThanOrEqual(20);

    // Drop on tumble + empty throw 4% damage
    const wDrop = createMatch();
    positionPair(wDrop, -1.0, 0.2);
    giveGadget(wDrop, 1, GadgetId.Bellows);
    wDrop.fighters[1]!.damage = 60;
    runTape(wDrop, [tape().tap(InputDir.Right, InputBit.Heavy).build(), []], 20);
    expect(wDrop.fighters[1]!.state).toBe(FighterState.Tumble);
    expect(wDrop.fighters[1]!.heldGadget).toBe(GadgetId.None);
    expect(wDrop.gadgets.worldGadgets.some((g) => g.gadgetId === GadgetId.Bellows && g.state === WorldGadgetState.Thrown)).toBe(true);

    const wEmpty = createMatch();
    positionPair(wEmpty, -1.0, 1.0);
    wEmpty.fighters[0]!.heldGadget = GadgetId.Bellows;
    wEmpty.fighters[0]!.heldGadgetAmmo = 0;
    runTape(wEmpty, [tape().tap(InputDir.Neutral, InputBit.Use).build(), []], 12);
    expect(wEmpty.fighters[1]!.damage).toBe(gadgetRules.emptyThrowDamage);
  });
});

describe('Tier C Gadgets (Hoover & Horseshoe Magnet)', () => {
  beforeAll(async () => {
    await ensurePhysics();
  });

  afterEach(() => {
    disposeAllWorlds();
  });

  it('Hoover: pulls opponent & rubble, bags non-Grog, refuses to bag Grog, mash shortens bag time, and spit hits third bystander for 10%', () => {
    const hooverSpec = getGadgetSpec(GadgetId.Hoover);
    const bagMaxFrames = hooverSpec.numbers['bagMaxFrames']!;
    const spitDamage = hooverSpec.numbers['spitDamage']!;
    const hitByFlyingFriend = hooverSpec.numbers['hitByFlyingFriend']!;

    // 1. Pulls opponent & rubble inside cone, then bags non-Grog fighter
    const wPull = createMatch();
    positionPair(wPull, -2.0, 1.0);
    giveGadget(wPull, 0, GadgetId.Hoover);
    const holder = wPull.fighters[0]!;
    const victim = wPull.fighters[1]!;
    wPull.island.rubble.push({
      id: 901,
      x: 1.5,
      y: 0.4,
      vx: 0,
      vy: 0,
      angle: 0,
      radius: 0.28,
      resting: true,
      restSent: false,
      ownerSlot: -1,
      isShell: false,
      shellHitsLeft: 0,
      ttlTicks: 1800,
      bodyHandle: -1,
      colliderHandle: -1,
    });
    const rubbleStartX = wPull.island.rubble[0]!.x;
    const victimStartX = victim.x;

    // Hold Use for 10f -> victim & rubble pulled closer
    runTape(wPull, [tape().hold(10, InputDir.Neutral, InputBit.Use).build(), []], 10);
    expect(victim.x).toBeLessThan(victimStartX - 0.5);
    expect(wPull.island.rubble[0]!.x).toBeLessThan(rubbleStartX - 1.0);

    // Continue holding Use until victim reaches nozzle and gets bagged
    runTape(wPull, [tape().hold(20, InputDir.Neutral, InputBit.Use).build(), []], 20);
    expect(wPull.gadgets.hooverBags.has(0)).toBe(true);
    expect(victim.state).toBe(FighterState.Held);
    expect((victim.flags & FighterFlag.Invuln) !== 0).toBe(true);

    // User cannot guard while sucking
    const wNoGuard = createMatch();
    positionPair(wNoGuard, -2.0, 2.0);
    giveGadget(wNoGuard, 0, GadgetId.Hoover);
    wNoGuard.fighters[0]!.state = FighterState.Guard;
    runTape(wNoGuard, [tape().hold(3, InputDir.Neutral, InputBit.Use | InputBit.Guard).build(), []], 3);
    expect(wNoGuard.fighters[0]!.state).not.toBe(FighterState.Guard);
    expect(wNoGuard.fighters[0]!.state).not.toBe(FighterState.Parry);

    // 2. Grog cannot be bagged even right at the nozzle
    const wGrog = createMatch({
      fighters: [
        { slot: 0, id: FighterId.Earl, team: TeamId.None },
        { slot: 1, id: FighterId.Grog, team: TeamId.None },
      ],
    });
    positionPair(wGrog, 0.0, 0.8);
    giveGadget(wGrog, 0, GadgetId.Hoover);
    runTape(wGrog, [tape().hold(8, InputDir.Neutral, InputBit.Use).build(), []], 8);
    expect(wGrog.gadgets.hooverBags.has(0)).toBe(false);
    expect(wGrog.fighters[1]!.state).not.toBe(FighterState.Held);

    // 3. Mashing Jump/Attack inside bag cuts bag duration down from 90f toward 40f floor
    const wMash = createMatch();
    positionPair(wMash, 0.0, 0.8);
    giveGadget(wMash, 0, GadgetId.Hoover);
    runTape(wMash, [tape().hold(3, InputDir.Neutral, InputBit.Use).build(), []], 3);
    const bagState = wMash.gadgets.hooverBags.get(0);
    expect(bagState).toBeDefined();
    const bagStartTick = wMash.tick - bagState!.elapsedTicks;

    // Build alternating Jump/Attack mashes while holder continues holding Use
    const mashBuilder = tape();
    for (let i = 0; i < 15; i++) {
      mashBuilder.tap(InputDir.Neutral, InputBit.Jump).wait(1).tap(InputDir.Neutral, InputBit.Attack).wait(1);
    }
    const mashEvs = runTape(wMash, [tape().hold(55, InputDir.Neutral, InputBit.Use).build(), mashBuilder.build()], 55);
    expect(wMash.gadgets.hooverBags.has(0)).toBe(false);
    const spitEv = expectEvent(mashEvs, SimEventKind.GadgetUse, (e) => e.a === 0 && e.b === GadgetId.Hoover && e.c === 1);
    const heldDuration = spitEv.tick - bagStartTick;
    expect(heldDuration).toBeLessThan(bagMaxFrames);
    expect(heldDuration).toBeGreaterThanOrEqual(40);

    // 4. Spitting launches victim and hitting a third bystander deals hitByFlyingFriend (10%)
    const wSpit = createMatch({
      fighters: [
        { slot: 0, id: FighterId.Earl, team: TeamId.None },
        { slot: 1, id: FighterId.Earl, team: TeamId.None },
        { slot: 2, id: FighterId.Nesta, team: TeamId.None },
      ],
    });
    positionPair(wSpit, -1.0, -0.3);
    wSpit.fighters[2]!.x = 2.5;
    wSpit.fighters[2]!.y = 0;
    wSpit.fighters[2]!.flags |= FighterFlag.Grounded;
    giveGadget(wSpit, 0, GadgetId.Hoover);

    // Hold Use 2f to bag slot 1, then release Use on tick 3 to spit rightward into slot 2
    const spitEvs = runTape(wSpit, [tape().hold(2, InputDir.Neutral, InputBit.Use).build(), [], []], 24);
    expectEvent(spitEvs, SimEventKind.GadgetUse, (e) => e.a === 0 && e.b === GadgetId.Hoover && e.c === 1);
    expect(wSpit.fighters[1]!.damage).toBeGreaterThanOrEqual(spitDamage);
    expect(wSpit.fighters[2]!.damage).toBe(hitByFlyingFriend);
    expect(wSpit.fighters[0]!.heldGadgetAmmo).toBe(hooverSpec.ammo - 1);
    expect(holder.heldGadget).toBe(GadgetId.Hoover);
  });

  it('Horseshoe Magnet: pulls rubble + rips opponent held gadget into orbit (max 8) without sticking fighters, fires 4% shrapnel reflectable by Parry', () => {
    const magnetSpec = getGadgetSpec(GadgetId.Magnet);
    const attractFrames = magnetSpec.numbers['attractFrames']!;
    const shrapnelDmg = magnetSpec.numbers['shrapnelDamageEach']!;
    const maxOrbit = magnetSpec.numbers['maxOrbit']!;

    // 1. Pulls up to maxOrbit (8) items (rubble + ripped opponent held gadget) without sticking fighters
    const wOrbit = createMatch();
    positionPair(wOrbit, -2.0, 2.0);
    giveGadget(wOrbit, 0, GadgetId.Magnet);
    giveGadget(wOrbit, 1, GadgetId.Bellows);

    // Add 9 rubble pieces within 8u -> 1 ripped gadget + 7 rubble OR 8 rubble; cap must never exceed maxOrbit (8)
    for (let i = 0; i < 9; i++) {
      wOrbit.island.rubble.push({
        id: 800 + i,
        x: -1.0 + i * 0.4,
        y: 0.5,
        vx: 0,
        vy: 0,
        angle: 0,
        radius: 0.26,
        resting: true,
        restSent: false,
        ownerSlot: -1,
        isShell: false,
        shellHitsLeft: 0,
        ttlTicks: 1800,
        bodyHandle: -1,
        colliderHandle: -1,
      });
    }

    runTape(wOrbit, [tape().tap(InputDir.Neutral, InputBit.Use).build(), []], 3);
    const orbit = wOrbit.gadgets.magnetOrbits.get(0);
    expect(orbit).toBeDefined();
    expect(orbit!.items.length).toBeLessThanOrEqual(maxOrbit);
    // Opponent fighter is ceramic and NOT stuck, while their held gadget was ripped away if orbit had room
    expect(wOrbit.fighters[1]!.state).not.toBe(FighterState.Held);

    // Separate test specifically verifying held gadget rip into orbit when < 8 rubble
    const wRip = createMatch();
    positionPair(wRip, -2.0, 2.0);
    giveGadget(wRip, 0, GadgetId.Magnet);
    giveGadget(wRip, 1, GadgetId.Cork);
    wRip.island.rubble.push({
      id: 850,
      x: 0.0,
      y: 0.5,
      vx: 0,
      vy: 0,
      angle: 0,
      radius: 0.26,
      resting: true,
      restSent: false,
      ownerSlot: -1,
      isShell: false,
      shellHitsLeft: 0,
      ttlTicks: 1800,
      bodyHandle: -1,
      colliderHandle: -1,
    });
    runTape(wRip, [tape().tap(InputDir.Neutral, InputBit.Use).build(), []], 3);
    expect(wRip.fighters[1]!.heldGadget).toBe(GadgetId.None);
    expect(wRip.fighters[1]!.state).not.toBe(FighterState.Held);
    expect(wRip.gadgets.magnetOrbits.get(0)!.items.length).toBe(2);

    // Auto-fires on 60f expiry if not tapped again
    const autoEvs = stepIdle(wRip, attractFrames);
    expectEvent(autoEvs, SimEventKind.GadgetUse, (e) => e.a === 0 && e.b === GadgetId.Magnet && e.d === 1);
    expect(wRip.gadgets.magnetOrbits.has(0)).toBe(false);
    expect(wRip.fighters[0]!.heldGadgetAmmo).toBe(magnetSpec.ammo - 1);

    // 2. Manual second tap fires shrapnel in aim direction dealing 4% each
    const wFire = createMatch();
    positionPair(wFire, -2.0, 2.0);
    giveGadget(wFire, 0, GadgetId.Magnet);
    wFire.island.rubble.push({
      id: 860,
      x: -0.5,
      y: 0.6,
      vx: 0,
      vy: 0,
      angle: 0,
      radius: 0.26,
      resting: true,
      restSent: false,
      ownerSlot: -1,
      isShell: false,
      shellHitsLeft: 0,
      ttlTicks: 1800,
      bodyHandle: -1,
      colliderHandle: -1,
    });
    runTape(wFire, [tape().tap(InputDir.Neutral, InputBit.Use).wait(4).tap(InputDir.Right, InputBit.Use).build(), []], 18);
    expect(wFire.fighters[1]!.damage).toBe(shrapnelDmg);

    // 3. Shrapnel can be reflected by Parry
    const wParry = createMatch();
    positionPair(wParry, -2.0, 2.0);
    giveGadget(wParry, 0, GadgetId.Magnet);
    wParry.island.rubble.push({
      id: 870,
      x: -0.5,
      y: 0.6,
      vx: 0,
      vy: 0,
      angle: 0,
      radius: 0.26,
      resting: true,
      restSent: false,
      ownerSlot: -1,
      isShell: false,
      shellHitsLeft: 0,
      ttlTicks: 1800,
      bodyHandle: -1,
      colliderHandle: -1,
    });
    const parryEvs = runTape(
      wParry,
      [
        tape().tap(InputDir.Neutral, InputBit.Use).wait(4).tap(InputDir.Right, InputBit.Use).build(),
        tape().wait(10).hold(4, InputDir.Neutral, InputBit.Guard).build(),
      ],
      26,
    );
    expectEvent(parryEvs, SimEventKind.Parry, (e) => e.a === 1 && e.b === 0);
    expect(wParry.fighters[0]!.damage).toBe(shrapnelDmg);
  });
});

