import arenasRaw from '@data/arenas.json';
import fightersRaw from '@data/fighters.json';
import gadgetsRaw from '@data/gadgets.json';
import paletteRaw from '@data/palette.json';
import tuningRaw from '@data/tuning.json';
import * as v from 'valibot';
import { InvariantError, assert, requireKey } from './assert';
import {
  ALL_ARENA_IDS,
  ALL_FIGHTER_IDS,
  ALL_GADGET_IDS,
  ArenaId,
  BowlHalf,
  CancelKind,
  ErrorCode,
  FighterId,
  GadgetId,
  GadgetTier,
  GadgetVerb,
  HazardId,
  MoveClass,
  MoveId,
  NestaSize,
  PlatformKind,
  TimelineAction,
} from './enums';

// ---------------------------------------------------------------- Boundary parsers (string -> enum once at load)

const toMap = <T>(entries: readonly (readonly [string, T])[]): ReadonlyMap<string, T> => new Map(entries);
const FIGHTER_KEY_TO_ENUM = toMap([['earl', FighterId.Earl], ['grog', FighterId.Grog], ['nesta', FighterId.Nesta], ['moss', FighterId.Moss]]);
const NESTA_SIZE_TO_ENUM = toMap([['big', NestaSize.Big], ['mid', NestaSize.Mid], ['small', NestaSize.Small]]);
const MOVE_KEY_TO_ENUM = toMap([
  ['jab1', MoveId.Jab1], ['jab2', MoveId.Jab2], ['jab3', MoveId.Jab3], ['ftilt', MoveId.Ftilt], ['utilt', MoveId.Utilt],
  ['dtilt', MoveId.Dtilt], ['dash', MoveId.Dash], ['fheavy', MoveId.Fheavy], ['uheavy', MoveId.Uheavy], ['dheavy', MoveId.Dheavy],
  ['nair', MoveId.Nair], ['fair', MoveId.Fair], ['bair', MoveId.Bair], ['uair', MoveId.Uair], ['dair', MoveId.Dair],
  ['grab', MoveId.Grab], ['fthrow', MoveId.Fthrow], ['bthrow', MoveId.Bthrow], ['uthrow', MoveId.Uthrow], ['dthrow', MoveId.Dthrow],
  ['nspec', MoveId.Nspec], ['sspec', MoveId.Sspec], ['uspec', MoveId.Uspec], ['dspec', MoveId.Dspec],
  ['ledge', MoveId.Ledge], ['getup', MoveId.Getup],
]);
const MOVE_CLASS_TO_ENUM = toMap([
  ['light', MoveClass.Light], ['heavy', MoveClass.Heavy], ['air', MoveClass.Air],
  ['grab', MoveClass.Grab], ['throw', MoveClass.Throw], ['special', MoveClass.Special],
]);
const CANCEL_TO_ENUM = toMap([['', CancelKind.None], ['J', CancelKind.Chain], ['S', CancelKind.Special]]);
const GADGET_KEY_TO_ENUM = toMap([
  ['bellows', GadgetId.Bellows], ['plunger', GadgetId.Plunger], ['cork', GadgetId.Cork], ['pepper', GadgetId.Pepper],
  ['toaster', GadgetId.Toaster], ['jam', GadgetId.Jam], ['timer', GadgetId.Timer], ['hoover', GadgetId.Hoover], ['magnet', GadgetId.Magnet],
]);
const GADGET_TIER_TO_ENUM = toMap([['A', GadgetTier.A], ['B', GadgetTier.B], ['C', GadgetTier.C]]);
const GADGET_VERB_TO_ENUM = toMap([
  ['push', GadgetVerb.Push], ['pull', GadgetVerb.Pull], ['launch', GadgetVerb.Launch], ['reverse', GadgetVerb.Reverse],
  ['stick', GadgetVerb.Stick], ['suck and spit', GadgetVerb.SuckAndSpit], ['attract and repel', GadgetVerb.AttractAndRepel],
]);
const ARENA_KEY_TO_ENUM = toMap([['willow', ArenaId.Willow], ['high_tea', ArenaId.HighTea], ['mended_bowl', ArenaId.MendedBowl]]);
const PLATFORM_KIND_TO_ENUM = toMap([['soft', PlatformKind.Soft], ['solid_moving', PlatformKind.SolidMoving]]);
const TIMELINE_EVENT_TO_ENUM = toMap([
  ['craze', TimelineAction.Craze], ['drop', TimelineAction.Drop], ['last_call', TimelineAction.LastCall],
  ['sudden_death', TimelineAction.SuddenDeath], ['sink_one', TimelineAction.SinkOne], ['sink', TimelineAction.Sink],
  ['hazard', TimelineAction.Hazard], ['stem_snap', TimelineAction.StemSnap], ['split', TimelineAction.Split], ['tilt', TimelineAction.Tilt],
]);
const HAZARD_KEY_TO_ENUM = toMap([['pour', HazardId.Pour], ['updraft', HazardId.Updraft]]);
const BOWL_HALF_TO_ENUM = toMap([['L', BowlHalf.Left], ['R', BowlHalf.Right]]);

