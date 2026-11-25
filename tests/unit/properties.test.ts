import fc from 'fast-check';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  decodeInputPacket, decodeSnapshot, DMG_SCALE, encodeInputPacket, encodeSnapshot,
  peekUnreliableKind, POS_SCALE, VEL_SCALE, type InputPacket, type SnapshotData,
} from '@net/codec';
import { NetMessageKind } from '@net/enums';
import { InputJitterBuffer, unwrap16 } from '@net/sync';
import {
  ALL_ARENA_IDS, ALL_FIGHTER_IDS, ALL_GADGET_IDS, ChunkState, FighterFlag, FighterState,
  GadgetId, InputBit, InputDir, MoveId, NestaSize, ProjectileKind, TeamId, WorldGadgetState,
} from '@sim/enums';
import { decodeInputDir, encodeInputMask, hasBit } from '@sim/input';
import { createMatch, disposeAllWorlds, ensurePhysics, runTape } from '../support/world';

const ALL_INPUT_BITS = [
  InputBit.Tilt, InputBit.Jump, InputBit.Attack, InputBit.Heavy,
  InputBit.Special, InputBit.Guard, InputBit.Grab, InputBit.Use, InputBit.Taunt,
] as const;

const enumRange = <T extends number>(min: T, max: T): fc.Arbitrary<T> => fc.integer({ min, max }).map((v) => v as T);
const arbDir = enumRange(InputDir.Neutral, InputDir.UpLeft);
const arbActionBits = fc.integer({ min: 0, max: 0x0fff }).map((n) => (n << 4) & 0xffff);
const arbInputMask = fc.tuple(arbDir, arbActionBits).map(([d, b]) => encodeInputMask(d, b));
const arbCoord = (min: number, max: number): fc.Arbitrary<number> => fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
const arbAngle = fc.double({ min: 0, max: 2 * Math.PI, maxExcluded: true, noNaN: true, noDefaultInfinity: true });

const arbSnapshot: fc.Arbitrary<SnapshotData> = fc
  .tuple(fc.integer({ min: 0, max: 200_000 }), fc.integer({ min: 1, max: 8 }), fc.integer({ min: 0, max: 12 }), fc.integer({ min: 0, max: 8 }), fc.integer({ min: 0, max: 12 }))
  .chain(([tick, nf, nc, ng, np]) =>
    fc.record({
      tick: fc.constant(tick),
      lastAppliedInputTicks: fc.array(fc.integer({ min: -1, max: tick }), { minLength: nf, maxLength: nf }),
      fighters: fc.tuple(...Array.from({ length: nf }, (_, slot) => fc.record({
        slot: fc.constant(slot), x: arbCoord(-25, 25), y: arbCoord(-12, 19), vx: arbCoord(-60, 60), vy: arbCoord(-60, 60),
        state: enumRange(FighterState.Idle, FighterState.ChargingHeavy), stateFrame: fc.integer({ min: 0, max: 600 }),
        activeMove: enumRange(MoveId.None, MoveId.Dspec), flags: fc.integer({ min: FighterFlag.None, max: 0xff }),
        damage: arbCoord(0, 350), guardHp: fc.integer({ min: 0, max: 100 }), gilt: fc.integer({ min: 0, max: 100 }),
        stocks: fc.integer({ min: 0, max: 9 }), heldGadget: fc.constantFrom(GadgetId.None, ...ALL_GADGET_IDS),
        heldGadgetAmmo: fc.integer({ min: 0, max: 6 }), nestaSize: enumRange(NestaSize.Big, NestaSize.Small), hitstopFrames: fc.integer({ min: 0, max: 14 }),
      }))),
      projectiles: fc.tuple(...Array.from({ length: np }, (_, i) => fc.record({
        id: fc.constant(100 + i), kind: enumRange(ProjectileKind.SteamPuff, ProjectileKind.RubbleThrow),
        x: arbCoord(-25, 25), y: arbCoord(-12, 19), vx: arbCoord(-50, 50), vy: arbCoord(-50, 50),
      }))),
      chunks: fc.tuple(...Array.from({ length: nc }, (_, index) => fc.record({
        index: fc.constant(index), x: arbCoord(-20, 20), y: arbCoord(-12, 12), angle: arbAngle,
        vx: arbCoord(-30, 30), vy: arbCoord(-30, 30), state: enumRange(ChunkState.Intact, ChunkState.Gone), resting: fc.boolean(),
      }))),
      rubble: fc.constant([] as readonly []),
      gadgets: fc.tuple(...Array.from({ length: ng }, (_, i) => fc.record({
        id: fc.constant(200 + i), gadgetId: fc.constantFrom(...ALL_GADGET_IDS), x: arbCoord(-20, 20), y: arbCoord(-10, 15),
        angle: arbAngle, vx: arbCoord(-30, 30), vy: arbCoord(-30, 30),
        state: enumRange(WorldGadgetState.Parcel, WorldGadgetState.Thrown), ammo: fc.integer({ min: 0, max: 15 }),
      }))),
      hasWorld: fc.constant(true),
    }),
  );

