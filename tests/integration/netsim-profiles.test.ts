import { beforeAll, describe, expect, it } from 'vitest';
import {
  BandwidthCounter,
  encodeInputPacket,
  encodeSnapshot,
  qDmg,
  qPos,
  qRot,
  qVel,
  uqDmg,
  uqPos,
  uqRot,
  uqVel,
  type SnapshotData,
} from '@net/codec';
import { CLIENT_DOWN_BUDGET_BPS, CLIENT_UP_BUDGET_BPS, HOST_UP_BUDGET_BPS } from '@net/config';
import { NetsimProfileId } from '@net/enums';
import { ChunkState, FighterFlag, FighterState, GadgetId, MoveId, NestaSize, ProjectileKind, WorldGadgetState } from '@sim/enums';
import { assertWithinBand } from '../support/asserts';
import { runNetsimScenario } from '../support/netsim';

interface ProfileThreshold {
  readonly profileId: NetsimProfileId;
  readonly name: string;
  readonly maxInputLoss: number;
  readonly maxPredErrP95: number | null;
  readonly maxLargePer10s: number | null;
  readonly minParryRate: number | null;
  readonly maxBlockFailRate: number | null;
}

const PROFILE_ROWS: readonly ProfileThreshold[] = [
  { profileId: NetsimProfileId.Lan, name: 'Lan', maxInputLoss: 0, maxPredErrP95: 0.15, maxLargePer10s: 1, minParryRate: 0.9, maxBlockFailRate: 0 },
  { profileId: NetsimProfileId.Typical, name: 'Typical', maxInputLoss: 0, maxPredErrP95: 0.15, maxLargePer10s: 1, minParryRate: 0.9, maxBlockFailRate: 0 },
  { profileId: NetsimProfileId.Far, name: 'Far', maxInputLoss: 0, maxPredErrP95: 0.25, maxLargePer10s: 2, minParryRate: 0.8, maxBlockFailRate: 0.05 },
  { profileId: NetsimProfileId.Limit, name: 'Limit', maxInputLoss: 0, maxPredErrP95: 0.35, maxLargePer10s: 3, minParryRate: 0.7, maxBlockFailRate: 0.05 },
  { profileId: NetsimProfileId.Wifi, name: 'Wifi', maxInputLoss: 0.005, maxPredErrP95: 0.35, maxLargePer10s: 3, minParryRate: 0.7, maxBlockFailRate: 0.05 },
  { profileId: NetsimProfileId.Awful, name: 'Awful', maxInputLoss: 0.005, maxPredErrP95: null, maxLargePer10s: null, minParryRate: null, maxBlockFailRate: null },
  { profileId: NetsimProfileId.Stall, name: 'Stall', maxInputLoss: 0.005, maxPredErrP95: null, maxLargePer10s: null, minParryRate: null, maxBlockFailRate: null },
];

