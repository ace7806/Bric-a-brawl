import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createBot, type BotController } from '../src/bots/brains';
import { BotKind } from '../src/bots/enums';
import { buildBotView } from '../src/bots/view';
import { getMoveHitbox } from '../src/sim/combat';
import { getArenaSpec, getFighterSpec, getGameData, getMoveSpec } from '../src/sim/data';
import {
  ArenaId,
  ChunkState,
  FighterFlag,
  FighterId,
  FighterState,
  GadgetId,
  MatchMode,
  MoveId,
  TeamId,
} from '../src/sim/enums';
import { polygonCentroid } from '../src/sim/geometry';
import { SeededRng } from '../src/sim/prng';
import type { ChunkRuntime, FighterRuntime } from '../src/sim/types';
import { initPhysics, SimWorld } from '../src/sim/world';

const WIDTH = 960;
const HEIGHT = 540;
const VIEW_X0 = -20;
const VIEW_X1 = 20;
const VIEW_Y0 = -7;
const VIEW_Y1 = 15.5;

function toSvgX(x: number): number {
  return ((x - VIEW_X0) / (VIEW_X1 - VIEW_X0)) * WIDTH;
}

function toSvgY(y: number): number {
  return HEIGHT - ((y - VIEW_Y0) / (VIEW_Y1 - VIEW_Y0)) * HEIGHT;
}

function scalePx(u: number): number {
  return (u / (VIEW_X1 - VIEW_X0)) * WIDTH;
}

function chunkSvgPoints(ch: ChunkRuntime, poly: readonly (readonly [number, number])[]): string {
  const [cx0, cy0] = polygonCentroid(poly);
  const cos = Math.cos(ch.angle);
  const sin = Math.sin(ch.angle);
  return poly
    .map(([px, py]) => {
      const lx = px - cx0;
      const ly = py - cy0;
      const wx = ch.x + lx * cos - ly * sin;
      const wy = ch.y + lx * sin + ly * cos;
      return `${toSvgX(wx).toFixed(1)},${toSvgY(wy).toFixed(1)}`;
    })
    .join(' ');
}