export const parseFighterId = (raw: string): FighterId => requireKey(FIGHTER_KEY_TO_ENUM, raw, 'FighterId');
export const parseArenaId = (raw: string): ArenaId =>
  raw === 'saucer' ? ArenaId.Saucer : requireKey(ARENA_KEY_TO_ENUM, raw, 'ArenaId');
export const parseGadgetId = (raw: string): GadgetId => requireKey(GADGET_KEY_TO_ENUM, raw, 'GadgetId');

// ---------------------------------------------------------------- Valibot Schemas

const num = v.pipe(v.number(), v.finite());
const str = v.string();
const bool = v.boolean();
const vec2 = v.tuple([num, num]);
const enumStr = <T>(map: ReadonlyMap<string, T>, label: string) =>
  v.pipe(str, v.check((s) => map.has(s), `Invalid ${label}`), v.transform((s) => map.get(s) as T));
const optBowlHalf = v.optional(v.nullable(enumStr(BOWL_HALF_TO_ENUM, 'BowlHalf')));
const toBowlHalf = (h: BowlHalf | null | undefined): BowlHalf => (h === undefined || h === null ? BowlHalf.None : h);

function parseSchema<T extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(schema: T, raw: unknown, label: string): v.InferOutput<T> {
  const res = v.safeParse(schema, raw);
  if (!res.success) {
    const detail = res.issues.map((iss) => `${v.getDotPath(iss) === null ? '<root>' : v.getDotPath(iss)}: ${iss.message}`).join('; ');
    throw new InvariantError(ErrorCode.SchemaValidationFailed, `${label} schema error: ${detail}`);
  }
  return res.output;
}

const numObj = <K extends string>(...keys: K[]) =>
  v.pipe(v.object(Object.fromEntries(keys.map((k) => [k, num])) as Record<K, typeof num>), v.readonly());
const strObj = <K extends string>(...keys: K[]) =>
  v.pipe(v.object(Object.fromEntries(keys.map((k) => [k, str])) as Record<K, typeof str>), v.readonly());
const ro = <T extends v.ObjectEntries>(entries: T) => v.pipe(v.object(entries), v.readonly());
const blastZoneSchema = numObj('left', 'right', 'top', 'bottom');