function buildWireSnapshot(projCount: number, chunkCount: number, rubbleCount: number, gadgetCount: number, hasWorld: boolean): SnapshotData {
  return {
    tick: 43210,
    lastAppliedInputTicks: Array.from({ length: 8 }, (_, i) => 43200 + i),
    fighters: Array.from({ length: 8 }, (_, slot) => ({
      slot,
      x: uqPos(qPos(-8 + slot * 2.3)),
      y: uqPos(qPos(-2.5 + (slot % 4) * 2.1)),
      vx: uqVel(qVel((slot % 2 === 0 ? 1 : -1) * (4.5 + slot))),
      vy: uqVel(qVel((slot % 3 === 0 ? 1 : -1) * (3.2 + slot * 1.5))),
      state: FighterState.Attack,
      stateFrame: 5,
      activeMove: MoveId.Ftilt,
      flags: FighterFlag.FacingRight | FighterFlag.Grounded,
      damage: uqDmg(qDmg(25.4 + slot * 14.3)),
      guardHp: 45,
      gilt: 25,
      stocks: 3,
      heldGadget: GadgetId.Bellows,
      heldGadgetAmmo: 3,
      nestaSize: NestaSize.Mid,
      hitstopFrames: 0,
    })),
    projectiles: Array.from({ length: projCount }, (_, i) => ({
      id: 100 + i,
      kind: ProjectileKind.SteamPuff,
      x: uqPos(qPos(-6 + i * 1.3)),
      y: uqPos(qPos(1.5 + (i % 3) * 1.2)),
      vx: uqVel(qVel(7 + (i % 4))),
      vy: uqVel(qVel(-3.5 + i * 0.8)),
    })),
    chunks: hasWorld ? Array.from({ length: chunkCount }, (_, i) => ({
      index: i,
      x: uqPos(qPos(-6 + i * 2.4)),
      y: uqPos(qPos(-3.5 - i * 0.8)),
      angle: uqRot(qRot(0.4 + i * 0.3)),
      vx: uqVel(qVel(-2.5 + i)),
      vy: uqVel(qVel(-8.0 - i)),
      state: ChunkState.Falling,
      resting: false,
    })) : [],
    rubble: hasWorld ? Array.from({ length: rubbleCount }, (_, i) => ({
      id: 200 + i,
      x: uqPos(qPos(-7 + i * 0.9)),
      y: uqPos(qPos(-2.0 + i * 0.4)),
      angle: uqRot(qRot(0.8 + i * 0.2)),
      vx: uqVel(qVel(3.5 - i * 0.5)),
      vy: uqVel(qVel(-5.0 - i * 0.3)),
    })) : [],
    gadgets: hasWorld ? Array.from({ length: gadgetCount }, (_, i) => ({
      id: 300 + i,
      gadgetId: GadgetId.Cork,
      x: uqPos(qPos(-5 + i * 1.5)),
      y: uqPos(qPos(1.25 + i * 0.4)),
      angle: uqRot(qRot(0.2 + i * 0.4)),
      vx: uqVel(qVel(-2.5 + i)),
      vy: uqVel(qVel(3.0 - i)),
      state: WorldGadgetState.Grounded,
      ammo: 1,
    })) : [],
    hasWorld,
  };
}

