import wordsData from '@data/words.json';
import { assert, assertFinite, assertNever, InvariantError, requireAt } from '@sim/assert';
import { ALL_FIGHTER_IDS, ErrorCode, FighterId, KoCause } from '@sim/enums';
import * as v from 'valibot';
import { GlazeFinish, KeyAction } from './enums';

export enum AppraisalId {
  PacifistWin = 0,
  CorkSelfKo = 1,
  ParryParriedCork = 2,
  TeaspoonFinalTap = 3,
  FragileSurvivor = 4,
  TripleParry = 5,
  IslandCrusher = 6,
  LastChunkStanding = 7,
  HatTrick = 8,
  ComebackGilt = 9,
  SessionChampion = 10,
  FullHouseBrawl = 11,
}

export interface AppraisalSpec {
  readonly id: AppraisalId;
  readonly title: string;
  readonly criteria: string;
  readonly reward: GlazeFinish;
  readonly rewardLabel: string;
}

export interface FighterProvenance {
  readonly roundsPlayed: number;
  readonly wins: number;
  readonly kos: number;
  readonly mostEmbarrassingExit: string;
}

export interface PlayerProfile {
  readonly lotName: string;
  readonly lastFighter: FighterId;
  readonly lastColorIndex: number;
  readonly equippedFinish: GlazeFinish;
  readonly volumeMaster: number;
  readonly volumeMusic: number;
  readonly volumeEffects: number;
  readonly volumeAuctioneer: number;
  readonly reduceFlashes: boolean;
  readonly cameraShake: number;
  readonly colorBlindPatterns: boolean;
  readonly keyBindings: Partial<Record<KeyAction, string>>;
  readonly unlockedAppraisals: readonly AppraisalId[];
  readonly provenance: Record<FighterId, FighterProvenance>;
}

export interface RoundTelemetryForAppraisal {
  readonly fighterId: FighterId;
  readonly won: boolean;
  readonly kos: number;
  readonly damageTaken: number;
  readonly peakDamage: number;
  readonly attacksLanded: number;
  readonly parriesLanded: number;
  readonly chunksShattered: number;
  readonly chunksRemaining: number;
  readonly fighterCount: number;
  readonly fragileMode: boolean;
  readonly sessionWon: boolean;
  readonly selfKoByCork: boolean;
  readonly parriedParriedCork: boolean;
  readonly teaspoonFinalTap: boolean;
  readonly exitCause: KoCause | null;
}

export const PROFILE_STORAGE_KEY = 'bb.profile.v1';

export const ALL_APPRAISAL_IDS: readonly AppraisalId[] = [
  AppraisalId.PacifistWin,
  AppraisalId.CorkSelfKo,
  AppraisalId.ParryParriedCork,
  AppraisalId.TeaspoonFinalTap,
  AppraisalId.FragileSurvivor,
  AppraisalId.TripleParry,
  AppraisalId.IslandCrusher,
  AppraisalId.LastChunkStanding,
  AppraisalId.HatTrick,
  AppraisalId.ComebackGilt,
  AppraisalId.SessionChampion,
  AppraisalId.FullHouseBrawl,
];