function renderWorldElements(world: SimWorld): string {
  const { palette } = getGameData();
  const arena = getArenaSpec(world.config.arenaId);
  const parts: string[] = [];

  // Platforms
  for (const p of world.island.platforms) {
    if (!p.alive) continue;
    const x0 = toSvgX(p.x0);
    const x1 = toSvgX(p.x1);
    const y = toSvgY(p.y);
    parts.push(`<line x1="${x0.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${palette.world.clay_foot}" stroke-width="5" stroke-linecap="round"/>`);
  }

  // Island chunks
  for (let i = 0; i < world.island.chunks.length; i++) {
    const ch = world.island.chunks[i]!;
    if (ch.state === ChunkState.Gone) continue;
    const spec = arena.chunks[i]!;
    const fill =
      ch.state === ChunkState.Intact
        ? palette.world.willow_glaze
        : ch.state === ChunkState.Crazed
          ? palette.world.tea_cream
          : ch.state === ChunkState.Loose
            ? palette.world.tea_rose
            : palette.world.clay_foot;
    const stroke = ch.state === ChunkState.Crazed ? palette.accents.stamp_red : palette.world.willow_line;
    const dash = ch.state === ChunkState.Crazed || ch.state === ChunkState.Loose ? ' stroke-dasharray="6,3"' : '';
    parts.push(`<polygon points="${chunkSvgPoints(ch, spec.poly)}" fill="${fill}" stroke="${stroke}" stroke-width="2"${dash}/>`);
  }

  // Rubble
  for (const r of world.island.rubble) {
    parts.push(`<circle cx="${toSvgX(r.x).toFixed(1)}" cy="${toSvgY(r.y).toFixed(1)}" r="${Math.max(2, scalePx(r.radius)).toFixed(1)}" fill="${palette.neutrals.terracotta}" stroke="${palette.neutrals.ink}" stroke-width="1"/>`);
  }

  // Gadgets & Projectiles
  for (const g of world.gadgets.worldGadgets) {
    const cx = toSvgX(g.x);
    const cy = toSvgY(g.y);
    parts.push(`<rect x="${(cx - 7).toFixed(1)}" y="${(cy - 7).toFixed(1)}" width="14" height="14" rx="3" fill="${palette.accents.gilt}" stroke="${palette.neutrals.ink}" stroke-width="1.5"/>`);
  }
  for (const p of world.gadgets.projectiles) {
    parts.push(`<circle cx="${toSvgX(p.x).toFixed(1)}" cy="${toSvgY(p.y).toFixed(1)}" r="${Math.max(3, scalePx(p.radius)).toFixed(1)}" fill="${palette.accents.stamp_red}" stroke="${palette.neutrals.ink}" stroke-width="1"/>`);
  }

  // Fighters + active hitboxes + HUD tags
  for (const f of world.fighters) {
    const color = palette.players[f.slot]?.hex ?? palette.neutrals.bone;
    const spec = getFighterSpec(f.id);
    if (f.state === FighterState.Eliminated || f.state === FighterState.Teaspoon) {
      if (f.state === FighterState.Teaspoon) {
        parts.push(`<circle cx="${toSvgX(f.x).toFixed(1)}" cy="${toSvgY(f.y).toFixed(1)}" r="6" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="3,2"/>`);
      }
      continue;
    }

    const wPx = scalePx(spec.stats.width);
    const hPx = scalePx(spec.stats.height);
    const cx = toSvgX(f.x);
    const by = toSvgY(f.y);
    const topY = by - hPx;
    const facing = (f.flags & FighterFlag.FacingRight) !== 0 ? 1 : -1;

    parts.push(`<rect x="${(cx - wPx * 0.5).toFixed(1)}" y="${topY.toFixed(1)}" width="${wPx.toFixed(1)}" height="${hPx.toFixed(1)}" rx="${(wPx * 0.45).toFixed(1)}" fill="${palette.neutrals.bone}" stroke="${color}" stroke-width="3.5"/>`);
    parts.push(`<circle cx="${(cx + facing * wPx * 0.3).toFixed(1)}" cy="${(topY + hPx * 0.35).toFixed(1)}" r="3" fill="${color}"/>`);

    if (f.state === FighterState.Guard || f.state === FighterState.Parry) {
      const shieldColor = f.state === FighterState.Parry ? palette.accents.gilt_hi : color;
      parts.push(`<circle cx="${cx.toFixed(1)}" cy="${(topY + hPx * 0.5).toFixed(1)}" r="${(Math.max(wPx, hPx) * 0.65).toFixed(1)}" fill="${shieldColor}" fill-opacity="0.22" stroke="${shieldColor}" stroke-width="2"/>`);
    }

    if (f.state === FighterState.Attack && f.activeMove !== MoveId.None) {
      const move = getMoveSpec(f.id, f.activeMove);
      if (f.moveFrame >= move.startup && f.moveFrame < move.startup + move.active) {
        const hb = getMoveHitbox(f, move);
        parts.push(`<line x1="${toSvgX(hb.x0).toFixed(1)}" y1="${toSvgY(hb.y0).toFixed(1)}" x2="${toSvgX(hb.x1).toFixed(1)}" y2="${toSvgY(hb.y1).toFixed(1)}" stroke="${palette.accents.stamp_red}" stroke-width="${Math.max(4, scalePx(hb.radius * 2)).toFixed(1)}" stroke-opacity="0.45" stroke-linecap="round"/>`);
      }
    }

    const gadgetTag = f.heldGadget !== GadgetId.None ? ` [${GadgetId[f.heldGadget]}]` : '';
    parts.push(`<text x="${cx.toFixed(1)}" y="${(topY - 8).toFixed(1)}" text-anchor="middle" font-family="monospace" font-size="11" fill="${palette.neutrals.ink}">${FighterId[f.id]} ${Math.round(f.damage)}% (${f.stocks})${gadgetTag}</text>`);
  }

  return parts.join('\n');
}

function wrapSvgDocument(title: string, tick: number, body: string): string {
  const { palette } = getGameData();
  const intactText = `tick ${tick} (${(tick / 60).toFixed(1)}s) — ${title}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}">`,
    `  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${palette.world.sky_top}"/><stop offset="65%" stop-color="${palette.world.sky_mid}"/><stop offset="100%" stop-color="${palette.world.sky_low}"/></linearGradient></defs>`,
    `  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#sky)"/>`,
    `  <text x="16" y="26" font-family="monospace" font-size="14" font-weight="bold" fill="${palette.ui.ink}">${intactText}</text>`,
    `  ${body}`,
    `</svg>`,
  ].join('\n');
}