const tuningRawSchema = ro({
  tickRate: v.pipe(num, v.value(60)),
  net: numObj('snapshotHz', 'worldStateHz', 'inputHz', 'inputRedundancy', 'interpDelayMs', 'hostInputJitterBufferTicks', 'lagCompMaxTicks', 'defenderGraceMaxTicks', 'protocolVersion', 'maxPlayers', 'maxSpectators'),
  input: ro({ actionBufferFrames: num, motionWindowFrames: num, tapJumpDefault: bool, smashChargeMaxFrames: num, smashChargeMaxMult: num }),
  gravity: num, kbDecay: num,
  launch: numObj('tumbleSpeed', 'diMaxDeg', 'bounceRetain', 'bounceMinSpeed', 'bounceDamage'),
  hitstun: numObj('base', 'perSpeed', 'max'),
  hitstop: numObj('base', 'perDamage', 'min', 'max', 'heavyBonus', 'finalKoFreeze', 'finalKoSlowmoFrames', 'finalKoSlowmoScale'),
  guard: numObj('blockstunBase', 'blockstunPerDamage', 'guardDamageMult', 'heavyGuardDamageMult', 'drainPerSec', 'regenPerSec', 'regenDelayFrames', 'releaseLag', 'pushbackScale', 'breakStunFrames', 'breakStunMinFrames', 'breakPopSpeed'),
  parry: numObj('windowFrames', 'cooldownFrames', 'attackerStunFrames', 'projectileReflectSpeedMult', 'giltGain'),
  grab: numObj('techWindowFrames', 'holdBaseFrames', 'holdPerPercent', 'holdMaxFrames', 'regrabImmunityFrames'),
  dodge: ro({
    roll: ro({ distance: num, total: num, invuln: vec2 }),
    spot: ro({ total: num, invuln: vec2 }),
    air: ro({ distance: num, travelFrames: num, total: num, invuln: vec2, landingLag: num, slideRetain: num, perAirtime: num }),
  }),
  ledge: ro({ grabBox: vec2, invulnFramesFirstGrab: num, maxHangSeconds: num, regrabNoInvuln: bool, getupFrames: num, trump: bool }),
  wallJump: ro({ perAirtime: num, speed: vec2 }),
  gilt: numObj('max', 'gainPerPercentTaken', 'gainOnStockLost', 'gainOnParry', 'breakerCost', 'breakerInvulnFrames', 'breakerRadius', 'breakerPushSpeed'),
  terrain: ro({
    crackPerImpactSpeed: num, crackTechMult: num, crazeWarningSeconds: num, looseSinkSeconds: num, looseSinkSpeed: num,
    rubblePerChunk: vec2, maxDynamicChunks: num, maxRubble: num, debrisHitMinSpeed: num, debrisDamagePerSpeed: num, debrisBkb: num, debrisKbg: num,
  }),
  match: v.pipe(
    ro({
      roundSeconds: num, suddenDeathPercent: num, hardEndSeconds: num, stocks: numObj('2-4', '5-8'),
      sessionWinsToTake: num, rematchAutoSeconds: num, respawnInvulnFrames: num, ghostTapCooldownSeconds: num, ghostTapCrack: num,
    }),
    v.transform(({ stocks, ...rest }) => ({ ...rest, stocks2to4: stocks['2-4'], stocks5to8: stocks['5-8'] }) as const),
  ),
  blastZone: blastZoneSchema,
  camera: numObj('fovDeg', 'pitchDeg', 'minWidth', 'maxWidth', 'margin', 'posOmega', 'zoomOmega', 'yawMaxDeg', 'launchLeanDeg', 'launchWiden'),
});

const fighterStatsSchema = numObj('weight', 'height', 'width', 'run', 'dash', 'airSpeed', 'airAccel', 'groundAccel', 'traction', 'jumpSquat', 'fullHop', 'shortHop', 'doubleJump', 'gravityScale', 'maxFall', 'fastFall', 'grabRange', 'guardHP', 'crackMult');
const nestaSizeSchema = numObj('scale', 'weight', 'run', 'dash', 'airSpeed', 'fullHop', 'doubleJump', 'maxFall', 'damageMult', 'kbMult', 'startupAdd', 'grabRange', 'guardHP', 'crackMult', 'popsHeight');

const fighterEntrySchema = ro({
  name: str, ornament: str, role: str, difficulty: num, stats: fighterStatsSchema,
  moves: v.array(ro({
    id: enumStr(MOVE_KEY_TO_ENUM, 'MoveId'), name: str, startup: num, active: num, total: num,
    damage: num, bkb: num, kbg: num, angle: num, class: enumStr(MOVE_CLASS_TO_ENUM, 'MoveClass'), cancel: enumStr(CANCEL_TO_ENUM, 'CancelKind'),
    landingLag: v.nullable(num), note: str, onBlock: v.optional(v.nullable(num)), koCentre: v.optional(v.nullable(num)), koLedge: v.optional(v.nullable(num)),
  })),
  sizes: v.optional(v.record(enumStr(NESTA_SIZE_TO_ENUM, 'NestaSize'), nestaSizeSchema)),
});

