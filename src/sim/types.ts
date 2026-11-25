import {
  ArenaId,
  BowlHalf,
  ChunkState,
  CrackSource,
  FighterFlag,
  FighterId,
  FighterState,
  GadgetId,
  HazardId,
  HitOutcome,
  InputDir,
  KoCause,
  MatchMode,
  MotionInput,
  MoveId,
  NestaSize,
  PlatformKind,
  ProjectileKind,
  SimEventKind,
  TeamId,
  TimelineAction,
  WorldGadgetState,
} from './enums';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Capsule {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly radius: number;
}

export interface InputSample {
  readonly tick: number;
  readonly mask: number;
}

export interface InputBufferEntry {
  readonly bit: number;
  readonly dir: InputDir;
  readonly pressedTick: number;
}

export interface InputHistoryRing {
  readonly masks: Int32Array;
  readonly ticks: Int32Array;
  head: number;
  count: number;
}

export interface FighterHurtboxFrame {
  readonly tick: number;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly halfHeight: number;
  readonly state: FighterState;
  readonly flags: number;
}

export interface PendingHitRecord {
  readonly tick: number;
  readonly attackerSlot: number;
  readonly defenderSlot: number;
  readonly moveId: MoveId;
  readonly damage: number;
  readonly bkb: number;
  readonly kbg: number;
  readonly angle: number;
  readonly isHeavy: boolean;
  readonly isGrab: boolean;
  readonly launchX: number;
  readonly launchY: number;
  readonly attackerFacing: number;
  readonly resolvedTick: number;
}

export interface FighterRuntime {
  readonly slot: number;
  readonly id: FighterId;
  readonly team: TeamId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  kbVx: number;
  kbVy: number;
  state: FighterState;
  stateFrame: number;
  flags: number;
  damage: number;
  guardHp: number;
  guardRegenDelay: number;
  parryCooldown: number;
  gilt: number;
  stocks: number;
  heldGadget: GadgetId;
  heldGadgetAmmo: number;
  gadgetCooldown: number;
  corkChargeFrames: number;
  activeMove: MoveId;
  moveFrame: number;
  moveHitConnected: boolean;
  moveHitLanded: boolean;
  moveHitIds: number[];
  moveIsClean: boolean;
  heavyChargeFrames: number;
  chaseDodgeWindow: number;
  chaseDodgeActive: boolean;
  sdiNudgesLeft: number;
  hitstopFrames: number;
  hitstunFrames: number;
  blockstunFrames: number;
  invulnFrames: number;
  regrabImmunity: number;
  grabbedBySlot: number;
  grabbingSlot: number;
  grabHoldFrames: number;
  doubleJumpsLeft: number;
  airDodgesLeft: number;
  wallJumpsLeft: number;
  ledgeGrabCount: number;
  ledgeChunkIndex: number;
  ledgeSide: number;
  comboCount: number;
  comboHitsByMove: Map<MoveId, number>;
  lastHitBySlot: number;
  lastHitByGadget: GadgetId;
  lastHitByMove: MoveId;
  lastHitTick: number;
  nestaSize: NestaSize;
  shedsRemaining: number;
  pipingCharged: boolean;
  steepChargeFrames: number;
  sneezeBuildFrames: number;
  rootFrames: number;
  rootMashCount: number;
  slipperyFrames: number;
  teaspoonCooldown: number;
  teaspoonX: number;
  lastInputMask: number;
  prevInputMask: number;
  lastInputTick: number;
  posHistoryX: Float32Array;
  posHistoryY: Float32Array;
  posHistoryCursor: number;
  posHistoryCount: number;
  buffer: InputBufferEntry[];
  history: InputHistoryRing;
  hurtboxHistory: FighterHurtboxFrame[];
  lastMotion: MotionInput;
  pendingHit: PendingHitRecord | null;
  stampedeCarriedSlot: number;
  stampedeCarryFrames: number;
  /** Handle to Rapier rigid body & collider (opaque numeric handle). */
  bodyHandle: number;
  colliderHandle: number;
}

export interface ChunkRuntime {
  readonly index: number;
  readonly id: string;
  readonly maxHp: number;
  readonly oneWay: boolean;
  readonly half: BowlHalf;
  hp: number;
  state: ChunkState;
  stateTicks: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  angVel: number;
  resting: boolean;
  restSent: boolean;
  bodyHandle: number;
  colliderHandle: number;
}