async function main(): Promise<void> {
  await initPhysics();
  const outDir = resolve('evidence/M2');
  mkdirSync(outDir, { recursive: true });

  const seed = 7;
  const arena = getArenaSpec(ArenaId.Willow);
  const fightersCfg = [
    { slot: 0, id: FighterId.Earl, team: TeamId.None },
    { slot: 1, id: FighterId.Grog, team: TeamId.None },
    { slot: 2, id: FighterId.Nesta, team: TeamId.None },
    { slot: 3, id: FighterId.Moss, team: TeamId.None },
  ];

  const world = new SimWorld({
    arenaId: ArenaId.Willow,
    mode: MatchMode.FreeForAll,
    fragile: false,
    seed,
    fighters: fightersCfg,
  });

  const bots: BotController[] = fightersCfg.map(() => createBot({ kind: BotKind.Brawler }));
  const botRngs = fightersCfg.map((_, i) => new SeededRng(seed + 100 + i));

  let savedFull = false;
  let savedMid = false;
  let savedLast = false;

  const clipFrames: string[] = [];
  const clipStartTick = 60 * 50; // 10s window from 50s to 60s when island actively breaks & brawls
  const clipEndTick = clipStartTick + 600;

  for (let t = 1; t <= 60 * 135 && !world.isFinished(); t++) {
    const view = buildBotView(
      world.tick,
      world.fighters,
      world.island,
      world.gadgets.worldGadgets,
      world.gadgets.projectiles,
      arena.blastZone,
      arena.chunks,
    );
    const masks = bots.map((b, s) => b.decide(view, s, botRngs[s]!));
    world.step(masks);

    if (!savedFull && world.tick === 120) {
      writeFileSync(resolve(outDir, 'dump-full-island.svg'), wrapSvgDocument('Willow Plate — Full Island', world.tick, renderWorldElements(world)), 'utf8');
      savedFull = true;
    }

    const brokenOrCrazed = world.island.chunks.filter((c) => c.state !== ChunkState.Intact).length;
    const standingCount = world.island.chunks.filter((c) => c.state === ChunkState.Intact || c.state === ChunkState.Crazed).length;

    if (!savedMid && brokenOrCrazed >= Math.ceil(world.island.chunks.length * 0.4)) {
      writeFileSync(resolve(outDir, 'dump-mid-round.svg'), wrapSvgDocument('Willow Plate — Mid-Round Fracture', world.tick, renderWorldElements(world)), 'utf8');
      savedMid = true;
    }

    if (!savedLast && (world.island.lastCallActive || standingCount <= 4)) {
      writeFileSync(resolve(outDir, 'dump-last-fragment.svg'), wrapSvgDocument('Willow Plate — Last Fragment', world.tick, renderWorldElements(world)), 'utf8');
      savedLast = true;
    }

    if (world.tick >= clipStartTick && world.tick < clipEndTick && world.tick % 6 === 0) {
      clipFrames.push(renderWorldElements(world));
    }
  }

  if (!savedLast) {
    writeFileSync(resolve(outDir, 'dump-last-fragment.svg'), wrapSvgDocument('Willow Plate — Final State', world.tick, renderWorldElements(world)), 'utf8');
  }

  const { palette } = getGameData();
  const nFrames = Math.max(1, clipFrames.length);
  const durSec = (nFrames / 10).toFixed(1);
  const animatedGroups = clipFrames.map((frameBody, idx) => {
    const t0 = idx / nFrames;
    const t1 = (idx + 1) / nFrames;
    const keyTimes = idx === 0 ? `0;${t1.toFixed(4)};1` : `0;${t0.toFixed(4)};${t1.toFixed(4)};1`;
    const values = idx === 0 ? `inline;none;none` : `none;inline;none;none`;
    return [
      `  <g display="none">`,
      `    <animate attributeName="display" values="${values}" keyTimes="${keyTimes}" calcMode="discrete" dur="${durSec}s" repeatCount="indefinite"/>`,
      `    <text x="16" y="26" font-family="monospace" font-size="14" font-weight="bold" fill="${palette.ui.ink}">Willow Plate 10s Clip — frame ${idx + 1}/${nFrames}</text>`,
      `    ${frameBody}`,
      `  </g>`,
    ].join('\n');
  });

  const clipSvg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}">`,
    `  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${palette.world.sky_top}"/><stop offset="65%" stop-color="${palette.world.sky_mid}"/><stop offset="100%" stop-color="${palette.world.sky_low}"/></linearGradient></defs>`,
    `  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#sky)"/>`,
    ...animatedGroups,
    `</svg>`,
  ].join('\n');

  writeFileSync(resolve(outDir, 'clip-10s.svg'), clipSvg, 'utf8');
  world.dispose();
  void (undefined as unknown as FighterRuntime);
  console.log(`[dump-svg] Wrote 3 tick dumps and clip-10s.svg (${nFrames} frames) to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