const gadgetsRawSchema = ro({
  rules: v.pipe(
    ro({
      firstSpawnSeconds: num, spawnIntervalSeconds: vec2, maxOnStage: numObj('2-4', '5-8'),
      despawnSeconds: num, parcelDescentSeconds: num, trailingPlayerBias: num, holdLimit: num,
      dropOnTumble: bool, emptyThrowDamage: num, lastCallSpawnMult: num,
    }),
    v.transform(({ maxOnStage, ...rest }) => ({ ...rest, maxOnStage2to4: maxOnStage['2-4'], maxOnStage5to8: maxOnStage['5-8'] }) as const),
  ),
  gadgets: v.array(ro({
    id: enumStr(GADGET_KEY_TO_ENUM, 'GadgetId'), name: str,
    verb: enumStr(GADGET_VERB_TO_ENUM, 'GadgetVerb'), tier: enumStr(GADGET_TIER_TO_ENUM, 'GadgetTier'),
    weight: num, ammo: num, numbers: v.pipe(v.record(str, num), v.readonly()),
  })),
});

const arenaRawSchema = ro({
  id: enumStr(ARENA_KEY_TO_ENUM, 'ArenaId'), name: str, blastZone: blastZoneSchema,
  cameraBounds: numObj('minX', 'maxX', 'minY', 'maxY'), spawns: v.array(vec2),
  chunks: v.array(ro({ id: str, hp: num, oneWay: v.optional(bool), half: optBowlHalf, poly: v.pipe(v.array(vec2), v.minLength(3)) })),
  platforms: v.array(ro({
    id: str, kind: enumStr(PLATFORM_KIND_TO_ENUM, 'PlatformKind'), x0: num, x1: num, y: num, hp: num,
    support: v.optional(v.array(str)), attach: optBowlHalf, bob: v.optional(ro({ amp: num, periodSeconds: num, phase: v.optional(num) })),
  })),
  hazards: v.array(v.variant('id', [
    ro({ id: v.literal('pour'), atSeconds: v.array(num), telegraphSeconds: num, durationSeconds: num, column: vec2, force: numObj('down', 'outward'), after: numObj('slipperySeconds', 'tractionMult') }),
    ro({ id: v.literal('updraft'), gravityMult: num, maxFallMult: num, launchedLift: num }),
  ])),
  timeline: v.array(ro({ t: num, event: enumStr(TIMELINE_EVENT_TO_ENUM, 'TimelineAction'), ids: v.array(str) })),
});

const paletteRawSchema = v.pipe(
  ro({
    neutrals: strObj('bone', 'slip', 'bisque', 'terracotta', 'basalt', 'ash', 'ink'),
    players: v.pipe(v.array(ro({ slot: num, name: str, hex: str })), v.length(8), v.readonly()),
    accents: strObj('gilt', 'gilt_hi', 'gilt_lo', 'cheek', 'stamp_red', 'delft_ink', 'delft_paper'),
    world: strObj('sky_top', 'sky_mid', 'sky_low', 'cloud', 'fog', 'clay_foot', 'willow_glaze', 'willow_wash', 'willow_line', 'celadon', 'celadon_dk', 'tea_cream', 'tea_rose', 'tea', 'bowl_tenmoku', 'bowl_inner'),
    ui: strObj('paper', 'paper_shade', 'ink', 'ink_soft', 'cobalt', 'stamp', 'gilt', 'tag', 'ok', 'warn'),
    rules: numObj('worldMaxSaturationHSL', 'liveryMinSaturationHSL'),
  }),
  v.transform(({ rules, ...rest }) => ({ ...rest, ...rules }) as const),
);

// ---------------------------------------------------------------- Typed Data Contracts

export type TuningData = v.InferOutput<typeof tuningRawSchema>;
export type FighterStats = v.InferOutput<typeof fighterStatsSchema>;
export type NestaSizeSpec = v.InferOutput<typeof nestaSizeSchema>;
export type GadgetRulesData = v.InferOutput<typeof gadgetsRawSchema>['rules'];
export type GadgetSpec = v.InferOutput<typeof gadgetsRawSchema>['gadgets'][number];
export type PlayerColorSpec = { readonly slot: number; readonly name: string; readonly hex: string };
export type PaletteData = v.InferOutput<typeof paletteRawSchema>;