export const APPRAISAL_SPECS: Record<AppraisalId, AppraisalSpec> = {
  [AppraisalId.PacifistWin]: { id: AppraisalId.PacifistWin, title: 'Mint Condition', criteria: 'Won a round without landing an attack', reward: GlazeFinish.Crackle, rewardLabel: 'Crackle Glaze' },
  [AppraisalId.CorkSelfKo]: { id: AppraisalId.CorkSelfKo, title: 'Uncorked Tragedy', criteria: "KO'd yourself with a Champagne Cork", reward: GlazeFinish.Lustre, rewardLabel: 'Lustre Glaze' },
  [AppraisalId.ParryParriedCork]: { id: AppraisalId.ParryParriedCork, title: 'Double Vintage', criteria: 'Parried a parried Cork', reward: GlazeFinish.GoldRim, rewardLabel: 'Gold Rim' },
  [AppraisalId.TeaspoonFinalTap]: { id: AppraisalId.TeaspoonFinalTap, title: 'Polite Ruin', criteria: 'Ended a round as the Teaspoon tapping the last chunk', reward: GlazeFinish.PearlOverglaze, rewardLabel: 'Pearl Overglaze' },
  [AppraisalId.FragileSurvivor]: { id: AppraisalId.FragileSurvivor, title: 'Hairline Heirloom', criteria: 'Won a round in Fragile mode', reward: GlazeFinish.Kintsugi, rewardLabel: 'Kintsugi Seam' },
  [AppraisalId.TripleParry]: { id: AppraisalId.TripleParry, title: 'Ringing Porcelain', criteria: 'Landed 3 parries in one round', reward: GlazeFinish.CeladonWash, rewardLabel: 'Celadon Wash' },
  [AppraisalId.IslandCrusher]: { id: AppraisalId.IslandCrusher, title: 'Estate Clearance', criteria: 'Shattered 4+ island chunks in one round', reward: GlazeFinish.Tenmoku, rewardLabel: 'Tenmoku Iron' },
  [AppraisalId.LastChunkStanding]: { id: AppraisalId.LastChunkStanding, title: 'Lone Plinth', criteria: 'Won with only 1 chunk left on the island', reward: GlazeFinish.DelftInk, rewardLabel: 'Delft Ink' },
  [AppraisalId.HatTrick]: { id: AppraisalId.HatTrick, title: 'Hammer Trio', criteria: 'Scored 3 KOs in a single round', reward: GlazeFinish.OxbloodSheen, rewardLabel: 'Oxblood Sheen' },
  [AppraisalId.ComebackGilt]: { id: AppraisalId.ComebackGilt, title: 'Gilded Underdog', criteria: 'Won a round after reaching 120%+ damage', reward: GlazeFinish.RoyalGilt, rewardLabel: 'Royal Gilt' },
  [AppraisalId.SessionChampion]: { id: AppraisalId.SessionChampion, title: 'Top Lot', criteria: 'Won a 3-round session', reward: GlazeFinish.MatteBisque, rewardLabel: 'Matte Bisque' },
  [AppraisalId.FullHouseBrawl]: { id: AppraisalId.FullHouseBrawl, title: 'Packed Saleroom', criteria: 'Completed a round with 6+ fighters', reward: GlazeFinish.SpeckledStone, rewardLabel: 'Speckled Stone' },
};

assert(wordsData.roomWords.length === 3, ErrorCode.SchemaValidationFailed, 'words.json roomWords must have 3 lists');
export const ROOM_ADJECTIVES: readonly string[] = wordsData.roomWords[0]!;
export const ROOM_VESSELS: readonly string[] = wordsData.roomWords[1]!;
export const ROOM_SUFFIXES: readonly string[] = wordsData.roomWords[2]!;
assert(
  ROOM_ADJECTIVES.length === 64 && ROOM_VESSELS.length === 64 && ROOM_SUFFIXES.length === 64,
  ErrorCode.SchemaValidationFailed,
  'Room word lists must each have exactly 64 entries',
);
assert(wordsData.lotNames.length >= 32, ErrorCode.SchemaValidationFailed, 'words.json lotNames must have at least 32 entries');
export const DEFAULT_LOT_NAMES: readonly string[] = wordsData.lotNames.slice(0, 32);

export function generateCeramicRoomCode(rng?: () => number): string {
  const lists = [ROOM_ADJECTIVES, ROOM_VESSELS, ROOM_SUFFIXES] as const;
  if (rng !== undefined) {
    return lists.map((list, idx) => {
      const val = assertFinite(rng(), `rng[${idx}]`);
      assert(val >= 0 && val < 1, ErrorCode.InvariantViolation, `rng() must return [0, 1), got ${val}`);
      return requireAt(list, Math.floor(val * list.length), `roomWords[${idx}]`);
    }).join('-');
  }
  assert(typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function', ErrorCode.MissingRequiredEntry, 'crypto.getRandomValues unavailable');
  const buf = new Uint32Array(3);
  crypto.getRandomValues(buf);
  return lists.map((list, idx) => requireAt(list, buf[idx]! % list.length, `roomWords[${idx}]`)).join('-');
}

export function pickDefaultLotName(seed: number): string {
  assert(Number.isInteger(seed), ErrorCode.InvariantViolation, `Lot name seed must be integer, got ${seed}`);
  const len = DEFAULT_LOT_NAMES.length;
  const idx = ((seed % len) + len) % len;
  return requireAt(DEFAULT_LOT_NAMES, idx, 'DEFAULT_LOT_NAMES');
}

const unitNum = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1));
const nonNegInt = v.pipe(v.number(), v.integer(), v.minValue(0));
const provenanceSchema = v.pipe(
  v.object({ roundsPlayed: nonNegInt, wins: nonNegInt, kos: nonNegInt, mostEmbarrassingExit: v.pipe(v.string(), v.minLength(1), v.maxLength(96)) }),
  v.readonly(),
);
const keyBindingsSchema = v.pipe(
  v.record(v.string(), v.pipe(v.string(), v.minLength(1), v.maxLength(32))),
  v.check((rec) => Object.keys(rec).every((k) => {
    const n = Number(k);
    return Number.isInteger(n) && n >= KeyAction.Left && n <= KeyAction.Taunt;
  }), 'Invalid KeyAction key'),
  v.transform((rec) => {
    const out: Partial<Record<KeyAction, string>> = {};
    for (const [k, val] of Object.entries(rec)) out[Number(k) as KeyAction] = val;
    return out;
  }),
);
const profileSchema = v.pipe(
  v.object({
    lotName: v.pipe(v.string(), v.minLength(1), v.maxLength(48)),
    lastFighter: v.enum(FighterId),
    lastColorIndex: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(7)),
    equippedFinish: v.enum(GlazeFinish),
    volumeMaster: unitNum,
    volumeMusic: unitNum,
    volumeEffects: unitNum,
    volumeAuctioneer: unitNum,
    reduceFlashes: v.boolean(),
    cameraShake: unitNum,
    colorBlindPatterns: v.boolean(),
    keyBindings: keyBindingsSchema,
    unlockedAppraisals: v.pipe(
      v.array(v.enum(AppraisalId)),
      v.check((arr) => new Set(arr).size === arr.length, 'Duplicate AppraisalId'),
    ),
    provenance: v.pipe(
      v.object({
        [FighterId.Earl]: provenanceSchema,
        [FighterId.Grog]: provenanceSchema,
        [FighterId.Nesta]: provenanceSchema,
        [FighterId.Moss]: provenanceSchema,
      }),
      v.readonly(),
    ),
  }),
  v.readonly(),
);