describe('Netsim profiles N1-N11 & bandwidth budgets (M2.6, M2.7, M2.8)', () => {
  beforeAll(async () => {
    await runNetsimScenario({
      profileId: NetsimProfileId.Lan,
      seed: 99,
      durationTicks: 600,
      skipProbes: true,
    });
  });

  it.each(PROFILE_ROWS)(
    'satisfies N1-N9 & N11 assertions on profile=$name',
    async ({ profileId, maxInputLoss, maxPredErrP95, maxLargePer10s, minParryRate, maxBlockFailRate }) => {
      const m = await runNetsimScenario({
        profileId,
        seed: 1000 + profileId,
        durationTicks: 1800,
      });

      expect(m.desyncMismatches, `${NetsimProfileId[profileId]} N1 zero desync`).toBe(0);
      expect(m.koOrderAgreement, `${NetsimProfileId[profileId]} N2 koOrder`).toBe(true);
      expect(m.winnerAgreement, `${NetsimProfileId[profileId]} N2 winner`).toBe(true);
      expect(m.inputLossRate, `${NetsimProfileId[profileId]} N3 input loss`).toBeLessThanOrEqual(maxInputLoss);

      if (maxPredErrP95 !== null) {
        expect(m.predictionErrorP95, `${NetsimProfileId[profileId]} N4 pred err p95`).toBeLessThanOrEqual(maxPredErrP95);
      }
      if (maxLargePer10s !== null) {
        expect(m.largeCorrectionsPer10s, `${NetsimProfileId[profileId]} N5 large corrections`).toBeLessThanOrEqual(maxLargePer10s);
      }
      if (minParryRate !== null) {
        expect(m.parryBotSuccessRate, `${NetsimProfileId[profileId]} N6 parry rate`).toBeGreaterThanOrEqual(minParryRate);
      }
      if (maxBlockFailRate !== null) {
        expect(m.blockBotFailRate, `${NetsimProfileId[profileId]} N7 block fail rate`).toBeLessThanOrEqual(maxBlockFailRate);
      }

      expect(m.clientDownBps, `${NetsimProfileId[profileId]} N8 clientDown`).toBeLessThanOrEqual(CLIENT_DOWN_BUDGET_BPS);
      expect(m.clientUpBps, `${NetsimProfileId[profileId]} N8 clientUp`).toBeLessThanOrEqual(CLIENT_UP_BUDGET_BPS);
      expect(m.hostUpBps, `${NetsimProfileId[profileId]} N8 hostUp`).toBeLessThanOrEqual(HOST_UP_BUDGET_BPS);
      expect(m.hostTickP99Ms, `${NetsimProfileId[profileId]} N9 host tick p99`).toBeLessThan(4.0);
      expect(m.exceptions, `${NetsimProfileId[profileId]} N11 zero exceptions`).toBe(0);
      expect(m.maxBufferEntries, `${NetsimProfileId[profileId]} N11 bounded buffers`).toBeLessThanOrEqual(256);
    },
  );

  it('handles Churn profile N10 (late join -> Teaspoon/Spectating, peer leave, host leave -> Lobby < 5s with scores intact)', async () => {
    const m = await runNetsimScenario({
      profileId: NetsimProfileId.Churn,
      seed: 777,
      durationTicks: 5400,
    });

    expect(m.desyncMismatches).toBe(0);
    expect(m.exceptions).toBe(0);
    expect(m.churnLateJoinIsTeaspoon).toBe(true);
    expect(m.churnRecoveryMs).toBeLessThan(5000);
    expect(m.churnScoresIntact).toBe(true);
  });

  it('matches 7.3.7 typical & worst-case wire rates within 15% and respects client/host budgets (M2.8)', () => {
    const inputBytes = encodeInputPacket({ tick: 500, masks: [0x0143, 0x0043, 0x0003, 0], lastSnapshotTick: 498 });
    const fOnly = encodeSnapshot(buildWireSnapshot(4, 0, 0, 0, false), false);
    const typWorld = encodeSnapshot(buildWireSnapshot(4, 2, 6, 3, true), true);
    const worstFOnly = encodeSnapshot(buildWireSnapshot(12, 0, 0, 0, false), false);
    const worstWorld = encodeSnapshot(buildWireSnapshot(12, 6, 16, 8, true), true);

    const measureRate = (snapA: number, snapB: number) => {
      const clientBw = new BandwidthCounter(2000);
      const hostBw = new BandwidthCounter(2000);
      for (let t = 0; t < 120; t++) {
        const ms = (t * 1000) / 60;
        clientBw.recordUp(inputBytes.byteLength, ms);
        if (t % 2 === 0) {
          const sz = t % 4 === 0 ? snapB : snapA;
          clientBw.recordDown(sz, ms);
          for (let c = 0; c < 7; c++) hostBw.recordUp(sz, ms);
        }
      }
      return { c: clientBw.report(), h: hostBw.report() };
    };

    const typical = measureRate(fOnly.byteLength, typWorld.byteLength);
    const worst = measureRate(worstFOnly.byteLength, worstWorld.byteLength);

    // 7.3.7 reference numbers: typical 11.8 kB/s down, 6.1 kB/s up, 83 kB/s host up; worst 18.4 kB/s down, 129 kB/s host up
    assertWithinBand(typical.c.downBytesPerSec, 11_800 * 0.85, 11_800 * 1.15, 'typical client down B/s');
    assertWithinBand(typical.c.upBytesPerSec, 6_100 * 0.85, 6_100 * 1.15, 'typical client up B/s');
    assertWithinBand(typical.h.upBytesPerSec, 83_000 * 0.85, 83_000 * 1.15, 'typical host up B/s');
    assertWithinBand(worst.c.downBytesPerSec, 18_400 * 0.85, 18_400 * 1.15, 'worst client down B/s');
    assertWithinBand(worst.h.upBytesPerSec, 129_000 * 0.85, 129_000 * 1.15, 'worst host up B/s');

    expect(worst.c.downBytesPerSec).toBeLessThanOrEqual(CLIENT_DOWN_BUDGET_BPS);
    expect(worst.c.upBytesPerSec).toBeLessThanOrEqual(CLIENT_UP_BUDGET_BPS);
    expect(worst.h.upBytesPerSec).toBeLessThanOrEqual(HOST_UP_BUDGET_BPS);
  });
});