export interface MoveSpec {
  readonly id: MoveId; readonly name: string; readonly startup: number; readonly active: number; readonly total: number;
  readonly damage: number; readonly bkb: number; readonly kbg: number; readonly angle: number;
  readonly moveClass: MoveClass; readonly cancel: CancelKind; readonly landingLag: number;
  readonly onBlock: number | null; readonly koCentre: number | null; readonly koLedge: number | null;
  readonly bothSides: boolean; readonly bonusCrack: number; readonly reach: number;
}
export interface FighterSpec {
  readonly id: FighterId; readonly name: string; readonly ornament: string; readonly role: string; readonly difficulty: number;
  readonly stats: FighterStats; readonly moves: ReadonlyMap<MoveId, MoveSpec>; readonly nestaSizes: ReadonlyMap<NestaSize, NestaSizeSpec> | null;
}
export interface ChunkSpec {
  readonly index: number; readonly id: string; readonly hp: number; readonly oneWay: boolean; readonly half: BowlHalf;
  readonly poly: readonly (readonly [number, number])[]; readonly topX0: number; readonly topX1: number; readonly topY0: number; readonly topY1: number;
}
export interface PlatformSpec {
  readonly index: number; readonly id: string; readonly kind: PlatformKind; readonly x0: number; readonly x1: number;
  readonly y: number; readonly hp: number; readonly supportChunkIndices: readonly number[]; readonly attachHalf: BowlHalf;
  readonly bobAmp: number; readonly bobPeriodSeconds: number; readonly bobPhase: number;
}
export interface TimelineEntry {
  readonly tick: number; readonly seconds: number; readonly action: TimelineAction;
  readonly targetChunkIndices: readonly number[]; readonly targetPlatformIndices: readonly number[];
  readonly targetHazard: HazardId | null; readonly sinkPair: readonly [number, number] | null;
}
export interface PourHazardSpec {
  readonly atTicks: readonly number[]; readonly telegraphTicks: number; readonly durationTicks: number;
  readonly x0: number; readonly x1: number; readonly forceDown: number; readonly forceOutward: number;
  readonly slipperyTicks: number; readonly tractionMult: number;
}
export interface UpdraftHazardSpec {
  readonly minGap: number; readonly gravityMult: number; readonly maxFallMult: number; readonly launchedLift: number;
}
export interface ArenaSpec {
  readonly id: ArenaId; readonly name: string;
  readonly blastZone: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number };
  readonly cameraBounds: { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number };
  readonly spawns: readonly (readonly [number, number])[]; readonly chunks: readonly ChunkSpec[];
  readonly platforms: readonly PlatformSpec[]; readonly timeline: readonly TimelineEntry[];
  readonly pourHazard: PourHazardSpec | null; readonly updraftHazard: UpdraftHazardSpec | null; readonly breakable: boolean;
}
export interface GameData {
  readonly tuning: TuningData; readonly fighters: ReadonlyMap<FighterId, FighterSpec>;
  readonly gadgetRules: GadgetRulesData; readonly gadgets: ReadonlyMap<GadgetId, GadgetSpec>;
  readonly arenas: ReadonlyMap<ArenaId, ArenaSpec>; readonly palette: PaletteData;
}

// ---------------------------------------------------------------- Load & Validate (zero fallbacks)

function parseMoveReach(note: string, width: number, moveClass: MoveClass, grabRange: number): number {
  if (moveClass === MoveClass.Grab) return grabRange;
  const match = note.match(/[Rr]each\s+([\d.]+)\s*u/);
  if (match) return Number(match[1]);
  if (moveClass === MoveClass.Heavy) return width * 0.85 + 0.95;
  if (moveClass === MoveClass.Air) return width * 0.75 + 0.85;
  if (moveClass === MoveClass.Special) return width * 0.85 + 1.0;
  return width * 0.75 + 0.75;
}

