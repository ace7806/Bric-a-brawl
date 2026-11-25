import { beforeAll, describe, expect, it } from 'vitest';
import { runAllComboSearches, searchFighterCombos } from '@bots/comboSearch';
import { ALL_FIGHTER_IDS, FighterId } from '@sim/enums';
import { initPhysics } from '@sim/world';

describe('ComboSearch infinite & touch-of-death gate (M2.9, MASTER_DESIGN 10.4)', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('finds zero infinites (>12 hits) and zero 0%-to-death centre combos across all 4 fighters at 0%, 40%, 80%', () => {
    const results = runAllComboSearches();
    expect(results.map((r) => r.fighterId)).toEqual(ALL_FIGHTER_IDS);

    for (const res of results) {
      expect(res.longestSequence.length, `Fighter ${FighterId[res.fighterId]} searched combos`).toBeGreaterThan(0);
      expect(res.maxTrueComboHits, `Fighter ${FighterId[res.fighterId]} maxTrueComboHits <= 12`).toBeLessThanOrEqual(12);
      expect(res.killedFromZeroAtCentre, `Fighter ${FighterId[res.fighterId]} no 0% touch-of-death`).toBe(false);
    }
  });

  it.each(ALL_FIGHTER_IDS)(
    'validates single-fighter searchFighterCombos(%i) at [0, 40, 80]',
    (fighterId) => {
      const res = searchFighterCombos(fighterId, [0, 40, 80]);
      expect(res.fighterId).toBe(fighterId);
      expect(res.maxTrueComboHits).toBeLessThanOrEqual(12);
      expect(res.killedFromZeroAtCentre).toBe(false);
      expect(res.maxTrueComboHits).toBeGreaterThanOrEqual(1);
    },
  );
});