function createDefaultProvenance(): FighterProvenance {
  return { roundsPlayed: 0, wins: 0, kos: 0, mostEmbarrassingExit: 'None yet' };
}

export function createDefaultPlayerProfile(): PlayerProfile {
  return {
    lotName: pickDefaultLotName(0),
    lastFighter: FighterId.Earl,
    lastColorIndex: 0,
    equippedFinish: GlazeFinish.Standard,
    volumeMaster: 0.7,
    volumeMusic: 0.6,
    volumeEffects: 0.8,
    volumeAuctioneer: 0.8,
    reduceFlashes: false,
    cameraShake: 1.0,
    colorBlindPatterns: false,
    keyBindings: {},
    unlockedAppraisals: [],
    provenance: {
      [FighterId.Earl]: createDefaultProvenance(),
      [FighterId.Grog]: createDefaultProvenance(),
      [FighterId.Nesta]: createDefaultProvenance(),
      [FighterId.Moss]: createDefaultProvenance(),
    },
  };
}

function resolveStorage(storage?: Storage): Storage | null {
  if (storage !== undefined) return storage;
  return typeof localStorage !== 'undefined' ? localStorage : null;
}

export function loadPlayerProfile(storage?: Storage): PlayerProfile {
  const store = resolveStorage(storage);
  if (store === null) {
    console.warn('[progression] localStorage unavailable; returning default profile');
    return createDefaultPlayerProfile();
  }
  const raw = store.getItem(PROFILE_STORAGE_KEY);
  if (raw === null) return createDefaultPlayerProfile();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(`[progression] Corrupt profile JSON in ${PROFILE_STORAGE_KEY}; resetting:`, err);
    const fresh = createDefaultPlayerProfile();
    store.setItem(PROFILE_STORAGE_KEY, JSON.stringify(fresh));
    return fresh;
  }

  const res = v.safeParse(profileSchema, parsed);
  if (!res.success) {
    const detail = res.issues.map((iss) => iss.message).join('; ');
    console.warn(`[progression] Invalid profile schema in ${PROFILE_STORAGE_KEY}; resetting: ${detail}`);
    const fresh = createDefaultPlayerProfile();
    store.setItem(PROFILE_STORAGE_KEY, JSON.stringify(fresh));
    return fresh;
  }
  return res.output;
}

export function savePlayerProfile(profile: PlayerProfile, storage?: Storage): void {
  const res = v.safeParse(profileSchema, profile);
  if (!res.success) {
    const detail = res.issues.map((iss) => iss.message).join('; ');
    throw new InvariantError(ErrorCode.SchemaValidationFailed, `Invalid PlayerProfile: ${detail}`);
  }
  const store = resolveStorage(storage);
  assert(store !== null, ErrorCode.MissingRequiredEntry, 'localStorage unavailable for savePlayerProfile');
  store.setItem(PROFILE_STORAGE_KEY, JSON.stringify(res.output));
}