function loadFighters(): ReadonlyMap<FighterId, FighterSpec> {
  const parsed = parseSchema(v.record(enumStr(FIGHTER_KEY_TO_ENUM, 'FighterId'), fighterEntrySchema), fightersRaw, 'fighters.json');
  const map = new Map<FighterId, FighterSpec>();
  for (const [k, raw] of Object.entries(parsed)) {
    const id = Number(k) as FighterId;
    const moves = new Map<MoveId, MoveSpec>();
    for (const m of raw.moves) {
      const crackMatch = m.note.match(/\+(\d+)\s+crack/);
      moves.set(m.id, {
        id: m.id, name: m.name, startup: m.startup, active: m.active, total: m.total,
        damage: m.damage, bkb: m.bkb, kbg: m.kbg, angle: m.angle, moveClass: m.class, cancel: m.cancel,
        landingLag: m.landingLag === null ? 0 : m.landingLag, onBlock: m.onBlock === undefined ? null : m.onBlock,
        koCentre: m.koCentre === undefined ? null : m.koCentre, koLedge: m.koLedge === undefined ? null : m.koLedge,
        bothSides: m.note.toLowerCase().includes('both sides'), bonusCrack: crackMatch ? Number(crackMatch[1]) : 0,
        reach: parseMoveReach(m.note, raw.stats.width, m.class, raw.stats.grabRange),
      });
    }
    let nestaSizes: ReadonlyMap<NestaSize, NestaSizeSpec> | null = null;
    if (raw.sizes !== undefined) {
      nestaSizes = new Map<NestaSize, NestaSizeSpec>(Object.entries(raw.sizes).map(([sk, sv]) => [Number(sk) as NestaSize, sv]));
      assert(nestaSizes.size === 3, ErrorCode.SchemaValidationFailed, 'Nesta must define exactly 3 sizes');
    }
    map.set(id, { id, name: raw.name, ornament: raw.ornament, role: raw.role, difficulty: raw.difficulty, stats: raw.stats, moves, nestaSizes });
  }
  for (const id of ALL_FIGHTER_IDS) assert(map.has(id), ErrorCode.SchemaValidationFailed, `Missing fighter ${id} in fighters.json`);
  return map;
}

function loadGadgets(): { rules: GadgetRulesData; gadgets: ReadonlyMap<GadgetId, GadgetSpec> } {
  const parsed = parseSchema(gadgetsRawSchema, gadgetsRaw, 'gadgets.json');
  const gadgets = new Map<GadgetId, GadgetSpec>(parsed.gadgets.map((g) => [g.id, g]));
  for (const id of ALL_GADGET_IDS) assert(gadgets.has(id), ErrorCode.SchemaValidationFailed, `Missing gadget ${id} in gadgets.json`);
  return { rules: parsed.rules, gadgets };
}