export interface PlatformRuntime {
  readonly index: number;
  readonly id: string;
  readonly kind: PlatformKind;
  readonly baseY: number;
  x0: number;
  x1: number;
  y: number;
  hp: number;
  alive: boolean;
  falling: boolean;
  vy: number;
  bodyHandle: number;
  colliderHandle: number;
}

export interface RubbleRuntime {
  readonly id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  radius: number;
  resting: boolean;
  restSent: boolean;
  ownerSlot: number;
  isShell: boolean;
  shellHitsLeft: number;
  ttlTicks: number;
  bodyHandle: number;
  colliderHandle: number;
}

export interface WorldGadgetRuntime {
  readonly id: number;
  readonly gadgetId: GadgetId;
  ammo: number;
  state: WorldGadgetState;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  ttlTicks: number;
  armTicks: number;
  ownerSlot: number;
  stuckChunkIndex: number;
  bodyHandle: number;
  colliderHandle: number;
}

export interface ProjectileRuntime {
  readonly id: number;
  readonly kind: ProjectileKind;
  ownerSlot: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  bkb: number;
  kbg: number;
  angle: number;
  ttlTicks: number;
  gravityScale: number;
  reflected: boolean;
  stuckFighterSlot: number;
  stuckChunkIndex: number;
  stuckTicks: number;
  gadgetId: GadgetId;
  pipingMultiHits: number;
}

export interface HazardZoneRuntime {
  readonly id: number;
  readonly gadgetId: GadgetId;
  ownerSlot: number;
  x: number;
  y: number;
  vx: number;
  radius: number;
  ttlTicks: number;
  chunkIndex: number;
}

export interface LedgePoint {
  readonly chunkIndex: number;
  readonly side: -1 | 1;
  readonly x: number;
  readonly y: number;
}

export interface SimEvent {
  readonly tick: number;
  readonly kind: SimEventKind;
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
}

export interface MatchConfig {
  readonly arenaId: ArenaId;
  readonly mode: MatchMode;
  readonly fragile: boolean;
  readonly seed: number;
  readonly fighters: readonly {
    readonly slot: number;
    readonly id: FighterId;
    readonly team: TeamId;
  }[];
  readonly enableTierB?: boolean;
  readonly enableTierC?: boolean;
  readonly stocksOverride?: number;
}

export interface RoundResult {
  readonly winnerSlot: number;
  readonly winnerTeam: TeamId;
  readonly endTick: number;
  readonly endedBySuddenDeath: boolean;
  readonly endedByHardEnd: boolean;
  readonly koOrder: readonly {
    readonly tick: number;
    readonly victimSlot: number;
    readonly killerSlot: number;
    readonly cause: KoCause;
    readonly moveId: MoveId;
    readonly gadgetId: GadgetId;
  }[];
}

export interface CrackStats {
  readonly bySource: Record<CrackSource, number>;
}

export interface HitCheckResult {
  readonly outcome: HitOutcome;
  readonly damage: number;
  readonly launchSpeed: number;
  readonly launchAngleDeg: number;
  readonly hitstun: number;
  readonly hitstop: number;
  readonly blockstun: number;
  readonly pushbackSpeed: number;
}

export interface PourState {
  active: boolean;
  telegraphing: boolean;
  ticksLeft: number;
}

export interface BowlState {
  splitActive: boolean;
  gap: number;
  tiltActive: boolean;
  tiltDeg: number;
}

export interface SeesawState {
  snapped: boolean;
  angleDeg: number;
  angVelDeg: number;
}

export interface IslandState {
  readonly arenaId: ArenaId;
  readonly chunks: ChunkRuntime[];
  readonly platforms: PlatformRuntime[];
  readonly rubble: RubbleRuntime[];
  readonly timelineFired: boolean[];
  readonly playerCountTimeShiftTicks: number;
  nextRubbleId: number;
  lastCallActive: boolean;
  suddenDeathActive: boolean;
  pour: PourState;
  bowl: BowlState;
  seesaw: SeesawState;
  ledges: LedgePoint[];
  crackTotals: Record<CrackSource, number>;
  halfGoneTick: number;
}

export {
  ArenaId,
  BowlHalf,
  ChunkState,
  CrackSource,
  FighterFlag,
  FighterId,
  FighterState,
  GadgetId,
  HazardId,
  HitOutcome,
  InputDir,
  KoCause,
  MatchMode,
  MotionInput,
  MoveId,
  NestaSize,
  PlatformKind,
  ProjectileKind,
  SimEventKind,
  TeamId,
  TimelineAction,
  WorldGadgetState,
};