function checkAppraisal(id: AppraisalId, t: RoundTelemetryForAppraisal): boolean {
  switch (id) {
    case AppraisalId.PacifistWin: return t.won && t.attacksLanded === 0;
    case AppraisalId.CorkSelfKo: return t.selfKoByCork;
    case AppraisalId.ParryParriedCork: return t.parriedParriedCork;
    case AppraisalId.TeaspoonFinalTap: return t.teaspoonFinalTap;
    case AppraisalId.FragileSurvivor: return t.won && t.fragileMode;
    case AppraisalId.TripleParry: return t.parriesLanded >= 3;
    case AppraisalId.IslandCrusher: return t.chunksShattered >= 4;
    case AppraisalId.LastChunkStanding: return t.won && t.chunksRemaining === 1;
    case AppraisalId.HatTrick: return t.kos >= 3;
    case AppraisalId.ComebackGilt: return t.won && t.peakDamage >= 120;
    case AppraisalId.SessionChampion: return t.sessionWon;
    case AppraisalId.FullHouseBrawl: return t.fighterCount >= 6;
    default: return assertNever(id, 'checkAppraisal');
  }
}

function exitSummaryForCause(cause: KoCause): string {
  switch (cause) {
    case KoCause.SelfDestruct: return 'Walked briskly off the platter';
    case KoCause.FallingChunk: return 'Rode a doomed shard into the abyss';
    case KoCause.Gadget: return 'Launched by party contraband';
    case KoCause.Hazard: return 'Swept away by scalding tea';
    case KoCause.FighterMove: return 'Posted airmail to the blast zone';
    case KoCause.HardEnd: return 'Outlasted by the auction clock';
    default: return assertNever(cause, 'exitSummaryForCause');
  }
}

export function generateAppraisalLine(
  fighterId: FighterId,
  kos: number,
  damageTaken: number,
  won: boolean,
  cause: KoCause | null,
): string {
  assertFinite(kos, 'kos');
  assertFinite(damageTaken, 'damageTaken');
  const dmg = Math.round(damageTaken);
  if (won) {
    if (kos >= 3) return `Flawless mantelpiece pedigree (${kos} KOs, ${dmg}% stress-tested).`;
    if (dmg >= 120) return `Crazed across every seam (${dmg}% taken) yet refused the bin.`;
    return fighterId === FighterId.Earl ? 'Steeped to reserve price and sold cleanly.' : 'Provenance intact; hammer fell in their favour.';
  }
  if (cause === null) return `Appraised at ${dmg}% wear with ${kos} KOs on the ledger.`;
  switch (cause) {
    case KoCause.SelfDestruct: return `Self-inflicted chip at ${dmg}% — buyer’s remorse.`;
    case KoCause.FallingChunk: return `Went down with the crockery (${dmg}% crazing).`;
    case KoCause.Gadget: return `Removed from catalogue by rogue hardware (${dmg}%).`;
    case KoCause.Hazard: return `Steeped beyond warranty at ${dmg}%.`;
    case KoCause.FighterMove: return kos > 0 ? `Claimed ${kos} lot${kos === 1 ? '' : 's'} before a brisk exit at ${dmg}%.` : `Dismissed with minor crazing (${dmg}%).`;
    case KoCause.HardEnd: return `Auction bell rang at ${dmg}% — reserve unmet.`;
    default: return assertNever(cause, 'generateAppraisalLine');
  }
}

export function evaluateRoundProgression(
  profile: PlayerProfile,
  telemetry: RoundTelemetryForAppraisal,
): { readonly profile: PlayerProfile; readonly newlyUnlocked: readonly AppraisalId[] } {
  assert(ALL_FIGHTER_IDS.includes(telemetry.fighterId), ErrorCode.InvalidEnumValue, `Invalid FighterId: ${String(telemetry.fighterId)}`);
  assert(Number.isInteger(telemetry.kos) && telemetry.kos >= 0, ErrorCode.InvariantViolation, `Invalid kos: ${telemetry.kos}`);
  assertFinite(telemetry.damageTaken, 'damageTaken');
  assertFinite(telemetry.peakDamage, 'peakDamage');

  const unlockedSet = new Set<AppraisalId>(profile.unlockedAppraisals);
  const newlyUnlocked: AppraisalId[] = [];
  for (const id of ALL_APPRAISAL_IDS) {
    if (!unlockedSet.has(id) && checkAppraisal(id, telemetry)) {
      unlockedSet.add(id);
      newlyUnlocked.push(id);
    }
  }

  const prev = profile.provenance[telemetry.fighterId];
  const exitText = !telemetry.won && telemetry.exitCause !== null
    ? exitSummaryForCause(telemetry.exitCause)
    : prev.mostEmbarrassingExit;

  const nextProvenance: Record<FighterId, FighterProvenance> = {
    ...profile.provenance,
    [telemetry.fighterId]: {
      roundsPlayed: prev.roundsPlayed + 1,
      wins: prev.wins + (telemetry.won ? 1 : 0),
      kos: prev.kos + telemetry.kos,
      mostEmbarrassingExit: exitText,
    },
  };

  return {
    profile: {
      ...profile,
      unlockedAppraisals: [...unlockedSet],
      provenance: nextProvenance,
    },
    newlyUnlocked,
  };
}