function loadArenas(tuning: TuningData): ReadonlyMap<ArenaId, ArenaSpec> {
  const parsed = parseSchema(v.array(arenaRawSchema), arenasRaw, 'arenas.json');
  const map = new Map<ArenaId, ArenaSpec>();
  const hz = tuning.tickRate;
  for (const raw of parsed) {
    const chunkIdToIdx = new Map<string, number>();
    const chunks: ChunkSpec[] = raw.chunks.map((c, index) => {
      chunkIdToIdx.set(c.id, index);
      const p0 = c.poly[0] as readonly [number, number];
      const p1 = c.poly[1] as readonly [number, number];
      return { index, id: c.id, hp: c.hp, oneWay: c.oneWay === true, half: toBowlHalf(c.half), poly: c.poly, topX0: p0[0], topX1: p1[0], topY0: p0[1], topY1: p1[1] };
    });
    const platIdToIdx = new Map<string, number>();
    const platforms: PlatformSpec[] = raw.platforms.map((p, index) => {
      platIdToIdx.set(p.id, index);
      return {
        index, id: p.id, kind: p.kind, x0: p.x0, x1: p.x1, y: p.y, hp: p.hp,
        supportChunkIndices: (p.support === undefined ? [] : p.support).map((sid) => requireKey(chunkIdToIdx, sid, `${raw.id}.platform.${p.id}.support`)),
        attachHalf: toBowlHalf(p.attach), bobAmp: p.bob ? p.bob.amp : 0, bobPeriodSeconds: p.bob ? p.bob.periodSeconds : 0,
        bobPhase: p.bob && p.bob.phase !== undefined ? p.bob.phase : 0,
      };
    });
    let pourHazard: PourHazardSpec | null = null;
    let updraftHazard: UpdraftHazardSpec | null = null;
    for (const h of raw.hazards) {
      if (h.id === 'pour') {
        pourHazard = {
          atTicks: h.atSeconds.map((s) => Math.round(s * hz)), telegraphTicks: Math.round(h.telegraphSeconds * hz),
          durationTicks: Math.round(h.durationSeconds * hz), x0: h.column[0], x1: h.column[1],
          forceDown: h.force.down, forceOutward: h.force.outward, slipperyTicks: Math.round(h.after.slipperySeconds * hz), tractionMult: h.after.tractionMult,
        };
      } else {
        updraftHazard = { minGap: 2.0, gravityMult: h.gravityMult, maxFallMult: h.maxFallMult, launchedLift: h.launchedLift };
      }
    }
    const timeline: TimelineEntry[] = raw.timeline.map((entry) => {
      const targetChunkIndices: number[] = [];
      const targetPlatformIndices: number[] = [];
      let targetHazard: HazardId | null = null;
      let sinkPair: readonly [number, number] | null = null;
      for (const tid of entry.ids) {
        if (tid.includes('|')) {
          const parts = tid.split('|');
          assert(parts.length === 2, ErrorCode.SchemaValidationFailed, `Invalid pair target ${tid}`);
          sinkPair = [requireKey(chunkIdToIdx, parts[0] as string, `${raw.id}.timeline.pair`), requireKey(chunkIdToIdx, parts[1] as string, `${raw.id}.timeline.pair`)];
        } else if (entry.event === TimelineAction.Hazard) {
          targetHazard = requireKey(HAZARD_KEY_TO_ENUM, tid, `${raw.id}.timeline.hazard`);
        } else if (entry.event !== TimelineAction.Tilt) {
          if (chunkIdToIdx.has(tid)) targetChunkIndices.push(requireKey(chunkIdToIdx, tid, `${raw.id}.timeline.chunk`));
          else if (platIdToIdx.has(tid)) targetPlatformIndices.push(requireKey(platIdToIdx, tid, `${raw.id}.timeline.platform`));
          else throw new InvariantError(ErrorCode.SchemaValidationFailed, `Unknown timeline target "${tid}" in arena ${raw.id}`);
        }
      }
      return { tick: Math.round(entry.t * hz), seconds: entry.t, action: entry.event, targetChunkIndices, targetPlatformIndices, targetHazard, sinkPair };
    });
    map.set(raw.id, {
      id: raw.id, name: raw.name, blastZone: raw.blastZone, cameraBounds: raw.cameraBounds,
      spawns: raw.spawns, chunks, platforms, timeline, pourHazard, updraftHazard, breakable: true,
    });
  }
  for (const id of ALL_ARENA_IDS) assert(map.has(id), ErrorCode.SchemaValidationFailed, `Missing arena ${id} in arenas.json`);
  const saucerPoly: readonly (readonly [number, number])[] = [[-7.0, 0.0], [7.0, 0.0], [6.2, -1.3], [0.0, -1.8], [-6.2, -1.3]];
  map.set(ArenaId.Saucer, {
    id: ArenaId.Saucer, name: 'The Saucer', blastZone: tuning.blastZone, cameraBounds: { minX: -14, maxX: 14, minY: -5, maxY: 11 },
    spawns: [[-5.0, 0.1], [5.0, 0.1], [-3.5, 0.1], [3.5, 0.1], [-2.0, 0.1], [2.0, 0.1], [-0.8, 0.1], [0.8, 0.1]],
    chunks: [{ index: 0, id: 'S1', hp: 999999, oneWay: false, half: BowlHalf.None, poly: saucerPoly, topX0: -7.0, topX1: 7.0, topY0: 0.0, topY1: 0.0 }],
    platforms: [], timeline: [], pourHazard: null, updraftHazard: null, breakable: false,
  });
  return map;
}

let cachedData: GameData | null = null;

export function getGameData(): GameData {
  if (cachedData === null) {
    const tuning = parseSchema(tuningRawSchema, tuningRaw, 'tuning.json');
    const { rules, gadgets } = loadGadgets();
    cachedData = {
      tuning, fighters: loadFighters(), gadgetRules: rules, gadgets,
      arenas: loadArenas(tuning), palette: parseSchema(paletteRawSchema, paletteRaw, 'palette.json'),
    };
  }
  return cachedData;
}

export const getFighterSpec = (id: FighterId): FighterSpec => requireKey(getGameData().fighters, id, 'fighters');
export const getMoveSpec = (fighterId: FighterId, moveId: MoveId): MoveSpec =>
  requireKey(getFighterSpec(fighterId).moves, moveId, `fighter[${fighterId}].moves`);
export const getGadgetSpec = (id: GadgetId): GadgetSpec => requireKey(getGameData().gadgets, id, 'gadgets');
export const getArenaSpec = (id: ArenaId): ArenaSpec => requireKey(getGameData().arenas, id, 'arenas');
