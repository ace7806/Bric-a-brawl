import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getArenaSpec, getFighterSpec, getGadgetSpec, getGameData, parseArenaId, parseFighterId, parseGadgetId } from '@sim/data';
import { ALL_ARENA_IDS, ALL_FIGHTER_IDS, ALL_GADGET_IDS, ArenaId, ErrorCode, FighterId, MoveId, NestaSize } from '@sim/enums';
import { InvariantError } from '@sim/assert';
import wordsRaw from '@data/words.json';

function hexToHslSaturation(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return 0;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

describe('data/*.json schema, parity, and enum integrity', () => {
  const data = getGameData();

  it('matches bric-a-brawl-preproduction/data/*.json byte-for-byte', () => {
    const files = ['tuning.json', 'fighters.json', 'gadgets.json', 'arenas.json', 'palette.json'];
    for (const file of files) {
      const local = readFileSync(resolve('data', file), 'utf8');
      const upstream = readFileSync(resolve('bric-a-brawl-preproduction/data', file), 'utf8');
      expect(local, `${file} matches design_data.py output`).toBe(upstream);
    }
  });

  it('loads all 4 fighters with valid move frame data and nothing plus on block (Pillar 4)', () => {
    expect(data.fighters.size).toBe(ALL_FIGHTER_IDS.length);
    let totalMoves = 0;
    for (const fid of ALL_FIGHTER_IDS) {
      const spec = getFighterSpec(fid);
      expect(spec.moves.size).toBeGreaterThanOrEqual(25);
      for (const move of spec.moves.values()) {
        totalMoves++;
        expect(move.total).toBeGreaterThan(0);
        if (move.onBlock !== null) {
          expect(move.onBlock, `${spec.name}.${MoveId[move.id]} must never be plus on block`).toBeLessThanOrEqual(-7);
        }
      }
    }
    expect(totalMoves).toBe(102); // Earl 26 + Grog 25 + Nesta 26 + Moss 25 per sanity.md
  });

  it('defines all three Nesta size stances with strictly decreasing weight and increasing speed', () => {
    const nesta = getFighterSpec(FighterId.Nesta);
    expect(nesta.nestaSizes).not.toBeNull();
    const big = nesta.nestaSizes!.get(NestaSize.Big)!;
    const mid = nesta.nestaSizes!.get(NestaSize.Mid)!;
    const small = nesta.nestaSizes!.get(NestaSize.Small)!;
    expect(big.weight).toBeGreaterThan(mid.weight);
    expect(mid.weight).toBeGreaterThan(small.weight);
    expect(small.run).toBeGreaterThan(mid.run);
    expect(mid.run).toBeGreaterThan(big.run);
  });

  it('loads all 9 gadgets and 3 breakable arenas plus unbreakable Saucer lobby', () => {
    expect(data.gadgets.size).toBe(ALL_GADGET_IDS.length);
    for (const gid of ALL_GADGET_IDS) {
      const g = getGadgetSpec(gid);
      expect(g.ammo).toBeGreaterThan(0);
      expect(g.weight).toBeGreaterThan(0);
    }
    for (const aid of ALL_ARENA_IDS) {
      const arena = getArenaSpec(aid);
      expect(arena.breakable).toBe(true);
      expect(arena.chunks.length).toBeGreaterThanOrEqual(8);
      expect(arena.spawns.length).toBe(8);
      expect(arena.timeline.length).toBeGreaterThan(0);
    }
    const saucer = getArenaSpec(ArenaId.Saucer);
    expect(saucer.breakable).toBe(false);
    expect(saucer.chunks.length).toBe(1);
  });

  it('enforces ART_BIBLE palette saturation separation (mean world <= 0.35, liveries > world mean, zero neon)', () => {
    const worldSats = Object.values(data.palette.world).map(hexToHslSaturation);
    const meanWorldSat = worldSats.reduce((a, b) => a + b, 0) / worldSats.length;
    expect(meanWorldSat).toBeLessThanOrEqual(data.palette.worldMaxSaturationHSL);

    const playerSats = data.palette.players.map((p) => hexToHslSaturation(p.hex));
    const meanPlayerSat = playerSats.reduce((a, b) => a + b, 0) / playerSats.length;
    expect(meanPlayerSat).toBeGreaterThanOrEqual(data.palette.liveryMinSaturationHSL);

    // ART_BIBLE Rule 7: zero neon (S > 0.85 and V > 0.85) anywhere in palette
    const allHex = [
      ...Object.values(data.palette.neutrals),
      ...Object.values(data.palette.world),
      ...Object.values(data.palette.accents),
      ...data.palette.players.map((p) => p.hex),
    ];
    for (const hex of allHex) {
      const n = parseInt(hex.slice(1), 16);
      const v = Math.max((n >> 16) & 255, (n >> 8) & 255, n & 255) / 255;
      const s = hexToHslSaturation(hex);
      expect(s > 0.85 && v > 0.85, `${hex} must not be neon`).toBe(false);
    }
  });

  it('validates M1 word lists (3x64 unique room words, 64 lot names, 8 auction phrases)', () => {
    expect(wordsRaw.roomWords).toHaveLength(3);
    for (const list of wordsRaw.roomWords) {
      expect(list).toHaveLength(64);
      expect(new Set(list).size).toBe(64);
    }
    expect(wordsRaw.lotNames).toHaveLength(64);
    expect(new Set(wordsRaw.lotNames).size).toBe(64);
    expect(wordsRaw.quickPhrases).toHaveLength(8);
  });

  it('throws InvariantError with zero fallbacks on invalid string-to-enum inputs', () => {
    expect(() => parseFighterId('unknown')).toThrow(InvariantError);
    expect(() => parseArenaId('unknown')).toThrow(InvariantError);
    expect(() => parseGadgetId('unknown')).toThrow(InvariantError);
    try {
      parseFighterId('invalid');
    } catch (err) {
      expect((err as InvariantError).code).toBe(ErrorCode.MissingRequiredEntry);
    }
  });
});