const angleDist = (a: number, b: number): number => {
  const diff = Math.abs(a - b) % (2 * Math.PI);
  return Math.min(diff, 2 * Math.PI - diff);
};

describe('fast-check property invariants', () => {
  beforeAll(async () => { await ensurePhysics(); });
  afterEach(() => { disposeAllWorlds(); });

  it('1. input mask bijection: encodeInputMask -> decodeInputDir + hasBit is lossless', () => {
    fc.assert(
      fc.property(arbDir, arbActionBits, (dir, bits) => {
        const mask = encodeInputMask(dir, bits);
        expect(decodeInputDir(mask)).toBe(dir);
        for (const bit of ALL_INPUT_BITS) expect(hasBit(mask, bit)).toBe((bits & bit) === bit);
        expect(mask & InputBit.DirMask).toBe(dir);
      }),
      { numRuns: 200 },
    );
  });

  it('2. 16-bit tick unwrapping recovers refTick + delta across wrap boundaries', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500_000 }), fc.integer({ min: -30_000, max: 30_000 }), (refTick, d) => {
        fc.pre(refTick + d >= 0);
        expect(unwrap16((refTick + d) & 0xffff, refTick)).toBe(refTick + d);
      }),
      { numRuns: 300 },
    );
  });

  it('3a. InputPacket wire codec round-trips bit-exact with NetMessageKind.Input', () => {
    const u16 = fc.integer({ min: 0, max: 0xffff });
    const arbPkt: fc.Arbitrary<InputPacket> = fc.record({ tick: u16, masks: fc.tuple(u16, u16, u16, u16), lastSnapshotTick: u16 });
    fc.assert(
      fc.property(arbPkt, (pkt) => {
        const bytes = encodeInputPacket(pkt);
        expect(peekUnreliableKind(bytes)).toBe(NetMessageKind.Input);
        expect(decodeInputPacket(bytes)).toEqual(pkt);
      }),
      { numRuns: 200 },
    );
  });

  it('3b. SnapshotData wire codec round-trips within quantisation tolerance', () => {
    const posTol = 0.5 / POS_SCALE + 1e-9;
    const velTol = 0.5 / VEL_SCALE + 1e-9;
    const rotTol = Math.PI / 256 + 1e-6;
    fc.assert(
      fc.property(arbSnapshot, (snap) => {
        const bytes = encodeSnapshot(snap, true);
        expect(peekUnreliableKind(bytes)).toBe(NetMessageKind.Snapshot);
        const dec = decodeSnapshot(bytes);
        expect(dec.tick).toBe(snap.tick);
        expect(dec.lastAppliedInputTicks).toEqual(snap.lastAppliedInputTicks);
        expect(dec.fighters.length).toBe(snap.fighters.length);
        dec.fighters.forEach((df, i) => {
          const sf = snap.fighters[i]!;
          expect(Math.abs(df.x - sf.x)).toBeLessThanOrEqual(posTol);
          expect(Math.abs(df.y - sf.y)).toBeLessThanOrEqual(posTol);
          expect(Math.abs(df.vx - sf.vx)).toBeLessThanOrEqual(velTol);
          expect(Math.abs(df.vy - sf.vy)).toBeLessThanOrEqual(velTol);
          expect(Math.abs(df.damage - sf.damage)).toBeLessThanOrEqual(0.5 / DMG_SCALE + 1e-9);
          expect([df.state, df.stateFrame, df.activeMove, df.flags, df.guardHp, df.gilt, df.stocks, df.heldGadget, df.heldGadgetAmmo, df.nestaSize, df.hitstopFrames])
            .toEqual([sf.state, sf.stateFrame, sf.activeMove, sf.flags, sf.guardHp, sf.gilt, sf.stocks, sf.heldGadget, sf.heldGadgetAmmo, sf.nestaSize, sf.hitstopFrames]);
        });
        expect(dec.chunks.length).toBe(snap.chunks.length);
        dec.chunks.forEach((dc, i) => {
          const sc = snap.chunks[i]!;
          expect(Math.abs(dc.x - sc.x)).toBeLessThanOrEqual(posTol);
          expect(Math.abs(dc.y - sc.y)).toBeLessThanOrEqual(posTol);
          expect(angleDist(dc.angle, sc.angle)).toBeLessThanOrEqual(rotTol);
          expect([dc.state, dc.resting]).toEqual([sc.state, sc.resting]);
        });
        expect(dec.gadgets.length).toBe(snap.gadgets.length);
        dec.gadgets.forEach((dg, i) => {
          const sg = snap.gadgets[i]!;
          expect([dg.gadgetId, dg.state, dg.ammo]).toEqual([sg.gadgetId, sg.state, sg.ammo]);
          expect(angleDist(dg.angle, sg.angle)).toBeLessThanOrEqual(rotTol);
        });
        expect(dec.projectiles.length).toBe(snap.projectiles.length);
        dec.projectiles.forEach((dp, i) => {
          const sp = snap.projectiles[i]!;
          expect([dp.id, dp.kind]).toEqual([sp.id, sp.kind]);
          expect(Math.abs(dp.x - sp.x)).toBeLessThanOrEqual(posTol);
          expect(Math.abs(dp.y - sp.y)).toBeLessThanOrEqual(posTol);
        });
      }),
      { numRuns: 80 },
    );
  });

  it('4. InputJitterBuffer 4x redundancy loses 0 inputs for any drop pattern with max run <= 3', () => {
    const arbDrops = fc.array(fc.boolean(), { minLength: 40, maxLength: 80 }).map((raw) => {
      const drops = [...raw];
      for (let i = 0, run = 0; i < drops.length - 1; i++) {
        run = drops[i] ? run + 1 : 0;
        if (run > 3) { drops[i] = false; run = 0; }
      }
      drops[drops.length - 1] = false;
      return drops;
    });
    fc.assert(
      fc.property(arbDrops, fc.array(arbInputMask, { minLength: 80, maxLength: 80 }), (drops, seq) => {
        const buf = new InputJitterBuffer();
        const popped: number[] = [];
        let lastTick = -1;
        for (let t = 0; t < drops.length + 6; t++) {
          if (t < drops.length && !drops[t]) {
            const m = (k: number): number => (k >= 0 ? (seq[k] ?? 0) : 0);
            buf.ingestPacket(0, { tick: t & 0xffff, masks: [m(t), m(t - 1), m(t - 2), m(t - 3)], lastSnapshotTick: 0 }, t);
          }
          const res = buf.popInputForTick(0, t);
          if (res.inputTick > lastTick) {
            expect(res.inputTick).toBe(popped.length);
            expect(res.lost).toBe(false);
            popped.push(res.mask);
            lastTick = res.inputTick;
          }
        }
        expect(buf.getLossStats(0).inputsLost).toBe(0);
        expect(popped).toEqual(seq.slice(0, drops.length));
      }),
      { numRuns: 100 },
    );
  });

  it('5. SimWorld fuzz invariants across seeds, fighters, arenas & 40-tick input masks', () => {
    const arbF = fc.constantFrom(...ALL_FIGHTER_IDS);
    const arbA = fc.constantFrom(...ALL_ARENA_IDS);
    const arbTape = fc.array(arbInputMask, { minLength: 40, maxLength: 40 });
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }), arbA, arbF, arbF, arbTape, arbTape, (seed, arenaId, f0, f1, t0, t1) => {
        const world = createMatch({
          seed,
          arenaId,
          fighters: [{ slot: 0, id: f0, team: TeamId.None }, { slot: 1, id: f1, team: TeamId.None }],
        });
        runTape(world, [t0, t1], 40);
        expect(world.computeStateHash()).toMatch(/^[0-9a-f]{8}$/);
        world.dispose();
      }),
      { numRuns: 15 },
    );
  });
});
